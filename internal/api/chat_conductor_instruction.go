package api

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

// Delivered means the model received the input, not execution or verification.
type conductorInstruction struct {
	ID          string `json:"id"`
	Instruction string `json:"instruction"`
	Status      string `json:"status"`
	CreatedAt   int64  `json:"created_at"`
	DeliveredAt int64  `json:"delivered_at,omitempty"`
}

// Caller holds SessionMu; relationships always come from persisted sessions.
func (s *Server) conductorInstructionChildLocked(parentID, dispatchID string) (chatSession, chatSession, int, error) {
	parent, err := loadChatSession(s.CfgStore.Snapshot(), parentID)
	if err != nil {
		return parent, chatSession{}, -1, err
	}
	if parent.Conductor == nil || parent.Conductor.Role != conductorRoleParent {
		return parent, chatSession{}, -1, errors.New("Conductor parent required")
	}
	idx := conductorFindChild(parent.ConductorChildren, dispatchID)
	if idx < 0 {
		return parent, chatSession{}, -1, errors.New("dispatch does not belong to this parent")
	}
	worker, err := loadChatSession(s.CfgStore.Snapshot(), parent.ConductorChildren[idx].SessionID)
	if err != nil {
		return parent, worker, -1, err
	}
	if worker.Conductor == nil || worker.Conductor.Role != conductorRoleWorker || worker.Conductor.ParentSessionID != parentID || worker.Conductor.DispatchID != dispatchID {
		return parent, worker, -1, errors.New("worker relationship is invalid")
	}
	return parent, worker, idx, nil
}

// Admission and terminal sealing share SessionMu; retries never duplicate input.
func (s *Server) instructConductorChild(parentID, dispatchID, requestID, text string) (conductorInstruction, error) {
	var empty conductorInstruction
	if requestID == "" || safeChatID(requestID) != requestID || dispatchID == "" || safeChatID(dispatchID) != dispatchID {
		return empty, errors.New("invalid instruction or dispatch id")
	}
	text = strings.TrimSpace(text)
	if text == "" || utf8.RuneCountInString(text) > conductorMaxObjective {
		return empty, errors.New("instruction must contain 1-4096 characters")
	}
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	parent, worker, idx, err := s.conductorInstructionChildLocked(parentID, dispatchID)
	if err != nil {
		return empty, err
	}
	child := parent.ConductorChildren[idx]
	for _, row := range child.Instructions {
		if row.ID == requestID {
			if row.Instruction != text {
				return empty, errors.New("instruction id already used with different text")
			}
			return row, nil
		}
	}
	if (child.Status != conductorRunning && child.Status != conductorQueued) || (worker.Conductor.Status != conductorRunning && worker.Conductor.Status != conductorQueued) {
		return empty, errors.New("worker is not active; reuse its completed session for follow-up")
	}
	if child.InstructionClosed {
		return empty, errors.New("worker is finishing; wait for completion and reuse its session")
	}
	if len(child.Instructions) >= 32 {
		return empty, errors.New("dispatch instruction limit reached (32)")
	}
	row := conductorInstruction{ID: requestID, Instruction: text, Status: "queued", CreatedAt: time.Now().Unix()}
	child.Instructions = append(child.Instructions, row)
	parent.ConductorChildren[idx] = child
	if err := saveChatSessionLocked(s.CfgStore.Snapshot(), parent); err != nil {
		return empty, err
	}
	return row, nil
}

// A finishing worker seals admission only when no queued instruction remains.
func (s *Server) checkConductorInstructions(workerID, dispatchID string, terminal bool) (map[string]interface{}, error) {
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	worker, err := loadChatSession(s.CfgStore.Snapshot(), workerID)
	if err != nil {
		return nil, err
	}
	if worker.Conductor == nil || worker.Conductor.Role != conductorRoleWorker || worker.Conductor.DispatchID != dispatchID {
		return nil, errors.New("worker relationship is invalid")
	}
	parent, worker, idx, err := s.conductorInstructionChildLocked(worker.Conductor.ParentSessionID, dispatchID)
	if err != nil {
		return nil, err
	}
	child := parent.ConductorChildren[idx]
	if child.SessionID != workerID || child.Status != conductorRunning || worker.Conductor.Status != conductorRunning {
		return nil, errors.New("worker is no longer running")
	}
	pending := []conductorInstruction{}
	for _, row := range child.Instructions {
		if row.Status == "queued" {
			pending = append(pending, row)
		}
	}
	if terminal && len(pending) == 0 && !child.InstructionClosed {
		child.InstructionClosed = true
		parent.ConductorChildren[idx] = child
		if err := saveChatSessionLocked(s.CfgStore.Snapshot(), parent); err != nil {
			return nil, err
		}
	}
	return map[string]interface{}{"ok": true, "dispatch_id": dispatchID, "instructions": pending, "closed": child.InstructionClosed}, nil
}

