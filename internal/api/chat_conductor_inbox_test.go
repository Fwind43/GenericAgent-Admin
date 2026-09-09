package api

import (
	"bytes"
	"os"
	"testing"
)

func TestConductorCompletionInboxReplay(t *testing.T) {
	s := newChatLoopTestServer(t)
	token := s.beginChatRun("parent")
	if token == nil {
		t.Fatal("reserve")
	}
	defer s.endChatRunOwned("parent", token)
	saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "dispatch", SessionID: "worker", Status: conductorRunning}}})
	saveChatLoopTestSession(t, s, chatSession{ID: "worker", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "parent", DispatchID: "dispatch", Status: conductorRunning}})
	s.finishConductorChild("parent", "dispatch", conductorSucceeded, "verified", "")
	cs, err := loadChatSession(s.CfgStore.Snapshot(), "parent")
	if err != nil {
		t.Fatal(err)
	}
	if len(cs.QueuedMessages) != 1 || cs.QueuedMessages[0].ID != "conductor-dispatch" {
		t.Fatalf("missing inbox: %+v", cs.QueuedMessages)
	}
	path := chatSessionPath(s.CfgStore.Snapshot(), "parent")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s.finishConductorChild("parent", "dispatch", conductorSucceeded, "duplicate", "")
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("duplicate completion changed persisted inbox")
	}
}
