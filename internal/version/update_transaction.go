package version

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultExitTimeout    = 45 * time.Second
	defaultConfirmTimeout = 45 * time.Second
	defaultStabilityTime  = 2 * time.Second
)

// UpdateManifest is the durable hand-off between the running server and its
// copied updater helper. Paths are immutable once the helper is launched.
type UpdateManifest struct {
	OperationID    string                `json:"operation_id"`
	SourceVersion  string                `json:"source_version"`
	TargetVersion  string                `json:"target_version"`
	OldPID         int                   `json:"old_pid"`
	OriginalExe    string                `json:"original_exe"`
	StagedExe      string                `json:"staged_exe"`
	BackupExe      string                `json:"backup_exe"`
	Worker         string                `json:"worker,omitempty"`
	StagedWorker   string                `json:"staged_worker,omitempty"`
	WorkerBackup   string                `json:"worker_backup,omitempty"`
	StatusPath     string                `json:"status_path"`
	OriginalArgs   []string              `json:"original_args,omitempty"`
	WorkingDir     string                `json:"working_dir"`
	ExitTimeout    time.Duration         `json:"exit_timeout"`
	ConfirmTimeout time.Duration         `json:"confirm_timeout"`
	StabilityTime  time.Duration         `json:"stability_time"`
	Systemd        *SystemdUpdateService `json:"systemd,omitempty"`
	CreatedAt      time.Time             `json:"created_at"`
}

type transactionDeps struct {
	waitPIDExit   func(int, time.Duration) error
	installFile   func(string, string, os.FileMode) error
	launch        func(UpdateManifest, bool) (*exec.Cmd, <-chan error, error)
	stopChild     func(*exec.Cmd, <-chan error)
	serviceAction func(UpdateManifest, string) error
	servicePID    func(UpdateManifest) (int, error)
	waitHandoff   func(UpdateManifest) error
	sleep         func(time.Duration)
}

func defaultTransactionDeps() transactionDeps {
	return transactionDeps{
		waitPIDExit:   waitForPIDExit,
		installFile:   copyFileAtomic,
		launch:        launchManifestProcess,
		stopChild:     stopOwnedChild,
		serviceAction: controlUpdateService,
		servicePID:    updateServicePID,
		waitHandoff:   waitForHelperHandoff,
		sleep:         time.Sleep,
	}
}

type updateManifestInput struct {
	OperationID   string
	SourceVersion string
	TargetVersion string
	OldPID        int
	OriginalExe   string
	StagedExe     string
	Worker        string
	StagedWorker  string
	StatusPath    string
	OriginalArgs  []string
	WorkingDir    string
	Systemd       *SystemdUpdateService
}

func buildUpdateManifest(input updateManifestInput) (UpdateManifest, error) {
	operationID := strings.TrimSpace(input.OperationID)
	backupSuffix := "." + operationID + ".bak"
	manifest := UpdateManifest{
		OperationID:    operationID,
		SourceVersion:  strings.TrimSpace(input.SourceVersion),
		TargetVersion:  strings.TrimSpace(input.TargetVersion),
		OldPID:         input.OldPID,
		OriginalExe:    filepath.Clean(input.OriginalExe),
		StagedExe:      filepath.Clean(input.StagedExe),
		BackupExe:      filepath.Clean(input.OriginalExe) + backupSuffix,
		Worker:         cleanOptionalPath(input.Worker),
		StagedWorker:   cleanOptionalPath(input.StagedWorker),
		StatusPath:     filepath.Clean(input.StatusPath),
		OriginalArgs:   sanitizeUpdateArgs(input.OriginalArgs),
		WorkingDir:     filepath.Clean(input.WorkingDir),
		ExitTimeout:    defaultExitTimeout,
		ConfirmTimeout: defaultConfirmTimeout,
		StabilityTime:  defaultStabilityTime,
		Systemd:        input.Systemd,
		CreatedAt:      time.Now(),
	}
	if manifest.Worker != "" {
		manifest.WorkerBackup = manifest.Worker + backupSuffix
	}
	if err := validateUpdateManifest(manifest); err != nil {
		return UpdateManifest{}, err
	}
	return manifest, nil
}

func cleanOptionalPath(path string) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	return filepath.Clean(path)
}

