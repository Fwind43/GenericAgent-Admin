package api

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

func TestConductorCompletionDoesNotCreateUserTurn(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "completion-not-user"
	blockChatLoopTestWorker(t, s, sid)
	saveChatLoopTestSession(t, s, chatSession{
		ID:             sid,
		Messages:       []chatMessage{{ID: "original", Role: "user", Content: "original objective"}},
		QueuedMessages: []chatQueuedMessage{{ID: "conductor-dispatch", Kind: "conductor_completion", Text: "internal evidence"}},
	})
	if !s.processNextQueuedMessage(sid) {
		t.Fatal("completion did not wake the parent")
	}
	stored, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Messages) != 2 || stored.Messages[0].ID != "original" || stored.Messages[1].Role != "assistant" {
		t.Fatalf("completion became a visible user turn: %+v", stored.Messages)
	}
	if len(stored.QueuedMessages) != 0 {
		t.Fatal("completion was not consumed")
	}
	s.ChatMu.Lock()
	events := append([][]byte(nil), s.ChatRuns[sid].Events...)
	s.ChatMu.Unlock()
	for _, event := range events {
		var value struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(event, &value); err != nil {
			t.Fatal(err)
		}
		if value.Type == "user" {
			t.Fatalf("completion broadcast as user: %s", event)
		}
	}
	before, err := os.ReadFile(chatSessionPath(s.CfgStore.Snapshot(), sid))
	if err != nil {
		t.Fatal(err)
	}
	if s.processNextQueuedMessage(sid) {
		t.Fatal("completion replayed")
	}
	after, err := os.ReadFile(chatSessionPath(s.CfgStore.Snapshot(), sid))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("second consumption changed persisted state")
	}
}

func TestConductorCompletionInboxReplay(t *testing.T) {
	s := newChatLoopTestServer(t)
	token := s.beginChatRun("parent")
	if token == nil {
		t.Fatal("reserve")
	}
	defer s.endChatRunOwned("parent", token)
	saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "dispatch", SessionID: "worker", Status: conductorRunning}}})
	saveChatLoopTestSession(t, s, chatSession{ID: "worker", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "parent", DispatchID: "dispatch", Status: conductorRunning}})
	s.finishConductorChild("parent", "dispatch", conductorSucceeded, "verified", "")
	cs, err := loadChatSession(s.CfgStore.Snapshot(), "parent")
	if err != nil {
		t.Fatal(err)
	}
	if len(cs.QueuedMessages) != 1 || cs.QueuedMessages[0].ID != "conductor-dispatch" || cs.QueuedMessages[0].Kind != "conductor_completion" {
		t.Fatalf("missing inbox: %+v", cs.QueuedMessages)
	}
	path := chatSessionPath(s.CfgStore.Snapshot(), "parent")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s.finishConductorChild("parent", "dispatch", conductorSucceeded, "duplicate", "")
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("duplicate completion changed persisted inbox")
	}
}
