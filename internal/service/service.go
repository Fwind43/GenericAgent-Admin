package service

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

type ServiceInfo struct {
	Name       string   `json:"name"`
	Kind       string   `json:"kind"`
	Command    []string `json:"command"`
	WorkDir    string   `json:"workdir"`
	Running    bool     `json:"running"`
	PID        *int     `json:"pid"`
	ReturnCode *int     `json:"returncode"`
	StartedAt  string   `json:"started_at,omitempty"`
	Autostart  bool     `json:"autostart,omitempty"`
}

type runningProc struct {
	cmd       *exec.Cmd
	ret       *int
	startedAt time.Time
}

type Manager struct {
	GARoot      string
	BufferLines int
	mu          sync.Mutex
	procs       map[string]*runningProc
	buffers     map[string][]string
}

func NewManager(gaRoot string, bufferLines int) *Manager {
	if bufferLines <= 0 {
		bufferLines = 1000
	}
	return &Manager{GARoot: gaRoot, BufferLines: bufferLines, procs: map[string]*runningProc{}, buffers: map[string][]string{}}
}

func (m *Manager) SetRoot(root string, bufferLines int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.GARoot = root
	if bufferLines > 0 {
		m.BufferLines = bufferLines
	}
}

func (m *Manager) python() string {
	cands := []string{}
	if runtime.GOOS == "windows" {
		cands = append(cands, filepath.Join(m.GARoot, ".venv", "Scripts", "python.exe"), filepath.Join(m.GARoot, "venv", "Scripts", "python.exe"))
	} else {
		cands = append(cands, filepath.Join(m.GARoot, ".venv", "bin", "python"), filepath.Join(m.GARoot, "venv", "bin", "python"))
	}
	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return "python"
}

func excluded(name string) bool {
	switch name {
	case "chatapp_common.py", "goal_mode.py":
		return true
	}
	return false
}

func existsFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func (m *Manager) addIfExists(out *[]ServiceInfo, name, kind string, command []string) {
	if len(command) == 0 {
		return
	}
	if existsFile(filepath.Join(m.GARoot, name)) {
		*out = append(*out, ServiceInfo{Name: filepath.ToSlash(name), Kind: kind, Command: command, WorkDir: m.GARoot})
	}
}

func (m *Manager) Discover() []ServiceInfo {
	py := m.python()
	var out []ServiceInfo

	// GA native lifecycle entries. These are not under frontends/reflect but are essential to taking over GA.
	m.addIfExists(&out, "hub.pyw", "core", []string{py, "hub.pyw"})
	m.addIfExists(&out, "launch.py", "core", []string{py, "launch.py"})
	m.addIfExists(&out, "agent_loop.py", "core", []string{py, "agent_loop.py"})
	m.addIfExists(&out, filepath.Join("reflect", "scheduler.py"), "reflect", []string{py, "agentmain.py", "--reflect", filepath.ToSlash(filepath.Join("reflect", "scheduler.py"))})
	m.addIfExists(&out, filepath.Join("reflect", "autonomous.py"), "reflect", []string{py, "agentmain.py", "--reflect", filepath.ToSlash(filepath.Join("reflect", "autonomous.py"))})
	m.addIfExists(&out, filepath.Join("reflect", "goal_mode.py"), "reflect", []string{py, "agentmain.py", "--reflect", filepath.ToSlash(filepath.Join("reflect", "goal_mode.py"))})

	reflectDir := filepath.Join(m.GARoot, "reflect")
	if entries, err := os.ReadDir(reflectDir); err == nil {
		sort.Slice(entries, func(i, j int) bool { return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name()) })
		seen := map[string]bool{}
		for _, s := range out {
			seen[s.Name] = true
		}
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() || !strings.HasSuffix(name, ".py") || strings.HasPrefix(name, "_") || excluded(name) {
				continue
			}
			rel := filepath.ToSlash(filepath.Join("reflect", name))
			if seen[rel] {
				continue
			}
			out = append(out, ServiceInfo{Name: rel, Kind: "reflect", Command: []string{py, "agentmain.py", "--reflect", rel}, WorkDir: m.GARoot})
		}
	}
	frontDir := filepath.Join(m.GARoot, "frontends")
	if entries, err := os.ReadDir(frontDir); err == nil {
		sort.Slice(entries, func(i, j int) bool { return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name()) })
		for _, e := range entries {
			name := e.Name()
			lowerName := strings.ToLower(name)
			stem := strings.TrimSuffix(lowerName, ".py")
			if e.IsDir() || !strings.HasSuffix(lowerName, ".py") || !strings.HasSuffix(stem, "app") || strings.HasPrefix(name, "_") || excluded(name) {
				continue
			}
			rel := filepath.ToSlash(filepath.Join("frontends", name))
			cmd := []string{py, rel}
			if strings.Contains(strings.ToLower(name), "stapp") {
				cmd = []string{py, "-m", "streamlit", "run", rel, "--server.headless=true"}
			}
			out = append(out, ServiceInfo{Name: rel, Kind: "frontend", Command: cmd, WorkDir: m.GARoot})
		}
	}
	for i := range out {
		out[i] = m.withState(out[i])
	}
	return out
}

