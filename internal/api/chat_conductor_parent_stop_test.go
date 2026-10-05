package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestConductorParentCancelPreservesWorkersAndReceipts(t *testing.T) {
	s := newChatLoopTestServer(t)
	parentID := "stop-parent"
	children := []chatConductorChild{
		{DispatchID: "ok", SessionID: "ok-worker", Status: conductorRunning},
		{DispatchID: "failed", SessionID: "failed-worker", Status: conductorRunning},
		{DispatchID: "waiting", SessionID: "waiting-worker", Status: conductorQueued},
	}
	inbox := chatQueuedMessage{ID: "older-request", Text: "older question"}
	saveChatLoopTestSession(t, s, chatSession{ID: parentID, Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: children, QueuedMessages: []chatQueuedMessage{inbox}})
	before := map[string][]byte{}
	for _, child := range children {
		saveChatLoopTestSession(t, s, chatSession{ID: child.SessionID, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: parentID, DispatchID: child.DispatchID, Status: child.Status}})
		data, err := os.ReadFile(chatSessionPath(s.CfgStore.Snapshot(), child.SessionID))
		if err != nil {
			t.Fatal(err)
		}
		before[child.SessionID] = data
		if child.Status == conductorRunning {
			s.beginChatRun(child.SessionID)
		}
	}
	s.beginChatRun(parentID)
	for i := 0; i < 2; i++ {
		rr := httptest.NewRecorder()
		s.chatCancel(rr, httptest.NewRequest(http.MethodPost, "/", nil), parentID)
		if rr.Code != http.StatusOK {
			t.Fatal(rr.Code, rr.Body.String())
		}
	}
	parent, err := loadChatSession(s.CfgStore.Snapshot(), parentID)
	if err != nil {
		t.Fatal(err)
	}
	if !conductorParentPaused(parent) || !s.chatRunCanceled(parentID) || !reflect.DeepEqual(parent.ConductorChildren, children) || !reflect.DeepEqual(parent.QueuedMessages, []chatQueuedMessage{inbox}) {
		t.Fatalf("parent stop changed delegated state: %+v", parent)
	}
	for _, child := range children {
		after, err := os.ReadFile(chatSessionPath(s.CfgStore.Snapshot(), child.SessionID))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(before[child.SessionID], after) || s.chatRunCanceled(child.SessionID) {
			t.Fatalf("parent stop cancelled worker %s", child.SessionID)
		}
		if child.Status == conductorRunning {
			worker, err := loadChatSession(s.CfgStore.Snapshot(), child.SessionID)
			if err != nil {
				t.Fatal(err)
			}
			if !s.conductorChatRunnable(worker, "conductor") {
				t.Fatal("stopped parent blocked delegated worker")
			}
		}
	}
	// Keep a new run reserved so both late outcomes remain in the durable inbox.
	blocker := s.beginChatRun(parentID)
	if blocker == nil {
		t.Fatal("could not reserve parent")
	}
	defer s.endChatRunOwned(parentID, blocker)
	s.finishConductorChild(parentID, "ok", conductorSucceeded, "late answer", "")
	s.finishConductorChild(parentID, "failed", conductorFailed, "", "late failure")
	parent, err = loadChatSession(s.CfgStore.Snapshot(), parentID)
	if err != nil {
		t.Fatal(err)
	}
	if conductorParentPaused(parent) || len(parent.QueuedMessages) != 3 || parent.QueuedMessages[0].ID != inbox.ID || parent.ConductorChildren[0].Result != "late answer" || parent.ConductorChildren[1].Error != "late failure" || parent.ConductorChildren[2].Status != conductorQueued {
		t.Fatalf("late receipt lost: %+v", parent)
	}
	if s.processNextQueuedMessage(parentID) || !s.chatRunActive(parentID) {
		t.Fatal("late receipt replaced an active parent run")
	}
	path := chatSessionPath(s.CfgStore.Snapshot(), parentID)
	first, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s.finishConductorChild(parentID, "ok", conductorSucceeded, "duplicate", "")
	s.finishConductorChild(parentID, "failed", conductorFailed, "", "duplicate")
	second, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first, second) {
		t.Fatal("repeated terminal callbacks or stop changed durable state")
	}
}

