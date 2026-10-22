package api

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"genericagent-admin-go/internal/config"
	"genericagent-admin-go/internal/modelconfig"
)

type chatMessage struct {
	ID                string                   `json:"id"`
	Role              string                   `json:"role"`
	SenderKind        string                   `json:"sender_kind,omitempty"`
	Content           string                   `json:"content"`
	Outputs           []string                 `json:"outputs,omitempty"`
	ModelID           string                   `json:"model_id,omitempty"`
	Files             []map[string]interface{} `json:"files,omitempty"`
	CreatedAt         int64                    `json:"created_at"`
	Error             bool                     `json:"error,omitempty"`
	Kind              string                   `json:"kind,omitempty"`
	SideQuestion      string                   `json:"side_question,omitempty"`
	Usage             map[string]int           `json:"usage,omitempty"`
	Usages            []map[string]int         `json:"usages,omitempty"`
	CtxChars          int                      `json:"ctx_chars,omitempty"`
	CtxMsgs           int                      `json:"ctx_msgs,omitempty"`
	ElapsedMS         int64                    `json:"elapsed_ms,omitempty"`
	LLMElapsedMS      int64                    `json:"llm_elapsed_ms,omitempty"`
	ToolElapsedMS     int64                    `json:"tool_elapsed_ms,omitempty"`
	FirstTokenMS      int64                    `json:"first_token_ms,omitempty"`
	RunStartedAtMS    int64                    `json:"run_started_at_ms,omitempty"`
	UltraPlanState    map[string]interface{}   `json:"ultraplan_state,omitempty"`
	GoalState         map[string]interface{}   `json:"goal_state,omitempty"`
	TaskOutputs       map[string][]string      `json:"task_outputs,omitempty"`
	StructuredContent []map[string]interface{} `json:"structured_content,omitempty"`
}

type chatLoopRecord struct {
	AtMS    int64  `json:"created_at_ms"`
	Round   int    `json:"round"`
	Phase   string `json:"phase"`
	Summary string `json:"summary"`
	Prompt  string `json:"prompt,omitempty"`
}

type chatLoopState struct {
	MaxRounds             int              `json:"max_rounds"`
	MaxRetries            *int             `json:"max_retries,omitempty"`
	WorkerErrorStreak     int              `json:"worker_error_streak,omitempty"`
	Enabled               bool             `json:"enabled"`
	Status                string           `json:"status"`
	Epoch                 int64            `json:"epoch"`
	Round                 int              `json:"round"`
	StopReason            string           `json:"stop_reason,omitempty"`
	ControllerPrompt      string           `json:"controller_prompt,omitempty"`
	ControllerLLMNo       int              `json:"controller_llm_no"`
	Records               []chatLoopRecord `json:"records,omitempty"`
	LastPromptFingerprint string           `json:"last_prompt_fingerprint,omitempty"`
	RepeatStreak          int              `json:"repeat_streak,omitempty"`
}

type chatSession struct {
	ID                     string                   `json:"id"`
	Title                  string                   `json:"title"`
	Conductor              *chatConductorState      `json:"conductor,omitempty"`
	ConductorChildren      []chatConductorChild     `json:"conductor_children,omitempty"`
	TitleSource            string                   `json:"title_source,omitempty"`
	UpdatedAt              int64                    `json:"updated_at"`
	Messages               []chatMessage            `json:"messages"`
	Settings               chatSettings             `json:"settings"`
	RawHistory             []map[string]interface{} `json:"raw_history,omitempty"`
	HistoryInfo            []interface{}            `json:"history_info,omitempty"`
	Working                map[string]interface{}   `json:"working,omitempty"`
	Plan                   map[string]interface{}   `json:"plan,omitempty"`
	WorldlineHead          string                   `json:"worldline_head,omitempty"`
	Workspace              string                   `json:"workspace,omitempty"`
	ProjectMode            string                   `json:"project_mode,omitempty"`
	ProjectProvider        string                   `json:"project_provider,omitempty"`
	ProjectID              string                   `json:"project_id,omitempty"`
	HubEnabled             bool                     `json:"hub_enabled,omitempty"`
	Pinned                 bool                     `json:"pinned,omitempty"`
	ExtraSysPrompts        []string                 `json:"extra_sys_prompts,omitempty"`
	ExtraSysPromptPresetID string                   `json:"extra_sys_prompt_preset_id,omitempty"`
	Autorun                chatAutorunState         `json:"autorun"`
	Loop                   chatLoopState            `json:"loop"`
	QueuedMessages         []chatQueuedMessage      `json:"queued_messages,omitempty"`
}

const (
	maxChatUploadFiles        = 8
	maxChatUploadBytesPerFile = 300 << 20
	maxChatUploadBytesTotal   = 300 << 20
	maxChatTitleRunes         = 50
	// maxChatPostBodyBytes must accommodate base64-encoded uploads (which inflate
	// raw bytes by ~4/3) plus prompt text and per-file metadata, so it is set well
	// above maxChatUploadBytesTotal. The decoded raw size is still capped by
	// saveChatUploads, so this only governs the transport payload size.
	maxChatPostBodyBytes = (maxChatUploadBytesTotal+2)/3*4 + (4 << 20)
	// Worker stdout is NDJSON, but a single final/error event can contain a large
	// assistant answer. bufio.Scanner hard-limits tokens unless configured and
	// drops data above that limit, so runChatWorker uses readChatWorkerLine instead.
	maxChatWorkerLineBytes = 128 << 20
)

const (
	chatTitleSourceTemporary = "temporary"
	chatTitleSourceGenerated = "generated"
	chatTitleSourceManual    = "manual"
	chatTitleSourceObjective = "objective"
)

type chatUpload struct {
	ID      string `json:"id,omitempty"`
	Name    string `json:"name"`
	Type    string `json:"type,omitempty"`
	Size    int64  `json:"size,omitempty"`
	DataURL string `json:"dataURL"`
}

type chatQueuedMessage struct {
	Kind            string       `json:"kind,omitempty"`
	ID              string       `json:"id"`
	Text            string       `json:"text"`
	Files           []chatUpload `json:"files,omitempty"`
	LLMNo           int          `json:"llmNo"`
	ReasoningEffort string       `json:"reasoningEffort,omitempty"`
	QueuedAt        int64        `json:"queuedAt"`
}

type chatTitleExchange struct {
	User               string `json:"user"`
	Assistant          string `json:"assistant"`
	UserMessageID      string `json:"-"`
	AssistantMessageID string `json:"-"`
}

type chatTitleContextMessage struct {
	Role        string `json:"role"`
	Content     string `json:"content"`
	SourceIndex int    `json:"-"`
}

type chatTitleContext struct {
	Messages []chatTitleContextMessage `json:"messages"`
}

