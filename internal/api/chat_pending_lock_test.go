package api

import (
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestChatPendingSaveKeepsCancellationAtomic(t *testing.T) {
	s := newChatLoopTestServer(t)
	token := s.beginChatRun("pending-atomic")
	owned, err := s.saveChatRunPending("pending-atomic", token, "pending", 1, func() error {
		if s.ChatMu.TryLock() {
			s.ChatMu.Unlock()
			t.Error("cancellation can interleave with pending persistence")
		}
		if s.SessionMu.TryLock() {
			s.SessionMu.Unlock()
			t.Error("session persistence is not serialized")
		}
		return nil
	})
	if err != nil || !owned || token.PendingAssistantID != "pending" {
		t.Fatalf("owned=%v err=%v token=%+v", owned, err, token)
	}
	s.ChatMu.Lock()
	token.Canceled = true
	s.ChatMu.Unlock()
	called := false
	owned, err = s.saveChatRunPending("pending-atomic", token, "late", 2, func() error { called = true; return nil })
	if owned || err != nil || called || token.PendingAssistantID != "pending" {
		t.Fatal("canceled run persisted a new pending message")
	}
}

// A conductor operation owns SessionMu while reading run state. A concurrent
// pending save must not hold ChatMu while waiting for that session lock.
func TestChatPendingSaveDoesNotInvertConductorLocks(t *testing.T) {
	s := newChatLoopTestServer(t)
	token := s.beginChatRun("pending-lock")
	s.SessionMu.Lock()
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		_, _ = s.saveChatRunPending("pending-lock", token, "pending", 1, func() error { return nil })
	}()
	deadline := time.Now().Add(2 * time.Second)
	waiting := false
	for time.Now().Before(deadline) {
		buf := make([]byte, 1<<20)
		n := runtime.Stack(buf, true)
		for _, stack := range strings.Split(string(buf[:n]), "\n\n") {
			if strings.Contains(stack, "saveChatRunPending") && strings.Contains(stack, "Mutex.Lock") {
				waiting = true
				break
			}
		}
		if waiting {
			break
		}
		select {
		case <-finished:
			s.SessionMu.Unlock()
			t.Fatal("pending save bypassed SessionMu; callback can invert conductor lock order")
		default:
		}
		runtime.Gosched()
	}
	available := s.ChatMu.TryLock()
	if available {
		s.ChatMu.Unlock()
	}
	s.SessionMu.Unlock()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("pending save did not finish")
	}
	if !waiting {
		t.Fatal("pending save did not wait for session lock")
	}
	if !available {
		t.Fatal("pending save held ChatMu while waiting for SessionMu")
	}
}
