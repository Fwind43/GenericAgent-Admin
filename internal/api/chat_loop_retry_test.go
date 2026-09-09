package api

import (
	"fmt"
	"testing"
	"time"

	"genericagent-admin-go/internal/config"
)

func TestChatLoopControllerModelFailureRetry(t *testing.T) {
	for _, mode := range []string{"recover", "exhaust", "error_message", "stop", "restart"} {
		t.Run(mode, func(t *testing.T) {
			s := newChatLoopTestServer(t)
			cs := chatSession{ID: "model-retry", Loop: chatLoopState{Enabled: true, Status: chatLoopStatusEvaluating, Epoch: 3}}
			saveChatLoopTestSession(t, s, cs)
			old := runOneShotBTWWorkerFunc
			defer func() { runOneShotBTWWorkerFunc = old }()
			calls := 0
			runOneShotBTWWorkerFunc = func(config.AppConfig, string, map[string]interface{}) (chatMessage, error) {
				calls++
				if calls == 1 || mode == "exhaust" {
					if mode == "stop" {
						s.finishChatLoop(cs.ID, 3, chatLoopStatusStopped, "user_stop")
					}
					if mode == "restart" {
						next := cs
						next.Loop.Epoch++
						saveChatLoopTestSession(t, s, next)
					}
					if mode == "error_message" {
						return chatMessage{Error: true}, nil
					}
					return chatMessage{}, fmt.Errorf("temporary model failure")
				}
				return chatMessage{Content: "No further action needed."}, nil
			}
			s.evaluateChatLoop(cs.ID, 3, cs)
			got, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID)
			if err != nil {
				t.Fatal(err)
			}
			wantCalls := 2
			if mode == "stop" || mode == "restart" {
				wantCalls = 1
			}
			if calls != wantCalls {
				t.Fatalf("calls=%d want %d", calls, wantCalls)
			}
			switch mode {
			case "exhaust":
				if got.Loop.Status != chatLoopStatusError || got.Loop.Enabled {
					t.Fatalf("loop=%+v", got.Loop)
				}
			case "stop":
				if got.Loop.Status != chatLoopStatusStopped {
					t.Fatalf("loop=%+v", got.Loop)
				}
			case "restart":
				if got.Loop.Epoch != 4 || !got.Loop.Enabled {
					t.Fatalf("loop=%+v", got.Loop)
				}
			default:
				if got.Loop.Status != chatLoopStatusCompleted {
					t.Fatalf("loop=%+v", got.Loop)
				}
			}
		})
	}
}

func TestChatLoopWorkerFailureSchedulesBoundedRetry(t *testing.T) {
	s := newChatLoopTestServer(t)
	cs := chatSession{ID: "worker-retry", Loop: chatLoopState{Enabled: true, Status: chatLoopStatusRunning, Epoch: 5}}
	saveChatLoopTestSession(t, s, cs)
	old := continueChatLoopFunc
	dispatch := make(chan int64, 3)
	continueChatLoopFunc = func(_ *Server, sid string, epoch int64, prompt string) { dispatch <- epoch }
	defer func() { continueChatLoopFunc = old }()
	for attempt := 1; attempt <= 3; attempt++ {
		s.afterChatRunTerminal(cs.ID, false)
		got, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.Loop.WorkerErrorStreak != attempt {
			t.Fatalf("streak=%d", got.Loop.WorkerErrorStreak)
		}
		if attempt <= 2 {
			if !got.Loop.Enabled || got.Loop.Status != chatLoopStatusEvaluating {
				t.Fatalf("loop=%+v", got.Loop)
			}
			// A duplicate terminal must not schedule a second retry.
			s.afterChatRunTerminal(cs.ID, false)
			select {
			case epoch := <-dispatch:
				if epoch != 5 {
					t.Fatalf("epoch=%d", epoch)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("retry missing")
			}
			got.Loop.Status = chatLoopStatusRunning
			saveChatLoopTestSession(t, s, got)
		} else if got.Loop.Enabled || got.Loop.Status != chatLoopStatusError {
			t.Fatalf("loop=%+v", got.Loop)
		}
	}
	select {
	case <-dispatch:
		t.Fatal("extra retry")
	default:
	}
}

func TestChatLoopCanceledRunDoesNotRetry(t *testing.T) {
	s := newChatLoopTestServer(t)
	cs := chatSession{ID: "canceled-retry", Loop: chatLoopState{Enabled: true, Status: chatLoopStatusRunning, Epoch: 5}}
	saveChatLoopTestSession(t, s, cs)
	token := s.beginChatRun(cs.ID)
	s.ChatMu.Lock()
	token.Canceled = true
	s.ChatMu.Unlock()
	s.afterChatRunTerminal(cs.ID, false)
	got, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Loop.WorkerErrorStreak != 0 || got.Loop.Status != chatLoopStatusRunning {
		t.Fatalf("loop=%+v", got.Loop)
	}
	s.endChatRunOwned(cs.ID, token)
}
