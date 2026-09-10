package api

import (
	"bytes"
	"errors"
	"os"
	"testing"
)

func TestConductorReadReceipt(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	cfg := s.CfgStore.Snapshot()
	w := chatSession{ID: "w", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "p", DispatchID: "d", Status: conductorSucceeded}, Messages: []chatMessage{{ID: "a", Role: "assistant", Content: "answer"}}}
	receipt := latestChatSessionResult(w)
	p := chatSession{ID: "p", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "d", SessionID: "w", Status: conductorSucceeded, ResultReceipt: receipt, Review: &conductorReview{Status: "pending"}}}}
	save := func() {
		t.Helper()
		if err := saveChatSessionLocked(cfg, w); err != nil {
			t.Fatal(err)
		}
		if err := saveChatSessionLocked(cfg, p); err != nil {
			t.Fatal(err)
		}
	}
	save()
	// A queued notification alone must not acknowledge consumption.
	p.QueuedMessages = []chatQueuedMessage{{ID: "conductor-d", Kind: "conductor_completion", Text: "result"}}
	save()
	if err := saveChatReadState(cfg, map[string]chatSessionResult{}); err != nil {
		t.Fatal(err)
	}
	stateBefore, err := loadChatReadState(cfg)
	if err != nil || len(stateBefore) != 0 {
		t.Fatal("queue acknowledged result", stateBefore, err)
	}
	ack := map[string]interface{}{"dispatch_id": "d", "session_id": "w", "result_receipt": receipt}
	check := func() {
		t.Helper()
		if err := s.handleConductorReadEvent("p", ack); err != nil {
			t.Fatal(err)
		}
	}
	// Exhaustion fails closed, then the exact same receipt can be replayed.
	s.ChatMu.Lock()
	busyErr := s.confirmConductorRead("p", ack)
	s.ChatMu.Unlock()
	if !errors.Is(busyErr, errConductorReadBusy) {
		t.Fatal(busyErr)
	}
	stillUnread, err := loadChatReadState(cfg)
	if err != nil || len(stillUnread) != 0 {
		t.Fatal("busy acknowledged", stillUnread, err)
	}
	if err := s.confirmConductorRead("p", ack); err != nil {
		t.Fatal(err)
	}
	state, err := loadChatReadState(cfg)
	if err != nil || state["w"] != *receipt {
		t.Fatal(state, err)
	}
	before, _ := os.ReadFile(chatReadPath(cfg))
	info, _ := os.Stat(chatReadPath(cfg))
	check()
	after, _ := os.ReadFile(chatReadPath(cfg))
	info2, _ := os.Stat(chatReadPath(cfg))
	if !bytes.Equal(before, after) || !info.ModTime().Equal(info2.ModTime()) {
		t.Fatal("not persistent idempotent")
	}
	stored, _ := loadChatSession(cfg, "p")
	if stored.ConductorChildren[0].Review.Status != "pending" {
		t.Fatal("review changed")
	}
	for _, kind := range []string{"revision", "dispatch", "pending", "running", "wrong-parent", "wrong-worker", "missing"} {
		t.Run(kind, func(t *testing.T) {
			original := w
			originalP := p
			w.Messages = append([]chatMessage(nil), w.Messages...)
			p.ConductorChildren = append([]chatConductorChild(nil), p.ConductorChildren...)
			switch kind {
			case "revision":
				w.Messages[0].Content = "new"
			case "dispatch":
				copy := *w.Conductor
				copy.DispatchID = "next"
				w.Conductor = &copy
			case "pending":
				p.ConductorChildren[0].Status = conductorRunning
			case "running":
				s.ChatRuns = map[string]*chatRun{"w": {Done: false}}
			case "wrong-parent":
				copy := *w.Conductor
				copy.ParentSessionID = "other"
				w.Conductor = &copy
			case "wrong-worker":
				ack["session_id"] = "other"
			case "missing":
				ack["result_receipt"] = nil
			}
			save()
			if err := saveChatReadState(cfg, map[string]chatSessionResult{}); err != nil {
				t.Fatal(err)
			}
			if kind == "running" {
				if err := s.handleConductorReadEvent("p", ack); !errors.Is(err, errConductorReadBusy) {
					t.Fatalf("expected busy, got %v", err)
				}
			} else {
				check()
			}
			state, _ := loadChatReadState(cfg)
			if len(state) != 0 {
				t.Fatal("invalid receipt cleared unread", state)
			}
			w = original
			p = originalP
			s.ChatRuns = nil
			ack["session_id"] = "w"
			ack["result_receipt"] = receipt
			save()
		})
	}
}

func TestConductorResultReceiptBoundary(t *testing.T) {
	w := chatSession{Messages: []chatMessage{{ID: "old", Role: "assistant", Content: "old answer"}, {ID: "request", Role: "user", Content: "new task"}}}
	start := 1
	child := chatConductorChild{MessageStart: &start}
	if got := conductorResultReceipt(child, w); got != nil {
		t.Fatal("acknowledged old round", got)
	}
	w.Messages = append(w.Messages, chatMessage{ID: "new", Role: "assistant", Content: "new answer"})
	got := conductorResultReceipt(child, w)
	if got == nil || got.ID != "new" {
		t.Fatal(got)
	}
	for _, boundary := range []int{-1, 3, 4} {
		child.MessageStart = &boundary
		if got := conductorResultReceipt(child, w); got != nil {
			t.Fatal("invalid/empty boundary", got)
		}
	}
	child.MessageStart = nil
	if got := conductorResultReceipt(child, w); got != nil {
		t.Fatal("unknown boundary", got)
	}
}
