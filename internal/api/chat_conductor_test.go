package api

import (
 "net/http"
 "net/http/httptest"
 "strings"
 "testing"
 "os"
 "path/filepath"
 "bytes"
)

func TestConductorCollectReplaysPersistedOutcome(t *testing.T) {
 s := newChatLoopTestServer(t)
 saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "dispatch", SessionID: "worker", Status: conductorSucceeded, Result: "verified", FinishedAt: 123}}})
 cfg := s.CfgStore.Snapshot()
 before, err := os.ReadFile(chatSessionPath(cfg, "parent"))
 if err != nil { t.Fatal(err) }
 outcome := filepath.Join(chatConductorBrokerDirForSession(chatSessionDir(cfg), "parent"), "dispatch.outcome.json")
 s.handleConductorCollectEvent("parent", map[string]interface{}{"dispatch_id": "unknown"})
 if _, err := os.Stat(outcome); !os.IsNotExist(err) { t.Fatalf("unexpected outcome: %v", err) }
 var first []byte
 for i := 0; i < 2; i++ {
  s.handleConductorCollectEvent("parent", map[string]interface{}{"dispatch_id": "dispatch"})
  data, err := os.ReadFile(outcome)
  if err != nil { t.Fatal(err) }
  if !bytes.Contains(data, []byte("verified")) { t.Fatalf("missing result: %s", data) }
  if i == 0 { first = data } else if !bytes.Equal(first, data) { t.Fatal("replay changed outcome") }
  after, err := os.ReadFile(chatSessionPath(cfg, "parent"))
  if err != nil { t.Fatal(err) }
  if !bytes.Equal(before, after) { t.Fatal("replay changed persisted session") }
 }
}

func TestConductorInvalidRelationshipDoesNotMutateWorker(t *testing.T) {
 s := newChatLoopTestServer(t)
 saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "dispatch", SessionID: "foreign", Status: conductorRunning}}})
 saveChatLoopTestSession(t, s, chatSession{ID: "foreign", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "other-parent", DispatchID: "other-dispatch", Status: conductorRunning}})
 s.finishConductorChild("parent", "dispatch", conductorSucceeded, "must not leak", "")
 worker, err := loadChatSession(s.CfgStore.Snapshot(), "foreign")
 if err != nil { t.Fatal(err) }
 if worker.Conductor.Status != conductorRunning || worker.Conductor.Error != "" || worker.Conductor.FinishedAt != 0 { t.Fatalf("foreign worker mutated: %+v", worker.Conductor) }
 parent, err := loadChatSession(s.CfgStore.Snapshot(), "parent")
 if err != nil { t.Fatal(err) }
 child := parent.ConductorChildren[0]
 if child.Status != conductorFailed || child.Result != "" { t.Fatalf("invalid relationship accepted: %+v", child) }
}

func TestConductorCancelDoesNotStopForeignRun(t *testing.T) {
 s := newChatLoopTestServer(t)
 saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "dispatch", SessionID: "foreign", Status: conductorRunning}}})
 saveChatLoopTestSession(t, s, chatSession{ID: "foreign", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "other-parent", DispatchID: "other-dispatch", Status: conductorRunning}})
 token := s.beginChatRun("foreign")
 if token == nil { t.Fatal("failed to start foreign run fixture") }
 defer s.endChatRunOwned("foreign", token)
 s.cancelConductorSession("parent")
 if !s.chatRunActive("foreign") || s.chatRunCanceled("foreign") { t.Fatal("parent cancellation stopped foreign run") }
 worker, err := loadChatSession(s.CfgStore.Snapshot(), "foreign")
 if err != nil { t.Fatal(err) }
 if worker.Conductor.Status != conductorRunning { t.Fatal("foreign worker state changed") }
 parent, err := loadChatSession(s.CfgStore.Snapshot(), "parent")
 if err != nil { t.Fatal(err) }
 if parent.ConductorChildren[0].Status != conductorFailed { t.Fatal("invalid relationship was not rejected") }
}

