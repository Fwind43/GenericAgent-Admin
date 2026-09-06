package desktop

import "sync"

type taskbarState string

const (
	taskbarIdle          taskbarState = "idle"
	taskbarUnread        taskbarState = "unread"
	nativeTaskbarBinding              = "__gaTaskbarState"
)

func validTaskbarState(state taskbarState) bool {
	return state == taskbarIdle || state == taskbarUnread
}

// Windows groups taskbar buttons by AppUserModelID and displays the last
// overlay set. Keep the unread dot until every live window is read.
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
		if candidate == taskbarUnread {
			state = taskbarUnread
		}
	}
	return state, windows
}
