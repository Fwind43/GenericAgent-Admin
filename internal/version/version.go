package version

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	neturl "net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"time"
)

var (
	Version = "dev"
	Commit  = "unknown"
	Date    = "unknown"
)

var repoLatestURL = "https://api.github.com/repos/Fwind43/GenericAgent-Admin/releases/latest"

var (
	githubMirrorMu sync.RWMutex
	githubMirror   string
)

// SetRepoURL overrides the default update repo URL (e.g. from config.local.json).
func SetRepoURL(url string) {
	if url != "" {
		repoLatestURL = url
	}
}

// SetGitHubMirror configures an optional HTTP(S) prefix for GitHub release
// asset downloads. For example, https://mirror.example turns a release URL
// into https://mirror.example/https://github.com/owner/repo/releases/....
func SetGitHubMirror(rawURL string) {
	githubMirrorMu.Lock()
	githubMirror = strings.TrimRight(strings.TrimSpace(rawURL), "/")
	githubMirrorMu.Unlock()
}

func resolveDownloadURL(rawURL string) string {
	parsed, err := neturl.Parse(rawURL)
	if err != nil || !strings.EqualFold(parsed.Hostname(), "github.com") {
		return rawURL
	}
	githubMirrorMu.RLock()
	mirror := githubMirror
	githubMirrorMu.RUnlock()
	if mirror == "" {
		return rawURL
	}
	return mirror + "/" + rawURL
}

const updateResponseHeaderTimeout = 15 * time.Second

var updateHTTPClient = &http.Client{Transport: updateHTTPTransport()}

func updateHTTPTransport() http.RoundTripper {
	tr, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			ResponseHeaderTimeout: updateResponseHeaderTimeout,
			DialContext: (&net.Dialer{
				Timeout:   30 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			TLSHandshakeTimeout: 30 * time.Second,
		}
	}
	clone := tr.Clone()
	clone.ResponseHeaderTimeout = updateResponseHeaderTimeout
	if clone.DialContext == nil {
		clone.DialContext = (&net.Dialer{
			Timeout:   30 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext
	}
	if clone.TLSHandshakeTimeout == 0 {
		clone.TLSHandshakeTimeout = 30 * time.Second
	}
	return clone
}

const (
	maxUpdateMetadataBytes = 2 << 20
	maxUpdatePackageBytes  = 256 << 20
	maxUpdateChecksumBytes = 1 << 20
)

// retryHTTPRequest retries an HTTP operation with exponential backoff.
// It attempts up to 3 times with delays of 1s, 2s between attempts.
func retryHTTPRequest(ctx context.Context, operation string, fn func() error) error {
	const maxAttempts = 3
	var lastErr error

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		lastErr = fn()
		if lastErr == nil {
			return nil
		}

		// Don't retry on context cancellation
		if ctx.Err() != nil {
			return fmt.Errorf("%s: %w", operation, ctx.Err())
		}

		if attempt < maxAttempts {
			delay := time.Duration(attempt) * time.Second
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return fmt.Errorf("%s: %w", operation, ctx.Err())
			}
		}
	}

	return fmt.Errorf("%s failed after %d attempts: %w", operation, maxAttempts, lastErr)
}

type BuildInfo struct {
	Version                 string `json:"version"`
	Commit                  string `json:"commit"`
	Date                    string `json:"date"`
	GOOS                    string `json:"goos"`
	GOARCH                  string `json:"goarch"`
	Runtime                 string `json:"runtime"`
	Exe                     string `json:"exe"`
	UpdateSupported         bool   `json:"update_supported"`
	UpdateUnsupportedReason string `json:"update_unsupported_reason,omitempty"`
}

type Asset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

type Release struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
	Prerelease  bool      `json:"prerelease"`
	Draft       bool      `json:"draft"`
	Assets      []Asset   `json:"assets"`
}

type CheckResult struct {
	Current   BuildInfo `json:"current"`
	Latest    *Release  `json:"latest,omitempty"`
	Update    bool      `json:"update"`
	Asset     *Asset    `json:"asset,omitempty"`
	Checksum  *Asset    `json:"checksum,omitempty"`
	Message   string    `json:"message,omitempty"`
	CheckedAt time.Time `json:"checked_at"`
}

type ApplyResult struct {
	OK        bool   `json:"ok"`
	Message   string `json:"message"`
	Script    string `json:"script,omitempty"`
	handedOff bool
	ready     bool
}

type readyUpdate struct {
	OperationID  string `json:"operation_id"`
	HelperPath   string `json:"helper_path"`
	ManifestPath string `json:"manifest_path"`
}

