package api

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestConductorResolutionLifecycle(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	parent := chatSession{ID: "resolution-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{
		{DispatchID: "old", SessionID: "reused", Status: conductorFailed, Error: "original error", Result: "partial artifact"},
		{DispatchID: "needs", SessionID: "needs-worker", Status: conductorSucceeded, Review: &conductorReview{Status: "needs_work", Basis: "missing output"}},
		{DispatchID: "cancelled", SessionID: "cancelled-worker", Status: conductorCancelled},
		{DispatchID: "replacement", SessionID: "reused", Status: conductorRunning},
	}}
	saveChatLoopTestSession(t, s, parent)
	if conductorTaskOverview(parent.ConductorChildren)[0]["resolved"] == true || conductorChildResolved(parent.ConductorChildren[0]) {
		t.Fatal("session reuse inferred resolution")
	}
	child, err := s.conductorResolve(parent.ID, "old", "superseded", "Same objective replaced explicitly", "replacement")
	if err != nil {
		t.Fatal(err)
	}
	if !conductorChildResolved(child) || child.Status != conductorFailed || child.Review != nil || child.Error != "original error" || child.Result != "partial artifact" {
		t.Fatalf("resolution rewrote execution/review: %+v", child)
	}
	broker := chatConductorBrokerDirForSession(chatSessionDir(cfg), parent.ID)
	outcomePath := filepath.Join(broker, "old.outcome.json")
	sessionPath := chatSessionPath(cfg, parent.ID)
	before, err := os.ReadFile(sessionPath)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := os.ReadFile(outcomePath)
	if err != nil {
		t.Fatal(err)
	}
	var outcome conductorOutcome
	if err := json.Unmarshal(receipt, &outcome); err != nil {
		t.Fatal(err)
	}
	if outcome.Resolution == nil || outcome.Resolution.ReplacementDispatchID != "replacement" || outcome.Status != conductorFailed {
		t.Fatal("broker lost explicit resolution")
	}
	// A fresh Server reads the persisted state, not a cached child.
	reopened := &Server{CfgStore: s.CfgStore, SessionMu: new(sync.Mutex)}
	repeated, err := reopened.conductorResolve(parent.ID, "old", "superseded", "Same objective replaced explicitly", "replacement")
	if err != nil || repeated.Resolution.ResolvedAt != child.Resolution.ResolvedAt {
		t.Fatal("reloaded idempotent call changed timestamp", err)
	}
	after, _ := os.ReadFile(sessionPath)
	afterReceipt, _ := os.ReadFile(outcomePath)
	if !bytes.Equal(before, after) || !bytes.Equal(receipt, afterReceipt) {
		t.Fatal("retry rewrote persistent session/broker")
	}
	if _, err := s.conductorResolve(parent.ID, "old", "closed", "different disposition", ""); err == nil {
		t.Fatal("conflicting retry accepted")
	}
	after, _ = os.ReadFile(sessionPath)
	if !bytes.Equal(before, after) {
		t.Fatal("conflict changed session")
	}
	for _, id := range []string{"needs", "cancelled"} {
		closed, err := s.conductorResolve(parent.ID, id, "closed", "User authorized ending this branch", "")
		if err != nil || !conductorChildResolved(closed) {
			t.Fatal(id, err)
		}
		if id == "needs" && (closed.Status != conductorSucceeded || closed.Review.Status != "needs_work" || closed.Review.Basis != "missing output") {
			t.Fatal("closed work became verified")
		}
		if id == "cancelled" && closed.Status != conductorCancelled {
			t.Fatal("cancelled work became successful")
		}
	}
	loaded, err := loadChatSession(cfg, parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	rows := conductorTaskOverview(loaded.ConductorChildren)
	if rows[0]["dispatch_id"] != "replacement" || rows[0]["resolved"] != false {
		t.Fatal("replacement silently resolved", rows)
	}
	for _, row := range rows[1:] {
		if row["resolved"] != true || row["resolution_status"] == "" {
			t.Fatal("roster missing disposition", row)
		}
	}
	summary := conductorCompletionSummary(loaded.ConductorChildren[0])
	if summary["resolved"] != true || summary["status"] != conductorFailed || summary["replacement_dispatch_id"] != "replacement" {
		t.Fatal(summary)
	}
}

