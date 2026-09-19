//go:build !linux

package tray

import (
	"log"
	"runtime"
	"time"

	"fyne.io/systray"

	"genericagent-admin-go/internal/appicon"
	"genericagent-admin-go/internal/clipboard"
)

// The bound address is fixed for the process lifetime, but remote access, the
// password, and the set of running services all change while the process runs,
// so the menu re-reads them instead of rendering once at startup.
const trayRefreshInterval = 3 * time.Second

// Run puts the menu on screen and blocks until the user quits from it.
func Run(app App) {
	text := trayLanguage()

	systray.Run(func() {
		switch runtime.GOOS {
		case "windows":
			systray.SetIcon(appicon.ICO)
		case "darwin":
			// mac draws a title as text next to the menu bar item, and the mark
			// itself carries no letters any more, so the icon stands alone.
			systray.SetIcon(appicon.MacTrayPNG)
		default:
			systray.SetIcon(appicon.PNG)
			systray.SetTitle("GA")
		}
		systray.SetTooltip(text.AppName)

		// A left click opens the primary interface; the menu stays on the right
		// button, which is what happens when no secondary handler is set.
		systray.SetOnTapped(func() { run(app.OpenChat) })

		chatItem := systray.AddMenuItem(text.OpenChat, text.OpenChatTip)
		newChatItem := systray.AddMenuItem(text.OpenNewChat, text.OpenNewChatTip)
		settingsItem := systray.AddMenuItem(text.OpenSettings, text.OpenSettingsTip)
		systray.AddSeparator()
		// The default listen port is random, so the tray is the only place a
		// user can read, and take, the address of the running server.
		localItem := systray.AddMenuItem("", text.CopyLocalTip)
		lanItem := systray.AddMenuItem("", text.CopyLANTip)
		scopeItem := systray.AddMenuItem("", text.ScopeTip)
		scopeItem.Disable()
		// Stop and Quit share this section so that hiding Stop cannot leave two
		// separators stacked on each other.
		systray.AddSeparator()
		stopItem := systray.AddMenuItem("", text.StopTip)
		exitItem := systray.AddMenuItem(text.Exit, text.ExitTip)

		status := app.status()
		render := func() {
			status = app.status()
			localItem.SetTitle(status.LocalLabel)
			systray.SetTooltip(status.Tooltip)

			// Every remaining row earns its place by carrying something the
			// user can act on; anything that would only restate the safe
			// default leaves the menu instead of greying out inside it.
			show(lanItem, status.LANLabel != "", status.LANLabel)
			show(scopeItem, status.ScopeAlert, status.ScopeLabel)

			running := app.runningServices()
			show(stopItem, running > 0, stopServicesLabel(text, running))
		}
		render()

		copyAddress := func(item *systray.MenuItem, url string) {
			if url == "" {
				return
			}
			if err := clipboard.Copy(url); err != nil {
				log.Printf("tray: %v", err)
				return
			}
			// A copy changes nothing on screen, so the entry acknowledges it
			// until the next refresh restores the address.
			item.SetTitle(text.Copied + url)
		}

		go func() {
			// One goroutine owns every menu item, so the periodic refresh
			// cannot race the click handlers that also rewrite titles.
			refresh := time.NewTicker(trayRefreshInterval)
			defer refresh.Stop()
			for {
				select {
				case <-refresh.C:
					render()
				case <-chatItem.ClickedCh:
					run(app.OpenChat)
				case <-newChatItem.ClickedCh:
					run(app.OpenNewChat)
				case <-settingsItem.ClickedCh:
					run(app.OpenSettings)
				case <-localItem.ClickedCh:
					copyAddress(localItem, status.LocalURL)
				case <-lanItem.ClickedCh:
					copyAddress(lanItem, status.LANURL)
				case <-stopItem.ClickedCh:
					run(app.StopServices)
				case <-exitItem.ClickedCh:
					// Quit the native event loop before cleanup. fyne/systray runs
					// its onExit callback synchronously on that loop, so doing
					// process cleanup there can leave the tray icon stuck forever.
					systray.Quit()
					return
				}
			}
		}()
	}, nil)
	if app.Exit != nil {
		app.Exit()
	}
}

// run keeps a click from blocking the menu on work that may open a window or
// stop a process tree.
func run(action func()) {
	if action != nil {
		go action()
	}
}

// show gives an entry its current wording, or takes it out of the menu when it
// has nothing left to say.
func show(item *systray.MenuItem, visible bool, title string) {
	if !visible {
		item.Hide()
		return
	}
	item.SetTitle(title)
	item.Show()
}