type UpdateStatus struct {
	ID               string       `json:"id,omitempty"`
	PID              int          `json:"pid,omitempty"`
	OldPID           int          `json:"old_pid,omitempty"`
	HelperPID        int          `json:"helper_pid,omitempty"`
	NewPID           int          `json:"new_pid,omitempty"`
	Running          bool         `json:"running"`
	Stage            string       `json:"stage"`
	Progress         int          `json:"progress"`
	Message          string       `json:"message"`
	Error            string       `json:"error,omitempty"`
	Script           string       `json:"script,omitempty"`
	SourceVersion    string       `json:"source_version,omitempty"`
	TargetVersion    string       `json:"target_version,omitempty"`
	InstalledVersion string       `json:"installed_version,omitempty"`
	ConfirmedVersion string       `json:"confirmed_version,omitempty"`
	RollbackResult   string       `json:"rollback_result,omitempty"`
	Check            *CheckResult `json:"check,omitempty"`
	StartedAt        time.Time    `json:"started_at,omitempty"`
	StagedAt         time.Time    `json:"staged_at,omitempty"`
	HelperStartedAt  time.Time    `json:"helper_started_at,omitempty"`
	WaitingAt        time.Time    `json:"waiting_at,omitempty"`
	ApplyingAt       time.Time    `json:"applying_at,omitempty"`
	RestartedAt      time.Time    `json:"restarted_at,omitempty"`
	ConfirmedAt      time.Time    `json:"confirmed_at,omitempty"`
	UpdatedAt        time.Time    `json:"updated_at,omitempty"`
	EndedAt          time.Time    `json:"ended_at,omitempty"`
}

type applyRuntimeDeps struct {
	executable   func() (string, error)
	launchHelper func(helperPath, manifestPath string) error
	scheduleExit func()
}

func defaultApplyRuntime() applyRuntimeDeps {
	return applyRuntimeDeps{
		executable: os.Executable,
		launchHelper: func(helperPath, manifestPath string) error {
			cmd := exec.Command(helperPath, "--update-helper", manifestPath)
			cmd.Dir = filepath.Dir(helperPath)
			detachUpdateProcess(cmd)
			hideChildWindow(cmd)
			if err := cmd.Start(); err != nil {
				return err
			}
			return cmd.Process.Release()
		},
		scheduleExit: func() {
			go func() {
				time.Sleep(500 * time.Millisecond)
				exitProcess(0)
			}()
		},
	}
}

var (
	updateMu            sync.Mutex
	statusPathOverride  string
	exitProcess         = os.Exit
	currentApplyRuntime = defaultApplyRuntime()
)

func statusPath() string {
	if statusPathOverride != "" {
		return statusPathOverride
	}
	exe, err := os.Executable()
	if err == nil && exe != "" {
		return filepath.Join(filepath.Dir(exe), "ga-admin-update-status.json")
	}
	return filepath.Join(os.TempDir(), "ga-admin-update-status.json")
}

func readyUpdatePath() string {
	return statusPath() + ".ready"
}

