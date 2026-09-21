package api

import (
	"fmt"
	"math/rand"
	"testing"
)

// Compare against the original relationship scan, including duplicate IDs,
// equal timestamps and out-of-order history. Missing workers are intentional.
func TestConductorRecoveryIndexMatchesHistoricalScan(t *testing.T) {
	s := newChatLoopTestServer(t)
	rng := rand.New(rand.NewSource(42))
	for trial := 0; trial < 100; trial++ {
		parent := chatSession{ID: "index-parent"}
		for i := 0; i < 100; i++ {
			parent.ConductorChildren = append(parent.ConductorChildren, chatConductorChild{
				SessionID:  fmt.Sprintf("missing-%d", rng.Intn(10)),
				DispatchID: fmt.Sprintf("dispatch-%d", rng.Intn(8)),
				CreatedAt:  int64(1 + rng.Intn(5)),
				Status:     conductorSucceeded,
			})
		}
		view := s.conductorRecoveryView(parent)
		for i, child := range parent.ConductorChildren {
			want := "pending_confirmation"
			for _, other := range parent.ConductorChildren {
				if other.SessionID == child.SessionID && other.DispatchID != child.DispatchID && other.CreatedAt >= child.CreatedAt {
					want = ""
					break
				}
			}
			if view.ConductorChildren[i].Recovery != want {
				t.Fatalf("trial %d child %d: got %q want %q", trial, i, view.ConductorChildren[i].Recovery, want)
			}
			if child.Recovery != "" {
				t.Fatal("input mutated")
			}
		}
	}
}

func TestConductorRecoveryReaderRequestScope(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	child := chatConductorChild{SessionID: "reader-worker", DispatchID: "dispatch", Status: conductorSucceeded}
	parent := chatSession{ID: "reader-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{child}}
	worker := chatSession{ID: child.SessionID, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: parent.ID, DispatchID: child.DispatchID, Status: child.Status}}
	if err := saveChatSession(cfg, parent); err != nil {
		t.Fatal(err)
	}
	if err := saveChatSession(cfg, worker); err != nil {
		t.Fatal(err)
	}
	reader := s.conductorRecoveryReader()
	if got := reader(worker); got.Conductor.Recovery != "" {
		t.Fatal("valid relationship rejected")
	}
	parent.ConductorChildren = nil
	if err := saveChatSession(cfg, parent); err != nil {
		t.Fatal(err)
	}
	if got := reader(worker); got.Conductor.Recovery != "" {
		t.Fatal("request snapshot not reused")
	}
	if got := s.conductorRecoveryReader()(worker); got.Conductor.Recovery != "pending_confirmation" {
		t.Fatal("new request retained stale relationship")
	}
	if worker.Conductor.Recovery != "" {
		t.Fatal("input mutated")
	}
}
