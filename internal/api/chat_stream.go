package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

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
