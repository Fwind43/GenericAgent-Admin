//go:build windows

package desktop

import (
	"bytes"
	"image"
	"image/png"
	"runtime"
	"testing"
	"unsafe"
)

func TestTaskbarUnreadDotIsValidNativeResource(t *testing.T) {
	for _, state := range []taskbarState{taskbarUnread} {
		t.Run(string(state), func(t *testing.T) {
			data, err := taskbarIconPNG(state)
			if err != nil {
				t.Fatal(err)
			}

			img, err := png.Decode(bytes.NewReader(data))
			if err != nil {
				t.Fatal(err)
			}
			if img.Bounds().Dx() != 32 || img.Bounds().Dy() != 32 {
				t.Fatal("unexpected icon size")
			}
			_, _, _, corner := img.At(0, 0).RGBA()
			_, _, _, center := img.At(21, 21).RGBA()
			if corner != 0 || center != 65535 {
				t.Fatal("invalid transparency")
			}
			for y := 17; y <= 24; y++ {
				for x := 17; x <= 24; x++ {
					r, g, b, a := img.At(x, y).RGBA()
					if r != 220*257 || g != 38*257 || b != 38*257 || a != 65535 {
						t.Fatalf("unread dot contains a symbol or incorrect fill at (%d, %d)", x, y)
					}
				}
			}
			var visible image.Rectangle
			for y := 0; y < 32; y++ {
				for x := 0; x < 32; x++ {
					if _, _, _, alpha := img.At(x, y).RGBA(); alpha != 0 {
						visible = visible.Union(image.Rect(x, y, x+1, y+1))
					}
				}
			}
			if want := image.Rect(11, 11, 31, 31); visible != want {
				t.Fatalf("visible badge bounds = %v, want %v", visible, want)
			}
			icon, _, callErr := procCreateIconFromResourceEx.Call(uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)), 1, iconResourceVersion, 16, 16, 0)
			runtime.KeepAlive(data)
			if icon == 0 {
				t.Fatalf("CreateIconFromResourceEx: %v", callErr)
			}
			if ok, _, err := taskbarDestroyIcon.Call(icon); ok == 0 {
				t.Fatalf("DestroyIcon: %v", err)
			}
		})
	}
	for _, state := range []taskbarState{taskbarIdle, "invalid"} {
		if _, err := taskbarIconPNG(state); err == nil {
			t.Fatalf("unexpected icon for %q", state)
		}
	}
}

func TestTaskbarOverlayWaitsForShellReadiness(t *testing.T) {
	var overlay taskbarOverlay
	if err := overlay.apply(0, taskbarUnread); err != nil {
		t.Fatal(err)
	}
	if overlay.object != nil || overlay.applied != "" || len(overlay.icons) != 0 {
		t.Fatal("overlay allocated resources before TaskbarButtonCreated")
	}
	overlay.close()
	overlay.close()
	if overlay.object != nil || len(overlay.icons) != 0 {
		t.Fatal("close retained resources")
	}
}
