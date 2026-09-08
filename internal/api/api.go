package api

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"genericagent-admin-go/internal/config"
	"genericagent-admin-go/internal/ga"
	"genericagent-admin-go/internal/modelconfig"
	"genericagent-admin-go/internal/pyfind"
	"genericagent-admin-go/internal/service"
)

type Server struct {
	autorunMu           sync.Mutex
	autorunCancel       context.CancelFunc
	autorunDone         chan struct{}
	CfgStore            *config.Store
	Svc                 *service.Manager
	InstanceManagers    *instanceManagerRegistry
	Models              *modelconfig.Store
	Static              fs.FS
	staticGzip          sync.Map
	ReactApp            *reactAppBridge
	ChatMu              *sync.Mutex
	SessionMu           *sync.Mutex
	UsageMu             *sync.Mutex
	ConfigMu            *sync.Mutex
	ChatRuns            map[string]*chatRun
	ChatWorkers         map[string]*chatWorker
	ChatLoopControllers map[string]*chatLoopControllerRun
	ChatTitleJobs       map[string]bool
	ChatRuntimes        *chatRuntimeRegistry
	ChatRuntime         *chatRuntime
	BaseCfgStore        *config.Store
	// PasswordConfigured reports whether an admin password exists. The
	// credential itself lives outside this package, so remote-access settings
	// ask through this hook before they can be saved.
	PasswordConfigured        func() bool
	listenMu                  sync.RWMutex
	listenAddress             string
	listenURL                 string
	titleBackfillStarted      bool
	chatSessionMutationHook   func()
	chatExactSaveHook         func(chatSession) error
	chatWorldlineRPCHook      func(string, map[string]interface{}) error
	chatHubBridgeMu           sync.Mutex
	chatHubBridgeCmd          *exec.Cmd
	chatHubBridgeServer       *http.Server
	chatFeishuBridgeMu        sync.Mutex
	chatFeishuBridgeCmd       *exec.Cmd
	chatFeishuBridgeServer    *http.Server
	chatFeishuBridgeStartedAt time.Time
	instanceInstallMu         sync.Mutex
	instanceInstallWG         sync.WaitGroup
	instanceInstallTasks      map[string]*instanceInstallTask
	instanceInstallsClosing   bool
}

func New(cfg *config.Store, svc *service.Manager, models *modelconfig.Store, static fs.FS) *Server {
	chatRuntimes := newChatRuntimeRegistry()
	defaultRuntime := chatRuntimes.runtime("")
	s := &Server{
		CfgStore: cfg, BaseCfgStore: cfg, Svc: svc,
		InstanceManagers: newInstanceManagerRegistry(cfg.Snapshot(), svc),
		Models:           models, Static: static, ReactApp: newReactAppBridge(),
		ChatMu: &defaultRuntime.chatMu, SessionMu: &defaultRuntime.sessionMu,
		UsageMu: &defaultRuntime.usageMu, ConfigMu: &sync.Mutex{},
		ChatRuns: defaultRuntime.runs, ChatWorkers: defaultRuntime.workers,
		ChatLoopControllers: defaultRuntime.loopControllers,
		ChatTitleJobs:       defaultRuntime.titleJobs, ChatRuntimes: chatRuntimes, ChatRuntime: defaultRuntime,
		instanceInstallTasks: make(map[string]*instanceInstallTask),
	}
	s.resumeInstanceInstalls()
	return s
}

// SetListenAddress records where the server actually bound. The default
// ephemeral port is only known after binding, so the UI reads it from here
// rather than from the configured port.
func (s *Server) SetListenAddress(address, url string) {
	s.listenMu.Lock()
	defer s.listenMu.Unlock()
	s.listenAddress = address
	s.listenURL = url
}

func (s *Server) ListenAddress() (address, url string) {
	s.listenMu.RLock()
	defer s.listenMu.RUnlock()
	return s.listenAddress, s.listenURL
}