func TestConductorScheduleRejectsParentAsWorker(t *testing.T) {
 s := newChatLoopTestServer(t)
 saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "dispatch", SessionID: "wrong-role", Status: conductorQueued}}})
 saveChatLoopTestSession(t, s, chatSession{ID: "wrong-role", Conductor: &chatConductorState{Role: conductorRoleParent, ParentSessionID: "parent", DispatchID: "dispatch", Status: conductorQueued}})
 s.scheduleConductorChildren("parent")
 worker, err := loadChatSession(s.CfgStore.Snapshot(), "wrong-role")
 if err != nil { t.Fatal(err) }
 if worker.Conductor.Status != conductorQueued || worker.Conductor.StartedAt != 0 || worker.Conductor.FinishedAt != 0 { t.Fatalf("invalid worker mutated: %+v", worker.Conductor) }
 parent, err := loadChatSession(s.CfgStore.Snapshot(), "parent")
 if err != nil { t.Fatal(err) }
 if parent.ConductorChildren[0].Status != conductorFailed { t.Fatal("invalid worker was not rejected") }
 if s.chatRunActive("wrong-role") { t.Fatal("invalid worker launched") }
}

func TestConductorStaleSnapshotPreservesState(t *testing.T) {
 for _, exact := range []bool{false, true} {
  s := newChatLoopTestServer(t)
  latest := chatSession{ID: "stale", Conductor: &chatConductorState{Role: conductorRoleWorker, Status: conductorCancelled, ParentSessionID: "parent", DispatchID: "dispatch"}, ConductorChildren: []chatConductorChild{{DispatchID: "child", Status: conductorSucceeded, Result: "kept"}}}
  saveChatLoopTestSession(t, s, latest)
  stale := chatSession{ID: latest.ID, Conductor: &chatConductorState{Role: conductorRoleWorker, Status: conductorRunning}}
  var err error
  if exact { err = s.saveChatSessionExact(stale) } else { err = s.saveChatSessionMerged(stale) }
  if err != nil { t.Fatal(err) }
  saved, err := loadChatSession(s.CfgStore.Snapshot(), latest.ID)
  if err != nil { t.Fatal(err) }
  if saved.Conductor == nil || saved.Conductor.Status != conductorCancelled || saved.Conductor.DispatchID != "dispatch" || len(saved.ConductorChildren) != 1 || saved.ConductorChildren[0].Result != "kept" { t.Fatalf("exact=%v: stale snapshot overwrote state: %+v", exact, saved) }
 }
}

func TestConductorCancelQueuedChildPersists(t *testing.T) {
 s := newChatLoopTestServer(t)
 saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "dispatch", SessionID: "worker", Status: conductorQueued}}})
 saveChatLoopTestSession(t, s, chatSession{ID: "worker", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "parent", DispatchID: "dispatch", Status: conductorQueued}})
 var finished int64
 for i := 0; i < 2; i++ {
  w := httptest.NewRecorder()
  s.chatCancel(w, httptest.NewRequest(http.MethodPost, "/api/chat/cancel/parent", nil), "parent")
  if w.Code != http.StatusOK { t.Fatalf("cancel: %d %s", w.Code, w.Body.String()) }
  parent, err := loadChatSession(s.CfgStore.Snapshot(), "parent")
  if err != nil { t.Fatal(err) }
  worker, err := loadChatSession(s.CfgStore.Snapshot(), "worker")
  if err != nil { t.Fatal(err) }
  child := parent.ConductorChildren[0]
  if child.Status != conductorCancelled || worker.Conductor.Status != conductorCancelled { t.Fatal("cancel did not persist to both sessions") }
  if i == 0 { finished = child.FinishedAt } else if child.FinishedAt != finished { t.Fatal("repeated cancel changed terminal timestamp") }
 }
}