func (m *Manager) withState(s ServiceInfo) ServiceInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	if p, ok := m.procs[s.Name]; ok {
		if p.cmd.Process != nil && p.ret == nil {
			pid := p.cmd.Process.Pid
			if processAlive(pid) {
				s.PID = &pid
				s.Running = true
				if !p.startedAt.IsZero() {
					s.StartedAt = p.startedAt.Format(time.RFC3339)
				}
			} else {
				code := -1
				p.ret = &code
				m.appendLocked(s.Name, fmt.Sprintf("[process exited: pid %d is no longer alive]", pid))
			}
		}
		if p.ret != nil {
			s.ReturnCode = p.ret
		}
	}
	return s
}

func (m *Manager) Find(name string) (ServiceInfo, bool) {
	for _, s := range m.Discover() {
		if s.Name == name {
			return s, true
		}
	}
	return ServiceInfo{}, false
}

func (m *Manager) Start(name string) (ServiceInfo, error) {
	return m.StartWithParams(name, nil)
}

func buildServiceArgs(s ServiceInfo, params map[string]string) ([]string, error) {
	cmdArgs := append([]string{}, s.Command[1:]...)
	if len(params) == 0 {
		return cmdArgs, nil
	}
	if s.Kind != "reflect" {
		return cmdArgs, nil
	}
	llmNo := strings.TrimSpace(params["llm_no"])
	if llmNo == "" {
		return cmdArgs, nil
	}
	for _, ch := range llmNo {
		if ch < '0' || ch > '9' {
			return nil, fmt.Errorf("invalid llm_no %q: must be a non-negative integer", llmNo)
		}
	}
	return append(cmdArgs, "--llm_no", llmNo), nil
}

func (m *Manager) StartWithParams(name string, params map[string]string) (ServiceInfo, error) {
	s, ok := m.Find(name)
	if !ok {
		return s, errors.New("service not found")
	}
	m.mu.Lock()
	if p, ok := m.procs[name]; ok && p.cmd.Process != nil && p.ret == nil {
		pid := p.cmd.Process.Pid
		if processAlive(pid) {
			m.mu.Unlock()
			return m.withState(s), nil
		}
		code := -1
		p.ret = &code
		m.appendLocked(name, fmt.Sprintf("[process exited: pid %d is no longer alive]", pid))
	}

	cmdArgs, err := buildServiceArgs(s, params)
	if err != nil {
		m.mu.Unlock()
		return s, err
	}

	m.buffers[name] = []string{fmt.Sprintf("$ %s %s", s.Command[0], strings.Join(cmdArgs, " "))}
	m.mu.Unlock()
	if killed, err := m.stopConflictingService(s); err != nil {
		return s, err
	} else if len(killed) > 0 {
		m.mu.Lock()
		for _, pid := range killed {
			m.appendLocked(name, fmt.Sprintf("[force restart] stopped existing instance pid=%d", pid))
		}
		m.mu.Unlock()
		// Give singleton locks/ports a short moment to be released before starting the managed instance.
		time.Sleep(500 * time.Millisecond)
	}
	cmd := exec.Command(s.Command[0], cmdArgs...)
	cmd.Dir = m.GARoot
	hideChildWindow(cmd)
	cmd.Env = m.serviceEnv()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return s, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return s, err
	}
	if err := cmd.Start(); err != nil {
		return s, err
	}
	m.mu.Lock()
	m.procs[name] = &runningProc{cmd: cmd, startedAt: time.Now()}
	m.mu.Unlock()
	go m.readPipe(name, stdout)
	go m.readPipe(name, stderr)
	go func() {
		err := cmd.Wait()
		code := 0
		if err != nil {
			if ee, ok := err.(*exec.ExitError); ok {
				code = ee.ExitCode()
			} else {
				code = -1
			}
		}
		m.mu.Lock()
		if p := m.procs[name]; p != nil {
			p.ret = &code
		}
		m.appendLocked(name, fmt.Sprintf("[process exited rc=%d]", code))
		m.mu.Unlock()
	}()
	return m.withState(s), nil
}