func TestConductorResolutionRejectsUnsafeInput(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	parent := chatSession{ID: "reject-resolution", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{
		{DispatchID: "earlier", Status: conductorCancelled},
		{DispatchID: "terminal", Status: conductorFailed},
		{DispatchID: "active", Status: conductorRunning},
		{DispatchID: "queued", Status: conductorQueued},
		{DispatchID: "recover", Status: conductorFailed, Recovery: "recovery_pending"},
	}}
	saveChatLoopTestSession(t, s, parent)
	saveChatLoopTestSession(t, s, chatSession{ID: "other-resolution", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "foreign", Status: conductorFailed}}})
	saveChatLoopTestSession(t, s, chatSession{ID: "normal-resolution"})
	saveChatLoopTestSession(t, s, chatSession{ID: "worker-resolution", Conductor: &chatConductorState{Role: conductorRoleWorker}})
	before, _ := os.ReadFile(chatSessionPath(cfg, parent.ID))
	for _, v := range [][4]string{
		{"active", "closed", "reason", ""}, {"queued", "closed", "reason", ""}, {"recover", "closed", "reason", ""},
		{"terminal", "verified", "reason", ""}, {"terminal", "closed", " ", ""}, {"terminal", "closed", strings.Repeat("x", 4097), ""},
		{"terminal", "closed", string([]byte{0xff}), ""}, {"terminal", "closed", "reason", "active"},
		{"terminal", "superseded", "reason", ""}, {"terminal", "superseded", "reason", "foreign"},
		{"terminal", "superseded", "reason", "earlier"}, {"terminal", "superseded", "reason", "terminal"},
		{"foreign", "closed", "reason", ""}, {"../terminal", "closed", "reason", ""},
	} {
		if _, err := s.conductorResolve(parent.ID, v[0], v[1], v[2], v[3]); err == nil {
			t.Fatal("unsafe resolution accepted", v)
		}
		after, _ := os.ReadFile(chatSessionPath(cfg, parent.ID))
		if !bytes.Equal(before, after) {
			t.Fatal("rejection changed persistent state", v)
		}
	}
	for _, id := range []string{"missing-resolution", "normal-resolution", "worker-resolution"} {
		if _, err := s.conductorResolve(id, "terminal", "closed", "reason", ""); err == nil {
			t.Fatal("non-parent accepted", id)
		}
	}
}

func TestConductorResolutionBrokerAndDisable(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	parent := chatSession{ID: "resolve-event", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "done", SessionID: "done-worker", Status: conductorSucceeded}}}
	saveChatLoopTestSession(t, s, parent)
	saveChatLoopTestSession(t, s, chatSession{ID: "done-worker", Conductor: &chatConductorState{Role: conductorRoleWorker, Status: conductorSucceeded}})
	if _, err := s.disableChatConductor(parent.ID); err == nil {
		t.Fatal("unreviewed successful work bypassed gate")
	}
	broker := chatConductorBrokerDirForSession(chatSessionDir(cfg), parent.ID)
	ev := map[string]interface{}{"request_id": "close-request", "broker_dir": broker, "dispatch_id": "done", "status": "closed", "basis": "User explicitly waived this deliverable"}
	ev["broker_dir"] = filepath.Join(broker, "foreign")
	s.handleConductorResolveEvent(parent.ID, ev)
	loaded, _ := loadChatSession(cfg, parent.ID)
	if loaded.ConductorChildren[0].Resolution != nil {
		t.Fatal("foreign broker changed session")
	}
	ev["broker_dir"] = broker
	s.handleConductorResolveEvent(parent.ID, ev)
	receipt, err := os.ReadFile(filepath.Join(broker, "close-request.response.json"))
	if err != nil {
		t.Fatal(err)
	}
	var reply map[string]interface{}
	if err := json.Unmarshal(receipt, &reply); err != nil {
		t.Fatal(err)
	}
	if reply["ok"] != true || reply["resolved"] != true || reply["status"] != conductorSucceeded || reply["review"] != nil {
		t.Fatal(reply)
	}
	if _, err := s.disableChatConductor(parent.ID); err != nil {
		t.Fatal("explicit closure did not release disable gate", err)
	}
}
