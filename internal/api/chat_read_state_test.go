package api

import (
	"bytes"
	"encoding/json"
	"genericagent-admin-go/internal/config"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestChatReadPersistenceAndRevision(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) { cfg.ChatDataDir = filepath.Join(t.TempDir(), "data") })
	cfg := s.CfgStore.Snapshot()
	cs := chatSession{ID: "read-test", Messages: []chatMessage{{ID: "answer", Role: "assistant", Content: "historical"}}}
	save := func() {
		t.Helper()
		if err := saveChatSessionLocked(cfg, cs); err != nil {
			t.Fatal(err)
		}
	}
	unread := func(server *Server) bool {
		t.Helper()
		rec := httptest.NewRecorder()
		server.chatSessions(rec, httptest.NewRequest("GET", "/api/chat/sessions", nil))
		if rec.Code != 200 {
			t.Fatal(rec.Body.String())
		}
		var payload struct {
			Sessions []struct {
				Unread bool `json:"unread"`
			} `json:"sessions"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if len(payload.Sessions) != 1 {
			t.Fatal(payload)
		}
		return payload.Sessions[0].Unread
	}
	mark := func(result chatSessionResult) {
		t.Helper()
		b, _ := json.Marshal(map[string]interface{}{"receipts": []chatReadReceipt{{SID: cs.ID, Result: result}}})
		rec := httptest.NewRecorder()
		s.chatHandler(rec, httptest.NewRequest(http.MethodPost, "/api/chat/read", bytes.NewReader(b)))
		if rec.Code != 200 {
			t.Fatalf("mark: %d %s", rec.Code, rec.Body.String())
		}
	}
	save()
	if unread(s) {
		t.Fatal("historical baseline must be shared")
	}
	cs.Messages[0].Content = "new result"
	save()
	result := *latestChatSessionResult(cs)
	cold := New(s.CfgStore, nil, s.Models, nil)
	if !unread(s) || !unread(cold) {
		t.Fatal("both clients must see new result unread")
	}
	mark(result)
	if unread(cold) {
		t.Fatal("other client did not observe read")
	}
	before, _ := os.ReadFile(chatReadPath(cfg))
	info, _ := os.Stat(chatReadPath(cfg))
	mark(result)
	after, _ := os.ReadFile(chatReadPath(cfg))
	infoAfter, _ := os.Stat(chatReadPath(cfg))
	if !bytes.Equal(before, after) || !info.ModTime().Equal(infoAfter.ModTime()) {
		t.Fatal("repeat receipt changed persisted state")
	}
	if unread(New(s.CfgStore, nil, s.Models, nil)) {
		t.Fatal("restart lost read receipt")
	}
	cs.Messages[0].Content = "newer result"
	save()
	mark(result)
	if !unread(cold) {
		t.Fatal("stale receipt marked newer result read")
	}
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) { cfg.ChatDataDir = filepath.Join(t.TempDir(), "other-instance") })
	if state, err := loadChatReadState(s.CfgStore.Snapshot()); err != nil || state != nil {
		t.Fatal("instance receipt leaked", state, err)
	}
}

func TestChatResultVersion(t *testing.T) {
	cs := pageFixture(2)
	original := latestChatSessionResult(cs)
	if original == nil || original.ID != "m-001" {
		t.Fatal("missing latest result")
	}
	cs.Title, cs.UpdatedAt, cs.Pinned = "Renamed", 12345, true
	if got := latestChatSessionResult(cs); *got != *original {
		t.Fatal("metadata changed result version")
	}
	if got := summaryFromChatSession(cs).Result; *got != *original {
		t.Fatal("summary version mismatch")
	}
	if original.VisibleRevision == "" {
		t.Fatal("missing visible result version")
	}
	metadata := cs
	metadata.Messages = append([]chatMessage(nil), cs.Messages...)
	metadata.Messages[1].RunStartedAtMS = 999
	metadata.Messages[1].ElapsedMS = 321
	metadataResult := latestChatSessionResult(metadata)
	if metadataResult.Revision == original.Revision || metadataResult.VisibleRevision != original.VisibleRevision {
		t.Fatal("metadata refresh must change only the full revision")
	}
	if !chatResultRead(*original, *metadataResult) {
		t.Fatal("read visible content became unread after metadata refresh")
	}
	changed := metadata
	changed.Messages = append([]chatMessage(nil), metadata.Messages...)
	changed.Messages[1].Content = "final answer plus new visible text"
	changedResult := latestChatSessionResult(changed)
	if chatResultRead(*original, *changedResult) {
		t.Fatal("new visible content must remain unread")
	}
	legacy := chatSessionResult{ID: original.ID, Revision: original.Revision}
	if !chatResultRead(legacy, *original) || chatResultRead(legacy, *metadataResult) {
		t.Fatal("legacy receipts must match their exact full revision only")
	}
	page := requirePage(t, cs, "")
	if got := page["result"].(*chatSessionResult); *got != *original {
		t.Fatal("page result mismatch")
	}
	messages := page["messages"].([]chatPageMessage)
	if messages[len(messages)-1].ContentRevision != original.Revision {
		t.Fatal("message revision mismatch")
	}
	cs.Messages[1].Content = "Revised answer"
	if got := latestChatSessionResult(cs); got.ID != original.ID || got.Revision == original.Revision {
		t.Fatal("content change did not change revision")
	}
	cs.Messages = append(cs.Messages, chatMessage{ID: "btw", Kind: "btw", Role: "assistant", Content: "Side answer"})
	if latestChatSessionResult(cs).ID != original.ID {
		t.Fatal("side question replaced main result")
	}
}

func TestChatResultRejectsIncompleteOrStopped(t *testing.T) {
	for _, message := range []chatMessage{
		{ID: "m", Role: "user", Content: "New question"},
		{ID: "m", Role: "assistant"},
		{ID: "m", Role: "assistant", Content: "Stopped."},
		{ID: "m", Role: "assistant", Content: "已中止。"},
	} {
		cs := pageFixture(1)
		cs.Messages = append(cs.Messages, message)
		if got := latestChatSessionResult(cs); got != nil {
			t.Fatalf("unexpected result for %#v: %#v", message, got)
		}
	}
	if latestChatSessionResult(chatSession{}) != nil {
		t.Fatal("empty session has result")
	}
}
