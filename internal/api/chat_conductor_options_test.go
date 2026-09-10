package api

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
	for _, raw := range []string{`{"project_id":null}`, `{"project_id":3}`, `{"project_id":""}`, `{"project_id":"../escape"}`, `{"project_id":"missing"}`, `{"project_id":"target","session_id":"worker"}`, `{"llm_no":-1}`, `{"llm_no":1.5}`, `{"llm_no":true}`, `{"llm_no":"1"}`, `{"llm_no":null}`, `{"reasoning_effort":null}`, `{"reasoning_effort":"invalid"}`, `{"reasoning_effort":""}`, `{"reasoning_effort":3}`} {
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
			if raw == `{"project_id":"missing"}` {
				for _, hint := range []string{"no worker created", "Omit project_id", "exact project ID", "provider"} {
					if !strings.Contains(receipt.Error, hint) { t.Fatalf("missing hint %q: %s", hint, data) }
				}
			}
			if receipt.DispatchID != "" || receipt.SessionID != "" { t.Fatalf("invalid request allocated worker: %s", data) }
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

func TestConductorDispatchProject(t *testing.T) {
	for _, explicit := range []bool{false, true} {
		t.Run(fmt.Sprint(explicit), func(t *testing.T) {
			s := newChatLoopTestServer(t)
			cfg := s.CfgStore.Snapshot()
			if _, _, err := ensureAdminProject(cfg, "target"); err != nil {
				t.Fatal(err)
			}
			parent := chatSession{ID: "parent", Workspace: "parent-code", ProjectID: "source", ProjectProvider: "admin", Conductor: &chatConductorState{Role: conductorRoleParent}}
			for i := 0; i < conductorMaxRunning; i++ {
				parent.ConductorChildren = append(parent.ConductorChildren, chatConductorChild{DispatchID: fmt.Sprint(i), Status: conductorRunning})
			}
			saveChatLoopTestSession(t, s, parent)
			token := s.beginChatRun("parent")
			defer s.endChatRunOwned("parent", token)
			dir := chatConductorBrokerDirForSession(chatSessionDir(cfg), "parent")
			ev := map[string]interface{}{"objective": "test", "request_id": "project", "broker_dir": dir}
			if explicit {
				ev["project_id"] = "target"
			}
			s.handleConductorDispatchEvent("parent", ev)
			data, err := os.ReadFile(filepath.Join(dir, "project.response.json"))
			if err != nil {
				t.Fatal(err)
			}
			var receipt conductorDispatchResponse
			if err = json.Unmarshal(data, &receipt); err != nil || !receipt.OK {
				t.Fatalf("%s: %v", data, err)
			}
			worker, err := loadChatSession(cfg, receipt.SessionID)
			if err != nil {
				t.Fatal(err)
			}
			if explicit {
				if worker.ProjectID != "target" || worker.Workspace != "" {
					t.Fatalf("bad binding: %+v", worker)
				}
				fields := projectRequestFields(worker, cfg)
				if fields["project_id"] != "target" {
					t.Fatal(fields)
				}
				provider := "official"
				if cfg.DefaultProjectProvider == "admin" {
					provider = "admin"
				}
				if worker.ProjectProvider != provider || (provider == "official" && worker.ProjectMode != "target") || (provider == "admin" && worker.ProjectMode != "") {
					t.Fatalf("bad mode: %+v", worker)
				}
			} else if worker.ProjectID != parent.ProjectID || worker.Workspace != parent.Workspace || worker.ProjectProvider != parent.ProjectProvider {
				t.Fatal("inheritance changed")
			}
			after, _ := loadChatSession(cfg, "parent")
			if after.ProjectID != parent.ProjectID || after.Workspace != parent.Workspace {
				t.Fatal("parent changed")
			}
		})
	}
}
