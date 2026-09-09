package api

import (
	"fmt"
	"genericagent-admin-go/internal/config"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatLoopCustomLimits(t *testing.T) {
	for _, budget := range []int{0, 1, 4} {
		t.Run(fmt.Sprint(budget), func(t *testing.T) {
			s := newChatLoopTestServer(t)
			cs := chatSession{ID: "custom", Loop: chatLoopState{Enabled: true, Status: chatLoopStatusEvaluating, Epoch: 1, MaxRetries: &budget}}
			saveChatLoopTestSession(t, s, cs)
			old := runOneShotBTWWorkerFunc
			defer func() { runOneShotBTWWorkerFunc = old }()
			calls := 0
			runOneShotBTWWorkerFunc = func(config.AppConfig, string, map[string]interface{}) (chatMessage, error) {
				calls++
				return chatMessage{}, fmt.Errorf("offline")
			}
			s.evaluateChatLoop(cs.ID, 1, cs)
			if calls != budget+1 {
				t.Fatalf("calls=%d budget=%d", calls, budget)
			}
			cs.Loop.Status = chatLoopStatusRunning
			cs.Loop.WorkerErrorStreak = budget
			saveChatLoopTestSession(t, s, cs)
			s.afterChatRunTerminal(cs.ID, false)
			got, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID)
			if err != nil || got.Loop.Enabled || got.Loop.Status != chatLoopStatusError {
				t.Fatalf("loop=%+v err=%v", got.Loop, err)
			}
		})
	}
}

func TestChatLoopMaximumRoundsStopsBeforeModel(t *testing.T) {
	for _, direct := range []bool{false, true} {
		s := newChatLoopTestServer(t)
		cs := chatSession{ID: "limit", Loop: chatLoopState{Enabled: true, Status: chatLoopStatusEvaluating, Epoch: 1, Round: 3, MaxRounds: 3}}
		saveChatLoopTestSession(t, s, cs)
		if direct {
			s.continueChatLoop(cs.ID, 1, "do not run")
		} else {
			s.evaluateChatLoop(cs.ID, 1, cs)
		}
		got, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID)
		if err != nil || got.Loop.Enabled || got.Loop.StopReason != "max_rounds" || got.Loop.Round != 3 {
			t.Fatalf("loop=%+v err=%v", got.Loop, err)
		}
	}
}

func TestChatLoopRejectsInvalidLimits(t *testing.T) {
	for _, body := range []string{`{"max_rounds":-1}`, `{"max_rounds":10001}`, `{"max_retries":-1}`, `{"max_retries":101}`, `{"max_retries":1.5}`} {
		s := newChatLoopTestServer(t)
		rr := httptest.NewRecorder()
		s.chatLoopStart(rr, httptest.NewRequest("POST", "/", strings.NewReader(body)), "invalid")
		if rr.Code != 400 {
			t.Fatalf("body=%s code=%d", body, rr.Code)
		}
	}
}