// passwordConfigured answers conservatively when the hook is missing so that
// remote access cannot be enabled by a server that cannot check credentials.
func (s *Server) passwordConfigured() bool {
	if s.PasswordConfigured == nil {
		return false
	}
	return s.PasswordConfigured()
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.health)
	mux.HandleFunc("/api/version", s.versionInfo)
	mux.HandleFunc("/api/version/info", s.versionInfo)
	mux.HandleFunc("/api/version/check", s.versionCheck)
	mux.HandleFunc("/api/version/status", s.versionStatus)
	mux.HandleFunc("/api/risk/catalog", s.riskCatalog)
	mux.HandleFunc("/api/keychain", s.requireDangerousConfirm(s.keychainHandler))
	mux.HandleFunc("/api/version/update", s.requireDangerousConfirm(s.versionUpdate))
	mux.HandleFunc("/api/version/restart", s.requireDangerousConfirm(s.versionRestart))
	mux.HandleFunc("/api/ga/inventory", s.gaInventory)
	mux.HandleFunc("/api/ga/health", s.gaHealth)
	// Updating the GA checkout belongs to GA itself: users run /update in chat.
	mux.HandleFunc("/api/ga/git-status", s.gaGitStatus)
	mux.HandleFunc("/api/ga/git-mirror", s.requireDangerousConfirm(s.gitMirrorConfig))
	mux.HandleFunc("/api/tmwebdriver/status", s.tmwebdriverStatus)
	mux.HandleFunc("/api/tmwebdriver/repair", s.requireDangerousConfirm(s.tmwebdriverRepair))
	mux.HandleFunc("/api/tmwebdriver/install-deps", s.requireDangerousConfirm(s.tmwebdriverInstallDeps))
	mux.HandleFunc("/api/files/list", s.filesList)
	mux.HandleFunc("/api/files/read", s.filesRead)
	mux.HandleFunc("/api/files/write", s.requireDangerousConfirm(s.filesWrite))
	mux.HandleFunc("/api/files/delete", s.requireDangerousConfirm(s.filesDelete))
	mux.HandleFunc("/api/files/download", s.filesDownload)
	mux.HandleFunc("/api/files/tail", s.filesTail)
	mux.HandleFunc("/api/files/search", s.filesSearch)
	mux.HandleFunc("/api/files/open", s.requireDangerousConfirm(s.withChatInstance((*Server).filesOpen)))
	mux.HandleFunc("/api/files/image", s.filesImage)
	mux.HandleFunc("/api/schedule/tasks", s.scheduleTasks)
	mux.HandleFunc("/api/schedule/task", s.requireDangerousConfirm(s.scheduleTask))
	mux.HandleFunc("/api/schedule/create", s.requireDangerousConfirm(s.scheduleCreate))
	mux.HandleFunc("/api/schedule/delete", s.requireDangerousConfirm(s.scheduleDelete))
	mux.HandleFunc("/api/schedule/toggle", s.requireDangerousConfirm(s.scheduleToggle))
	mux.HandleFunc("/api/schedule/artifact", s.scheduleArtifact)
	mux.HandleFunc("/api/goals/start", s.requireDangerousConfirm(s.goalsStart))
	mux.HandleFunc("/api/goals/list", s.goalsList)
	mux.HandleFunc("/api/goals/stop", s.requireDangerousConfirm(s.goalsStop))
	mux.HandleFunc("/api/goals/delete", s.requireDangerousConfirm(s.goalsDelete))
	mux.HandleFunc("/api/goals/output", s.goalsOutput)
	mux.HandleFunc("/api/config", s.requireDangerousConfirm(s.configHandler))
	mux.HandleFunc("/api/instances", s.instancesList)
	mux.HandleFunc("/api/instances/install", s.requireDangerousConfirm(s.instanceInstall))
	mux.HandleFunc("/api/instances/create", s.requireDangerousConfirm(s.instanceCreate))
	mux.HandleFunc("/api/instances/update", s.requireDangerousConfirm(s.instanceUpdate))
	mux.HandleFunc("/api/instances/delete", s.requireDangerousConfirm(s.instanceDelete))
	mux.HandleFunc("/api/instances/default", s.requireDangerousConfirm(s.instanceSetDefault))
	mux.HandleFunc("/api/slash-commands", s.slashCommands)
	mux.HandleFunc("/api/extra-system-prompt-presets", s.requireDangerousConfirm(s.extraSystemPromptPresets))
	mux.HandleFunc("/api/ui/theme", s.uiTheme)
	mux.HandleFunc("/api/setup/state", s.setupState)
	mux.HandleFunc("/api/setup/env", s.setupEnv)
	mux.HandleFunc("/api/setup/browse", s.setupBrowse)
	mux.HandleFunc("/api/setup/validate", s.requireDangerousConfirm(s.setupValidate))
	mux.HandleFunc("/api/setup/install", s.requireDangerousConfirm(s.setupInstall))
	mux.HandleFunc("/api/setup/python/validate", s.requireDangerousConfirm(s.setupPythonValidate))
	mux.HandleFunc("/api/setup/python/install", s.requireDangerousConfirm(s.setupPythonInstall))
	mux.HandleFunc("/api/setup/venv/create", s.requireDangerousConfirm(s.setupVenvCreate))
	mux.HandleFunc("/api/setup/deps/install", s.requireDangerousConfirm(s.setupDepsInstall))
	mux.HandleFunc("/api/setup/smoke", s.requireDangerousConfirm(s.setupSmoke))
	mux.HandleFunc("/api/setup/complete", s.requireDangerousConfirm(s.setupComplete))
	mux.HandleFunc("/api/autostart/status", s.autostartStatus)
	mux.HandleFunc("/api/autostart/enable", s.requireDangerousConfirm(s.autostartEnable))
	mux.HandleFunc("/api/autostart/disable", s.requireDangerousConfirm(s.autostartDisable))
	mux.HandleFunc("/api/services", s.services)
	mux.HandleFunc("/api/services/summary", s.summary)
	mux.HandleFunc("/api/services/start", s.requireDangerousConfirm(s.start))
	mux.HandleFunc("/api/services/stop", s.requireDangerousConfirm(s.stop))
	mux.HandleFunc("/api/services/stop-all", s.requireDangerousConfirm(s.stopAll))
	mux.HandleFunc("/api/services/autostart", s.requireDangerousConfirm(s.serviceAutostart))
	mux.HandleFunc("/api/services/model", s.requireDangerousConfirm(s.serviceModel))
	mux.HandleFunc("/api/logs/", s.logs)
	mux.HandleFunc("/api/ga/processes", s.gaProcesses)
	mux.HandleFunc("/api/ga/processes/kill", s.requireDangerousConfirm(s.killGAProcess))
	mux.HandleFunc("/api/ga/processes/adopt", s.requireDangerousConfirm(s.adoptGAProcess))
	mux.HandleFunc("/api/models", s.withModelInstance((*Server).models))
	mux.HandleFunc("/api/models/raw", s.withModelInstance((*Server).modelsRaw))
	mux.HandleFunc("/api/models/preview", s.modelsPreview)
	mux.HandleFunc("/api/models/discover", s.withModelInstance((*Server).modelsDiscover))
	mux.HandleFunc("/api/models/import-mykey", s.withModelInstance((*Server).modelsImportMyKey))
	mux.HandleFunc("/api/models/export", s.requireDangerousConfirm(s.withModelInstance((*Server).modelsExport)))
	// The title model is an Admin-wide chat preference, not an instance model file.
	mux.HandleFunc("/api/models/title-model", s.requireDangerousConfirm(s.modelsTitleModel))
	mux.HandleFunc("/api/channels/test", s.channelTest)
	mux.HandleFunc("/api/channels", s.requireDangerousConfirm(s.channels))
	mux.HandleFunc("/api/usage/overview", s.usageOverview)
	mux.HandleFunc("/api/chat/sessions", s.withChatInstance((*Server).chatSessions))
	mux.HandleFunc("/api/chat/python/install-deps", s.requireDangerousConfirm(s.withChatInstance((*Server).chatPythonInstallDeps)))
	mux.HandleFunc("/api/chat/", s.withChatInstance((*Server).chatHandler))
	// Legacy reactapp bridge is intentionally not routed; Chat is now native Admin API.
	mux.HandleFunc("/", s.static)
	return recoverPanics(cors(mux))
}

func recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				bad(w, http.StatusInternalServerError, "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-GA-Confirm, X-GA-Instance-ID")
		w.Header().Set("Access-Control-Expose-Headers", "X-GA-Instance-ID")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type riskCatalogItem struct {
	Path   string `json:"path"`
	Level  string `json:"level"`
	Action string `json:"action"`
	Reason string `json:"reason"`
}

var riskCatalogItems = []riskCatalogItem{
	{Path: "/api/files/write", Level: "dangerous", Action: "write_file", Reason: "writes into GA workspace; handler creates backup before overwrite"},
	{Path: "/api/files/delete", Level: "dangerous", Action: "delete_file", Reason: "deletes a file or directory under the configured GA root"},
	{Path: "/api/files/open", Level: "reversible", Action: "open_file_shell", Reason: "spawns the OS desktop shell to open a GA file or its containing folder"},
	{Path: "/api/config", Level: "reversible", Action: "save_config", Reason: "updates Admin-Go local config"},
	{Path: "/api/ui/theme", Level: "reversible", Action: "save_ui_theme", Reason: "updates the persisted Admin-Go appearance theme without a confirm dialog"},
	{Path: "/api/instances/create", Level: "reversible", Action: "create_instance", Reason: "adds a configured GA runtime instance"},
	{Path: "/api/instances/update", Level: "reversible", Action: "update_instance", Reason: "updates a configured GA runtime instance when its manager is idle"},
	{Path: "/api/instances/delete", Level: "dangerous", Action: "delete_instance", Reason: "removes a configured GA runtime instance when its manager is idle"},
	{Path: "/api/instances/default", Level: "reversible", Action: "set_default_instance", Reason: "changes the default GA runtime instance"},
	{Path: "/api/extra-system-prompt-presets", Level: "reversible", Action: "save_extra_system_prompt_presets", Reason: "updates the reusable extra system prompt preset library"},
	{Path: "/api/setup/validate", Level: "reversible", Action: "save_ga_root", Reason: "persists configured GA root after successful health validation"},
	{Path: "/api/instances/install", Level: "dangerous", Action: "install_instance", Reason: "downloads and extracts the GenericAgent main archive under the app instances directory and registers a new instance"},
	{Path: "/api/setup/install", Level: "dangerous", Action: "install_ga", Reason: "runs git clone or downloads the GenericAgent source archive and changes configured GA root"},
	{Path: "/api/setup/python/install", Level: "dangerous", Action: "install_python", Reason: "downloads and runs the official Windows Python installer and persists the Python path"},
	{Path: "/api/setup/python/validate", Level: "dangerous", Action: "validate_python", Reason: "executes the selected Python candidate and persists it after successful validation"},
	{Path: "/api/setup/venv/create", Level: "dangerous", Action: "create_venv", Reason: "creates or updates a Python virtual environment under the configured GA root"},
	{Path: "/api/setup/deps/install", Level: "dangerous", Action: "install_dependencies", Reason: "executes pip install in the configured GA root and streams process output"},
	{Path: "/api/setup/smoke", Level: "dangerous", Action: "run_setup_smoke", Reason: "executes Python in the configured GA root to verify bootstrap readiness"},
	{Path: "/api/setup/complete", Level: "reversible", Action: "complete_bootstrap", Reason: "marks first-run bootstrap complete and persists GA root/Python settings"},
	{Path: "/api/version/update", Level: "dangerous", Action: "self_update", Reason: "downloads and verifies an Admin-Go release without restarting"},
	{Path: "/api/version/restart", Level: "dangerous", Action: "restart_to_apply_update", Reason: "authorizes the prepared Admin-Go release to replace and restart the current process"},
	{Path: "/api/services/start", Level: "dangerous", Action: "start_process", Reason: "starts GA Python service process"},
	{Path: "/api/services/stop", Level: "dangerous", Action: "stop_process", Reason: "stops a managed GA service process"},
	{Path: "/api/services/stop-all", Level: "dangerous", Action: "stop_all_processes", Reason: "stops all managed GA services"},
	{Path: "/api/services/autostart", Level: "reversible", Action: "toggle_service_autostart", Reason: "changes Admin-Go service autostart list"},
	{Path: "/api/services/model", Level: "reversible", Action: "set_service_model", Reason: "changes the persisted model used to launch a reflect/autonomous service"},
	{Path: "/api/tmwebdriver/repair", Level: "reversible", Action: "start_tmwebdriver_master", Reason: "starts a persistent TMWebDriver master process on localhost:18766"},
	{Path: "/api/tmwebdriver/install-deps", Level: "dangerous", Action: "install_tmwebdriver_deps", Reason: "runs pip install with Tsinghua PyPI mirror for TMWebDriver dependencies"},
	{Path: "/api/ga/git-mirror", Level: "reversible", Action: "configure_git_mirror", Reason: "updates global git insteadOf mirror for github.com URLs"},
	{Path: "/api/autostart/enable", Level: "dangerous", Action: "enable_os_autostart", Reason: "writes OS autostart entry"},
	{Path: "/api/autostart/disable", Level: "reversible", Action: "disable_os_autostart", Reason: "removes OS autostart entry"},
	{Path: "/api/schedule/task", Level: "dangerous", Action: "edit_schedule_task", Reason: "changes scheduled task JSON"},
	{Path: "/api/schedule/create", Level: "dangerous", Action: "create_schedule_task", Reason: "creates scheduled task JSON"},
	{Path: "/api/schedule/delete", Level: "dangerous", Action: "delete_schedule_task", Reason: "deletes scheduled task JSON"},
	{Path: "/api/schedule/toggle", Level: "reversible", Action: "toggle_schedule_task", Reason: "enables or disables scheduled task"},
	{Path: "/api/goals/start", Level: "dangerous", Action: "start_goal", Reason: "starts autonomous GA goal process"},
	{Path: "/api/goals/stop", Level: "dangerous", Action: "stop_goal", Reason: "stops autonomous GA goal process by recorded PID"},
	{Path: "/api/goals/delete", Level: "dangerous", Action: "delete_goal", Reason: "deletes goal state/output files"},
	{Path: "/api/models", Level: "dangerous", Action: "save_model_draft", Reason: "writes GA Admin model draft profiles, including provider endpoints and credentials when supplied"},
	{Path: "/api/models/raw", Level: "dangerous", Action: "reveal_model_secrets", Reason: "returns unmasked model provider credentials after explicit dangerous authorization"},
	{Path: "/api/models/import-mykey", Level: "dangerous", Action: "import_mykey_models", Reason: "can execute mykey import and reveal or persist provider credentials when explicitly authorized"},
	{Path: "/api/models/discover", Level: "reversible", Action: "discover_provider_models", Reason: "queries the selected provider models endpoint without saving configuration"},
	{Path: "/api/models/export", Level: "dangerous", Action: "export_models", Reason: "writes active GA model configuration"},
	{Path: "/api/models/title-model", Level: "reversible", Action: "set_chat_title_model", Reason: "changes the model used for chat title generation"},
	{Path: "/api/ga/processes/kill", Level: "dangerous", Action: "kill_ga_process", Reason: "terminates a GA-related process by PID after explicit dangerous authorization"},
	{Path: "/api/ga/processes/adopt", Level: "dangerous", Action: "adopt_ga_process", Reason: "marks an external GA process as managed by Admin-Go for subsequent supervision"},
	{Path: "/api/channels", Level: "dangerous", Action: "edit_channel_secrets", Reason: "writes GA Admin channel credentials to GA root mykey.py"},
	{Path: "/api/keychain", Level: "dangerous", Action: "edit_keychain", Reason: "writes or deletes encrypted local keychain credentials"},
	{Path: "/api/chat/python/install-deps", Level: "dangerous", Action: "install_chat_python_deps", Reason: "runs pip install with Tsinghua PyPI mirror for the GA runtime imports the chat interpreter reports missing"},
}

