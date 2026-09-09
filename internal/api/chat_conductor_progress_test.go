package api

import (
	"encoding/json"
	"genericagent-admin-go/internal/config"
	"io"
	"testing"
)

func TestConductorProgressDoesNotFinishWorker(t *testing.T) {
	s := newChatLoopTestServer(t)
	token := s.beginChatRun("parent")
	defer s.endChatRunOwned("parent", token)
	saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "dispatch", SessionID: "worker", Status: conductorRunning}}})
	cs := chatSession{ID: "worker", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "parent", DispatchID: "dispatch", Status: conductorRunning}, Messages: []chatMessage{{ID: "pending", Role: "assistant"}}}
	saveChatLoopTestSession(t, s, cs)
	old := startChatWorkerFunc
	defer func() { startChatWorkerFunc = old }()
	startChatWorkerFunc = func(config.AppConfig, string) (*chatWorker, error) {
		inR, inW := io.Pipe()
		outR, outW := io.Pipe()
		go func() {
			defer inR.Close()
			defer outW.Close()
			var req map[string]interface{}
			_ = json.NewDecoder(inR).Decode(&req)
			enc := json.NewEncoder(outW)
			_ = enc.Encode(map[string]interface{}{"type": "delta", "delta": "working", "working": map[string]interface{}{"phase": "running"}})
			_ = enc.Encode(map[string]interface{}{"type": "done", "message": map[string]interface{}{"role": "assistant", "content": "verified result"}})
		}()
		return &chatWorker{SID: "worker", Stdin: inW, Stdout: outR}, nil
	}
	s.runChatWorker("worker", cs, map[string]interface{}{"op": "chat", "_ga_pending_assistant_id": "pending"})
	parent, err := loadChatSession(s.CfgStore.Snapshot(), "parent")
	if err != nil {
		t.Fatal(err)
	}
	child := parent.ConductorChildren[0]
	if child.Status != conductorSucceeded || child.Result != "verified result" {
		t.Fatalf("progress prematurely finalized worker: %+v", child)
	}
	if len(parent.QueuedMessages) != 1 {
		t.Fatalf("expected one terminal event: %+v", parent.QueuedMessages)
	}
}
