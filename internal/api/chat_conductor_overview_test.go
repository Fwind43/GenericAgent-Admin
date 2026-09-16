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