func (s *Server) riskCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, 405, "method not allowed")
		return
	}
	writeJSON(w, map[string]interface{}{"items": riskCatalogItems})
}

func hasDangerousConfirm(r *http.Request) bool {
	return r.Header.Get("X-GA-Confirm") == "dangerous"
}

func requireDangerousHeader(w http.ResponseWriter, r *http.Request) bool {
	if !hasDangerousConfirm(r) {
		bad(w, http.StatusPreconditionRequired, "dangerous operation requires X-GA-Confirm: dangerous")
		return false
	}
	return true
}

func (s *Server) requireDangerousConfirm(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && !hasDangerousConfirm(r) {
			bad(w, 428, "dangerous operation requires X-GA-Confirm: dangerous")
			return
		}
		next(w, r)
	}
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	h := ga.BuildHealth(s.CfgStore.Snapshot().GARoot)
	address, url := s.ListenAddress()
	writeJSON(w, map[string]interface{}{
		"ok": h.OK, "config": s.CfgStore.Snapshot(), "services": s.Svc.Summary(), "health": h,
		"listen": map[string]interface{}{"address": address, "url": url, "password_set": s.passwordConfigured()},
	})
}

func (s *Server) gaInventory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, ga.BuildInventory(s.CfgStore.Snapshot().GARoot))
}

func (s *Server) gaHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, ga.BuildHealth(s.CfgStore.Snapshot().GARoot))
}

type tmwebdriverCheck struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

type tmwebdriverStatusResponse struct {
	OK             bool               `json:"ok"`
	BrowserRunning bool               `json:"browser_running"`
	PortListening  bool               `json:"port_listening"`
	ExtensionFound bool               `json:"extension_found"`
	PythonOK       bool               `json:"python_ok"`
	PythonPath     string             `json:"python_path,omitempty"`
	PythonMissing  []string           `json:"python_missing,omitempty"`
	InstallCommand string             `json:"install_command,omitempty"`
	Port           int                `json:"port"`
	ExtensionPaths []string           `json:"extension_paths,omitempty"`
	Checks         []tmwebdriverCheck `json:"checks"`
	Recommendation string             `json:"recommendation,omitempty"`
	CheckedAt      string             `json:"checked_at"`
}

func (s *Server) tmwebdriverStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, 405, "method not allowed")
		return
	}
	st := s.buildTMWebDriverStatus()
	writeJSON(w, st)
}

const defaultPipIndexURL = "https://pypi.tuna.tsinghua.edu.cn/simple"

func (s *Server) tmwebdriverInstallDeps(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	gaRoot := strings.TrimSpace(s.CfgStore.Snapshot().GARoot)
	if gaRoot == "" {
		bad(w, 400, "ga_root is empty")
		return
	}
	python := resolvePythonForRoot(gaRoot, s.CfgStore.Snapshot().PythonPath)
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	args := buildTMWebDriverInstallArgs(defaultPipIndexURL)
	cmd := exec.CommandContext(ctx, python, args...)
	cmd.Dir = gaRoot
	hideChildWindow(cmd)
	out, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		bad(w, 504, "pip install timed out")
		return
	}
	status := s.buildTMWebDriverStatus()
	resp := map[string]interface{}{
		"ok":      err == nil && status.PythonOK,
		"python":  python,
		"command": append([]string{python}, args...),
		"output":  strings.TrimSpace(string(out)),
		"status":  status,
	}
	if err != nil {
		resp["error"] = err.Error()
	}
	writeJSON(w, resp)
}

const defaultGitHubMirrorPrefix = "https://gh-proxy.com/https://github.com/"

type gitMirrorRequest struct {
	Enabled bool   `json:"enabled"`
	Mirror  string `json:"mirror"`
}

