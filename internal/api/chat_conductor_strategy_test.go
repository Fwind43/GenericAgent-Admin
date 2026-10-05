package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConductorModelStrategyLifecycle(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	parent := chatSession{ID: "strategy-parent", Settings: chatSettings{LLMNo: 2, ReasoningEffort: "high"}, Conductor: &chatConductorState{Role: conductorRoleParent}}
	for i := 0; i < conductorMaxRunning; i++ {
		parent.ConductorChildren = append(parent.ConductorChildren, chatConductorChild{DispatchID: fmt.Sprint(i), Status: conductorRunning})
	}
	saveChatLoopTestSession(t, s, parent)
	saveChatLoopTestSession(t, s, chatSession{ID: "strategy-other", Conductor: &chatConductorState{Role: conductorRoleParent}})
	token := s.beginChatRun(parent.ID)
	defer s.endChatRunOwned(parent.ID, token)
	broker := chatConductorBrokerDirForSession(chatSessionDir(cfg), parent.ID)
	sequence := 0
	call := func(args map[string]interface{}) string {
		t.Helper()
		sequence++
		id := fmt.Sprintf("strategy-%d", sequence)
		s.handleConductorSettingsEvent(parent.ID, map[string]interface{}{"type": "conductor_model_strategy", "request_id": id, "broker_dir": broker, "args": args})
		data, err := os.ReadFile(filepath.Join(broker, id+".response.json"))
		if err != nil {
			t.Fatal(err)
		}
		var reply map[string]interface{}
		if err := json.Unmarshal(data, &reply); err != nil || reply["ok"] != true {
			t.Fatalf("broker reply: %s %v", data, err)
		}
		value, ok := reply["strategy"].(string)
		if !ok {
			t.Fatalf("missing strategy: %s", data)
		}
		return value
	}
	if got := call(map[string]interface{}{"action": "get"}); got != "" {
		t.Fatal(got)
	}
	policy := "Lookup: provider-a/model-small; design: provider-b/model-large.\nReview independently; upgrade only when authorized. \"Quoted\" names are not indexes."
	if got := call(map[string]interface{}{"action": "set", "strategy": "  " + policy + "  ", "_index": 0, "_tool_num": 1}); got != policy {
		t.Fatal(got)
	}
	snapshot := func() []byte {
		t.Helper()
		data, err := os.ReadFile(chatSessionPath(cfg, parent.ID))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	before := snapshot()
	if call(map[string]interface{}{"action": "set", "strategy": policy}) != policy || !bytes.Equal(before, snapshot()) {
		t.Fatal("identical set was not persistent-state idempotent")
	}
	if call(map[string]interface{}{"action": "get", "strategy": nil}) != policy || !bytes.Equal(before, snapshot()) {
		t.Fatal("get mutated session")
	}
	other, err := s.conductorModelStrategy("strategy-other", map[string]interface{}{"action": "get"})
	if err != nil || other != "" {
		t.Fatalf("cross-session leak: %q %v", other, err)
	}

	// Reopen from disk with no conversation or working memory; fresh system prompts carry the policy.
	reopened, err := loadChatSession(cfg, parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	req := map[string]interface{}{"extra_sys_prompts": []string{"existing"}}
	if err := s.prepareConductorWorkerRequest(reopened, req); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(policy)
	prompts := strings.Join(req["extra_sys_prompts"].([]string), "\n")
	if !strings.Contains(prompts, "Current session model-selection strategy (JSON string): "+string(encoded)) || !strings.Contains(prompts, "conductor_model_strategy") || !strings.Contains(prompts, "Explicit user choices for a task take precedence") {
		t.Fatalf("missing scoped fresh policy: %s", prompts)
	}
	if len(reopened.Messages) != 0 || len(reopened.Working) != 0 || reopened.Settings != parent.Settings {
		t.Fatal("policy changed parent model/history/working memory")
	}

	// Existing terminal saves must not overwrite a tool update made during the run.
	for _, exact := range []bool{false, true} {
		stale := parent
		stale.Conductor = &chatConductorState{Role: conductorRoleParent, ModelStrategy: "stale"}
		if exact {
			err = s.saveChatSessionExact(stale)
		} else {
			err = s.saveChatSessionMerged(stale)
		}
		if err != nil {
			t.Fatal(err)
		}
		if call(map[string]interface{}{"action": "get"}) != policy {
			t.Fatal("terminal save lost policy")
		}
	}

	// A strategy is not a backend model rewrite; the agent explicitly selects a model.
	selected := 7
	child, err := s.dispatchConductorWithOptions(parent.ID, "isolated queued fixture", conductorDispatchOptions{LLMNo: &selected})
	if err != nil {
		t.Fatal(err)
	}
	worker, err := loadChatSession(cfg, child.SessionID)
	if err != nil || worker.Settings.LLMNo != selected || worker.Conductor.ModelStrategy != "" {
		t.Fatalf("dispatch model/policy scope: %+v %v", worker, err)
	}
	call(map[string]interface{}{"action": "set", "strategy": "New policy for future tasks only"})
	pending, err := loadChatSession(cfg, child.SessionID)
	if err != nil || pending.Settings != worker.Settings {
		t.Fatal("policy changed queued worker")
	}
	workerReq := map[string]interface{}{}
	if err := s.prepareConductorWorkerRequest(worker, workerReq); err != nil {
		t.Fatal(err)
	}
	workerPrompts, _ := workerReq["extra_sys_prompts"].([]string)
	if strings.Contains(strings.Join(workerPrompts, "\n"), "Current session model-selection strategy") {
		t.Fatal("parent policy injected into worker")
	}
	if call(map[string]interface{}{"action": "reset"}) != "" {
		t.Fatal("reset failed")
	}
	empty := snapshot()
	if call(map[string]interface{}{"action": "reset"}) != "" || !bytes.Equal(empty, snapshot()) {
		t.Fatal("reset was not persistent-state idempotent")
	}
	reopened, _ = loadChatSession(cfg, parent.ID)
	req = map[string]interface{}{}
	if err := s.prepareConductorWorkerRequest(reopened, req); err != nil {
		t.Fatal(err)
	}
	prompts = strings.Join(req["extra_sys_prompts"].([]string), "\n")
	if strings.Contains(prompts, policy) || !strings.Contains(prompts, "strategy (JSON string): \"\"") {
		t.Fatal("reset was not reflected in fresh prompt")
	}
}

func TestConductorModelStrategyValidation(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	saveChatLoopTestSession(t, s, chatSession{ID: "strategy-parent", Conductor: &chatConductorState{Role: conductorRoleParent, ModelStrategy: "keep"}})
	saveChatLoopTestSession(t, s, chatSession{ID: "strategy-worker", Conductor: &chatConductorState{Role: conductorRoleWorker}})
	saveChatLoopTestSession(t, s, chatSession{ID: "strategy-normal"})
	before, err := os.ReadFile(chatSessionPath(cfg, "strategy-parent"))
	if err != nil {
		t.Fatal(err)
	}
	for _, args := range []map[string]interface{}{
		{}, {"action": "invent"}, {"action": 1}, {"action": "set"}, {"action": "set", "strategy": nil},
		{"action": "set", "strategy": 7}, {"action": "set", "strategy": " \n\t "},
		{"action": "set", "strategy": strings.Repeat("a", conductorMaxModelStrategy+1)},
		{"action": "set", "strategy": string([]byte{0xff})},
		{"action": "set", "strategy": "change", "unexpected": nil},
		{"action": "get", "strategy": "change"}, {"action": "reset", "strategy": "change"},
		{"action": "get", "llm_no": nil},
	} {
		if _, err := s.conductorModelStrategy("strategy-parent", args); err == nil {
			t.Fatalf("accepted invalid args: %#v", args)
		}
		after, err := os.ReadFile(chatSessionPath(cfg, "strategy-parent"))
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("rejected input mutated persistent state")
		}
	}
	for _, id := range []string{"strategy-worker", "strategy-normal", "missing"} {
		if _, err := s.conductorModelStrategy(id, map[string]interface{}{"action": "set", "strategy": "change"}); err == nil {
			t.Fatalf("non-parent accepted: %s", id)
		}
	}
	// Bound by characters, not UTF-8 bytes; full multilingual policies are preserved.
	unicodePolicy := strings.Repeat("\u6a21", conductorMaxModelStrategy)
	if got, err := s.conductorModelStrategy("strategy-parent", map[string]interface{}{"action": "set", "strategy": unicodePolicy}); err != nil || got != unicodePolicy {
		t.Fatalf("unicode limit: %v", err)
	}
}

func TestConductorModelStrategyBrokerBoundary(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	saveChatLoopTestSession(t, s, chatSession{ID: "strategy-parent", Conductor: &chatConductorState{Role: conductorRoleParent, ModelStrategy: "keep"}})
	broker := chatConductorBrokerDirForSession(chatSessionDir(cfg), "strategy-parent")
	args := map[string]interface{}{"action": "set", "strategy": "change"}
	call := func(id, dir string) {
		s.handleConductorSettingsEvent("strategy-parent", map[string]interface{}{"type": "conductor_model_strategy", "request_id": id, "broker_dir": dir, "args": args})
	}
	call("../escape", broker)
	foreign := t.TempDir()
	call("foreign", foreign)
	if _, err := os.Stat(filepath.Join(foreign, "foreign.response.json")); !os.IsNotExist(err) {
		t.Fatal("foreign broker wrote a response")
	}
	value, err := s.conductorModelStrategy("strategy-parent", map[string]interface{}{"action": "get"})
	if err != nil || value != "keep" {
		t.Fatal("rejected broker mutated strategy")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(broker), "escape.response.json")); !os.IsNotExist(err) {
		t.Fatal("invalid request id escaped broker")
	}
}
