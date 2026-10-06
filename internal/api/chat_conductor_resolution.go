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

// Resolution records an explicit disposition, never a successful execution or review.
type conductorResolution struct {
	Status                string `json:"status"`
	Basis                 string `json:"basis"`
	ReplacementDispatchID string `json:"replacement_dispatch_id,omitempty"`
	ResolvedAt            int64  `json:"resolved_at"`
}

func conductorResolutionStatus(child chatConductorChild) string {
	if child.Resolution == nil {
		return ""
	}
	return child.Resolution.Status
}

func conductorReplacementDispatch(child chatConductorChild) string {
	if child.Resolution == nil {
		return ""
	}
	return child.Resolution.ReplacementDispatchID
}

func conductorChildResolved(child chatConductorChild) bool {
	if !conductorTerminal(child.Status) || child.Recovery != "" {
		return false
	}
	if child.Resolution != nil && (child.Resolution.Status == "closed" || child.Resolution.Status == "superseded") {
		return true
	}
	return child.Status == conductorSucceeded && child.Review != nil && child.Review.Status == "verified"
}

func (s *Server) conductorResolve(parentID, dispatchID, status, basis, replacement string) (chatConductorChild, error) {
	if status != "closed" && status != "superseded" {
		return chatConductorChild{}, errors.New("resolution status must be closed or superseded")
	}
	basis = strings.TrimSpace(basis)
	if basis == "" || !utf8.ValidString(basis) || utf8.RuneCountInString(basis) > 4096 {
		return chatConductorChild{}, errors.New("basis must be nonempty valid UTF-8, at most 4096 characters")
	}
	if dispatchID == "" || safeChatID(dispatchID) != dispatchID {
		return chatConductorChild{}, errors.New("invalid dispatch_id")
	}
	if status == "closed" && replacement != "" {
		return chatConductorChild{}, errors.New("closed must omit replacement_dispatch_id")
	}
	if status == "superseded" && (replacement == "" || safeChatID(replacement) != replacement) {
		return chatConductorChild{}, errors.New("superseded requires a valid replacement_dispatch_id")
	}
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	cfg := s.CfgStore.Snapshot()
	parent, err := loadChatSession(cfg, parentID)
	if err != nil {
		return chatConductorChild{}, err
	}
	if parent.Conductor == nil || parent.Conductor.Role != conductorRoleParent {
		return chatConductorChild{}, errors.New("parent conductor is not enabled")
	}
	idx := conductorFindChild(parent.ConductorChildren, dispatchID)
	if idx < 0 {
		return chatConductorChild{}, errors.New("dispatch does not belong to this parent")
	}
	child := &parent.ConductorChildren[idx]
	if !conductorTerminal(child.Status) {
		return chatConductorChild{}, errors.New("active dispatch cannot be resolved; await completion or cancel it first")
	}
	if child.Recovery != "" {
		return chatConductorChild{}, errors.New("recovery must be confirmed before resolution")
	}
	if status == "superseded" && conductorFindChild(parent.ConductorChildren, replacement) <= idx {
		return chatConductorChild{}, errors.New("replacement must be a newer dispatch owned by this parent")
	}
	if child.Resolution != nil {
		old := child.Resolution
		if old.Status == status && old.Basis == basis && old.ReplacementDispatchID == replacement {
			return *child, nil
		}
		return chatConductorChild{}, errors.New("dispatch already has a different explicit resolution")
	}
	child.Resolution = &conductorResolution{Status: status, Basis: basis, ReplacementDispatchID: replacement, ResolvedAt: time.Now().Unix()}
	if err := saveChatSession(cfg, parent); err != nil {
		return chatConductorChild{}, err
	}
	s.writeConductorOutcome(parentID, *child)
	return *child, nil
}

func (s *Server) handleConductorResolveEvent(parentID string, ev map[string]interface{}) {
	requestID, _ := ev["request_id"].(string)
	brokerDir, _ := ev["broker_dir"].(string)
	expected := filepath.Clean(chatConductorBrokerDirForSession(chatSessionDir(s.CfgStore.Snapshot()), parentID))
	if requestID == "" || safeChatID(requestID) != requestID || filepath.Clean(brokerDir) != expected {
		return
	}
	dispatchID, _ := ev["dispatch_id"].(string)
	status, _ := ev["status"].(string)
	basis, _ := ev["basis"].(string)
	replacement, _ := ev["replacement_dispatch_id"].(string)
	child, err := s.conductorResolve(parentID, dispatchID, status, basis, replacement)
	reply := map[string]interface{}{"ok": err == nil}
	if err != nil {
		reply["error"] = err.Error()
	} else {
		reply["dispatch_id"] = child.DispatchID
		reply["status"] = child.Status
		reply["review"] = child.Review
		reply["resolution"] = child.Resolution
		reply["resolved"] = conductorChildResolved(child)
	}
	if os.MkdirAll(expected, 0700) != nil {
		return
	}
	data, err := json.Marshal(reply)
	if err == nil {
		_ = writeChatFileAtomic(filepath.Join(expected, requestID+".response.json"), data, 0600)
	}
}
