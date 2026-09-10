package api

import (
 "testing"
 "net/http/httptest"
 "strings"
 "reflect"
)

func TestConductorDisableRoundTrip(t *testing.T) {
 s:=newChatLoopTestServer(t); cfg:=s.CfgStore.Snapshot()
 worker:=chatSession{ID:"w",Conductor:&chatConductorState{Role:conductorRoleWorker,Status:conductorSucceeded}}
 if err:=saveChatSession(cfg,worker);err!=nil{t.Fatal(err)}
 cs:=chatSession{ID:"p",Conductor:&chatConductorState{Role:conductorRoleParent},ConductorChildren:[]chatConductorChild{{SessionID:"w",DispatchID:"d",Status:conductorSucceeded,Review:&conductorReview{Status:"verified"}}}}
 if err:=saveChatSession(cfg,cs);err!=nil{t.Fatal(err)}
 out,err:=s.disableChatConductor("p");if err!=nil{t.Fatal(err)}
 if out.Conductor.Role!="" || !reflect.DeepEqual(out.ConductorChildren,cs.ConductorChildren){t.Fatal(out)}
 req:=map[string]interface{}{};if err=s.prepareConductorWorkerRequest(out,req);err!=nil{t.Fatal(err)}
 if len(req)!=0{t.Fatal(req)}
 before,_:=loadChatSession(cfg,"p");_,err=s.disableChatConductor("p");after,_:=loadChatSession(cfg,"p")
 if err!=nil || !reflect.DeepEqual(before,after){t.Fatal("not idempotent",err)}
 w:=httptest.NewRecorder();s.chatConductorChildren(w,httptest.NewRequest("GET","/",nil),"p")
 if w.Code!=200 || !strings.Contains(w.Body.String(),"verified"){t.Fatal(w.Body.String())}
 out,err=s.enableChatConductor("p");if err!=nil || out.Conductor.Role!=conductorRoleParent || !reflect.DeepEqual(out.ConductorChildren,cs.ConductorChildren){t.Fatal(out,err)}
}

func TestConductorDisableBlockers(t *testing.T) {
 for _,kind:=range []string{"parent-run","parent-queue","dispatch","review","worker-run","worker-queue","worker-state","worker-role"}{t.Run(kind,func(t *testing.T){
 s:=newChatLoopTestServer(t);cfg:=s.CfgStore.Snapshot()
 cs:=chatSession{ID:"p",Conductor:&chatConductorState{Role:conductorRoleParent},ConductorChildren:[]chatConductorChild{{SessionID:"w",DispatchID:"d",Status:conductorSucceeded,Review:&conductorReview{Status:"verified"}}}}
 worker:=chatSession{ID:"w",Conductor:&chatConductorState{Role:conductorRoleWorker,Status:conductorSucceeded}}
 switch kind {
 case "parent-run":s.beginChatRun("p")
 case "parent-queue":cs.QueuedMessages=[]chatQueuedMessage{{Text:"receipt"}}
 case "dispatch":cs.ConductorChildren[0].Status=conductorRunning
 case "review":cs.ConductorChildren[0].Review.Status="pending"
 case "worker-run":s.beginChatRun("w")
 case "worker-queue":worker.QueuedMessages=[]chatQueuedMessage{{Text:"queued"}}
 case "worker-state":worker.Conductor.Status=conductorRunning
 case "worker-role":cs.Conductor.Role=conductorRoleWorker
 }
 saveChatSession(cfg,worker);saveChatSession(cfg,cs)
 before,_:=loadChatSession(cfg,"p")
 w:=httptest.NewRecorder();s.chatConductorDisable(w,httptest.NewRequest("POST","/",nil),"p")
 after,_:=loadChatSession(cfg,"p")
 if w.Code!=409 || !reflect.DeepEqual(before,after){t.Fatal(w.Code,w.Body.String(),"mutated state")}
 })}
}

func TestConductorDisableConcurrentRunAdmission(t *testing.T) {
 s:=newChatLoopTestServer(t);cfg:=s.CfgStore.Snapshot()
 for i:=0;i<30;i++ {
  saveChatSession(cfg,chatSession{ID:"p",Conductor:&chatConductorState{Role:conductorRoleParent}})
  start:=make(chan struct{}); done:=make(chan error,1); runDone:=make(chan string,1)
  go func(){<-start;_,err:=s.disableChatConductor("p");done<-err}()
  go func(){<-start;s.beginChatRun("p");cs,_:=loadChatSession(cfg,"p");runDone<-cs.Conductor.Role}()
  close(start);err:=<-done;role:=<-runDone
  if err==nil && role!="" {t.Fatal("run admitted with stale conductor role")}
  s.ChatMu.Lock();s.ChatRuns["p"].Done=true;s.ChatMu.Unlock()
 }
}
