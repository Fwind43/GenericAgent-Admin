package api

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestConductorDispatchOverrides(t *testing.T) {
	for _, reuse := range []bool{false, true} {
		for _, effort := range []string{"", "off", "none", "minimal", "low", "medium", "high", "xhigh", "max"} {
			t.Run(fmt.Sprintf("reuse=%v/effort=%s", reuse, effort), func(t *testing.T) {
				s := newChatLoopTestServer(t)
				parent := chatSession{ID: "parent", Settings: chatSettings{LLMNo: 2, ReasoningEffort: "low"}, Conductor: &chatConductorState{Role: conductorRoleParent}}
				// Fill running slots to test persistence without launching real workers.
				for i := 0; i < conductorMaxRunning; i++ {
					parent.ConductorChildren = append(parent.ConductorChildren, chatConductorChild{DispatchID: fmt.Sprint(i), Status: conductorRunning})
				}
				ev := map[string]interface{}{"objective": "test", "request_id": "request", "broker_dir": chatConductorBrokerDirForSession(chatSessionDir(s.CfgStore.Snapshot()), "parent")}
				want := parent.Settings
				if reuse {
					parent.ConductorChildren = append(parent.ConductorChildren, chatConductorChild{DispatchID: "old", SessionID: "worker", Status: conductorSucceeded})
					want = chatSettings{LLMNo: 3, ReasoningEffort: "medium"}
					saveChatLoopTestSession(t, s, chatSession{ID: "worker", Settings: want, Title: "preserve", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "parent", DispatchID: "old", Status: conductorSucceeded}})
					ev["session_id"] = "worker"
				}
				if effort != "" {
					ev["llm_no"] = float64(0)
					ev["reasoning_effort"] = effort
					want.LLMNo = 0
					want.ReasoningEffort = effort
				}
				saveChatLoopTestSession(t, s, parent)
				token := s.beginChatRun("parent")
				defer s.endChatRunOwned("parent", token)
				s.handleConductorDispatchEvent("parent", ev)
				data, err := os.ReadFile(filepath.Join(ev["broker_dir"].(string), "request.response.json"))
				if err != nil {
					t.Fatal(err)
				}
				var receipt conductorDispatchResponse
				if err = json.Unmarshal(data, &receipt); err != nil || !receipt.OK {
					t.Fatalf("receipt %s: %v", data, err)
				}
				worker, err := loadChatSession(s.CfgStore.Snapshot(), receipt.SessionID)
				if err != nil {
					t.Fatal(err)
				}
				if worker.Settings != want {
					t.Fatalf("settings %+v want %+v", worker.Settings, want)
				}
				if reuse && (worker.ID != "worker" || worker.Title != "preserve") {
					t.Fatal("reuse lost session")
				}
				after, _ := loadChatSession(s.CfgStore.Snapshot(), "parent")
				if after.Settings != parent.Settings {
					t.Fatal("parent settings changed")
				}
			})
		}
	}
}

func TestConductorDispatchInvalidOverrides(t *testing.T) {
	for _, raw := range []string{`{"llm_no":-1}`, `{"llm_no":1.5}`, `{"llm_no":true}`, `{"llm_no":"1"}`, `{"llm_no":null}`, `{"reasoning_effort":null}`, `{"reasoning_effort":"invalid"}`, `{"reasoning_effort":""}`, `{"reasoning_effort":3}`} {
		t.Run(raw, func(t *testing.T) {
			s := newChatLoopTestServer(t)
			saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}})
			before, _ := os.ReadFile(chatSessionPath(s.CfgStore.Snapshot(), "parent"))
			token := s.beginChatRun("parent")
			defer s.endChatRunOwned("parent", token)
			ev := map[string]interface{}{}
			json.Unmarshal([]byte(raw), &ev)
			dir := chatConductorBrokerDirForSession(chatSessionDir(s.CfgStore.Snapshot()), "parent")
			ev["objective"] = "test"
			ev["request_id"] = "request"
			ev["broker_dir"] = dir
			s.handleConductorDispatchEvent("parent", ev)
			data, err := os.ReadFile(filepath.Join(dir, "request.response.json"))
			if err != nil {
				t.Fatal(err)
			}
			var receipt conductorDispatchResponse
			json.Unmarshal(data, &receipt)
			if receipt.OK || receipt.Error == "" {
				t.Fatalf("accepted invalid options: %s", data)
			}
			after, _ := os.ReadFile(chatSessionPath(s.CfgStore.Snapshot(), "parent"))
			if string(before) != string(after) {
				t.Fatal("invalid request mutated parent")
			}
		})
	}
}