func writeReadyUpdate(ready readyUpdate) error {
	if _, err := validateReadyUpdate(ready); err != nil {
		return err
	}
	data, err := json.MarshalIndent(ready, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(readyUpdatePath(), data, 0600)
}

func readReadyUpdate() (readyUpdate, UpdateManifest, error) {
	var ready readyUpdate
	data, err := os.ReadFile(readyUpdatePath())
	if err != nil {
		return ready, UpdateManifest{}, fmt.Errorf("read prepared update: %w", err)
	}
	if err := json.Unmarshal(data, &ready); err != nil {
		return ready, UpdateManifest{}, fmt.Errorf("decode prepared update: %w", err)
	}
	manifest, err := validateReadyUpdate(ready)
	if err != nil {
		return ready, UpdateManifest{}, err
	}
	return ready, manifest, nil
}

func validateReadyUpdate(ready readyUpdate) (UpdateManifest, error) {
	if strings.TrimSpace(ready.OperationID) == "" {
		return UpdateManifest{}, errors.New("prepared update has no operation ID")
	}
	if !filepath.IsAbs(ready.HelperPath) || !filepath.IsAbs(ready.ManifestPath) {
		return UpdateManifest{}, errors.New("prepared update paths must be absolute")
	}
	work := filepath.Dir(filepath.Clean(ready.ManifestPath))
	if filepath.Base(filepath.Clean(ready.ManifestPath)) != "update-manifest.json" {
		return UpdateManifest{}, errors.New("prepared update has an unexpected manifest name")
	}
	manifest, err := readUpdateManifest(ready.ManifestPath)
	if err != nil {
		return UpdateManifest{}, err
	}
	if manifest.OperationID != ready.OperationID {
		return UpdateManifest{}, errors.New("prepared update operation does not match its manifest")
	}
	if !sameFilePath(manifest.StatusPath, statusPath()) {
		return UpdateManifest{}, errors.New("prepared update status target does not match this server")
	}
	expectedHelper := filepath.Join(work, "ga-admin-update-helper"+filepath.Ext(manifest.OriginalExe))
	if !sameFilePath(ready.HelperPath, expectedHelper) {
		return UpdateManifest{}, errors.New("prepared update helper path is invalid")
	}
	info, err := os.Stat(ready.HelperPath)
	if err != nil {
		return UpdateManifest{}, fmt.Errorf("inspect prepared update helper: %w", err)
	}
	if !info.Mode().IsRegular() {
		return UpdateManifest{}, errors.New("prepared update helper is not a regular file")
	}
	return manifest, nil
}

func CurrentUpdateStatus() UpdateStatus {
	updateMu.Lock()
	defer updateMu.Unlock()

	var current UpdateStatus
	if err := withStatusFileLock(func() error {
		current = readStatusLocked()
		normalized := normalizeStatusAfterRestart(current)
		if reflect.DeepEqual(normalized, current) {
			return nil
		}
		normalized.UpdatedAt = time.Now()
		if err := writeStatusLocked(normalized); err != nil {
			return err
		}
		current = normalized
		return nil
	}); err != nil {
		// The in-memory normalization is still safer for the API response when
		// the status file cannot be rewritten; the next read will retry it.
		return normalizeStatusAfterRestart(current)
	}
	return current
}

func readStatusLocked() UpdateStatus {
	var st UpdateStatus
	b, err := os.ReadFile(statusPath())
	if err != nil {
		return st
	}
	if err := json.Unmarshal(b, &st); err != nil {
		now := time.Now()
		return UpdateStatus{
			Running:   false,
			Stage:     "error",
			Progress:  100,
			Message:   "读取升级状态失败: " + err.Error(),
			Error:     err.Error(),
			UpdatedAt: now,
			EndedAt:   now,
		}
	}
	return st
}

func normalizeStatusAfterRestart(st UpdateStatus) UpdateStatus {
	current := Current()
	return normalizeStatusForVersion(st, current.Version, current)
}

func normalizeStatusForVersion(st UpdateStatus, actualVersion string, current BuildInfo) UpdateStatus {
	if !concreteVersion(actualVersion) || !statusVersionMatches(st, actualVersion) {
		// Without a concrete matching version, an active operation may still be
		// downloading or waiting for helper confirmation and must remain visible.
		return st
	}

	// Once the helper has handed the update over to the replacement process,
	// the matching version is expected: the transaction still owns the status
	// and must be allowed to confirm or roll back. Reading the status must not
	// turn that live hand-off into a successful manual install.
	if updateTransactionStage(st.Stage) {
		return st
	}

	if st.Check != nil {
		check := *st.Check
		check.Current = current
		if check.Latest != nil {
			check.Update = newer(actualVersion, check.Latest.TagName)
		}
		st.Check = &check
	}

	// The running flag is only a persisted snapshot. If the currently running
	// binary already has the operation's target version, the old process could
	// not have completed this operation, so clear the stale active state.
	// A failed operation remains visible as failed even if the user later
	// updated the binary manually; only its stale version snapshot is fixed.
	if st.Stage == "failed" {
		return st
	}
	st.Running = false
	st.Stage = "done"
	st.Progress = 100
	st.Message = "already up to date"
	st.InstalledVersion = actualVersion
	st.ConfirmedVersion = actualVersion
	if st.ConfirmedAt.IsZero() {
		st.ConfirmedAt = time.Now()
	}
	if st.EndedAt.IsZero() {
		st.EndedAt = st.ConfirmedAt
	}
	return st
}

func updateTransactionStage(stage string) bool {
	switch stage {
	case "ready", "prepared", "starting_helper", "waiting_for_exit", "applying", "starting_replacement", "replacement_ready", "restarting":
		return true
	default:
		return false
	}
}

func statusVersionMatches(st UpdateStatus, actualVersion string) bool {
	for _, candidate := range []string{st.TargetVersion, st.ConfirmedVersion} {
		if sameVersion(candidate, actualVersion) {
			return true
		}
	}
	return st.Check != nil && st.Check.Latest != nil && sameVersion(st.Check.Latest.TagName, actualVersion)
}

func concreteVersion(version string) bool {
	version = strings.TrimSpace(version)
	return version != "" && version != "dev" && version != "unknown"
}

func sameVersion(left, right string) bool {
	left = strings.TrimPrefix(strings.TrimSpace(left), "v")
	right = strings.TrimPrefix(strings.TrimSpace(right), "v")
	return concreteVersion(left) && concreteVersion(right) && left == right
}

var ErrUpdateSuperseded = errors.New("update operation was superseded")

func writeStatus(st UpdateStatus) error {
	updateMu.Lock()
	defer updateMu.Unlock()
	return withStatusFileLock(func() error {
		return writeStatusLocked(st)
	})
}

func writeStatusLocked(st UpdateStatus) error {
	st.UpdatedAt = time.Now()
	if st.ID == "" {
		st.ID = fmt.Sprintf("update-%d", st.UpdatedAt.UnixNano())
	}
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(statusPath(), b, 0600)
}

func reserveUpdate(candidate UpdateStatus) (UpdateStatus, bool, error) {
	updateMu.Lock()
	defer updateMu.Unlock()
	var current UpdateStatus
	created := false
	err := withStatusFileLock(func() error {
		current = readStatusLocked()
		if current.Running {
			return nil
		}
		if candidate.ID == "" {
			candidate.ID = fmt.Sprintf("update-%d-%d", time.Now().UnixNano(), os.Getpid())
		}
		candidate.Running = true
		if err := writeStatusLocked(candidate); err != nil {
			return err
		}
		current = candidate
		created = true
		return nil
	})
	return current, created, err
}

func transitionUpdate(operationID string, change func(*UpdateStatus) error) error {
	updateMu.Lock()
	defer updateMu.Unlock()
	return withStatusFileLock(func() error {
		st := readStatusLocked()
		if operationID == "" || st.ID != operationID {
			return ErrUpdateSuperseded
		}
		if err := change(&st); err != nil {
			return err
		}
		return writeStatusLocked(st)
	})
}

func validateInstallTargets(root, exe, worker string) error {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("resolve install root: %w", err)
	}
	exeName := "ga-admin"
	if runtime.GOOS == "windows" {
		exeName += ".exe"
	}
	validate := func(label, actualPath, expectedPath string) error {
		actual, err := filepath.Abs(actualPath)
		if err != nil {
			return fmt.Errorf("resolve %s: %w", label, err)
		}
		if !sameFilePath(actual, expectedPath) {
			return fmt.Errorf("unsafe %s target %q; expected %q", label, actual, expectedPath)
		}
		return nil
	}
	if err := validate("admin executable", exe, filepath.Join(rootAbs, exeName)); err != nil {
		return err
	}
	if worker != "" {
		if err := validate("chat worker", worker, filepath.Join(rootAbs, "cmd", "chat_worker.py")); err != nil {
			return err
		}
	}
	return nil
}

