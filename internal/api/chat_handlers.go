package api

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func (s *Server) chatSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, 405, "method not allowed")
		return
	}
	cfg := s.CfgStore.Snapshot()
	summaries, err := s.loadChatSessionSummaries(cfg)
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	sort.Slice(summaries, func(i, j int) bool { return summaries[i].UpdatedAt > summaries[j].UpdatedAt })
	items := make([]map[string]interface{}, 0, len(summaries))
	for _, summary := range summaries {
		running, taskbarState := s.chatSessionTaskbarSnapshot(summary)
		items = append(items, map[string]interface{}{
			"id": summary.ID, "title": summary.Title, "title_source": summary.TitleSource,
			"updated_at": summary.UpdatedAt, "count": summary.Count, "running": running, "taskbar_state": taskbarState,
			"workspace": summary.Workspace, "project_mode": summary.ProjectMode,
			"hub_enabled": summary.HubEnabled, "pinned": summary.Pinned, "loop": summary.Loop,
			"result": summary.Result,
		})
	}
	projects, pinnedProjects := chatProjectNamesFor(cfg)
	writeJSON(w, map[string]interface{}{"sessions": items, "projects": projects, "pinned_projects": pinnedProjects})
}

func (s *Server) chatHandler(w http.ResponseWriter, r *http.Request) {
	p := strings.TrimPrefix(r.URL.Path, "/api/chat/")
	parts := strings.Split(strings.Trim(p, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		bad(w, 404, "not found")
		return
	}
	switch parts[0] {
	case "session":
		if len(parts) == 2 && parts[1] == "new" && r.Method == http.MethodPost {
			s.chatNewSession(w, r)
			return
		}
		if len(parts) == 2 && r.Method == http.MethodGet {
			s.chatGetSession(w, r, parts[1])
			return
		}
		if len(parts) == 2 && r.Method == http.MethodPatch {
			s.chatRenameSession(w, r, parts[1])
			return
		}
		if len(parts) == 2 && r.Method == http.MethodDelete {
			s.chatDeleteSession(w, r, parts[1])
			return
		}
	case "settings":
		if len(parts) == 2 && r.Method == http.MethodPost {
			s.chatSaveSettings(w, r, parts[1])
			return
		}
	case "hub":
		if len(parts) == 2 && r.Method == http.MethodPatch {
			s.chatSetHubEnabled(w, r, parts[1])
			return
		}
	case "pin":
		if len(parts) == 2 && r.Method == http.MethodPatch {
			s.chatSetPinned(w, r, parts[1])
			return
		}
	case "queue":
		if len(parts) == 3 && parts[2] == "events" && r.Method == http.MethodGet {
			s.chatQueueEvents(w, r, parts[1])
			return
		}
		if len(parts) == 2 && r.Method == http.MethodGet {
			s.chatGetQueue(w, r, parts[1])
			return
		}
		if len(parts) == 2 && r.Method == http.MethodPatch {
			s.chatPatchQueue(w, r, parts[1])
			return
		}
		if len(parts) == 2 && r.Method == http.MethodPut {
			s.chatReplaceQueue(w, r, parts[1])
			return
		}
	case "guide":
		if len(parts) == 3 && r.Method == http.MethodPost {
			s.chatGuidePost(w, r, parts[1], parts[2])
			return
		}
	case "fork":
		if len(parts) == 2 && r.Method == http.MethodPost {
			s.chatForkSession(w, r, parts[1])
			return
		}
	case "state":
		if len(parts) == 1 && r.Method == http.MethodGet {
			s.chatState(w, r, "")
			return
		}
		if len(parts) == 2 && r.Method == http.MethodGet {
			s.chatState(w, r, parts[1])
			return
		}
	case "projects":
		if len(parts) == 1 && r.Method == http.MethodPost {
			s.chatCreateProject(w, r)
			return
		}
		if len(parts) == 2 && parts[1] == "pin" && r.Method == http.MethodPatch {
			s.chatSetProjectPinned(w, r)
			return
		}
	case "btw":
		if len(parts) == 2 && r.Method == http.MethodPost {
			s.chatBTW(w, r, parts[1])
			return
		}
	case "worldline":
		if len(parts) == 2 && r.Method == http.MethodGet {
			s.chatWorldlineState(w, r, parts[1])
			return
		}
		if len(parts) == 3 && parts[2] == "switch" && r.Method == http.MethodPost {
			s.chatWorldlineSwitch(w, r, parts[1])
			return
		}
	case "loop":
		if len(parts) == 3 && parts[2] == "start" && r.Method == http.MethodPost {
			s.chatLoopStart(w, r, parts[1])
			return
		}
		if len(parts) == 3 && parts[2] == "stop" && r.Method == http.MethodPost {
			s.chatLoopStop(w, r, parts[1])
			return
		}
	case "stream":
		if len(parts) == 2 && r.Method == http.MethodGet {
			s.chatStream(w, r, parts[1])
			return
		}
	case "cancel":
		if len(parts) == 2 && r.Method == http.MethodPost {
			s.chatCancel(w, r, parts[1])
			return
		}
	case "file":
		if len(parts) >= 2 && r.Method == http.MethodGet {
			s.chatFile(w, r, strings.Join(parts[1:], "/"))
			return
		}
	default:
		if len(parts) == 1 && r.Method == http.MethodPost {
			s.chatPost(w, r, parts[0])
			return
		}
	}
	bad(w, 404, "not found")
}

func (s *Server) chatNewSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProjectMode string `json:"project_mode"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		if err := decode(r, &req); err != nil {
			bad(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	projectMode := strings.TrimSpace(req.ProjectMode)
	if projectMode != "" {
		found := false
		for _, name := range discoverProjectNames(s.CfgStore.Snapshot().GARoot) {
			if name == projectMode {
				found = true
				break
			}
		}
		if !found {
			bad(w, http.StatusBadRequest, "project does not exist")
			return
		}
	}
	cs := chatSession{ID: newChatID(), Title: "新会话", UpdatedAt: time.Now().Unix(), Messages: []chatMessage{}, Settings: s.defaultChatSettings(), RawHistory: []map[string]interface{}{}, ProjectMode: projectMode}
	if projectMode != "" {
		if err := saveChatSession(s.CfgStore.Snapshot(), cs); err != nil {
			bad(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	writeJSON(w, chatSessionForClient(cs))
}

func visibleRawUserText(item map[string]interface{}) (string, bool) {
	content, ok := item["content"]
	if !ok {
		return "", false
	}
	text := rawChatText(content)
	return text, text != ""
}

// normalizeChatMatchText makes session message content comparable with the text
// recovered from raw history items. The two are never byte-identical in several
// normal cases: the session copy carries the "[附件已保存]" suffix appended when
// the turn had uploads, raw history drops non-text parts, and whitespace/CRLF
// differs between transports.
func normalizeChatMatchText(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	if idx := strings.Index(s, "\n\n[附件已保存]\n"); idx >= 0 {
		s = s[:idx]
	}
	return strings.Join(strings.Fields(s), " ")
}

type rawUserTurn struct {
	index int
	text  string
}

func rawHistoryUserTurns(raw []map[string]interface{}) []rawUserTurn {
	turns := make([]rawUserTurn, 0, len(raw))
	for i, item := range raw {
		if role, _ := item["role"].(string); role != "user" {
			continue
		}
		text, ok := visibleRawUserText(item)
		if !ok {
			continue
		}
		turns = append(turns, rawUserTurn{index: i, text: text})
	}
	return turns
}

// rawHistoryBeforeMessage finds the raw-history cut point that precedes the
// selected user message. Matching degrades through four tiers so that an
// edit/resend never hard-fails on cosmetic content drift; the positional tier
// also covers compacted raw history, where earlier user turns are gone.
func rawHistoryBeforeMessage(cs chatSession, messageIndex int) ([]map[string]interface{}, error) {
	if len(cs.RawHistory) == 0 {
		return []map[string]interface{}{}, nil
	}
	rawUsers := rawHistoryUserTurns(cs.RawHistory)
	if len(rawUsers) == 0 {
		return []map[string]interface{}{}, nil
	}
	cut := func(i int) []map[string]interface{} {
		return append([]map[string]interface{}(nil), cs.RawHistory[:i]...)
	}

	targetNorm := normalizeChatMatchText(cs.Messages[messageIndex].Content)
	occurrence := 0
	userOrdinal := 0
	totalUsers := 0
	for i := range cs.Messages {
		if cs.Messages[i].Role != "user" {
			continue
		}
		totalUsers++
		if i > messageIndex {
			continue
		}
		userOrdinal++
		if normalizeChatMatchText(cs.Messages[i].Content) == targetNorm {
			occurrence++
		}
	}

	// Tier 1+2: exact match on normalized text, honouring duplicate-content order.
	if targetNorm != "" {
		seen := 0
		for _, ru := range rawUsers {
			if normalizeChatMatchText(ru.text) != targetNorm {
				continue
			}
			seen++
			if seen == occurrence {
				return cut(ru.index), nil
			}
		}
		// Tier 3: containment, for injected prefixes or dropped attachment parts.
		seen = 0
		for _, ru := range rawUsers {
			rn := normalizeChatMatchText(ru.text)
			if rn == "" || (!strings.Contains(rn, targetNorm) && !strings.Contains(targetNorm, rn)) {
				continue
			}
			seen++
			if seen == occurrence {
				return cut(ru.index), nil
			}
		}
	}

	return nil, fmt.Errorf("raw history does not contain the selected user message")
}

// rawHistoryBeforeMessageForResend is the resend-path variant. The caller has
// already located the turn by message ID inside this very session, so raw
// history is only needed to pick a context boundary. When content matching
// fails (compacted raw history, non-text parts, injected prefixes) it aligns by
// user-turn position instead of aborting the resend.
func rawHistoryBeforeMessageForResend(cs chatSession, messageIndex int) []map[string]interface{} {
	if raw, err := rawHistoryBeforeMessage(cs, messageIndex); err == nil {
		if raw == nil {
			// A boundary of zero yields a nil slice, which would marshal as
			// JSON null instead of an empty array.
			return []map[string]interface{}{}
		}
		return raw
	}
	rawUsers := rawHistoryUserTurns(cs.RawHistory)
	if len(rawUsers) == 0 {
		return []map[string]interface{}{}
	}
	userOrdinal := 0
	totalUsers := 0
	for i := range cs.Messages {
		if cs.Messages[i].Role != "user" {
			continue
		}
		totalUsers++
		if i <= messageIndex {
			userOrdinal++
		}
	}
	cut := func(i int) []map[string]interface{} {
		out := make([]map[string]interface{}, i)
		copy(out, cs.RawHistory[:i])
		return out
	}
	// Prefer counting from the head. If raw history holds fewer user turns than
	// the session (compaction dropped older ones), align from the tail so the
	// offset relative to the newest turn still lines up.
	if userOrdinal >= 1 && userOrdinal <= len(rawUsers) {
		return cut(rawUsers[userOrdinal-1].index)
	}
	if fromEnd := totalUsers - userOrdinal; fromEnd >= 0 && fromEnd < len(rawUsers) {
		return cut(rawUsers[len(rawUsers)-1-fromEnd].index)
	}
	return cut(rawUsers[len(rawUsers)-1].index)
}

func (s *Server) chatForkSession(w http.ResponseWriter, r *http.Request, sid string) {
	sid = safeChatID(sid)
	if sid == "" {
		bad(w, http.StatusBadRequest, "invalid session id")
		return
	}
	if s.chatRunActive(sid) {
		bad(w, http.StatusConflict, "chat is already running")
		return
	}
	var req struct {
		MessageID string `json:"message_id"`
	}
	if err := decode(r, &req); err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	messageID := safeChatID(req.MessageID)
	if messageID == "" {
		bad(w, http.StatusBadRequest, "message_id is required")
		return
	}

	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		bad(w, http.StatusNotFound, "session not found")
		return
	}
	targetIndex := -1
	for i := range cs.Messages {
		if cs.Messages[i].ID == messageID && cs.Messages[i].Role == "user" {
			targetIndex = i
			break
		}
	}
	if targetIndex < 0 {
		bad(w, http.StatusNotFound, "user message not found")
		return
	}
	raw, err := rawHistoryBeforeMessage(cs, targetIndex)
	if err != nil {
		bad(w, http.StatusConflict, err.Error())
		return
	}
	title := strings.TrimSpace(cs.Title)
	if title == "" || title == "新会话" {
		title = "编辑分支"
	} else {
		title += " · 分支"
	}
	fork := chatSession{
		ID:          newChatID(),
		Title:       title,
		TitleSource: chatTitleSourceManual,
		Messages:    append([]chatMessage(nil), cs.Messages[:targetIndex]...),
		Settings:    cs.Settings,
		RawHistory:  raw,
		HistoryInfo: []interface{}{},
		Working:     nil,
		Workspace:   cs.Workspace,
		ProjectMode: cs.ProjectMode,
	}
	if err := saveChatSessionLocked(s.CfgStore.Snapshot(), fork); err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, chatSessionForClient(fork))
}

func (s *Server) chatGetSession(w http.ResponseWriter, r *http.Request, sid string) {
	cs, err := loadChatSession(s.CfgStore.Snapshot(), safeChatID(sid))
	if err != nil {
		bad(w, 500, err.Error())
		return
	}
	view, status, err := chatSessionView(cs, r)
	if err != nil {
		bad(w, status, err.Error())
		return
	}
	body, err := json.Marshal(view)
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Hash the complete client snapshot: updated_at alone misses same-second edits.
	etag := fmt.Sprintf(`"%x"`, sha256.Sum256(body))
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	for _, candidate := range strings.Split(r.Header.Get("If-None-Match"), ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || strings.TrimPrefix(candidate, "W/") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(body)
}

func (s *Server) chatRenameSession(w http.ResponseWriter, r *http.Request, sid string) {
	var req struct {
		Title string `json:"title"`
	}
	if err := decode(r, &req); err != nil {
		bad(w, 400, err.Error())
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		bad(w, 400, "title required")
		return
	}
	if len([]rune(title)) > 80 {
		title = string([]rune(title)[:80])
	}
	sid = safeChatID(sid)
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		bad(w, 500, err.Error())
		return
	}
	cs.Title = title
	cs.TitleSource = chatTitleSourceManual
	cs.UpdatedAt = time.Now().Unix()
	if err := saveChatSessionLocked(s.CfgStore.Snapshot(), cs); err != nil {
		bad(w, 500, err.Error())
		return
	}
	writeJSON(w, chatSessionForClient(cs))
}

func (s *Server) chatSetHubEnabled(w http.ResponseWriter, r *http.Request, sid string) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := decode(r, &req); err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	if !validChatWorldlineID(sid) {
		bad(w, http.StatusBadRequest, "invalid session id")
		return
	}
	sid = safeChatID(sid)
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	cs.HubEnabled = req.Enabled
	if err := saveChatSessionLocked(s.CfgStore.Snapshot(), cs); err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "hub_enabled": cs.HubEnabled})
}

func (s *Server) chatSetPinned(w http.ResponseWriter, r *http.Request, sid string) {
	var req struct {
		Pinned bool `json:"pinned"`
	}
	if err := decode(r, &req); err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	if !validChatWorldlineID(sid) {
		bad(w, http.StatusBadRequest, "invalid session id")
		return
	}
	sid = safeChatID(sid)
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	cs.Pinned = req.Pinned
	if err := saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), cs); err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "pinned": cs.Pinned})
}

func validateChatQueuedMessage(item *chatQueuedMessage) error {
	item.ID = strings.TrimSpace(item.ID)
	item.Text = strings.TrimSpace(item.Text)
	if item.ID == "" || (item.Text == "" && len(item.Files) == 0) {
		return fmt.Errorf("queued message requires id and content")
	}
	if len(item.Files) > maxChatUploadFiles {
		return fmt.Errorf("too many queued message files")
	}
	return nil
}

func (s *Server) chatQueueEvents(w http.ResponseWriter, r *http.Request, sid string) {
	if !validChatWorldlineID(sid) {
		bad(w, http.StatusBadRequest, "invalid session id")
		return
	}
	if s.ChatRuntime == nil {
		bad(w, http.StatusInternalServerError, "chat runtime unavailable")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		bad(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	sid = safeChatID(sid)
	runtime := s.ChatRuntime
	updates := make(chan uint64, 1)
	runtime.queueEventMu.Lock()
	if runtime.queueEventRev == nil {
		runtime.queueEventRev = make(map[string]uint64)
	}
	if runtime.queueEventSubs == nil {
		runtime.queueEventSubs = make(map[string]map[chan uint64]struct{})
	}
	if runtime.queueEventSubs[sid] == nil {
		runtime.queueEventSubs[sid] = make(map[chan uint64]struct{})
	}
	runtime.queueEventSubs[sid][updates] = struct{}{}
	revision := runtime.queueEventRev[sid]
	runtime.queueEventMu.Unlock()
	defer func() {
		runtime.queueEventMu.Lock()
		delete(runtime.queueEventSubs[sid], updates)
		if len(runtime.queueEventSubs[sid]) == 0 {
			delete(runtime.queueEventSubs, sid)
		}
		runtime.queueEventMu.Unlock()
	}()

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	fmt.Fprintf(w, "event: ready\nid: %d\ndata: {\"revision\":%d}\n\n", revision, revision)
	flusher.Flush()

	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case revision := <-updates:
			fmt.Fprintf(w, "event: queue_changed\nid: %d\ndata: {\"revision\":%d}\n\n", revision, revision)
			flusher.Flush()
		case <-keepalive.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) publishChatQueueChanged(sid string) {
	if s.ChatRuntime == nil {
		return
	}
	sid = safeChatID(sid)
	runtime := s.ChatRuntime
	runtime.queueEventMu.Lock()
	defer runtime.queueEventMu.Unlock()
	if runtime.queueEventRev == nil {
		runtime.queueEventRev = make(map[string]uint64)
	}
	runtime.queueEventRev[sid]++
	revision := runtime.queueEventRev[sid]
	for updates := range runtime.queueEventSubs[sid] {
		select {
		case updates <- revision:
		default:
			select {
			case <-updates:
			default:
			}
			updates <- revision
		}
	}
}

func (s *Server) chatGetQueue(w http.ResponseWriter, _ *http.Request, sid string) {
	if !validChatWorldlineID(sid) {
		bad(w, http.StatusBadRequest, "invalid session id")
		return
	}
	sid = safeChatID(sid)
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"queued_messages": cs.QueuedMessages})
}

func (s *Server) chatPatchQueue(w http.ResponseWriter, r *http.Request, sid string) {
	var req struct {
		Op      string            `json:"op"`
		Message chatQueuedMessage `json:"message"`
		ID      string            `json:"id"`
	}
	if err := decodeLimited(r, &req, maxChatPostBodyBytes); err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	if !validChatWorldlineID(sid) {
		bad(w, http.StatusBadRequest, "invalid session id")
		return
	}
	sid = safeChatID(sid)
	req.Op = strings.TrimSpace(req.Op)
	req.ID = strings.TrimSpace(req.ID)

	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}

	switch req.Op {
	case "enqueue":
		if err := validateChatQueuedMessage(&req.Message); err != nil {
			bad(w, http.StatusBadRequest, err.Error())
			return
		}
		if len(cs.QueuedMessages) >= 100 {
			bad(w, http.StatusBadRequest, "too many queued messages")
			return
		}
		for _, item := range cs.QueuedMessages {
			if item.ID == req.Message.ID {
				bad(w, http.StatusConflict, "queue item already exists")
				return
			}
		}
		cs.QueuedMessages = append(cs.QueuedMessages, req.Message)
	case "update":
		if err := validateChatQueuedMessage(&req.Message); err != nil {
			bad(w, http.StatusBadRequest, err.Error())
			return
		}
		found := false
		for i := range cs.QueuedMessages {
			if cs.QueuedMessages[i].ID == req.Message.ID {
				cs.QueuedMessages[i] = req.Message
				found = true
				break
			}
		}
		if !found {
			bad(w, http.StatusNotFound, "queue item not found")
			return
		}
	case "remove":
		if req.ID == "" {
			bad(w, http.StatusBadRequest, "queue id required")
			return
		}
		found := false
		next := make([]chatQueuedMessage, 0, len(cs.QueuedMessages))
		for _, item := range cs.QueuedMessages {
			if item.ID == req.ID {
				found = true
				continue
			}
			next = append(next, item)
		}
		if !found {
			bad(w, http.StatusNotFound, "queue item not found")
			return
		}
		cs.QueuedMessages = next
	default:
		bad(w, http.StatusBadRequest, "unsupported queue operation")
		return
	}

	if err := saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), cs); err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.publishChatQueueChanged(sid)
	writeJSON(w, map[string]interface{}{"ok": true, "queued_messages": cs.QueuedMessages})
}

func (s *Server) chatReplaceQueue(w http.ResponseWriter, r *http.Request, sid string) {
	var req struct {
		Messages []chatQueuedMessage `json:"messages"`
	}
	if err := decodeLimited(r, &req, maxChatPostBodyBytes); err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	if !validChatWorldlineID(sid) {
		bad(w, http.StatusBadRequest, "invalid session id")
		return
	}
	if len(req.Messages) > 100 {
		bad(w, http.StatusBadRequest, "too many queued messages")
		return
	}
	for i := range req.Messages {
		item := &req.Messages[i]
		item.ID = strings.TrimSpace(item.ID)
		item.Text = strings.TrimSpace(item.Text)
		if item.ID == "" || (item.Text == "" && len(item.Files) == 0) {
			bad(w, http.StatusBadRequest, "queued message requires id and content")
			return
		}
		if len(item.Files) > maxChatUploadFiles {
			bad(w, http.StatusBadRequest, "too many queued message files")
			return
		}
	}
	sid = safeChatID(sid)
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	cs.QueuedMessages = req.Messages
	if err := saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), cs); err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.publishChatQueueChanged(sid)
	writeJSON(w, map[string]interface{}{"ok": true, "queued_messages": cs.QueuedMessages})
}

func (s *Server) chatGuidePost(w http.ResponseWriter, r *http.Request, sid, queueID string) {
	if !validChatWorldlineID(sid) {
		bad(w, http.StatusBadRequest, "invalid session id")
		return
	}
	sid = safeChatID(sid)
	queueID = strings.TrimSpace(queueID)
	if queueID == "" {
		bad(w, http.StatusBadRequest, "queue id required")
		return
	}

	// A guide can race with automatic queue consumption after cancellation. The
	// run token retains the source queue ID, so retries for that exact item are
	// idempotent even when the item has already left the persisted queue.
	s.ChatMu.Lock()
	current := s.ChatRuns[sid]
	matchingRun := current != nil && current.QueueID == queueID
	anotherQueueRunning := current != nil && !current.Done && current.QueueID != "" && current.QueueID != queueID
	matchingDone := matchingRun && current.Done
	s.ChatMu.Unlock()

	if matchingRun {
		status := "already_started"
		if matchingDone {
			status = "already_completed"
		}
		writeJSON(w, map[string]interface{}{"ok": true, "status": status})
		return
	}
	if anotherQueueRunning {
		// If another queued item is active, this one remains queued until it completes.
		writeJSON(w, map[string]interface{}{"ok": true, "status": "queued", "message": "will execute after current run"})
		return
	}

	// Verify the queue item exists
	s.SessionMu.Lock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		s.SessionMu.Unlock()
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}

	found := false
	for _, item := range cs.QueuedMessages {
		if item.ID == queueID {
			found = true
			break
		}
	}
	s.SessionMu.Unlock()

	if !found {
		bad(w, http.StatusNotFound, "queue item not found")
		return
	}

	if _, err := s.cancelChatRun(sid); err != nil {
		bad(w, http.StatusInternalServerError, fmt.Sprintf("chat canceled but failed to persist partial output: %v", err))
		return
	}
	if !s.processQueuedMessage(sid, queueID) {
		bad(w, http.StatusConflict, "queued message could not be started")
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "status": "started"})
}

func (s *Server) chatDeleteSession(w http.ResponseWriter, r *http.Request, sid string) {
	if !validChatWorldlineID(sid) {
		bad(w, http.StatusBadRequest, "invalid session id")
		return
	}
	if s.chatRunActive(sid) {
		bad(w, http.StatusConflict, "chat is already running")
		return
	}
	s.ChatMu.Lock()
	worker := s.ChatWorkers[sid]
	s.ChatMu.Unlock()
	if worker != nil {
		s.dropChatWorker(sid, worker)
	}
	_ = os.Remove(chatSessionPath(s.CfgStore.Snapshot(), sid))
	sidecar := filepath.Join(s.CfgStore.Snapshot().GARoot, "temp", "rewind_data", "ga-admin", "admin_sidecars", sid+".json")
	_ = os.Remove(sidecar)
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) chatSaveSettings(w http.ResponseWriter, r *http.Request, sid string) {
	var patch chatSettingsPatch
	if err := decode(r, &patch); err != nil {
		bad(w, 400, err.Error())
		return
	}
	cs, err := loadChatSession(s.CfgStore.Snapshot(), safeChatID(sid))
	if err != nil {
		bad(w, 500, err.Error())
		return
	}
	cs.Settings = normalizeChatSettings(chatSettings{
		LLMNo:           patch.LLMNo,
		ReasoningEffort: patch.ReasoningEffort,
	})
	if patch.ExtraSysPrompts != nil {
		// Legacy clients send prompt text directly. Treat that as an explicit
		// unbind even if they also happen to include a stale preset ID.
		cs.ExtraSysPrompts = normalizeChatExtraSysPrompts(*patch.ExtraSysPrompts)
		cs.ExtraSysPromptPresetID = ""
	} else if patch.ExtraSysPromptPresetID != nil {
		presetID := strings.TrimSpace(*patch.ExtraSysPromptPresetID)
		if presetID == "" {
			cs.ExtraSysPromptPresetID = ""
			cs.ExtraSysPrompts = nil
		} else {
			preset, ok := findExtraSystemPromptPreset(s.CfgStore.Snapshot().ExtraSystemPromptPresets, presetID)
			if !ok {
				bad(w, http.StatusBadRequest, "extra system prompt preset not found")
				return
			}
			cs.ExtraSysPromptPresetID = preset.ID
			cs.ExtraSysPrompts = []string{preset.Content}
		}
	}
	if err := saveChatSession(s.CfgStore.Snapshot(), cs); err != nil {
		bad(w, 500, err.Error())
		return
	}
	// Remember the picked model so the next new session starts on it.
	s.rememberDefaultChatLLMNo(cs.Settings.LLMNo)
	writeJSON(w, map[string]interface{}{
		"ok":                         true,
		"settings":                   cs.Settings,
		"extra_sys_prompts":          cs.ExtraSysPrompts,
		"extra_sys_prompt_preset_id": cs.ExtraSysPromptPresetID,
	})
}

func (s *Server) chatState(w http.ResponseWriter, r *http.Request, sid string) {
	cs, err := loadChatSession(s.CfgStore.Snapshot(), safeChatID(sid))
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	cs.Settings = normalizeChatSettings(cs.Settings)
	cfg := s.CfgStore.Snapshot()
	llms, err := s.listGARuntimeLLMs(cfg)
	markChatLLMActive(llms, cs.Settings.LLMNo)
	backend := map[string]interface{}{"class": "GenericAgent worker", "source": "agentmain.GenericAgent.list_llms"}
	if err != nil {
		backend["warning"] = err.Error()
	}
	// An empty list is the single most confusing first-run state, so say why it
	// is empty instead of leaving the picker to render a bare "no models found".
	if payload := chatDiagnosisPayload(diagnoseChatLLMList(cfg, len(llms), err)); payload != nil {
		backend["diagnosis"] = payload
	}
	running, pendingAssistantID, runStartedAtMS := s.chatRunState(sid)
	writeJSON(w, map[string]interface{}{"settings": cs.Settings, "extra_sys_prompts": cs.ExtraSysPrompts, "extra_sys_prompt_preset_id": cs.ExtraSysPromptPresetID, "llm_no": cs.Settings.LLMNo, "llms": llms, "backend": backend, "running": running, "pending_assistant_id": pendingAssistantID, "run_started_at_ms": runStartedAtMS, "workspace": cs.Workspace, "project_mode": cs.ProjectMode, "loop": cs.Loop})
}

func (s *Server) maybeHandleWorkspaceCommand(w http.ResponseWriter, r *http.Request, sid string, cs *chatSession, prompt string) bool {
	cmd := strings.TrimSpace(prompt)
	if cmd != "/workspace" && !strings.HasPrefix(cmd, "/workspace ") && !strings.HasPrefix(cmd, "/workspace\t") {
		return false
	}
	reply := ""
	arg := strings.TrimSpace(strings.TrimPrefix(cmd, "/workspace"))
	switch {
	case arg == "":
		if strings.TrimSpace(cs.Workspace) == "" {
			reply = "Workspace 模式未启用。用法：`/workspace <绝对路径>`，关闭：`/workspace off`。"
		} else {
			reply = fmt.Sprintf("当前 workspace：`%s`\n\n关闭：`/workspace off`。", cs.Workspace)
		}
	case strings.EqualFold(arg, "off") || strings.EqualFold(arg, "disable") || strings.EqualFold(arg, "none"):
		cs.Workspace = ""
		reply = "已关闭当前会话的 workspace 模式。"
	default:
		abs, err := filepath.Abs(arg)
		if err != nil {
			reply = fmt.Sprintf("设置 workspace 失败：%v", err)
			break
		}
		st, err := os.Stat(abs)
		if err != nil {
			reply = fmt.Sprintf("设置 workspace 失败：目录不存在或不可访问：`%s`", abs)
			break
		}
		if !st.IsDir() {
			reply = fmt.Sprintf("设置 workspace 失败：不是目录：`%s`", abs)
			break
		}
		cs.Workspace = abs
		reply = fmt.Sprintf("已启用当前会话 workspace：`%s`\n\n之后本会话任务会优先在该目录执行。", abs)
	}
	msg := chatMessage{ID: newChatID(), Role: "assistant", Content: reply, CreatedAt: time.Now().Unix()}
	cs.Messages = append(cs.Messages, msg)
	cs.UpdatedAt = time.Now().Unix()
	if err := saveChatSession(s.CfgStore.Snapshot(), *cs); err != nil {
		s.endChatRun(sid)
		bad(w, http.StatusInternalServerError, err.Error())
		return true
	}
	s.publishChatRun(sid, map[string]interface{}{"type": "message", "message": msg, "workspace": cs.Workspace})
	s.endChatRun(sid)
	s.streamChatRun(w, r, sid, 0)
	return true
}

func validProjectModeName(raw string) (string, bool) {
	name := strings.TrimSpace(raw)
	if name == "" || name == "." || name == ".." || len([]byte(name)) > 128 || filepath.IsAbs(name) || filepath.Clean(name) != name || strings.ContainsAny(name, `/\\:`) || strings.HasSuffix(name, ".") {
		return "", false
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return "", false
		}
	}
	return name, true
}

func (s *Server) maybeHandleProjectCommand(w http.ResponseWriter, r *http.Request, sid string, cs *chatSession, prompt string) bool {
	cmd := strings.TrimSpace(prompt)
	if cmd != "/project" && !strings.HasPrefix(cmd, "/project ") && !strings.HasPrefix(cmd, "/project\t") {
		return false
	}

	arg := strings.TrimSpace(strings.TrimPrefix(cmd, "/project"))
	reply := ""
	switch {
	case arg == "":
		names := discoverProjectNames(s.CfgStore.Snapshot().GARoot)
		if len(names) == 0 {
			reply = "当前没有已创建的项目。用法：`/project <项目名>`，关闭：`/project off`。"
		} else {
			reply = "可用项目：\n\n" + strings.Join(names, "\n") + "\n\n切换项目：`/project <项目名>`；关闭：`/project off`。"
		}
	case strings.EqualFold(arg, "status"):
	case strings.EqualFold(arg, "off") || strings.EqualFold(arg, "disable") || strings.EqualFold(arg, "none"):
		cs.ProjectMode = ""
		reply = "已关闭当前会话的 Project Mode。项目文件和记忆均已保留。"
	default:
		name, ok := validProjectModeName(arg)
		if !ok {
			reply = "进入 Project Mode 失败：" + errProjectNameInvalid.Error() + "。"
			break
		}
		projectDir, memoryPath, err := ensureProjectMode(s.CfgStore.Snapshot(), name)
		if err != nil {
			reply = fmt.Sprintf("进入 Project Mode 失败：%v。", err)
			break
		}
		cs.ProjectMode = name
		reply = fmt.Sprintf("已进入 Project Mode：`%s`\n\n项目目录：`%s`\n项目记忆：`%s`", name, projectDir, memoryPath)
	}

	msg := chatMessage{ID: newChatID(), Role: "assistant", Content: reply, CreatedAt: time.Now().Unix()}
	cs.Messages = append(cs.Messages, msg)
	cs.UpdatedAt = time.Now().Unix()
	if err := saveChatSession(s.CfgStore.Snapshot(), *cs); err != nil {
		s.endChatRun(sid)
		bad(w, http.StatusInternalServerError, err.Error())
		return true
	}
	s.publishChatRun(sid, map[string]interface{}{"type": "message", "message": msg, "workspace": cs.Workspace, "project_mode": cs.ProjectMode})
	s.endChatRun(sid)
	s.streamChatRun(w, r, sid, 0)
	return true
}

func (s *Server) chatBTW(w http.ResponseWriter, r *http.Request, sid string) {
	var req struct {
		Prompt string `json:"prompt"`
	}
	if err := decode(r, &req); err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "/btw" || (!strings.HasPrefix(prompt, "/btw ") && !strings.HasPrefix(prompt, "/btw\t")) {
		bad(w, http.StatusBadRequest, "a non-empty /btw question is required")
		return
	}
	sid = safeChatID(sid)
	s.SessionMu.Lock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	s.SessionMu.Unlock()
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	cmdReq := map[string]interface{}{
		"op":               "btw",
		"prompt":           prompt,
		"history":          cs.Messages,
		"raw_history":      cs.RawHistory,
		"workspace":        cs.Workspace,
		"project_mode":     cs.ProjectMode,
		"llm_no":           cs.Settings.LLMNo,
		"reasoning_effort": cs.Settings.ReasoningEffort,
		"ga_root":          s.CfgStore.Snapshot().GARoot,
	}
	msg, err := runOneShotBTWWorkerFunc(s.CfgStore.Snapshot(), sid, cmdReq)
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	msg.Kind = "btw"
	msg.SideQuestion = strings.TrimSpace(strings.TrimPrefix(prompt, "/btw"))
	s.SessionMu.Lock()
	latest, loadErr := loadChatSession(s.CfgStore.Snapshot(), sid)
	if loadErr == nil {
		latest.Messages = mergeChatMessageLists(latest.Messages, []chatMessage{msg})
		latest.UpdatedAt = time.Now().Unix()
		loadErr = saveChatSession(s.CfgStore.Snapshot(), latest)
	}
	s.SessionMu.Unlock()
	if loadErr != nil {
		bad(w, http.StatusInternalServerError, loadErr.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "message": msg})
}

func (s *Server) chatPost(w http.ResponseWriter, r *http.Request, sid string) {
	s.chatPostMode(w, r, sid, false)
}

// chatPostMode starts the same durable chat run used by the Web UI. Hub callers
// use startOnly so their synchronous put callback can acknowledge admission
// immediately instead of waiting for the entire streamed model response.
func (s *Server) chatPostMode(w http.ResponseWriter, r *http.Request, sid string, startOnly bool) {
	var req struct {
		Prompt              string        `json:"prompt"`
		Files               []chatUpload  `json:"files"`
		Settings            *chatSettings `json:"settings"`
		ClientUserID        string        `json:"client_user_id"`
		SourceUserMessageID string        `json:"source_user_message_id"`
	}
	if err := decodeLimited(r, &req, maxChatPostBodyBytes); err != nil {
		bad(w, 400, err.Error())
		return
	}
	sid = safeChatID(sid)
	cmd, immediate, parseErr := parseImmediateChatCommand(req.Prompt)
	if parseErr != nil {
		bad(w, http.StatusBadRequest, parseErr.Error())
		return
	}
	if immediate && commandNeedsDanger(cmd) && !requireDangerousHeader(w, r) {
		return
	}
	token := s.beginChatRun(sid)
	if token == nil {
		bad(w, 409, "chat is already running")
		return
	}
	if immediate {
		s.maybeHandleImmediateChatCommand(w, r, sid, token, cmd)
		return
	}
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		s.endChatRunOwned(sid, token)
		bad(w, 500, err.Error())
		return
	}
	if cs.ID == "" {
		cs.ID = sid
		cs.Title = "新会话"
	}
	cs.Settings = normalizeChatSettings(cs.Settings)
	if req.Settings != nil {
		cs.Settings = normalizeChatSettings(*req.Settings)
	}
	if s.maybeHandleWorkspaceCommand(w, r, sid, &cs, req.Prompt) {
		return
	}
	if s.maybeHandleProjectCommand(w, r, sid, &cs, req.Prompt) {
		return
	}
	var inheritedFiles []map[string]interface{}
	var inheritedRefs []string
	if sourceID := strings.TrimSpace(req.SourceUserMessageID); sourceID != "" {
		if len(req.Files) > 0 {
			s.endChatRunOwned(sid, token)
			bad(w, http.StatusBadRequest, "worldline edit/resend does not accept new attachments")
			return
		}
		// Capture the source attachments before prepareChatWorldlineResend trims
		// the conversation. They are already persisted files, so an edit/resend
		// only needs to reuse their metadata and prompt references; it must not
		// upload the file contents again.
		for i := range cs.Messages {
			if cs.Messages[i].ID == sourceID && cs.Messages[i].Role == "user" {
				inheritedFiles = cloneChatFileMetadata(cs.Messages[i].Files)
				inheritedRefs = chatMessageAttachmentRefs(cs.Messages[i])
				break
			}
		}
		if err := s.prepareChatWorldlineResend(sid, token, &cs, sourceID); err != nil {
			s.endChatRunOwned(sid, token)
			bad(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	saved, refs, err := saveChatUploads(s.CfgStore.Snapshot(), req.Files)
	if err != nil {
		s.endChatRunOwned(sid, token)
		bad(w, 400, err.Error())
		return
	}
	if strings.TrimSpace(req.SourceUserMessageID) != "" {
		saved = append(inheritedFiles, saved...)
		refs = append(inheritedRefs, refs...)
	}
	display := req.Prompt
	if len(refs) > 0 {
		display += "\n\n[附件已保存]\n" + strings.Join(refs, "\n")
	}
	uid := safeChatID(req.ClientUserID)
	if uid == "" {
		uid = newChatID()
	}
	userMsg := chatMessage{ID: uid, Role: "user", Content: display, Files: saved, CreatedAt: time.Now().Unix()}
	runStartedAtMS := time.Now().UnixMilli()
	pendingMsg := chatMessage{ID: newChatID(), Role: "assistant", CreatedAt: time.Now().Unix(), RunStartedAtMS: runStartedAtMS}
	cs.Messages = append(cs.Messages, userMsg)
	if strings.TrimSpace(req.SourceUserMessageID) == "" {
		cs.Messages = append(cs.Messages, pendingMsg)
	}
	updateChatTitle(&cs)
	owned, saveErr := s.saveChatRunPending(sid, token, pendingMsg.ID, runStartedAtMS, func() error {
		if strings.TrimSpace(req.SourceUserMessageID) != "" {
			return s.saveChatSessionExact(cs)
		}
		return s.saveChatSessionMerged(cs)
	})
	if !owned {
		s.endChatRunOwned(sid, token)
		bad(w, http.StatusConflict, "chat run was canceled")
		return
	}
	if saveErr != nil {
		s.endChatRunOwned(sid, token)
		bad(w, http.StatusInternalServerError, saveErr.Error())
		return
	}
	s.publishChatRun(sid, map[string]interface{}{"type": "user", "message": userMsg})
	workerHistory := append([]chatMessage(nil), cs.Messages...)
	for i := len(workerHistory) - 1; i >= 0; i-- {
		if workerHistory[i].ID == userMsg.ID {
			workerHistory = workerHistory[:i]
			break
		}
	}
	cmdReq := map[string]interface{}{
		"prompt":                   display,
		"history":                  workerHistory,
		"raw_history":              cs.RawHistory,
		"history_info":             cs.HistoryInfo,
		"working":                  cs.Working,
		"workspace":                cs.Workspace,
		"project_mode":             cs.ProjectMode,
		"extra_sys_prompts":        cs.ExtraSysPrompts,
		"llm_no":                   cs.Settings.LLMNo,
		"reasoning_effort":         cs.Settings.ReasoningEffort,
		"images":                   chatVisionImagePaths(saved),
		"ga_root":                  s.CfgStore.Snapshot().GARoot,
		"_ga_worldline_resend":     strings.TrimSpace(req.SourceUserMessageID) != "",
		"_ga_pending_assistant_id": pendingMsg.ID,
		"_ga_run_started_at_ms":    runStartedAtMS,
	}
	go s.runChatWorkerOwned(sid, token, cs, cmdReq)
	if startOnly {
		writeJSON(w, map[string]interface{}{"ok": true, "running": true})
		return
	}
	s.streamChatRun(w, r, sid, 0)
}

func (s *Server) chatStream(w http.ResponseWriter, r *http.Request, sid string) {
	from := 0
	if v := strings.TrimSpace(r.URL.Query().Get("from")); v != "" {
		_, _ = fmt.Sscanf(v, "%d", &from)
	}
	s.streamChatRun(w, r, safeChatID(sid), from)
}

func (s *Server) cancelChatRun(sid string) (bool, error) {
	sid = safeChatID(sid)
	var cmd *exec.Cmd
	var worker *chatWorker
	var token *chatRun
	var events [][]byte
	var pendingID string
	var startedAtMS int64
	s.ChatMu.Lock()
	run := s.ChatRuns[sid]
	if run == nil || run.Done {
		s.ChatMu.Unlock()
		return false, nil
	}
	run.Canceled = true
	token = run
	cmd = run.Cmd
	worker = s.ChatWorkers[sid]
	events = append(events, run.Events...)
	pendingID = run.PendingAssistantID
	startedAtMS = run.RunStartedAtMS
	s.ChatMu.Unlock()

	if worker != nil {
		s.dropChatWorker(sid, worker)
		worker.Mu.Lock()
		worker.Mu.Unlock()
	} else if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	persistErr := s.persistCanceledChatRun(sid, pendingID, startedAtMS, events)
	s.ChatMu.Lock()
	if current := s.ChatRuns[sid]; current == token {
		current.CancelReady = true
	}
	s.ChatMu.Unlock()
	s.endChatRunOwned(sid, token)
	return true, persistErr
}

func (s *Server) chatCancel(w http.ResponseWriter, r *http.Request, sid string) {
	running, err := s.cancelChatRun(sid)
	if err != nil {
		bad(w, http.StatusInternalServerError, fmt.Sprintf("chat canceled but failed to persist partial output: %v", err))
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "running": running && s.chatRunActive(sid)})
}

func (s *Server) chatFile(w http.ResponseWriter, r *http.Request, name string) {
	http.ServeFile(w, r, filepath.Join(chatUploadDir(s.CfgStore.Snapshot()), filepath.Base(name)))
}