func waitConductorCompletionQueueStart(t *testing.T, s *Server, sid, queueID string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s.ChatMu.Lock()
		run := s.ChatRuns[sid]
		started := run != nil && !run.Done && !run.Canceled && run.PendingAssistantID != "" && chatRunContainsQueueID(run, queueID)
		s.ChatMu.Unlock()
		if started {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("completion queue %q did not automatically start for %q", queueID, sid)
}

func TestConductorLateCompletionAutomaticallyResumesStoppedParent(t *testing.T) {
	for _, status := range []string{conductorSucceeded, conductorFailed} {
		t.Run(status, func(t *testing.T) {
			s := newChatLoopTestServer(t)
			parentID, workerID, dispatchID := "late-parent", "late-worker", "late-dispatch"
			blockChatLoopTestWorker(t, s, parentID)
			child := chatConductorChild{SessionID: workerID, DispatchID: dispatchID, Status: conductorRunning}
			saveChatLoopTestSession(t, s, chatSession{ID: parentID, Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{child}})
			saveChatLoopTestSession(t, s, chatSession{ID: workerID, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: parentID, DispatchID: dispatchID, Status: conductorRunning}})
			s.beginChatRun(workerID)
			s.beginChatRun(parentID)
			rr := httptest.NewRecorder()
			s.chatCancel(rr, httptest.NewRequest(http.MethodPost, "/", nil), parentID)
			if rr.Code != http.StatusOK || s.chatRunCanceled(workerID) {
				t.Fatal("parent stop cancelled delegation", rr.Code, rr.Body.String())
			}
			s.finishConductorChild(parentID, dispatchID, status, "late answer", "late failure")
			waitConductorCompletionQueueStart(t, s, parentID, "conductor-"+dispatchID)
			got, err := loadChatSession(s.CfgStore.Snapshot(), parentID)
			if err != nil {
				t.Fatal(err)
			}
			if conductorParentPaused(got) || len(got.QueuedMessages) != 0 || len(got.Messages) != 1 || got.ConductorChildren[0].Status != status {
				t.Fatalf("late result not admitted automatically: %+v", got)
			}
			path := chatSessionPath(s.CfgStore.Snapshot(), parentID)
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			s.finishConductorChild(parentID, dispatchID, status, "duplicate", "duplicate")
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("duplicate callback changed durable parent", err)
			}
		})
	}
}

func TestConductorCompletionDuringCancelHandshakeRetriesAfterPartialSave(t *testing.T) {
	s := newChatLoopTestServer(t)
	parentID, workerID, dispatchID := "handshake-parent", "handshake-worker", "handshake-dispatch"
	blockChatLoopTestWorker(t, s, parentID)
	saveChatLoopTestSession(t, s, chatSession{ID: parentID, Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{SessionID: workerID, DispatchID: dispatchID, Status: conductorRunning}}, Messages: []chatMessage{{ID: "partial", Role: "assistant"}}})
	saveChatLoopTestSession(t, s, chatSession{ID: workerID, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: parentID, DispatchID: dispatchID, Status: conductorRunning}})
	token := s.beginChatRun(parentID)
	s.ChatMu.Lock()
	token.PendingAssistantID = "partial"
	token.RunStartedAtMS = time.Now().UnixMilli()
	token.Events = [][]byte{[]byte(`{"type":"delta","delta":"interrupted output"}`)}
	worker := &chatWorker{}
	worker.Mu.Lock()
	s.ChatWorkers[parentID] = worker
	s.ChatMu.Unlock()
	locked := true
	defer func() {
		if locked {
			worker.Mu.Unlock()
		}
	}()
	rr := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		s.chatCancel(rr, httptest.NewRequest(http.MethodPost, "/", nil), parentID)
		close(done)
	}()
	deadline := time.Now().Add(2 * time.Second)
	for !s.chatRunCanceled(parentID) && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if !s.chatRunCanceled(parentID) {
		t.Fatal("cancel did not reach worker handshake")
	}
	s.finishConductorChild(parentID, dispatchID, conductorSucceeded, "late answer", "")
	if s.processNextQueuedMessage(parentID) {
		t.Fatal("receipt admitted before cancelled output was saved")
	}
	worker.Mu.Unlock()
	locked = false
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("cancel handshake did not complete")
	}
	if rr.Code != http.StatusOK {
		t.Fatal(rr.Code, rr.Body.String())
	}
	waitConductorCompletionQueueStart(t, s, parentID, "conductor-"+dispatchID)
	got, err := loadChatSession(s.CfgStore.Snapshot(), parentID)
	if err != nil {
		t.Fatal(err)
	}
	if conductorParentPaused(got) || len(got.QueuedMessages) != 0 || len(got.Messages) != 2 || got.Messages[0].ID != "partial" || !strings.Contains(got.Messages[0].Content, "interrupted output") || got.Messages[0].ElapsedMS <= 0 {
		t.Fatalf("partial output or late receipt lost during handshake: %+v", got)
	}
}

