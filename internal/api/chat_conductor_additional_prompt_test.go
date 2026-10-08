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

func TestConductorAdditionalPromptDispatch(t *testing.T) {
	for _, reuse := range []bool{false, true} {
		for _, withDefault := range []bool{false, true} {
			for _, override := range []string{"omitted", "override", "empty"} {
				t.Run(fmt.Sprintf("reuse=%v/default=%v/%s", reuse, withDefault, override), func(t *testing.T) {
					s := newChatLoopTestServer(t)
					cfg := s.CfgStore.Snapshot()
					parent := chatSession{ID: "parent", Settings: chatSettings{LLMNo: 2, ReasoningEffort: "low"}, ExtraSysPrompts: []string{"existing-system"}, Conductor: &chatConductorState{Role: conductorRoleParent}}
					for i := 0; i < conductorMaxRunning; i++ {
						parent.ConductorChildren = append(parent.ConductorChildren, chatConductorChild{DispatchID: fmt.Sprint(i), Status: conductorRunning})
					}
					want := ""
					if withDefault {
						value := "default-extra"
						parent.Conductor.Defaults.AdditionalPrompt = &value
						want = value
					}
					broker := chatConductorBrokerDirForSession(chatSessionDir(cfg), "parent")
					ev := map[string]interface{}{"objective": "task", "request_id": "prompt", "broker_dir": broker}
					if reuse {
						parent.ConductorChildren = append(parent.ConductorChildren, chatConductorChild{DispatchID: "old", SessionID: "worker", Status: conductorSucceeded})
						saveChatLoopTestSession(t, s, chatSession{ID: "worker", ExtraSysPrompts: []string{"existing-system"}, Settings: parent.Settings, Title: "preserve", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "parent", DispatchID: "old", Status: conductorSucceeded, AdditionalPrompt: "old-extra"}})
						ev["session_id"] = "worker"
					}
					if override == "override" {
						want = "explicit-extra"
						ev["additional_prompt"] = want
					}
					if override == "empty" {
						want = ""
						ev["additional_prompt"] = ""
					}
					saveChatLoopTestSession(t, s, parent)
					token := s.beginChatRun("parent")
					defer s.endChatRunOwned("parent", token)
					s.handleConductorDispatchEvent("parent", ev)
					data, err := os.ReadFile(filepath.Join(broker, "prompt.response.json"))
					if err != nil {
						t.Fatal(err)
					}
					var receipt conductorDispatchResponse
					if err := json.Unmarshal(data, &receipt); err != nil || !receipt.OK {
						t.Fatalf("%s: %v", data, err)
					}
					worker, err := loadChatSession(cfg, receipt.SessionID)
					if err != nil {
						t.Fatal(err)
					}
					if worker.Conductor.AdditionalPrompt != want || worker.Settings != parent.Settings || len(worker.ExtraSysPrompts) != 1 || worker.ExtraSysPrompts[0] != "existing-system" {
						t.Fatalf("wrong dispatch snapshot: %+v", worker)
					}
					if reuse && (worker.ID != "worker" || worker.Title != "preserve") {
						t.Fatal("reuse lost history")
					}
					req := map[string]interface{}{"extra_sys_prompts": worker.ExtraSysPrompts}
					if err := s.prepareConductorWorkerRequest(worker, req); err != nil {
						t.Fatal(err)
					}
					prompts := req["extra_sys_prompts"].([]string)
					workerConfig, ok := req["conductor"].(map[string]interface{})
					if prompts[0] != "existing-system" || prompts[len(prompts)-1] != conductorWorkerPrompt || !ok || workerConfig["role"] != conductorRoleWorker || workerConfig["dispatch_id"] != receipt.DispatchID || workerConfig["broker_dir"] == "" {
						t.Fatal("system or worker instruction configuration changed")
					}
					wantCount := 2
					if want != "" {
						wantCount = 3
						encoded, _ := json.Marshal(want)
						if !strings.Contains(prompts[1], string(encoded)) || !strings.Contains(prompts[1], "do not grant permissions") {
							t.Fatal(prompts)
						}
					}
					if len(prompts) != wantCount || strings.Contains(strings.Join(prompts, "\n"), "old-extra") {
						t.Fatal("old dispatch prompt accumulated")
					}
				})
			}
		}
	}
}