func sameFilePath(left, right string) bool {
	left = filepath.Clean(left)
	right = filepath.Clean(right)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) (err error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+"-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		if err != nil {
			_ = os.Remove(tmpName)
		}
	}()
	if _, err = tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

func StartApplyLatest() (UpdateStatus, error) {
	now := time.Now()
	st := UpdateStatus{
		ID:            fmt.Sprintf("update-%d-%d", now.UnixNano(), os.Getpid()),
		PID:           os.Getpid(),
		OldPID:        os.Getpid(),
		Running:       true,
		Stage:         "queued",
		Progress:      1,
		Message:       "升级任务已启动",
		SourceVersion: effectiveVersion(),
		StartedAt:     now,
		UpdatedAt:     now,
	}
	reserved, created, err := reserveUpdate(st)
	if err != nil {
		st.Running = false
		st.Stage = "failed"
		st.Progress = 100
		st.Error = err.Error()
		st.Message = "写入升级状态失败: " + err.Error()
		st.EndedAt = time.Now()
		return st, fmt.Errorf("write update status: %w", err)
	}
	if !created {
		return reserved, nil
	}
	st = reserved
	go func(operationID string) {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()
		var progressMu sync.Mutex
		var progressErr error
		setProgressError := func(err error) {
			progressMu.Lock()
			defer progressMu.Unlock()
			if progressErr == nil {
				progressErr = err
				cancel()
			}
		}
		getProgressError := func() error {
			progressMu.Lock()
			defer progressMu.Unlock()
			return progressErr
		}
		res, applyErr := applyLatest(ctx, operationID, func(stage, msg string, progress int, check *CheckResult) {
			if progress < 0 {
				progress = 0
			}
			if progress > 100 {
				progress = 100
			}
			err := transitionUpdate(operationID, func(current *UpdateStatus) error {
				current.Stage, current.Message, current.Progress = stage, msg, progress
				if check != nil {
					current.Check = check
					current.TargetVersion = strings.TrimSpace(check.Latest.TagName)
				}
				return nil
			})
			if err != nil {
				setProgressError(err)
			}
		})
		if err := getProgressError(); err != nil {
			if errors.Is(err, ErrUpdateSuperseded) {
				return
			}
			applyErr = fmt.Errorf("persist update progress: %w", err)
		}
		if applyErr != nil {
			_ = transitionUpdate(operationID, func(current *UpdateStatus) error {
				current.Running = false
				current.Stage = "failed"
				current.Progress = 100
				current.Error = applyErr.Error()
				current.Message = applyErr.Error()
				current.EndedAt = time.Now()
				return nil
			})
			return
		}
		if res.handedOff {
			return
		}
		_ = transitionUpdate(operationID, func(current *UpdateStatus) error {
			current.Script = res.Script
			if res.Message == "already up to date" {
				current.Running = false
				current.Stage = "done"
				current.Progress = 100
				current.Message = res.Message
				current.InstalledVersion = effectiveVersion()
				current.ConfirmedVersion = effectiveVersion()
				current.ConfirmedAt = time.Now()
				current.EndedAt = current.ConfirmedAt
				return nil
			}
			if res.ready {
				current.Stage = "ready"
				current.Progress = 90
				current.Message = res.Message
				if current.StagedAt.IsZero() {
					current.StagedAt = time.Now()
				}
				return nil
			}
			current.Stage = "restarting"
			current.Progress = 95
			current.Message = res.Message
			return nil
		})
	}(st.ID)
	return st, nil
}

// AuthorizeRestart performs the explicit second phase of an update. The
// prepared helper is claimed atomically so concurrent requests cannot launch
// more than one replacement process.
func AuthorizeRestart(operationID string) (UpdateStatus, error) {
	operationID = strings.TrimSpace(operationID)
	if operationID == "" {
		return UpdateStatus{}, errors.New("restart authorization requires an operation ID")
	}
	var st UpdateStatus
	var ready readyUpdate

	updateMu.Lock()
	err := withStatusFileLock(func() error {
		st = readStatusLocked()
		if !st.Running || st.Stage != "ready" || strings.TrimSpace(st.ID) == "" {
			return errors.New("no verified update is waiting for restart authorization")
		}
		if st.ID != operationID {
			return ErrUpdateSuperseded
		}
		var manifest UpdateManifest
		var err error
		ready, manifest, err = readReadyUpdate()
		if err != nil {
			return err
		}
		if ready.OperationID != st.ID || manifest.OperationID != st.ID {
			return errors.New("prepared update does not match the active operation")
		}
		st.Stage = "starting_helper"
		st.Progress = 92
		st.Message = "restart authorized; starting upgrade helper"
		st.Error = ""
		return writeStatusLocked(st)
	})
	updateMu.Unlock()
	if err != nil {
		return st, err
	}

	if err := currentApplyRuntime.launchHelper(ready.HelperPath, ready.ManifestPath); err != nil {
		launchErr := fmt.Errorf("launch update helper: %w", err)
		rollbackErr := transitionUpdate(ready.OperationID, func(current *UpdateStatus) error {
			if current.Stage != "starting_helper" {
				return ErrUpdateSuperseded
			}
			current.Stage = "ready"
			current.Progress = 90
			current.Message = "升级助手启动失败；升级包仍可重试"
			current.Error = launchErr.Error()
			return nil
		})
		if rollbackErr != nil {
			return CurrentUpdateStatus(), errors.Join(launchErr, rollbackErr)
		}
		return CurrentUpdateStatus(), launchErr
	}
	currentApplyRuntime.scheduleExit()
	return CurrentUpdateStatus(), nil
}

