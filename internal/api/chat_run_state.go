package api

import (
	"encoding/json"
	"os/exec"
	"strings"
	"time"
)

func chatSessionForClient(cs chatSession) chatSession {
	return cs
}

func (s *Server) chatRunState(sid string) (bool, string, int64) {
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	r := s.ChatRuns[safeChatID(sid)]
	if r == nil || r.Done {
		return false, "", 0
	}
	return true, r.PendingAssistantID, r.RunStartedAtMS
}

func (s *Server) chatRunActive(sid string) bool {
	running, _, _ := s.chatRunState(sid)
	return running
}

func (s *Server) beginChatRun(sid string) *chatRun {
	sid = safeChatID(sid)
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	if s.ChatRuns == nil {
		s.ChatRuns = map[string]*chatRun{}
	}
	if r := s.ChatRuns[sid]; r != nil {
		if !r.Done {
			return nil
		}
		if r.ReplayCleanup != nil {
			r.ReplayCleanup.Stop()
		}
	}
	token := &chatRun{ID: newChatID(), SID: sid, Subscribers: map[chan []byte]bool{}}
	s.ChatRuns[sid] = token
	return token
}

// saveChatRunPending holds SessionMu before ChatMu, matching conductor operations.
// The save callback must use session-locked helpers and must not acquire either lock.
func (s *Server) saveChatRunPending(sid string, token *chatRun, pendingID string, startedAtMS int64, save func() error) (bool, error) {
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	sid = safeChatID(sid)
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	r := s.ChatRuns[sid]
	if token == nil || r != token || r.Done || r.Canceled {
		return false, nil
	}
	if err := save(); err != nil {
		return true, err
	}
	r.PendingAssistantID = pendingID
	r.RunStartedAtMS = startedAtMS
	return true, nil
}

func (s *Server) ownsChatRun(sid string, token *chatRun) bool {
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	r := s.ChatRuns[safeChatID(sid)]
	return token != nil && r == token && !token.Done && !token.Canceled
}

func (s *Server) setChatRunCmd(sid string, cmd *exec.Cmd) {
	s.ChatMu.Lock()
	if r := s.ChatRuns[safeChatID(sid)]; r != nil {
		r.Cmd = cmd
	}
	s.ChatMu.Unlock()
}

func (s *Server) chatRunCanceled(sid string) bool {
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	r := s.ChatRuns[safeChatID(sid)]
	return r != nil && r.Canceled
}

func (s *Server) chatRunPartialContent(sid string) string {
	s.ChatMu.Lock()
	r := s.ChatRuns[safeChatID(sid)]
	var events [][]byte
	if r != nil {
		events = append(events, r.Events...)
	}
	s.ChatMu.Unlock()
	return chatPartialContentFromEvents(events)
}

func (s *Server) persistCanceledChatRun(sid, pendingID string, startedAtMS int64, events [][]byte) error {
	if strings.TrimSpace(pendingID) == "" {
		return nil
	}
	now := time.Now()
	elapsedMS := int64(1)
	if startedAtMS > 0 {
		elapsedMS = now.UnixMilli() - startedAtMS
		if elapsedMS < 1 {
			elapsedMS = 1
		}
	}
	content := strings.TrimSpace(chatPartialContentFromEvents(events))
	if content != "" {
		content += "\n\n[\u7528\u6237\u624b\u52a8\u4e2d\u6b62\u751f\u6210]"
	} else {
		content = "\u5df2\u505c\u6b62\u751f\u6210"
	}
	usage, usages := chatUsageFromEvents(events)
	ctxChars, ctxMsgs := chatCtxStatsFromEvents(events)
	final := chatMessage{
		ID:             pendingID,
		Role:           "assistant",
		Content:        content,
		CreatedAt:      now.Unix(),
		Error:          true,
		ElapsedMS:      elapsedMS,
		RunStartedAtMS: startedAtMS,
		Usage:          usage,
		Usages:         usages,
		CtxChars:       ctxChars,
		CtxMsgs:        ctxMsgs,
	}

	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		return err
	}
	target := -1
	for i := range cs.Messages {
		if cs.Messages[i].ID == pendingID {
			target = i
			break
		}
	}
	if target >= 0 {
		existing := cs.Messages[target]
		if strings.TrimSpace(existing.Content) != "" || existing.Error || existing.ElapsedMS > 0 || existing.ModelID != "" || len(existing.Usage) > 0 || len(existing.Usages) > 0 {
			return nil
		}
		cs.Messages[target] = final
	} else {
		target = len(cs.Messages)
		cs.Messages = append(cs.Messages, final)
	}
	fallback := make([]chatMessage, 0, 2)
	for i := target - 1; i >= 0; i-- {
		if cs.Messages[i].Role == "user" {
			fallback = append(fallback, cs.Messages[i])
			break
		}
	}
	fallback = append(fallback, final)
	cs.RawHistory = appendChatRawHistoryFallback(cs.RawHistory, fallback...)
	cs.UpdatedAt = now.Unix()
	return saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
}