func sanitizeUpdateArgs(args []string) []string {
	cleaned := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--update-confirm" || arg == "--update-helper" {
			if i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
				i++
			}
			continue
		}
		if strings.HasPrefix(arg, "--update-confirm=") || strings.HasPrefix(arg, "--update-helper=") {
			continue
		}
		cleaned = append(cleaned, arg)
	}
	return cleaned
}

func prepareUpdateHelper(work, runningExe string, manifest UpdateManifest) (helperPath, manifestPath string, err error) {
	if err := os.MkdirAll(work, 0700); err != nil {
		return "", "", fmt.Errorf("create update work directory: %w", err)
	}
	ext := filepath.Ext(runningExe)
	helperPath = filepath.Join(work, "ga-admin-update-helper"+ext)
	if err := copyFileAtomic(runningExe, helperPath, 0755); err != nil {
		return "", "", fmt.Errorf("copy update helper: %w", err)
	}
	manifestPath = filepath.Join(work, "update-manifest.json")
	if err := writeUpdateManifest(manifestPath, manifest); err != nil {
		_ = os.Remove(helperPath)
		return "", "", fmt.Errorf("write update manifest: %w", err)
	}
	return helperPath, manifestPath, nil
}

func writeUpdateManifest(path string, manifest UpdateManifest) error {
	if err := validateUpdateManifest(manifest); err != nil {
		return err
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(path, data, 0600)
}

func readUpdateManifest(path string) (UpdateManifest, error) {
	var manifest UpdateManifest
	data, err := os.ReadFile(path)
	if err != nil {
		return manifest, fmt.Errorf("read update manifest: %w", err)
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return manifest, fmt.Errorf("decode update manifest: %w", err)
	}
	if err := validateUpdateManifest(manifest); err != nil {
		return manifest, err
	}
	return manifest, nil
}

func validateUpdateManifest(manifest UpdateManifest) error {
	if strings.TrimSpace(manifest.OperationID) == "" {
		return errors.New("update manifest has no operation ID")
	}
	for label, value := range map[string]string{
		"target version":      manifest.TargetVersion,
		"original executable": manifest.OriginalExe,
		"staged executable":   manifest.StagedExe,
		"executable backup":   manifest.BackupExe,
		"status path":         manifest.StatusPath,
		"working directory":   manifest.WorkingDir,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("update manifest has no %s", label)
		}
	}
	root := filepath.Dir(filepath.Clean(manifest.OriginalExe))
	if err := validateInstallTargets(root, manifest.OriginalExe, manifest.Worker); err != nil {
		return err
	}
	if manifest.Worker != "" && (manifest.StagedWorker == "" || manifest.WorkerBackup == "") {
		return errors.New("update manifest has incomplete worker paths")
	}
	if manifest.BackupExe == manifest.OriginalExe || (manifest.Worker != "" && manifest.WorkerBackup == manifest.Worker) {
		return errors.New("update backup path aliases an install target")
	}
	if manifest.Systemd != nil && !validServiceUnit(manifest.Systemd.Unit) {
		return errors.New("update manifest has an invalid systemd service unit")
	}
	return nil
}

// RunUpdateHelper executes a manifest transaction and is called before normal
// application initialization when --update-helper is present.
func RunUpdateHelper(manifestPath string) error {
	manifest, err := readUpdateManifest(manifestPath)
	if err != nil {
		return err
	}
	oldStatusPath := statusPathOverride
	statusPathOverride = manifest.StatusPath
	defer func() { statusPathOverride = oldStatusPath }()
	return runReplacementTransaction(manifest, defaultTransactionDeps())
}

