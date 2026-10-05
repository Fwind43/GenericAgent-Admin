package api

import (
	"errors"
	"strings"
	"unicode/utf8"
)

const conductorMaxModelStrategy = 8192

// Strategies are parent-session routing preferences, not global prompts or worker permissions.
func (s *Server) conductorModelStrategy(parentID string, args map[string]interface{}) (string, error) {
	action, _ := args["action"].(string)
	if action != "get" && action != "set" && action != "reset" {
		return "", errors.New("action must be get, set or reset")
	}
	for key, value := range args {
		if strings.HasPrefix(key, "_") {
			continue
		}
		if key != "action" && key != "strategy" {
			return "", errors.New("unknown model strategy field")
		}
		if key == "strategy" && action != "set" && value != nil {
			return "", errors.New("get/reset do not accept strategy values")
		}
	}
	var strategy string
	if action == "set" {
		var ok bool
		strategy, ok = args["strategy"].(string)
		if !ok || !utf8.ValidString(strategy) {
			return "", errors.New("set requires a strategy string")
		}
		strategy = strings.TrimSpace(strategy)
		if strategy == "" || utf8.RuneCountInString(strategy) > conductorMaxModelStrategy {
			return "", errors.New("strategy must contain 1 to 8192 characters; use reset to clear")
		}
	}
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	parent, err := loadChatSession(s.CfgStore.Snapshot(), parentID)
	if err != nil || parent.Conductor == nil || parent.Conductor.Role != conductorRoleParent {
		return "", errors.New("parent required")
	}
	if action == "get" || parent.Conductor.ModelStrategy == strategy {
		return parent.Conductor.ModelStrategy, nil
	}
	parent.Conductor.ModelStrategy = strategy
	if err := saveChatSession(s.CfgStore.Snapshot(), parent); err != nil {
		return "", errors.New("model strategy persistence failed")
	}
	return strategy, nil
}