func Current() BuildInfo {
	exe, _ := os.Executable()
	supported, reason := updateSupportStatus()
	return BuildInfo{
		Version:                 effectiveVersion(),
		Commit:                  effectiveCommit(),
		Date:                    Date,
		GOOS:                    runtime.GOOS,
		GOARCH:                  runtime.GOARCH,
		Runtime:                 runtime.Version(),
		Exe:                     exe,
		UpdateSupported:         supported,
		UpdateUnsupportedReason: reason,
	}
}

func updateSupportStatus() (bool, string) {
	return updateSupportStatusFor(runtime.GOOS)
}

func updateSupportStatusFor(goos string) (bool, string) {
	switch goos {
	case "windows", "linux", "darwin":
		return true, ""
	default:
		return false, "one-click self update is only implemented for Windows, macOS, and Linux packages"
	}
}

func effectiveVersion() string {
	v := strings.TrimSpace(Version)
	if v != "" && v != "dev" && v != "unknown" {
		return v
	}
	if out, ok := gitOutput("describe", "--tags", "--dirty", "--always"); ok {
		out = strings.TrimSpace(out)
		if out != "" {
			return out
		}
	}
	if v != "" {
		return v
	}
	return "dev"
}

func effectiveCommit() string {
	c := strings.TrimSpace(Commit)
	if c != "" && c != "unknown" {
		return c
	}
	if out, ok := gitOutput("rev-parse", "--short", "HEAD"); ok {
		out = strings.TrimSpace(out)
		if out != "" {
			return out
		}
	}
	if c != "" {
		return c
	}
	return "unknown"
}

func gitOutput(args ...string) (string, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	hideChildWindow(cmd)
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0")
	b, err := cmd.Output()
	if err != nil || ctx.Err() != nil {
		return "", false
	}
	return strings.TrimSpace(string(b)), true
}

func Check(ctx context.Context) (CheckResult, error) {
	cur := Current()
	rel, err := fetchLatest(ctx)
	res := CheckResult{Current: cur, CheckedAt: time.Now()}
	if err != nil {
		res.Message = err.Error()
		return res, err
	}
	res.Latest = rel
	asset, sum := selectAssets(*rel)
	res.Asset, res.Checksum = asset, sum
	res.Update = newer(cur.Version, rel.TagName)
	if asset == nil {
		res.Message = "no asset for current platform"
	}
	return res, nil
}

func ApplyLatest(ctx context.Context) (ApplyResult, error) {
	reserved, created, err := reserveUpdate(UpdateStatus{
		PID:              os.Getpid(),
		OldPID:           os.Getpid(),
		Running:          true,
		Stage:            "checking",
		Progress:         1,
		Message:          "正在检查更新",
		SourceVersion:    effectiveVersion(),
		InstalledVersion: effectiveVersion(),
		StartedAt:        time.Now(),
	})
	if err != nil {
		return ApplyResult{}, err
	}
	if !created {
		return ApplyResult{}, fmt.Errorf("update %s is already running", reserved.ID)
	}
	return applyLatest(ctx, reserved.ID, nil)
}