func TestConductorPersistedCompletionResumesPausedQueueInFIFOOrder(t *testing.T) {
	for _, olderUser := range []bool{false, true} {
		name := "completion-first"
		if olderUser {
			name = "user-first"
		}
		t.Run(name, func(t *testing.T) {
			s := newChatLoopTestServer(t)
			sid := "persisted-parent"
			blockChatLoopTestWorker(t, s, sid)
			queue := []chatQueuedMessage{{ID: "receipt-a", Kind: "conductor_completion", Text: "A"}, {ID: "receipt-b", Kind: "conductor_completion", Text: "B"}}
			firstID, remaining := "receipt-a", 0
			if olderUser {
				queue = append([]chatQueuedMessage{{ID: "older-user", Text: "older question"}}, queue...)
				firstID, remaining = "older-user", 2
			}
			saveChatLoopTestSession(t, s, chatSession{ID: sid, Conductor: &chatConductorState{Role: conductorRoleParent, AutoResumePaused: true}, QueuedMessages: queue})
			rr := httptest.NewRecorder()
			s.chatCancel(rr, httptest.NewRequest(http.MethodPost, "/", nil), sid)
			if rr.Code != http.StatusOK {
				t.Fatal(rr.Code, rr.Body.String())
			}
			waitConductorCompletionQueueStart(t, s, sid, firstID)
			got, err := loadChatSession(s.CfgStore.Snapshot(), sid)
			if err != nil {
				t.Fatal(err)
			}
			if conductorParentPaused(got) || len(got.QueuedMessages) != remaining {
				t.Fatalf("durable completion did not unblock FIFO: %+v", got)
			}
			if olderUser {
				if !reflect.DeepEqual(got.QueuedMessages, queue[1:]) {
					t.Fatalf("FIFO receipt order changed: %+v", got.QueuedMessages)
				}
			} else {
				s.ChatMu.Lock()
				batched := chatRunContainsQueueID(s.ChatRuns[sid], "receipt-b")
				s.ChatMu.Unlock()
				if !batched {
					t.Fatal("adjacent persisted completions were not batched")
				}
			}
		})
	}
}

func TestConductorStoppedParentStillSchedulesQueuedWorker(t *testing.T) {
	s := newChatLoopTestServer(t)
	parentID, workerID, dispatchID := "scheduled-parent", "scheduled-worker", "scheduled-dispatch"
	blockChatLoopTestWorker(t, s, workerID)
	child := chatConductorChild{SessionID: workerID, DispatchID: dispatchID, Objective: "delegated task", Status: conductorQueued}
	saveChatLoopTestSession(t, s, chatSession{ID: parentID, Conductor: &chatConductorState{Role: conductorRoleParent, AutoResumePaused: true}, ConductorChildren: []chatConductorChild{child}})
	saveChatLoopTestSession(t, s, chatSession{ID: workerID, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: parentID, DispatchID: dispatchID, Status: conductorQueued}})
	s.SessionMu.Lock()
	if s.ChatRuntime.conductorOwned == nil {
		s.ChatRuntime.conductorOwned = make(map[string]bool)
	}
	s.ChatRuntime.conductorOwned[conductorOwnershipKey(parentID, workerID, dispatchID)] = true
	s.SessionMu.Unlock()
	s.beginChatRun(parentID)
	if _, err := s.cancelChatRun(parentID); err != nil {
		t.Fatal(err)
	}
	s.scheduleConductorChildren(parentID)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		worker, err := loadChatSession(s.CfgStore.Snapshot(), workerID)
		if err == nil && s.chatRunActive(workerID) && len(worker.Messages) == 2 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	worker, err := loadChatSession(s.CfgStore.Snapshot(), workerID)
	if err != nil {
		t.Fatal(err)
	}
	if worker.Conductor.Status != conductorRunning || !s.chatRunActive(workerID) || len(worker.Messages) != 2 {
		t.Fatalf("delegation did not start after parent stop: %+v", worker)
	}
	if s.chatRunActive(parentID) {
		t.Fatal("scheduling revived parent")
	}
}

