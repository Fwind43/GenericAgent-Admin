package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"genericagent-admin-go/internal/adminauth"
	"genericagent-admin-go/internal/adminhttp"
	"genericagent-admin-go/internal/api"
	"genericagent-admin-go/internal/config"
	"genericagent-admin-go/internal/desktop"
	"genericagent-admin-go/internal/modelconfig"
	"genericagent-admin-go/internal/service"
	"genericagent-admin-go/internal/tray"
	"genericagent-admin-go/internal/version"
)

//go:embed web/dist
var webFS embed.FS

// The Windows executable carries the app icon in a resource section so that
// Explorer, the taskbar, and pinned shortcuts show it. The .syso files are
// committed because every build path needs them, including a plain `go build`;
// regenerate them after changing the icon:
//
//go:generate go run github.com/akavel/rsrc@v0.10.2 -ico internal/appicon/assets/tray_windows.ico -arch amd64 -o rsrc_windows_amd64.syso
//go:generate go run github.com/akavel/rsrc@v0.10.2 -ico internal/appicon/assets/tray_windows.ico -arch arm64 -o rsrc_windows_arm64.syso

func main() {
	internalLaunch, err := parseInternalLaunchArgs(os.Args[1:])
	if err != nil {
		log.Fatal(err)
	}
	if internalLaunch.HelperManifest != "" {
		if err := version.RunUpdateHelper(internalLaunch.HelperManifest); err != nil {
			log.Fatal(err)
		}
		return
	}
	os.Args = append([]string{os.Args[0]}, internalLaunch.PublicArgs...)

	// Has to happen before anything can put a window on screen.
	desktop.EnableHiDPI()
	launch := parseLaunchOptions()
	cwd, err := appRoot(launch.AppRoot)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.Chdir(cwd); err != nil {
		log.Fatalf("chdir %s failed: %v", cwd, err)
	}
	cfgStore := config.NewStore(cwd)
	if err := cfgStore.Load(); err != nil {
		log.Printf("load config: %v", err)
	}
	// Portable bundle bootstrap is idempotent and also repairs bundles created
	// by older versions that may have persisted bootstrap_done=true too early.
	if err := tryPortableAutoInit(cwd, cfgStore); err != nil {
		log.Printf("portable auto-init: %v", err)
	}
	version.SetRepoURL(cfgStore.Snapshot().UpdateRepoURL)
	version.SetGitHubMirror(cfgStore.Snapshot().GitHubMirror)
	svc := service.NewManagerWithPython(cfgStore.Snapshot().GARoot, cfgStore.Snapshot().EffectivePython, cfgStore.Snapshot().BufferLines)
	models := modelconfig.NewStore(cwd)
	static, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		log.Fatal(err)
	}
	srv := api.New(cfgStore, svc, models, static)
	srv.StartAutomaticChatTitleBackfill()
	srv.StartChatAutorun()
	auth, err := adminauth.New(cwd, cfgStore)
	if err != nil {
		log.Fatalf("initialize admin authentication: %v", err)
	}
	srv.PasswordConfigured = auth.PasswordConfigured

	portOverride := 0
	if launch.PortSet {
		portOverride = launch.Port
	}
	listener, err := openListenerAndConfirm(func() (net.Listener, error) {
		return adminhttp.OpenListener(cfgStore.Snapshot(), portOverride, auth.PasswordConfigured())
	}, internalLaunch.ConfirmOperation, version.ConfirmUpdateReady)
	if err != nil {
		log.Fatal(err)
	}
	url := adminhttp.LocalURL(listener)
	srv.SetListenAddress(listener.Addr().String(), url)
	if err := adminhttp.WriteRuntimeInfo(cwd, listener); err != nil {
		log.Printf("record runtime address: %v", err)
	}
	server := adminhttp.NewServer(listener.Addr().String(), auth.Middleware(srv.Routes()))
	go srv.StartAutostartServices()
	go srv.StartChatHubBridge()
	go func() {
		log.Printf("GenericAgent Admin Go listening on %s (bound to %s)", url, listener.Addr())
		if launch.Headless {
			log.Printf("headless/server-only mode enabled; open %s from another browser if needed", url)
		}
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve %s failed: %v", listener.Addr(), err)
		}
	}()

	if launch.Headless {
		waitForShutdownSignal(server, func() {
			srv.ShutdownCleanup()
			adminhttp.RemoveRuntimeInfo(cwd)
		})
		return
	}

	ui := desktop.NewUI(cwd, launch.NoWindow)
	if !launch.NoBrowser {
		go func() { time.Sleep(500 * time.Millisecond); ui.OpenChat(url) }()
	}
	tray.Run(tray.App{
		OpenChat:     func() { ui.OpenChat(url) },
		OpenNewChat:  func() { ui.OpenNewChat(url) },
		OpenSettings: func() { ui.OpenSettings(url) },
		StopServices: func() { srv.StopManagedServices() },
		Exit: func() {
			if !runCleanupWithTimeout(func() {
				// Make the Admin unreachable and remove its discovery record before
				// child cleanup, which may have to wait for a stuck installer.
				adminhttp.RemoveRuntimeInfo(cwd)
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				_ = server.Shutdown(ctx)
				ui.CloseAll()
				srv.ShutdownCleanup()
			}, 15*time.Second) {
				log.Printf("shutdown cleanup exceeded 15 seconds; exiting without waiting for the remaining cleanup")
			}
		},
		ListenAddr:         listener.Addr().String(),
		Config:             cfgStore.Snapshot,
		PasswordConfigured: auth.PasswordConfigured,
		RunningServices:    srv.RunningManagedServices,
	})
}