func (s *Server) gitMirrorConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	var req gitMirrorRequest
	if r.Body != nil {
		if err := decode(r, &req); err != nil {
			bad(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	mirror := strings.TrimSpace(req.Mirror)
	if mirror == "" {
		mirror = defaultGitHubMirrorPrefix
	}
	if err := validateGitMirrorPrefix(mirror); err != nil {
		bad(w, 400, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	args := buildGitMirrorArgs(req.Enabled, mirror)
	cmd := exec.CommandContext(ctx, "git", args...)
	hideChildWindow(cmd)
	out, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		bad(w, 504, "git config timed out")
		return
	}
	resp := map[string]interface{}{
		"ok":      err == nil,
		"enabled": req.Enabled,
		"mirror":  mirror,
		"command": append([]string{"git"}, args...),
		"output":  strings.TrimSpace(string(out)),
	}
	if err != nil {
		resp["error"] = err.Error()
	}
	writeJSON(w, resp)
}

func validateGitMirrorPrefix(mirror string) error {
	if mirror == "" {
		return fmt.Errorf("mirror is required")
	}
	if strings.ContainsAny(mirror, "\x00\r\n\t") {
		return fmt.Errorf("mirror must not contain control characters")
	}
	u, err := url.Parse(mirror)
	if err != nil || !u.IsAbs() {
		return fmt.Errorf("mirror must be an absolute http(s) URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("mirror scheme must be http or https")
	}
	if u.Host == "" {
		return fmt.Errorf("mirror host is required")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("mirror must not include userinfo, query, or fragment")
	}
	return nil
}

func buildGitMirrorArgs(enabled bool, mirror string) []string {
	key := "url." + mirror + ".insteadOf"
	if enabled {
		return []string{"config", "--global", key, "https://github.com/"}
	}
	return []string{"config", "--global", "--unset-all", key}
}

type tmwebdriverRepairResponse struct {
	Started bool                      `json:"started"`
	PID     int                       `json:"pid,omitempty"`
	Command []string                  `json:"command,omitempty"`
	Status  tmwebdriverStatusResponse `json:"status"`
	Message string                    `json:"message,omitempty"`
}

func (s *Server) tmwebdriverRepair(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	before := s.buildTMWebDriverStatus()
	if before.PortListening {
		writeJSON(w, tmwebdriverRepairResponse{Started: false, Status: before, Message: "18766 master 已在监听，无需重复启动。"})
		return
	}
	if !before.PythonOK {
		writeJSON(w, tmwebdriverRepairResponse{Started: false, Status: before, Message: "TMWebDriver Python 依赖缺失，请先执行：" + before.InstallCommand})
		return
	}
	pid, cmdline, err := s.startTMWebDriverMaster()
	if err != nil {
		bad(w, 500, err.Error())
		return
	}
	var after tmwebdriverStatusResponse
	for i := 0; i < 20; i++ {
		time.Sleep(250 * time.Millisecond)
		after = s.buildTMWebDriverStatus()
		if after.PortListening {
			break
		}
	}
	if after.PortListening {
	} else {
	}
	writeJSON(w, tmwebdriverRepairResponse{Started: true, PID: pid, Command: cmdline, Status: after, Message: "已启动 TMWebDriver master；若仍未 OK，请确认浏览器已打开且扩展已安装。"})
}

func (s *Server) startTMWebDriverMaster() (int, []string, error) {
	gaRoot := strings.TrimSpace(s.CfgStore.Snapshot().GARoot)
	if gaRoot == "" {
		return 0, nil, errors.New("ga_root is empty")
	}
	python := resolvePythonForRoot(gaRoot, s.CfgStore.Snapshot().PythonPath)
	code := "from TMWebDriver import TMWebDriver; TMWebDriver()"
	cmd := exec.Command(python, "-c", code)
	cmd.Dir = gaRoot
	cmd.Stdout = nil
	cmd.Stderr = nil
	hideChildWindow(cmd)
	if err := cmd.Start(); err != nil {
		return 0, []string{python, "-c", code}, err
	}
	return cmd.Process.Pid, []string{python, "-c", code}, nil
}

// resolvePythonForRoot picks the interpreter for a GA root. The order lives in
// pyfind, which skips the Microsoft Store python stub instead of handing back a
// launcher that exits 9009.
func resolvePythonForRoot(gaRoot, configured string) string {
	if py := pyfind.Resolve(gaRoot, configured); py != "" {
		return py
	}
	return "python"
}

// resolveUsablePythonForRoot is resolvePythonForRoot plus a dependency check.
// Path-only resolution is enough while provisioning, but running GA code needs
// an interpreter that can actually import GA's dependencies: a fresh instance
// has no .venv, so the path-only answer can be a bare interpreter that fails on
// "import requests". An explicitly configured interpreter is always honored as
// is, so an operator's choice is never silently overridden.
func resolveUsablePythonForRoot(gaRoot, configured string, fallbacks []string) string {
	if strings.TrimSpace(configured) != "" {
		return resolvePythonForRoot(gaRoot, configured)
	}
	if py := pyfind.ResolveUsable(gaRoot, configured, fallbacks); py != "" {
		return py
	}
	return resolvePythonForRoot(gaRoot, configured)
}

func (s *Server) buildTMWebDriverStatus() tmwebdriverStatusResponse {
	return buildTMWebDriverStatusForConfig(s.CfgStore.Snapshot().GARoot, s.CfgStore.Snapshot().PythonPath)
}

func buildTMWebDriverStatusForConfig(gaRoot, configuredPython string) tmwebdriverStatusResponse {
	const port = 18766
	browserRunning, browserDetail := detectChromeRunning()
	portListening, portDetail := detectTCPListening("127.0.0.1", port, 700*time.Millisecond)
	extFound, extPaths, extDetail := detectTMWebDriverExtension()
	pythonPath := resolvePythonForRoot(gaRoot, configuredPython)
	pythonOK, pythonMissing, pythonDetail := detectTMWebDriverPythonDeps(gaRoot, pythonPath)
	installCommand := buildTMWebDriverInstallCommand(pythonPath)
	st := tmwebdriverStatusResponse{
		OK:             browserRunning && portListening && extFound && pythonOK,
		BrowserRunning: browserRunning,
		PortListening:  portListening,
		ExtensionFound: extFound,
		PythonOK:       pythonOK,
		PythonPath:     pythonPath,
		PythonMissing:  pythonMissing,
		InstallCommand: installCommand,
		Port:           port,
		ExtensionPaths: extPaths,
		CheckedAt:      time.Now().Format(time.RFC3339),
		Checks: []tmwebdriverCheck{
			{Name: "browser_process", OK: browserRunning, Detail: browserDetail},
			{Name: "python_dependencies", OK: pythonOK, Detail: pythonDetail},
			{Name: "ws_master_port", OK: portListening, Detail: portDetail},
			{Name: "chrome_extension", OK: extFound, Detail: extDetail},
		},
	}
	if st.OK {
		st.Recommendation = "TMWebDriver 基础监控正常：Python 依赖、浏览器进程、18766 master 端口和扩展均已检测到。"
	} else if !pythonOK {
		st.Recommendation = fmt.Sprintf("TMWebDriver Python 依赖缺失：%s。请在 GA 环境执行：%s", strings.Join(pythonMissing, ", "), installCommand)
	} else if !browserRunning {
		st.Recommendation = "未检测到 Chrome/Edge 浏览器进程；请先打开已安装 TMWebDriver 扩展的浏览器。"
	} else if !portListening {
		st.Recommendation = "未检测到 18766 端口监听；请重启 ljq_driver/TMWebDriver master。"
	} else if !extFound {
		st.Recommendation = "未在 Chrome Secure Preferences 中检测到 tmwd_cdp_bridge 扩展；请按 web_setup_sop 安装或修复扩展。"
	}
	return st
}

func tmwebdriverPythonModules() []string {
	return []string{"requests", "bottle", "simple_websocket_server"}
}

func tmwebdriverModuleToPipPackage(module string) string {
	return pipPackageForModule(module)
}

func tmwebdriverPipPackages(modules []string) []string {
	pkgs := make([]string, 0, len(modules))
	for _, m := range modules {
		pkgs = append(pkgs, tmwebdriverModuleToPipPackage(m))
	}
	return pkgs
}

func tmwebdriverRequiredPipPackages() []string {
	return tmwebdriverPipPackages(tmwebdriverPythonModules())
}

func detectTMWebDriverPythonDeps(gaRoot, python string) (bool, []string, string) {
	modules := tmwebdriverPythonModules()
	code := "import importlib.util, json; mods=" + strconv.Quote(strings.Join(modules, ",")) + ".split(','); missing=[m for m in mods if importlib.util.find_spec(m) is None]; print(json.dumps(missing))"
	cmd := exec.Command(python, "-c", code)
	if strings.TrimSpace(gaRoot) != "" {
		cmd.Dir = gaRoot
	}
	hideChildWindow(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return false, tmwebdriverRequiredPipPackages(), strings.TrimSpace(string(out) + " " + err.Error())
	}
	var missingModules []string
	if err := json.Unmarshal(bytes.TrimSpace(out), &missingModules); err != nil {
		return false, tmwebdriverRequiredPipPackages(), "cannot parse python dependency probe: " + strings.TrimSpace(string(out))
	}
	missingPkgs := tmwebdriverPipPackages(missingModules)
	if len(missingPkgs) > 0 {
		return false, missingPkgs, "missing: " + strings.Join(missingPkgs, ", ")
	}
	return true, nil, strings.Join(tmwebdriverRequiredPipPackages(), ", ") + " installed for " + python
}

func buildTMWebDriverInstallArgs(indexURL string) []string {
	args := []string{"-m", "pip", "install"}
	if strings.TrimSpace(indexURL) != "" {
		args = append(args, "-i", strings.TrimSpace(indexURL))
	}
	return append(args, tmwebdriverRequiredPipPackages()...)
}

func buildTMWebDriverInstallCommand(python string) string {
	if strings.TrimSpace(python) == "" {
		python = "python"
	}
	return python + " " + strings.Join(buildTMWebDriverInstallArgs(defaultPipIndexURL), " ")
}

func detectTCPListening(host string, port int, timeout time.Duration) (bool, string) {
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return false, err.Error()
	}
	_ = conn.Close()
	return true, "listening on " + addr
}

func detectChromeRunning() (bool, string) {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("tasklist", "/FO", "CSV", "/NH")
		hideChildWindow(cmd)
		out, err := cmd.Output()
		if err != nil {
			return false, err.Error()
		}
		lower := bytes.ToLower(out)
		if bytes.Contains(lower, []byte("chrome.exe")) || bytes.Contains(lower, []byte("msedge.exe")) {
			return true, "chrome.exe/msedge.exe process found"
		}
		return false, "chrome.exe/msedge.exe process not found"
	}
	cmd := exec.Command("ps", "-A", "-o", "comm=")
	hideChildWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return false, err.Error()
	}
	lower := bytes.ToLower(out)
	if bytes.Contains(lower, []byte("chrome")) || bytes.Contains(lower, []byte("chromium")) || bytes.Contains(lower, []byte("msedge")) {
		return true, "chrome/chromium/msedge process found"
	}
	return false, "chrome/chromium/msedge process not found"
}

func detectTMWebDriverExtension() (bool, []string, string) {
	candidates := chromeSecurePreferencePaths()
	var paths []string
	var checked []string
	for _, p := range candidates {
		checked = append(checked, p)
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		lower := strings.ToLower(string(b))
		if strings.Contains(lower, "tmwd_cdp_bridge") {
			paths = append(paths, p)
		}
	}
	if len(paths) > 0 {
		return true, paths, fmt.Sprintf("found in %d profile(s)", len(paths))
	}
	if len(checked) == 0 {
		return false, nil, "no known Chrome profile paths"
	}
	return false, nil, "not found in checked Secure Preferences"
}

func chromeSecurePreferencePaths() []string {
	var roots []string
	if runtime.GOOS == "windows" {
		local := os.Getenv("LOCALAPPDATA")
		if local != "" {
			roots = append(roots, filepath.Join(local, "Google", "Chrome", "User Data"), filepath.Join(local, "Microsoft", "Edge", "User Data"))
		}
	} else {
		home, _ := os.UserHomeDir()
		if home != "" {
			roots = append(roots, filepath.Join(home, ".config", "google-chrome"), filepath.Join(home, ".config", "chromium"), filepath.Join(home, ".config", "microsoft-edge"), filepath.Join(home, "Library", "Application Support", "Google", "Chrome"))
		}
	}
	var out []string
	for _, root := range roots {
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			name := e.Name()
			if name == "Default" || strings.HasPrefix(name, "Profile ") {
				out = append(out, filepath.Join(root, name, "Secure Preferences"))
			}
		}
	}
	return out
}

