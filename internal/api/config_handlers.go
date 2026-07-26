package api

import (
	"archive/zip"
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"genericagent-admin-go/internal/autostart"
	"genericagent-admin-go/internal/config"
	"genericagent-admin-go/internal/ga"
)

func (s *Server) configHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		writeJSON(w, s.CfgStore.Cfg)
		return
	}
	if r.Method == "PUT" {
		s.ConfigMu.Lock()
		defer s.ConfigMu.Unlock()
		var c config.AppConfig
		if err := decode(r, &c); err != nil {
			bad(w, 400, err.Error())
			return
		}
		if err := s.CfgStore.Save(c); err != nil {
			bad(w, 400, err.Error())
			return
		}
		c = s.CfgStore.Cfg
		s.Svc.SetRoot(c.GARoot, c.EffectivePython, c.BufferLines)
		writeJSON(w, c)
		return
	}
	bad(w, 405, "method not allowed")
}

type setupPathReq struct {
	Path string `json:"path"`
}

type setupRootReq struct {
	Root string `json:"root"`
}

type setupStreamEvent struct {
	Type  string `json:"type"`
	Line  string `json:"line,omitempty"`
	OK    bool   `json:"ok,omitempty"`
	Code  int    `json:"code,omitempty"`
	Error string `json:"error,omitempty"`
}

func unsafeSetupPath(p string) bool {
	clean := filepath.Clean(strings.TrimSpace(p))
	if clean == "" || clean == "." {
		return true
	}
	vol := filepath.VolumeName(clean)
	rest := strings.TrimPrefix(clean, vol)
	rest = filepath.Clean(rest)
	return rest == "" || rest == "." || rest == string(filepath.Separator)
}

type setupToolStatus struct {
	Name    string `json:"name"`
	OK      bool   `json:"ok"`
	Path    string `json:"path,omitempty"`
	Version string `json:"version,omitempty"`
	Error   string `json:"error,omitempty"`
}

func (s *Server) setupEnv(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, 405, "method not allowed")
		return
	}
	gitStatus := checkTool("git", "--version")
	pythonStatus := checkPythonForSetup(s.CfgStore.Cfg)
	writeJSON(w, map[string]interface{}{
		"ok":                pythonStatus.OK,
		"tools":             []setupToolStatus{gitStatus, pythonStatus, checkTool("uv", "--version"), checkTool("npm", "--version")},
		"git_required":      false,
		"archive_fallback":  true,
		"python_installer":  runtime.GOOS == "windows",
		"configured_python": strings.TrimSpace(s.CfgStore.Cfg.PythonPath),
		"effective_python":  strings.TrimSpace(s.CfgStore.Cfg.EffectivePython),
		"checked":           time.Now().Format(time.RFC3339),
	})
}

func checkPythonForSetup(cfg config.AppConfig) setupToolStatus {
	for _, candidate := range []string{strings.TrimSpace(cfg.EffectivePython), strings.TrimSpace(cfg.PythonPath), "python"} {
		if candidate == "" {
			continue
		}
		st := checkTool(candidate, "--version")
		st.Name = "python"
		if st.OK {
			return st
		}
	}
	return setupToolStatus{Name: "python", Error: "python executable not found"}
}

func (s *Server) setupBrowse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	var req setupPathReq
	if err := decode(r, &req); err != nil {
		bad(w, 400, err.Error())
		return
	}
	start := strings.TrimSpace(req.Path)
	if start == "" {
		if home, err := os.UserHomeDir(); err == nil {
			start = home
		}
	}
	selected, err := chooseDirectory(start)
	if err != nil {
		bad(w, 500, err.Error())
		return
	}
	if selected == "" {
		writeJSON(w, map[string]interface{}{"ok": false, "cancelled": true})
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "path": selected})
}

func toolOK(name string) bool {
	_, err := executablePath(name)
	return err == nil
}