func applyLatest(ctx context.Context, operationID string, progress func(stage, msg string, pct int, check *CheckResult)) (ApplyResult, error) {
	emit := func(stage, msg string, pct int, check *CheckResult) {
		if progress != nil {
			progress(stage, msg, pct, check)
		}
	}
	emit("checking", "正在检查最新版本", 5, nil)
	check, err := Check(ctx)
	if err != nil {
		return ApplyResult{}, err
	}
	emit("checked", "已检查版本信息", 15, &check)
	if !check.Update {
		return ApplyResult{OK: true, Message: "already up to date"}, nil
	}
	if check.Asset == nil || check.Checksum == nil {
		return ApplyResult{}, errors.New("missing release asset or checksum for current platform")
	}
	supported, reason := updateSupportStatus()
	if !supported {
		return ApplyResult{}, errors.New(reason)
	}
	exe, err := currentApplyRuntime.executable()
	if err != nil {
		return ApplyResult{}, err
	}
	work, err := os.MkdirTemp("", "ga-admin-update-*")
	if err != nil {
		return ApplyResult{}, err
	}
	zipPath := filepath.Join(work, check.Asset.Name)
	sumPath := filepath.Join(work, check.Checksum.Name)
	emit("downloading", "正在下载升级包", 25, &check)
	if err := download(ctx, check.Asset.BrowserDownloadURL, zipPath, maxUpdatePackageBytes); err != nil {
		return ApplyResult{}, err
	}
	emit("downloading_checksum", "正在下载校验文件", 55, &check)
	if err := download(ctx, check.Checksum.BrowserDownloadURL, sumPath, maxUpdateChecksumBytes); err != nil {
		return ApplyResult{}, err
	}
	emit("verifying", "正在校验 SHA256", 65, &check)
	if err := verifySHA256(zipPath, sumPath); err != nil {
		return ApplyResult{}, err
	}
	dir := filepath.Join(work, "unzipped")
	emit("extracting", "正在解压升级包", 75, &check)
	if err := unzip(zipPath, dir); err != nil {
		return ApplyResult{}, err
	}
	emit("preparing", "正在准备替换脚本", 85, &check)
	binName := "ga-admin"
	if runtime.GOOS == "windows" {
		binName = "ga-admin.exe"
	}
	newExe, newWorker, err := updatePayload(dir, check.Asset.Name, binName)
	if err != nil {
		return ApplyResult{}, err
	}
	worker := filepath.Join(filepath.Dir(exe), "cmd", "chat_worker.py")
	workingDir, err := os.Getwd()
	if err != nil || strings.TrimSpace(workingDir) == "" {
		workingDir = filepath.Dir(exe)
	}
	manifest, err := buildUpdateManifest(updateManifestInput{
		OperationID:   operationID,
		SourceVersion: effectiveVersion(),
		TargetVersion: check.Latest.TagName,
		OldPID:        os.Getpid(),
		OriginalExe:   exe,
		StagedExe:     newExe,
		Worker:        worker,
		StagedWorker:  newWorker,
		StatusPath:    statusPath(),
		OriginalArgs:  os.Args[1:],
		WorkingDir:    workingDir,
	})
	if err != nil {
		return ApplyResult{}, fmt.Errorf("build update manifest: %w", err)
	}
	helperPath, manifestPath, err := prepareUpdateHelper(work, exe, manifest)
	if err != nil {
		return ApplyResult{}, err
	}
	if err := writeReadyUpdate(readyUpdate{
		OperationID:  operationID,
		HelperPath:   helperPath,
		ManifestPath: manifestPath,
	}); err != nil {
		return ApplyResult{}, fmt.Errorf("persist prepared update: %w", err)
	}
	emit("ready", "升级包已校验并准备完成，等待用户授权重启", 90, &check)
	return ApplyResult{
		OK:      true,
		Message: "update downloaded and verified; waiting for restart authorization",
		ready:   true,
	}, nil
}

func windowsUpdateScript(oldExe, newExe, backup, worker, newWorker, workerBackup string, oldPID int, launchArgs ...string) string {
	args := ""
	for _, arg := range launchArgs {
		// 对含空格的参数加引号
		if strings.Contains(arg, " ") {
			args += fmt.Sprintf(` "%s"`, arg)
		} else {
			args += " " + arg
		}
	}
	return fmt.Sprintf(`@echo off
setlocal
set "OLD=%s"
set "NEW=%s"
set "BAK=%s"
set "WORKER=%s"
set "NEW_WORKER=%s"
set "WORKER_BAK=%s"
set "OLD_PID=%d"
set "ARGS=%s"

REM Wait for old process to exit
for /L %%%%i in (1,1,30) do (
  tasklist /FI "PID eq %%OLD_PID%%" 2>nul | find "%%OLD_PID%%" >nul
  if errorlevel 1 goto process_gone
  timeout /t 1 /nobreak >nul
)
:process_gone

REM Replace main executable
for /L %%%%i in (1,1,30) do (
  move /Y "%%OLD%%" "%%BAK%%" >nul 2>nul && goto replaced
  timeout /t 1 /nobreak >nul
)
echo failed to replace %%OLD%%
exit /b 1
:replaced
move /Y "%%NEW%%" "%%OLD%%" >nul
if errorlevel 1 (move /Y "%%BAK%%" "%%OLD%%" >nul 2>nul & exit /b 1)

REM Replace worker if present
if not "%%NEW_WORKER%%"=="" (
  for %%%%D in ("%%WORKER%%") do if not exist "%%%%~dpD" mkdir "%%%%~dpD"
  if exist "%%WORKER%%" move /Y "%%WORKER%%" "%%WORKER_BAK%%" >nul 2>nul
  move /Y "%%NEW_WORKER%%" "%%WORKER%%" >nul
  if errorlevel 1 (
    if exist "%%WORKER_BAK%%" move /Y "%%WORKER_BAK%%" "%%WORKER%%" >nul 2>nul
    move /Y "%%OLD%%" "%%NEW%%" >nul 2>nul
    move /Y "%%BAK%%" "%%OLD%%" >nul 2>nul
    exit /b 1
  )
)

REM Start new process with original arguments
start "" "%%OLD%%" %%ARGS%%
`, oldExe, newExe, backup, worker, newWorker, workerBackup, oldPID, args)
}