func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		bad(w, 405, "method not allowed")
		return
	}
	if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
		bad(w, http.StatusNotFound, "api route not found")
		return
	}
	if s.Static == nil {
		bad(w, 404, "web dist not embedded")
		return
	}
	rawPath := strings.TrimPrefix(r.URL.Path, "/")
	for _, seg := range strings.Split(rawPath, "/") {
		if seg == ".." || strings.Contains(seg, `\\`) {
			bad(w, http.StatusBadRequest, "invalid static asset path")
			return
		}
	}
	p := rawPath
	if p == "" {
		p = "index.html"
	}
	p = path.Clean(p)
	data, err := fs.ReadFile(s.Static, p)
	if err != nil {
		data, err = fs.ReadFile(s.Static, "index.html")
		if err != nil {
			bad(w, 404, fmt.Sprintf("not found: %s", p))
			return
		}
		p = "index.html"
	}
	s.serveStaticData(w, r, p, data)
}

func (s *Server) serveStaticData(w http.ResponseWriter, r *http.Request, name string, data []byte) {
	if name == "index.html" {
		data = injectUITheme(data, s.storedUITheme())
	}
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		// Root assets have stable URLs. Revalidate them so a deployment cannot
		// leave an old index referring to chunks that no longer exist.
		w.Header().Set("Cache-Control", "no-cache")
	}
	if contentType := staticContentType(name); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}

	body := data
	if staticGzipEligible(name) {
		w.Header().Set("Vary", "Accept-Encoding")
		if acceptsGzip(r.Header.Get("Accept-Encoding")) {
			// index.html carries a per-response theme bootstrap snippet, so it
			// must not reuse a gzip cache keyed only by filename.
			if cached, ok := s.staticGzip.Load(name); ok && name != "index.html" {
				body = cached.([]byte)
			} else {
				var compressed bytes.Buffer
				zw := gzip.NewWriter(&compressed)
				_, _ = zw.Write(data)
				_ = zw.Close()
				body = compressed.Bytes()
				if name != "index.html" {
					s.staticGzip.Store(name, body)
				}
			}
			w.Header().Set("Content-Encoding", "gzip")
		}
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(body)
}

