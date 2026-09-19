//go:build darwin

package desktop

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa -framework WebKit
#include "desktop_webview_darwin.h"
#include <stdlib.h>
*/
import "C"

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"unsafe"

	"genericagent-admin-go/internal/appicon"
)

// darwinWindow is a WKWebView hosted in an NSWindow. AppKit only talks to the
// main thread, which the tray already owns, so this type never runs a nested
// NSApplication loop: create/focus/navigate/close are dispatched there, and
// the goroutine that opened the window just waits until it closes.
type darwinWindow struct {
	id int32

	mu       sync.Mutex
	handlers map[string]func([]json.RawMessage)

	startOnce sync.Once
	closeOnce sync.Once
	started   chan struct{}
	failed    chan error
	closed    chan struct{}
}

var (
	darwinWindowsMu sync.RWMutex
	darwinWindows   = map[int32]*darwinWindow{}
	darwinWindowSeq int32
)

var _ desktopWindow = (*darwinWindow)(nil)

func rememberDarwinWindow(win *darwinWindow) {
	darwinWindowsMu.Lock()
	defer darwinWindowsMu.Unlock()
	darwinWindows[win.id] = win
}

func forgetDarwinWindow(id int32) {
	darwinWindowsMu.Lock()
	defer darwinWindowsMu.Unlock()
	delete(darwinWindows, id)
}

func lookupDarwinWindow(id int32) *darwinWindow {
	darwinWindowsMu.RLock()
	defer darwinWindowsMu.RUnlock()
	return darwinWindows[id]
}

func newDarwinWindow() *darwinWindow {
	return &darwinWindow{
		id:       atomic.AddInt32(&darwinWindowSeq, 1),
		handlers: map[string]func([]json.RawMessage){},
		started:  make(chan struct{}),
		failed:   make(chan error, 1),
		closed:   make(chan struct{}),
	}
}

func (w *darwinWindow) markReady() {
	w.startOnce.Do(func() { close(w.started) })
}

func (w *darwinWindow) markFailed(err error) {
	w.startOnce.Do(func() { w.failed <- err })
}

func (w *darwinWindow) markClosed() {
	w.closeOnce.Do(func() { close(w.closed) })
}

func (w *darwinWindow) receive(raw string) {
	var call struct {
		Method string            `json:"method"`
		Params []json.RawMessage `json:"params"`
	}
	if err := json.Unmarshal([]byte(raw), &call); err != nil {
		return
	}
	w.mu.Lock()
	handler := w.handlers[call.Method]
	w.mu.Unlock()
	if handler != nil {
		handler(call.Params)
	}
}

func (w *darwinWindow) bind(name string, fn func(args []json.RawMessage)) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, taken := w.handlers[name]; taken {
		return fmt.Errorf("binding %q is already registered", name)
	}
	w.handlers[name] = fn
	return nil
}

func (w *darwinWindow) Focus() {
	C.ga_desktop_window_focus(C.int32_t(w.id))
}

func (w *darwinWindow) Navigate(url string) {
	curl, done := cString(url)
	defer done()
	C.ga_desktop_window_navigate(C.int32_t(w.id), curl)
}

func (w *darwinWindow) Close() {
	C.ga_desktop_window_close(C.int32_t(w.id))
}

func (w *darwinWindow) setTheme(dark bool) {
	flag := C.int(0)
	if dark {
		flag = 1
	}
	C.ga_desktop_window_set_theme(C.int32_t(w.id), flag)
}

func cString(s string) (*C.char, func()) {
	p := C.CString(s)
	return p, func() { C.free(unsafe.Pointer(p)) }
}

func (w *darwinWindow) create(spec desktopWindowSpec, dark bool) error {
	title, freeTitle := cString(spec.Title)
	defer freeTitle()
	url, freeURL := cString(spec.URL)
	defer freeURL()
	quoted, err := json.Marshal(nativeThemeBinding)
	if err != nil {
		return fmt.Errorf("binding name %q: %w", nativeThemeBinding, err)
	}
	bind, freeBind := cString(string(quoted))
	defer freeBind()

	var iconPtr *C.uchar
	iconLen := C.int(0)
	if len(appicon.MacPNG) > 0 {
		iconPtr = (*C.uchar)(unsafe.Pointer(&appicon.MacPNG[0]))
		iconLen = C.int(len(appicon.MacPNG))
	}
	flag := C.int(0)
	if dark {
		flag = 1
	}

	C.ga_desktop_window_create(
		C.int32_t(w.id),
		title,
		url,
		C.int(spec.Width),
		C.int(spec.Height),
		C.int(spec.MinWidth),
		C.int(spec.MinHeight),
		flag,
		bind,
		iconPtr,
		iconLen,
	)

	select {
	case err := <-w.failed:
		return err
	case <-w.started:
		return nil
	}
}

// runDesktopWindow creates a WKWebView window on AppKit's main thread and
// waits until that window closes.
func runDesktopWindow(spec desktopWindowSpec, ready func(desktopWindow)) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("webview window crashed: %v", recovered)
		}
	}()

	win := newDarwinWindow()
	rememberDarwinWindow(win)
	defer forgetDarwinWindow(win.id)

	themeState := windowThemeStatePath(spec.DataPath)
	dark := readWindowTheme(themeState)
	confirmed := false
	if bindErr := win.bind(nativeThemeBinding, func(args []json.RawMessage) {
		var next bool
		if len(args) == 0 || json.Unmarshal(args[0], &next) != nil {
			return
		}
		if confirmed && next == dark {
			return
		}
		confirmed, dark = true, next
		win.setTheme(next)
		writeWindowTheme(themeState, next)
	}); bindErr != nil {
		log.Printf("desktop window %q cannot follow the app theme: %v", spec.Name, bindErr)
	}

	if err := win.create(spec, dark); err != nil {
		return err
	}
	ready(win)
	<-win.closed
	return nil
}

// EnableHiDPI is a Windows concern; AppKit already hands the process real
// pixels.
func EnableHiDPI() {}

//export goDesktopReady
func goDesktopReady(id C.int32_t) {
	if win := lookupDarwinWindow(int32(id)); win != nil {
		win.markReady()
	}
}

//export goDesktopClosed
func goDesktopClosed(id C.int32_t) {
	if win := lookupDarwinWindow(int32(id)); win != nil {
		win.markClosed()
	}
}

//export goDesktopFailed
func goDesktopFailed(id C.int32_t, msg *C.char) {
	err := errors.New("webview window failed")
	if msg != nil {
		err = errors.New(C.GoString(msg))
	}
	if win := lookupDarwinWindow(int32(id)); win != nil {
		win.markFailed(err)
		win.markClosed()
	}
}

//export goDesktopMessage
func goDesktopMessage(id C.int32_t, payload *C.char) {
	if payload == nil {
		return
	}
	raw := C.GoString(payload)
	if win := lookupDarwinWindow(int32(id)); win != nil {
		win.receive(raw)
	}
}