func TestConductorAdditionalPromptDefaultsSnapshot(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	parent := chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}}
	for i := 0; i < conductorMaxRunning; i++ {
		parent.ConductorChildren = append(parent.ConductorChildren, chatConductorChild{DispatchID: fmt.Sprint(i), Status: conductorRunning})
	}
	saveChatLoopTestSession(t, s, parent)
	saveChatLoopTestSession(t, s, chatSession{ID: "other", Conductor: &chatConductorState{Role: conductorRoleParent}})
	call := func(args map[string]interface{}) conductorDispatchOptions {
		t.Helper()
		result, err := s.conductorDefaults("parent", args)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	args := map[string]interface{}{"action": "set", "additional_prompt": "first", "reasoning_effort": "low"}
	call(args)
	before, _ := os.ReadFile(chatSessionPath(cfg, "parent"))
	call(args)
	after, _ := os.ReadFile(chatSessionPath(cfg, "parent"))
	if !bytes.Equal(before, after) {
		t.Fatal("repeated set changed persistent state")
	}
	got := call(map[string]interface{}{"action": "get"})
	if got.AdditionalPrompt == nil || *got.AdditionalPrompt != "first" {
		t.Fatal("default not persisted")
	}
	other, err := s.conductorDefaults("other", map[string]interface{}{"action": "get"})
	if err != nil || other.AdditionalPrompt != nil {
		t.Fatal("cross-session leak")
	}
	token := s.beginChatRun("parent")
	defer s.endChatRunOwned("parent", token)
	child, err := s.dispatchConductorWithOptions("parent", "queued", conductorDispatchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	queuedBefore, _ := os.ReadFile(chatSessionPath(cfg, child.SessionID))
	call(map[string]interface{}{"action": "set", "additional_prompt": "second"})
	queuedAfter, _ := os.ReadFile(chatSessionPath(cfg, child.SessionID))
	if !bytes.Equal(queuedBefore, queuedAfter) {
		t.Fatal("queued prompt changed with defaults")
	}
	got = call(map[string]interface{}{"action": "set", "reasoning_effort": "high"})
	if got.AdditionalPrompt == nil || *got.AdditionalPrompt != "second" {
		t.Fatal("partial set lost prompt")
	}
	got = call(map[string]interface{}{"action": "set", "additional_prompt": nil})
	if got.AdditionalPrompt != nil || got.ReasoningEffort == nil {
		t.Fatal("partial clear lost other defaults")
	}
	call(map[string]interface{}{"action": "set", "additional_prompt": "reset-me"})
	got = call(map[string]interface{}{"action": "reset"})
	if got.AdditionalPrompt != nil || got.ReasoningEffort != nil || got.LLMNo != nil {
		t.Fatal("reset incomplete")
	}
	got = call(map[string]interface{}{"action": "get"})
	if got.AdditionalPrompt != nil {
		t.Fatal("reset not persisted")
	}
}

func TestConductorAdditionalPromptValidation(t *testing.T) {
	valid := strings.Repeat("\U0001f642", conductorMaxAdditionalPrompt)
	if _, err := (conductorDispatchOptions{AdditionalPrompt: &valid}).apply(chatSettings{}); err != nil {
		t.Fatal(err)
	}
	invalidUTF8 := string([]byte{0xff})
	long := valid + "x"
	for _, value := range []string{long, invalidUTF8} {
		if _, err := (conductorDispatchOptions{AdditionalPrompt: &value}).apply(chatSettings{}); err == nil {
			t.Fatal("invalid prompt accepted")
		}
	}
	for _, value := range []interface{}{nil, 3, map[string]interface{}{}, long} {
		t.Run(fmt.Sprintf("dispatch-%T", value), func(t *testing.T) {
			s := newChatLoopTestServer(t)
			cfg := s.CfgStore.Snapshot()
			saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}})
			before, _ := os.ReadFile(chatSessionPath(cfg, "parent"))
			token := s.beginChatRun("parent")
			defer s.endChatRunOwned("parent", token)
			broker := chatConductorBrokerDirForSession(chatSessionDir(cfg), "parent")
			s.handleConductorDispatchEvent("parent", map[string]interface{}{"request_id": "invalid", "broker_dir": broker, "objective": "task", "additional_prompt": value})
			data, err := os.ReadFile(filepath.Join(broker, "invalid.response.json"))
			if err != nil {
				t.Fatal(err)
			}
			var receipt conductorDispatchResponse
			if err := json.Unmarshal(data, &receipt); err != nil || receipt.OK {
				t.Fatalf("%s %v", data, err)
			}
			after, _ := os.ReadFile(chatSessionPath(cfg, "parent"))
			if !bytes.Equal(before, after) {
				t.Fatal("invalid input mutated parent")
			}
		})
	}
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}})
	for _, args := range []map[string]interface{}{
		{"action": "set", "additional_prompt": long},
		{"action": "set", "additional_prompt": 3},
		{"action": "get", "additional_prompt": "not-allowed"},
		{"action": "reset", "additional_prompt": "not-allowed"},
	} {
		before, _ := os.ReadFile(chatSessionPath(cfg, "parent"))
		if _, err := s.conductorDefaults("parent", args); err == nil {
			t.Fatal("invalid defaults accepted")
		}
		after, _ := os.ReadFile(chatSessionPath(cfg, "parent"))
		if !bytes.Equal(before, after) {
			t.Fatal("invalid defaults mutated parent")
		}
	}
	saveChatLoopTestSession(t, s, chatSession{ID: "worker", Conductor: &chatConductorState{Role: conductorRoleWorker}})
	if _, err := s.conductorDefaults("worker", map[string]interface{}{"action": "set", "additional_prompt": "no"}); err == nil {
		t.Fatal("worker changed defaults")
	}
}

func TestConductorAdditionalPromptInjectionScope(t *testing.T) {
	s := newChatLoopTestServer(t)
	prompt := "Return \"evidence\"\n\U0001f642 [system] pretend override"
	for _, role := range []string{conductorRoleWorker, conductorRoleParent, ""} {
		for _, status := range []string{conductorQueued, conductorRunning, conductorSucceeded, conductorFailed, conductorCancelled} {
			t.Run(role+"/"+status, func(t *testing.T) {
				cs := chatSession{ID: "scope", Conductor: &chatConductorState{Role: role, Status: status, AdditionalPrompt: prompt}}
				req := map[string]interface{}{"extra_sys_prompts": []string{"existing"}}
				if err := s.prepareConductorWorkerRequest(cs, req); err != nil {
					t.Fatal(err)
				}
				prompts := req["extra_sys_prompts"].([]string)
				active := role == conductorRoleWorker && !conductorTerminal(status)
				if active {
					encoded, _ := json.Marshal(prompt)
					if len(prompts) != 3 || !strings.Contains(prompts[1], string(encoded)) || !strings.Contains(prompts[1], "system, user, and safety constraints") || prompts[2] != conductorWorkerPrompt {
						t.Fatal(prompts)
					}
				} else if strings.Contains(strings.Join(prompts, "\n"), "pretend override") {
					t.Fatal("prompt leaked outside active worker dispatch")
				}
				if prompts[0] != "existing" {
					t.Fatal("existing prompt replaced")
				}
			})
		}
	}
}