func staticContentType(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".js", ".mjs":
		return "application/javascript"
	case ".css":
		return "text/css; charset=utf-8"
	case ".html":
		return "text/html; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	}
	return mime.TypeByExtension(path.Ext(name))
}

func staticGzipEligible(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".css", ".html", ".js", ".json", ".mjs", ".svg", ".txt", ".xml":
		return true
	default:
		return false
	}
}

func acceptsGzip(header string) bool {
	gzipQuality := -1.0
	wildcardQuality := -1.0
	for _, item := range strings.Split(header, ",") {
		parts := strings.Split(item, ";")
		encoding := strings.ToLower(strings.TrimSpace(parts[0]))
		quality := 1.0
		for _, parameter := range parts[1:] {
			keyValue := strings.SplitN(strings.TrimSpace(parameter), "=", 2)
			if len(keyValue) != 2 || !strings.EqualFold(strings.TrimSpace(keyValue[0]), "q") {
				continue
			}
			parsed, err := strconv.ParseFloat(strings.TrimSpace(keyValue[1]), 64)
			if err != nil || parsed < 0 || parsed > 1 {
				quality = 0
			} else {
				quality = parsed
			}
		}
		switch encoding {
		case "gzip":
			gzipQuality = quality
		case "*":
			wildcardQuality = quality
		}
	}
	if gzipQuality >= 0 {
		return gzipQuality > 0
	}
	return wildcardQuality > 0
}

type reactAppBridge struct {
	mu     sync.Mutex
	cmd    *exec.Cmd
	port   int
	base   *url.URL
	proxy  *httputil.ReverseProxy
	logs   []string
	status string
}

var (
	reactAppReadyTimeout      = 5 * time.Second
	reactAppReadyPollInterval = 150 * time.Millisecond
)

func newReactAppBridge() *reactAppBridge { return &reactAppBridge{status: "stopped"} }

func (b *reactAppBridge) snapshot() map[string]interface{} {
	b.mu.Lock()
	defer b.mu.Unlock()
	running := b.cmd != nil && b.cmd.Process != nil && b.status == "running"
	pid := 0
	if running {
		pid = b.cmd.Process.Pid
		if !processAlive(pid) {
			b.status = "stopped"
			b.logs = append(b.logs, fmt.Sprintf("[process exited: pid %d is no longer alive]", pid))
			if len(b.logs) > 300 {
				b.logs = b.logs[len(b.logs)-300:]
			}
			running = false
			pid = 0
		}
	}
	logs := append([]string(nil), b.logs...)
	return map[string]interface{}{"running": running, "pid": pid, "port": b.port, "url": "/reactapp/", "status": b.status, "logs": logs}
}

func (b *reactAppBridge) appendLog(line string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.logs = append(b.logs, line)
	if len(b.logs) > 300 {
		b.logs = b.logs[len(b.logs)-300:]
	}
}

func (b *reactAppBridge) stop() error {
	b.mu.Lock()
	cmd := b.cmd
	b.status = "stopped"
	b.proxy = nil
	b.base = nil
	b.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		return cmd.Process.Kill()
	}
	return nil
}