func executablePath(name string) (string, error) {
	if strings.ContainsAny(name, `\/`) || filepath.IsAbs(name) {
		st, err := os.Stat(name)
		if err != nil {
			return "", err
		}
		if st.IsDir() {
			return "", fmt.Errorf("%s is a directory", name)
		}
		return name, nil
	}
	return exec.LookPath(name)
}

func checkTool(name string, args ...string) setupToolStatus {
	st := setupToolStatus{Name: name}
	path, err := executablePath(name)
	if err != nil {
		st.Error = err.Error()
		return st
	}
	st.OK = true
	st.Path = path
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, args...)
	hideChildWindow(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil && strings.TrimSpace(string(out)) == "" {
		st.Error = err.Error()
	}
	st.Version = strings.TrimSpace(string(out))
	return st
}

func chooseDirectory(start string) (string, error) {
	if runtime.GOOS == "windows" {
		ps := `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Select GenericAgent directory'; $d.ShowNewFolderButton = $true; if ($env:GA_ADMIN_BROWSE_START -and (Test-Path -LiteralPath $env:GA_ADMIN_BROWSE_START)) { $d.SelectedPath = $env:GA_ADMIN_BROWSE_START }; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Output $d.SelectedPath }`
		cmd := exec.Command("powershell", "-NoProfile", "-STA", "-Command", ps)
		hideChildWindow(cmd)
		cmd.Env = append(os.Environ(), "GA_ADMIN_BROWSE_START="+start)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return "", fmt.Errorf("directory picker failed: %s", strings.TrimSpace(string(out)))
		}
		return strings.TrimSpace(string(out)), nil
	}
	return "", fmt.Errorf("directory picker is only supported on Windows in this build; please paste the path manually")
}

func runSetupCommandOutput(ctx context.Context, root string, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = root
	hideChildWindow(cmd)
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		if text == "" {
			text = err.Error()
		}
		return text, err
	}
	return text, nil
}

func runSetupCommandStream(ctx context.Context, root string, emit func(setupStreamEvent), name string, args ...string) (int, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = root
	hideChildWindow(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return -1, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return -1, err
	}
	if err := cmd.Start(); err != nil {
		return -1, err
	}
	done := make(chan struct{}, 2)
	scan := func(prefix string, r io.Reader) {
		defer func() { done <- struct{}{} }()
		s := bufio.NewScanner(r)
		buf := make([]byte, 0, 64*1024)
		s.Buffer(buf, 1024*1024)
		for s.Scan() {
			emit(setupStreamEvent{Type: prefix, Line: s.Text()})
		}
		if err := s.Err(); err != nil {
			emit(setupStreamEvent{Type: "error", Error: err.Error()})
		}
	}
	go scan("stdout", stdout)
	go scan("stderr", stderr)
	err = cmd.Wait()
	<-done
	<-done
	code := 0
	if cmd.ProcessState != nil {
		code = cmd.ProcessState.ExitCode()
	}
	if err != nil {
		return code, err
	}
	return code, nil
}

func runGitCommand(ctx context.Context, root string, args ...string) (string, error) {
	return runGitCommandFunc(ctx, root, args...)
}

const setupInstallCloneTimeout = 5 * time.Minute
const setupCommandTimeout = 20 * time.Minute
const setupPythonInstallTimeout = 15 * time.Minute

const genericAgentRepoURL = "https://github.com/lsdefine/GenericAgent"
const genericAgentArchiveURL = genericAgentRepoURL + "/archive/refs/heads/main.zip"
const defaultWindowsPythonURL = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe"

func runSetupClone(ctx context.Context, dest string) (string, error) {
	return runSetupCloneFunc(ctx, dest)
}