func runReplacementTransaction(manifest UpdateManifest, deps transactionDeps) error {
	if err := validateUpdateManifest(manifest); err != nil {
		return err
	}
	if manifest.ExitTimeout <= 0 {
		manifest.ExitTimeout = defaultExitTimeout
	}
	if manifest.ConfirmTimeout <= 0 {
		manifest.ConfirmTimeout = defaultConfirmTimeout
	}
	if manifest.StabilityTime <= 0 {
		manifest.StabilityTime = defaultStabilityTime
	}
	if deps.waitHandoff == nil {
		deps.waitHandoff = waitForHelperHandoff
	}
	if err := transitionUpdate(manifest.OperationID, func(st *UpdateStatus) error {
		if !st.Running || st.Stage != "starting_helper" || st.HelperPID != 0 {
			return ErrUpdateSuperseded
		}
		now := time.Now()
		st.Stage = "waiting_for_exit"
		st.Progress = 88
		st.Message = "upgrade helper is ready; waiting for the original process handoff"
		st.HelperPID = os.Getpid()
		st.HelperStartedAt = now
		st.WaitingAt = now
		st.HelperHeartbeatAt = now
		return nil
	}); err != nil {
		return err
	}
	stopHeartbeat := startHelperHeartbeat(manifest.OperationID)
	defer stopHeartbeat()
	if err := deps.waitHandoff(manifest); err != nil {
		return failUnstartedHandoff(manifest, err)
	}
	if manifest.Systemd != nil {
		if err := deps.serviceAction(manifest, "stop"); err != nil {
			return failAfterRollbackAndRestart(manifest, deps, nil, fmt.Errorf("stop original service: %w", err))
		}
	}
	if manifest.OldPID > 0 {
		if err := deps.waitPIDExit(manifest.OldPID, manifest.ExitTimeout); err != nil {
			cause := fmt.Errorf("old process did not exit: %w", err)
			if manifest.Systemd != nil {
				return failAfterRollbackAndRestart(manifest, deps, nil, cause)
			}
			return failUpdateTransaction(manifest.OperationID, cause, "not_started")
		}
	}
	if err := transitionUpdate(manifest.OperationID, func(st *UpdateStatus) error {
		st.Stage = "applying"
		st.Progress = 91
		st.Message = "installing the verified update"
		return nil
	}); err != nil {
		return failAfterRollbackAndRestart(manifest, deps, nil, err)
	}

	changed, err := replaceManifestFiles(manifest, deps.installFile)
	if err != nil {
		return failAfterRollbackAndRestart(manifest, deps, changed, err)
	}
	if err := transitionUpdate(manifest.OperationID, func(st *UpdateStatus) error {
		st.Stage = "starting_replacement"
		st.Progress = 96
		st.Message = "waiting for the replacement service to become ready"
		st.NewPID = 0
		return nil
	}); err != nil {
		return failAfterRollbackAndRestart(manifest, deps, changed, err)
	}
	var cmd *exec.Cmd
	var exited <-chan error
	var newPID int
	if manifest.Systemd != nil {
		err = deps.serviceAction(manifest, "start")
		if err == nil {
			newPID, err = deps.servicePID(manifest)
		}
	} else {
		cmd, exited, err = deps.launch(manifest, true)
		if err == nil {
			newPID = cmd.Process.Pid
		}
	}
	if err != nil {
		return failAfterRollbackAndRestart(manifest, deps, changed, fmt.Errorf("launch replacement: %w", err))
	}
	stopNewProcess := func() {
		if manifest.Systemd == nil {
			deps.stopChild(cmd, exited)
		}
	}
	if err := transitionUpdate(manifest.OperationID, func(st *UpdateStatus) error {
		switch st.Stage {
		case "starting_replacement":
			st.NewPID = newPID
		case "replacement_ready":
			if st.NewPID != newPID {
				return fmt.Errorf("replacement confirmation came from unexpected PID %d; launched %d", st.NewPID, newPID)
			}
		default:
			return fmt.Errorf("replacement entered unexpected stage %q after launch", st.Stage)
		}
		return nil
	}); err != nil {
		stopNewProcess()
		return failAfterRollbackAndRestart(manifest, deps, changed, err)
	}
	if manifest.Systemd != nil {
		err = waitForServiceReplacementConfirmation(manifest, newPID, deps)
	} else {
		err = waitForReplacementConfirmation(manifest, exited, deps.sleep)
	}
	if err != nil {
		stopNewProcess()
		return failAfterRollbackAndRestart(manifest, deps, changed, err)
	}
	if err := transitionUpdate(manifest.OperationID, func(st *UpdateStatus) error {
		if st.Stage != "replacement_ready" || st.ConfirmedVersion != manifest.TargetVersion || st.NewPID != newPID {
			return errors.New("replacement confirmation changed before commit")
		}
		now := time.Now()
		st.Running = false
		st.Stage = "done"
		st.Progress = 100
		st.Message = "upgrade completed and replacement service is stable"
		st.InstalledVersion = manifest.TargetVersion
		st.EndedAt = now
		return nil
	}); err != nil {
		stopNewProcess()
		return failAfterRollbackAndRestart(manifest, deps, changed, err)
	}
	_ = os.Remove(manifest.BackupExe)
	if manifest.WorkerBackup != "" {
		_ = os.Remove(manifest.WorkerBackup)
	}
	return nil
}

