package api

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
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
	Guides                 []chatGuide              `json:"guides,omitempty"`
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
	GuideClosed        bool // guarded by ChatMu; terminal safe point closes guide admission
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
