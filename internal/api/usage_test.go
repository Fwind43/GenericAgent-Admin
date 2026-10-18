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

func TestUsageOverviewAggregatesSessionsWithoutDoubleCounting(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	cfg := s.CfgStore.Snapshot()
	firstDay := time.Date(2026, time.July, 23, 12, 0, 0, 0, time.Local).Unix()
	secondDay := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.Local).UnixMilli()

	first := chatSession{
		ID:    "alpha",
		Title: "Alpha session",
		Messages: []chatMessage{
			{Role: "user", Content: "secret prompt", Usage: map[string]int{"input_tokens": 999}},
			{
				Role:      "assistant",
				ModelID:   "model-a",
				Content:   "secret response",
				CreatedAt: firstDay,
				Usage:     map[string]int{"input_tokens": 10, "output_tokens": 4, "total_tokens": 14},
				Usages: []map[string]int{
					{"input_tokens": 6, "output_tokens": 2},
					{"input_tokens": 4, "output_tokens": 2},
				},
			},
		},
	}
	second := chatSession{
		ID:    "beta",
		Title: "Beta session",
		Messages: []chatMessage{{
			Role:      "assistant",
			ModelID:   "model-b",
			CreatedAt: secondDay,
			Usages: []map[string]int{
				{"prompt_tokens": 3, "completion_tokens": 2, "cached_tokens": 1},
				{"input_tokens": 2, "output_tokens": 1},
			},
		}},
	}
	for _, session := range []chatSession{first, second} {
		if err := saveChatSession(cfg, session); err != nil {
			t.Fatalf("save session %q: %v", session.ID, err)
		}
	}
	if err := os.WriteFile(filepath.Join(chatSessionDir(cfg), "broken.json"), []byte("{"), 0o644); err != nil {
		t.Fatalf("write broken session: %v", err)
	}

	rr := httptest.NewRecorder()
	s.usageOverview(rr, httptest.NewRequest(http.MethodGet, "/api/usage/overview", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var got usageOverviewResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.SessionCount != 2 || got.AssistantReplies != 2 || got.SkippedSessions != 1 {
		t.Fatalf("counts=%+v", got)
	}
	if got.Totals.InputTokens != 15 || got.Totals.OutputTokens != 7 || got.Totals.TotalTokens != 22 {
		t.Fatalf("totals=%+v want input=15 output=7 total=22", got.Totals)
	}
	if got.Totals.Other["cached_tokens"] != 1 {
		t.Fatalf("other=%+v", got.Totals.Other)
	}
	if len(got.Models) != 2 || got.Models[0].Name != "model-a" || got.Models[0].Totals.TotalTokens != 14 {
		t.Fatalf("models=%+v", got.Models)
	}
	if len(got.Sessions) != 2 {
		t.Fatalf("sessions=%+v", got.Sessions)
	}
	if len(got.Daily) != 2 || got.Daily[0].Date != "2026-07-23" || got.Daily[0].Totals.TotalTokens != 14 || got.Daily[1].Date != "2026-07-24" || got.Daily[1].Totals.TotalTokens != 8 {
		t.Fatalf("daily=%+v", got.Daily)
	}
	body := rr.Body.String()
	if containsAny(body, "secret prompt", "secret response") {
		t.Fatalf("response leaked message content: %s", body)
	}
}

func TestUsageOverviewOmitsUnknownModelBreakdown(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	cfg := s.CfgStore.Snapshot()
	if err := saveChatSession(cfg, chatSession{
		ID: "legacy",
		Messages: []chatMessage{{
			Role:  "assistant",
			Usage: map[string]int{"input_tokens": 7, "output_tokens": 3, "total_tokens": 10},
		}},
	}); err != nil {
		t.Fatalf("save legacy session: %v", err)
	}

	rr := httptest.NewRecorder()
	s.usageOverview(rr, httptest.NewRequest(http.MethodGet, "/api/usage/overview", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var got usageOverviewResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.AssistantReplies != 1 || got.Totals.TotalTokens != 10 {
		t.Fatalf("legacy usage omitted from totals: %+v", got)
	}
	if len(got.Models) != 0 {
		t.Fatalf("legacy usage created unknown model breakdown: %+v", got.Models)
	}
}

func TestUsageLedgerSurvivesSessionDeletion(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	cfg := s.CfgStore.Snapshot()
	cs := chatSession{ID: "deleted-later", Title: "Deleted later", Messages: []chatMessage{{
		ID: "reply-1", Role: "assistant", ModelID: "model-x", CreatedAt: 123,
		Usage: map[string]int{"input_tokens": 7, "output_tokens": 3, "total_tokens": 10},
	}}}
	if err := saveChatSession(cfg, cs); err != nil {
		t.Fatalf("save session: %v", err)
	}
	if _, _, err := s.loadOrMigrateUsageLedger(); err != nil {
		t.Fatalf("migrate usage: %v", err)
	}
	if err := os.Remove(chatSessionPath(cfg, cs.ID)); err != nil {
		t.Fatalf("delete session: %v", err)
	}

	rr := httptest.NewRecorder()
	s.usageOverview(rr, httptest.NewRequest(http.MethodGet, "/api/usage/overview", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var got usageOverviewResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.AssistantReplies != 1 || got.Totals.TotalTokens != 10 || len(got.Sessions) != 1 {
		t.Fatalf("usage changed after session deletion: %+v", got)
	}
}

func TestRecordSessionUsageMigratesExistingSessionsFirst(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	cfg := s.CfgStore.Snapshot()
	old := chatSession{ID: "old", Messages: []chatMessage{{
		ID: "old-reply", Role: "assistant", Usage: map[string]int{"total_tokens": 10},
	}}}
	if err := saveChatSession(cfg, old); err != nil {
		t.Fatalf("save old session: %v", err)
	}
	fresh := chatSession{ID: "fresh", Messages: []chatMessage{{
		ID: "fresh-reply", Role: "assistant", Usage: map[string]int{"total_tokens": 20},
	}}}
	if err := s.recordSessionUsage(fresh); err != nil {
		t.Fatalf("record fresh usage: %v", err)
	}
	ledger, err := readUsageLedger(cfg)
	if err != nil {
		t.Fatalf("read ledger: %v", err)
	}
	if len(ledger.Entries) != 2 {
		t.Fatalf("ledger entries=%d, want 2: %+v", len(ledger.Entries), ledger.Entries)
	}
}

func TestUsageOverviewMissingDirectoryIsEmptyAndReadOnly(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	dir := chatSessionDir(s.CfgStore.Snapshot())

	rr := httptest.NewRecorder()
	s.usageOverview(rr, httptest.NewRequest(http.MethodGet, "/api/usage/overview", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("GET created session directory or returned unexpected stat error: %v", err)
	}
	var got usageOverviewResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Models == nil || got.Sessions == nil || got.SessionCount != 0 {
		t.Fatalf("empty response=%+v", got)
	}
}

func TestUsageOverviewRejectsNonGet(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	rr := httptest.NewRecorder()
	s.usageOverview(rr, httptest.NewRequest(http.MethodPost, "/api/usage/overview", nil))
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if len(needle) > 0 && len(value) >= len(needle) {
			for i := 0; i+len(needle) <= len(value); i++ {
				if value[i:i+len(needle)] == needle {
					return true
				}
			}
		}
	}
	return false
}

func TestNormalizedMessageUsagePrefersUsagesOverZeroUsage(t *testing.T) {
	// A terminal SSE event can overwrite the aggregated usage map with all-zero
	// values while the per-turn usages array keeps the real numbers.
	message := chatMessage{
		Role:    "assistant",
		ModelID: "model-z",
		Usage:   map[string]int{"input_tokens": 0, "output_tokens": 0, "cached_tokens": 0},
		Usages: []map[string]int{
			{"input_tokens": 120, "output_tokens": 30},
			{"input_tokens": 80, "output_tokens": 20, "cached_tokens": 7},
		},
	}
	totals, ok := normalizedMessageUsage(message)
	if !ok {
		t.Fatal("expected usage to be reported")
	}
	if totals.InputTokens != 200 || totals.OutputTokens != 50 || totals.TotalTokens != 250 {
		t.Fatalf("totals=%+v want input=200 output=50 total=250", totals)
	}
	if totals.Other["cached_tokens"] != 7 {
		t.Fatalf("other=%+v want cached_tokens=7", totals.Other)
	}
}

func TestNormalizedMessageUsageIncludesModernCacheCategoriesInInput(t *testing.T) {
	message := chatMessage{
		Role:    "assistant",
		ModelID: "claude-modern",
		Usages: []map[string]int{
			{"input_tokens": 100, "cache_creation_tokens": 40, "cache_read_tokens": 160, "output_tokens": 30},
		},
	}
	totals, ok := normalizedMessageUsage(message)
	if !ok {
		t.Fatal("expected usage to be reported")
	}
	if totals.InputTokens != 300 || totals.OutputTokens != 30 || totals.TotalTokens != 330 {
		t.Fatalf("totals=%+v want input=300 output=30 total=330", totals)
	}
	if totals.Other["cache_creation_tokens"] != 40 || totals.Other["cache_read_tokens"] != 160 {
		t.Fatalf("other=%+v want cache creation=40 read=160", totals.Other)
	}
}

func TestNormalizedMessageUsageUsesPerTurnCacheInputSemantics(t *testing.T) {
	message := chatMessage{
		Role: "assistant",
		Usages: []map[string]int{
			{"input_tokens": 100, "cache_read_tokens": 80, "output_tokens": 10, "input_tokens_include_cache_read": 1},
			{"input_tokens": 20, "cache_read_tokens": 80, "output_tokens": 10, "input_tokens_include_cache_read": 0},
		},
	}
	totals, ok := normalizedMessageUsage(message)
	if !ok {
		t.Fatal("expected usage to be reported")
	}
	if totals.InputTokens != 200 || totals.OutputTokens != 20 || totals.TotalTokens != 220 {
		t.Fatalf("totals=%+v want input=200 output=20 total=220", totals)
	}
	if totals.Other["cache_read_tokens"] != 160 {
		t.Fatalf("other=%+v want cache read=160", totals.Other)
	}
	if _, exists := totals.Other["input_tokens_include_cache_read"]; exists {
		t.Fatalf("protocol metadata leaked into usage totals: %+v", totals.Other)
	}
}

func TestNormalizedMessageUsageDoesNotDoubleCountLegacyCachedTokens(t *testing.T) {
	message := chatMessage{
		Role:  "assistant",
		Usage: map[string]int{"input_tokens": 100, "cached_tokens": 80, "output_tokens": 30},
	}
	totals, ok := normalizedMessageUsage(message)
	if !ok {
		t.Fatal("expected usage to be reported")
	}
	if totals.InputTokens != 100 || totals.TotalTokens != 130 {
		t.Fatalf("totals=%+v want legacy input=100 total=130", totals)
	}
}

func TestNormalizedMessageUsageFallsBackToLegacyUsage(t *testing.T) {
	message := chatMessage{
		Role:    "assistant",
		ModelID: "legacy",
		Usage:   map[string]int{"input_tokens": 11, "output_tokens": 5},
	}
	totals, ok := normalizedMessageUsage(message)
	if !ok {
		t.Fatal("expected usage to be reported")
	}
	if totals.InputTokens != 11 || totals.OutputTokens != 5 || totals.TotalTokens != 16 {
		t.Fatalf("totals=%+v want input=11 output=5 total=16", totals)
	}
}

func TestRecordSessionUsageRefreshesStaleZeroTotals(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	cfg := s.CfgStore.Snapshot()
	created := time.Date(2026, time.July, 25, 9, 0, 0, 0, time.Local).Unix()

	session := chatSession{
		ID:    "gamma",
		Title: "Gamma session",
		Messages: []chatMessage{{
			ID:        "m1",
			Role:      "assistant",
			ModelID:   "model-c",
			CreatedAt: created,
			Usages:    []map[string]int{{"input_tokens": 40, "output_tokens": 9}},
		}},
	}

	// Seed the ledger with a stale all-zero entry for the same key.
	stale := usageEntriesFromSession(session)
	if len(stale) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(stale))
	}
	stale[0].Totals = usageTotals{}
	stale[0].ModelID = ""
	if err := writeUsageLedger(cfg, usageLedger{Entries: stale}); err != nil {
		t.Fatalf("seed ledger: %v", err)
	}

	if err := s.recordSessionUsage(session); err != nil {
		t.Fatalf("record session usage: %v", err)
	}

	ledger, err := readUsageLedger(cfg)
	if err != nil {
		t.Fatalf("read ledger: %v", err)
	}
	if len(ledger.Entries) != 1 {
		t.Fatalf("entries=%+v want exactly 1", ledger.Entries)
	}
	entry := ledger.Entries[0]
	if entry.Totals.InputTokens != 40 || entry.Totals.OutputTokens != 9 {
		t.Fatalf("totals=%+v want input=40 output=9", entry.Totals)
	}
	if entry.ModelID != "model-c" {
		t.Fatalf("model_id=%q want model-c", entry.ModelID)
	}
}

func TestRecordSessionUsageDoesNotRewriteUnchangedLedger(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	cs := chatSession{ID: "unchanged", Title: "Unchanged title", Messages: []chatMessage{
		{ID: "one", Role: "assistant", ModelID: "model", CreatedAt: 123,
			Usage: map[string]int{"input_tokens": 10, "output_tokens": 5}},
		{ID: "two", Role: "assistant", ModelID: "model", CreatedAt: 124,
			Usage: map[string]int{"input_tokens": 4, "reasoning_tokens": 3}},
	}}
	if err := s.recordSessionUsage(cs); err != nil {
		t.Fatal(err)
	}
	path := usageLedgerPath(cfg)
	stamp := time.Unix(1600000000, 0)
	if err := os.Chtimes(path, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	for pass := range 2 {
		if err := s.recordSessionUsage(cs); err != nil {
			t.Fatal(err)
		}
		after, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		next, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(before, after) || !info.ModTime().Equal(next.ModTime()) {
			t.Fatalf("unchanged usage rewrote ledger on pass %d: mtime %v -> %v", pass, info.ModTime(), next.ModTime())
		}
	}
}

func TestRecordSessionUsageUpdatesChangedFieldsAndPreservesHistory(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	cs := chatSession{ID: "changing", Title: "Original title", Messages: []chatMessage{{
		ID: "one", Role: "assistant", ModelID: "old-model", CreatedAt: 123,
		Usage: map[string]int{"input_tokens": 10, "output_tokens": 5, "reasoning_tokens": 2},
	}}}
	if err := s.recordSessionUsage(cs); err != nil {
		t.Fatal(err)
	}
	changes := []struct {
		name  string
		apply func()
	}{
		{"title", func() { cs.Title = "Renamed" }},
		{"model", func() { cs.Messages[0].ModelID = "new-model" }},
		{"input", func() { cs.Messages[0].Usage["input_tokens"] = 11 }},
		{"output", func() { cs.Messages[0].Usage["output_tokens"] = 6 }},
		{"total", func() { cs.Messages[0].Usage["total_tokens"] = 20 }},
		{"other-value", func() { cs.Messages[0].Usage["reasoning_tokens"] = 3 }},
		{"other-key", func() {
			delete(cs.Messages[0].Usage, "reasoning_tokens")
			cs.Messages[0].Usage["custom_tokens"] = 3
		}},
		{"other-empty", func() { delete(cs.Messages[0].Usage, "custom_tokens") }},
		{"append-message", func() {
			cs.Messages = append(cs.Messages, chatMessage{ID: "two", Role: "assistant", ModelID: "new-model",
				Usage: map[string]int{"output_tokens": 1}})
		}},
	}
	path := usageLedgerPath(cfg)
	for _, change := range changes {
		t.Run(change.name, func(t *testing.T) {
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			change.apply()
			if err := s.recordSessionUsage(cs); err != nil {
				t.Fatal(err)
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Equal(before, after) {
				t.Fatal("changed usage was not persisted")
			}
			ledger, err := readUsageLedger(cfg)
			if err != nil {
				t.Fatal(err)
			}
			want, err := json.Marshal(usageLedger{Version: usageLedgerVersion, Entries: usageEntriesFromSession(cs)})
			if err != nil {
				t.Fatal(err)
			}
			got, err := json.Marshal(ledger)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, want) {
				t.Fatalf("ledger = %s, want %s", got, want)
			}
		})
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	cs.Messages = cs.Messages[:1]
	if err := s.recordSessionUsage(cs); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("worldline truncation erased recorded usage")
	}
}
