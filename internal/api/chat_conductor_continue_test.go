package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"genericagent-admin-go/internal/config"
)

// No process or model is started: reaching the stub proves admission.
func TestConductorUserContinuation(t *testing.T) {
	oldStart := startChatWorkerFunc
	defer func() { startChatWorkerFunc = oldStart }()
	for _, status := range []string{conductorSucceeded, conductorFailed, conductorCancelled} {
		t.Run(status, func(t *testing.T) {
			s := newChatLoopTestServer(t)
			cfg := s.CfgStore.Snapshot()
			state := &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "parent", DispatchID: "old", Status: status}
			saveChatLoopTestSession(t, s, chatSession{ID: "child", Conductor: state, Messages: []chatMessage{{ID: "old-result", Role: "assistant", Content: "old", CreatedAt: 1}}})
			saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "old", SessionID: "child", Status: status, Result: "old"}}})
			original, _ := loadChatSession(cfg, "child")
			receipt := latestChatSessionResult(original)
			before, _ := loadChatSession(cfg, "parent")
			before.ConductorChildren[0].ResultReceipt = receipt
			if err := saveChatSession(cfg, before); err != nil {
				t.Fatal(err)
			}
			if err := saveChatReadState(cfg, map[string]chatSessionResult{"child": *receipt}); err != nil {
				t.Fatal(err)
			}
			readBefore, _ := loadChatReadState(cfg)
			called := false
			startChatWorkerFunc = func(config.AppConfig, string) (*chatWorker, error) {
				called = true
				return nil, errors.New("test: no model")
			}
			req := map[string]interface{}{}
			cs, _ := loadChatSession(cfg, "child")
			if err := s.prepareConductorWorkerRequest(cs, req); err != nil {
				t.Fatal(err)
			}
			if len(req) != 0 {
				t.Fatalf("historical worker role leaked: %#v", req)
			}
			w := httptest.NewRecorder()
			s.chatPostMode(w, httptest.NewRequest(http.MethodPost, "/api/chat/child", strings.NewReader(`{"prompt":"my own task"}`)), "child", false)
			if !called || w.Code == http.StatusConflict {
				t.Fatalf("not admitted: called=%v status=%d body=%s", called, w.Code, w.Body.String())
			}
			after, _ := loadChatSession(cfg, "child")
			if len(after.Messages) < 2 || after.Messages[1].Content != "my own task" || after.Messages[1].SenderKind != "user" {
				t.Fatal("user continuation not persisted with user provenance")
			}
			if !reflect.DeepEqual(after.Conductor, state) {
				t.Fatalf("association changed: %+v", after.Conductor)
			}
			after.Messages = append(after.Messages, chatMessage{ID: "new-result", Role: "assistant", Content: "user-owned result", CreatedAt: 2})
			if err := saveChatSession(cfg, after); err != nil {
				t.Fatal(err)
			}
			s.syncConductorTerminal(after)
			if err := s.handleConductorReadEvent("parent", map[string]interface{}{"dispatch_id": "old", "session_id": "child", "result_receipt": receipt}); err != nil {
				t.Fatal(err)
			}
			parentAfter, _ := loadChatSession(cfg, "parent")
			readAfter, _ := loadChatReadState(cfg)
			if !reflect.DeepEqual(before, parentAfter) {
				t.Fatal("old dispatch/review/queue mutated")
			}
			if !reflect.DeepEqual(readBefore, readAfter) {
				t.Fatal("read receipt mutated")
			}
			if len(after.Messages) <= 1 {
				t.Fatal("user continuation not persisted")
			}
		})
	}
}

func TestConductorUserCannotTakeOverLiveDispatch(t *testing.T) {
	for _, status := range []string{conductorQueued, conductorRunning, "cancelling"} {
		t.Run(status, func(t *testing.T) {
			s := newChatLoopTestServer(t)
			saveChatLoopTestSession(t, s, chatSession{ID: "child", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "parent", DispatchID: "old", Status: status}, QueuedMessages: []chatQueuedMessage{{ID: "q", Text: "later"}}})
			w := httptest.NewRecorder()
			s.chatPostMode(w, httptest.NewRequest(http.MethodPost, "/api/chat/child", strings.NewReader(`{"prompt":"take over"}`)), "child", true)
			if w.Code != http.StatusConflict || s.chatRunActive("child") {
				t.Fatalf("unprotected status: %d", w.Code)
			}
			if s.processNextQueuedMessage("child") {
				t.Fatal("queue took over dispatch")
			}
			cs, _ := loadChatSession(s.CfgStore.Snapshot(), "child")
			if len(cs.Messages) != 0 || len(cs.QueuedMessages) != 1 {
				t.Fatal("rejected start mutated history/queue")
			}
		})
	}
}