func (s *Server) chatRunStructuredSnapshot(sid string) (string, []map[string]interface{}) {
	s.ChatMu.Lock()
	var runID string
	var events [][]byte
	if run := s.ChatRuns[sid]; run != nil {
		runID = run.ID
		events = make([][]byte, len(run.Events))
		for i, event := range run.Events {
			events[i] = append([]byte(nil), event...)
		}
	}
	s.ChatMu.Unlock()

	turns := make([]map[string]interface{}, 0)
	for _, event := range events {
		var value map[string]interface{}
		if json.Unmarshal(event, &value) == nil && value["type"] == "turn" {
			turns = append(turns, value)
		}
	}
	return runID, turns
}

func (s *Server) publishChatRun(sid string, ev map[string]interface{}) {
	b, _ := json.Marshal(ev)
	s.publishChatLine(sid, b)
}

func (s *Server) publishChatLine(sid string, line []byte) {
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	r := s.ChatRuns[sid]
	if r == nil || r.Canceled {
		return
	}
	b := append([]byte(nil), line...)
	r.Events = append(r.Events, b)
	r.updateConductorProgress(line)
	var ev struct {
		Delta string `json:"delta"`
	}
	if json.Unmarshal(line, &ev) == nil && ev.Delta != "" {
		r.TaskbarText.WriteString(ev.Delta)
		r.TaskbarDirty = true
	}
	for ch := range r.Subscribers {
		select {
		case ch <- b:
		default:
			// Preserve the global event cursor: a slow subscriber must reconnect
			// with ?from=N rather than silently skip an event in this stream.
			close(ch)
			delete(r.Subscribers, ch)
		}
	}
}

func (s *Server) endChatRunOwned(sid string, token *chatRun) {
	sid = safeChatID(sid)
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	r := s.ChatRuns[sid]
	if r == nil || (token != nil && r != token) || (r.Canceled && !r.CancelReady) {
		return
	}
	if !r.Done {
		r.Done = true
		for ch := range r.Subscribers {
			close(ch)
		}
		r.Subscribers = map[chan []byte]bool{}
	}
	if r.ReplayCleanup != nil {
		return
	}
	// Keep the five-minute replay window, without a sleeping goroutine or a
	// closure retaining an obsolete run and all of its NDJSON payloads.
	var timer *time.Timer
	timer = time.AfterFunc(5*time.Minute, func() { s.expireChatRunReplay(sid, timer) })
	r.ReplayCleanup = timer
}

func (s *Server) expireChatRunReplay(sid string, timer *time.Timer) {
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	if r := s.ChatRuns[sid]; r != nil && r.Done && r.ReplayCleanup == timer {
		delete(s.ChatRuns, sid)
	}
}

func (s *Server) endChatRun(sid string) { s.endChatRunOwned(sid, nil) }
