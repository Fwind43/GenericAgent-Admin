package desktop

import "sync"

type taskbarState string

const (
	taskbarIdle          taskbarState = "idle"
	taskbarRunning       taskbarState = "running"
	taskbarWaiting       taskbarState = "waiting"
	taskbarCompleted     taskbarState = "completed"
	taskbarFailed        taskbarState = "failed"
	nativeTaskbarBinding              = "__gaTaskbarState"
)

func taskbarPriority(state taskbarState) int {
	switch state {
	case taskbarWaiting:
		return 4
	case taskbarFailed:
		return 3
	case taskbarRunning:
		return 2
	case taskbarCompleted:
		return 1
	default:
		return 0
	}
}

func validTaskbarState(state taskbarState) bool {
	return state == taskbarIdle || taskbarPriority(state) > 0
}

// Windows groups taskbar buttons by AppUserModelID and displays the last
// overlay set. Give every live window the same aggregate to avoid races.
type taskbarRegistry struct {
	mu     sync.Mutex
	states map[uintptr]taskbarState
}

func (r *taskbarRegistry) set(hwnd uintptr, state taskbarState) bool {
	if !validTaskbarState(state) {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.states == nil {
		r.states = make(map[uintptr]taskbarState)
	}
	if old, exists := r.states[hwnd]; exists && old == state {
		return false
	}
	r.states[hwnd] = state
	return true
}

func (r *taskbarRegistry) remove(hwnd uintptr) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.states, hwnd)
}

func (r *taskbarRegistry) snapshot() (taskbarState, []uintptr) {
	r.mu.Lock()
	defer r.mu.Unlock()
	state := taskbarIdle
	windows := make([]uintptr, 0, len(r.states))
	for hwnd, candidate := range r.states {
		windows = append(windows, hwnd)
		if taskbarPriority(candidate) > taskbarPriority(state) {
			state = candidate
		}
	}
	return state, windows
}