type internalLaunchOptions struct {
	HelperManifest   string
	ConfirmOperation string
	PublicArgs       []string
}

func parseInternalLaunchArgs(args []string) (internalLaunchOptions, error) {
	result := internalLaunchOptions{PublicArgs: make([]string, 0, len(args))}
	helperSeen := false
	confirmSeen := false

	readValue := func(name string, index *int) (string, error) {
		arg := args[*index]
		if strings.HasPrefix(arg, name+"=") {
			value := strings.TrimSpace(strings.TrimPrefix(arg, name+"="))
			if value == "" {
				return "", fmt.Errorf("%s requires a non-empty value", name)
			}
			return value, nil
		}
		if *index+1 >= len(args) {
			return "", fmt.Errorf("%s requires a value", name)
		}
		*index++
		value := strings.TrimSpace(args[*index])
		if value == "" {
			return "", fmt.Errorf("%s requires a non-empty value", name)
		}
		return value, nil
	}

	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--update-helper" || strings.HasPrefix(arg, "--update-helper="):
			if helperSeen || confirmSeen {
				return internalLaunchOptions{}, errors.New("update helper and confirmation modes must each appear exactly once and cannot be combined")
			}
			value, err := readValue("--update-helper", &i)
			if err != nil {
				return internalLaunchOptions{}, err
			}
			helperSeen = true
			result.HelperManifest = value
		case arg == "--update-confirm" || strings.HasPrefix(arg, "--update-confirm="):
			if confirmSeen || helperSeen {
				return internalLaunchOptions{}, errors.New("update helper and confirmation modes must each appear exactly once and cannot be combined")
			}
			value, err := readValue("--update-confirm", &i)
			if err != nil {
				return internalLaunchOptions{}, err
			}
			confirmSeen = true
			result.ConfirmOperation = value
		default:
			result.PublicArgs = append(result.PublicArgs, arg)
		}
	}
	return result, nil
}

func openListenerAndConfirm(
	open func() (net.Listener, error),
	operationID string,
	confirm func(string) error,
) (net.Listener, error) {
	listener, err := open()
	if err != nil {
		return nil, err
	}
	if operationID == "" {
		return listener, nil
	}
	if confirm == nil {
		_ = listener.Close()
		return nil, errors.New("update confirmation handler is unavailable")
	}
	if err := confirm(operationID); err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("confirm replacement startup: %w", err)
	}
	return listener, nil
}

type launchOptions struct {
	Headless  bool
	NoBrowser bool
	NoWindow  bool
	AppRoot   string
	Port      int
	PortSet   bool
}

