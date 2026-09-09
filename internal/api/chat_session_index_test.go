package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"genericagent-admin-go/internal/config"
)

func requestChatSessionSummaries(t *testing.T, s *Server) []chatSessionSummary {
	t.Helper()
	rec := httptest.NewRecorder()
	s.chatSessions(rec, httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("chatSessions status = %d: %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Sessions []chatSessionSummary `json:"sessions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Sessions
}

func TestChatSessionSummaryIndexCachesAndInvalidates(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	cfg := s.CfgStore.Snapshot()
	first := chatSession{ID: "summary-first", Title: "First", Conductor: &chatConductorState{Role: "parent"}, UpdatedAt: 20, Messages: []chatMessage{{ID: "m1"}}}
	second := chatSession{ID: "summary-second", Title: "Second", UpdatedAt: 10, Messages: []chatMessage{{ID: "m2"}, {ID: "m3"}}}
	for _, cs := range []chatSession{first, second} {
		if err := saveChatSessionLocked(cfg, cs); err != nil {
			t.Fatal(err)
		}
	}

	loaded := make([]string, 0, 3)
	s.ChatRuntime.sessionListLoadHook = func(sid string) { loaded = append(loaded, sid) }
	got := requestChatSessionSummaries(t, s)
	if got[0].Conductor == nil || got[0].Conductor.Role != "parent" {
		t.Fatal("missing conductor role in list")
	}
	if len(got) != 2 || got[0].ID != first.ID || got[0].Count != 1 || got[1].ID != second.ID || got[1].Count != 2 {
		t.Fatalf("initial summaries = %#v", got)
	}
	if len(loaded) != 2 {
		t.Fatalf("initial session loads = %v, want both sessions", loaded)
	}
	if _, err := os.Stat(chatSessionListIndexPath(cfg)); err != nil {
		t.Fatalf("persistent index was not written: %v", err)
	}

	loaded = loaded[:0]
	got = requestChatSessionSummaries(t, s)
	if len(got) != 2 || got[0].Conductor == nil || got[0].Conductor.Role != "parent" || len(loaded) != 0 {
		t.Fatalf("cached summaries = %#v, session loads = %v", got, loaded)
	}

	first.Title = "First title changed enough to alter the file fingerprint"
	first.UpdatedAt = 30
	if err := saveChatSessionLocked(cfg, first); err != nil {
		t.Fatal(err)
	}
	loaded = loaded[:0]
	got = requestChatSessionSummaries(t, s)
	if len(got) != 2 || got[0].Title != first.Title || len(loaded) != 1 || loaded[0] != first.ID {
		t.Fatalf("updated summaries = %#v, session loads = %v", got, loaded)
	}

	if err := os.Remove(chatSessionPath(cfg, second.ID)); err != nil {
		t.Fatal(err)
	}
	loaded = loaded[:0]
	got = requestChatSessionSummaries(t, s)
	if len(got) != 1 || got[0].ID != first.ID || len(loaded) != 0 {
		t.Fatalf("summaries after delete = %#v, session loads = %v", got, loaded)
	}

	cold := New(s.CfgStore, nil, s.Models, nil)
	coldLoads := 0
	cold.ChatRuntime.sessionListLoadHook = func(string) { coldLoads++ }
	got = requestChatSessionSummaries(t, cold)
	if len(got) != 1 || got[0].Conductor == nil || got[0].Conductor.Role != "parent" || got[0].Title != first.Title || coldLoads != 0 {
		t.Fatalf("cold runtime summaries = %#v, session loads = %d", got, coldLoads)
	}
}
