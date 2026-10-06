package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConductorCompletionSummaryPreservesFullSnapshot(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	token := s.beginChatRun("summary-parent")
	defer s.endChatRunOwned("summary-parent", token)
	start := 0
	result := strings.Repeat("result!", 1000)
	evidence := strings.Repeat("evidence!", 20000)
	child := chatConductorChild{DispatchID: "summary-dispatch", SessionID: "summary-worker", Objective: strings.Repeat("objective", 500), Status: conductorRunning, MessageStart: &start}
	saveChatLoopTestSession(t, s, chatSession{ID: "summary-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{child}})
	var blocks []map[string]interface{}
	for i := 0; i < 64; i++ {
		id := fmt.Sprint(i)
		blocks = append(blocks, map[string]interface{}{"type": "tool_use", "id": id, "name": "code_run"}, map[string]interface{}{"type": "tool_result", "tool_use_id": id, "content": evidence})
	}
	saveChatLoopTestSession(t, s, chatSession{ID: child.SessionID, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "summary-parent", DispatchID: child.DispatchID, Status: conductorRunning}, Messages: []chatMessage{{ID: "summary-message", Role: "assistant", Content: result, StructuredContent: blocks}}})
	encoded, _ := json.Marshal(evidence)
	wantEvidence := boundedConductorText(string(encoded), 4096)
	s.finishConductorChild("summary-parent", child.DispatchID, conductorSucceeded, result, "")
	parent, err := loadChatSession(cfg, "summary-parent")
	if err != nil {
		t.Fatal(err)
	}
	got := parent.ConductorChildren[0]
	if got.Result != result || len(got.Evidence) != 64 || got.Evidence[0].Result != wantEvidence || got.Evidence[63].Result != wantEvidence {
		t.Fatal("full persisted snapshot lost")
	}
	if len(parent.QueuedMessages) != 1 || len(parent.QueuedMessages[0].Text) > 16*1024 || strings.Contains(parent.QueuedMessages[0].Text, evidence) {
		t.Fatal("completion event not bounded")
	}
	data, err := os.ReadFile(filepath.Join(chatConductorBrokerDirForSession(chatSessionDir(cfg), parent.ID), child.DispatchID+".outcome.json"))
	if err != nil {
		t.Fatal(err)
	}
	var outcome conductorOutcome
	if err := json.Unmarshal(data, &outcome); err != nil {
		t.Fatal(err)
	}
	if outcome.Result != result || len(outcome.Evidence) != 64 || outcome.Evidence[0].Result != wantEvidence {
		t.Fatal("broker snapshot lost full data")
	}
	// Queues from earlier versions must also become compact only in the request.
	parent.QueuedMessages[0].Text = strings.Repeat("legacy full result", 20000)
	req := map[string]interface{}{}
	prepareConductorCompletionBatch(req, parent, parent.QueuedMessages)
	if len(req["prompt"].(string)) > 16*1024 {
		t.Fatal("legacy event remains unbounded")
	}
	receipts := req["conductor_completion_receipts"].([]chatConductorChild)
	if len(receipts) != 1 || receipts[0].Result != result || receipts[0].Evidence[0].Result != wantEvidence {
		t.Fatal("read receipt or full snapshot altered")
	}
	// A repeated terminal callback must not append or rewrite persistent state.
	path := chatSessionPath(cfg, parent.ID)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s.finishConductorChild(parent.ID, child.DispatchID, conductorSucceeded, "different", "")
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("terminal replay changed persisted state")
	}
}
