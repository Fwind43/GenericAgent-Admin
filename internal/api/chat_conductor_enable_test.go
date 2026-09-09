package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestConductorEnablePreservesSessionAndIsIdempotent(t *testing.T) {
	s := newChatLoopTestServer(t)
	saveChatLoopTestSession(t, s, chatSession{ID: "upgrade", Title: "Keep title", Workspace: "workspace", ProjectMode: "project", ProjectProvider: "admin", ProjectID: "project-id", RawHistory: []map[string]interface{}{{"role": "user", "content": "keep history"}}})
	var first []byte
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		s.chatHandler(w, httptest.NewRequest(http.MethodPost, "/api/chat/conductor/upgrade/enable", nil))
		if w.Code != 200 {
			t.Fatalf("enable: %d %s", w.Code, w.Body.String())
		}
		cs, err := loadChatSession(s.CfgStore.Snapshot(), "upgrade")
		if err != nil {
			t.Fatal(err)
		}
		if cs.Conductor == nil || cs.Conductor.Role != conductorRoleParent || cs.Title != "Keep title" || cs.Workspace != "workspace" || cs.ProjectMode != "project" || cs.ProjectProvider != "admin" || cs.ProjectID != "project-id" || len(cs.RawHistory) != 1 || cs.RawHistory[0]["content"] != "keep history" {
			t.Fatalf("lost session: %+v", cs)
		}
		data, err := os.ReadFile(chatSessionPath(s.CfgStore.Snapshot(), "upgrade"))
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = data
		} else if !bytes.Equal(first, data) {
			t.Fatal("repeat enable changed persisted session")
		}
	}
}

func TestConductorEnableRejectsWorkerAndMissing(t *testing.T) {
	s := newChatLoopTestServer(t)
	saveChatLoopTestSession(t, s, chatSession{ID: "worker", Conductor: &chatConductorState{Role: conductorRoleWorker}})
	path := chatSessionPath(s.CfgStore.Snapshot(), "worker")
	before, _ := os.ReadFile(path)
	for _, tc := range []struct {
		id     string
		status int
	}{{"worker", 409}, {"missing", 404}} {
		w := httptest.NewRecorder()
		s.chatHandler(w, httptest.NewRequest(http.MethodPost, "/api/chat/conductor/"+tc.id+"/enable", nil))
		if w.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.id, w.Code, w.Body.String())
		}
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("worker mutated")
	}
	if _, err := os.Stat(chatSessionPath(s.CfgStore.Snapshot(), "missing")); !os.IsNotExist(err) {
		t.Fatal("missing session created")
	}
}
