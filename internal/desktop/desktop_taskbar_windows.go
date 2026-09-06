//go:build windows

package desktop

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	taskbarCoCreateInstance = windows.NewLazySystemDLL("ole32.dll").NewProc("CoCreateInstance")
	taskbarDestroyIcon      = user32.NewProc("DestroyIcon")
	taskbarButtonCreated    = registerTaskbarMessage()
	taskbarWindows          taskbarRegistry
)

const wmTaskbarRefresh = wmApp + 1

func registerTaskbarMessage() uint32 {
	name, _ := windows.UTF16PtrFromString("TaskbarButtonCreated")
	msg, _, _ := user32.NewProc("RegisterWindowMessageW").Call(uintptr(unsafe.Pointer(name)))
	return uint32(msg)
}

// The COM object and HICONs belong to the host's UI thread, as does WebView2.
type taskbarCOM struct{ vtable *[21]uintptr }
type taskbarOverlay struct {
	object  *taskbarCOM
	icons   map[taskbarState]uintptr
	applied taskbarState
	ready   bool
	warned  bool
}

func (t *taskbarCOM) call(index int, args ...uintptr) uintptr {
	result, _, _ := syscall.SyscallN(t.vtable[index], append([]uintptr{uintptr(unsafe.Pointer(t))}, args...)...)
	return result
}

func (t *taskbarOverlay) connect() error {
	if t.object != nil {
		return nil
	}
	clsid := windows.GUID{Data1: 0x56fdf344, Data2: 0xfd6d, Data3: 0x11d0, Data4: [8]byte{0x95, 0x8a, 0, 0x60, 0x97, 0xc9, 0xa0, 0x90}}
	iid := windows.GUID{Data1: 0xea1afb91, Data2: 0x9e28, Data3: 0x4b86, Data4: [8]byte{0x90, 0xe9, 0x9e, 0x9f, 0x8a, 0x5e, 0xef, 0xaf}}
	hr, _, _ := taskbarCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsid)), 0, 1, uintptr(unsafe.Pointer(&iid)), uintptr(unsafe.Pointer(&t.object)))
	if int32(hr) < 0 {
		return fmt.Errorf("ITaskbarList3: HRESULT %#x", uint32(hr))
	}
	if hr = t.object.call(3); int32(hr) < 0 {
		t.releaseCOM()
		return fmt.Errorf("ITaskbarList3.HrInit: HRESULT %#x", uint32(hr))
	}
	return nil
}

func (t *taskbarOverlay) releaseCOM() {
	if t.object != nil {
		t.object.call(2)
		t.object = nil
	}
	t.applied = ""
}

func (t *taskbarOverlay) close() {
	t.releaseCOM()
	for _, icon := range t.icons {
		_, _, _ = taskbarDestroyIcon.Call(icon)
	}
	t.icons = nil
	t.ready = false
}

func (t *taskbarOverlay) apply(hwnd uintptr, state taskbarState) error {
	if !t.ready || state == t.applied {
		return nil
	}
	if err := t.connect(); err != nil {
		return err
	}
	var icon uintptr
	if state != taskbarIdle {
		icon = t.icons[state]
		if icon == 0 {
			data, err := taskbarIconPNG(state)
			if err != nil {
				return err
			}
			icon, _, _ = procCreateIconFromResourceEx.Call(uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)), 1, iconResourceVersion, 32, 32, 0)
			runtime.KeepAlive(data)
			if icon == 0 {
				return fmt.Errorf("create taskbar icon for %s", state)
			}
			if t.icons == nil {
				t.icons = make(map[taskbarState]uintptr)
			}
			t.icons[state] = icon
		}
	}
	description, _ := windows.UTF16PtrFromString("Chat: " + string(state))
	hr := t.object.call(18, hwnd, icon, uintptr(unsafe.Pointer(description)))
	runtime.KeepAlive(description)
	if int32(hr) < 0 {
		return fmt.Errorf("SetOverlayIcon: HRESULT %#x", uint32(hr))
	}
	t.applied = state
	return nil
}

func refreshTaskbarWindows() {
	_, handles := taskbarWindows.snapshot()
	for _, hwnd := range handles {
		_, _, _ = procPostMessageW.Call(hwnd, wmTaskbarRefresh, 0, 0)
	}
}

func (w *hostWindow) applyTaskbar() {
	state, _ := taskbarWindows.snapshot()
	if err := w.taskbar.apply(w.hwnd, state); err != nil && !w.taskbar.warned {
		log.Printf("desktop taskbar: %v", err)
		w.taskbar.warned = true
	}
}

func (w *hostWindow) closeTaskbar() {
	taskbarWindows.remove(w.hwnd)
	w.taskbar.close()
	refreshTaskbarWindows()
}

func (w *hostWindow) bindTaskbar() error {
	return w.bind(nativeTaskbarBinding, func(args []json.RawMessage) {
		var state taskbarState
		if len(args) != 1 || json.Unmarshal(args[0], &state) != nil || !validTaskbarState(state) {
			return
		}
		if taskbarWindows.set(w.hwnd, state) {
			refreshTaskbarWindows()
		}
	})
}

// Rasterize the unread dot at 4x coverage. This does not replace the app icon.
func taskbarIconPNG(state taskbarState) ([]byte, error) {
	if state != taskbarUnread {
		return nil, fmt.Errorf("no icon for %q", state)
	}
	fill := color.NRGBA{R: 220, G: 38, B: 38, A: 255}
	// Keep the overlay canvas fixed; shrink the artwork to a 20px circle
	// anchored one pixel from the bottom-right so it covers less of the app icon.
	const artworkScale = 2.0 / 3.0
	const artworkCenter = 21.0
	img := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			var r, g, b, a int
			for sy := 0; sy < 4; sy++ {
				for sx := 0; sx < 4; sx++ {
					px, py := float64(x)+(float64(sx)+0.5)/4, float64(y)+(float64(sy)+0.5)/4
					px = (px-artworkCenter)/artworkScale + 16
					py = (py-artworkCenter)/artworkScale + 16
					if math.Hypot(px-16, py-16) > 15 {
						continue
					}
					c := fill
					if math.Hypot(px-16, py-16) > 13.5 {
						c = color.NRGBA{255, 255, 255, 255}
					}
					r += int(c.R)
					g += int(c.G)
					b += int(c.B)
					a++
				}
			}
			if a > 0 {
				img.SetNRGBA(x, y, color.NRGBA{uint8(r / a), uint8(g / a), uint8(b / a), uint8(a * 255 / 16)})
			}
		}
	}
	var out bytes.Buffer
	err := png.Encode(&out, img)
	return out.Bytes(), err
}
