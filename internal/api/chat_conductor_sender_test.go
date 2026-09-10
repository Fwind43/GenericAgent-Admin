package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestConductorSenderPersistence(t *testing.T) {
	for _, sender := range []string{"conductor", "user"} {
		t.Run(sender, func(t *testing.T) {
			s := newChatLoopTestServer(t)
			const sid = "sender-worker"
			saveChatLoopTestSession(t, s, chatSession{ID: sid, Conductor: &chatConductorState{Role: conductorRoleWorker}})
			blockChatLoopTestWorker(t, s, sid)
			rr := httptest.NewRecorder()
			// Client-supplied provenance must not override the normal user entry point.
			req := httptest.NewRequest("POST", "/", strings.NewReader(`{"prompt":"task","sender_kind":"conductor"}`))
			if sender == "conductor" {
				s.chatPostWithSender(rr, req, sid, true, "conductor")
			} else {
				s.chatPostMode(rr, req, sid, true)
			}
			if rr.Code != 200 {
				t.Fatalf("send: %d %s", rr.Code, rr.Body.String())
			}
			cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
			if err != nil {
				t.Fatal(err)
			}
			if len(cs.Messages) < 1 || cs.Messages[0].Role != "user" || cs.Messages[0].SenderKind != sender {
				t.Fatalf("persisted: %+v", cs.Messages)
			}
			for _, query := range []string{"", "?view=page", "?view=message&message_id=" + cs.Messages[0].ID} {
				result, code, err := chatSessionView(cs, httptest.NewRequest("GET", "/"+query, nil))
				if err != nil || code != 200 {
					t.Fatalf("view %s: %d %v", query, code, err)
				}
				data, err := json.Marshal(result)
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(string(data), `"sender_kind":"`+sender+`"`) || !strings.Contains(string(data), `"role":"user"`) {
					t.Fatalf("view %s missing provenance: %s", query, data)
				}
			}
		})
	}
}