func TestConductorCancelQueuedWriteFailure(t *testing.T) {
 s := newChatLoopTestServer(t)
 saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "dispatch", SessionID: "worker", Status: conductorQueued}}})
 saveChatLoopTestSession(t, s, chatSession{ID: "worker", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "parent", DispatchID: "dispatch", Status: conductorQueued}})
 path := chatSessionPath(s.CfgStore.Snapshot(), "worker")
 before, err := os.ReadFile(path)
 if err != nil { t.Fatal(err) }
 if err := os.Chmod(path, 0444); err != nil { t.Fatal(err) }
 defer os.Chmod(path, 0644)
 // Only assert failure semantics on platforms enforcing read-only replacement.
 if err := writeChatFileAtomic(path, before, 0444); err == nil { t.Skip("platform permits replacing read-only files") }
 s.cancelConductorSession("parent")
 parent, err := loadChatSession(s.CfgStore.Snapshot(), "parent")
 if err != nil { t.Fatal(err) }
 if parent.ConductorChildren[0].Status != conductorQueued { t.Fatal("failed write published a terminal child") }
 after, err := os.ReadFile(path)
 if err != nil { t.Fatal(err) }
 if !bytes.Equal(before, after) { t.Fatal("failed write mutated worker") }
 if err := os.Chmod(path, 0644); err != nil { t.Fatal(err) }
 s.cancelConductorSession("parent")
 parent, err = loadChatSession(s.CfgStore.Snapshot(), "parent")
 if err != nil { t.Fatal(err) }
 if parent.ConductorChildren[0].Status != conductorCancelled { t.Fatal("retry did not cancel child") }
}

func TestConductorCancelQueuedRejectsWrongRole(t *testing.T) {
 s := newChatLoopTestServer(t)
 saveChatLoopTestSession(t, s, chatSession{ID: "parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "dispatch", SessionID: "foreign", Status: conductorQueued}}})
 saveChatLoopTestSession(t, s, chatSession{ID: "foreign", Conductor: &chatConductorState{Role: conductorRoleParent, ParentSessionID: "parent", DispatchID: "dispatch", Status: conductorQueued}})
 path := chatSessionPath(s.CfgStore.Snapshot(), "foreign")
 before, err := os.ReadFile(path)
 if err != nil { t.Fatal(err) }
 s.cancelConductorSession("parent")
 after, err := os.ReadFile(path)
 if err != nil { t.Fatal(err) }
 if !bytes.Equal(before, after) { t.Fatal("cancel mutated a non-worker session") }
 parent, err := loadChatSession(s.CfgStore.Snapshot(), "parent")
 if err != nil { t.Fatal(err) }
 if parent.ConductorChildren[0].Status != conductorFailed { t.Fatal("invalid relationship was not rejected") }
}

func TestConductorTerminalWorkerRejectsLateStart(t *testing.T) {
 for _, status := range []string{conductorCancelled, conductorSucceeded, conductorFailed} {
  t.Run(status, func(t *testing.T) {
   s := newChatLoopTestServer(t)
   sid := "conductor-late-" + status
   saveChatLoopTestSession(t, s, chatSession{ID: sid, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "parent", DispatchID: "dispatch", Status: status}})
   w := httptest.NewRecorder()
   r := httptest.NewRequest(http.MethodPost, "/api/chat/"+sid, strings.NewReader(`{"prompt":"late start"}`))
   s.chatPostMode(w, r, sid, true)
   if w.Code != http.StatusConflict { t.Fatalf("status=%d body=%s", w.Code, w.Body.String()) }
   if s.chatRunActive(sid) { t.Fatal("rejected dispatch left an active run") }
   cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
   if err != nil { t.Fatal(err) }
   if cs.Conductor.Status != status || len(cs.Messages) != 0 { t.Fatalf("rejected dispatch mutated session: %+v", cs) }
  })
 }
}