func linuxUpdateScript(oldExe, newExe, backup, worker, newWorker, workerBackup string) string {
	return fmt.Sprintf(`#!/bin/bash
OLD="%s"
NEW="%s"
BAK="%s"
WORKER="%s"
NEW_WORKER="%s"
WORKER_BAK="%s"
for i in $(seq 1 30); do
  mv "$OLD" "$BAK" 2>/dev/null && break
  sleep 1
done
if [ ! -f "$BAK" ]; then
  echo "failed to replace $OLD"
  exit 1
fi
cp "$NEW" "$OLD"
if [ $? -ne 0 ]; then
  mv "$BAK" "$OLD"
  exit 1
fi
chmod +x "$OLD"
if [ -n "$NEW_WORKER" ]; then
  mkdir -p "$(dirname "$WORKER")" 2>/dev/null
  [ -f "$WORKER" ] && cp "$WORKER" "$WORKER_BAK"
  cp "$NEW_WORKER" "$WORKER"
  if [ $? -ne 0 ]; then
    [ -f "$WORKER_BAK" ] && cp "$WORKER_BAK" "$WORKER"
    cp "$BAK" "$OLD"
    exit 1
  fi
fi
exec "$OLD"
`, oldExe, newExe, backup, worker, newWorker, workerBackup)
}

func unixUpdateCommand(script, oldExe, newExe, backup, worker, newWorker, workerBackup string, oldPID int, restartLog string, launchArgs ...string) *exec.Cmd {
	args := []string{script, oldExe, newExe, backup, worker, newWorker, workerBackup, fmt.Sprint(oldPID), restartLog, "--"}
	args = append(args, launchArgs...)
	return exec.Command("/bin/sh", args...)
}

func unixUpdateScript() string {
	return `#!/bin/sh
OLD=$1
NEW=$2
BAK=$3
WORKER=$4
NEW_WORKER=$5
WORKER_BAK=$6
OLD_PID=$7
RESTART_LOG=$8
shift 8
[ "${1-}" = "--" ] && shift
exec >>"$RESTART_LOG" 2>&1

attempt=0
replaced=0
while [ "$attempt" -lt 30 ]; do
  if mv "$OLD" "$BAK" 2>/dev/null; then
    replaced=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$replaced" -ne 1 ]; then
  echo "failed to replace $OLD"
  exit 1
fi

if ! cp "$NEW" "$OLD"; then
  mv "$BAK" "$OLD"
  exit 1
fi
chmod +x "$OLD"

if [ -n "$NEW_WORKER" ]; then
  mkdir -p "$(dirname "$WORKER")" 2>/dev/null
  [ -f "$WORKER" ] && cp "$WORKER" "$WORKER_BAK"
  if ! cp "$NEW_WORKER" "$WORKER"; then
    [ -f "$WORKER_BAK" ] && cp "$WORKER_BAK" "$WORKER"
    cp "$BAK" "$OLD"
    exit 1
  fi
fi

attempt=0
while kill -0 "$OLD_PID" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "timed out waiting for process $OLD_PID to exit"
    [ -f "$WORKER_BAK" ] && cp "$WORKER_BAK" "$WORKER"
    cp "$BAK" "$OLD"
    exit 1
  fi
  sleep 1
done
exec "$OLD" "$@"
`
}

func fetchLatest(ctx context.Context) (rel *Release, err error) {
	err = retryHTTPRequest(ctx, "fetch latest release", func() error {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, repoLatestURL, nil)
		if err != nil {
			return fmt.Errorf("create github release request: %w", err)
		}
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("User-Agent", "ga-admin-updater")
		resp, err := updateHTTPClient.Do(req)
		if err != nil {
			return err
		}
		defer func() {
			if closeErr := resp.Body.Close(); closeErr != nil && err == nil {
				err = fmt.Errorf("close github release response: %w", closeErr)
			}
		}()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
			return fmt.Errorf("github release check failed: %s %s", resp.Status, strings.TrimSpace(string(b)))
		}
		var out Release
		if resp.ContentLength > maxUpdateMetadataBytes {
			return fmt.Errorf("github release metadata too large: %d bytes exceeds limit %d", resp.ContentLength, maxUpdateMetadataBytes)
		}
		b, err := io.ReadAll(io.LimitReader(resp.Body, maxUpdateMetadataBytes+1))
		if err != nil {
			return err
		}
		if int64(len(b)) > maxUpdateMetadataBytes {
			return fmt.Errorf("github release metadata too large: exceeds limit %d", maxUpdateMetadataBytes)
		}
		if err := json.Unmarshal(b, &out); err != nil {
			return err
		}
		rel = &out
		return nil
	})
	return rel, err
}

func selectAssets(rel Release) (*Asset, *Asset) {
	want := fmt.Sprintf("%s-%s.zip", runtime.GOOS, runtime.GOARCH)
	var zipAsset, sumAsset *Asset
	for i := range rel.Assets {
		a := &rel.Assets[i]
		if strings.HasSuffix(a.Name, want) {
			zipAsset = a
		}
		if strings.HasSuffix(a.Name, want+".sha256") {
			sumAsset = a
		}
	}
	return zipAsset, sumAsset
}

func newer(current, latest string) bool {
	c := strings.TrimPrefix(strings.TrimSpace(current), "v")
	l := strings.TrimPrefix(strings.TrimSpace(latest), "v")
	if c == "" || c == "dev" || c == "unknown" {
		return true
	}
	return compareSemver(l, c) > 0
}

