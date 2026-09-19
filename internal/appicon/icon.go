// Package appicon carries the application mark. One icon serves the tray, the
// taskbar, and every desktop window, so it lives in a package both the tray and
// the desktop window backends can embed rather than in either of them.
//
// assets/source_tray_icon.png is the master artwork; the two embedded files are
// generated from it by scripts/icons/build_windows_icon.py.
package appicon

import _ "embed"

// ICO is the multi-frame Windows icon used by the tray, the window class, and
// the executable's resource section.
//
//go:embed assets/tray_windows.ico
var ICO []byte

// PNG is the single-size mark the macOS and Linux trays take.
//
//go:embed assets/tray.png
var PNG []byte

// MacPNG is the macOS mark: the lens release-assets.yml turns into
// Contents/Resources/AppIcon.icns, and the bytes desktop_darwin.go hands to
// AppKit for the Dock and the application switcher.
//
// It is a serial of its own: the Windows/web icons keep the shared artwork in
// assets/tray_windows.ico, so regenerating the mac mark does not touch them.
//
//go:embed assets/icon_mac.png
var MacPNG []byte

// MacTrayPNG is the same mark at the 32px the mac menu bar slot needs (16pt at 2x).
// It exists so the mac menu bar can drop the letters while the shared tray.png
// keeps serving the other platforms untouched.
//
//go:embed assets/tray_mac.png
var MacTrayPNG []byte
