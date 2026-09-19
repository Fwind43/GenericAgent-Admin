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
	// get/reset carry no business values: a non-null llm_no is still rejected, while an explicit
	// null (what model-side tool calls emit for nullable fields) now means "omitted".
	for _, raw := range []string{`{"action":"set","llm_no":99}`, `{"action":"set","llm_no":true}`, `{"action":"set","llm_no":1.5}`, `{"action":"set","llm_no":-1}`, `{"action":"set","reasoning_effort":"bogus"}`, `{"action":"set","reasoning_effort":""}`, `{"action":"get","llm_no":3}`, `{"action":"get","reasoning_effort":"high"}`, `{"action":"reset","llm_no":3}`, `{"action":"bogus"}`} {
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

// Core dispatch injects _index/_tool_num into the handler args; the server must ignore those
// transport keys, still reject unknown business fields, and treat explicit nulls on get/reset as
// omitted while keeping set's null-clears semantics.
func TestConductorDefaultsToleratesPrivateKeysAndNulls(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	s.ChatLLMCache = newChatLLMCache()
	s.ChatLLMCache.ttl = time.Hour
	if _, err := s.ChatLLMCache.load(chatLLMKey(cfg), func() ([]map[string]interface{}, error) {
		return []map[string]interface{}{{"index": 7, "model": "fake-model", "provider": "fake"}}, nil
	}); err != nil {
		t.Fatal(err)
	}
	parent := chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}}
	saveChatLoopTestSession(t, s, parent)
	token := s.beginChatRun("parent")
	defer s.endChatRunOwned("parent", token)
	sequence := 0
	brokerCall := func(args map[string]interface{}) (conductorDispatchOptions, error) {
		t.Helper()
		sequence++
		id := fmt.Sprintf("private-%d", sequence)
		broker := chatConductorBrokerDirForSession(chatSessionDir(cfg), "parent")
		s.handleConductorSettingsEvent("parent", map[string]interface{}{"type": "conductor_defaults",
			"request_id": id, "broker_dir": broker, "args": args})
		data, err := os.ReadFile(filepath.Join(broker, id+".response.json"))
		if err != nil {
			t.Fatal(err)
		}
		var reply map[string]interface{}
		if err := json.Unmarshal(data, &reply); err != nil {
			t.Fatal(err)
		}
		var value conductorDispatchOptions
		if reply["ok"] != true {
			return value, fmt.Errorf("%v", reply["error"])
		}
		encoded, _ := json.Marshal(reply["defaults"])
		if err := json.Unmarshal(encoded, &value); err != nil {
			t.Fatal(err)
		}
		return value, nil
	}

	set, err := brokerCall(map[string]interface{}{"action": "set", "llm_no": 7, "reasoning_effort": "low"})
	if err != nil || set.LLMNo == nil || *set.LLMNo != 7 {
		t.Fatalf("set with private-free args: %v %#v", err, set)
	}
	afterSet, _ := os.ReadFile(chatSessionPath(cfg, "parent"))
	withPrivate, err := brokerCall(map[string]interface{}{"action": "get", "_index": 0, "_tool_num": 1})
	if err != nil {
		t.Fatalf("private transport keys must be ignored: %v", err)
	}
	if withPrivate.LLMNo == nil || *withPrivate.LLMNo != 7 || withPrivate.ReasoningEffort == nil ||
		*withPrivate.ReasoningEffort != "low" {
		t.Fatalf("private key read: %#v", withPrivate)
	}
	explicitNulls, err := brokerCall(map[string]interface{}{"action": "get", "llm_no": nil,
		"reasoning_effort": nil, "_index": 3, "_tool_num": 2})
	if err != nil {
		t.Fatalf("nulls on get must behave as omitted: %v", err)
	}
	if explicitNulls.LLMNo == nil || *explicitNulls.LLMNo != 7 ||
		explicitNulls.ReasoningEffort == nil || *explicitNulls.ReasoningEffort != "low" {
		t.Fatalf("null read changed values: %#v", explicitNulls)
	}
	afterNullReads, _ := os.ReadFile(chatSessionPath(cfg, "parent"))
	if string(afterSet) != string(afterNullReads) {
		t.Fatal("private-key or null reads mutated persisted defaults")
	}
	reset, err := brokerCall(map[string]interface{}{"action": "reset", "llm_no": nil, "_index": 0, "_tool_num": 1})
	if err != nil || reset.LLMNo != nil || reset.ReasoningEffort != nil {
		t.Fatalf("reset with nulls: %v %#v", err, reset)
	}
	afterReset, _ := os.ReadFile(chatSessionPath(cfg, "parent"))
	if string(afterReset) == string(afterSet) {
		t.Fatal("reset with nulls plus private keys did not persist a cleared state")
	}
	if _, err := brokerCall(map[string]interface{}{"action": "get", "bogus": 1}); err == nil {
		t.Fatal("unknown business field must still fail")
	}
	// Null tolerance is scoped to the two known nullable fields (llm_no/reasoning_effort): an
	// unknown field is rejected even when its value is null, on every action.
	if _, err := brokerCall(map[string]interface{}{"action": "get", "bogus": nil}); err == nil {
		t.Fatal("unknown field with null value must still fail on get")
	}
	if _, err := brokerCall(map[string]interface{}{"action": "set", "bogus": nil}); err == nil {
		t.Fatal("unknown field with null value must still fail on set")
	}
	// Non-null known fields remain illegal for the value-less actions.
	if _, err := brokerCall(map[string]interface{}{"action": "get", "llm_no": 7}); err == nil {
		t.Fatal("get must not accept llm_no values")
	}
	if _, err := brokerCall(map[string]interface{}{"action": "reset", "reasoning_effort": "low"}); err == nil {
		t.Fatal("reset must not accept reasoning_effort values")
	}
	if _, err := brokerCall(map[string]interface{}{"action": "reset", "llm_no": 7}); err == nil {
		t.Fatal("reset must not accept values")
	}
	afterRejected, _ := os.ReadFile(chatSessionPath(cfg, "parent"))
	if string(afterRejected) != string(afterReset) {
		t.Fatal("rejected request mutated persisted defaults")
	}
	kept, err := brokerCall(map[string]interface{}{"action": "set", "llm_no": 7, "_index": 0, "_tool_num": 1})
	if err != nil || kept.LLMNo == nil || *kept.LLMNo != 7 {
		t.Fatalf("set with private keys: %v %#v", err, kept)
	}
	partial, err := brokerCall(map[string]interface{}{"action": "set", "reasoning_effort": "medium", "_tool_num": 1})
	if err != nil || partial.LLMNo == nil || *partial.LLMNo != 7 || partial.ReasoningEffort == nil || *partial.ReasoningEffort != "medium" {
		t.Fatalf("omitted field must be preserved: %v %#v", err, partial)
	}
	cleared, err := brokerCall(map[string]interface{}{"action": "set", "reasoning_effort": nil, "_index": 0, "_tool_num": 1})
	if err != nil || cleared.LLMNo == nil || *cleared.LLMNo != 7 || cleared.ReasoningEffort != nil {
		t.Fatalf("set null clears while omitted preserves: %v %#v", err, cleared)
	}
	t.Log("private transport keys ignored, unknown fields (incl. null values) rejected, non-null known fields illegal for get/reset, null get/reset tolerated, set omitted preserves and null clears: PASS")
}
