package api

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"genericagent-admin-go/internal/config"
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
