package api

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// chatGuide is tied to one running turn. The source queue item stays durable
// until the worker acknowledges a successful model call containing the guide.
type chatGuide struct {
	ID          string                   `json:"id"`
	RunID       string                   `json:"run_id"`
	Instruction string                   `json:"instruction"`
	Status      string                   `json:"status"`
	Message     chatMessage              `json:"message"`
	AssistantID string                   `json:"assistant_id,omitempty"`
	Files       []map[string]interface{} `json:"files,omitempty"`
	DeliveredAt int64                    `json:"delivered_at,omitempty"`
}

func (s *Server) chatGuideBrokerDir(sid string) string {
	return filepath.Join(chatSessionDir(s.CfgStore.Snapshot()), "guide_broker", safeChatID(sid))
}

func (s *Server) prepareChatGuideRequest(sid string, token *chatRun, req map[string]interface{}) error {
	if token == nil {
		return nil
	}
	dir := s.chatGuideBrokerDir(sid)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	req["chat_guide"] = map[string]interface{}{"broker_dir": dir, "run_id": token.ID}
	return nil
}

// chatGuideQueueItemPending is called with SessionMu held. Queue content must
// remain immutable while the worker may be using its admitted snapshot.
func (s *Server) chatGuideQueueItemPending(cs chatSession, queueID string) bool {
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	run := s.ChatRuns[cs.ID]
	if run == nil || run.Done || run.Canceled {
		return false
	}
	for _, guide := range cs.Guides {
		if guide.RunID == run.ID && guide.Status == "queued" && (queueID == "" || guide.ID == queueID) {
			return true
		}
	}
	return false
}

// admitChatGuide uses the same SessionMu -> ChatMu order as run admission and
// Conductor. A terminal safe-point check closes admission under these locks.
func (s *Server) admitChatGuide(sid, queueID string) (string, error) {
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		return "", err
	}
	run := s.ChatRuns[sid]
	if chatRunContainsQueueID(run, queueID) {
		if run.Done {
			return "already_completed", nil
		}
		return "already_started", nil
	}
	guideIndex := -1
	for i, guide := range cs.Guides {
		if guide.ID != queueID {
			continue
		}
		if guide.Status == "delivered" {
			return "delivered", nil
		}
		guideIndex = i
	}
	itemIndex := -1
	for i, item := range cs.QueuedMessages {
		if item.ID == queueID {
			itemIndex = i
			break
		}
	}
	if itemIndex < 0 {
		return "", os.ErrNotExist
	}
	if run == nil || run.Done {
		return "idle", nil
	}
	if run.Canceled || run.GuideClosed {
		// The worker has already crossed its terminal boundary. Keep the queue
		// item intact for normal post-run consumption; never cancel this run.
		return "queued", nil
	}
	if guideIndex >= 0 && cs.Guides[guideIndex].RunID == run.ID {
		return "guiding", nil
	}
	item := cs.QueuedMessages[itemIndex]
	if item.Kind == conductorCompletionQueueKind {
		return "", errors.New("internal completion cannot be used as a chat guide")
	}
	files, refs, err := saveChatUploads(s.CfgStore.Snapshot(), item.Files)
	if err != nil {
		return "", err
	}
	text := strings.TrimSpace(item.Text)
	instruction := text
	if len(refs) > 0 {
		instruction += "\n\n" + strings.Join(refs, "\n")
	}
	guide := chatGuide{
		ID: queueID, RunID: run.ID, Instruction: instruction, Status: "queued",
		Message:     chatMessage{ID: "guided-" + queueID, Role: "user", Content: text, Files: files, CreatedAt: time.Now().Unix()},
		AssistantID: run.PendingAssistantID, Files: files,
	}
	if guideIndex >= 0 {
		cs.Guides[guideIndex] = guide
	} else {
		cs.Guides = append(cs.Guides, guide)
	}
	if err := saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), cs); err != nil {
		return "", err
	}
	return "guiding", nil
}

