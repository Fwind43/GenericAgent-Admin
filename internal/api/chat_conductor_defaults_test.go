package api

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestConductorDefaultsLifecycle(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	s.ChatLLMCache = newChatLLMCache()
	s.ChatLLMCache.ttl = time.Hour
	_, err := s.ChatLLMCache.load(chatLLMKey(cfg), func() ([]map[string]interface{}, error) {
		return []map[string]interface{}{{"index": 7, "model": "fake-model", "provider": "fake", "api_key": "SECRET", "base_url": "https://private", "name": "SECRET"}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	parent := chatSession{ID: "parent", Settings: chatSettings{LLMNo: 2, ReasoningEffort: "high"}, Conductor: &chatConductorState{Role: conductorRoleParent}}
	for i := 0; i < conductorMaxRunning; i++ {
		parent.ConductorChildren = append(parent.ConductorChildren, chatConductorChild{DispatchID: fmt.Sprint(i), Status: conductorRunning})
	}
	saveChatLoopTestSession(t, s, parent)
	saveChatLoopTestSession(t, s, chatSession{ID: "other", Conductor: &chatConductorState{Role: conductorRoleParent}})
	token := s.beginChatRun("parent")
	defer s.endChatRunOwned("parent", token)
	sequence := 0
	brokerCall := func(kind string, args map[string]interface{}) map[string]interface{} {
		t.Helper()
		sequence++
		id := fmt.Sprintf("settings-%d", sequence)
		broker := chatConductorBrokerDirForSession(chatSessionDir(cfg), "parent")
		s.handleConductorSettingsEvent("parent", map[string]interface{}{"type": kind, "request_id": id, "broker_dir": broker, "args": args})
		data, err := os.ReadFile(filepath.Join(broker, id+".response.json"))
		if err != nil {
			t.Fatal(err)
		}
		var reply map[string]interface{}
		if err := json.Unmarshal(data, &reply); err != nil {
			t.Fatal(err)
		}
		if reply["request_id"] != id {
			t.Fatal("uncorrelated receipt", reply)
		}
		return reply
	}
	defaults := func(args map[string]interface{}) (conductorDispatchOptions, error) {
		reply := brokerCall("conductor_defaults", args)
		var value conductorDispatchOptions
		if reply["ok"] != true {
			return value, fmt.Errorf("%v", reply["error"])
		}
		data, _ := json.Marshal(reply["defaults"])
		err := json.Unmarshal(data, &value)
		return value, err
	}
	call := func(args map[string]interface{}) conductorDispatchOptions {
		t.Helper()
		v, e := defaults(args)
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	call(map[string]interface{}{"action": "set", "llm_no": 7, "reasoning_effort": "low"})
	after, _ := loadChatSession(cfg, "parent")
	if after.Settings != parent.Settings || *after.Conductor.Defaults.LLMNo != 7 {
		t.Fatal("persistence/parent model")
	}
	other, e := s.conductorDefaults("other", map[string]interface{}{"action": "get"})
	if e != nil || other.LLMNo != nil {
		t.Fatal("isolation")
	}
	reply := brokerCall("conductor_models", map[string]interface{}{})
	rows, ok := reply["models"].([]interface{})
	if reply["ok"] != true || !ok {
		t.Fatal(reply)
	}
	blob, _ := json.Marshal(rows)
	if e != nil || strings.Contains(string(blob), "SECRET") || strings.Contains(string(blob), "private") || len(rows) != 1 {
		t.Fatalf("projection %s %v", blob, e)
	}
	before, _ := os.ReadFile(chatSessionPath(cfg, "parent"))
	for _, raw := range []string{`{"action":"set","llm_no":99}`, `{"action":"set","llm_no":true}`, `{"action":"set","llm_no":1.5}`, `{"action":"set","llm_no":-1}`, `{"action":"set","reasoning_effort":"bogus"}`, `{"action":"set","reasoning_effort":""}`, `{"action":"get","llm_no":null}`, `{"action":"bogus"}`} {
		var a map[string]interface{}
		json.Unmarshal([]byte(raw), &a)
		if _, e = defaults(a); e == nil {
			t.Fatal(raw)
		}
	}
	unchanged, _ := os.ReadFile(chatSessionPath(cfg, "parent"))
	if string(before) != string(unchanged) {
		t.Fatal("invalid mutation")
	}
	child, e := s.dispatchConductorWithOptions("parent", "fake queued", conductorDispatchOptions{})
	if e != nil {
		t.Fatal(e)
	}
	worker, _ := loadChatSession(cfg, child.SessionID)
	if worker.Settings.LLMNo != 7 || worker.Settings.ReasoningEffort != "low" {
		t.Fatal("default precedence")
	}
	call(map[string]interface{}{"action": "set", "reasoning_effort": "medium"})
	pending, _ := loadChatSession(cfg, child.SessionID)
	if pending.Settings != worker.Settings {
		t.Fatal("queued changed")
	}
	x := 0
	explicit, e := s.dispatchConductorWithOptions("parent", "explicit", conductorDispatchOptions{LLMNo: &x})
	if e != nil {
		t.Fatal(e)
	}
	w, _ := loadChatSession(cfg, explicit.SessionID)
	if w.Settings.LLMNo != 0 || w.Settings.ReasoningEffort != "medium" {
		t.Fatal("explicit precedence")
	}
	// Mark only the isolated fixture terminal to exercise reuse without a real run.
	p, _ := loadChatSession(cfg, "parent")
	for i := range p.ConductorChildren {
		if p.ConductorChildren[i].DispatchID == child.DispatchID {
			p.ConductorChildren[i].Status = conductorSucceeded
		}
	}
	saveChatLoopTestSession(t, s, p)
	worker.Conductor.Status = conductorSucceeded
	saveChatLoopTestSession(t, s, worker)
	reused, e := s.dispatchConductorWithOptions("parent", "reuse", conductorDispatchOptions{SessionID: child.SessionID})
	if e != nil {
		t.Fatal(e)
	}
	w, _ = loadChatSession(cfg, reused.SessionID)
	if w.Settings.LLMNo != 7 || w.Settings.ReasoningEffort != "medium" {
		t.Fatal("reuse default")
	}
	cleared := call(map[string]interface{}{"action": "set", "llm_no": nil})
	if cleared.LLMNo != nil || cleared.ReasoningEffort == nil {
		t.Fatal("partial clear")
	}
	reset := call(map[string]interface{}{"action": "reset"})
	if reset.LLMNo != nil || reset.ReasoningEffort != nil {
		t.Fatal("reset")
	}
	reset = call(map[string]interface{}{"action": "get"})
	if reset.LLMNo != nil {
		t.Fatal("reset persistence")
	}
	t.Log("persistence, isolation, invalid input, priority, reuse, queued immutability, reset, redaction: PASS")
}
