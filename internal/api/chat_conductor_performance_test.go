package api

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestConductorRecoveryFiftyWorkersUsesSummaryCache(t *testing.T) {
	s := newChatLoopTestServer(t)
	parent := chatSession{ID: "large-parent", Conductor: &chatConductorState{Role: conductorRoleParent}}
	for i := 0; i < 50; i++ {
		child := chatConductorChild{SessionID: fmt.Sprintf("large-worker-%d", i), DispatchID: fmt.Sprintf("d-%d", i), Status: conductorSucceeded}
		parent.ConductorChildren = append(parent.ConductorChildren, child)
		worker := chatSession{ID: child.SessionID, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: parent.ID, DispatchID: child.DispatchID, Status: child.Status}, Messages: []chatMessage{{ID: "result", Role: "assistant", Content: strings.Repeat("history ", 32768)}}}
		saveChatLoopTestSession(t, s, worker)
	}
	saveChatLoopTestSession(t, s, parent)
	loads := 0
	s.ChatRuntime.sessionListLoadHook = func(string) { loads++ }
	check := func() {
		t.Helper()
		view := s.conductorRecoveryView(parent)
		for _, child := range view.ConductorChildren {
			if child.Recovery != "" {
				t.Fatalf("unexpected recovery: %+v", child)
			}
		}
	}
	start := time.Now()
	check()
	cold := time.Since(start)
	if loads != 50 {
		t.Fatalf("cold loads = %d, want 50", loads)
	}
	loads = 0
	start = time.Now()
	for i := 0; i < 10; i++ {
		check()
	}
	t.Logf("50 workers, 12.5 MiB history: cold=%s, warm average=%s", cold, time.Since(start)/10)
	if loads != 0 {
		t.Fatalf("unchanged workers decoded %d times", loads)
	}
	cfg := s.CfgStore.Snapshot()
	changed := parent.ConductorChildren[0]
	worker, err := loadChatSession(cfg, changed.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	worker.Conductor.Status = conductorFailed
	saveChatLoopTestSession(t, s, worker)
	view := s.conductorRecoveryView(parent)
	if loads != 1 || view.ConductorChildren[0].Recovery != "pending_confirmation" {
		t.Fatalf("changed worker not revalidated: loads=%d view=%+v", loads, view.ConductorChildren[0])
	}
	if err := os.Remove(chatSessionPath(cfg, parent.ConductorChildren[1].SessionID)); err != nil {
		t.Fatal(err)
	}
	view = s.conductorRecoveryView(parent)
	if view.ConductorChildren[1].Recovery != "pending_confirmation" {
		t.Fatal("deleted worker accepted from cache")
	}
	if parent.ConductorChildren[0].Recovery != "" {
		t.Fatal("input mutated")
	}
}