var (
	errChatTitleBusy      = errors.New("chat title generation is already running")
	errChatTitleNoContext = errors.New("chat has no usable messages for title generation")
	errChatTitleChanged   = errors.New("chat changed while the title was being generated")
	errChatTitleEmpty     = errors.New("title model returned an empty title")
	errChatTitleRunActive = errors.New("cannot generate a title while the chat is running")
	errChatTitleNotLegacy = errors.New("chat title is not eligible for automatic backfill")
)

type chatRun struct {
	ID                 string
	SID                string
	QueueID            string
	QueueIDs           []string
	Events             [][]byte
	ReplayCleanup      *time.Timer // guarded by ChatMu; never captures the event payload
	TaskbarText        strings.Builder
	TaskbarDirty       bool
	TaskbarWaiting     bool
	Done               bool
	Canceled           bool
	CancelReady        bool
	PendingAssistantID string
	RunStartedAtMS     int64
	ConductorProgress  conductorRunProgress
	Cmd                *exec.Cmd
	Subscribers        map[chan []byte]bool
}

const chatRunSubscriberBuffer = 4096

type chatWorker struct {
	SID         string
	Cmd         *exec.Cmd
	Stdin       io.WriteCloser
	Stdout      io.ReadCloser
	Stderr      io.ReadCloser
	Dead        bool // lifecycle fields below are guarded by ChatMu, not Mu
	Users       int
	Ready       chan struct{}
	StartErr    error
	IdleCleanup *time.Timer
	stopOnce    sync.Once
	Mu          sync.Mutex
}

func setChatStreamHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
}

