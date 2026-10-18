package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

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

func TestChatSessionSummaryIndexCachesInvalidFiles(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	cfg := s.CfgStore.Snapshot()
	valid := chatSession{ID: "valid", Title: "Valid"}
	if err := saveChatSessionLocked(cfg, valid); err != nil {
		t.Fatal(err)
	}
	for sid, data := range map[string]string{"empty": "", "broken": "{", "wrong-type": `{"messages":42}`} {
		if err := os.WriteFile(chatSessionPath(cfg, sid), []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	loads := 0
	s.ChatRuntime.sessionListLoadHook = func(string) { loads++ }
	if got := requestChatSessionSummaries(t, s); len(got) != 1 || got[0].ID != valid.ID || loads != 4 {
		t.Fatalf("initial summaries = %#v, loads = %d", got, loads)
	}
	indexPath := chatSessionListIndexPath(cfg)
	before, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	// Pin the timestamp so even identical-byte rewrites are observable.
	stamp := time.Unix(100, 0)
	if err := os.Chtimes(indexPath, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	assertUnchanged := func(server *Server) {
		t.Helper()
		for range 2 {
			if got := requestChatSessionSummaries(t, server); len(got) != 1 || got[0].ID != valid.ID {
				t.Fatalf("cached summaries = %#v", got)
			}
		}
		after, err := os.ReadFile(indexPath)
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(indexPath)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(before, after) || !info.ModTime().Equal(stamp) {
			t.Fatal("unchanged invalid sessions rewrote the index")
		}
	}
	loads = 0
	assertUnchanged(s)
	if loads != 0 {
		t.Fatalf("unchanged invalid sessions reparsed: %d", loads)
	}
	cold := New(s.CfgStore, nil, s.Models, nil)
	cold.ChatRuntime.sessionListLoadHook = func(string) { loads++ }
	assertUnchanged(cold)
	if loads != 0 {
		t.Fatalf("cold index reparsed invalid sessions: %d", loads)
	}

	// Repair, corruption of a formerly valid file, and deletion all invalidate.
	if err := saveChatSessionLocked(cfg, chatSession{ID: "empty", Title: "Repaired"}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(chatSessionPath(cfg, valid.ID), []byte("{"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(chatSessionPath(cfg, "broken")); err != nil {
		t.Fatal(err)
	}
	got := requestChatSessionSummaries(t, cold)
	if len(got) != 1 || got[0].ID != "empty" || loads != 2 {
		t.Fatalf("changed summaries = %#v, loads = %d", got, loads)
	}
	loads = 0
	requestChatSessionSummaries(t, cold)
	if loads != 0 {
		t.Fatalf("new invalid state was not cached: %d", loads)
	}
	if _, ok := cold.ChatRuntime.sessionListEntries["broken.json"]; ok {
		t.Fatal("deleted invalid session remained in the index")
	}
}

func TestChatSessionSummaryInvalidCacheRetriesChangedFile(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	cfg := s.CfgStore.Snapshot()
	valid := []byte(`{"id":"repair"}`)
	invalid := bytes.Repeat([]byte("!"), len(valid))
	if err := os.MkdirAll(chatSessionDir(cfg), 0755); err != nil {
		t.Fatal(err)
	}
	path := chatSessionPath(cfg, "repair")
	if err := os.WriteFile(path, invalid, 0644); err != nil {
		t.Fatal(err)
	}
	stamp := time.Unix(100, 0)
	if err := os.Chtimes(path, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	loads := 0
	s.ChatRuntime.sessionListLoadHook = func(string) { loads++ }
	for range 2 {
		if _, err := s.loadChatSessionSummary(cfg, "repair"); err == nil {
			t.Fatal("invalid session unexpectedly returned a summary")
		}
	}
	if loads != 1 {
		t.Fatalf("unchanged invalid session decoded %d times", loads)
	}
	// A repair with the same byte length is detected through mtime alone.
	if err := os.WriteFile(path, valid, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, stamp.Add(time.Second), stamp.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		got, err := s.loadChatSessionSummary(cfg, "repair")
		if err != nil || got.ID != "repair" {
			t.Fatalf("repaired summary = %#v, err = %v", got, err)
		}
	}
	if loads != 2 {
		t.Fatalf("repaired session decoded %d times, want 2 total", loads)
	}
}

func TestChatSessionJSONErrorClassification(t *testing.T) {
	for _, raw := range []string{"", "{", `{"messages":42}`} {
		var cs chatSession
		if err := json.Unmarshal([]byte(raw), &cs); !isChatSessionJSONError(err) {
			t.Fatalf("decode error for %q was not cacheable: %v", raw, err)
		}
	}
	for _, err := range []error{nil, os.ErrPermission, os.ErrNotExist, &os.PathError{Op: "read", Path: "session.json", Err: os.ErrPermission}} {
		if isChatSessionJSONError(err) {
			t.Fatalf("transient filesystem error was cacheable: %v", err)
		}
	}
}
