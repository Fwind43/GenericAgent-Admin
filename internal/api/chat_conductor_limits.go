package api

import (
	"encoding/json"
	"errors"
	"strings"
)

const (
	conductorHardMaxRunning     = 32
	conductorHardMaxNonTerminal = 256
)

// Per-parent resource policy, never a provider/global quota or worker permission.
type conductorLimits struct {
	MaxRunning     int `json:"max_running"`
	MaxNonTerminal int `json:"max_non_terminal"`
}

func effectiveConductorLimits(state *chatConductorState) conductorLimits {
	limits := conductorLimits{MaxRunning: conductorMaxRunning, MaxNonTerminal: conductorMaxPerParentTurn}
	if state != nil && state.Limits != nil {
		limits = *state.Limits
	}
	// Invalid/legacy disk values must not disable admission or spawn unbounded work.
	if limits.MaxRunning < 1 || limits.MaxRunning > conductorHardMaxRunning ||
		limits.MaxNonTerminal < limits.MaxRunning || limits.MaxNonTerminal > conductorHardMaxNonTerminal {
		return conductorLimits{MaxRunning: conductorMaxRunning, MaxNonTerminal: conductorMaxPerParentTurn}
	}
	return limits
}

func (s *Server) conductorLimits(parentID string, args map[string]interface{}) (conductorSchedulerSnapshot, error) {
	var empty conductorSchedulerSnapshot
	action, _ := args["action"].(string)
	if action != "get" && action != "set" && action != "reset" {
		return empty, errors.New("action must be get, set or reset")
	}
	patch := map[string]int{}
	for key, value := range args {
		if key == "action" || strings.HasPrefix(key, "_") {
			continue
		}
		if key != "max_running" && key != "max_non_terminal" {
			return empty, errors.New("unknown limits field")
		}
		if action != "set" {
			return empty, errors.New("get/reset do not accept limit values")
		}
		data, err := json.Marshal(value)
		var n int
		if err != nil || value == nil || json.Unmarshal(data, &n) != nil || n < 1 {
			return empty, errors.New("limits must be positive integers")
		}
		patch[key] = n
	}
	if action == "set" && len(patch) == 0 {
		return empty, errors.New("set requires at least one limit")
	}

	s.SessionMu.Lock()
	parent, err := loadChatSession(s.CfgStore.Snapshot(), parentID)
	if err != nil || parent.Conductor == nil || parent.Conductor.Role != conductorRoleParent {
		s.SessionMu.Unlock()
		return empty, errors.New("parent required")
	}
	current := effectiveConductorLimits(parent.Conductor)
	next := current
	if action == "reset" {
		next = effectiveConductorLimits(nil)
	} else {
		if n, ok := patch["max_running"]; ok {
			next.MaxRunning = n
		}
		if n, ok := patch["max_non_terminal"]; ok {
			next.MaxNonTerminal = n
		}
	}
	if next.MaxRunning > conductorHardMaxRunning || next.MaxNonTerminal > conductorHardMaxNonTerminal || next.MaxRunning > next.MaxNonTerminal {
		s.SessionMu.Unlock()
		return empty, errors.New("require 1 <= max_running <= 32 and max_running <= max_non_terminal <= 256")
	}
	changed := action != "get" && (next != current || (action == "reset" && parent.Conductor.Limits != nil))
	if changed {
		parent.Conductor.Limits = &next
		if action == "reset" {
			parent.Conductor.Limits = nil
		}
		if err := saveChatSession(s.CfgStore.Snapshot(), parent); err != nil {
			s.SessionMu.Unlock()
			return empty, errors.New("limits persistence failed")
		}
	}
	snapshot := conductorSchedulerOverview(parent.ConductorChildren, next)
	snapshot.Snapshot = "tool_request"
	s.SessionMu.Unlock()
	if changed {
		// Increasing capacity immediately drains eligible queued work. Decreasing
		// never cancels existing work; scheduler/admission enforce the new policy.
		s.scheduleConductorChildren(parentID)
		s.SessionMu.Lock()
		if latest, err := loadChatSession(s.CfgStore.Snapshot(), parentID); err == nil {
			snapshot = conductorSchedulerOverview(latest.ConductorChildren, effectiveConductorLimits(latest.Conductor))
			snapshot.Snapshot = "tool_request"
		}
		s.SessionMu.Unlock()
	}
	return snapshot, nil
}