func (s *Server) streamChatRun(w http.ResponseWriter, r *http.Request, sid string, from int) {
	setChatStreamHeaders(w)
	flusher, _ := w.(http.Flusher)
	s.ChatMu.Lock()
	run := s.ChatRuns[sid]
	if run == nil {
		s.ChatMu.Unlock()
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if from < 0 {
		from = 0
	}
	if from > len(run.Events) {
		from = len(run.Events)
	}
	initial := append([][]byte(nil), run.Events[from:]...)
	ch := make(chan []byte, chatRunSubscriberBuffer)
	if !run.Done {
		run.Subscribers[ch] = true
	}
	done := run.Done
	pendingAssistantID := run.PendingAssistantID
	runStartedAtMS := run.RunStartedAtMS
	s.ChatMu.Unlock()
	if pendingAssistantID != "" {
		w.Header().Set("X-Chat-Pending-ID", pendingAssistantID)
	}
	if runStartedAtMS > 0 {
		w.Header().Set("X-Chat-Run-Started-At-Ms", strconv.FormatInt(runStartedAtMS, 10))
	}
	for _, line := range initial {
		_, _ = w.Write(append(append([]byte(nil), line...), '\n'))
		if flusher != nil {
			flusher.Flush()
		}
	}
	if done {
		return
	}
	// Replay/live boundary: clients render everything before "sync" instantly
	// (page-refresh reattach backlog) and only animate deltas after it.
	// Done runs skip it (stream ends; the client drain flushes the backlog).
	// Not stored in run.Events, so clients must not count it toward the cursor.
	_, _ = w.Write([]byte("{\"type\":\"sync\"}\n"))
	if flusher != nil {
		flusher.Flush()
	}
	defer func() {
		s.ChatMu.Lock()
		if rr := s.ChatRuns[sid]; rr != nil && rr.Subscribers != nil {
			delete(rr.Subscribers, ch)
		}
		s.ChatMu.Unlock()
	}()
	for {
		select {
		case line, ok := <-ch:
			if !ok {
				return
			}
			_, _ = w.Write(append(append([]byte(nil), line...), '\n'))
			if flusher != nil {
				flusher.Flush()
			}
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) finishChatError(w http.ResponseWriter, enc *json.Encoder, flusher http.Flusher, cs *chatSession, err error) {
	msg := chatMessage{ID: newChatID(), Role: "assistant", Content: fmt.Sprintf("提交失败：%v", err), CreatedAt: time.Now().Unix(), Error: true}
	cs.Messages = append(cs.Messages, msg)
	_ = saveChatSession(s.CfgStore.Snapshot(), *cs)
	_ = enc.Encode(map[string]interface{}{"type": "error", "message": msg})
	if flusher != nil {
		flusher.Flush()
	}
}

func chatPythonForConfig(cfg config.AppConfig) string {
	// Chat must honor the Python selected during setup. Falling back to a bare
	// launcher can miss GA dependencies (for example requests) and hide models.
	// With nothing configured, borrow a sibling instance's interpreter rather
	// than trusting a path that merely exists.
	return resolveUsablePythonForRoot(cfg.GARoot, cfg.PythonPath, cfg.PythonFallbackRoots)
}

func (s *Server) listGARuntimeLLMs(cfg config.AppConfig) ([]map[string]interface{}, error) {
	root := cfg.GARoot
	py := chatPythonForConfig(cfg)
	code := `import json, os, sys
root = sys.argv[1]
if root not in sys.path:
    sys.path.insert(0, root)
os.chdir(root)
from agentmain import GenericAgent
agent = GenericAgent()
items = []
for idx, label, active in agent.list_llms():
    text = str(label)
    client = agent.llmclients[int(idx)]
    backend = client.backend
    name = str(getattr(backend, 'name', '') or '')
    model = str(getattr(backend, 'model', '') or '')
    provider = type(backend).__name__
    items.append({'index': int(idx), 'label': text, 'name': name, 'provider': provider, 'model': model, 'active': bool(active)})
print(json.dumps(items, ensure_ascii=False))`
	cmd := exec.Command(py, "-c", code, root)
	cmd.Dir = root
	hideChildWindow(cmd)
	cmd.Env = pythonEnvWithAdminProxy(cfg, "PYTHONUNBUFFERED=1", "PYTHONUTF8=1", "PYTHONIOENCODING=utf-8")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return []map[string]interface{}{}, &chatLLMListError{Stage: "list GA LLMs failed", Python: py, Root: root, Output: string(out), Err: err}
	}
	clean := bytes.TrimSpace(out)
	llms, parseErr := parseLLMJSONArrayFromMixedOutput(clean)
	if parseErr != nil {
		return []map[string]interface{}{}, &chatLLMListError{Stage: "parse GA LLMs failed", Python: py, Root: root, Output: string(out), Err: parseErr}
	}
	if draft, importErr := s.loadModelsFromOfficialMyKey(false); importErr == nil {
		annotateChatLLMProviders(llms, draft.Profiles)
		annotateChatLLMFailoverGroups(llms, draft.FailoverGroups)
	}
	return llms, nil
}

type chatProviderModel struct {
	providerOrder   int
	provider        string
	model           string
	displayName     string
	reasoningEffort string
	order           int
	sequence        int
}

func annotateChatLLMProviders(llms []map[string]interface{}, profiles []modelconfig.Profile) {
	configured := make([]chatProviderModel, 0)
	sequence := 0
	for profileIndex, profile := range profiles {
		providerOrder := profileIndex
		if profile.ProviderSortOrder != nil {
			providerOrder = *profile.ProviderSortOrder
		}
		provider := chatProviderDisplayName(profile)
		configs := profile.ModelConfigs
		if len(configs) == 0 {
			configs = make([]modelconfig.ModelConfig, 0, len(profile.Models))
			for _, model := range profile.Models {
				configs = append(configs, modelconfig.ModelConfig{Model: model})
			}
		}
		for _, config := range configs {
			model := strings.TrimSpace(config.Model)
			if model == "" {
				continue
			}
			order := int(^uint(0) >> 1)
			if config.SortOrder != nil {
				order = *config.SortOrder
			}
			configured = append(configured, chatProviderModel{
				providerOrder:   providerOrder,
				provider:        provider,
				model:           model,
				displayName:     strings.TrimSpace(config.Name),
				reasoningEffort: strings.ToLower(strings.TrimSpace(config.ReasoningEffort)),
				order:           order,
				sequence:        sequence,
			})
			sequence++
		}
	}
	sort.SliceStable(configured, func(i, j int) bool {
		if configured[i].order == configured[j].order {
			return configured[i].sequence < configured[j].sequence
		}
		return configured[i].order < configured[j].order
	})

	used := make([]bool, len(configured))
	unresolved := make([]int, 0)
	for i, item := range llms {
		if isChatLLMFailover(item) {
			continue
		}
		model := chatLLMModel(item)
		if i < len(configured) && (model == "" || configured[i].model == model) {
			applyChatProviderModel(item, configured[i])
			used[i] = true
			continue
		}
		unresolved = append(unresolved, i)
	}
	for _, llmIndex := range unresolved {
		item := llms[llmIndex]
		model := chatLLMModel(item)
		for configuredIndex, candidate := range configured {
			if used[configuredIndex] || candidate.model != model {
				continue
			}
			applyChatProviderModel(item, candidate)
			used[configuredIndex] = true
			break
		}
	}
}

func isChatLLMFailover(item map[string]interface{}) bool {
	return strings.EqualFold(strings.TrimSpace(fmt.Sprint(item["provider"])), "MixinSession")
}

func annotateChatLLMFailoverGroups(llms []map[string]interface{}, groups []modelconfig.FailoverGroup) {
	groupIndex := 0
	for _, item := range llms {
		if !isChatLLMFailover(item) || groupIndex >= len(groups) {
			continue
		}
		group := groups[groupIndex]
		name := strings.TrimSpace(group.VarName)
		groupIndex++
		name = strings.TrimPrefix(name, "mixin_config_")
		if name != "" {
			item["failover_group"] = name
		}
		label := strings.TrimSpace(group.DisplayName)
		if label == "" {
			label = name
		}
		if label != "" {
			item["label"] = label
		}
	}
}

func applyChatProviderModel(item map[string]interface{}, configured chatProviderModel) {
	item["provider"] = configured.provider
	item["provider_sort_order"] = configured.providerOrder
	if configured.reasoningEffort != "" {
		item["reasoning_effort"] = configured.reasoningEffort
	}
	if chatLLMModel(item) == "" {
		item["model"] = configured.model
	}
	if configured.displayName != "" {
		item["label"] = configured.displayName
	} else {
		// fallback to name when display_name is empty
		if name, ok := item["name"].(string); ok && strings.TrimSpace(name) != "" {
			item["label"] = name
		}
	}
}

func chatLLMModel(item map[string]interface{}) string {
	value, ok := item["model"]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func chatProviderDisplayName(profile modelconfig.Profile) string {
	if displayName := strings.TrimSpace(profile.DisplayName); displayName != "" {
		return displayName
	}
	name := strings.TrimSpace(profile.VarName)
	for _, prefix := range []string{"native_oai_config", "native_claude_config", "oai_config", "claude_config"} {
		if strings.HasPrefix(name, prefix) {
			name = strings.TrimPrefix(name, prefix)
			name = strings.TrimPrefix(name, "_")
			break
		}
	}
	if name != "" {
		return name
	}
	return "Unknown provider"
}

func parseLLMJSONArrayFromMixedOutput(out []byte) ([]map[string]interface{}, error) {
	var lastErr error
	for start := bytes.IndexByte(out, '['); start >= 0; {
		var llms []map[string]interface{}
		dec := json.NewDecoder(bytes.NewReader(out[start:]))
		if err := dec.Decode(&llms); err == nil {
			return llms, nil
		} else {
			lastErr = err
		}
		next := bytes.IndexByte(out[start+1:], '[')
		if next < 0 {
			break
		}
		start += next + 1
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("no JSON array found")
}

func markChatLLMActive(llms []map[string]interface{}, llmNo int) {
	for _, item := range llms {
		idx, ok := chatLLMIndex(item["index"])
		item["active"] = ok && idx == llmNo
	}
}

func chatLLMIndex(v interface{}) (int, bool) {
	switch x := v.(type) {
	case int:
		return x, true
	case int8:
		return int(x), true
	case int16:
		return int(x), true
	case int32:
		return int(x), true
	case int64:
		return int(x), true
	case uint:
		return int(x), true
	case uint8:
		return int(x), true
	case uint16:
		return int(x), true
	case uint32:
		return int(x), true
	case uint64:
		return int(x), true
	case float32:
		return int(x), true
	case float64:
		return int(x), true
	case json.Number:
		n, err := x.Int64()
		if err != nil {
			return 0, false
		}
		return int(n), true
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(x))
		if err != nil {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}

var startChatWorkerFunc = startChatWorker

func startChatWorker(cfg config.AppConfig, sid string) (*chatWorker, error) {
	root := cfg.GARoot
	py := chatPythonForConfig(cfg)
	script, err := resolveChatWorkerScript()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(py, script)
	cmd.Dir = root
	hideChildWindow(cmd)
	cmd.Env = chatWorkerEnvironment(cfg, root, sid)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	worker := &chatWorker{SID: sid, Cmd: cmd, Stdin: stdin, Stdout: stdout, Stderr: stderr}
	go logChatWorkerStderr(sid, stderr)
	return worker, nil
}

func logChatWorkerStderr(sid string, stderr io.Reader) {
	scanner := bufio.NewScanner(stderr)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			fmt.Fprintf(os.Stderr, "[chat_worker:%s] %s\n", sid, line)
		}
	}
	if err := scanner.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "[chat_worker:%s] stderr read error: %v\n", sid, err)
	}
}

func pythonEnvWithAdminProxy(cfg config.AppConfig, extra ...string) []string {
	proxyKeys := map[string]bool{
		"HTTP_PROXY": true, "HTTPS_PROXY": true, "ALL_PROXY": true, "NO_PROXY": true,
		"http_proxy": true, "https_proxy": true, "all_proxy": true, "no_proxy": true,
	}
	env := []string{}
	for _, kv := range os.Environ() {
		key := kv
		if i := strings.Index(kv, "="); i >= 0 {
			key = kv[:i]
		}
		if proxyKeys[key] && cfg.ProxyMode != "system" {
			continue
		}
		env = append(env, kv)
	}
	if cfg.ProxyMode != "system" {
		env = append(env, "HTTP_PROXY=", "HTTPS_PROXY=", "ALL_PROXY=", "NO_PROXY=", "http_proxy=", "https_proxy=", "all_proxy=", "no_proxy=")
	}
	if cfg.ProxyMode == "custom" {
		if cfg.HTTPProxy != "" {
			env = append(env, "HTTP_PROXY="+cfg.HTTPProxy, "http_proxy="+cfg.HTTPProxy)
		}
		if cfg.HTTPSProxy != "" {
			env = append(env, "HTTPS_PROXY="+cfg.HTTPSProxy, "https_proxy="+cfg.HTTPSProxy)
		}
		if cfg.AllProxy != "" {
			env = append(env, "ALL_PROXY="+cfg.AllProxy, "all_proxy="+cfg.AllProxy)
		}
		if cfg.NoProxy != "" {
			env = append(env, "NO_PROXY="+cfg.NoProxy, "no_proxy="+cfg.NoProxy)
		}
	}
	env = append(env, extra...)
	return env
}

func chatWorkerEnvironment(cfg config.AppConfig, root, sid string) []string {
	env := pythonEnvWithAdminProxy(cfg, "PYTHONUNBUFFERED=1", "PYTHONUTF8=1", "PYTHONIOENCODING=utf-8", "GA_ROOT="+root, "GA_ULTRAPLAN_BROWSER=0")
	filtered := make([]string, 0, len(env)+1)
	for _, kv := range env {
		key, _, _ := strings.Cut(kv, "=")
		if strings.EqualFold(key, "GA_ADMIN_SESSION_ID") {
			continue
		}
		filtered = append(filtered, kv)
	}
	return append(filtered, "GA_ADMIN_SESSION_ID="+safeChatID(sid))
}

func resolveChatWorkerScript() (string, error) {
	candidates := []string{}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(wd, "cmd", "chat_worker.py"))
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "cmd", "chat_worker.py"))
		candidates = append(candidates, filepath.Join(filepath.Dir(filepath.Dir(exe)), "cmd", "chat_worker.py"))
	}
	if _, file, _, ok := runtime.Caller(0); ok {
		// In `go run`, os.Executable() points to a temporary build directory and
		// main changes cwd to that directory. runtime.Caller keeps the source path,
		// so this finds <repo>/cmd/chat_worker.py for development runs.
		candidates = append(candidates, filepath.Join(filepath.Dir(filepath.Dir(filepath.Dir(file))), "cmd", "chat_worker.py"))
	}
	for _, script := range candidates {
		if st, err := os.Stat(script); err == nil && !st.IsDir() {
			return script, nil
		}
	}
	return "", fmt.Errorf("chat_worker.py not found; checked: %s", strings.Join(candidates, "; "))
}

