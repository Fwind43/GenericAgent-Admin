package api

import (
 "encoding/json"
 "fmt"
 "reflect"
 "strings"
 "testing"
)

func TestConductorTaskOverviewMixedAndRebuilt(t *testing.T) {
 s := newChatLoopTestServer(t)
 children := []chatConductorChild{}
 for i, status := range []string{"failed", "cancelled", "queued", "running", "succeeded", "succeeded", "succeeded"} {
  child := chatConductorChild{DispatchID: fmt.Sprint(i), SessionID: fmt.Sprint(i), Status: status}
  if i == 5 { child.Review = &conductorReview{Status: "needs_work"} }
  if i == 6 { child.Review = &conductorReview{Status: "verified"} }
  children = append(children, child)
 }
 for i := 7; i < 65; i++ { children = append(children, chatConductorChild{DispatchID: fmt.Sprint(i), SessionID: fmt.Sprint(i), Status: conductorRunning}) }
 children = append(children, chatConductorChild{DispatchID: "retry", SessionID: "0", Status: conductorRunning})
 original, _ := json.Marshal(children)
 cs := chatSession{ID: "overview", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: children}
 saveChatLoopTestSession(t, s, cs)
 loaded, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID); if err != nil { t.Fatal(err) }
 for _, kind := range []string{"user", "conductor_completion"} {
  req := map[string]interface{}{"input_kind": kind}
  if err := s.prepareConductorWorkerRequest(loaded, req); err != nil { t.Fatal(err) }
  rows := req["conductor"].(map[string]interface{})["tasks"].([]map[string]interface{})
  if len(rows) != 66 { t.Fatalf("lost dispatches: %d", len(rows)) }
  byID := map[string]map[string]interface{}{}
  for _, row := range rows { byID[row["dispatch_id"].(string)] = row }
  for i := 0; i < 66; i++ { if i < 65 && byID[fmt.Sprint(i)] == nil { t.Fatal("missing", i) } }
  for _, id := range []string{"0", "1", "2", "3", "4", "5", "retry"} { if byID[id]["resolved"] != false { t.Fatal("incorrect resolution", id) } }
  if byID["4"]["review_status"] != "pending" || byID["5"]["review_status"] != "needs_work" || byID["6"]["resolved"] != true { t.Fatal("review projection") }
  if byID["retry"]["previous_session_dispatch_id"] != "0" || byID["0"]["reusable"] != false { t.Fatal("session history/reuse") }
  prompt := req["extra_sys_prompts"].([]string)
  var page struct { Total int; Omitted int; Tasks []map[string]interface{} }
  text := prompt[len(prompt)-1]; at := strings.Index(text, "\n")
  if err := json.Unmarshal([]byte(text[at+1:]), &page); err != nil { t.Fatal(err) }
  if page.Total != 66 || page.Omitted != 18 || len(page.Tasks) != 48 { t.Fatal("unbounded or silent truncation", page) }
 }
 after, _ := json.Marshal(children); if string(original) != string(after) { t.Fatal("projection mutated tasks") }
}

func TestConductorSchedulerAccounting(t *testing.T) {
 cases := []struct {
  name string
  statuses []string
  active, queued, nonTerminal int
 }{
  {name: "empty"},
  {name: "mixed", statuses: []string{conductorRunning, "cancelling", conductorQueued, "unknown", conductorSucceeded, conductorFailed, conductorCancelled}, active: 2, queued: 1, nonTerminal: 4},
  {name: "terminal_unreviewed", statuses: []string{conductorSucceeded, conductorFailed, conductorCancelled}},
 }
 for _, tc := range cases { t.Run(tc.name, func(t *testing.T) {
  children := make([]chatConductorChild, len(tc.statuses))
  for i, status := range tc.statuses {
   children[i] = chatConductorChild{Status: status, Review: &conductorReview{Status: "needs_work"}}
  }
  before, _ := json.Marshal(children)
  got := conductorSchedulerOverview(children, effectiveConductorLimits(nil))
  want := conductorSchedulerSnapshot{Scope: "parent_session", Snapshot: "parent_request", MaxRunning: conductorMaxRunning, MaxNonTerminal: conductorMaxPerParentTurn, ActiveSlots: tc.active, Queued: tc.queued, NonTerminal: tc.nonTerminal}
  if got != want { t.Fatalf("scheduler = %+v, want %+v", got, want) }
  after, _ := json.Marshal(children)
  if string(before) != string(after) { t.Fatal("scheduler projection mutated dispatches") }
  wire, _ := json.Marshal(got)
  for _, key := range []string{"scope", "snapshot", "max_running", "max_non_terminal", "active_slots", "queued", "non_terminal"} {
   if !strings.Contains(string(wire), `"`+key+`":`) { t.Fatal("omitted field", key, string(wire)) }
  }
 }) }
}

