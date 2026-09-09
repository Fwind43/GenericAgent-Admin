package api

import (
 "testing"
 "reflect"
)

func TestConductorCancelOwnedDispatch(t *testing.T) {
 for _, status := range []string{conductorQueued, conductorRunning} {
 t.Run(status,func(t *testing.T) {
 s:=newChatLoopTestServer(t)
 parent:=chatSession{ID:"cancel-parent",Conductor:&chatConductorState{Role:conductorRoleParent},ConductorChildren:[]chatConductorChild{{DispatchID:"d1",SessionID:"w1",Status:status}}}
 saveChatLoopTestSession(t,s,parent)
 saveChatLoopTestSession(t,s,chatSession{ID:"w1",Conductor:&chatConductorState{Role:conductorRoleWorker,ParentSessionID:parent.ID,DispatchID:"d1",Status:status}})
 token:=s.beginChatRun(parent.ID);defer s.endChatRunOwned(parent.ID,token)
 if status==conductorRunning { s.beginChatRun("w1") }
 for _, id:=range []string{"foreign","../bad",""} { if _,err:=s.cancelConductorDispatch(parent.ID,id);err==nil {t.Fatalf("accepted %q",id)} }
 child,err:=s.cancelConductorDispatch(parent.ID,"d1")
 if err!=nil || child.Status!=conductorCancelled || s.chatRunActive("w1") {t.Fatalf("cancel: %+v %v",child,err)}
 before,_:=loadChatSession(s.CfgStore.Snapshot(),parent.ID)
 if _,err=s.cancelConductorDispatch(parent.ID,"d1");err!=nil {t.Fatal(err)}
 after,_:=loadChatSession(s.CfgStore.Snapshot(),parent.ID)
 if !reflect.DeepEqual(before,after) {t.Fatal("repeat cancellation changed persisted state")}
 worker,_:=loadChatSession(s.CfgStore.Snapshot(),"w1")
 if worker.Conductor.Status!=conductorCancelled {t.Fatal("worker not cancelled")}
 })
 }
}