func mustGetwd() string { wd, _ := os.Getwd(); return wd }

func safeChatID(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	for _, c := range v {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return newChatID()
		}
	}
	return v
}

var chatDataMigrationMu sync.Mutex

var chatDataMigrated = map[string]bool{}

func chatDataDir(cfg config.AppConfig) string {
	dir := strings.TrimSpace(cfg.ChatDataDir)
	if dir == "" {
		dir = config.DefaultChatDataDir()
	}
	if abs, err := filepath.Abs(dir); err == nil {
		return abs
	}
	return dir
}

func chatSessionDir(cfg config.AppConfig) string {
	return filepath.Join(chatDataDir(cfg), "chat_sessions")
}

func chatUploadDir(cfg config.AppConfig) string {
	return filepath.Join(chatDataDir(cfg), "chat_uploads")
}

func legacyChatSessionDir(root string) string {
	return filepath.Join(root, "temp", "react_frontend_sessions")
}

func legacyChatUploadDir(root string) string {
	return filepath.Join(root, "temp", "react_frontend_uploads")
}

func chatSessionPath(cfg config.AppConfig, sid string) string {
	return filepath.Join(chatSessionDir(cfg), safeChatID(sid)+".json")
}

func ensureChatDataMigrated(cfg config.AppConfig) error {
	key := cfg.GARoot + "|" + chatDataDir(cfg)
	chatDataMigrationMu.Lock()
	if chatDataMigrated[key] {
		chatDataMigrationMu.Unlock()
		return nil
	}
	chatDataMigrationMu.Unlock()
	if err := copyDirIfTargetEmpty(legacyChatSessionDir(cfg.GARoot), chatSessionDir(cfg)); err != nil {
		return err
	}
	if err := copyDirIfTargetEmpty(legacyChatUploadDir(cfg.GARoot), chatUploadDir(cfg)); err != nil {
		return err
	}
	chatDataMigrationMu.Lock()
	chatDataMigrated[key] = true
	chatDataMigrationMu.Unlock()
	return nil
}

func copyDirIfTargetEmpty(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil || len(entries) == 0 {
		return nil
	}
	if existing, err := os.ReadDir(dst); err == nil && len(existing) > 0 {
		return nil
	}
	if err := os.MkdirAll(dst, 0755); err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		in := filepath.Join(src, e.Name())
		out := filepath.Join(dst, e.Name())
		if _, err := os.Stat(out); err == nil {
			continue
		}
		b, err := os.ReadFile(in)
		if err != nil {
			return err
		}
		if err := writeChatFileAtomic(out, b, 0644); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) mutateChatSession(sid string, token *chatRun, mutate func(*chatSession) error) (chatSession, error) {
	if !s.ownsChatRun(sid, token) {
		return chatSession{}, fmt.Errorf("chat run is no longer owned")
	}
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	if s.chatSessionMutationHook != nil {
		s.chatSessionMutationHook()
	}
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		return chatSession{}, err
	}
	if err = mutate(&cs); err != nil {
		return chatSession{}, err
	}
	err = saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
	return cs, err
}