func (m *Manager) serviceEnv() []string {
	env := append([]string{}, os.Environ()...)
	env = append(env, "PYTHONUNBUFFERED=1", "PYTHONIOENCODING=utf-8", "PYTHONUTF8=1")
	return env
}

const maxLogLineBytes = 1024 * 1024

func (m *Manager) readPipe(name string, r io.Reader) {
	reader := bufio.NewReaderSize(r, 64*1024)
	line := make([]byte, 0, 64*1024)
	truncated := false
	for {
		chunk, err := reader.ReadSlice('\n')
		if len(chunk) > 0 {
			if len(line) < maxLogLineBytes {
				remaining := maxLogLineBytes - len(line)
				if len(chunk) > remaining {
					line = append(line, chunk[:remaining]...)
					truncated = true
				} else {
					line = append(line, chunk...)
				}
			} else {
				truncated = true
			}
		}
		if err == nil {
			m.appendLogLine(name, line, truncated)
			line = line[:0]
			truncated = false
			continue
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if len(line) > 0 || truncated {
			m.appendLogLine(name, line, truncated)
		}
		return
	}
}

func (m *Manager) appendLogLine(name string, line []byte, truncated bool) {
	text := strings.TrimRight(string(line), "\r\n")
	if truncated {
		text += " [truncated]"
	}
	m.mu.Lock()
	m.appendLocked(name, text)
	m.mu.Unlock()
}

func (m *Manager) appendLocked(name, line string) {
	b := append(m.buffers[name], line)
	if len(b) > m.BufferLines {
		b = b[len(b)-m.BufferLines:]
	}
	m.buffers[name] = b
}

func (m *Manager) Stop(name string) error {
	if _, ok := m.Find(name); !ok {
		return errors.New("service not found")
	}
	m.mu.Lock()
	p := m.procs[name]
	if p == nil || p.cmd.Process == nil || p.ret != nil {
		m.mu.Unlock()
		return nil
	}
	pid := p.cmd.Process.Pid
	m.appendLocked(name, fmt.Sprintf("[admin] stopping pid %d", pid))
	m.mu.Unlock()

	if pid <= 0 {
		return errors.New("invalid process pid")
	}
	if !processAlive(pid) {
		m.mu.Lock()
		m.appendLocked(name, fmt.Sprintf("[admin] pid %d is already stopped", pid))
		m.mu.Unlock()
		return nil
	}
	if err := p.cmd.Process.Kill(); err != nil {
		if !processAlive(pid) {
			return nil
		}
		return err
	}
	deadline := time.Now().Add(5 * time.Second)
	for processAlive(pid) && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}
	if processAlive(pid) {
		return fmt.Errorf("process %d still alive after stop", pid)
	}
	m.mu.Lock()
	m.appendLocked(name, fmt.Sprintf("[admin] stopped pid %d", pid))
	m.mu.Unlock()
	return nil
}

func (m *Manager) StopAll() {
	for _, s := range m.Discover() {
		_ = m.Stop(s.Name)
	}
}

func (m *Manager) Logs(name string, lines int) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	b := append([]string{}, m.buffers[name]...)
	if lines > 0 && len(b) > lines {
		b = b[len(b)-lines:]
	}
	return b
}

func (m *Manager) Summary() map[string]int {
	items := m.Discover()
	running := 0
	for _, s := range items {
		if s.Running {
			running++
		}
	}
	return map[string]int{"total": len(items), "running": running, "stopped": len(items) - running}
}