// preserveChatGuideMessages also covers exact saves (edit/resend); the worker's
// initial session snapshot must not erase a guide delivered during that run.
func preserveChatGuideMessages(candidate *chatSession, latest chatSession) {
	candidate.Guides = latest.Guides
	for _, guide := range latest.Guides {
		if guide.Status != "delivered" {
			continue
		}
		found := false
		for _, message := range candidate.Messages {
			if message.ID == guide.Message.ID {
				found = true
				break
			}
		}
		if found {
			continue
		}
		// Only preserve guides whose owning assistant is still on this branch.
		for i, message := range candidate.Messages {
			if message.ID == guide.AssistantID {
				candidate.Messages = append(candidate.Messages, chatMessage{})
				copy(candidate.Messages[i+1:], candidate.Messages[i:])
				candidate.Messages[i] = guide.Message
				break
			}
		}
	}
}

func (s *Server) chatGuideExchange(sid string, token *chatRun, ev map[string]interface{}) (map[string]interface{}, []chatMessage, error) {
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	runID, _ := ev["run_id"].(string)
	run := s.ChatRuns[sid]
	if token == nil || run != token || run.ID != runID || run.Done || run.Canceled {
		return nil, nil, errors.New("chat guide run is no longer active")
	}
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		return nil, nil, err
	}
	kind, _ := ev["type"].(string)
	if kind == "chat_guide_check" {
		pending := []map[string]interface{}{}
		for _, guide := range cs.Guides {
			if guide.RunID == runID && guide.Status == "queued" {
				pending = append(pending, map[string]interface{}{"id": guide.ID, "instruction": guide.Instruction, "images": chatVisionImagePaths(guide.Files)})
				if len(pending) == 32 {
					break
				}
			}
		}
		terminal, _ := ev["terminal"].(bool)
		if terminal && len(pending) == 0 {
			run.GuideClosed = true
		}
		return map[string]interface{}{"ok": true, "instructions": pending, "closed": run.GuideClosed}, nil, nil
	}
	if kind != "chat_guide_ack" {
		return nil, nil, errors.New("invalid chat guide event")
	}
	ids, _ := ev["instruction_ids"].([]interface{})
	if len(ids) == 0 || len(ids) > 32 {
		return nil, nil, errors.New("invalid chat guide acknowledgment")
	}
	admitted := make(map[string]bool, len(ids))
	for _, raw := range ids {
		id, _ := raw.(string)
		found := false
		for _, guide := range cs.Guides {
			if guide.ID == id && guide.RunID == runID {
				found = true
				break
			}
		}
		if !found {
			return nil, nil, errors.New("guide does not belong to this run")
		}
		admitted[id] = true
	}
	delivered := []chatMessage{}
	for i := range cs.Guides {
		guide := &cs.Guides[i]
		if !admitted[guide.ID] || guide.Status == "delivered" {
			continue
		}
		guide.Status = "delivered"
		guide.DeliveredAt = time.Now().Unix()
		delivered = append(delivered, guide.Message)
	}
	if len(delivered) > 0 {
		queued := cs.QueuedMessages[:0]
		for _, item := range cs.QueuedMessages {
			if !admitted[item.ID] {
				queued = append(queued, item)
			}
		}
		cs.QueuedMessages = queued
		preserveChatGuideMessages(&cs, cs)
		if err := saveChatSessionLocked(s.CfgStore.Snapshot(), cs); err != nil {
			return nil, nil, err
		}
	}
	return map[string]interface{}{"ok": true}, delivered, nil
}

func (s *Server) handleChatGuideEvent(sid string, token *chatRun, ev map[string]interface{}) {
	requestID, _ := ev["request_id"].(string)
	broker, _ := ev["broker_dir"].(string)
	dir := s.chatGuideBrokerDir(sid)
	if requestID == "" || safeChatID(requestID) != requestID || filepath.Clean(broker) != filepath.Clean(dir) {
		return
	}
	reply, delivered, err := s.chatGuideExchange(sid, token, ev)
	if err != nil {
		reply = map[string]interface{}{"ok": false, "error": err.Error()}
	}
	s.writeConductorInstructionReply(dir, requestID, reply)
	if len(delivered) > 0 {
		s.publishChatQueueChanged(sid)
		for _, message := range delivered {
			s.publishChatRun(sid, map[string]interface{}{"type": "user", "message": message})
		}
	}
}
