//go:build windows

package desktop

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"unsafe"

	"github.com/jchv/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

// The window that holds the WebView2 control is built here rather than taken
// from go-webview2, whose message loop hands every message to
// IsDialogMessage first. That call is meant to give a dialog's controls tab
// traversal, and it answers "handled" to the private messages an input method
// exchanges with the focused window; the loop then drops them. The window ends
// up accepting Latin letters, which need no input method, while Chinese,
// Japanese and Korean typing never even opens a candidate list. Owning the
// loop is the only way to keep those messages: the queue that go-webview2
// drains inside its loop is unexported, so it cannot be pumped from outside.
//
// Nothing is lost by leaving IsDialogMessage out. It only matters when a
// window holds several native controls to tab between, and this one holds a
// single WebView2 child that does its own tab handling inside the page.
var (
	procRegisterClassExW = user32.NewProc("RegisterClassExW")
	procCreateWindowExW  = user32.NewProc("CreateWindowExW")
	procDestroyWindow    = user32.NewProc("DestroyWindow")
	procDefWindowProcW   = user32.NewProc("DefWindowProcW")
	procUpdateWindow     = user32.NewProc("UpdateWindow")
	procSetFocus         = user32.NewProc("SetFocus")
	procPostQuitMessage  = user32.NewProc("PostQuitMessage")
	procPostMessageW     = user32.NewProc("PostMessageW")
	procGetMessageW      = user32.NewProc("GetMessageW")
	procTranslateMessage = user32.NewProc("TranslateMessage")
	procDispatchMessageW = user32.NewProc("DispatchMessageW")
	procLoadCursorW      = user32.NewProc("LoadCursorW")
)

const (
	wsOverlappedWindow = 0x00CF0000
	idcArrow           = 32512
	swShow             = 5

	wmDestroy       = 0x0002
	wmMove          = 0x0003
	wmSize          = 0x0005
	wmActivate      = 0x0006
	wmSetFocus      = 0x0007
	wmClose         = 0x0010
	wmQuit          = 0x0012
	wmGetMinMaxInfo = 0x0024
	wmNCLButtonDown = 0x00A1
	wmMoving        = 0x0216
	wmDPIChanged    = 0x02E0
	// WM_APP is the first message id the system leaves to applications; it
	// carries the "run the queued work" signal.
	wmApp = 0x8000

	waInactive = 0
)

type win32Point struct{ X, Y int32 }

type win32Rect struct{ Left, Top, Right, Bottom int32 }

type win32MinMaxInfo struct {
	Reserved     win32Point
	MaxSize      win32Point
	MaxPosition  win32Point
	MinTrackSize win32Point
	MaxTrackSize win32Point
}

type win32Msg struct {
	HWnd     uintptr
	Message  uint32
	WParam   uintptr
	LParam   uintptr
	Time     uint32
	Pt       win32Point
	LPrivate uint32
}

type win32WndClassExW struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   windows.Handle
	Icon       windows.Handle
	Cursor     windows.Handle
	Background windows.Handle
	MenuName   *uint16
	ClassName  *uint16
	IconSm     windows.Handle
}

// hostWindow is a top-level window with a WebView2 control stretched across
// its client area. One window owns one OS thread for its whole life, because
// WebView2 delivers everything to the thread that created it.
type hostWindow struct {
	hwnd    uintptr
	browser *edge.Chromium
	minSize win32Point
	taskbar taskbarOverlay

	// handlers is only ever touched from the window's own thread: bindings
	// are registered before the first navigation and called from the message
	// loop that follows.
	handlers map[string]func([]json.RawMessage)

	mu     sync.Mutex
	queued []func()
}

var (
	hostWindowsMu sync.RWMutex
	hostWindows   = map[uintptr]*hostWindow{}
)

func lookupHostWindow(hwnd uintptr) *hostWindow {
	hostWindowsMu.RLock()
	defer hostWindowsMu.RUnlock()
	return hostWindows[hwnd]
}

func rememberHostWindow(hwnd uintptr, win *hostWindow) {
	hostWindowsMu.Lock()
	defer hostWindowsMu.Unlock()
	hostWindows[hwnd] = win
}

func forgetHostWindow(hwnd uintptr) {
	hostWindowsMu.Lock()
	defer hostWindowsMu.Unlock()
	delete(hostWindows, hwnd)
}

const hostWindowClassName = "GenericAgentWebViewHost"

var (
	hostClassOnce     sync.Once
	hostClassName     *uint16
	hostClassInstance windows.Handle
	hostClassErr      error
)