func loadChatSession(cfg config.AppConfig, sid string) (chatSession, error) {
	if err := ensureChatDataMigrated(cfg); err != nil {
		return chatSession{}, err
	}
	sid = safeChatID(sid)
	cs := chatSession{ID: sid, Title: "新会话", Messages: []chatMessage{}, Settings: defaultChatSettingsFor(cfg)}
	b, err := os.ReadFile(chatSessionPath(cfg, sid))
	if err != nil {
		if os.IsNotExist(err) {
			return cs, nil
		}
		return cs, err
	}
	if err := json.Unmarshal(b, &cs); err != nil {
		return cs, err
	}
	if cs.ID == "" {
		cs.ID = sid
	}
	if cs.Messages == nil {
		cs.Messages = []chatMessage{}
	}
	if cs.RawHistory == nil {
		cs.RawHistory = []map[string]interface{}{}
	}
	cs.Plan = normalizeChatPlan(cs.Plan)
	cs.Settings = normalizeChatSettings(cs.Settings)
	syncConductorChatTitle(&cs)
	return cs, nil
}

func mergeChatMessageLists(first, second []chatMessage) []chatMessage {
	out := append([]chatMessage(nil), first...)
	positions := make(map[string]int, len(out))
	for i, msg := range out {
		if msg.ID != "" {
			positions[msg.ID] = i
		}
	}
	for _, msg := range second {
		if i, ok := positions[msg.ID]; msg.ID != "" && ok {
			out[i] = msg
			continue
		}
		if msg.ID != "" {
			positions[msg.ID] = len(out)
		}
		out = append(out, msg)
	}
	return out
}

func replacePendingChatMessage(messages []chatMessage, pendingID string, final chatMessage) []chatMessage {
	if pendingID == "" {
		if final.ID == "" {
			final.ID = newChatID()
		}
		return append(messages, final)
	}
	final.ID = pendingID
	for i := range messages {
		if messages[i].ID == pendingID {
			messages[i] = final
			return messages
		}
	}
	return append(messages, final)
}

func (s *Server) saveChatSessionMerged(cs chatSession) error {
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	return s.saveChatSessionMergedLocked(cs)
}

func (s *Server) saveChatSessionMergedLocked(cs chatSession) error {
	latest, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID)
	if err != nil {
		return err
	}
	cs.Messages = mergeChatMessageLists(latest.Messages, cs.Messages)
	preserveLatestChatUserMetadata(&cs, latest)
	return saveChatSession(s.CfgStore.Snapshot(), cs)
}

func (s *Server) saveChatSessionExact(cs chatSession) error {
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	return s.saveChatSessionExactLocked(cs)
}

func (s *Server) saveChatSessionExactLocked(cs chatSession) error {
	if s.chatExactSaveHook != nil {
		if err := s.chatExactSaveHook(cs); err != nil {
			return err
		}
	}
	if latest, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID); err == nil {
		preserveLatestChatUserMetadata(&cs, latest)
	}
	return saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
}

func preserveLatestChatUserMetadata(candidate *chatSession, latest chatSession) {
	candidate.Pinned = latest.Pinned
	candidate.Loop = latest.Loop
	candidate.Autorun = latest.Autorun
	candidate.QueuedMessages = latest.QueuedMessages
	candidate.Conductor = latest.Conductor
	candidate.ConductorChildren = latest.ConductorChildren
	if latest.TitleSource == chatTitleSourceManual ||
		(latest.TitleSource == chatTitleSourceGenerated && candidate.TitleSource != chatTitleSourceManual) {
		candidate.Title = latest.Title
		candidate.TitleSource = latest.TitleSource
	}
}

func (s *Server) persistChatSessionIfMissing(cs chatSession) error {
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	_, err := os.Stat(chatSessionPath(s.CfgStore.Snapshot(), cs.ID))
	if err == nil {
		return nil
	}
	if !os.IsNotExist(err) {
		return err
	}
	return saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
}

func saveChatSession(cfg config.AppConfig, cs chatSession) error {
	return saveChatSessionLocked(cfg, cs)
}

func saveChatSessionLocked(cfg config.AppConfig, cs chatSession) error {
	return saveChatSessionWithUpdatedAtLocked(cfg, cs, true)
}

func saveChatSessionPreserveUpdatedAtLocked(cfg config.AppConfig, cs chatSession) error {
	return saveChatSessionWithUpdatedAtLocked(cfg, cs, false)
}

func saveChatSessionWithUpdatedAtLocked(cfg config.AppConfig, cs chatSession, touchUpdatedAt bool) error {
	syncConductorChatTitle(&cs)
	if err := ensureChatDataMigrated(cfg); err != nil {
		return err
	}
	if err := os.MkdirAll(chatSessionDir(cfg), 0755); err != nil {
		return err
	}
	cs.Settings = normalizeChatSettings(cs.Settings)
	cs.Plan = normalizeChatPlan(cs.Plan)
	if touchUpdatedAt {
		cs.UpdatedAt = time.Now().Unix()
	}
	b, _ := json.MarshalIndent(cs, "", "  ")
	return writeChatFileAtomic(chatSessionPath(cfg, cs.ID), b, 0644)
}

func writeChatFileAtomic(path string, data []byte, perm os.FileMode) (err error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+"-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		if err != nil {
			_ = os.Remove(tmpName)
		}
	}()
	if _, err = tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

func readChatWorkerLine(r *bufio.Reader) ([]byte, error) {
	var line []byte
	for {
		chunk, err := r.ReadSlice('\n')
		line = append(line, chunk...)
		if len(line) > maxChatWorkerLineBytes {
			return line, fmt.Errorf("chat worker line too large: %d > %d bytes", len(line), maxChatWorkerLineBytes)
		}
		if err == bufio.ErrBufferFull {
			continue
		}
		return line, err
	}
}

func truncateChatRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func chatTitleVisibleContent(content string) string {
	content = strings.TrimSpace(content)
	if i := strings.Index(content, "[附件已保存]"); i >= 0 {
		content = content[:i]
	}
	return strings.Join(strings.Fields(content), " ")
}

func chatTitleUserContent(msg chatMessage) string {
	content := chatTitleVisibleContent(msg.Content)
	if content == "" && len(msg.Files) > 0 {
		return "用户上传了附件"
	}
	return content
}

func temporaryChatTitle(messages []chatMessage) string {
	for _, msg := range messages {
		if msg.Role != "user" {
			continue
		}
		title := chatTitleVisibleContent(msg.Content)
		if title == "" && len(msg.Files) > 0 {
			title = "附件会话"
		}
		if title != "" {
			return truncateChatRunes(title, 64)
		}
	}
	return ""
}