func replaceManifestFiles(manifest UpdateManifest, install func(string, string, os.FileMode) error) ([]string, error) {
	var changed []string
	if err := backupTarget(manifest.OriginalExe, manifest.BackupExe); err != nil {
		return changed, fmt.Errorf("back up executable: %w", err)
	}
	changed = append(changed, "exe")
	if err := install(manifest.StagedExe, manifest.OriginalExe, 0755); err != nil {
		return changed, fmt.Errorf("install executable: %w", err)
	}
	if manifest.Worker == "" {
		return changed, nil
	}
	if err := backupTarget(manifest.Worker, manifest.WorkerBackup); err != nil {
		return changed, fmt.Errorf("back up worker: %w", err)
	}
	changed = append(changed, "worker")
	if err := install(manifest.StagedWorker, manifest.Worker, 0644); err != nil {
		return changed, fmt.Errorf("install worker: %w", err)
	}
	return changed, nil
}

func backupTarget(target, backup string) error {
	if _, err := os.Stat(backup); err == nil {
		return fmt.Errorf("backup already exists: %s", backup)
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(backup), 0755); err != nil {
		return err
	}
	return os.Rename(target, backup)
}

func restoreManifestFiles(manifest UpdateManifest, changed []string) error {
	var errs []error
	for i := len(changed) - 1; i >= 0; i-- {
		switch changed[i] {
		case "worker":
			if err := restoreBackup(manifest.WorkerBackup, manifest.Worker); err != nil {
				errs = append(errs, fmt.Errorf("restore worker: %w", err))
			}
		case "exe":
			if err := restoreBackup(manifest.BackupExe, manifest.OriginalExe); err != nil {
				errs = append(errs, fmt.Errorf("restore executable: %w", err))
			}
		}
	}
	return errors.Join(errs...)
}

func restoreBackup(backup, target string) error {
	if backup == "" {
		return nil
	}
	if _, err := os.Stat(backup); err != nil {
		return err
	}
	if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(backup, target)
}

func failAfterRollbackAndRestart(manifest UpdateManifest, deps transactionDeps, changed []string, cause error) error {
	// Disable listener-ready confirmation before stopping a replacement that
	// may still be starting (or being restarted by its service manager).
	if err := transitionUpdate(manifest.OperationID, func(st *UpdateStatus) error {
		st.Stage = "rolling_back"
		st.Message = "update failed; restoring the original service"
		return nil
	}); err != nil {
		cause = errors.Join(cause, fmt.Errorf("persist rollback stage: %w", err))
	}
	if manifest.Systemd != nil {
		if err := deps.serviceAction(manifest, "stop"); err != nil {
			// Never restore an executable under a running service. Keep its
			// operation-scoped backups intact for manual recovery.
			return failUpdateTransaction(manifest.OperationID,
				errors.Join(cause, fmt.Errorf("stop service before rollback: %w", err)),
				"stop_failed: "+err.Error())
		}
	}
	rollbackErr := restoreManifestFiles(manifest, changed)
	if rollbackErr != nil {
		return failAfterRollback(manifest.OperationID, cause, rollbackErr)
	}
	var restartErr error
	if manifest.Systemd != nil {
		restartErr = deps.serviceAction(manifest, "start")
	} else {
		_, _, restartErr = deps.launch(manifest, false)
	}
	if restartErr != nil {
		cause = errors.Join(cause, fmt.Errorf("restart original service: %w", restartErr))
		return failUpdateTransaction(manifest.OperationID, cause, "restart_failed: "+restartErr.Error())
	}
	return failAfterRollback(manifest.OperationID, cause, nil)
}

