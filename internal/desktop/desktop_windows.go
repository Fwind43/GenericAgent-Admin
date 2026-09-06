//go:build windows

package desktop

import (
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/jchv/go-webview2/webviewloader"
	"golang.org/x/sys/windows"

	"genericagent-admin-go/internal/appicon"
)

var (
	user32                  = windows.NewLazySystemDLL("user32.dll")
	procIsIconic            = user32.NewProc("IsIconic")
	procShowWindow          = user32.NewProc("ShowWindow")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
)

const swRestore = 9

// runDesktopWindow creates a WebView2 window on the caller's locked OS thread
// and pumps its message loop until the window closes.
func runDesktopWindow(spec desktopWindowSpec, ready func(desktopWindow)) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("webview2 window crashed: %v", recovered)
		}
	}()

	// WebView2 aborts the whole process when it fails to create its browser
	// environment, so verify the runtime and the data directory up front where
	// failures are still recoverable.
	if _, versionErr := webviewloader.GetInstalledVersion(); versionErr != nil {
		return fmt.Errorf("webview2 runtime is not installed: %w", versionErr)
	}
	if spec.DataPath != "" {
		if mkErr := os.MkdirAll(spec.DataPath, 0o755); mkErr != nil {
			return fmt.Errorf("prepare webview2 data directory %s: %w", spec.DataPath, mkErr)
		}
	}

	win, err := newHostWindow(spec)
	if err != nil {
		return err
	}

	setWindowIcon(win.hwnd, appicon.ICO)
	if bindErr := win.bindTaskbar(); bindErr != nil {
		log.Printf("desktop window %q cannot report taskbar state: %v", spec.Name, bindErr)
	}
	refreshTaskbarWindows()

	// The page owns the palette and reports it once it has loaded; until then
	// the caption uses whatever the last session ended on. Binding has to
	// happen before the first navigation.
	themeState := windowThemeStatePath(spec.DataPath)
	dark := readWindowTheme(themeState)
	if dark {
		setTitleBarTheme(win.hwnd, true)
	}
	confirmed := false
	if bindErr := win.bind(nativeThemeBinding, func(args []json.RawMessage) {
		var next bool
		if len(args) == 0 || json.Unmarshal(args[0], &next) != nil {
			return
		}
		// The first report is applied even when it matches the remembered
		// value: that guess was made before the window had painted anything,
		// and a caption stuck on the wrong colour would never correct itself.
		if confirmed && next == dark {
			return
		}
		confirmed, dark = true, next
		setTitleBarTheme(win.hwnd, next)
		writeWindowTheme(themeState, next)
	}); bindErr != nil {
		log.Printf("desktop window %q cannot follow the app theme: %v", spec.Name, bindErr)
	}

	// This is already the window's own thread, so the first load skips the
	// queue that Navigate uses to get there from elsewhere.
	win.browser.Navigate(spec.URL)

	ready(win)
	win.run()
	return nil
}