// registerHostClass registers the window class shared by every host window.
// It runs once per process: the class is process-wide, and so is the callback
// Windows is handed, which comes out of a pool the runtime caps at a few
// thousand entries.
func registerHostClass() error {
	hostClassOnce.Do(func() {
		if err := windows.GetModuleHandleEx(0, nil, &hostClassInstance); err != nil {
			hostClassErr = fmt.Errorf("locate module handle: %w", err)
			return
		}
		name, err := windows.UTF16PtrFromString(hostWindowClassName)
		if err != nil {
			hostClassErr = fmt.Errorf("window class name: %w", err)
			return
		}
		cursor, _, _ := procLoadCursorW.Call(0, idcArrow)
		class := win32WndClassExW{
			Size:      uint32(unsafe.Sizeof(win32WndClassExW{})),
			WndProc:   windows.NewCallback(hostWndProc),
			Instance:  hostClassInstance,
			Cursor:    windows.Handle(cursor),
			ClassName: name,
		}
		if atom, _, callErr := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&class))); atom == 0 {
			hostClassErr = fmt.Errorf("register window class: %w", callErr)
			return
		}
		hostClassName = name
	})
	return hostClassErr
}

// newHostWindow opens the window and embeds the control. It must run on the
// thread that will later pump the window's messages.
func newHostWindow(spec desktopWindowSpec) (*hostWindow, error) {
	if err := registerHostClass(); err != nil {
		return nil, err
	}
	title, err := windows.UTF16PtrFromString(spec.Title)
	if err != nil {
		return nil, fmt.Errorf("window title: %w", err)
	}

	// Sizes in the spec are layout pixels; the window is measured in device
	// pixels, which differ as soon as the display is scaled.
	width, height := scaleForDPI(spec.Width), scaleForDPI(spec.Height)
	left := (systemMetric(smCXScreen) - width) / 2
	top := (systemMetric(smCYScreen) - height) / 2

	win := &hostWindow{
		browser:  edge.NewChromium(),
		handlers: map[string]func([]json.RawMessage){},
	}
	win.browser.DataPath = spec.DataPath
	win.browser.MessageCallback = win.receive
	win.browser.SetPermission(edge.CoreWebView2PermissionKindClipboardRead, edge.CoreWebView2PermissionStateAllow)
	if spec.MinWidth > 0 && spec.MinHeight > 0 {
		win.minSize = win32Point{
			X: int32(scaleForDPI(spec.MinWidth)),
			Y: int32(scaleForDPI(spec.MinHeight)),
		}
	}

	hwnd, _, callErr := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(hostClassName)),
		uintptr(unsafe.Pointer(title)),
		wsOverlappedWindow,
		uintptr(left), uintptr(top), uintptr(width), uintptr(height),
		0, 0, uintptr(hostClassInstance), 0,
	)
	if hwnd == 0 {
		return nil, fmt.Errorf("create window: %w", callErr)
	}
	win.hwnd = hwnd
	rememberHostWindow(hwnd, win)
	taskbarWindows.set(hwnd, taskbarIdle)

	_, _, _ = procShowWindow.Call(hwnd, swShow)
	_, _, _ = procUpdateWindow.Call(hwnd)
	_, _, _ = procSetFocus.Call(hwnd)

	// Embed runs its own loop until the control is ready, so the window is
	// already on screen and answering messages by the time it returns.
	if !win.browser.Embed(hwnd) {
		win.discard()
		return nil, errors.New("webview2 control could not be embedded")
	}
	win.browser.Resize()
	if err := win.applySettings(); err != nil {
		win.discard()
		return nil, err
	}
	return win, nil
}

// discard tears the window down before anyone starts pumping its messages.
// The registration goes first so that the WM_DESTROY which follows cannot
// reach a window proc that would post WM_QUIT to a thread with no loop left
// to read it.
func (w *hostWindow) discard() {
	w.closeTaskbar()
	forgetHostWindow(w.hwnd)
	_, _, _ = procDestroyWindow.Call(w.hwnd)
	w.hwnd = 0
}

// applySettings keeps native editing affordances while removing browser-only
// developer tooling. The default context menu is required for copy, paste,
// text selection, and other standard desktop actions.
func (w *hostWindow) applySettings() error {
	settings, err := w.browser.GetSettings()
	if err != nil {
		return fmt.Errorf("read webview settings: %w", err)
	}
	if err := settings.PutAreDefaultContextMenusEnabled(true); err != nil {
		return fmt.Errorf("enable webview context menus: %w", err)
	}
	if err := settings.PutAreDevToolsEnabled(false); err != nil {
		return fmt.Errorf("disable webview devtools: %w", err)
	}
	return nil
}

// bind publishes fn to the page as a global function. Calls travel one way:
// the page gets no result back, which is all this app asks for and spares the
// bridge a reply queue that would have to outlive a closing window.
func (w *hostWindow) bind(name string, fn func(args []json.RawMessage)) error {
	if _, taken := w.handlers[name]; taken {
		return fmt.Errorf("binding %q is already registered", name)
	}
	quoted, err := json.Marshal(name)
	if err != nil {
		return fmt.Errorf("binding name %q: %w", name, err)
	}
	w.handlers[name] = fn
	// Scripts registered this way run before anything on the page does, but
	// only on documents opened afterwards, so every binding has to be in
	// place before the first navigation.
	w.browser.Init("window[" + string(quoted) + "] = function() {" +
		"window.chrome.webview.postMessage(JSON.stringify({" +
		"method: " + string(quoted) + ", " +
		"params: Array.prototype.slice.call(arguments)}))}")
	return nil
}

