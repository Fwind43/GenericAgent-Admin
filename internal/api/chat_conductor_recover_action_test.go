package api

import (
	"bytes"
	"os"
	"testing"
)

func TestConductorExplicitRecovery(t *testing.T) {
	for _, status := range []string{conductorQueued, conductorRunning, "cancelling"} {
		t.Run(status, func(t *testing.T) {
			s := newChatLoopTestServer(t)
			child := chatConductorChild{SessionID: "recover-worker", DispatchID: "recover-dispatch", Status: status}
			parent := chatSession{ID: "recover-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{child}}
			worker := chatSession{ID: child.SessionID, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: parent.ID, DispatchID: child.DispatchID, Status: status}}
			saveChatLoopTestSession(t, s, parent)
			saveChatLoopTestSession(t, s, worker)
			read := func(id string) []byte {
				t.Helper()
				b, e := os.ReadFile(chatSessionPath(s.CfgStore.Snapshot(), id))
				if e != nil {
					t.Fatal(e)
				}
				return b
			}
			before := read(parent.ID)
			if _, e := s.recoverConductorChild(parent.ID, child.DispatchID, false); e == nil {
				t.Fatal("missing confirmation accepted")
			}
			if !bytes.Equal(before, read(parent.ID)) {
				t.Fatal("rejected recovery wrote parent")
			}
			got, e := s.recoverConductorChild(parent.ID, child.DispatchID, true)
			if e != nil {
				t.Fatal(e)
			}
			if got.Status != conductorFailed {
				t.Fatalf("status: %s", got.Status)
			}
			saved, e := loadChatSession(s.CfgStore.Snapshot(), parent.ID)
			if e != nil {
				t.Fatal(e)
			}
			if len(saved.QueuedMessages) != 1 {
				t.Fatal("missing durable notification")
			}
			pb, wb := read(parent.ID), read(worker.ID)
			if _, e = s.recoverConductorChild(parent.ID, child.DispatchID, true); e != nil {
				t.Fatal(e)
			}
			if !bytes.Equal(pb, read(parent.ID)) || !bytes.Equal(wb, read(worker.ID)) {
				t.Fatal("duplicate recovery changed disk")
			}
		})
	}
}

func TestConductorRecoveryRejectsActiveWorker(t *testing.T) {
	s := newChatLoopTestServer(t)
	child := chatConductorChild{SessionID: "active-worker", DispatchID: "active-dispatch", Status: conductorRunning}
	parent := chatSession{ID: "active-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{child}}
	saveChatLoopTestSession(t, s, parent)
	s.beginChatRun(child.SessionID)
	if _, err := s.recoverConductorChild(parent.ID, child.DispatchID, true); err == nil {
		t.Fatal("active worker accepted")
	}
}

func TestConductorRecoveryPreservesSavedOutcome(t *testing.T) {
	s := newChatLoopTestServer(t)
	child := chatConductorChild{SessionID: "saved-worker", DispatchID: "saved-dispatch", Status: conductorRunning}
	parent := chatSession{ID: "saved-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{child}}
	worker := chatSession{ID: child.SessionID, Messages: []chatMessage{{Role: "assistant", Content: "saved result"}}, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: parent.ID, DispatchID: child.DispatchID, Status: conductorSucceeded, FinishedAt: 123}}
	saveChatLoopTestSession(t, s, parent)
	saveChatLoopTestSession(t, s, worker)
	got, err := s.recoverConductorChild(parent.ID, child.DispatchID, true)
	if err != nil || got.Status != conductorSucceeded || got.Result != "saved result" || got.FinishedAt != 123 {
		t.Fatalf("outcome overwritten: %+v %v", got, err)
	}
}