func updateChatTitle(cs *chatSession) {
	syncConductorChatTitle(cs)
	if conductorObjectiveChatTitle(*cs) != "" {
		return
	}
	// Never overwrite manually set or AI-generated titles
	if cs.TitleSource == chatTitleSourceManual || cs.TitleSource == chatTitleSourceGenerated {
		return
	}
	if cs.Title != "" && cs.Title != "新会话" {
		return
	}
	if title := temporaryChatTitle(cs.Messages); title != "" {
		cs.Title = title
		cs.TitleSource = chatTitleSourceTemporary
	}
}

func sanitizeGeneratedChatTitle(title string) string {
	title = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(title, "\r", " "), "\n", " "))
	lower := strings.ToLower(title)
	if strings.HasPrefix(lower, "!!!error:") || strings.HasPrefix(lower, "[error:") ||
		strings.HasPrefix(lower, "error:") || strings.HasPrefix(title, "执行失败：") {
		return ""
	}
	title = strings.Trim(title, "`\"'“”‘’ ")
	for _, prefix := range []string{"标题:", "标题：", "Title:", "Title："} {
		if strings.HasPrefix(strings.ToLower(title), strings.ToLower(prefix)) {
			title = strings.TrimSpace(title[len(prefix):])
			break
		}
	}
	title = strings.Join(strings.Fields(title), " ")
	title = strings.TrimFunc(title, func(r rune) bool {
		return unicode.IsPunct(r) && r != '+' && r != '#'
	})
	title = strings.TrimSpace(title)
	if len([]rune(title)) > maxChatTitleRunes {
		return ""
	}
	lower = strings.ToLower(title)
	for _, prefix := range []string{
		"the conversation", "this conversation", "the user", "we were asked", "i was asked",
		"我们被要求", "我被要求", "用户要求", "这个对话", "该对话", "对话内容", "以下对话", "我们根据", "总结为",
	} {
		if strings.HasPrefix(lower, strings.ToLower(prefix)) {
			return ""
		}
	}
	return title
}

func chatTitleExchangeForGeneration(cs chatSession) (chatTitleExchange, bool) {
	if conductorObjectiveChatTitle(cs) != "" {
		return chatTitleExchange{}, false
	}
	messages := make([]chatMessage, 0, 2)
	for _, msg := range cs.Messages {
		if msg.Kind == "btw" || (msg.Role != "user" && msg.Role != "assistant") {
			continue
		}
		if strings.TrimSpace(msg.Content) == "" {
			continue
		}
		messages = append(messages, msg)
	}
	if len(messages) != 2 || messages[0].Role != "user" || messages[1].Role != "assistant" || messages[1].Error {
		return chatTitleExchange{}, false
	}
	temporary := temporaryChatTitle(messages)
	if temporary == "" {
		return chatTitleExchange{}, false
	}
	switch cs.TitleSource {
	case chatTitleSourceGenerated, chatTitleSourceManual:
		return chatTitleExchange{}, false
	}
	title := strings.TrimSpace(cs.Title)
	if title != "" && title != "新会话" && title != temporary {
		return chatTitleExchange{}, false
	}
	return chatTitleExchange{
		User:               truncateChatRunes(chatTitleUserContent(messages[0]), 2000),
		Assistant:          truncateChatRunes(chatTitleVisibleContent(messages[1].Content), 4000),
		UserMessageID:      messages[0].ID,
		AssistantMessageID: messages[1].ID,
	}, true
}

func chatTitleExchangeStillExists(cs chatSession, exchange chatTitleExchange) bool {
	var userFound, assistantFound bool
	for _, msg := range cs.Messages {
		switch msg.ID {
		case exchange.UserMessageID:
			userFound = msg.Role == "user" &&
				truncateChatRunes(chatTitleUserContent(msg), 2000) == exchange.User
		case exchange.AssistantMessageID:
			assistantFound = msg.Role == "assistant" && !msg.Error &&
				truncateChatRunes(chatTitleVisibleContent(msg.Content), 4000) == exchange.Assistant
		}
	}
	return userFound && assistantFound
}

func chatTitleContextForSession(cs chatSession) (chatTitleContext, bool) {
	messages := make([]chatTitleContextMessage, 0, 6)
	hasUser := false
	for index, msg := range cs.Messages {
		if msg.Kind == "btw" || msg.Error || (msg.Role != "user" && msg.Role != "assistant") {
			continue
		}
		content := chatTitleVisibleContent(msg.Content)
		if msg.Role == "user" {
			content = chatTitleUserContent(msg)
			hasUser = hasUser || content != ""
		}
		if content == "" {
			continue
		}
		limit := 4000
		if msg.Role == "user" {
			limit = 2000
		}
		messages = append(messages, chatTitleContextMessage{
			Role:        msg.Role,
			Content:     truncateChatRunes(content, limit),
			SourceIndex: index,
		})
	}
	if !hasUser || len(messages) == 0 {
		return chatTitleContext{}, false
	}
	if len(messages) > 6 {
		messages = append([]chatTitleContextMessage{messages[0]}, messages[len(messages)-5:]...)
	}
	return chatTitleContext{Messages: messages}, true
}

func chatTitleContextStillExists(cs chatSession, context chatTitleContext) bool {
	for _, expected := range context.Messages {
		if expected.SourceIndex < 0 || expected.SourceIndex >= len(cs.Messages) {
			return false
		}
		msg := cs.Messages[expected.SourceIndex]
		content := chatTitleVisibleContent(msg.Content)
		if expected.Role == "user" {
			content = chatTitleUserContent(msg)
		}
		limit := 4000
		if expected.Role == "user" {
			limit = 2000
		}
		if msg.Role != expected.Role || msg.Error || truncateChatRunes(content, limit) != expected.Content {
			return false
		}
	}
	return true
}

func chatTitleNeedsAutomaticBackfill(cs chatSession) bool {
	if conductorObjectiveChatTitle(cs) != "" {
		return false
	}
	if cs.TitleSource == chatTitleSourceGenerated || cs.TitleSource == chatTitleSourceManual {
		return false
	}
	if _, ok := chatTitleContextForSession(cs); !ok {
		return false
	}
	current := strings.TrimSpace(cs.Title)
	temporary := temporaryChatTitle(cs.Messages)
	return current == "" || current == "新会话" ||
		(temporary != "" && (current == temporary ||
			(cs.TitleSource == "" && strings.HasPrefix(temporary, current))))
}

func (s *Server) chatTitleLLMNo(fallback int) int {
	selected := s.CfgStore.Snapshot().ChatTitleModel
	if selected == nil || !selected.Enable {
		return -1 // Disabled by default or explicitly
	}
	// Enable=true: empty provider/model = follow conversation model
	if strings.TrimSpace(selected.ProviderVarName) == "" && strings.TrimSpace(selected.Model) == "" {
		if fallback < 0 {
			return -1
		}
		return fallback
	}
	// Enable=true with specific provider/model = use configured LLMNo
	if selected.LLMNo >= 0 {
		return selected.LLMNo
	}
	return -1
}

