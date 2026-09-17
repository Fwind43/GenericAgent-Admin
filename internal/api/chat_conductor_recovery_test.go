package api

import (
	"bytes"
	"os"
	"testing"
)

func TestConductorRecoveryReadOnlyAndSchedulerGuard(t *testing.T) {
	for _, status := range []string{conductorQueued, conductorRunning, "cancelling"} {
		t.Run(status, func(t *testing.T) {
			s := newChatLoopTestServer(t)
			child := chatConductorChild{SessionID: "recovery-worker", DispatchID: "dispatch-1", Status: status}
			parent := chatSession{ID: "recovery-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{child}}
			worker := chatSession{ID: child.SessionID, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: parent.ID, DispatchID: child.DispatchID, Status: status}}
			saveChatLoopTestSession(t, s, parent)
			saveChatLoopTestSession(t, s, worker)
			cfg := s.CfgStore.Snapshot()
			read := func(id string) []byte {
				t.Helper()
				b, err := os.ReadFile(chatSessionPath(cfg, id))
				if err != nil {
					t.Fatal(err)
				}
				return b
			}
			beforeParent, beforeWorker := read(parent.ID), read(worker.ID)
			for i := 0; i < 2; i++ {
				pv, wv := s.conductorRecoveryView(parent), s.conductorRecoveryView(worker)
				if pv.ConductorChildren[0].Recovery != "pending_confirmation" || wv.Conductor.Recovery != "pending_confirmation" {
					t.Fatalf("missing recovery: %+v %+v", pv.ConductorChildren, wv.Conductor)
				}
				if pv.ConductorChildren[0].Status != status || wv.Conductor.Status != status {
					t.Fatal("persisted status replaced")
				}
				if parent.ConductorChildren[0].Recovery != "" || worker.Conductor.Recovery != "" {
					t.Fatal("projection mutated input")
				}
				s.scheduleConductorChildren(parent.ID)
				if !bytes.Equal(beforeParent, read(parent.ID)) || !bytes.Equal(beforeWorker, read(worker.ID)) {
					t.Fatal("read or scheduling rewrote unknown ownership")
				}
				if s.chatRunActive(worker.ID) {
					t.Fatal("unknown worker replayed")
				}
			}
			s.SessionMu.Lock()
			s.ChatRuntime.conductorOwned = map[string]bool{conductorOwnershipKey(parent.ID, worker.ID, child.DispatchID): true}
			s.SessionMu.Unlock()
			if status == conductorQueued {
				if got := s.conductorRecoveryView(worker).Conductor.Recovery; got != "" {
					t.Fatalf("owned queued worker: %s", got)
				}
			} else {
				if got := s.conductorRecoveryView(worker).Conductor.Recovery; got != "pending_confirmation" {
					t.Fatalf("missing runtime: %s", got)
				}
				s.beginChatRun(worker.ID)
				if got := s.conductorRecoveryView(worker).Conductor.Recovery; got != "" {
					t.Fatalf("owned active worker: %s", got)
				}
			}
		})
	}
}

func TestConductorRecoveryBrokenRelationships(t *testing.T) {
	for _, kind := range []string{"missing_worker", "missing_parent", "wrong_dispatch", "wrong_parent", "wrong_status", "wrong_role"} {
		t.Run(kind, func(t *testing.T) {
			s := newChatLoopTestServer(t)
			child := chatConductorChild{SessionID: "broken-worker", DispatchID: "d1", Status: conductorQueued}
			parent := chatSession{ID: "broken-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{child}}
			worker := chatSession{ID: child.SessionID, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: parent.ID, DispatchID: child.DispatchID, Status: child.Status}}
			switch kind {
			case "wrong_dispatch":
				worker.Conductor.DispatchID = "other"
			case "wrong_parent":
				worker.Conductor.ParentSessionID = "other"
			case "wrong_status":
				worker.Conductor.Status = conductorRunning
			case "wrong_role":
				worker.Conductor.Role = conductorRoleParent
			}
			if kind != "missing_parent" {
				saveChatLoopTestSession(t, s, parent)
			}
			if kind != "missing_worker" {
				saveChatLoopTestSession(t, s, worker)
			}
			s.ChatRuntime.conductorOwned = map[string]bool{conductorOwnershipKey(parent.ID, worker.ID, child.DispatchID): true}
			if kind == "missing_parent" {
				if s.conductorRecoveryView(worker).Conductor.Recovery != "pending_confirmation" {
					t.Fatal("orphan unmarked")
				}
			} else {
				if s.conductorRecoveryView(parent).ConductorChildren[0].Recovery != "pending_confirmation" {
					t.Fatal("broken child unmarked")
				}
				before, err := os.ReadFile(chatSessionPath(s.CfgStore.Snapshot(), parent.ID))
				if err != nil {
					t.Fatal(err)
				}
				s.scheduleConductorChildren(parent.ID)
				after, err := os.ReadFile(chatSessionPath(s.CfgStore.Snapshot(), parent.ID))
				if err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(before, after) {
					t.Fatal("broken relationship rewritten")
				}
			}
		})
	}
}

func TestConductorRecoveryPreservesReusedTerminalDispatch(t *testing.T) {
	s := newChatLoopTestServer(t)
	parent := chatSession{ID: "reuse-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{
		{SessionID: "reuse-worker", DispatchID: "old", Status: conductorSucceeded, CreatedAt: 1},
		{SessionID: "reuse-worker", DispatchID: "new", Status: conductorQueued, CreatedAt: 2},
	}}
	saveChatLoopTestSession(t, s, parent)
	saveChatLoopTestSession(t, s, chatSession{ID: "reuse-worker", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: parent.ID, DispatchID: "new", Status: conductorQueued}})
	view := s.conductorRecoveryView(parent)
	if view.ConductorChildren[0].Recovery != "" || view.ConductorChildren[1].Recovery != "pending_confirmation" {
		t.Fatalf("incorrect reused worker view: %+v", view.ConductorChildren)
	}
}