func parseLaunchOptions() launchOptions {
	headlessFlag := flag.Bool("headless", false, "run without browser or tray; intended for Linux servers")
	serverOnlyFlag := flag.Bool("server-only", false, "alias for --headless")
	noBrowserFlag := flag.Bool("no-browser", false, "do not open the web UI automatically")
	noWindowFlag := flag.Bool("no-window", false, "open the web UI in the system browser instead of a native desktop window")
	appRootFlag := flag.String("app-root", "", "override the directory containing config.local.json")
	portFlag := flag.Int("port", 0, "override HTTP listen port for this launch (1-65535)")
	flag.Parse()

	portSet := false
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "port" {
			portSet = true
		}
	})
	if portSet && (*portFlag < 1 || *portFlag > 65535) {
		log.Fatalf("invalid --port %d: port must be between 1 and 65535", *portFlag)
	}

	headless := *headlessFlag || *serverOnlyFlag || envBool("GA_ADMIN_HEADLESS") || envBool("GA_ADMIN_SERVER_ONLY")
	if !headless && runtime.GOOS == "linux" && !hasGraphicalSession() {
		headless = true
		log.Printf("no Linux graphical session detected; enabling headless/server-only mode")
	}
	return launchOptions{
		Headless:  headless,
		NoBrowser: *noBrowserFlag || envBool("GA_ADMIN_NO_BROWSER"),
		NoWindow:  *noWindowFlag || envBool("GA_ADMIN_NO_WINDOW"),
		AppRoot:   strings.TrimSpace(*appRootFlag),
		Port:      *portFlag,
		PortSet:   portSet,
	}
}

func envBool(name string) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(name)))
	switch value {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

func hasGraphicalSession() bool {
	for _, name := range []string{"DISPLAY", "WAYLAND_DISPLAY", "MIR_SOCKET"} {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return true
		}
	}
	return false
}

func runCleanupWithTimeout(cleanup func(), timeout time.Duration) bool {
	if cleanup == nil {
		return true
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		cleanup()
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
		return true
	case <-timer.C:
		return false
	}
}

func waitForShutdownSignal(server *http.Server, cleanup func()) {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Printf("shutdown signal received; stopping GenericAgent Admin Go")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = server.Shutdown(ctx)
	if cleanup != nil {
		cleanup()
	}
}

func appRoot(explicitRoot string) (string, error) {
	if root := strings.TrimSpace(explicitRoot); root != "" {
		return filepath.Abs(root)
	}

	wd, wdErr := os.Getwd()
	exe, err := os.Executable()
	if err != nil {
		if wdErr == nil {
			return wd, nil
		}
		return "", err
	}
	if exe != "" {
		exeDir := filepath.Dir(exe)
		// `go run` executes from a temporary go-build directory. Keep runtime
		// state such as config.local.json anchored to the caller's working tree
		// instead of the ephemeral compiled exe path.
		if wdErr == nil && wd != "" && strings.Contains(strings.ToLower(exeDir), string(filepath.Separator)+"go-build") {
			return wd, nil
		}
		return exeDir, nil
	}
	return wd, wdErr
}

func resolvePortableBootstrap(cwd string) (bootstrapPy, pythonExe string, ok bool) {
	// The published/PowerShell bundle layout is canonical.  Retain support for
	// artifacts from a short-lived builder that nested bootstrap and Python in
	// GenericAgent, but never let that override a valid root marker.
	for _, root := range []string{cwd, filepath.Join(cwd, "GenericAgent")} {
		candidate := filepath.Join(root, "bootstrap.py")
		if st, err := os.Stat(candidate); err != nil || st.IsDir() {
			continue
		}
		pythonExe = filepath.Join(root, "python", "bin", "python3")
		if runtime.GOOS == "windows" {
			pythonExe = filepath.Join(root, "python", "python.exe")
		}
		return candidate, pythonExe, true
	}
	return "", "", false
}

func runPortableBootstrap(cwd, pythonExe, bootstrapPy string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	cmd := newPortableBootstrapCommand(ctx, pythonExe, bootstrapPy)
	cmd.Dir = cwd
	output, err := cmd.CombinedOutput()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return output, fmt.Errorf("bootstrap.py timed out after 15 seconds")
	}
	return output, err
}