func TestConductorSchedulerRequestFreshnessAndIsolation(t *testing.T) {
 s := newChatLoopTestServer(t)
 cs := chatSession{ID: "scheduler-parent", Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{
  {DispatchID: "active", Status: conductorRunning},
  {DispatchID: "stopping", Status: "cancelling"},
  {DispatchID: "waiting", Status: conductorQueued},
  {DispatchID: "failed-unreviewed", Status: conductorFailed},
 }}
 // More than one task page: scheduler counts must cover the whole roster.
 for i := 0; i < 60; i++ { cs.ConductorChildren = append(cs.ConductorChildren, chatConductorChild{DispatchID: fmt.Sprint(i), Status: conductorSucceeded}) }
 saveChatLoopTestSession(t, s, cs)
 check := func(session chatSession, kind string, active, nonTerminal int) conductorSchedulerSnapshot {
  t.Helper()
  req := map[string]interface{}{"input_kind": kind}
  if err := s.prepareConductorWorkerRequest(session, req); err != nil { t.Fatal(err) }
  conf := req["conductor"].(map[string]interface{})
  got := conf["scheduler"].(conductorSchedulerSnapshot)
  if got.ActiveSlots != active || got.Queued != 1 || got.NonTerminal != nonTerminal { t.Fatalf("stale scheduler: %+v", got) }
  wire, err := json.Marshal(req); if err != nil { t.Fatal(err) }
  var roundTrip struct { Conductor struct { Scheduler conductorSchedulerSnapshot `json:"scheduler"` } `json:"conductor"` }
  if err := json.Unmarshal(wire, &roundTrip); err != nil { t.Fatal(err) }
  if roundTrip.Conductor.Scheduler != got { t.Fatal("scheduler lost over worker wire") }
  schedulerJSON, _ := json.Marshal(got)
  var schedulerPrompt string
  for _, prompt := range req["extra_sys_prompts"].([]string) {
   if strings.HasPrefix(prompt, "Admin scheduler rules and counts") { schedulerPrompt = prompt }
  }
  if !strings.HasSuffix(schedulerPrompt, "\n"+string(schedulerJSON)) { t.Fatal("missing in-model scheduler snapshot", schedulerPrompt) }
  for _, text := range []string{"not a global or model-provider quota", "running and cancelling", "NOT lifetime dispatches or tasks per model turn", "even if review remains unresolved", "reaching max_non_terminal rejects", "Queued is accepted, not failed", "recovery or parent ownership", "NOT live within this turn"} {
   if !strings.Contains(schedulerPrompt, text) { t.Fatal("missing scheduler semantics", text) }
  }
  return got
 }
 loaded, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID); if err != nil { t.Fatal(err) }
 before, _ := json.Marshal(loaded)
 for _, kind := range []string{"user", "conductor_completion"} { check(loaded, kind, 2, 3) }
 again, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID); if err != nil { t.Fatal(err) }
 after, _ := json.Marshal(again)
 if string(before) != string(after) { t.Fatal("preparing scheduler changed persistent state") }
 loaded.ConductorChildren[0].Status = conductorSucceeded
 saveChatLoopTestSession(t, s, loaded)
 loaded, err = loadChatSession(s.CfgStore.Snapshot(), cs.ID); if err != nil { t.Fatal(err) }
 check(loaded, "conductor_completion", 1, 2)
 req := map[string]interface{}{}
 other := chatSession{ID: "scheduler-other", Conductor: &chatConductorState{Role: conductorRoleParent}}
 if err := s.prepareConductorWorkerRequest(other, req); err != nil { t.Fatal(err) }
 if got := req["conductor"].(map[string]interface{})["scheduler"].(conductorSchedulerSnapshot); got.ActiveSlots != 0 || got.NonTerminal != 0 || got.Queued != 0 { t.Fatal("cross-parent scheduler leak", got) }
 for _, role := range []string{"", conductorRoleWorker} {
  session := chatSession{ID: "scheduler-nonparent"}
  if role != "" { session.Conductor = &chatConductorState{Role: role, Status: conductorRunning, ParentSessionID: cs.ID, DispatchID: "worker"} }
  req = map[string]interface{}{}
  if err := s.prepareConductorWorkerRequest(session, req); err != nil { t.Fatal(err) }
  if conf, ok := req["conductor"].(map[string]interface{}); ok && conf["scheduler"] != nil { t.Fatal("non-parent received scheduler", req) }
  if strings.Contains(fmt.Sprint(req["extra_sys_prompts"]), "Admin scheduler rules") { t.Fatal("non-parent received scheduler prompt") }
 }
}

func TestConductorFailurePreservesSiblingOverview(t *testing.T) {
 s := newChatLoopTestServer(t)
 token := s.beginChatRun("overview-parent"); defer s.endChatRunOwned("overview-parent", token)
 children := []chatConductorChild{{DispatchID:"bad", SessionID:"bad-worker", Status:conductorRunning}, {DispatchID:"sibling", SessionID:"sibling-worker", Status:conductorRunning}}
 saveChatLoopTestSession(t,s,chatSession{ID:"overview-parent",Conductor:&chatConductorState{Role:conductorRoleParent},ConductorChildren:children})
 saveChatLoopTestSession(t,s,chatSession{ID:"bad-worker",Conductor:&chatConductorState{Role:conductorRoleWorker,ParentSessionID:"overview-parent",DispatchID:"bad",Status:conductorRunning}})
 s.finishConductorChild("overview-parent","bad",conductorFailed,"","test failure")
 loaded,err:=loadChatSession(s.CfgStore.Snapshot(),"overview-parent"); if err!=nil {t.Fatal(err)}
 if !reflect.DeepEqual(loaded.ConductorChildren[1],children[1]) {t.Fatal("failure changed sibling")}
 if len(loaded.QueuedMessages)!=1 {t.Fatal("missing persisted wakeup")}
 req:=map[string]interface{}{"input_kind":"conductor_completion"}
 if err:=s.prepareConductorWorkerRequest(loaded,req);err!=nil {t.Fatal(err)}
 rows:=req["conductor"].(map[string]interface{})["tasks"].([]map[string]interface{})
 if len(rows)!=2 || rows[0]["status"]!=conductorRunning || rows[1]["status"]!=conductorFailed {t.Fatal(rows)}
}