func TestConductorExplicitAdmissionResumesPausedParent(t *testing.T) {
	for _, method := range []string{"post", "guide"} {
		t.Run(method, func(t *testing.T) {
			s := newChatLoopTestServer(t)
			sid := "resume-" + method
			blockChatLoopTestWorker(t, s, sid)
			receipt := chatQueuedMessage{ID: "saved-receipt", Kind: "conductor_completion", Text: "saved result"}
			queue := []chatQueuedMessage{receipt}
			if method == "guide" {
				queue = append(queue, chatQueuedMessage{ID: "manual-guide", Text: "continue"})
			}
			saveChatLoopTestSession(t, s, chatSession{ID: sid, Conductor: &chatConductorState{Role: conductorRoleParent, AutoResumePaused: true}, QueuedMessages: queue})
			if method == "guide" {
				// Guide cancels this run, then must reserve its requested item
				// rather than losing the reservation to the completion inbox.
				s.beginChatRun(sid)
			}
			rr := httptest.NewRecorder()
			if method == "post" {
				s.chatPostMode(rr, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"prompt":"continue"}`)), sid, true)
			} else {
				s.chatGuidePost(rr, httptest.NewRequest(http.MethodPost, "/", nil), sid, "manual-guide")
			}
			if rr.Code != http.StatusOK {
				t.Fatal(rr.Code, rr.Body.String())
			}
			got, err := loadChatSession(s.CfgStore.Snapshot(), sid)
			if err != nil {
				t.Fatal(err)
			}
			if conductorParentPaused(got) || !s.chatRunActive(sid) || len(got.QueuedMessages) != 1 || got.QueuedMessages[0].ID != receipt.ID {
				t.Fatalf("manual resume lost receipt: %+v", got)
			}
		})
	}
}

func TestConductorPausedParentBlocksLoopAndAutorun(t *testing.T) {
	for _, method := range []string{"loop", "autorun"} {
		t.Run(method, func(t *testing.T) {
			s := newChatLoopTestServer(t)
			sid := "paused-" + method
			cs := chatSession{ID: sid, Conductor: &chatConductorState{Role: conductorRoleParent, AutoResumePaused: true}}
			if method == "loop" {
				cs.Loop = chatLoopState{Enabled: true, Epoch: 8, Status: chatLoopStatusEvaluating}
			} else {
				cs.Autorun.Enabled = true
				cs.Autorun.NextRunAt = 1
			}
			saveChatLoopTestSession(t, s, cs)
			path := chatSessionPath(s.CfgStore.Snapshot(), sid)
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if method == "loop" {
				s.continueChatLoop(sid, 8, "automatic continue")
			} else if s.dispatchChatAutorun(sid, time.Now().Unix()) {
				t.Fatal("autorun ignored parent pause")
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if s.chatRunActive(sid) || !bytes.Equal(before, after) {
				t.Fatal("automatic continuation changed paused parent")
			}
		})
	}
}

func TestConductorUserAdmissionPreservesLateReceipt(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "admission-late-receipt"
	saveChatLoopTestSession(t, s, chatSession{ID: sid, Conductor: &chatConductorState{Role: conductorRoleParent, AutoResumePaused: true}})
	stale, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	latest, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	latest.QueuedMessages = []chatQueuedMessage{{ID: "late", Kind: "conductor_completion", Text: "late evidence"}}
	latest.ConductorChildren = []chatConductorChild{{DispatchID: "late", Status: conductorSucceeded, Result: "late result"}}
	saveChatLoopTestSession(t, s, latest)
	stale.Messages = append(stale.Messages, chatMessage{ID: "continue", Role: "user", Content: "continue"})
	s.SessionMu.Lock()
	err = s.saveConductorUserAdmissionLocked(&stale, false)
	s.SessionMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	got, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if conductorParentPaused(got) || !reflect.DeepEqual(got.QueuedMessages, latest.QueuedMessages) || !reflect.DeepEqual(got.ConductorChildren, latest.ConductorChildren) || len(got.Messages) != 1 {
		t.Fatalf("admission overwrote late evidence: %+v", got)
	}
}