func failAfterRollback(operationID string, cause, rollbackErr error) error {
	result := "restored"
	if rollbackErr != nil {
		result = "restore_failed: " + rollbackErr.Error()
		cause = errors.Join(cause, rollbackErr)
	}
	return failUpdateTransaction(operationID, cause, result)
}

func failUpdateTransaction(operationID string, cause error, rollbackResult string) error {
	persistErr := transitionUpdate(operationID, func(st *UpdateStatus) error {
		now := time.Now()
		st.Running = false
		st.Stage = "failed"
		st.Progress = 100
		st.Error = cause.Error()
		st.Message = cause.Error()
		st.RollbackResult = rollbackResult
		st.EndedAt = now
		return nil
	})
	if persistErr != nil {
		return errors.Join(cause, fmt.Errorf("persist terminal update failure: %w", persistErr))
	}
	return cause
}

// ConfirmUpdateReady is called only after the replacement process has bound
// its listener. It is operation- and version-scoped and does not mark done;
// the helper owns the bounded stability check and final commit.
func ConfirmUpdateReady(operationID string) error {
	operationID = strings.TrimSpace(operationID)
	if operationID == "" {
		return nil
	}
	actual := effectiveVersion()
	var confirmationErr error
	err := transitionUpdate(operationID, func(st *UpdateStatus) error {
		if st.Stage != "starting_replacement" {
			return fmt.Errorf("replacement confirmation is invalid during stage %q", st.Stage)
		}
		if st.TargetVersion != actual {
			now := time.Now()
			confirmationErr = fmt.Errorf("replacement version mismatch: expected %s, got %s", st.TargetVersion, actual)
			st.Running = false
			st.Stage = "failed"
			st.Progress = 100
			st.Error = confirmationErr.Error()
			st.Message = confirmationErr.Error()
			st.EndedAt = now
			return nil
		}
		st.Stage = "replacement_ready"
		st.Progress = 98
		st.Message = "replacement listener is ready; verifying stability"
		st.NewPID = os.Getpid()
		st.ConfirmedVersion = actual
		st.ConfirmedAt = time.Now()
		return nil
	})
	if err != nil {
		return err
	}
	return confirmationErr
}

func waitForReplacementConfirmation(manifest UpdateManifest, exited <-chan error, sleep func(time.Duration)) error {
	deadline := time.Now().Add(manifest.ConfirmTimeout)
	for time.Now().Before(deadline) {
		select {
		case err := <-exited:
			if err == nil {
				err = errors.New("replacement exited")
			}
			return fmt.Errorf("replacement exited before confirmation: %w", err)
		default:
		}
		st := CurrentUpdateStatus()
		if st.ID != manifest.OperationID {
			return ErrUpdateSuperseded
		}
		if st.Stage == "failed" {
			return errors.New(st.Error)
		}
		if st.Stage == "replacement_ready" && st.ConfirmedVersion == manifest.TargetVersion {
			stabilityDeadline := time.Now().Add(manifest.StabilityTime)
			for time.Now().Before(stabilityDeadline) {
				select {
				case err := <-exited:
					if err == nil {
						err = errors.New("replacement exited")
					}
					return fmt.Errorf("replacement exited during stability window: %w", err)
				default:
					sleep(50 * time.Millisecond)
				}
			}
			return nil
		}
		sleep(50 * time.Millisecond)
	}
	return errors.New("replacement startup confirmation timed out")
}

func launchManifestProcess(manifest UpdateManifest, confirmation bool) (*exec.Cmd, <-chan error, error) {
	args := append([]string(nil), manifest.OriginalArgs...)
	if confirmation {
		args = append(args, "--update-confirm", manifest.OperationID)
	}
	cmd := exec.Command(manifest.OriginalExe, args...)
	cmd.Dir = manifest.WorkingDir
	hideChildWindow(cmd)
	if err := cmd.Start(); err != nil {
		return nil, nil, err
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	return cmd, exited, nil
}

func stopOwnedChild(cmd *exec.Cmd, exited <-chan error) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
	select {
	case <-exited:
	case <-time.After(5 * time.Second):
	}
}

func copyFileAtomic(src, dest string, perm os.FileMode) error {
	input, err := os.Open(src)
	if err != nil {
		return err
	}
	defer input.Close()
	return writeStreamAtomic(dest, io.LimitReader(input, maxUpdatePackageBytes), perm)
}
