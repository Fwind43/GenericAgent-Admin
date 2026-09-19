package api

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Only public identifiers are exposed; loader diagnostics never cross the broker.
func (s *Server) conductorModels() ([]map[string]interface{}, error) {
	rows, err := s.cachedGARuntimeLLMs(s.CfgStore.Snapshot())
	if err != nil {
		return nil, errors.New("model list unavailable")
	}
	out := []map[string]interface{}{}
	for _, row := range rows {
		n, ok := chatLLMIndex(row["index"])
		if !ok || n < 0 {
			continue
		}
		item := map[string]interface{}{"index": n}
		for _, key := range []string{"model", "provider"} {
			if v, ok := row[key].(string); ok && !strings.ContainsAny(v, ":@?=\\\n\r") && len(v) <= 160 {
				item[key] = v
			}
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *Server) conductorDefaults(parentID string, args map[string]interface{}) (conductorDispatchOptions, error) {
	action, _ := args["action"].(string)
	if action != "get" && action != "set" && action != "reset" {
		return conductorDispatchOptions{}, errors.New("action must be get, set or reset")
	}
	var patch conductorDispatchOptions
	// Core dispatch injects private transport keys (_index/_tool_num) into the same args map
	// before the handler runs; they are framework internals, not business fields. Unknown
	// public fields still fail, and private keys never reach the type check or persistence.
	filtered := make(map[string]interface{}, len(args))
	for key, value := range args {
		if strings.HasPrefix(key, "_") {
			continue
		}
		if key != "action" && key != "llm_no" && key != "reasoning_effort" {
			return patch, errors.New("unknown defaults field")
		}
		filtered[key] = value
	}
	// The exposed schema marks llm_no/reasoning_effort nullable, so read/reset callers may send
	// explicit nulls; for those actions null is the same as omitted. set keeps null as a clear.
	if action != "set" {
		for key, value := range filtered {
			if key != "action" && value == nil {
				delete(filtered, key)
			}
		}
		if len(filtered) != 1 {
			return patch, errors.New("only set accepts fields")
		}
	}
	data, err := json.Marshal(filtered)
	if err != nil {
		return patch, errors.New("invalid defaults")
	}
	if json.Unmarshal(data, &patch) != nil {
		return patch, errors.New("invalid defaults types")
	}
	if _, err = patch.apply(chatSettings{}); err != nil {
		return patch, err
	}
	if patch.LLMNo != nil {
		rows, e := s.conductorModels()
		if e != nil {
			return patch, e
		}
		found := false
		for _, row := range rows {
			if row["index"] == *patch.LLMNo {
				found = true
			}
		}
		if !found {
			return patch, errors.New("llm_no is not available")
		}
	}
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	parent, err := loadChatSession(s.CfgStore.Snapshot(), parentID)
	if err != nil {
		return patch, errors.New("parent unavailable")
	}
	if parent.Conductor == nil || parent.Conductor.Role != conductorRoleParent {
		return patch, errors.New("parent required")
	}
	current := parent.Conductor.Defaults
	if action == "get" {
		return current, nil
	}
	if action == "reset" {
		current = conductorDispatchOptions{}
	} else {
		if _, ok := args["llm_no"]; ok {
			current.LLMNo = patch.LLMNo
		}
		if _, ok := args["reasoning_effort"]; ok {
			current.ReasoningEffort = patch.ReasoningEffort
		}
	}
	parent.Conductor.Defaults = current
	if saveChatSession(s.CfgStore.Snapshot(), parent) != nil {
		return patch, errors.New("defaults persistence failed")
	}
	return current, nil
}

func (s *Server) handleConductorSettingsEvent(parentID string, ev map[string]interface{}) {
	requestID, _ := ev["request_id"].(string)
	broker, _ := ev["broker_dir"].(string)
	expected := chatConductorBrokerDirForSession(chatSessionDir(s.CfgStore.Snapshot()), parentID)
	if requestID == "" || safeChatID(requestID) != requestID || filepath.Clean(broker) != filepath.Clean(expected) {
		return
	}
	if err := os.MkdirAll(expected, 0700); err != nil {
		return
	}
	reply := map[string]interface{}{"ok": false, "request_id": requestID}
	_, err := s.conductorDefaults(parentID, map[string]interface{}{"action": "get"})
	if err == nil {
		if ev["type"] == "conductor_models" {
			reply["models"], err = s.conductorModels()
		} else {
			args, _ := ev["args"].(map[string]interface{})
			reply["defaults"], err = s.conductorDefaults(parentID, args)
		}
	}
	if err != nil {
		reply["error"] = err.Error()
	} else {
		reply["ok"] = true
	}
	data, err := json.Marshal(reply)
	if err != nil {
		return
	}
	_ = writeChatFileAtomic(filepath.Join(expected, requestID+".response.json"), data, 0600)
}
