package api

import (
	"bytes"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestConductorCompletionBatchBoundaries(t *testing.T) {
	base := func() chatSession {
		return chatSession{Conductor: &chatConductorState{Role: conductorRoleParent}, QueuedMessages: []chatQueuedMessage{{ID: "conductor-a", Kind: "conductor_completion", Text: "a"}, {ID: "conductor-b", Kind: "conductor_completion", Text: "b"}, {ID: "user", Text: "question"}, {ID: "conductor-c", Kind: "conductor_completion", Text: "c"}}}
	}
	cs := base()
	if got := conductorCompletionBatchCount(cs, 0, ""); got != 2 {
		t.Fatal(got)
	}
	if conductorCompletionBatchCount(cs, 0, "conductor-a") != 1 || conductorCompletionBatchCount(cs, 1, "") != 1 {
		t.Fatal("manual/index")
	}
	cs.Conductor = nil
	if conductorCompletionBatchCount(cs, 0, "") != 1 {
		t.Fatal("ordinary")
	}
	cs = base()
	cs.QueuedMessages[1].LLMNo = 2
	if conductorCompletionBatchCount(cs, 0, "") != 1 {
		t.Fatal("model")
	}
	cs = base()
	cs.QueuedMessages[1].ReasoningEffort = "high"
	if conductorCompletionBatchCount(cs, 0, "") != 1 {
		t.Fatal("reasoning")
	}
	cs = base()
	cs.QueuedMessages[1].Files = []chatUpload{{}}
	if conductorCompletionBatchCount(cs, 0, "") != 1 {
		t.Fatal("files")
	}
	cs = base()
	cs.QueuedMessages[0].Text = strings.Repeat("x", 64*1024)
	if conductorCompletionBatchCount(cs, 0, "") != 1 {
		t.Fatal("bytes")
	}
	cs = base()
	cs.QueuedMessages = nil
	for i := 0; i < 12; i++ {
		cs.QueuedMessages = append(cs.QueuedMessages, chatQueuedMessage{Kind: "conductor_completion"})
	}
	if conductorCompletionBatchCount(cs, 0, "") != 8 {
		t.Fatal("count")
	}
}
func TestConductorCompletionBatchReceipts(t *testing.T) {
	cs := chatSession{ConductorChildren: []chatConductorChild{{DispatchID: "a"}, {DispatchID: "b"}}}
	req := map[string]interface{}{}
	batch := []chatQueuedMessage{{ID: "conductor-a", Text: "A"}, {ID: "conductor-b", Text: "B"}}
	prepareConductorCompletionBatch(req, cs, batch)
	if req["prompt"] != "A\n\nB" || len(req["conductor_completion_receipts"].([]chatConductorChild)) != 2 {
		t.Fatal(req)
	}
	if _, ok := req["conductor_completion_receipt"]; ok {
		t.Fatal("legacy batch ack")
	}
}
func TestConductorCompletionBatchPersistentConsumption(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "batch-parent"
	blockChatLoopTestWorker(t, s, sid)
	saveChatLoopTestSession(t, s, chatSession{ID: sid, Conductor: &chatConductorState{Role: conductorRoleParent}, QueuedMessages: []chatQueuedMessage{{ID: "conductor-a", Kind: "conductor_completion", Text: "A"}, {ID: "conductor-b", Kind: "conductor_completion", Text: "B"}, {ID: "user", Text: "question"}}})
	if !s.processNextQueuedMessage(sid) {
		t.Fatal("start")
	}
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if len(cs.QueuedMessages) != 1 || cs.QueuedMessages[0].ID != "user" || len(cs.Messages) != 1 || cs.Messages[0].Role != "assistant" {
		t.Fatalf("%+v", cs)
	}
	s.ChatMu.Lock()
	run := s.ChatRuns[sid]
	a, b := chatRunContainsQueueID(run, "conductor-a"), chatRunContainsQueueID(run, "conductor-b")
	s.ChatMu.Unlock()
	if !a || !b {
		t.Fatal("batch identity")
	}
	path := chatSessionPath(s.CfgStore.Snapshot(), sid)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if s.processNextQueuedMessage(sid) {
		t.Fatal("parallel parent")
	}
	for i := 0; i < 2; i++ {
		rr := httptest.NewRecorder()
		s.chatGuidePost(rr, httptest.NewRequest("POST", "/", nil), sid, "conductor-b")
		if rr.Code != 200 || !strings.Contains(rr.Body.String(), "already_started") {
			t.Fatal(rr.Code, rr.Body.String())
		}
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("replay changed state")
	}
}
