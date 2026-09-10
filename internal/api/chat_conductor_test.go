package api

import (
 "encoding/json"
 "net/http"
 "net/http/httptest"
 "strings"
 "testing"
 "os"
 "path/filepath"
 "bytes"
)

func TestConductorUsageSummaryEndpoint(t *testing.T) {
 s := newChatLoopTestServer(t)
 saveChatLoopTestSession(t, s, chatSession{ID: "summary-parent", Conductor: &chatConductorState{Role: conductorRoleParent},
  Messages: []chatMessage{{Role: "assistant", Usage: map[string]int{"input_tokens": 10, "output_tokens": 2}}},
  ConductorChildren: []chatConductorChild{
   {DispatchID: "first", SessionID: "same-worker", Status: conductorSucceeded, Usage: &conductorUsage{PromptTokens: 20, OutputTokens: 3, ObservedCalls: 1}},
   {DispatchID: "second", SessionID: "same-worker", Status: conductorFailed, Usage: &conductorUsage{PromptTokens: 30, OutputTokens: 4, ObservedCalls: 1}},
   {DispatchID: "running", Status: conductorRunning},
   {DispatchID: "legacy", Status: conductorSucceeded},
  },
 })
 recorder := httptest.NewRecorder()
 s.chatConductorChildren(recorder, httptest.NewRequest(http.MethodGet, "/", nil), "summary-parent")
 if recorder.Code != http.StatusOK { t.Fatalf("status: %d: %s", recorder.Code, recorder.Body.String()) }
 var response struct {
  Usage conductorUsageSummary `json:"usage_summary"`
  Limit int `json:"dispatch_limit"`
  Count int `json:"dispatch_count"`
 }
 if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil { t.Fatal(err) }
 if response.Limit != conductorMaxDispatchesPerSession || response.Count != 4 { t.Fatalf("limits: %+v", response) }
 if response.Usage.Parent.PromptTokens != 10 || response.Usage.Children.PromptTokens != 50 || response.Usage.Total.PromptTokens != 60 || response.Usage.Total.OutputTokens != 9 || response.Usage.Total.ObservedCalls != 3 || response.Usage.MissingDispatches != 2 {
  t.Fatalf("summary: %+v", response.Usage)
 }
}

