package version

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestResolveDownloadURLWithGitHubMirror(t *testing.T) {
	SetGitHubMirror("https://mirror.example/base/")
	t.Cleanup(func() { SetGitHubMirror("") })

	const githubURL = "https://github.com/owner/repo/releases/download/v1/app.zip"
	if got, want := resolveDownloadURL(githubURL), "https://mirror.example/base/"+githubURL; got != want {
		t.Fatalf("resolveDownloadURL() = %q, want %q", got, want)
	}
	const externalURL = "https://objects.example/app.zip"
	if got := resolveDownloadURL(externalURL); got != externalURL {
		t.Fatalf("non-GitHub URL was rewritten: %q", got)
	}
}

func TestResolveDownloadURLWithoutMirror(t *testing.T) {
	SetGitHubMirror("")
	const rawURL = "https://github.com/owner/repo/releases/download/v1/app.zip"
	if got := resolveDownloadURL(rawURL); got != rawURL {
		t.Fatalf("resolveDownloadURL() = %q, want original URL", got)
	}
}

func TestNewer(t *testing.T) {
	cases := []struct {
		current string
		latest  string
		want    bool
	}{
		{"dev", "v0.0.7", true},
		{"unknown", "v0.0.7", true},
		{"0.0.6", "v0.0.7", true},
		{"0.0.7", "v0.0.7", false},
		{"0.0.8", "v0.0.7", false},
		{"0.0.10", "v0.0.9", false},
		{"0.1.0", "v0.0.9", false},
	}
	for _, c := range cases {
		if got := newer(c.current, c.latest); got != c.want {
			t.Fatalf("newer(%q,%q)=%v want %v", c.current, c.latest, got, c.want)
		}
	}
}

func TestSelectAssets(t *testing.T) {
	want := fmt.Sprintf("ga-admin-v1.2.3-%s-%s.zip", runtime.GOOS, runtime.GOARCH)
	rel := Release{Assets: []Asset{
		{Name: "other.zip"},
		{Name: strings.TrimSuffix(want, ".zip") + "-app.zip"},
		{Name: strings.TrimSuffix(want, ".zip") + "-app.zip.sha256"},
		{Name: want},
		{Name: want + ".sha256"},
	}}
	asset, sum := selectAssets(rel)
	if asset == nil || asset.Name != want {
		t.Fatalf("asset=%#v want %s", asset, want)
	}
	if sum == nil || sum.Name != want+".sha256" {
		t.Fatalf("sum=%#v want %s.sha256", sum, want)
	}
}

func TestSelectAssetsRequiresExactPlatformSuffix(t *testing.T) {
	wantSuffix := fmt.Sprintf("%s-%s.zip", runtime.GOOS, runtime.GOARCH)
	rel := Release{Assets: []Asset{
		{Name: "ga-admin-linux-amd64.zip"},
		{Name: "ga-admin-linux-amd64.zip.sha256"},
		{Name: "ga-admin-" + wantSuffix + ".sha256"},
	}}
	asset, sum := selectAssets(rel)
	if asset != nil {
		t.Fatalf("asset=%#v want nil when platform zip is absent", asset)
	}
	if sum == nil || sum.Name != "ga-admin-"+wantSuffix+".sha256" {
		t.Fatalf("sum=%#v want platform checksum without accepting a checksum as zip", sum)
	}
}

func TestEffectiveVersionFallsBackToGit(t *testing.T) {
	oldVersion := Version
	defer func() { Version = oldVersion }()
	Version = "dev"
	got := effectiveVersion()
	if got == "" || got == "unknown" {
		t.Fatalf("effectiveVersion()=%q, want non-empty fallback or dev", got)
	}
}

func TestCurrentUsesInjectedVersion(t *testing.T) {
	oldVersion, oldCommit := Version, Commit
	defer func() { Version, Commit = oldVersion, oldCommit }()
	Version = "1.2.3"
	Commit = "abc1234"
	cur := Current()
	if cur.Version != "1.2.3" || cur.Commit != "abc1234" {
		t.Fatalf("Current()=%#v, want injected version/commit", cur)
	}
	if cur.Runtime == "" || cur.GOOS == "" || cur.GOARCH == "" {
		t.Fatalf("Current()=%#v, want runtime/platform diagnostics", cur)
	}
}

func TestVerifySHA256(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "app.zip")
	if err := os.WriteFile(file, []byte("payload"), 0600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte("payload"))
	sumFile := filepath.Join(dir, "app.zip.sha256")
	if err := os.WriteFile(sumFile, []byte(fmt.Sprintf("%x  app.zip\n", sum)), 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifySHA256(file, sumFile); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sumFile, []byte("deadbeef app.zip\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifySHA256(file, sumFile); err == nil {
		t.Fatal("expected mismatch")
	}
}

