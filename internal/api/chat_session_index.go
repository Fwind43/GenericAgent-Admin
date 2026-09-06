package api

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"genericagent-admin-go/internal/config"
)

const chatSessionListIndexVersion = 3

type chatSessionResult struct {
	ID       string `json:"id"`
	Revision string `json:"revision"`
}

func latestChatSessionResult(cs chatSession) *chatSessionResult {
	for i := len(cs.Messages) - 1; i >= 0; i-- {
		m := cs.Messages[i]
		if m.Kind == "btw" || (m.Role != "assistant" && m.Role != "user") {
			continue
		}
		text := strings.TrimSpace(m.Content)
		if m.Role != "assistant" || m.ID == "" || chatTaskbarStopped(text) {
			return nil
		}
		if !m.Error && text == "" && len(m.StructuredContent) == 0 && len(m.Files) == 0 {
			return nil
		}
		b, err := json.Marshal(m)
		if err != nil {
			return nil
		}
		return &chatSessionResult{ID: m.ID, Revision: fmt.Sprintf("%x", sha256.Sum256(b))}
	}
	return nil
}

type chatSessionSummary struct {
	TaskbarState string             `json:"taskbar_state"`
	Result       *chatSessionResult `json:"result,omitempty"`
	ID           string             `json:"id"`
	Title        string             `json:"title"`
	TitleSource  string             `json:"title_source,omitempty"`
	UpdatedAt    int64              `json:"updated_at"`
	Count        int                `json:"count"`
	Workspace    string             `json:"workspace,omitempty"`
	ProjectMode  string             `json:"project_mode,omitempty"`
	HubEnabled   bool               `json:"hub_enabled,omitempty"`
	Pinned       bool               `json:"pinned,omitempty"`
	Loop         chatLoopState      `json:"loop"`
}

type chatSessionListIndexEntry struct {
	Size      int64              `json:"size"`
	ModTimeNS int64              `json:"mod_time_ns"`
	Summary   chatSessionSummary `json:"summary"`
}

type chatSessionListIndex struct {
	Version int                                  `json:"version"`
	Entries map[string]chatSessionListIndexEntry `json:"entries"`
}

func chatSessionListIndexPath(cfg config.AppConfig) string {
	return filepath.Join(chatDataDir(cfg), "chat_sessions.index.json")
}

func summaryFromChatSession(cs chatSession) chatSessionSummary {
	return chatSessionSummary{
		TaskbarState: chatSessionTaskbarState(cs),
		Result:       latestChatSessionResult(cs),
		ID:           cs.ID,
		Title:        cs.Title,
		TitleSource:  cs.TitleSource,
		UpdatedAt:    cs.UpdatedAt,
		Count:        len(cs.Messages),
		Workspace:    cs.Workspace,
		ProjectMode:  cs.ProjectMode,
		HubEnabled:   cs.HubEnabled,
		Pinned:       cs.Pinned,
		Loop:         cs.Loop,
	}
}

func readChatSessionListIndex(path string) map[string]chatSessionListIndexEntry {
	b, err := os.ReadFile(path)
	if err != nil {
		return make(map[string]chatSessionListIndexEntry)
	}
	var index chatSessionListIndex
	if json.Unmarshal(b, &index) != nil || index.Version != chatSessionListIndexVersion || index.Entries == nil {
		return make(map[string]chatSessionListIndexEntry)
	}
	return index.Entries
}

func writeChatSessionListIndex(path string, entries map[string]chatSessionListIndexEntry) error {
	b, err := json.Marshal(chatSessionListIndex{Version: chatSessionListIndexVersion, Entries: entries})
	if err != nil {
		return err
	}
	return writeChatFileAtomic(path, b, 0644)
}

func (s *Server) loadChatSessionSummaries(cfg config.AppConfig) ([]chatSessionSummary, error) {
	if err := ensureChatDataMigrated(cfg); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(chatSessionDir(cfg), 0755); err != nil {
		return nil, err
	}

	dirEntries, err := os.ReadDir(chatSessionDir(cfg))
	if err != nil {
		return nil, err
	}
	indexPath := chatSessionListIndexPath(cfg)
	runtime := s.ChatRuntime
	if runtime == nil {
		runtime = &chatRuntime{}
	}

	runtime.sessionListMu.Lock()
	defer runtime.sessionListMu.Unlock()
	if !runtime.sessionListLoaded || runtime.sessionListPath != indexPath {
		runtime.sessionListPath = indexPath
		runtime.sessionListEntries = readChatSessionListIndex(indexPath)
		runtime.sessionListLoaded = true
	}

	previous := runtime.sessionListEntries
	next := make(map[string]chatSessionListIndexEntry, len(dirEntries))
	summaries := make([]chatSessionSummary, 0, len(dirEntries))
	dirty := false
	for _, entry := range dirEntries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			dirty = true
			continue
		}
		cached, ok := previous[entry.Name()]
		if ok && cached.Size == info.Size() && cached.ModTimeNS == info.ModTime().UnixNano() && cached.Summary.ID != "" {
			next[entry.Name()] = cached
			summaries = append(summaries, cached.Summary)
			continue
		}

		sid := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		if runtime.sessionListLoadHook != nil {
			runtime.sessionListLoadHook(sid)
		}
		cs, err := loadChatSession(cfg, sid)
		if err != nil {
			dirty = true
			continue
		}
		summary := summaryFromChatSession(cs)
		indexed := chatSessionListIndexEntry{Size: info.Size(), ModTimeNS: info.ModTime().UnixNano(), Summary: summary}
		next[entry.Name()] = indexed
		summaries = append(summaries, summary)
		dirty = true
	}
	if len(next) != len(previous) {
		dirty = true
	}
	runtime.sessionListEntries = next
	if dirty {
		// The index is only an optimization. Session listing must remain available
		// even when the derived index cannot be persisted.
		_ = writeChatSessionListIndex(indexPath, next)
	}
	return summaries, nil
}