var runSetupCloneFunc = func(ctx context.Context, dest string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "clone", genericAgentRepoURL, dest)
	hideChildWindow(cmd)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func installGenericAgentSource(ctx context.Context, dest string) (string, string, error) {
	out, err := runSetupClone(ctx, dest)
	if err == nil {
		return "git", strings.TrimSpace(out), nil
	}
	cloneText := strings.TrimSpace(out + "\n" + err.Error())
	zipOut, zipErr := downloadAndExtractGenericAgentArchive(ctx, dest)
	if zipErr != nil {
		return "", strings.TrimSpace(cloneText + "\nzip fallback failed: " + zipErr.Error()), err
	}
	return "zip", strings.TrimSpace(cloneText + "\n" + zipOut), nil
}

var downloadAndExtractGenericAgentArchive = func(ctx context.Context, dest string) (string, error) {
	return downloadAndExtractZipRoot(ctx, genericAgentArchiveURL, dest)
}

func downloadAndExtractZipRoot(ctx context.Context, archiveURL, dest string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, archiveURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("download %s failed: %s", archiveURL, resp.Status)
	}
	tmp, err := os.CreateTemp("", "genericagent-*.zip")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	n, copyErr := io.Copy(tmp, resp.Body)
	closeErr := tmp.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	if err := extractSingleRootZip(tmpPath, dest); err != nil {
		return "", err
	}
	return fmt.Sprintf("downloaded GenericAgent archive (%d bytes) and extracted to %s", n, dest), nil
}

func extractSingleRootZip(zipPath, dest string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()
	destAbs, err := filepath.Abs(dest)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(destAbs, 0755); err != nil {
		return err
	}
	for _, f := range r.File {
		parts := strings.Split(strings.ReplaceAll(f.Name, "\\", "/"), "/")
		if len(parts) <= 1 || parts[0] == "" {
			continue
		}
		rel := filepath.Join(parts[1:]...)
		if rel == "" || rel == "." {
			continue
		}
		target := filepath.Join(destAbs, rel)
		if !strings.HasPrefix(target, destAbs+string(filepath.Separator)) && target != destAbs {
			return fmt.Errorf("zip entry escapes target directory: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode())
		if err != nil {
			rc.Close()
			return err
		}
		_, copyErr := io.Copy(out, rc)
		closeOutErr := out.Close()
		closeInErr := rc.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeOutErr != nil {
			return closeOutErr
		}
		if closeInErr != nil {
			return closeInErr
		}
	}
	return nil
}

var runSetupCommandStreamFunc = runSetupCommandStream
var runSetupCommandOutputFunc = runSetupCommandOutput
var runPythonInstallerFunc = runWindowsPythonInstaller

var runGitCommandFunc = func(ctx context.Context, root string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = root
	hideChildWindow(cmd)
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		if text == "" {
			text = err.Error()
		}
		return text, fmt.Errorf("git %s failed: %w", strings.Join(args, " "), err)
	}
	return text, nil
}

func gaGitStatusForRoot(ctx context.Context, abs string) (map[string]interface{}, error) {
	if st, err := os.Stat(filepath.Join(abs, ".git")); err != nil || !st.IsDir() {
		return nil, errors.New("GA root is not a git repository")
	}
	branch, _ := runGitCommand(ctx, abs, "branch", "--show-current")
	if strings.TrimSpace(branch) == "" {
		branch, _ = runGitCommand(ctx, abs, "rev-parse", "--short", "HEAD")
	}
	commit, _ := runGitCommand(ctx, abs, "rev-parse", "--short", "HEAD")
	status, _ := runGitCommand(ctx, abs, "status", "--short")
	upstream, upstreamErr := runGitCommand(ctx, abs, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
	upstreamConfigured := upstreamErr == nil && strings.TrimSpace(upstream) != ""
	if !upstreamConfigured {
		// runGitCommand returns Git's stderr as output. Do not mistake an error such
		// as "no upstream configured" for the name of a tracking branch.
		upstream = ""
	}
	ahead := 0
	behind := 0
	if upstreamConfigured {
		aheadBehind, err := runGitCommand(ctx, abs, "rev-list", "--left-right", "--count", "HEAD...@{u}")
		if err != nil {
			return nil, err
		}
		parts := strings.Fields(aheadBehind)
		if len(parts) < 2 {
			return nil, fmt.Errorf("unexpected git ahead/behind output: %q", aheadBehind)
		}
		ahead, err = strconv.Atoi(parts[0])
		if err != nil {
			return nil, fmt.Errorf("invalid git ahead count %q: %w", parts[0], err)
		}
		behind, err = strconv.Atoi(parts[1])
		if err != nil {
			return nil, fmt.Errorf("invalid git behind count %q: %w", parts[1], err)
		}
	}
	return map[string]interface{}{
		"ok": true, "root": abs, "branch": strings.TrimSpace(branch), "commit": strings.TrimSpace(commit),
		"upstream": strings.TrimSpace(upstream), "upstream_configured": upstreamConfigured,
		"ahead": ahead, "behind": behind, "latest": upstreamConfigured && behind == 0,
		"dirty": strings.TrimSpace(status) != "", "status": status,
	}, nil
}

func (s *Server) gaGitStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, 405, "method not allowed")
		return
	}
	root := strings.TrimSpace(s.CfgStore.Cfg.GARoot)
	if root == "" {
		bad(w, 400, "ga_root is not configured")
		return
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}

	// Keep page load fast: local git status by default. Network fetch can block
	// on slow remotes or credential prompts, so run it only when explicitly asked.
	remote := r.URL.Query().Get("remote") == "1" || strings.EqualFold(r.URL.Query().Get("fetch"), "true")
	timeout := 5 * time.Second
	if remote {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()

	var fetchOut string
	var fetchErr error
	if remote {
		fetchOut, fetchErr = runGitCommand(ctx, abs, "fetch", "--all", "--prune")
	}
	st, err := gaGitStatusForRoot(ctx, abs)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	st["remote_checked"] = remote
	if fetchErr != nil {
		st["fetch_error"] = strings.TrimSpace(fetchOut + "\n" + fetchErr.Error())
	}
	writeJSON(w, st)
}

