package api

import "testing"

func TestConductorReusePreservesHistory(t *testing.T) {
 s := newChatLoopTestServer(t)
 parent := chatSession{ID:"reuse-parent", Conductor:&chatConductorState{Role:conductorRoleParent}}
 parent.ConductorChildren = append(parent.ConductorChildren, chatConductorChild{DispatchID:"old",SessionID:"reuse-worker",Status:conductorSucceeded,Result:"old-result"})
 // Occupy scheduler slots so acceptance can be tested without launching a model.
 for i:=0;i<conductorMaxRunning;i++ { parent.ConductorChildren=append(parent.ConductorChildren,chatConductorChild{DispatchID:string(rune('a'+i)),Status:conductorRunning}) }
 saveChatLoopTestSession(t,s,parent)
 saveChatLoopTestSession(t,s,chatSession{ID:"reuse-worker",Messages:[]chatMessage{{Role:"assistant",Content:"remember-me"}},Conductor:&chatConductorState{Role:conductorRoleWorker,ParentSessionID:parent.ID,DispatchID:"old",Status:conductorSucceeded}})
 token:=s.beginChatRun(parent.ID); defer s.endChatRunOwned(parent.ID,token)
 child,err:=s.dispatchConductor(parent.ID,"follow up","reuse-worker")
 if err!=nil {t.Fatal(err)}
 if child.SessionID!="reuse-worker" || child.DispatchID=="old" {t.Fatalf("bad receipt: %+v",child)}
 worker,err:=loadChatSession(s.CfgStore.Snapshot(),child.SessionID)
 if err!=nil || len(worker.Messages)!=1 || worker.Messages[0].Content!="remember-me" || worker.Conductor.DispatchID!=child.DispatchID {t.Fatalf("lost context: %+v %v",worker,err)}
 if _,err=s.dispatchConductor(parent.ID,"duplicate",child.SessionID);err==nil {t.Fatal("busy worker accepted")}
 s.finishConductorChild(parent.ID,"old",conductorFailed,"","late callback")
 worker,_=loadChatSession(s.CfgStore.Snapshot(),child.SessionID)
 if worker.Conductor.Status!=conductorQueued {t.Fatal("old callback changed new dispatch")}
 saved,_:=loadChatSession(s.CfgStore.Snapshot(),parent.ID)
 if len(saved.ConductorChildren)!=len(parent.ConductorChildren)+1 || saved.ConductorChildren[0].Result!="old-result" {t.Fatal("dispatch history changed")}
 saveChatLoopTestSession(t,s,chatSession{ID:"foreign-worker",Conductor:&chatConductorState{Role:conductorRoleWorker,ParentSessionID:"other",Status:conductorSucceeded}})
 for _,id:=range []string{"foreign-worker","missing-worker","../invalid"} {
  if _,err=s.dispatchConductor(parent.ID,"no",id);err==nil {t.Fatalf("accepted %s",id)}
 }
}