// receive is called on the window's thread whenever the page posts a message.
func (w *hostWindow) receive(raw string) {
	var call struct {
		Method string            `json:"method"`
		Params []json.RawMessage `json:"params"`
	}
	if err := json.Unmarshal([]byte(raw), &call); err != nil {
		return
	}
	if handler := w.handlers[call.Method]; handler != nil {
		handler(call.Params)
	}
}

// run pumps messages until the window closes.
func (w *hostWindow) run() {
	var msg win32Msg
	for {
		ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		// Zero means WM_QUIT; -1 means the queue itself has failed and
		// reading it again would spin forever.
		if ret == 0 || int32(ret) == -1 {
			return
		}
		_, _, _ = procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		_, _, _ = procDispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
	}
}

// dispatch queues work for the window's own thread, which is the only one
// allowed to talk to the control.
func (w *hostWindow) dispatch(fn func()) {
	w.mu.Lock()
	w.queued = append(w.queued, fn)
	w.mu.Unlock()
	_, _, _ = procPostMessageW.Call(w.hwnd, wmApp, 0, 0)
}

func (w *hostWindow) runQueued() {
	w.mu.Lock()
	pending := w.queued
	w.queued = nil
	w.mu.Unlock()
	for _, fn := range pending {
		fn()
	}
}

func (w *hostWindow) Focus() {
	if w.hwnd == 0 {
		return
	}
	if minimized, _, _ := procIsIconic.Call(w.hwnd); minimized != 0 {
		_, _, _ = procShowWindow.Call(w.hwnd, swRestore)
	}
	// Activation is enough to reach the page: WM_ACTIVATE moves focus into
	// the control.
	_, _, _ = procSetForegroundWindow.Call(w.hwnd)
}

func (w *hostWindow) Navigate(url string) {
	w.dispatch(func() { w.browser.Navigate(url) })
}

func (w *hostWindow) Close() {
	_, _, _ = procPostMessageW.Call(w.hwnd, wmClose, 0, 0)
}

// pointerFromLParam reads a message parameter that carries the address of a
// struct Windows filled in. The usual reason to distrust a uintptr held as a
// number — that Go's collector may move the object it names — does not apply
// to memory the OS owns.
func pointerFromLParam(lparam uintptr) unsafe.Pointer {
	return *(*unsafe.Pointer)(unsafe.Pointer(&lparam))
}

func hostWndProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	win := lookupHostWindow(hwnd)
	if win == nil {
		// Messages sent while the window is being created or torn down
		// arrive before or after the window is on the books.
		result, _, _ := procDefWindowProcW.Call(hwnd, msg, wparam, lparam)
		return result
	}

	if taskbarButtonCreated != 0 && msg == uintptr(taskbarButtonCreated) {
		win.taskbar.releaseCOM()
		win.taskbar.ready = true
		win.applyTaskbar()
		return 0
	}

	switch msg {
	case wmTaskbarRefresh:
		win.applyTaskbar()
		return 0
	case wmApp:
		win.runQueued()
		return 0
	case wmSize:
		win.browser.Resize()
		return 0
	case wmMove, wmMoving:
		// The control draws its own popups, such as the input method
		// candidate list, in screen coordinates it caches until told.
		_ = win.browser.NotifyParentWindowPositionChanged()
	case wmActivate:
		if wparam != waInactive {
			win.browser.Focus()
		}
		return 0
	case wmSetFocus:
		// Focus lands on the frame after a click on the caption or a return
		// from another window; pass it on so typing keeps working.
		win.browser.Focus()
		return 0
	case wmNCLButtonDown:
		_, _, _ = procSetFocus.Call(hwnd)
	case wmGetMinMaxInfo:
		if win.minSize.X > 0 && win.minSize.Y > 0 {
			info := (*win32MinMaxInfo)(pointerFromLParam(lparam))
			info.MinTrackSize = win.minSize
		}
		return 0
	case wmDPIChanged:
		// The process declares itself per-monitor aware, so Windows expects
		// it to resize itself when the window lands on a display with a
		// different scale.
		suggested := (*win32Rect)(pointerFromLParam(lparam))
		_, _, _ = procSetWindowPos.Call(hwnd, 0,
			uintptr(suggested.Left), uintptr(suggested.Top),
			uintptr(suggested.Right-suggested.Left),
			uintptr(suggested.Bottom-suggested.Top),
			swpNoZOrder|swpNoActivate)
		return 0
	case wmClose:
		_, _, _ = procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		win.closeTaskbar()
		forgetHostWindow(hwnd)
		// Only this thread's loop ends; every other window has its own.
		_, _, _ = procPostQuitMessage.Call(0)
		return 0
	}

	result, _, _ := procDefWindowProcW.Call(hwnd, msg, wparam, lparam)
	return result
}