func (s *Server) gaGitUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	root := strings.TrimSpace(s.CfgStore.Cfg.GARoot)
	if root == "" {
		bad(w, 400, "ga_root is not configured")
		return
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	if st, err := os.Stat(filepath.Join(abs, ".git")); err != nil || !st.IsDir() {
		bad(w, 400, "GA root is not a git repository")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	before, _ := runGitCommand(ctx, abs, "rev-parse", "--short", "HEAD")
	branch, _ := runGitCommand(ctx, abs, "branch", "--show-current")
	statusBefore, _ := runGitCommand(ctx, abs, "status", "--short")
	fetchOut, err := runGitCommand(ctx, abs, "fetch", "--all", "--prune")
	if err != nil {
		bad(w, 500, strings.TrimSpace(fetchOut+"\n"+err.Error()))
		return
	}
	upstream, upstreamErr := runGitCommand(ctx, abs, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
	if upstreamErr != nil || strings.TrimSpace(upstream) == "" {
		bad(w, 400, "current GA branch has no upstream; configure a tracking branch before updating")
		return
	}
	pullOut, err := runGitCommand(ctx, abs, "pull", "--ff-only")
	if err != nil {
		bad(w, 500, strings.TrimSpace(pullOut+"\n"+err.Error()))
		return
	}
	after, _ := runGitCommand(ctx, abs, "rev-parse", "--short", "HEAD")
	statusAfter, _ := runGitCommand(ctx, abs, "status", "--short")
	writeJSON(w, map[string]interface{}{
		"ok": true, "root": abs, "branch": branch, "before": before, "after": after,
		"changed": before != after, "status_before": statusBefore, "status_after": statusAfter,
		"fetch": fetchOut, "pull": pullOut,
	})
}

func (s *Server) setupState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, 405, "method not allowed")
		return
	}
	cfg := s.CfgStore.Cfg
	root := strings.TrimSpace(cfg.GARoot)
	state := map[string]interface{}{
		"ok":             true,
		"bootstrap_done": cfg.BootstrapDone,
		"ga_root":        root,
		"python":         cfg.EffectivePython,
		"checked":        time.Now().Format(time.RFC3339),
	}
	if root != "" {
		state["health"] = ga.BuildHealth(root)
		state["venv"] = setupVenvStatus(root)
	}
	writeJSON(w, state)
}