func TestWindowsUpdateScriptQuotesVariablesSafely(t *testing.T) {
	script := windowsUpdateScript(
		`C:\Program Files\GA Admin\ga-admin.exe`,
		`C:\Temp\new ga-admin.exe`,
		`C:\Program Files\GA Admin\ga-admin.exe.bak`,
		`C:\Program Files\GA Admin\cmd\chat_worker.py`,
		`C:\Temp\cmd\chat_worker.py`,
		`C:\Program Files\GA Admin\cmd\chat_worker.py.bak`,
		0,
	)
	want := []string{
		`set "OLD=C:\Program Files\GA Admin\ga-admin.exe"`,
		`set "NEW=C:\Temp\new ga-admin.exe"`,
		`set "BAK=C:\Program Files\GA Admin\ga-admin.exe.bak"`,
		`set "WORKER=C:\Program Files\GA Admin\cmd\chat_worker.py"`,
		`set "NEW_WORKER=C:\Temp\cmd\chat_worker.py"`,
		`set "WORKER_BAK=C:\Program Files\GA Admin\cmd\chat_worker.py.bak"`,
		`move /Y "%OLD%" "%BAK%"`,
		`move /Y "%NEW%" "%OLD%"`,
		`move /Y "%NEW_WORKER%" "%WORKER%"`,
	}
	for _, w := range want {
		if !strings.Contains(script, w) {
			t.Fatalf("script missing %q in:\n%s", w, script)
		}
	}
	bad := []string{`set OLD=`, `set NEW=`, `set BAK=`, `set WORKER=`, `""C:\`, `%~dpWORKER%`}
	for _, b := range bad {
		if strings.Contains(script, b) {
			t.Fatalf("script contains unsafe quoting %q in:\n%s", b, script)
		}
	}
}

func TestWindowsUpdateScriptRestoresExeWhenWorkerMoveFails(t *testing.T) {
	script := windowsUpdateScript("old.exe", "new.exe", "old.exe.bak", "cmd/chat_worker.py", "tmp/chat_worker.py", "cmd/chat_worker.py.bak", 0)
	want := []string{
		`for %%D in ("%WORKER%") do if not exist "%%~dpD" mkdir "%%~dpD"`,
		`if exist "%WORKER%" move /Y "%WORKER%" "%WORKER_BAK%"`,
		`if exist "%WORKER_BAK%" move /Y "%WORKER_BAK%" "%WORKER%"`,
		`move /Y "%OLD%" "%NEW%"`,
		`move /Y "%BAK%" "%OLD%"`,
	}
	for _, sub := range want {
		if !strings.Contains(script, sub) {
			t.Fatalf("script missing rollback step %q in:\n%s", sub, script)
		}
	}
}

func TestReleaseAssetContract(t *testing.T) {
	want := fmt.Sprintf("ga-admin-v2.0.0-%s-%s.zip", runtime.GOOS, runtime.GOARCH)
	rel := Release{Assets: []Asset{
		{Name: "ga-admin-v2.0.0-linux-amd64.zip"},
		{Name: want + ".sha256"},
		{Name: want},
	}}
	asset, checksum := selectAssets(rel)
	if asset == nil || asset.Name != want {
		t.Fatalf("zip asset=%#v want %q", asset, want)
	}
	if checksum == nil || checksum.Name != want+".sha256" {
		t.Fatalf("checksum asset=%#v want %q", checksum, want+".sha256")
	}
}

func TestCurrentIncludesBuildDate(t *testing.T) {
	oldVersion, oldCommit, oldDate := Version, Commit, Date
	defer func() { Version, Commit, Date = oldVersion, oldCommit, oldDate }()
	Version = "v9.9.9"
	Commit = "deadbee"
	Date = "2026-05-31T12:00:00Z"
	cur := Current()
	if cur.Version != Version || cur.Commit != Commit || cur.Date != Date {
		t.Fatalf("Current()=%#v, want injected version/commit/date", cur)
	}
}

func TestCurrentReportsUpdateSupportStatus(t *testing.T) {
	cur := Current()
	if runtime.GOOS == "windows" {
		if !cur.UpdateSupported || cur.UpdateUnsupportedReason != "" {
			t.Fatalf("Current()=%#v, want Windows update support", cur)
		}
		return
	}
	if cur.UpdateSupported || cur.UpdateUnsupportedReason == "" {
		t.Fatalf("Current()=%#v, want explicit non-Windows unsupported reason", cur)
	}
}

func TestBuildBatReleaseMetadataContract(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	batPath := filepath.Join(root, "build.bat")
	data, err := os.ReadFile(batPath)
	if err != nil {
		t.Fatalf("read build.bat: %v", err)
	}
	script := string(data)
	want := []string{
		`git describe --tags --dirty --always`,
		`git rev-parse --short HEAD`,
		`Get-Date`,
		`-X genericagent-admin-go/internal/version.Version=%GA_VERSION%`,
		`-X genericagent-admin-go/internal/version.Commit=%GA_COMMIT%`,
		`-X genericagent-admin-go/internal/version.Date=%GA_DATE%`,
		`go build -ldflags="%GA_LDFLAGS%" -o dist\ga-admin.exe .`,
		`copy /Y cmd\chat_worker.py dist\cmd\chat_worker.py`,
	}
	for _, w := range want {
		if !strings.Contains(script, w) {
			t.Fatalf("build.bat missing %q in:\n%s", w, script)
		}
	}
	bad := []string{
		`GenericAgent-Admin-Go/internal/version`,
		`release\`,
		`gh release`,
	}
	for _, b := range bad {
		if strings.Contains(script, b) {
			t.Fatalf("build.bat contains forbidden release/build metadata pattern %q in:\n%s", b, script)
		}
	}
}

func TestUnzipRejectsUnsafePaths(t *testing.T) {
	for _, tc := range []struct {
		name      string
		entryName string
	}{
		{name: "parent", entryName: "../escape.txt"},
		{name: "windows-separator", entryName: `..\\escape.txt`},
		{name: "nested-windows-separator", entryName: `nested\\app.txt`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			zipPath := filepath.Join(dir, "unsafe.zip")
			f, err := os.Create(zipPath)
			if err != nil {
				t.Fatal(err)
			}
			zw := zip.NewWriter(f)
			if w, err := zw.Create(tc.entryName); err != nil {
				t.Fatal(err)
			} else if _, err := w.Write([]byte("escape")); err != nil {
				t.Fatal(err)
			}
			if err := zw.Close(); err != nil {
				t.Fatal(err)
			}
			if err := f.Close(); err != nil {
				t.Fatal(err)
			}

			dest := filepath.Join(dir, "dest")
			if err := unzip(zipPath, dest); err == nil || !strings.Contains(err.Error(), "unsafe zip path") {
				t.Fatalf("unzip unsafe path error = %v, want unsafe zip path", err)
			}
			if _, err := os.Stat(filepath.Join(dir, "escape.txt")); !os.IsNotExist(err) {
				t.Fatalf("unsafe zip created escape file, stat err=%v", err)
			}
			if _, err := os.Stat(filepath.Join(dest, `nested\\app.txt`)); !os.IsNotExist(err) {
				t.Fatalf("unsafe zip created backslash-named file, stat err=%v", err)
			}
		})
	}
}

func TestUnzipRemovesFileOnEntryReadError(t *testing.T) {
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "corrupt.zip")
	f, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	hdr := &zip.FileHeader{Name: "bad.txt", Method: zip.Store}
	if w, err := zw.CreateHeader(hdr); err != nil {
		t.Fatal(err)
	} else if _, err := w.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	idx := strings.Index(string(data), "hello")
	if idx < 0 {
		t.Fatal("zip payload not found")
	}
	data[idx] = 'H'
	if err := os.WriteFile(zipPath, data, 0600); err != nil {
		t.Fatal(err)
	}

	dest := filepath.Join(dir, "dest")
	err = unzip(zipPath, dest)
	if err == nil {
		t.Fatal("unzip corrupt entry error = nil")
	}
	if _, statErr := os.Stat(filepath.Join(dest, "bad.txt")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("corrupt extracted file should be removed, stat err=%v", statErr)
	}
	matches, globErr := filepath.Glob(filepath.Join(dest, ".bad.txt-*.tmp"))
	if globErr != nil {
		t.Fatalf("glob temp files: %v", globErr)
	}
	if len(matches) != 0 {
		t.Fatalf("corrupt extracted temp files should be removed: %v", matches)
	}
}

func TestUnzipExtractsRegularFile(t *testing.T) {
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "safe.zip")
	f, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	if w, err := zw.Create("nested/app.txt"); err != nil {
		t.Fatal(err)
	} else if _, err := w.Write([]byte("ok")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	dest := filepath.Join(dir, "dest")
	if err := unzip(zipPath, dest); err != nil {
		t.Fatalf("unzip safe file: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(dest, "nested", "app.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "ok" {
		t.Fatalf("extracted content = %q", got)
	}
}

func TestUpdatePayloadUsesReleaseTopLevelDirectory(t *testing.T) {
	assetName := "ga-admin-v9.9.9-windows-amd64.zip"
	zipPath := filepath.Join(t.TempDir(), assetName)
	makeUpdateZip(t, zipPath)
	dest := filepath.Join(t.TempDir(), "unzipped")
	if err := unzip(zipPath, dest); err != nil {
		t.Fatalf("unzip update package: %v", err)
	}

	gotExe, gotWorker, err := updatePayload(dest, assetName, "ga-admin.exe")
	if err != nil {
		t.Fatalf("updatePayload: %v", err)
	}
	root := filepath.Join(dest, strings.TrimSuffix(assetName, ".zip"))
	if want := filepath.Join(root, "ga-admin.exe"); gotExe != want {
		t.Fatalf("executable = %q, want %q", gotExe, want)
	}
	if want := filepath.Join(root, "cmd", "chat_worker.py"); gotWorker != want {
		t.Fatalf("worker = %q, want %q", gotWorker, want)
	}
}

func TestUpdatePayloadFallsBackToMacOSAppBundle(t *testing.T) {
	const assetName = "ga-admin-v9.9.9-darwin-arm64.zip"
	dest := t.TempDir()
	root := filepath.Join(dest, strings.TrimSuffix(assetName, ".zip"))
	bundleBin := filepath.Join(root, "ga-admin.app", "Contents", "MacOS")
	for name, content := range map[string]string{
		"ga-admin":           "new exe",
		"cmd/chat_worker.py": "new worker",
	} {
		path := filepath.Join(bundleBin, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0755); err != nil {
			t.Fatal(err)
		}
	}

	gotExe, gotWorker, err := updatePayload(dest, assetName, "ga-admin")
	if err != nil {
		t.Fatalf("updatePayload: %v", err)
	}
	if want := filepath.Join(bundleBin, "ga-admin"); gotExe != want {
		t.Fatalf("executable = %q, want %q", gotExe, want)
	}
	if want := filepath.Join(bundleBin, "cmd", "chat_worker.py"); gotWorker != want {
		t.Fatalf("worker = %q, want %q", gotWorker, want)
	}
}

func TestUpdatePayloadRejectsUnexpectedTopLevelLayout(t *testing.T) {
	tests := []struct {
		name  string
		paths []string
	}{
		{name: "flat package", paths: []string{"ga-admin.exe", "cmd/chat_worker.py"}},
		{name: "extra top-level entry", paths: []string{"ga-admin-v9.9.9-windows-amd64/ga-admin.exe", "ga-admin-v9.9.9-windows-amd64/cmd/chat_worker.py", "README.txt"}},
		{name: "wrong root name", paths: []string{"other/ga-admin.exe", "other/cmd/chat_worker.py"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			for _, name := range tt.paths {
				path := filepath.Join(dir, filepath.FromSlash(name))
				if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte("payload"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			_, _, err := updatePayload(dir, "ga-admin-v9.9.9-windows-amd64.zip", "ga-admin.exe")
			if err == nil || !strings.Contains(err.Error(), "exactly one top-level directory") {
				t.Fatalf("updatePayload error = %v, want top-level directory error", err)
			}
		})
	}
}

func TestReserveUpdateSerializesAcrossProcesses(t *testing.T) {
	statusFile := filepath.Join(t.TempDir(), "ga-admin-update-status.json")
	const workers = 12
	commands := make([]*exec.Cmd, 0, workers)
	for i := 0; i < workers; i++ {
		cmd := exec.Command(os.Args[0], "-test.run=^TestReserveUpdateSubprocess$")
		cmd.Env = append(os.Environ(),
			"GA_TEST_RESERVE_STATUS="+statusFile,
			fmt.Sprintf("GA_TEST_RESERVE_ID=operation-%d", i),
		)
		commands = append(commands, cmd)
	}

	var wg sync.WaitGroup
	results := make(chan string, workers)
	for _, cmd := range commands {
		wg.Add(1)
		go func(cmd *exec.Cmd) {
			defer wg.Done()
			out, err := cmd.CombinedOutput()
			if err != nil {
				results <- fmt.Sprintf("error:%v:%s", err, out)
				return
			}
			results <- strings.TrimSpace(string(out))
		}(cmd)
	}
	wg.Wait()
	close(results)

	reserved := 0
	for result := range results {
		switch result {
		case "reserved":
			reserved++
		case "active":
		default:
			t.Fatalf("unexpected helper result %q", result)
		}
	}
	if reserved != 1 {
		t.Fatalf("reserved operations = %d, want exactly 1", reserved)
	}
}

func TestReserveUpdateSubprocess(t *testing.T) {
	statusFile := os.Getenv("GA_TEST_RESERVE_STATUS")
	if statusFile == "" {
		t.Skip("subprocess helper")
	}
	statusPathOverride = statusFile
	now := time.Now()
	candidate := UpdateStatus{
		ID: os.Getenv("GA_TEST_RESERVE_ID"), PID: os.Getpid(), Running: true,
		Stage: "queued", Progress: 1, StartedAt: now,
	}
	_, created, err := reserveUpdate(candidate)
	if err != nil {
		fmt.Printf("reserve-error:%v", err)
		os.Exit(0)
	}
	if created {
		fmt.Print("reserved")
		os.Exit(0)
	}
	fmt.Print("active")
	os.Exit(0)
}

func TestTransitionUpdateRejectsSupersededOperation(t *testing.T) {
	oldStatus := statusPathOverride
	statusPathOverride = filepath.Join(t.TempDir(), "ga-admin-update-status.json")
	defer func() { statusPathOverride = oldStatus }()

	current := UpdateStatus{ID: "new-operation", Running: true, Stage: "queued", Message: "current"}
	if err := writeStatus(current); err != nil {
		t.Fatal(err)
	}
	err := transitionUpdate("old-operation", func(st *UpdateStatus) error {
		st.Stage = "error"
		st.Message = "stale writer"
		return nil
	})
	if !errors.Is(err, ErrUpdateSuperseded) {
		t.Fatalf("transition error = %v, want ErrUpdateSuperseded", err)
	}
	persisted := CurrentUpdateStatus()
	if persisted.ID != current.ID || persisted.Stage != current.Stage || persisted.Message != current.Message {
		t.Fatalf("stale writer changed persisted status: %+v", persisted)
	}
}

func TestValidateInstallTargetsRejectsEscapesAndUnexpectedFiles(t *testing.T) {
	root := t.TempDir()
	exeName := "ga-admin"
	if runtime.GOOS == "windows" {
		exeName += ".exe"
	}
	validExe := filepath.Join(root, exeName)
	validWorker := filepath.Join(root, "cmd", "chat_worker.py")
	if err := validateInstallTargets(root, validExe, validWorker); err != nil {
		t.Fatalf("valid targets rejected: %v", err)
	}

	tests := []struct {
		name   string
		exe    string
		worker string
	}{
		{name: "exe outside root", exe: filepath.Join(root, "..", exeName), worker: validWorker},
		{name: "sibling prefix", exe: filepath.Join(root+"-other", exeName), worker: validWorker},
		{name: "unexpected exe name", exe: filepath.Join(root, "renamed-"+exeName), worker: validWorker},
		{name: "worker outside root", exe: validExe, worker: filepath.Join(root, "..", "chat_worker.py")},
		{name: "unexpected worker", exe: validExe, worker: filepath.Join(root, "chat_worker.py")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateInstallTargets(root, tt.exe, tt.worker); err == nil {
				t.Fatalf("unsafe targets accepted: exe=%q worker=%q", tt.exe, tt.worker)
			}
		})
	}
}

func TestStartApplyLatestReportsInitialStatusWriteError(t *testing.T) {
	oldStatus := statusPathOverride
	statusPathOverride = t.TempDir()
	defer func() { statusPathOverride = oldStatus }()

	st, err := StartApplyLatest()
	if err == nil {
		t.Fatalf("expected status write error, got status %+v", st)
	}
	if st.Running || st.Stage != "failed" || st.Progress != 100 || st.Error == "" {
		t.Fatalf("unexpected failed status: %+v", st)
	}
	if !strings.Contains(err.Error(), "write update status") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCurrentUpdateStatusReportsCorruptStatusFile(t *testing.T) {
	oldStatus := statusPathOverride
	statusPathOverride = filepath.Join(t.TempDir(), "ga-admin-update-status.json")
	defer func() { statusPathOverride = oldStatus }()

	if err := os.WriteFile(statusPathOverride, []byte("{not-json"), 0600); err != nil {
		t.Fatal(err)
	}
	st := CurrentUpdateStatus()
	if st.Running || st.Stage != "error" || st.Progress != 100 || st.Error == "" {
		t.Fatalf("corrupt status = %+v, want readable error status", st)
	}
	if !strings.Contains(st.Message, "读取升级状态失败") || !strings.Contains(st.Error, "invalid character") {
		t.Fatalf("corrupt status message/error = %+v", st)
	}
	if st.UpdatedAt.IsZero() || st.EndedAt.IsZero() {
		t.Fatalf("corrupt status timestamps missing: %+v", st)
	}
}

func TestStartApplyLatestChecksumFailureWritesReadableStatus(t *testing.T) {
	oldURL := repoLatestURL
	oldStatus := statusPathOverride
	statusPathOverride = filepath.Join(t.TempDir(), "ga-admin-update-status.json")
	defer func() { repoLatestURL = oldURL; statusPathOverride = oldStatus }()

	zipPath := filepath.Join(t.TempDir(), "ga-admin-v9.9.9-windows-amd64.zip")
	makeUpdateZip(t, zipPath)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/latest":
			_ = json.NewEncoder(w).Encode(Release{TagName: "v9.9.9", Assets: []Asset{
				{Name: "ga-admin-v9.9.9-windows-amd64.zip", BrowserDownloadURL: serverURL(r, "/asset.zip")},
				{Name: "ga-admin-v9.9.9-windows-amd64.zip.sha256", BrowserDownloadURL: serverURL(r, "/asset.zip.sha256")},
			}})
		case "/asset.zip":
			http.ServeFile(w, r, zipPath)
		case "/asset.zip.sha256":
			_, _ = w.Write([]byte("0000000000000000000000000000000000000000000000000000000000000000  ga-admin-v9.9.9-windows-amd64.zip\n"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	repoLatestURL = server.URL + "/latest"

	st, err := StartApplyLatest()
	if err != nil {
		t.Fatalf("StartApplyLatest: %v", err)
	}
	if !st.Running || st.Stage != "queued" {
		t.Fatalf("initial status = %+v", st)
	}
	final := waitUpdateDone(t)
	if final.Running || final.Stage != "failed" {
		t.Fatalf("final status = %+v", final)
	}
	if !strings.Contains(final.Error, "sha256 mismatch") || final.Script != "" {
		t.Fatalf("unexpected error/script: %+v", final)
	}
	if final.Progress != 100 || final.EndedAt.IsZero() || final.Check == nil {
		t.Fatalf("incomplete final status: %+v", final)
	}
	fromAPI := CurrentUpdateStatus()
	if fromAPI.Stage != "failed" || !strings.Contains(fromAPI.Message, "sha256 mismatch") {
		t.Fatalf("readable persisted status = %+v", fromAPI)
	}
}

func TestStartApplyLatestWaitsForRestartAuthorizationBeforeLaunchingHelper(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("self-update is currently supported on Windows only")
	}

	oldURL := repoLatestURL
	oldStatus := statusPathOverride
	oldRuntime := currentApplyRuntime
	defer func() {
		repoLatestURL = oldURL
		statusPathOverride = oldStatus
		currentApplyRuntime = oldRuntime
	}()

	installRoot := t.TempDir()
	statusPathOverride = filepath.Join(installRoot, "ga-admin-update-status.json")
	runningExe := filepath.Join(installRoot, "ga-admin.exe")
	if err := os.WriteFile(runningExe, []byte("copied-helper-binary"), 0755); err != nil {
		t.Fatal(err)
	}

	assetName := fmt.Sprintf("ga-admin-v999.0.0-%s-%s.zip", runtime.GOOS, runtime.GOARCH)
	zipPath := filepath.Join(t.TempDir(), assetName)
	makeUpdateZip(t, zipPath)
	zipData, err := os.ReadFile(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(zipData)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/latest":
			_ = json.NewEncoder(w).Encode(Release{TagName: "v999.0.0", Assets: []Asset{
				{Name: assetName, BrowserDownloadURL: serverURL(r, "/asset.zip")},
				{Name: assetName + ".sha256", BrowserDownloadURL: serverURL(r, "/asset.zip.sha256")},
			}})
		case "/asset.zip":
			http.ServeFile(w, r, zipPath)
		case "/asset.zip.sha256":
			_, _ = fmt.Fprintf(w, "%x  %s\n", sum, assetName)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	repoLatestURL = server.URL + "/latest"

	type launchRecord struct {
		helperPath   string
		manifestPath string
		manifest     UpdateManifest
	}
	launched := make(chan launchRecord, 1)
	exitScheduled := make(chan struct{}, 1)
	currentApplyRuntime = applyRuntimeDeps{
		executable: func() (string, error) { return runningExe, nil },
		launchHelper: func(helperPath, manifestPath string) error {
			manifest, err := readUpdateManifest(manifestPath)
			if err != nil {
				return err
			}
			launched <- launchRecord{helperPath: helperPath, manifestPath: manifestPath, manifest: manifest}
			return transitionUpdate(manifest.OperationID, func(st *UpdateStatus) error {
				st.Stage = "waiting_for_exit"
				st.Progress = 88
				st.Message = "helper owns update status"
				return nil
			})
		},
		scheduleExit: func() { exitScheduled <- struct{}{} },
	}

	initial, err := StartApplyLatest()
	if err != nil {
		t.Fatalf("StartApplyLatest: %v", err)
	}
	var ready UpdateStatus
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		ready = CurrentUpdateStatus()
		if ready.Stage == "ready" || ready.Stage == "failed" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if ready.Stage != "ready" || ready.Progress != 90 || !ready.Running {
		t.Fatalf("download did not stop at ready: %+v", ready)
	}
	select {
	case record := <-launched:
		t.Fatalf("helper launched before restart authorization: %+v", record)
	default:
	}
	select {
	case <-exitScheduled:
		t.Fatal("parent exit scheduled before restart authorization")
	default:
	}
	if err := transitionUpdate(initial.ID, func(st *UpdateStatus) error {
		st.Error = "previous helper launch failed"
		return nil
	}); err != nil {
		t.Fatalf("seed retry error: %v", err)
	}

	authorized, err := AuthorizeRestart(initial.ID)
	if err != nil {
		t.Fatalf("AuthorizeRestart: %v", err)
	}
	if authorized.ID != initial.ID {
		t.Fatalf("authorized operation = %+v, initial=%+v", authorized, initial)
	}
	if authorized.Error != "" {
		t.Fatalf("successful retry retained stale error: %+v", authorized)
	}

	var record launchRecord
	select {
	case record = <-launched:
	case <-time.After(time.Second):
		t.Fatalf("copied helper was not launched after authorization; status=%+v", CurrentUpdateStatus())
	}
	select {
	case <-exitScheduled:
	case <-time.After(time.Second):
		t.Fatal("parent exit was not scheduled after authorization")
	}

	if record.manifest.OperationID != initial.ID || record.manifest.StatusPath != statusPathOverride {
		t.Fatalf("manifest identity/status = %+v, initial=%+v", record.manifest, initial)
	}
	if record.manifest.OriginalExe != runningExe || record.manifest.OldPID != os.Getpid() {
		t.Fatalf("manifest process identity = %+v", record.manifest)
	}
	helperDir := filepath.Dir(record.helperPath)
	if helperDir != filepath.Dir(record.manifestPath) {
		t.Fatalf("helper/manifest are not durable siblings: helper=%q manifest=%q", record.helperPath, record.manifestPath)
	}
	originalWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if record.manifest.WorkingDir != originalWorkingDir {
		t.Fatalf("restart working directory = %q, want %q", record.manifest.WorkingDir, originalWorkingDir)
	}
	helperData, err := os.ReadFile(record.helperPath)
	if err != nil {
		t.Fatalf("read copied helper: %v", err)
	}
	if string(helperData) != "copied-helper-binary" {
		t.Fatalf("copied helper bytes = %q", helperData)
	}
	if _, err := os.Stat(record.manifest.StagedExe); err != nil {
		t.Fatalf("staged executable missing: %v", err)
	}
	if _, err := os.Stat(record.manifest.StagedWorker); err != nil {
		t.Fatalf("staged worker missing: %v", err)
	}
	for _, arg := range record.manifest.OriginalArgs {
		if strings.HasPrefix(arg, "--update-helper") || strings.HasPrefix(arg, "--update-confirm") {
			t.Fatalf("internal update argument leaked into restart args: %#v", record.manifest.OriginalArgs)
		}
	}

	time.Sleep(150 * time.Millisecond)
	final := CurrentUpdateStatus()
	if final.Stage != "waiting_for_exit" || final.Progress != 88 || !final.Running {
		t.Fatalf("parent overwrote helper-owned status: %+v", final)
	}
	if final.Script != "" {
		t.Fatalf("legacy update script leaked into helper transaction: %+v", final)
	}
}

func TestFetchLatestReportsInvalidRequestURL(t *testing.T) {
	oldURL := repoLatestURL
	repoLatestURL = "http://[::1"
	defer func() { repoLatestURL = oldURL }()

	_, err := fetchLatest(context.Background())
	if err == nil || !strings.Contains(err.Error(), "create github release request") {
		t.Fatalf("fetchLatest error = %v, want request creation context", err)
	}
}

func TestFetchLatestRejectsDeclaredOversizedMetadata(t *testing.T) {
	oldURL := repoLatestURL
	defer func() { repoLatestURL = oldURL }()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprint(maxUpdateMetadataBytes+1))
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	repoLatestURL = srv.URL

	_, err := fetchLatest(context.Background())
	if err == nil || !strings.Contains(err.Error(), "github release metadata too large") {
		t.Fatalf("fetchLatest error = %v, want metadata size limit", err)
	}
}

func TestFetchLatestRejectsStreamingOversizedMetadata(t *testing.T) {
	oldURL := repoLatestURL
	defer func() { repoLatestURL = oldURL }()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("{\"tag_name\":\"v0.0.29\",\"assets\":\""))
		for i := int64(0); i < maxUpdateMetadataBytes; i += 1024 {
			_, _ = w.Write([]byte(strings.Repeat("x", 1024)))
		}
		_, _ = w.Write([]byte("\"}"))
	}))
	defer srv.Close()
	repoLatestURL = srv.URL

	_, err := fetchLatest(context.Background())
	if err == nil || !strings.Contains(err.Error(), "github release metadata too large") {
		t.Fatalf("fetchLatest error = %v, want streaming metadata size limit", err)
	}
}

func TestFetchLatestTimesOutWaitingForResponseHeaders(t *testing.T) {
	oldURL := repoLatestURL
	oldClient := updateHTTPClient
	defer func() { repoLatestURL = oldURL; updateHTTPClient = oldClient }()

	updateHTTPClient = &http.Client{Transport: &http.Transport{ResponseHeaderTimeout: 25 * time.Millisecond}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		_, _ = w.Write([]byte(`{"tag_name":"v0.0.29"}`))
	}))
	defer srv.Close()
	repoLatestURL = srv.URL

	_, err := fetchLatest(context.Background())
	var netErr interface{ Timeout() bool }
	if err == nil || !errors.As(err, &netErr) || !netErr.Timeout() {
		t.Fatalf("fetchLatest error = %v, want response header timeout", err)
	}
}

func TestDownloadTimesOutWaitingForResponseHeadersAndLeavesNoFile(t *testing.T) {
	oldClient := updateHTTPClient
	defer func() { updateHTTPClient = oldClient }()

	updateHTTPClient = &http.Client{Transport: &http.Transport{ResponseHeaderTimeout: 25 * time.Millisecond}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()
	dest := filepath.Join(t.TempDir(), "asset.zip")

	err := download(context.Background(), srv.URL, dest, maxUpdatePackageBytes)
	var netErr interface{ Timeout() bool }
	if err == nil || !errors.As(err, &netErr) || !netErr.Timeout() {
		t.Fatalf("download error = %v, want response header timeout", err)
	}
	if _, statErr := os.Stat(dest); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("timed-out download should not create dest, stat err=%v", statErr)
	}
}

func TestDownloadReportsInvalidRequestURL(t *testing.T) {
	err := download(context.Background(), "http://[::1", filepath.Join(t.TempDir(), "asset.zip"), maxUpdatePackageBytes)
	if err == nil || !strings.Contains(err.Error(), "create download request") {
		t.Fatalf("download error = %v, want request creation context", err)
	}
}

func TestDownloadRemovesPartialFileOnBodyReadError(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "asset.zip")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hj, ok := w.(http.Hijacker)
		if !ok {
			t.Fatal("response writer does not support hijacking")
		}
		conn, bufrw, err := hj.Hijack()
		if err != nil {
			t.Fatalf("hijack: %v", err)
		}
		_, _ = bufrw.WriteString("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\npartial")
		_ = bufrw.Flush()
		_ = conn.Close()
	}))
	defer srv.Close()

	err := download(context.Background(), srv.URL, dest, maxUpdatePackageBytes)
	if err == nil {
		t.Fatal("download error = nil, want truncated body error")
	}
	if _, statErr := os.Stat(dest); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("partial download should be removed, stat err=%v", statErr)
	}
	matches, globErr := filepath.Glob(filepath.Join(dir, ".asset.zip-*.tmp"))
	if globErr != nil {
		t.Fatalf("glob temp files: %v", globErr)
	}
	if len(matches) != 0 {
		t.Fatalf("partial download temp files should be removed: %v", matches)
	}
}

func waitUpdateDone(t *testing.T) UpdateStatus {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		st := CurrentUpdateStatus()
		if !st.Running && st.Stage != "queued" && st.Stage != "" {
			return st
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("update did not finish: %+v", CurrentUpdateStatus())
	return UpdateStatus{}
}

func makeUpdateZip(t *testing.T, path string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	rootName := strings.TrimSuffix(filepath.Base(path), ".zip")
	if rootName == "" {
		t.Fatalf("invalid update zip path %q", path)
	}
	w, err := zw.Create(rootName + "/ga-admin.exe")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = w.Write([]byte("new exe"))
	w, err = zw.Create(rootName + "/cmd/chat_worker.py")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = w.Write([]byte("new worker"))
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
}

func serverURL(r *http.Request, path string) string {
	return "http://" + r.Host + path
}

func TestWriteStatusCreatesParentAndCleansTempFiles(t *testing.T) {
	oldStatus := statusPathOverride
	root := filepath.Join(t.TempDir(), "missing", "state")
	statusPathOverride = filepath.Join(root, "ga-admin-update-status.json")
	defer func() { statusPathOverride = oldStatus }()

	st := UpdateStatus{ID: "atomic-test", Stage: "queued", Progress: 7, Message: "ok"}
	if err := writeStatus(st); err != nil {
		t.Fatalf("writeStatus: %v", err)
	}
	b, err := os.ReadFile(statusPathOverride)
	if err != nil {
		t.Fatalf("read status: %v", err)
	}
	if !json.Valid(b) || !strings.Contains(string(b), "atomic-test") {
		t.Fatalf("status file = %q", string(b))
	}
	matches, err := filepath.Glob(filepath.Join(root, ".ga-admin-update-status.json-*.tmp"))
	if err != nil {
		t.Fatalf("glob temp files: %v", err)
	}
	if len(matches) != 0 {
		t.Fatalf("leftover temp files: %v", matches)
	}
}

func TestDownloadRejectsContentLengthAboveLimit(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "asset.zip")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "12")
		_, _ = w.Write([]byte("too large"))
	}))
	defer srv.Close()

	err := download(context.Background(), srv.URL, dest, 4)
	if err == nil || !strings.Contains(err.Error(), "download too large") {
		t.Fatalf("download error = %v, want download too large", err)
	}
	if _, statErr := os.Stat(dest); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("oversized download should not create dest, stat err=%v", statErr)
	}
}

func TestDownloadRejectsStreamingBodyAboveLimitAndRemovesPartial(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "asset.zip")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Del("Content-Length")
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		_, _ = w.Write([]byte("123456789"))
	}))
	defer srv.Close()

	err := download(context.Background(), srv.URL, dest, 4)
	if err == nil || !strings.Contains(err.Error(), "http: request body too large") {
		t.Fatalf("download error = %v, want request body too large", err)
	}
	if _, statErr := os.Stat(dest); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("partial oversized download should be removed, stat err=%v", statErr)
	}
}

func TestCurrentUpdateLimitsPinPackageAndChecksumCeilings(t *testing.T) {
	if maxUpdateMetadataBytes != 2<<20 {
		t.Fatalf("maxUpdateMetadataBytes=%d want %d", maxUpdateMetadataBytes, 2<<20)
	}
	if maxUpdatePackageBytes != 256<<20 {
		t.Fatalf("maxUpdatePackageBytes=%d want %d", maxUpdatePackageBytes, 256<<20)
	}
	if maxUpdateChecksumBytes != 1<<20 {
		t.Fatalf("maxUpdateChecksumBytes=%d want %d", maxUpdateChecksumBytes, 1<<20)
	}
}

func TestCurrentUpdateStatusDoesNotInferSuccessAfterRelaunch(t *testing.T) {
	oldStatus := statusPathOverride
	statusPathOverride = filepath.Join(t.TempDir(), "ga-admin-update-status.json")
	defer func() { statusPathOverride = oldStatus }()

	started := time.Now().Add(-time.Minute).UTC()
	st := UpdateStatus{ID: "restart-test", PID: os.Getpid() + 1, Running: true, Stage: "restarting", Progress: 95, Message: "升级包已就绪，正在重启服务", StartedAt: started, UpdatedAt: started}
	b, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statusPathOverride, b, 0600); err != nil {
		t.Fatal(err)
	}

	got := CurrentUpdateStatus()
	if !got.Running || got.Stage != "restarting" || got.Progress != 95 {
		t.Fatalf("status must await helper confirmation, got %+v", got)
	}
	if !got.EndedAt.IsZero() {
		t.Fatalf("unconfirmed update must not have an end time: %+v", got)
	}
}

func TestNormalizeStatusAfterRestartLeavesActiveDownloadRunning(t *testing.T) {
	st := UpdateStatus{ID: "download-test", Running: true, Stage: "downloading", Progress: 35, Message: "downloading"}
	got := normalizeStatusAfterRestart(st)
	if !got.Running || got.Stage != st.Stage || got.Progress != st.Progress || got.Message != st.Message {
		t.Fatalf("status should remain active download, got %+v", got)
	}
}

func TestNormalizeStatusAfterRestartLeavesCurrentProcessRestarting(t *testing.T) {
	st := UpdateStatus{ID: "same-process-test", PID: os.Getpid(), Running: true, Stage: "restarting", Progress: 95, Message: "restarting"}
	got := normalizeStatusAfterRestart(st)
	if !got.Running || got.Stage != st.Stage || got.Progress != st.Progress || got.Message != st.Message {
		t.Fatalf("current process restarting status should remain running, got %+v", got)
	}
}

func TestNormalizeStatusForVersionClearsStaleActiveStatusAfterManualInstall(t *testing.T) {
	st := UpdateStatus{
		ID:            "manual-install-test",
		Running:       true,
		Stage:         "downloading",
		Progress:      42,
		Message:       "downloading",
		SourceVersion: "v0.2.4",
		TargetVersion: "v0.2.5",
		Check: &CheckResult{
			Current: BuildInfo{Version: "v0.2.4"},
			Latest:  &Release{TagName: "v0.2.5"},
			Update:  true,
		},
	}
	current := BuildInfo{Version: "v0.2.5"}

	got := normalizeStatusForVersion(st, current.Version, current)
	if got.Running || got.Stage != "done" || got.Progress != 100 {
		t.Fatalf("stale active status should be completed, got %+v", got)
	}
	if got.InstalledVersion != current.Version || got.ConfirmedVersion != current.Version {
		t.Fatalf("installed versions = %q/%q, want %q", got.InstalledVersion, got.ConfirmedVersion, current.Version)
	}
	if got.Check == nil || got.Check.Current.Version != current.Version || got.Check.Update {
		t.Fatalf("check snapshot was not refreshed, got %+v", got.Check)
	}
	if got.ConfirmedAt.IsZero() || got.EndedAt.IsZero() {
		t.Fatalf("completed status should have confirmation/end timestamps: %+v", got)
	}
}

func TestNormalizeStatusForVersionLeavesReadyTransactionPendingAuthorization(t *testing.T) {
	st := UpdateStatus{
		ID:            "ready-test",
		Running:       true,
		Stage:         "ready",
		Progress:      90,
		Message:       "ready",
		TargetVersion: "v0.2.5",
	}

	got := normalizeStatusForVersion(st, "v0.2.5", BuildInfo{Version: "v0.2.5"})
	if !got.Running || got.Stage != st.Stage || got.Progress != st.Progress || got.Message != st.Message {
		t.Fatalf("ready update must remain pending restart authorization, got %+v", got)
	}
}

func TestNormalizeStatusForVersionLeavesUnreachedActiveStatus(t *testing.T) {
	st := UpdateStatus{
		ID:            "unreached-test",
		Running:       true,
		Stage:         "downloading",
		Progress:      42,
		Message:       "downloading",
		TargetVersion: "v0.2.5",
	}

	got := normalizeStatusForVersion(st, "v0.2.4", BuildInfo{Version: "v0.2.4"})
	if !got.Running || got.Stage != st.Stage || got.Progress != st.Progress || got.Message != st.Message {
		t.Fatalf("unreached update should remain active, got %+v", got)
	}
}

// TestCheckRealNetwork verifies the timeout fix with real GitHub API.
// Skip in CI to avoid flakiness; run manually with: go test -v -run TestCheckRealNetwork
func TestCheckRealNetwork(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping real network test in short mode")
	}

	// Configure proxy if available
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:7897")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:7897")

	SetRepoURL("https://api.github.com/repos/Fwind43/GenericAgent-Admin/releases/latest")

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	t.Log("Fetching real GitHub release metadata with proxy...")
	start := time.Now()
	result, err := Check(ctx)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Check failed after %.1fs: %v", elapsed.Seconds(), err)
	}

	t.Logf("✓ Check succeeded in %.1fs", elapsed.Seconds())
	t.Logf("  Current: %s", result.Current.Version)
	if result.Latest != nil {
		t.Logf("  Latest: %s", result.Latest.TagName)
	}
	t.Logf("  Update: %v", result.Update)

	if result.Latest == nil {
		t.Fatal("Latest release should not be nil")
	}
	if result.Latest.TagName == "" {
		t.Fatal("Latest TagName should not be empty")
	}
	if !strings.HasPrefix(result.Latest.TagName, "v") && !strings.HasPrefix(result.Latest.TagName, "0.") {
		t.Fatalf("Latest version has unexpected format: %s", result.Latest.TagName)
	}
}

func TestUpdateTransactionWaitTimeoutLeavesInstallationUntouched(t *testing.T) {
	root := t.TempDir()
	oldExe := filepath.Join(root, "ga-admin.exe")
	oldWorker := filepath.Join(root, "cmd", "chat_worker.py")
	stagedExe := filepath.Join(root, "stage", "ga-admin.exe")
	stagedWorker := filepath.Join(root, "stage", "cmd", "chat_worker.py")
	for path, content := range map[string]string{
		oldExe: "old-exe", oldWorker: "old-worker", stagedExe: "new-exe", stagedWorker: "new-worker",
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0755); err != nil {
			t.Fatal(err)
		}
	}
	oldStatus := statusPathOverride
	statusPathOverride = filepath.Join(root, "ga-admin-update-status.json")
	defer func() { statusPathOverride = oldStatus }()
	if err := writeStatus(UpdateStatus{ID: "timeout-op", Running: true, Stage: "prepared"}); err != nil {
		t.Fatal(err)
	}

	manifest := UpdateManifest{
		OperationID: "timeout-op", OldPID: os.Getpid(), SourceVersion: "v1.0.0", TargetVersion: "v2.0.0",
		OriginalExe: oldExe, StagedExe: stagedExe, BackupExe: oldExe + ".timeout-op.bak",
		Worker: oldWorker, StagedWorker: stagedWorker, WorkerBackup: oldWorker + ".timeout-op.bak",
		StatusPath: statusPathOverride, WorkingDir: root, ExitTimeout: 25 * time.Millisecond,
	}
	if err := runReplacementTransaction(manifest, defaultTransactionDeps()); err == nil || !strings.Contains(err.Error(), "old process") {
		t.Fatalf("transaction error = %v, want old process timeout", err)
	}
	for path, want := range map[string]string{oldExe: "old-exe", oldWorker: "old-worker"} {
		got, err := os.ReadFile(path)
		if err != nil || string(got) != want {
			t.Fatalf("%s = %q, %v; want %q", path, got, err, want)
		}
	}
}

func TestBuildUpdateManifestUsesOperationScopedBackups(t *testing.T) {
	root := t.TempDir()
	exe := filepath.Join(root, "ga-admin.exe")
	worker := filepath.Join(root, "cmd", "chat_worker.py")
	legacyExeBackup := exe + ".bak"
	legacyWorkerBackup := worker + ".bak"
	for _, path := range []string{legacyExeBackup, legacyWorkerBackup} {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("legacy-backup"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	manifest, err := buildUpdateManifest(updateManifestInput{
		OperationID: "update-123-456", SourceVersion: "v1.0.0", TargetVersion: "v2.0.0",
		OriginalExe: exe, StagedExe: filepath.Join(root, "stage", "ga-admin.exe"),
		Worker: worker, StagedWorker: filepath.Join(root, "stage", "chat_worker.py"),
		StatusPath: filepath.Join(root, "ga-admin-update-status.json"), WorkingDir: root,
	})
	if err != nil {
		t.Fatalf("buildUpdateManifest: %v", err)
	}
	if manifest.BackupExe == legacyExeBackup || manifest.WorkerBackup == legacyWorkerBackup {
		t.Fatalf("manifest reuses legacy fixed backup paths: %+v", manifest)
	}
	if !strings.Contains(filepath.Base(manifest.BackupExe), manifest.OperationID) ||
		!strings.Contains(filepath.Base(manifest.WorkerBackup), manifest.OperationID) {
		t.Fatalf("backup paths are not operation-scoped: exe=%q worker=%q", manifest.BackupExe, manifest.WorkerBackup)
	}
}

func TestUpdateTransactionRestartsOriginalAfterPreLaunchFailure(t *testing.T) {
	root := t.TempDir()
	oldExe := filepath.Join(root, "ga-admin.exe")
	stagedExe := filepath.Join(root, "stage", "ga-admin.exe")
	for path, content := range map[string]string{oldExe: "old-exe", stagedExe: "new-exe"} {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0755); err != nil {
			t.Fatal(err)
		}
	}
	oldStatus := statusPathOverride
	statusPathOverride = filepath.Join(root, "ga-admin-update-status.json")
	defer func() { statusPathOverride = oldStatus }()
	operationID := "pre-launch-failure-op"
	if err := writeStatus(UpdateStatus{ID: operationID, Running: true, Stage: "prepared"}); err != nil {
		t.Fatal(err)
	}
	manifest := UpdateManifest{
		OperationID: operationID, SourceVersion: "v1.0.0", TargetVersion: "v2.0.0",
		OriginalExe: oldExe, StagedExe: stagedExe, BackupExe: oldExe + ".pre-launch-failure-op.bak",
		StatusPath: statusPathOverride, WorkingDir: root,
	}
	launches := []bool{}
	deps := defaultTransactionDeps()
	deps.waitPIDExit = func(int, time.Duration) error { return nil }
	deps.installFile = func(string, string, os.FileMode) error { return errors.New("injected install failure") }
	deps.launch = func(_ UpdateManifest, confirmation bool) (*exec.Cmd, <-chan error, error) {
		launches = append(launches, confirmation)
		return nil, nil, nil
	}
	if err := runReplacementTransaction(manifest, deps); err == nil || !strings.Contains(err.Error(), "injected install failure") {
		t.Fatalf("transaction error = %v, want injected install failure", err)
	}
	if !slices.Equal(launches, []bool{false}) {
		t.Fatalf("launch confirmations = %v, want one original-service restart", launches)
	}
	got, err := os.ReadFile(oldExe)
	if err != nil || string(got) != "old-exe" {
		t.Fatalf("original executable = %q, %v; want restored old executable", got, err)
	}
}

func TestUpdateTransactionPartialWorkerFailureRestoresWholeSet(t *testing.T) {
	root := t.TempDir()
	oldExe := filepath.Join(root, "ga-admin.exe")
	oldWorker := filepath.Join(root, "cmd", "chat_worker.py")
	stagedExe := filepath.Join(root, "stage", "ga-admin.exe")
	stagedWorker := filepath.Join(root, "stage", "cmd", "chat_worker.py")
	for path, content := range map[string]string{
		oldExe: "old-exe", oldWorker: "old-worker", stagedExe: "new-exe", stagedWorker: "new-worker",
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0755); err != nil {
			t.Fatal(err)
		}
	}
	oldStatus := statusPathOverride
	statusPathOverride = filepath.Join(root, "ga-admin-update-status.json")
	defer func() { statusPathOverride = oldStatus }()
	if err := writeStatus(UpdateStatus{ID: "rollback-op", Running: true, Stage: "prepared"}); err != nil {
		t.Fatal(err)
	}

	manifest := UpdateManifest{
		OperationID: "rollback-op", SourceVersion: "v1.0.0", TargetVersion: "v2.0.0",
		OriginalExe: oldExe, StagedExe: stagedExe, BackupExe: oldExe + ".rollback-op.bak",
		Worker: oldWorker, StagedWorker: stagedWorker, WorkerBackup: oldWorker + ".rollback-op.bak",
		StatusPath: statusPathOverride, WorkingDir: root,
	}
	deps := defaultTransactionDeps()
	install := deps.installFile
	deps.installFile = func(src, dest string, perm os.FileMode) error {
		if sameFilePath(dest, oldWorker) {
			return errors.New("injected worker install failure")
		}
		return install(src, dest, perm)
	}
	deps.launch = func(_ UpdateManifest, confirmation bool) (*exec.Cmd, <-chan error, error) {
		if confirmation {
			t.Fatal("unexpected replacement launch")
		}
		return nil, nil, nil
	}
	if err := runReplacementTransaction(manifest, deps); err == nil || !strings.Contains(err.Error(), "injected worker") {
		t.Fatalf("transaction error = %v, want injected worker failure", err)
	}
	for path, want := range map[string]string{oldExe: "old-exe", oldWorker: "old-worker"} {
		got, err := os.ReadFile(path)
		if err != nil || string(got) != want {
			t.Fatalf("%s = %q, %v; want restored %q", path, got, err, want)
		}
	}
	st := CurrentUpdateStatus()
	if st.Stage != "failed" || st.RollbackResult != "restored" || st.Running {
		t.Fatalf("rollback status = %+v", st)
	}
}

func TestUpdateTransactionPublishesStartingStageBeforeLaunch(t *testing.T) {
	root := t.TempDir()
	oldExe := filepath.Join(root, "ga-admin.exe")
	stagedExe := filepath.Join(root, "stage", "ga-admin.exe")
	for path, content := range map[string]string{oldExe: "old-exe", stagedExe: "new-exe"} {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0755); err != nil {
			t.Fatal(err)
		}
	}
	oldStatus := statusPathOverride
	statusPathOverride = filepath.Join(root, "ga-admin-update-status.json")
	defer func() { statusPathOverride = oldStatus }()
	operationID := "synchronous-confirm-op"
	if err := writeStatus(UpdateStatus{ID: operationID, Running: true, Stage: "prepared", TargetVersion: effectiveVersion()}); err != nil {
		t.Fatal(err)
	}

	manifest := UpdateManifest{
		OperationID: operationID, SourceVersion: "v1.0.0", TargetVersion: effectiveVersion(),
		OriginalExe: oldExe, StagedExe: stagedExe, BackupExe: oldExe + ".bak",
		StatusPath: statusPathOverride, WorkingDir: root, ConfirmTimeout: time.Second,
	}
	child := exec.Command(os.Args[0], "-test.run=^$")
	child.Process, _ = os.FindProcess(os.Getpid())
	deps := defaultTransactionDeps()
	deps.waitPIDExit = func(int, time.Duration) error { return nil }
	deps.stopChild = func(*exec.Cmd, <-chan error) {}
	deps.launch = func(_ UpdateManifest, confirmation bool) (*exec.Cmd, <-chan error, error) {
		if !confirmation {
			t.Fatal("unexpected rollback launch")
		}
		if err := ConfirmUpdateReady(operationID); err != nil {
			return nil, nil, fmt.Errorf("synchronous confirmation failed: %w", err)
		}
		return child, make(chan error), nil
	}
	deps.sleep = func(time.Duration) {}
	if err := runReplacementTransaction(manifest, deps); err != nil {
		t.Fatalf("runReplacementTransaction: %v", err)
	}
	st := CurrentUpdateStatus()
	if st.Stage != "done" || st.ConfirmedVersion != effectiveVersion() {
		t.Fatalf("transaction status = %+v", st)
	}
}

func TestBuildUpdateManifestPreservesRestartContract(t *testing.T) {
	root := t.TempDir()
	exeName := "ga-admin"
	if runtime.GOOS == "windows" {
		exeName += ".exe"
	}
	exe := filepath.Join(root, exeName)
	worker := filepath.Join(root, "cmd", "chat_worker.py")
	work := filepath.Join(t.TempDir(), "prepared")
	status := filepath.Join(root, "ga-admin-update-status.json")
	args := []string{
		"--headless",
		"--update-confirm", "stale-operation",
		"--port=19090",
		"--update-helper=stale-manifest.json",
		"--app-root", filepath.Join(root, "state"),
	}

	manifest, err := buildUpdateManifest(updateManifestInput{
		OperationID:   "update-contract-1",
		SourceVersion: "v1.0.0",
		TargetVersion: "v1.1.0",
		OldPID:        1234,
		OriginalExe:   exe,
		StagedExe:     filepath.Join(work, exeName),
		Worker:        worker,
		StagedWorker:  filepath.Join(work, "chat_worker.py"),
		StatusPath:    status,
		WorkingDir:    filepath.Join(root, "launch-cwd"),
		OriginalArgs:  args,
	})
	if err != nil {
		t.Fatalf("buildUpdateManifest: %v", err)
	}
	if manifest.StatusPath != status || manifest.WorkingDir != filepath.Join(root, "launch-cwd") {
		t.Fatalf("manifest paths = status %q cwd %q", manifest.StatusPath, manifest.WorkingDir)
	}
	if filepath.Dir(manifest.BackupExe) != filepath.Dir(exe) {
		t.Fatalf("executable backup %q is not on the install target directory", manifest.BackupExe)
	}
	if filepath.Dir(manifest.WorkerBackup) != filepath.Dir(worker) {
		t.Fatalf("worker backup %q is not on the worker target directory", manifest.WorkerBackup)
	}
	wantArgs := []string{"--headless", "--port=19090", "--app-root", filepath.Join(root, "state")}
	if !slices.Equal(manifest.OriginalArgs, wantArgs) {
		t.Fatalf("restart args = %#v, want %#v", manifest.OriginalArgs, wantArgs)
	}
	if manifest.ExitTimeout <= 0 || manifest.ConfirmTimeout <= 0 || manifest.StabilityTime <= 0 {
		t.Fatalf("manifest timeouts are not populated: %+v", manifest)
	}
	if err := validateUpdateManifest(manifest); err != nil {
		t.Fatalf("manifest does not satisfy transaction contract: %v", err)
	}
}

func TestWriteUpdateManifestAndCopiedHelperAreDurable(t *testing.T) {
	work := t.TempDir()
	source := filepath.Join(work, "running.exe")
	if err := os.WriteFile(source, []byte("helper-binary"), 0755); err != nil {
		t.Fatal(err)
	}
	manifest := UpdateManifest{
		OperationID: "copy-helper-1", SourceVersion: "v1.0.0", TargetVersion: "v1.1.0",
		OldPID: 123, OriginalExe: filepath.Join(work, "ga-admin.exe"), StagedExe: filepath.Join(work, "new.exe"),
		BackupExe: filepath.Join(work, "ga-admin.exe.bak"), StatusPath: filepath.Join(work, "status.json"),
		WorkingDir: work, ExitTimeout: time.Second, ConfirmTimeout: time.Second, StabilityTime: time.Second,
	}

	helperPath, manifestPath, err := prepareUpdateHelper(work, source, manifest)
	if err != nil {
		t.Fatalf("prepareUpdateHelper: %v", err)
	}
	gotHelper, err := os.ReadFile(helperPath)
	if err != nil {
		t.Fatalf("read copied helper: %v", err)
	}
	if string(gotHelper) != "helper-binary" || filepath.Dir(helperPath) != work {
		t.Fatalf("copied helper = %q at %q", gotHelper, helperPath)
	}
	gotManifest, err := readUpdateManifest(manifestPath)
	if err != nil {
		t.Fatalf("read prepared manifest: %v", err)
	}
	if gotManifest.OperationID != manifest.OperationID || gotManifest.StatusPath != manifest.StatusPath {
		t.Fatalf("prepared manifest = %+v", gotManifest)
	}
}

func TestConfirmUpdateReadyRequiresMatchingOperation(t *testing.T) {
	oldStatus := statusPathOverride
	statusPathOverride = filepath.Join(t.TempDir(), "ga-admin-update-status.json")
	defer func() { statusPathOverride = oldStatus }()
	if err := writeStatus(UpdateStatus{ID: "expected-op", Running: true, Stage: "starting_replacement", TargetVersion: effectiveVersion()}); err != nil {
		t.Fatal(err)
	}

	if err := ConfirmUpdateReady("other-op"); !errors.Is(err, ErrUpdateSuperseded) {
		t.Fatalf("ConfirmUpdateReady error = %v, want ErrUpdateSuperseded", err)
	}
	st := CurrentUpdateStatus()
	if st.Stage == "done" || st.ID != "expected-op" {
		t.Fatalf("mismatched confirmation changed status: %+v", st)
	}
}

func TestConfirmUpdateReadyRejectsVersionMismatch(t *testing.T) {
	oldStatus := statusPathOverride
	statusPathOverride = filepath.Join(t.TempDir(), "ga-admin-update-status.json")
	defer func() { statusPathOverride = oldStatus }()
	if err := writeStatus(UpdateStatus{ID: "version-op", Running: true, Stage: "starting_replacement", TargetVersion: "v999.0.0"}); err != nil {
		t.Fatal(err)
	}

	if err := ConfirmUpdateReady("version-op"); err == nil || !strings.Contains(err.Error(), "version mismatch") {
		t.Fatalf("ConfirmUpdateReady error = %v, want version mismatch", err)
	}
	st := CurrentUpdateStatus()
	if st.Stage != "failed" || st.Running || st.Stage == "done" {
		t.Fatalf("version mismatch status = %+v", st)
	}
}
