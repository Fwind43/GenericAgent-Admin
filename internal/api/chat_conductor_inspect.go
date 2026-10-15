package api

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const conductorRecentStepLimit = 5

type conductorProgressStep struct {
	Step        int    `json:"step"`
	Summary     string `json:"summary,omitempty"`
	Output      string `json:"output,omitempty"`
	UpdatedAtMS int64  `json:"updated_at_ms"`
}

// Transient public telemetry, not history, evidence, tool arguments, or model reasoning.
type conductorRunProgress struct {
	Available     bool                    `json:"available"`
	Phase         string                  `json:"phase"`
	Step          int                     `json:"step,omitempty"`
	LatestSummary string                  `json:"latest_summary,omitempty"`
	LatestOutput  string                  `json:"latest_output,omitempty"`
	ToolName      string                  `json:"tool_name,omitempty"`
	ActiveTools   int                     `json:"active_tools,omitempty"`
	UpdatedAtMS   int64                   `json:"updated_at_ms,omitempty"`
	ElapsedMS     int64                   `json:"elapsed_ms,omitempty"`
	RecentSteps   []conductorProgressStep `json:"recent_steps,omitempty"`
	Reason        string                  `json:"reason,omitempty"`
	Message       string                  `json:"message"`
	UpdateAgeMS   *int64                  `json:"update_age_ms,omitempty"`
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
	now := time.Now().UnixMilli()
	switch ev.Type {
	case "turn":
		progress.Step++
		// Raw deltas also contain tool arguments/results; only structured public
		// model content is safe for this on-demand coordination snapshot.
		summary := conductorProgressText(strings.TrimSpace(ev.Summary), 256, false)
		output := conductorProgressText(strings.TrimSpace(ev.Content), 512, true)
		if summary != "" || output != "" {
			progress.LatestSummary = summary
			progress.LatestOutput = output
			// Replace rather than mutate the backing array: returned snapshots stay immutable.
			start := max(0, len(progress.RecentSteps)-(conductorRecentStepLimit-1))
			recent := make([]conductorProgressStep, 0, conductorRecentStepLimit)
			recent = append(recent, progress.RecentSteps[start:]...)
			progress.RecentSteps = append(recent, conductorProgressStep{Step: progress.Step, Summary: summary, Output: output, UpdatedAtMS: now})
		}
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
	progress.UpdatedAtMS = now
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
	progress := conductorRunProgress{Phase: child.Status, Reason: "not_running", Message: "Dispatch is not running; use its lifecycle status and conductor_collect for terminal delivery/review."}
	reply := map[string]interface{}{"ok": true, "dispatch_id": child.DispatchID, "session_id": child.SessionID, "status": child.Status, "objective": conductorProgressText(child.Objective, 256, false)}
	if child.Status == conductorQueued {
		progress.Reason = "waiting_to_start"
		progress.Message = "Dispatch is queued and has not started; no live steps are available."
	}
	if child.Status == conductorRunning {
		progress.Phase = "unavailable"
		worker, loadErr := loadChatSession(s.CfgStore.Snapshot(), child.SessionID)
		switch {
		case loadErr != nil || worker.Conductor == nil:
			progress.Reason = "worker_unavailable"
			progress.Message = "Worker session or its Conductor context is unavailable; live progress cannot be read."
		case worker.Conductor.Role != conductorRoleWorker || worker.Conductor.ParentSessionID != parentID || worker.Conductor.DispatchID != dispatchID:
			progress.Reason = "worker_mismatch"
			progress.Message = "Worker session no longer matches this dispatch; unrelated progress is withheld."
		case child.MessageStart == nil || *child.MessageStart < 0 || *child.MessageStart > len(worker.Messages):
			progress.Reason = "dispatch_boundary_unavailable"
			progress.Message = "Current dispatch message boundary is unavailable; historical progress is withheld."
		default:
			progress.Reason = "no_active_run"
			progress.Message = "Lifecycle says running, but no matching active run snapshot is available; this does not prove a hang or completion."
			s.ChatMu.Lock()
			run := s.ChatRuns[child.SessionID]
			if run != nil && !run.Done && !run.Canceled && run.PendingAssistantID != "" {
				progress.Reason = "pending_message_unavailable"
				progress.Message = "Active run cannot be matched to this dispatch's pending message; unrelated progress is withheld."
				for _, message := range worker.Messages[*child.MessageStart:] {
					if message.ID == run.PendingAssistantID && message.Role == "assistant" && message.Kind == "pending" {
						progress = run.ConductorProgress
						progress.RecentSteps = append([]conductorProgressStep(nil), progress.RecentSteps...)
						progress.Available = true
						if progress.Phase == "" {
							progress.Phase = "starting"
						}
						now := time.Now().UnixMilli()
						if run.RunStartedAtMS > 0 {
							progress.ElapsedMS = max(int64(0), now-run.RunStartedAtMS)
						}
						if progress.UpdatedAtMS > 0 {
							age := max(int64(0), now-progress.UpdatedAtMS)
							progress.UpdateAgeMS = &age
						}
						progress.Message = "Recent steps are worker-reported public activity, not verified completion."
						if len(progress.RecentSteps) == 0 && progress.LatestSummary == "" && progress.LatestOutput == "" {
							progress.Reason = "no_public_steps"
							progress.Message = "Worker run is active but has not published a readable public step yet."
							if progress.ActiveTools > 0 {
								progress.Message = "A tool is running, but no readable public step has been published yet."
							}
						}
						break
					}
				}
			}
			s.ChatMu.Unlock()
		}
	}
	reply["progress"] = progress
	reply["note"] = "Worker-reported public telemetry, not verified corrections or evidence. Step counts public model turns, not completed fixes. Use recent_steps and update_age_ms to describe progress; explain reason/message if absent. No update is not proof of a hang. Use conductor_collect for terminal delivery/review."
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