func setupRequestRoot(r *http.Request, fallback string) (string, error) {
	var req setupRootReq
	if r.Body != nil {
		if err := decode(r, &req); err != nil {
			return "", err
		}
	}
	root := strings.TrimSpace(req.Root)
	if root == "" {
		root = strings.TrimSpace(fallback)
	}
	if root == "" {
		return "", errors.New("GA root is required")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	return abs, nil
}

func setupVenvDir(root string) string {
	return filepath.Join(root, ".venv")
}

func setupVenvPython(root string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(setupVenvDir(root), "Scripts", "python.exe")
	}
	return filepath.Join(setupVenvDir(root), "bin", "python")
}

func setupVenvStatus(root string) map[string]interface{} {
	py := setupVenvPython(root)
	_, err := os.Stat(py)
	return map[string]interface{}{"path": setupVenvDir(root), "python": py, "ok": err == nil}
}

func pythonForSetup(root string, cfg config.AppConfig) string {
	venvPy := setupVenvPython(root)
	if _, err := os.Stat(venvPy); err == nil {
		return venvPy
	}
	if strings.TrimSpace(cfg.EffectivePython) != "" {
		return strings.TrimSpace(cfg.EffectivePython)
	}
	if strings.TrimSpace(cfg.PythonPath) != "" {
		return strings.TrimSpace(cfg.PythonPath)
	}
	return "python"
}

