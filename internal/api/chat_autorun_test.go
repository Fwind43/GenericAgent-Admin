package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestChatAutorunPersistenceAndIsolation(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	sid := newChatID()
	other := newChatID()
	for _, id := range []string{sid, other} {
		if err := saveChatSession(cfg, chatSession{ID: id}); err != nil {
			t.Fatal(err)
		}
	}
	patch := func(enabled bool) {
		t.Helper()
		body, _ := json.Marshal(map[string]interface{}{"enabled": enabled, "language": "en"})
		rr := httptest.NewRecorder()
		s.chatHandler(rr, httptest.NewRequest(http.MethodPatch, "/api/chat/autorun/"+sid, bytes.NewReader(body)))
		if rr.Code != 200 {
			t.Fatalf("patch: %d %s", rr.Code, rr.Body.String())
		}
	}
	patch(true)
	first, err := loadChatSession(cfg, sid)
	if err != nil || !first.Autorun.Enabled || first.Autorun.NextRunAt < time.Now().Unix()+55 {
		t.Fatalf("first: %+v %v", first.Autorun, err)
	}
	patch(true)
	again, _ := loadChatSession(cfg, sid)
	if again.Autorun != first.Autorun {
		t.Fatal("repeated enable reset timer")
	}
	untouched, _ := loadChatSession(cfg, other)
	if untouched.Autorun.Enabled {
		t.Fatal("another session enabled")
	}
	rr := httptest.NewRecorder()
	s.chatSessions(rr, httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil))
	if !bytes.Contains(rr.Body.Bytes(), []byte(`"autorun":{"enabled":true`)) {
		t.Fatalf("list missing state: %s", rr.Body.String())
	}
	stale := first
	patch(false)
	latest, _ := loadChatSession(cfg, sid)
	preserveLatestChatUserMetadata(&stale, latest)
	if stale.Autorun.Enabled {
		t.Fatal("worker snapshot resurrected autorun")
	}
	patch(false)
	repeated, _ := loadChatSession(cfg, sid)
	if repeated.Autorun != latest.Autorun {
		t.Fatal("disable not idempotent")
	}
	if s.dispatchChatAutorun(sid, time.Now().Unix()+9999) {
		t.Fatal("disabled session dispatched")
	}
}

func TestChatAutorunBusyAndTerminal(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	sid := newChatID()
	cs := chatSession{ID: sid, Autorun: chatAutorunState{Enabled: true, NextRunAt: 1}}
	if err := saveChatSession(cfg, cs); err != nil {
		t.Fatal(err)
	}
	token := s.beginChatRun(sid)
	if s.dispatchChatAutorun(sid, time.Now().Unix()) {
		t.Fatal("duplicate run")
	}
	s.endChatRunOwned(sid, token)
	cs.Loop.Enabled = true
	if err := saveChatSession(cfg, cs); err != nil {
		t.Fatal(err)
	}
	if s.dispatchChatAutorun(sid, time.Now().Unix()) {
		t.Fatal("loop was preempted")
	}
	s.afterChatRunTerminal(sid, false)
	latest, _ := loadChatSession(cfg, sid)
	if latest.Autorun.NextRunAt < time.Now().Unix()+1795 {
		t.Fatal("terminal did not back off")
	}
}

func TestChatAutorunSchedulerLifecycle(t *testing.T) {
	s := newChatLoopTestServer(t)
	s.StartChatAutorun()
	s.StartChatAutorun()
	s.tickChatAutorun(context.Background())
	s.StopChatAutorun()
	s.StopChatAutorun()
}

func TestChatAutorunUsesConversationContext(t *testing.T) {
	for _, tc := range []struct {
		language string
		want     []string
		legacy   string
	}{
		{"zh", []string{"当前会话内容", "最新用户目标", "已获授权", "不要转向无关任务", "不得自行恢复", "无可执行事项"}, "请阅读自动化 SOP，执行自动任务"},
		{"en", []string{"current conversation", "latest user goals", "authorized next step", "unrelated tasks", "stopped or rejected", "no actionable work"}, "Read the automation SOP and execute automatic tasks"},
	} {
		t.Run(tc.language, func(t *testing.T) {
			s := newChatLoopTestServer(t)
			sid := "autorun-context-" + tc.language
			blockChatLoopTestWorker(t, s, sid)
			history := chatMessage{ID: "original-user", Role: "user", Content: "Continue the current project only."}
			saveChatLoopTestSession(t, s, chatSession{ID: sid, Messages: []chatMessage{history}, Autorun: chatAutorunState{Enabled: true, NextRunAt: 1, Language: tc.language}})
			if !s.dispatchChatAutorun(sid, time.Now().Unix()) {
				t.Fatal("not dispatched")
			}
			cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
			if err != nil {
				t.Fatal(err)
			}
			if len(cs.Messages) != 3 || cs.Messages[0].ID != history.ID || cs.Messages[0].Content != history.Content {
				t.Fatalf("history lost: %+v", cs.Messages)
			}
			prompt := cs.Messages[1].Content
			for _, want := range tc.want {
				if !bytes.Contains([]byte(prompt), []byte(want)) {
					t.Fatalf("prompt missing %q: %s", want, prompt)
				}
			}
			if bytes.Contains([]byte(prompt), []byte(tc.legacy)) {
				t.Fatal("legacy exploration instruction remains")
			}
		})
	}
}

func TestChatAutorunDispatchPersistsOneTurn(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "autorun-dispatch"
	blockChatLoopTestWorker(t, s, sid)
	saveChatLoopTestSession(t, s, chatSession{ID: sid, Autorun: chatAutorunState{Enabled: true, NextRunAt: 1}})
	if !s.dispatchChatAutorun(sid, time.Now().Unix()) {
		t.Fatal("not dispatched")
	}
	if s.dispatchChatAutorun(sid, time.Now().Unix()) {
		t.Fatal("duplicate dispatched")
	}
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil || len(cs.Messages) != 2 || cs.Messages[0].Role != "user" || cs.Autorun.NextRunAt < time.Now().Unix()+1795 {
		t.Fatalf("persisted: %+v %v", cs, err)
	}
}
