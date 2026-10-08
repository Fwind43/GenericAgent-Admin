package api

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

// Transient public telemetry, not history, evidence, tool arguments, or model reasoning.
type conductorRunProgress struct {
	Available     bool   `json:"available"`
	Phase         string `json:"phase"`
	Step          int    `json:"step,omitempty"`
	LatestSummary string `json:"latest_summary,omitempty"`
	LatestOutput  string `json:"latest_output,omitempty"`
	ToolName      string `json:"tool_name,omitempty"`
	ActiveTools   int    `json:"active_tools,omitempty"`
	UpdatedAtMS   int64  `json:"updated_at_ms,omitempty"`
	ElapsedMS     int64  `json:"elapsed_ms,omitempty"`
}

// Byte caps also bound Python's ASCII-escaped tool receipt, including control characters.
func conductorProgressText(value string, limit int, tail bool) string {
	value = strings.ToValidUTF8(value, "")
	if len(value) <= limit {
		return value
	}
	if tail {
		start := len(value) - limit
		for start < len(value) && !utf8.RuneStart(value[start]) {
			start++
		}
		return value[start:]
	}
	end := limit
	for end > 0 && !utf8.RuneStart(value[end]) {
		end--
	}
	return value[:end]
}

// Called only under ChatMu; capture a constant-size allowlist rather than replaying history.
func (r *chatRun) updateConductorProgress(line []byte) {
	var ev struct {
		Type        string `json:"type"`
		Summary     string `json:"summary"`
		Content     string `json:"content"`
		ToolName    string `json:"tool_name"`
		ActiveTools int    `json:"tool_active_count"`
	}
	if json.Unmarshal(line, &ev) != nil {
		return
	}
	progress := &r.ConductorProgress
	switch ev.Type {
	case "turn":
		progress.Step++
		progress.LatestSummary = conductorProgressText(ev.Summary, 256, false)
		// Raw deltas also contain tool arguments/results; only structured public
		// model content is safe for this on-demand coordination snapshot.
		progress.LatestOutput = conductorProgressText(ev.Content, 512, true)
	case "tool_timing":
		progress.ActiveTools = max(0, ev.ActiveTools)
		progress.ToolName = ""
		if progress.ActiveTools > 0 {
			progress.ToolName = conductorProgressText(ev.ToolName, 64, false)
		}
	default:
		return
	}
	progress.Available = true
	progress.Phase = "model"
	if progress.ActiveTools > 0 {
		progress.Phase = "tool"
	}
	progress.UpdatedAtMS = time.Now().UnixMilli()
}

func (s *Server) inspectConductorChild(parentID, dispatchID string) (map[string]interface{}, error) {
	// Same lock order as scheduling/pending publication: SessionMu before ChatMu.
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	parent, err := loadChatSession(s.CfgStore.Snapshot(), parentID)
	if err != nil {
		return nil, err
	}
	if parent.Conductor == nil || parent.Conductor.Role != conductorRoleParent {
		return nil, errors.New("inspection requires a conductor parent")
	}
	var child *chatConductorChild
	for i := range parent.ConductorChildren {
		if parent.ConductorChildren[i].DispatchID == dispatchID {
			child = &parent.ConductorChildren[i]
			break
		}
	}
	if child == nil {
		return nil, errors.New("dispatch does not belong to this parent")
	}
	progress := conductorRunProgress{Phase: child.Status}
	reply := map[string]interface{}{"ok": true, "dispatch_id": child.DispatchID, "session_id": child.SessionID, "status": child.Status, "objective": conductorProgressText(child.Objective, 256, false)}
	if child.Status == conductorRunning {
		progress.Phase = "unavailable"
		worker, loadErr := loadChatSession(s.CfgStore.Snapshot(), child.SessionID)
		if loadErr == nil && worker.Conductor != nil && worker.Conductor.Role == conductorRoleWorker && worker.Conductor.ParentSessionID == parentID && worker.Conductor.DispatchID == dispatchID && child.MessageStart != nil && *child.MessageStart >= 0 && *child.MessageStart <= len(worker.Messages) {
			s.ChatMu.Lock()
			run := s.ChatRuns[child.SessionID]
			if run != nil && !run.Done && !run.Canceled && run.PendingAssistantID != "" {
				for _, message := range worker.Messages[*child.MessageStart:] {
					if message.ID == run.PendingAssistantID && message.Role == "assistant" && message.Kind == "pending" {
						progress = run.ConductorProgress
						progress.Available = true
						if progress.Phase == "" {
							progress.Phase = "starting"
						}
						if run.RunStartedAtMS > 0 {
							progress.ElapsedMS = max(int64(0), time.Now().UnixMilli()-run.RunStartedAtMS)
						}
						break
					}
				}
			}
			s.ChatMu.Unlock()
		}
	}
	reply["progress"] = progress
	reply["note"] = "Public telemetry only; no update is not proof of a hang. Use conductor_collect for terminal delivery/review."
	return reply, nil
}

func (s *Server) handleConductorInspectEvent(sid string, ev map[string]interface{}) {
	requestID, _ := ev["request_id"].(string)
	dispatchID, _ := ev["dispatch_id"].(string)
	if requestID == "" || requestID != safeChatID(requestID) || dispatchID == "" || dispatchID != safeChatID(dispatchID) {
		return
	}
	dir := chatConductorBrokerDirForSession(chatSessionDir(s.CfgStore.Snapshot()), sid)
	broker, _ := ev["broker_dir"].(string)
	if filepath.Clean(broker) != filepath.Clean(dir) {
		return
	}
	reply, err := s.inspectConductorChild(sid, dispatchID)
	if err != nil {
		reply = map[string]interface{}{"ok": false, "error": err.Error()}
	}
	s.writeConductorInstructionReply(dir, requestID, reply)
}