func TestConductorDispatchLimitAccepts48Rejects49(t *testing.T) {
 s := newChatLoopTestServer(t)
 if s.beginChatRun("boundary-parent") == nil { t.Fatal("parent run not started") }
 children := make([]chatConductorChild, conductorMaxDispatchesPerSession-1)
 for i := range children {
  children[i] = chatConductorChild{Status: conductorSucceeded}
  if i < conductorMaxRunning { children[i].Status = conductorRunning }
 }
 saveChatLoopTestSession(t, s, chatSession{ID: "boundary-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: children})
 child, err := s.dispatchConductorWithOptions("boundary-parent", "boundary task", conductorDispatchOptions{})
 if err != nil { t.Fatalf("48th dispatch: %v", err) }
 parent, err := loadChatSession(s.CfgStore.Snapshot(), "boundary-parent")
 if err != nil { t.Fatal(err) }
 if len(parent.ConductorChildren) != 48 || child.Status != conductorQueued { t.Fatalf("48th not accepted: %+v", child) }
 worker, err := loadChatSession(s.CfgStore.Snapshot(), child.SessionID)
 if err != nil { t.Fatal(err) }
 if worker.Conductor == nil || worker.Conductor.DispatchID != child.DispatchID { t.Fatal("worker not persisted") }
 path := chatSessionPath(s.CfgStore.Snapshot(), parent.ID)
 before, err := os.ReadFile(path); if err != nil { t.Fatal(err) }
 if _, err = s.dispatchConductorWithOptions(parent.ID, "one too many", conductorDispatchOptions{}); err == nil || !strings.Contains(err.Error(), "cumulative") { t.Fatalf("49th dispatch: %v", err) }
 after, err := os.ReadFile(path); if err != nil { t.Fatal(err) }
 if !bytes.Equal(before, after) { t.Fatal("49th dispatch changed parent") }
}

func TestConductorCumulativeDispatchLimitPreservesSession(t *testing.T) {
 s := newChatLoopTestServer(t)
 if s.beginChatRun("limit-parent") == nil { t.Fatal("parent run not started") }
 children := make([]chatConductorChild, 48)
 statuses := []string{conductorSucceeded, conductorFailed, conductorCancelled}
 for i := range children {
  children[i] = chatConductorChild{SessionID: "reused-worker", Status: statuses[i%len(statuses)]}
 }
 saveChatLoopTestSession(t, s, chatSession{ID: "limit-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: children})
 path := chatSessionPath(s.CfgStore.Snapshot(), "limit-parent")
 before, err := os.ReadFile(path)
 if err != nil { t.Fatal(err) }
 for _, reuse := range []string{"", "reused-worker", "reused-worker"} {
  _, err := s.dispatchConductor("limit-parent", "continue task", reuse)
  if err == nil || !strings.Contains(err.Error(), "cumulative dispatch limit") { t.Fatalf("expected cumulative limit, got %v", err) }
  after, readErr := os.ReadFile(path)
  if readErr != nil || !bytes.Equal(before, after) { t.Fatal("rejected dispatch mutated parent") }
 }
}

func TestConductorMessageUsageMixedProtocols(t *testing.T) {
 messages := []chatMessage{
  {Role: "user", Usage: map[string]int{"input_tokens": 999}},
  {Role: "assistant", Usage: map[string]int{"input_tokens": 9999}, Usages: []map[string]int{
   {"input_tokens": 100, "cache_read_tokens": 60, "output_tokens": 10, "input_tokens_include_cache_read": 1},
   {"input_tokens": 20, "cache_read_tokens": 30, "cache_creation_tokens": 40, "output_tokens": 5, "input_tokens_include_cache_read": 0},
  }},
  {Role: "assistant", Error: true, Usage: map[string]int{"input_tokens": 50, "cached_tokens": 20, "cache_read_tokens": 0, "output_tokens": 2}},
  {Role: "assistant", Usage: map[string]int{"input_tokens": -5, "output_tokens": -1}},
 }
 got := conductorMessageUsage(messages)
 want := conductorUsage{PromptTokens: 240, OutputTokens: 17, CacheReadTokens: 110, CacheCreationTokens: 40, ObservedCalls: 4}
 if got != want { t.Fatalf("usage = %+v, want %+v", got, want) }
 if empty := conductorMessageUsage(nil); empty != (conductorUsage{}) { t.Fatalf("empty = %+v", empty) }
}

func TestConductorEvidenceDispatchIsolation(t *testing.T) {
 start := 1
 message := chatMessage{ID: "current", Role: "assistant", StructuredContent: []map[string]interface{}{
  {"type": "tool_result", "tool_use_id": "orphan", "content": "unpaired"},
  {"type": "tool_use", "id": "call", "name": "code_run"},
  {"type": "tool_result", "tool_use_id": "call", "content": "tests passed"},
  {"type": "tool_result", "tool_use_id": "call", "content": "duplicate"},
 }}
 worker := chatSession{Messages: []chatMessage{message, message}}
 child := chatConductorChild{DispatchID: "new", MessageStart: &start}
 evidence := conductorCollectEvidence(child, worker)
 if len(evidence) != 1 || evidence[0].ID != "new:0" || evidence[0].Tool != "code_run" { t.Fatalf("unexpected evidence: %+v", evidence) }
 child.MessageStart = nil
 if len(conductorCollectEvidence(child, worker)) != 0 { t.Fatal("legacy dispatch acquired evidence") }
 child.MessageStart = &start
 worker.Messages[1].Error = true
 if len(conductorCollectEvidence(child, worker)) != 0 { t.Fatal("error message acquired evidence") }
}

func TestConductorReviewPersistsAndCollects(t *testing.T) {
 s := newChatLoopTestServer(t)
 if s.beginChatRun("review-parent") == nil { t.Fatal("parent run not started") }
 child := chatConductorChild{DispatchID: "dispatch", SessionID: "worker", Status: conductorSucceeded,
  Review: conductorInitialReview(conductorSucceeded), Evidence: []conductorEvidence{{ID: "dispatch:0", MessageID: "m", Tool: "code_run", Result: "tests passed"}}}
 saveChatLoopTestSession(t, s, chatSession{ID: "review-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{child}})
 cfg := s.CfgStore.Snapshot()
 path := chatSessionPath(cfg, "review-parent")
 before, err := os.ReadFile(path)
 if err != nil { t.Fatal(err) }
 for _, review := range []conductorReview{
  {Status: "verified", Basis: "worker says done"},
  {Status: "verified", Basis: "forged", EvidenceIDs: []string{"other:0"}},
  {Status: "verified", EvidenceIDs: []string{"dispatch:0"}},
 } {
  if _, err := s.reviewConductorChild("review-parent", "dispatch", review); err == nil { t.Fatalf("accepted invalid review: %+v", review) }
 }
 after, err := os.ReadFile(path)
 if err != nil || !bytes.Equal(before, after) { t.Fatal("rejected review mutated session") }
 review := conductorReview{Status: "verified", Basis: "Persisted test output supports the tested behavior", EvidenceIDs: []string{"dispatch:0"}, Unverified: "Production not exercised"}
 got, err := s.reviewConductorChild("review-parent", "dispatch", review)
 if err != nil || got.Review.Reviewer != "parent_agent" { t.Fatalf("review failed: %+v %v", got, err) }
 saved, err := loadChatSession(cfg, "review-parent")
 if err != nil || saved.ConductorChildren[0].Review.Status != "verified" { t.Fatalf("review not persisted: %v", err) }
 s.handleConductorCollectEvent("review-parent", map[string]interface{}{"dispatch_id": "dispatch"})
 outcome := filepath.Join(chatConductorBrokerDirForSession(chatSessionDir(cfg), "review-parent"), "dispatch.outcome.json")
 data, err := os.ReadFile(outcome)
 if err != nil || !bytes.Contains(data, []byte("parent_agent")) || !bytes.Contains(data, []byte("Production not exercised")) { t.Fatalf("collect lost review: %s %v", data, err) }
}

func TestConductorReviewBrokerReplayPreservesSession(t *testing.T) {
 s := newChatLoopTestServer(t)
 if s.beginChatRun("review-parent") == nil { t.Fatal("parent run not started") }
 start := 0
 child := chatConductorChild{DispatchID: "dispatch", SessionID: "worker", Status: conductorRunning, MessageStart: &start}
 saveChatLoopTestSession(t, s, chatSession{ID: "review-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{child}})
 worker := chatSession{ID: "worker", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "review-parent", DispatchID: "dispatch", Status: conductorRunning}, Messages: []chatMessage{{ID: "receipt", Role: "assistant", StructuredContent: []map[string]interface{}{
  {"type": "tool_use", "id": "call", "name": "code_run"},
  {"type": "tool_result", "tool_use_id": "call", "content": "tests passed"},
  {"type": "text", "text": "I verified everything"},
 }}}}
 saveChatLoopTestSession(t, s, worker)
 s.syncConductorTerminal(worker)
 cfg := s.CfgStore.Snapshot()
 pending, err := loadChatSession(cfg, "review-parent")
 if err != nil { t.Fatal(err) }
 completed := pending.ConductorChildren[0]
 if completed.Status != conductorSucceeded || completed.Review == nil || completed.Review.Status != "pending" { t.Fatalf("execution implied verification: %+v", completed) }
 if len(completed.Evidence) != 1 || completed.Evidence[0].ID != "dispatch:0" || completed.Evidence[0].Result != `"tests passed"` { t.Fatalf("terminal evidence missing: %+v", completed.Evidence) }
 dir := chatConductorBrokerDirForSession(chatSessionDir(cfg), "review-parent")
 event := map[string]interface{}{"request_id": "review-request", "broker_dir": dir, "dispatch_id": "dispatch", "status": "verified", "basis": "Persisted test receipt", "evidence_ids": []string{"dispatch:0"}}
 s.handleConductorReviewEvent("review-parent", event)
 responsePath := filepath.Join(dir, "review-request.response.json")
 response, err := os.ReadFile(responsePath)
 if err != nil || !bytes.Contains(response, []byte(`"ok":true`)) { t.Fatalf("broker response: %s %v", response, err) }
 saved, err := loadChatSession(cfg, "review-parent")
 if err != nil || saved.ConductorChildren[0].Review == nil || saved.ConductorChildren[0].Review.Status != "verified" { t.Fatalf("review not persisted: %v", err) }
 saved.UpdatedAt = 1
 if err := saveChatSessionPreserveUpdatedAtLocked(cfg, saved); err != nil { t.Fatal(err) }
 before, err := os.ReadFile(chatSessionPath(cfg, "review-parent"))
 if err != nil { t.Fatal(err) }
 s.handleConductorReviewEvent("review-parent", event)
 after, err := os.ReadFile(chatSessionPath(cfg, "review-parent"))
 if err != nil || !bytes.Equal(before, after) { t.Fatal("replayed review mutated persisted session") }
 replay, err := os.ReadFile(responsePath)
 if err != nil || !bytes.Equal(response, replay) { t.Fatal("replayed response changed") }
}

func TestConductorTerminalUsageSnapshotIsolation(t *testing.T) {
 s := newChatLoopTestServer(t)
 if s.beginChatRun("usage-parent") == nil { t.Fatal("parent run not started") }
 start := 1
 child := chatConductorChild{DispatchID: "dispatch", SessionID: "usage-worker", Status: conductorRunning, MessageStart: &start}
 saveChatLoopTestSession(t, s, chatSession{ID: "usage-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{child}})
 saveChatLoopTestSession(t, s, chatSession{ID: "usage-worker", Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: "usage-parent", DispatchID: "dispatch"}, Messages: []chatMessage{
  {Role: "assistant", Usage: map[string]int{"input_tokens": 9000}},
  {Role: "assistant", Error: true, Usage: map[string]int{"input_tokens": 10, "output_tokens": 3}},
 }})
 s.finishConductorChild("usage-parent", "dispatch", conductorFailed, "", "failed after usage")
 cfg := s.CfgStore.Snapshot()
 saved, err := loadChatSession(cfg, "usage-parent")
 if err != nil { t.Fatal(err) }
 usage := saved.ConductorChildren[0].Usage
 if usage == nil || usage.PromptTokens != 10 || usage.OutputTokens != 3 || usage.ObservedCalls != 1 { t.Fatalf("snapshot = %+v", usage) }
 path := chatSessionPath(cfg, "usage-parent")
 before, err := os.ReadFile(path)
 if err != nil { t.Fatal(err) }
 s.finishConductorChild("usage-parent", "dispatch", conductorFailed, "", "replay")
 after, err := os.ReadFile(path)
 if err != nil || !bytes.Equal(before, after) { t.Fatal("terminal replay changed snapshot") }
}

func TestConductorExecutionIsNotVerification(t *testing.T) {
 for _, status := range []string{conductorQueued, conductorRunning, conductorFailed, conductorCancelled} {
  if conductorInitialReview(status) != nil { t.Fatalf("%s acquired a review", status) }
 }
 review := conductorInitialReview(conductorSucceeded)
 if review == nil || review.Status != "pending" || review.Basis != "" || review.Unverified == "" { t.Fatalf("execution implied verification: %+v", review) }
 s := newChatLoopTestServer(t)
 saveChatLoopTestSession(t, s, chatSession{ID: "review-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: "review-dispatch", Status: conductorSucceeded, Result: "I verified everything", Review: review}}})
 saved, err := loadChatSession(s.CfgStore.Snapshot(), "review-parent")
 if err != nil { t.Fatal(err) }
 got := saved.ConductorChildren[0].Review
 if got == nil || got.Status != "pending" || got.Basis != "" { t.Fatalf("self report became evidence: %+v", got) }
}

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
   s.chatPostWithSender(w, r, sid, true, "conductor")
   if w.Code != http.StatusConflict { t.Fatalf("status=%d body=%s", w.Code, w.Body.String()) }
   if s.chatRunActive(sid) { t.Fatal("rejected dispatch left an active run") }
   cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
   if err != nil { t.Fatal(err) }
   if cs.Conductor.Status != status || len(cs.Messages) != 0 { t.Fatalf("rejected dispatch mutated session: %+v", cs) }
  })
 }
}