func (b *reactAppBridge) start(gaRoot string) error {
	b.mu.Lock()
	if b.cmd != nil && b.cmd.Process != nil && b.status == "running" {
		pid := b.cmd.Process.Pid
		if processAlive(pid) {
			b.mu.Unlock()
			return nil
		}
		b.status = "stopped"
		b.logs = append(b.logs, fmt.Sprintf("[process exited: pid %d is no longer alive]", pid))
		if len(b.logs) > 300 {
			b.logs = b.logs[len(b.logs)-300:]
		}
	}
	b.mu.Unlock()
	port, err := freePort()
	if err != nil {
		return err
	}
	py := pythonForRoot(gaRoot)
	script := filepath.Join(gaRoot, "frontends", "reactapp.py")
	if st, err := os.Stat(script); err != nil || st.IsDir() {
		return fmt.Errorf("reactapp.py not found: %s", script)
	}
	cmd := exec.Command(py, script)
	cmd.Dir = gaRoot
	cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1", fmt.Sprintf("GA_REACT_PORT=%d", port))
	hideChildWindow(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	u, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d/", port))
	proxy := httputil.NewSingleHostReverseProxy(u)
	orig := proxy.Director
	proxy.Director = func(r *http.Request) {
		orig(r)
		r.Host = u.Host
		r.URL.Path = strings.TrimPrefix(r.URL.Path, "/reactapp")
		if r.URL.Path == "" {
			r.URL.Path = "/"
		}
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	b.mu.Lock()
	b.cmd = cmd
	b.port = port
	b.base = u
	b.proxy = proxy
	b.status = "running"
	b.logs = []string{fmt.Sprintf("$ %s %s (GA_REACT_PORT=%d)", py, script, port)}
	b.mu.Unlock()
	go b.copyPipe(stdout)
	go b.copyPipe(stderr)
	go func() {
		err := cmd.Wait()
		b.appendLog(fmt.Sprintf("[process exited: %v]", err))
		b.mu.Lock()
		if b.cmd == cmd {
			b.status = "stopped"
		}
		b.mu.Unlock()
	}()
	return b.waitUntilReady(port, cmd)
}

func (b *reactAppBridge) waitUntilReady(port int, cmd *exec.Cmd) error {
	deadline := time.Now().Add(reactAppReadyTimeout)
	for time.Now().Before(deadline) {
		if conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 200*time.Millisecond); err == nil {
			_ = conn.Close()
			return nil
		}
		time.Sleep(reactAppReadyPollInterval)
	}
	err := fmt.Errorf("reactapp did not become ready on 127.0.0.1:%d within %s", port, reactAppReadyTimeout)
	b.appendLog("[readiness timeout] " + err.Error())
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	b.mu.Lock()
	if b.cmd == cmd {
		b.status = "stopped"
		b.proxy = nil
		b.base = nil
	}
	b.mu.Unlock()
	return err
}

func (b *reactAppBridge) copyPipe(r io.Reader) {
	buf := make([]byte, 4096)
	acc := ""
	for {
		n, err := r.Read(buf)
		if n > 0 {
			acc += string(buf[:n])
			for {
				i := strings.IndexByte(acc, '\n')
				if i < 0 {
					break
				}
				b.appendLog(strings.TrimRight(acc[:i], "\r"))
				acc = acc[i+1:]
			}
		}
		if err != nil {
			if acc != "" {
				b.appendLog(acc)
			}
			return
		}
	}
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func pythonForRoot(root string) string {
	cands := []string{}
	if runtime.GOOS == "windows" {
		cands = append(cands, filepath.Join(root, ".venv", "Scripts", "python.exe"), filepath.Join(root, "venv", "Scripts", "python.exe"))
	} else {
		cands = append(cands, filepath.Join(root, ".venv", "bin", "python"), filepath.Join(root, "venv", "bin", "python"))
	}
	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return "python"
}

func (s *Server) reactAppStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.ReactApp.snapshot())
}
func (s *Server) reactAppStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	if err := s.ReactApp.start(s.CfgStore.Snapshot().GARoot); err != nil {
		bad(w, 500, err.Error())
		return
	}
	writeJSON(w, s.ReactApp.snapshot())
}
func (s *Server) reactAppStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	if err := s.ReactApp.stop(); err != nil {
		bad(w, 500, err.Error())
		return
	}
	writeJSON(w, s.ReactApp.snapshot())
}
func (s *Server) reactAppProxy(w http.ResponseWriter, r *http.Request) {
	if err := s.ReactApp.start(s.CfgStore.Snapshot().GARoot); err != nil {
		bad(w, 500, err.Error())
		return
	}
	s.ReactApp.mu.Lock()
	proxy := s.ReactApp.proxy
	s.ReactApp.mu.Unlock()
	if proxy == nil {
		bad(w, 503, "reactapp proxy not ready")
		return
	}
	proxy.ServeHTTP(w, r)
}

// StopManagedServices stops GenericAgent child services managed by the Admin UI.
func (s *Server) StopManagedServices() {
	s.StopChatFeishuBridge()
	for _, manager := range s.managedServiceManagers() {
		manager.StopAll()
	}
}

// RunningManagedServices counts what StopManagedServices would stop, so a menu
// entry can say how much is at stake before someone clicks it.
func (s *Server) RunningManagedServices() int {
	running := 0
	for _, manager := range s.managedServiceManagers() {
		running += manager.RunningProcessCount()
	}
	if s.IsChatFeishuBridgeRunning() {
		running++
	}
	return running
}

// managedServiceManagers lists every manager whose processes this Admin owns.
// Each configured instance runs its own, and the default manager stays in the
// list because it serves a single-instance setup on its own; leaving the extra
// instances out would strand their children when the Admin exits.
func (s *Server) managedServiceManagers() []*service.Manager {
	if s == nil {
		return nil
	}
	seen := map[*service.Manager]bool{}
	managers := make([]*service.Manager, 0, 2)
	for _, manager := range s.InstanceManagers.managers() {
		if manager == nil || seen[manager] {
			continue
		}
		seen[manager] = true
		managers = append(managers, manager)
	}
	if s.Svc != nil && !seen[s.Svc] {
		managers = append(managers, s.Svc)
	}
	return managers
}

// ShutdownCleanup stops child processes before the Admin process exits.
func (s *Server) ShutdownCleanup() {
	if s == nil {
		return
	}
	// Prevent install work from starting or progressing before persistent child
	// cleanup. Waiting happens last so a stuck installer cannot prevent chat
	// workers and managed services from receiving their stop requests.
	s.StopChatAutorun()
	s.cancelInstanceInstalls()
	s.StopChatHubBridge()
	s.StopChatFeishuBridge()
	s.StopManagedServices()
	if s.ReactApp != nil {
		_ = s.ReactApp.stop()
	}
	s.CloseChatWorkers()
	s.waitForInstanceInstalls()
}