func (s *Server) acknowledgeConductorInstructions(workerID, dispatchID string, ids []string) error {
	if len(ids) == 0 || len(ids) > 32 {
		return errors.New("invalid instruction acknowledgment")
	}
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	worker, err := loadChatSession(s.CfgStore.Snapshot(), workerID)
	if err != nil {
		return err
	}
	if worker.Conductor == nil || worker.Conductor.Role != conductorRoleWorker || worker.Conductor.DispatchID != dispatchID {
		return errors.New("worker relationship is invalid")
	}
	parent, _, idx, err := s.conductorInstructionChildLocked(worker.Conductor.ParentSessionID, dispatchID)
	if err != nil {
		return err
	}
	child := parent.ConductorChildren[idx]
	if child.SessionID != workerID {
		return errors.New("dispatch relationship is invalid")
	}
	changed := false
	for _, id := range ids {
		found := false
		for i := range child.Instructions {
			if child.Instructions[i].ID != id {
				continue
			}
			found = true
			if child.Instructions[i].Status == "queued" {
				child.Instructions[i].Status = "delivered"
				child.Instructions[i].DeliveredAt = time.Now().Unix()
				changed = true
			}
		}
		if !found {
			return errors.New("instruction does not belong to this dispatch")
		}
	}
	if !changed {
		return nil
	}
	parent.ConductorChildren[idx] = child
	return saveChatSessionLocked(s.CfgStore.Snapshot(), parent)
}

func (s *Server) writeConductorInstructionReply(dir, requestID string, reply interface{}) {
	if os.MkdirAll(dir, 0700) != nil {
		return
	}
	data, err := json.Marshal(reply)
	if err == nil {
		_ = writeChatFileAtomic(filepath.Join(dir, requestID+".response.json"), data, 0600)
	}
}

func (s *Server) handleConductorInstructionEvent(sid string, ev map[string]interface{}) {
	kind, _ := ev["type"].(string)
	requestID, _ := ev["request_id"].(string)
	dispatchID, _ := ev["dispatch_id"].(string)
	if requestID == "" || safeChatID(requestID) != requestID {
		return
	}
	parentID := sid
	if kind != "conductor_instruct" {
		s.SessionMu.Lock()
		worker, err := loadChatSession(s.CfgStore.Snapshot(), sid)
		s.SessionMu.Unlock()
		if err != nil || worker.Conductor == nil || worker.Conductor.Role != conductorRoleWorker || worker.Conductor.DispatchID != dispatchID {
			return
		}
		parentID = worker.Conductor.ParentSessionID
	}
	dir := chatConductorBrokerDirForSession(chatSessionDir(s.CfgStore.Snapshot()), parentID)
	broker, _ := ev["broker_dir"].(string)
	if filepath.Clean(broker) != filepath.Clean(dir) {
		return
	}
	reply := map[string]interface{}{"ok": false}
	var err error
	switch kind {
	case "conductor_instruct":
		text, _ := ev["instruction"].(string)
		var row conductorInstruction
		row, err = s.instructConductorChild(sid, dispatchID, requestID, text)
		if err == nil {
			reply = map[string]interface{}{"ok": true, "dispatch_id": dispatchID, "instruction_id": row.ID, "status": row.Status}
		}
	case "conductor_instruction_check":
		terminal, _ := ev["terminal"].(bool)
		reply, err = s.checkConductorInstructions(sid, dispatchID, terminal)
	case "conductor_instruction_ack":
		data, _ := json.Marshal(ev["instruction_ids"])
		var ids []string
		err = json.Unmarshal(data, &ids)
		if err == nil {
			err = s.acknowledgeConductorInstructions(sid, dispatchID, ids)
		}
		reply["ok"] = err == nil
	default:
		return
	}
	if err != nil {
		reply = map[string]interface{}{"ok": false, "error": err.Error()}
	}
	s.writeConductorInstructionReply(dir, requestID, reply)
}