func compareSemver(a, b string) int {
	ap, bp := splitVer(a), splitVer(b)
	for i := 0; i < 3; i++ {
		if ap[i] > bp[i] {
			return 1
		}
		if ap[i] < bp[i] {
			return -1
		}
	}
	return strings.Compare(a, b)
}
func splitVer(s string) [3]int {
	var out [3]int
	parts := strings.Split(strings.Split(s, "-")[0], ".")
	for i := 0; i < len(parts) && i < 3; i++ {
		fmt.Sscanf(parts[i], "%d", &out[i])
	}
	return out
}

func download(ctx context.Context, url, dest string, maxBytes int64) (err error) {
	downloadURL := resolveDownloadURL(url)
	err = retryHTTPRequest(ctx, "download "+downloadURL, func() error {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
		if err != nil {
			return fmt.Errorf("create download request: %w", err)
		}
		resp, err := updateHTTPClient.Do(req)
		if err != nil {
			return err
		}
		defer func() {
			if closeErr := resp.Body.Close(); closeErr != nil && err == nil {
				err = fmt.Errorf("close download response: %w", closeErr)
			}
		}()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("download failed: %s", resp.Status)
		}
		if maxBytes > 0 && resp.ContentLength > maxBytes {
			return fmt.Errorf("download too large: %d bytes exceeds limit %d", resp.ContentLength, maxBytes)
		}
		r := resp.Body
		if maxBytes > 0 {
			r = http.MaxBytesReader(nil, resp.Body, maxBytes)
		}
		if err := writeStreamAtomic(dest, r, 0600); err != nil {
			return fmt.Errorf("write download file: %w", err)
		}
		return nil
	})
	return err
}

func writeStreamAtomic(path string, r io.Reader, perm os.FileMode) (err error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+"-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		if err != nil {
			_ = os.Remove(tmpName)
		}
	}()
	if _, err = io.Copy(tmp, r); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

func verifySHA256(file, sumFile string) error {
	data, err := os.ReadFile(sumFile)
	if err != nil {
		return err
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return errors.New("empty sha256 file")
	}
	want := strings.ToLower(fields[0])
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	got := hex.EncodeToString(h.Sum(nil))
	if got != want {
		return fmt.Errorf("sha256 mismatch: got %s want %s", got, want)
	}
	return nil
}

func unzip(src, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	destClean, err := filepath.Abs(dest)
	if err != nil {
		return err
	}
	destClean = filepath.Clean(destClean)
	for _, f := range r.File {
		if strings.Contains(f.Name, `\\`) {
			return fmt.Errorf("unsafe zip path: %s", f.Name)
		}
		name := filepath.Clean(f.Name)
		if name == "." || filepath.IsAbs(name) || strings.HasPrefix(name, ".."+string(filepath.Separator)) || name == ".." {
			return fmt.Errorf("unsafe zip path: %s", f.Name)
		}
		path := filepath.Join(destClean, name)
		absPath, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		absPath = filepath.Clean(absPath)
		if absPath != destClean && !strings.HasPrefix(absPath, destClean+string(filepath.Separator)) {
			return fmt.Errorf("unsafe zip path: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(absPath, 0755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		writeErr := writeStreamAtomic(absPath, rc, f.Mode())
		rcErr := rc.Close()
		if writeErr != nil {
			return writeErr
		}
		if rcErr != nil {
			_ = os.Remove(absPath)
			return rcErr
		}
	}
	return nil
}

func updatePayload(dir, assetName, binName string) (string, string, error) {
	assetBase := filepath.Base(assetName)
	if assetBase != assetName || !strings.HasSuffix(assetBase, ".zip") {
		return "", "", fmt.Errorf("invalid update asset name %q", assetName)
	}
	rootName := strings.TrimSuffix(assetBase, ".zip")
	if rootName == "" {
		return "", "", fmt.Errorf("invalid update asset name %q", assetName)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", "", fmt.Errorf("read extracted update package: %w", err)
	}
	if len(entries) != 1 || !entries[0].IsDir() || entries[0].Name() != rootName {
		return "", "", fmt.Errorf("update package must contain exactly one top-level directory named %q", rootName)
	}

	root := filepath.Join(dir, rootName)
	payloadRoot := root
	newExe := filepath.Join(payloadRoot, binName)
	if _, err := os.Stat(newExe); errors.Is(err, os.ErrNotExist) && isDarwinUpdateAsset(rootName) {
		payloadRoot = filepath.Join(root, "ga-admin.app", "Contents", "MacOS")
		newExe = filepath.Join(payloadRoot, binName)
	}
	if err := requireRegularFile(newExe, binName); err != nil {
		return "", "", err
	}
	newWorker := filepath.Join(payloadRoot, "cmd", "chat_worker.py")
	if err := requireRegularFile(newWorker, "cmd/chat_worker.py"); err != nil {
		return "", "", err
	}
	return newExe, newWorker, nil
}

func isDarwinUpdateAsset(rootName string) bool {
	return strings.HasSuffix(rootName, "-darwin-amd64") || strings.HasSuffix(rootName, "-darwin-arm64")
}

func requireRegularFile(path, label string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("%s missing from update package: %w", label, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%s in update package is not a regular file", label)
	}
	return nil
}