func (s *Server) beginChatTitleJob(sid string) bool {
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	if s.ChatTitleJobs == nil {
		s.ChatTitleJobs = map[string]bool{}
	}
	if s.ChatTitleJobs[sid] {
		return false
	}
	s.ChatTitleJobs[sid] = true
	return true
}

func (s *Server) finishChatTitleJob(sid string) {
	s.ChatMu.Lock()
	delete(s.ChatTitleJobs, sid)
	s.ChatMu.Unlock()
}

func (s *Server) scheduleChatTitleGeneration(sid string, cs chatSession) {
	exchange, ok := chatTitleExchangeForGeneration(cs)
	if !ok {
		return
	}
	llmNo := s.chatTitleLLMNo(cs.Settings.LLMNo)
	if llmNo == -1 {
		return // Title generation explicitly disabled
	}
	sid = safeChatID(sid)
	if !s.beginChatTitleJob(sid) {
		return
	}

	go func() {
		defer s.finishChatTitleJob(sid)
		title, err := runOneShotChatTitleWorkerFunc(s.CfgStore.Snapshot(), sid, map[string]interface{}{
			"op":           "title",
			"conversation": exchange,
			"llm_no":       llmNo,
			"ga_root":      s.CfgStore.Snapshot().GARoot,
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "chat title generation failed for %s: %v\n", sid, err)
			return
		}
		title = sanitizeGeneratedChatTitle(title)
		if title == "" {
			return
		}
		s.SessionMu.Lock()
		defer s.SessionMu.Unlock()
		latest, err := loadChatSession(s.CfgStore.Snapshot(), sid)
		if err != nil || conductorObjectiveChatTitle(latest) != "" || latest.TitleSource == chatTitleSourceManual || latest.TitleSource == chatTitleSourceGenerated {
			return
		}
		if !chatTitleExchangeStillExists(latest, exchange) {
			return
		}
		temporary := temporaryChatTitle(latest.Messages)
		current := strings.TrimSpace(latest.Title)
		if current != "" && current != "新会话" && current != temporary {
			return
		}
		latest.Title = title
		latest.TitleSource = chatTitleSourceGenerated
		if err := saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), latest); err != nil {
			fmt.Fprintf(os.Stderr, "chat title persistence failed for %s: %v\n", sid, err)
		}
	}()
}

func (s *Server) generateLegacyChatTitle(sid string) (chatSession, error) {
	sid = safeChatID(sid)
	if s.chatRunActive(sid) {
		return chatSession{}, errChatTitleRunActive
	}
	if !s.beginChatTitleJob(sid) {
		return chatSession{}, errChatTitleBusy
	}
	defer s.finishChatTitleJob(sid)

	s.SessionMu.Lock()
	start, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		s.SessionMu.Unlock()
		return chatSession{}, err
	}
	if !chatTitleNeedsAutomaticBackfill(start) {
		s.SessionMu.Unlock()
		return chatSession{}, errChatTitleNotLegacy
	}
	llmNo := s.chatTitleLLMNo(start.Settings.LLMNo)
	if llmNo == -1 {
		s.SessionMu.Unlock()
		return chatSession{}, fmt.Errorf("title generation is disabled")
	}
	context, ok := chatTitleContextForSession(start)
	startTitle, startTitleSource := start.Title, start.TitleSource
	s.SessionMu.Unlock()
	if !ok {
		return chatSession{}, errChatTitleNoContext
	}

	title, err := runOneShotChatTitleWorkerFunc(s.CfgStore.Snapshot(), sid, map[string]interface{}{
		"op":           "title",
		"conversation": context,
		"llm_no":       llmNo,
		"ga_root":      s.CfgStore.Snapshot().GARoot,
	})
	if err != nil {
		return chatSession{}, err
	}
	title = sanitizeGeneratedChatTitle(title)
	if title == "" {
		return chatSession{}, errChatTitleEmpty
	}

	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	latest, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		return chatSession{}, err
	}
	if latest.Title != startTitle || latest.TitleSource != startTitleSource || !chatTitleContextStillExists(latest, context) {
		return chatSession{}, errChatTitleChanged
	}
	latest.Title = title
	latest.TitleSource = chatTitleSourceGenerated
	if err := saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), latest); err != nil {
		return chatSession{}, err
	}
	return latest, nil
}

func (s *Server) automaticChatTitleBackfillCandidates() ([]string, error) {
	s.SessionMu.Lock()
	summaries, err := s.loadChatSessionSummaries(s.CfgStore.Snapshot())
	s.SessionMu.Unlock()
	if err != nil {
		return nil, err
	}
	type candidate struct {
		id        string
		updatedAt int64
	}
	candidates := make([]candidate, 0, len(summaries))
	for _, summary := range summaries {
		if summary.titleNeedsBackfill {
			candidates = append(candidates, candidate{id: summary.ID, updatedAt: summary.UpdatedAt})
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].updatedAt > candidates[j].updatedAt })
	if len(candidates) > 80 {
		candidates = candidates[:80]
	}
	ids := make([]string, len(candidates))
	for index, item := range candidates {
		ids[index] = item.id
	}
	return ids, nil
}

func (s *Server) StartAutomaticChatTitleBackfill() bool {
	s.ChatMu.Lock()
	if s.titleBackfillStarted {
		s.ChatMu.Unlock()
		return false
	}
	s.titleBackfillStarted = true
	s.ChatMu.Unlock()

	go func() {
		ids, err := s.automaticChatTitleBackfillCandidates()
		if err != nil {
			fmt.Fprintf(os.Stderr, "chat title backfill scan failed: %v\n", err)
			return
		}
		jobs := make(chan string)
		var workers sync.WaitGroup
		for range 2 {
			workers.Add(1)
			go func() {
				defer workers.Done()
				for sid := range jobs {
					if _, err := s.generateLegacyChatTitle(sid); err != nil &&
						!errors.Is(err, errChatTitleBusy) &&
						!errors.Is(err, errChatTitleRunActive) &&
						!errors.Is(err, errChatTitleNotLegacy) &&
						!errors.Is(err, errChatTitleChanged) {
						fmt.Fprintf(os.Stderr, "chat title backfill failed for %s: %v\n", sid, err)
					}
				}
			}()
		}
		for _, sid := range ids {
			jobs <- sid
		}
		close(jobs)
		workers.Wait()
	}()
	return true
}