func (s *Server) setupVenvCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	root, err := setupRequestRoot(r, s.CfgStore.Cfg.GARoot)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	if h := ga.BuildHealth(root); !h.OK {
		bad(w, 400, "GA root health check failed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), setupCommandTimeout)
	defer cancel()
	out, err := runSetupCommandOutputFunc(ctx, root, pythonForSetup(root, s.CfgStore.Cfg), "-m", "venv", setupVenvDir(root))
	if err != nil {
		bad(w, 500, strings.TrimSpace(out)+": "+err.Error())
		return
	}
	cfg := s.CfgStore.Cfg
	cfg.GARoot = root
	cfg.PythonPath = setupVenvPython(root)
	if err := s.CfgStore.Save(cfg); err != nil {
		bad(w, 500, err.Error())
		return
	}
	s.Svc.SetRoot(s.CfgStore.Cfg.GARoot, s.CfgStore.Cfg.EffectivePython, s.CfgStore.Cfg.BufferLines)
	writeJSON(w, map[string]interface{}{"ok": true, "root": root, "venv": setupVenvStatus(root), "output": strings.TrimSpace(out), "config": s.CfgStore.Cfg})
}

func (s *Server) setupDepsInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	root, err := setupRequestRoot(r, s.CfgStore.Cfg.GARoot)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	if h := ga.BuildHealth(root); !h.OK {
		bad(w, 400, "GA root health check failed")
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, _ := w.(http.Flusher)
	emit := func(ev setupStreamEvent) {
		b, _ := json.Marshal(ev)
		_, _ = w.Write(append(b, '\n'))
		if flusher != nil {
			flusher.Flush()
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), setupCommandTimeout)
	defer cancel()
	python := pythonForSetup(root, s.CfgStore.Cfg)
	emit(setupStreamEvent{Type: "start", Line: fmt.Sprintf("%s -m pip install -e .", python)})
	code, err := runSetupCommandStreamFunc(ctx, root, emit, python, "-m", "pip", "install", "-e", ".")
	if err != nil {
		emit(setupStreamEvent{Type: "done", OK: false, Code: code, Error: err.Error()})
		return
	}
	emit(setupStreamEvent{Type: "done", OK: true, Code: code})
}

func (s *Server) setupSmoke(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	root, err := setupRequestRoot(r, s.CfgStore.Cfg.GARoot)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	h := ga.BuildHealth(root)
	if !h.OK {
		bad(w, 400, "GA root health check failed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	python := pythonForSetup(root, s.CfgStore.Cfg)
	out, err := runSetupCommandOutputFunc(ctx, root, python, "-c", "import sys; print(sys.executable)")
	if err != nil {
		bad(w, 500, strings.TrimSpace(out)+": "+err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "root": root, "python": strings.TrimSpace(out), "health": h, "venv": setupVenvStatus(root)})
}

func (s *Server) setupComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	root, err := setupRequestRoot(r, s.CfgStore.Cfg.GARoot)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	h := ga.BuildHealth(root)
	if !h.OK {
		bad(w, 400, "GA root health check failed")
		return
	}
	cfg := s.CfgStore.Cfg
	cfg.GARoot = root
	if py := setupVenvPython(root); strings.TrimSpace(cfg.PythonPath) == "" {
		if _, err := os.Stat(py); err == nil {
			cfg.PythonPath = py
		}
	}
	cfg.BootstrapDone = true
	if err := s.CfgStore.Save(cfg); err != nil {
		bad(w, 500, err.Error())
		return
	}
	s.Svc.SetRoot(s.CfgStore.Cfg.GARoot, s.CfgStore.Cfg.EffectivePython, s.CfgStore.Cfg.BufferLines)
	writeJSON(w, map[string]interface{}{"ok": true, "root": root, "health": h, "config": s.CfgStore.Cfg})
}

func (s *Server) setupValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	var req setupPathReq
	if err := decode(r, &req); err != nil {
		bad(w, 400, err.Error())
		return
	}
	root := strings.TrimSpace(req.Path)
	if root == "" {
		bad(w, 400, "path is required")
		return
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	h := ga.BuildHealth(abs)
	if h.OK {
		cfg := s.CfgStore.Cfg
		cfg.GARoot = abs
		if err := s.CfgStore.Save(cfg); err != nil {
			bad(w, 500, err.Error())
			return
		}
	}
	writeJSON(w, map[string]interface{}{"ok": h.OK, "root": abs, "health": h})
}

func (s *Server) setupPythonInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	if runtime.GOOS != "windows" {
		bad(w, 400, "automatic Python installer is only supported on Windows")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), setupPythonInstallTimeout)
	defer cancel()
	pythonPath, out, err := runPythonInstallerFunc(ctx)
	if err != nil {
		bad(w, 500, strings.TrimSpace(out+": "+err.Error()))
		return
	}
	if strings.TrimSpace(pythonPath) == "" {
		bad(w, 500, "Python installer completed but python.exe was not found")
		return
	}
	cfg := s.CfgStore.Cfg
	cfg.PythonPath = strings.TrimSpace(pythonPath)
	if err := s.CfgStore.Save(cfg); err != nil {
		bad(w, 500, err.Error())
		return
	}
	s.Svc.SetRoot(s.CfgStore.Cfg.GARoot, s.CfgStore.Cfg.EffectivePython, s.CfgStore.Cfg.BufferLines)
	writeJSON(w, map[string]interface{}{"ok": true, "python": s.CfgStore.Cfg.EffectivePython, "output": strings.TrimSpace(out), "config": s.CfgStore.Cfg})
}