// tryPortableAutoInit detects portable bundle environment and runs bootstrap.py
// to populate config with correct paths. Returns nil if not portable or on success.
func tryPortableAutoInit(cwd string, store *config.Store) error {
	gaRoot := filepath.Join(cwd, "GenericAgent")
	gaInfo, gaErr := os.Stat(gaRoot)
	if gaErr != nil || !gaInfo.IsDir() {
		return nil // Not a portable bundle
	}
	bootstrapPy, pythonExe, ok := resolvePortableBootstrap(cwd)
	if !ok {
		return nil // Not a portable bundle
	}
	if store.Snapshot().BootstrapDone && validatePortableConfig(cwd, store.Snapshot()) == nil {
		return nil // Already initialized for this exact bundle location
	}

	log.Printf("portable bundle detected; running bootstrap auto-init")

	if st, err := os.Stat(pythonExe); err != nil {
		return fmt.Errorf("bundled python not found at %s: %w", pythonExe, err)
	} else if st.IsDir() {
		return fmt.Errorf("bundled python path is a directory: %s", pythonExe)
	}

	// Run bootstrap.py with bundled Python. The command is hidden on Windows and
	// bounded independently of bootstrap.py's own venv probe timeout so a broken
	// portable interpreter cannot block the desktop window indefinitely.
	output, err := runPortableBootstrap(cwd, pythonExe, bootstrapPy)
	if err != nil {
		log.Printf("bootstrap.py output:\n%s", string(output))
		return fmt.Errorf("bootstrap.py failed: %w", err)
	}

	log.Printf("bootstrap.py completed successfully")

	// Reload config to pick up bootstrap-populated paths
	if err := store.Load(); err != nil {
		return fmt.Errorf("reload config after bootstrap: %w", err)
	}
	if err := validatePortableConfig(cwd, store.Snapshot()); err != nil {
		return fmt.Errorf("bootstrap produced incomplete config: %w", err)
	}

	// Mark bootstrap as done only after both required paths are present and usable.
	cfg := store.Snapshot()
	cfg.BootstrapDone = true
	if err := store.Save(cfg); err != nil {
		return fmt.Errorf("save bootstrap_done flag: %w", err)
	}

	log.Printf("portable auto-init completed: ga_root=%s", store.Snapshot().GARoot)
	return nil
}

func validatePortableConfig(cwd string, cfg config.AppConfig) error {
	wantGARoot := filepath.Clean(filepath.Join(cwd, "GenericAgent"))
	gaRoot := filepath.Clean(strings.TrimSpace(cfg.GARoot))
	if strings.TrimSpace(cfg.GARoot) == "" {
		return fmt.Errorf("ga_root is empty")
	}
	if !samePath(gaRoot, wantGARoot) {
		return fmt.Errorf("ga_root %q does not point at this bundle %q", gaRoot, wantGARoot)
	}
	st, err := os.Stat(gaRoot)
	if err != nil {
		return fmt.Errorf("ga_root is unusable: %w", err)
	}
	if !st.IsDir() {
		return fmt.Errorf("ga_root is not a directory")
	}

	pythonPath := strings.TrimSpace(cfg.EffectivePython)
	if pythonPath == "" {
		pythonPath = strings.TrimSpace(cfg.PythonPath)
	}
	if pythonPath == "" {
		return fmt.Errorf("python_path is empty")
	}
	pythonPath = filepath.Clean(pythonPath)
	wantPython := filepath.Join(wantGARoot, ".venv", "bin", "python")
	if runtime.GOOS == "windows" {
		wantPython = filepath.Join(wantGARoot, ".venv", "Scripts", "python.exe")
	}
	if !samePath(pythonPath, wantPython) {
		return fmt.Errorf("python_path %q does not point at this bundle %q", pythonPath, wantPython)
	}
	st, err = os.Stat(pythonPath)
	if err != nil {
		return fmt.Errorf("python_path is unusable: %w", err)
	}
	if st.IsDir() {
		return fmt.Errorf("python_path is a directory")
	}
	return nil
}

func samePath(left, right string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(filepath.Clean(left), filepath.Clean(right))
	}
	return filepath.Clean(left) == filepath.Clean(right)
}