func saveChatUploads(cfg config.AppConfig, files []chatUpload) (saved []map[string]interface{}, refs []string, err error) {
	if len(files) == 0 {
		return nil, nil, nil
	}
	if len(files) > maxChatUploadFiles {
		return nil, nil, fmt.Errorf("too many upload files: %d > %d", len(files), maxChatUploadFiles)
	}
	if err := ensureChatDataMigrated(cfg); err != nil {
		return nil, nil, err
	}
	if err := os.MkdirAll(chatUploadDir(cfg), 0755); err != nil {
		return nil, nil, err
	}
	created := []string{}
	defer func() {
		if err == nil {
			return
		}
		for _, path := range created {
			_ = os.Remove(path)
		}
	}()
	totalBytes := 0
	for _, f := range files {
		name := sanitizeChatUploadName(f.Name)
		data := f.DataURL
		if i := strings.Index(data, ","); i >= 0 {
			data = data[i+1:]
		}
		raw, decodeErr := base64.StdEncoding.DecodeString(data)
		if decodeErr != nil {
			return nil, nil, fmt.Errorf("decode %s: %w", name, decodeErr)
		}
		if len(raw) > maxChatUploadBytesPerFile {
			return nil, nil, fmt.Errorf("upload %s too large: %d > %d bytes", name, len(raw), maxChatUploadBytesPerFile)
		}
		totalBytes += len(raw)
		if totalBytes > maxChatUploadBytesTotal {
			return nil, nil, fmt.Errorf("chat uploads too large: %d > %d bytes", totalBytes, maxChatUploadBytesTotal)
		}
		name = fmt.Sprintf("%d_%s", time.Now().UnixNano(), name)
		target := filepath.Join(chatUploadDir(cfg), name)
		if writeErr := writeChatFileAtomic(target, raw, 0644); writeErr != nil {
			return nil, nil, writeErr
		}
		created = append(created, target)
		mime := strings.TrimSpace(f.Type)
		meta := map[string]interface{}{"path": target, "name": name, "mime": mime, "url": "/api/chat/file/" + name}
		saved = append(saved, meta)
		refs = append(refs, chatUploadPromptRef(target, name, mime))
	}
	return saved, refs, nil
}

func chatUploadPromptRef(path, name, mime string) string {
	lowerMime := strings.ToLower(strings.TrimSpace(mime))
	lowerName := strings.ToLower(strings.TrimSpace(name))
	if strings.HasPrefix(lowerMime, "image/") || strings.HasSuffix(lowerName, ".png") || strings.HasSuffix(lowerName, ".jpg") || strings.HasSuffix(lowerName, ".jpeg") || strings.HasSuffix(lowerName, ".gif") || strings.HasSuffix(lowerName, ".webp") || strings.HasSuffix(lowerName, ".bmp") {
		return "[image:" + path + "]"
	}
	return "[FILE:" + path + "]"
}

func chatVisionImagePaths(files []map[string]interface{}) []string {
	paths := make([]string, 0, len(files))
	for _, file := range files {
		path, _ := file["path"].(string)
		path = strings.TrimSpace(path)
		switch strings.ToLower(filepath.Ext(path)) {
		case ".png", ".jpg", ".jpeg", ".gif", ".webp":
			paths = append(paths, path)
		}
	}
	return paths
}

func cloneChatFileMetadata(files []map[string]interface{}) []map[string]interface{} {
	if len(files) == 0 {
		return nil
	}
	cloned := make([]map[string]interface{}, 0, len(files))
	for _, file := range files {
		if file == nil {
			cloned = append(cloned, nil)
			continue
		}
		copyFile := make(map[string]interface{}, len(file))
		for key, value := range file {
			copyFile[key] = value
		}
		cloned = append(cloned, copyFile)
	}
	return cloned
}

func chatMessageAttachmentRefs(msg chatMessage) []string {
	refs := make([]string, 0, len(msg.Files))
	for _, file := range msg.Files {
		path, _ := file["path"].(string)
		path = strings.TrimSpace(path)
		if path == "" {
			continue
		}
		name, _ := file["name"].(string)
		mime, _ := file["mime"].(string)
		refs = append(refs, chatUploadPromptRef(path, name, mime))
	}
	if len(refs) > 0 {
		return refs
	}
	// Older sessions may have the saved path only in the prompt text.
	// Preserve those references when Files metadata was not persisted.
	for _, line := range strings.Split(msg.Content, "\n") {
		line = strings.TrimSpace(line)
		if (strings.HasPrefix(line, "[FILE:") || strings.HasPrefix(line, "[image:")) && strings.HasSuffix(line, "]") {
			refs = append(refs, line)
		}
	}
	return refs
}

func sanitizeChatUploadName(name string) string {
	name = strings.TrimSpace(filepath.Base(strings.ReplaceAll(name, "\\", "/")))
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "upload.bin"
	}
	name = strings.Map(func(r rune) rune {
		switch {
		case r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|' || r == ']':
			return '_'
		case r < 32:
			return '_'
		default:
			return r
		}
	}, name)
	name = strings.Trim(name, " .")
	if name == "" {
		return "upload.bin"
	}
	return name
}

func newChatID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:4]) + "-" + hex.EncodeToString(b[4:6]) + "-" + hex.EncodeToString(b[6:8]) + "-" + hex.EncodeToString(b[8:10]) + "-" + hex.EncodeToString(b[10:])
}

func chatMessageLabel(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "assistant":
		return "ASSISTANT"
	case "system":
		return "SYSTEM"
	default:
		return "USER"
	}
}

func compactChatText(v string, limit int) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	v = strings.Join(strings.Fields(v), " ")
	r := []rune(v)
	if len(r) > limit {
		return string(r[:limit]) + "..."
	}
	return v
}

func buildPromptWithHistory(prompt string, messages []chatMessage) string {
	prompt = strings.TrimSpace(prompt)
	if len(messages) <= 1 {
		return prompt
	}
	previous := []string{}
	// chatPost appends the current user message before building the worker prompt.
	for _, msg := range messages[:len(messages)-1] {
		if msg.Error {
			continue
		}
		label := chatMessageLabel(msg.Role)
		limit := 3000
		if label == "ASSISTANT" {
			limit = 5000
		}
		content := compactChatText(msg.Content, limit)
		if content != "" {
			previous = append(previous, fmt.Sprintf("[%s]: %s", label, content))
		}
	}
	if len(previous) == 0 {
		return prompt
	}
	if len(previous) > 24 {
		previous = previous[len(previous)-24:]
	}
	text := strings.Join(previous, "\n\n")
	textRunes := []rune(text)
	if len(textRunes) > 28000 {
		text = "...[older history omitted]\n" + string(textRunes[len(textRunes)-28000:])
	}
	return "以下是当前会话的历史上下文，请在回答时延续这些上下文，不要把它当作用户的新问题。\n" +
		"<history>\n" + text + "\n</history>\n\n" +
		"### 用户当前消息\n" + prompt
}