func runWindowsPythonInstaller(ctx context.Context) (string, string, error) {
	installer, err := downloadPythonInstaller(ctx, defaultWindowsPythonURL)
	if err != nil {
		return "", "", err
	}
	defer os.Remove(installer)
	targetDir := defaultWindowsPythonDir()
	args := []string{"/quiet", "InstallAllUsers=0", "PrependPath=0", "Include_launcher=1", "Include_pip=1", "TargetDir=" + targetDir}
	cmd := exec.CommandContext(ctx, installer, args...)
	hideChildWindow(cmd)
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		return "", text, err
	}
	pythonPath := filepath.Join(targetDir, "python.exe")
	if _, err := os.Stat(pythonPath); err != nil {
		return "", text, err
	}
	return pythonPath, text, nil
}

func defaultWindowsPythonDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if strings.TrimSpace(base) == "" {
		if dir, err := os.UserConfigDir(); err == nil && dir != "" {
			base = dir
		} else if home, err := os.UserHomeDir(); err == nil && home != "" {
			base = filepath.Join(home, "AppData", "Local")
		} else {
			base = os.TempDir()
		}
	}
	return filepath.Join(base, "Programs", "Python", "Python312")
}

func downloadPythonInstaller(ctx context.Context, installerURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, installerURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("download Python installer failed: %s", resp.Status)
	}
	f, err := os.CreateTemp("", "python-installer-*.exe")
	if err != nil {
		return "", err
	}
	path := f.Name()
	_, copyErr := io.Copy(f, resp.Body)
	closeErr := f.Close()
	if copyErr != nil {
		os.Remove(path)
		return "", copyErr
	}
	if closeErr != nil {
		os.Remove(path)
		return "", closeErr
	}
	return path, nil
}

func (s *Server) setupInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	var req setupPathReq
	if err := decode(r, &req); err != nil {
		bad(w, 400, err.Error())
		return
	}
	installDir := strings.TrimSpace(req.Path)
	if installDir == "" {
		bad(w, 400, "install directory is required")
		return
	}
	parentAbs, err := filepath.Abs(installDir)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	if unsafeSetupPath(parentAbs) {
		bad(w, 400, "refusing to install GenericAgent under filesystem root")
		return
	}
	targetAbs := filepath.Join(parentAbs, "GenericAgent")
	if _, err := os.Stat(filepath.Join(targetAbs, "agentmain.py")); err == nil {
		bad(w, 409, "target already looks like a GenericAgent directory")
		return
	}
	if err := os.MkdirAll(parentAbs, 0755); err != nil {
		bad(w, 500, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), setupInstallCloneTimeout)
	defer cancel()
	method, out, err := installGenericAgentSource(ctx, targetAbs)
	if err != nil {
		bad(w, 500, strings.TrimSpace(out))
		return
	}
	h := ga.BuildHealth(targetAbs)
	if !h.OK {
		bad(w, 500, "clone completed but GenericAgent health check failed")
		return
	}
	cfg := s.CfgStore.Cfg
	cfg.GARoot = targetAbs
	if err := s.CfgStore.Save(cfg); err != nil {
		bad(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "root": targetAbs, "install_dir": parentAbs, "health": h, "method": method, "output": strings.TrimSpace(out)})
}

func (s *Server) autostartStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, 405, "method not allowed")
		return
	}
	writeJSON(w, autostart.StatusForCurrent())
}

func (s *Server) autostartEnable(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	st, err := autostart.EnableCurrent()
	if err != nil {
		bad(w, 500, err.Error())
		return
	}
	writeJSON(w, st)
}

func (s *Server) autostartDisable(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	st, err := autostart.DisableCurrent()
	if err != nil {
		bad(w, 500, err.Error())
		return
	}
	writeJSON(w, st)
}

func (s *Server) StartAutostartServices() {
	for _, name := range s.CfgStore.Cfg.ServiceAutostart {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if _, err := s.Svc.Start(name); err != nil {
			log.Printf("service autostart %s failed: %v", name, err)
		}
	}
}
