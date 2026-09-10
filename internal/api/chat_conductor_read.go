package api

import (
	"encoding/json"
	"errors"
	"time"
)

// Missing or invalid boundaries cannot establish which historical result was consumed.
func conductorResultReceipt(child chatConductorChild, worker chatSession) *chatSessionResult {
	if child.MessageStart == nil || *child.MessageStart < 0 || *child.MessageStart > len(worker.Messages) {
		return nil
	}
	worker.Messages = worker.Messages[*child.MessageStart:]
	return latestChatSessionResult(worker)
}

var errConductorReadBusy = errors.New("read receipt busy")

func (s *Server) confirmConductorRead(parentID string, ev map[string]interface{}) error {
	var err error
	for attempt := 0; attempt < 20; attempt++ {
		err = s.handleConductorReadEvent(parentID, ev)
		if !errors.Is(err, errConductorReadBusy) {
			return err
		}
		time.Sleep(10 * time.Millisecond)
	}
	return err
}

// Receipt acknowledgment is independent of review and never changes session state.
func (s *Server) handleConductorReadEvent(parentID string, ev map[string]interface{}) error {
	var ack struct {
		DispatchID string             `json:"dispatch_id"`
		SessionID  string             `json:"session_id"`
		Result     *chatSessionResult `json:"result_receipt"`
	}
	raw, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	if err = json.Unmarshal(raw, &ack); err != nil {
		return err
	}
	if ack.Result == nil || ack.Result.ID == "" || ack.Result.Revision == "" {
		return nil
	}
	cfg := s.CfgStore.Snapshot()
	chatReadMu.Lock()
	defer chatReadMu.Unlock()
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	// Run persistence uses the opposite lock order; never wait here.
	if !s.ChatMu.TryLock() {
		return errConductorReadBusy
	}
	defer s.ChatMu.Unlock()
	parent, err := loadChatSession(cfg, parentID)
	if err != nil {
		return err
	}
	if parent.Conductor == nil || parent.Conductor.Role != conductorRoleParent {
		return nil
	}
	idx := conductorFindChild(parent.ConductorChildren, ack.DispatchID)
	if idx < 0 {
		return nil
	}
	child := parent.ConductorChildren[idx]
	if child.SessionID != ack.SessionID || !conductorTerminal(child.Status) || child.ResultReceipt == nil || *child.ResultReceipt != *ack.Result {
		return nil
	}
	worker, err := loadChatSession(cfg, child.SessionID)
	if err != nil {
		return err
	}
	if worker.Conductor == nil || worker.Conductor.ParentSessionID != parentID || worker.Conductor.DispatchID != ack.DispatchID || !conductorTerminal(worker.Conductor.Status) {
		return nil
	}
	if run := s.ChatRuns[child.SessionID]; run != nil && !run.Done {
		return errConductorReadBusy
	}
	result := latestChatSessionResult(worker)
	if result == nil || *result != *ack.Result {
		return nil
	}
	state, err := loadChatReadState(cfg)
	if err != nil {
		return err
	}
	if state == nil {
		state = make(map[string]chatSessionResult)
	}
	if state[child.SessionID] == *result {
		return nil
	}
	state[child.SessionID] = *result
	return saveChatReadState(cfg, state)
}
