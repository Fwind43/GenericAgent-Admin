package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"genericagent-admin-go/internal/config"
)

// Separate from session snapshots so a running worker cannot overwrite receipts.
var chatReadMu sync.Mutex

type chatReadReceipt struct {
	SID    string            `json:"sid"`
	Result chatSessionResult `json:"result"`
}

func chatReadPath(cfg config.AppConfig) string {
	return filepath.Join(chatDataDir(cfg), "chat_read_state.json")
}

func loadChatReadState(cfg config.AppConfig) (map[string]chatSessionResult, error) {
	b, err := os.ReadFile(chatReadPath(cfg))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var state map[string]chatSessionResult
	if err := json.Unmarshal(b, &state); err != nil {
		return nil, err
	}
	if state == nil {
		state = map[string]chatSessionResult{}
	}
	return state, nil
}

func saveChatReadState(cfg config.AppConfig, state map[string]chatSessionResult) error {
	b, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(chatDataDir(cfg), 0755); err != nil {
		return err
	}
	return writeChatFileAtomic(chatReadPath(cfg), b, 0600)
}

// Initialize historical results once per instance, never once per browser.
func (s *Server) chatReadSnapshot(cfg config.AppConfig, summaries []chatSessionSummary) (map[string]chatSessionResult, error) {
	chatReadMu.Lock()
	defer chatReadMu.Unlock()
	state, err := loadChatReadState(cfg)
	if err != nil || state != nil {
		return state, err
	}
	state = map[string]chatSessionResult{}
	for _, summary := range summaries {
		running, _ := s.chatSessionTaskbarSnapshot(summary)
		if !running && summary.Result != nil {
			state[summary.ID] = *summary.Result
		}
	}
	return state, saveChatReadState(cfg, state)
}

func (s *Server) chatMarkRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	var req struct {
		Receipts []chatReadReceipt `json:"receipts"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		bad(w, 400, "invalid read receipts")
		return
	}
	if len(req.Receipts) == 0 || len(req.Receipts) > 10000 {
		bad(w, 400, "invalid receipt count")
		return
	}
	cfg := s.CfgStore.Snapshot()
	summaries, err := s.loadChatSessionSummaries(cfg)
	if err != nil {
		bad(w, 500, err.Error())
		return
	}
	if _, err = s.chatReadSnapshot(cfg, summaries); err != nil {
		bad(w, 500, err.Error())
		return
	}
	chatReadMu.Lock()
	defer chatReadMu.Unlock()
	// Revalidate inside the receipt lock: an older request must not replace
	// a newer receipt accepted while it was waiting for this lock.
	summaries, err = s.loadChatSessionSummaries(cfg)
	if err != nil {
		bad(w, 500, err.Error())
		return
	}
	current := make(map[string]chatSessionSummary, len(summaries))
	for _, summary := range summaries {
		current[summary.ID] = summary
	}
	state, err := loadChatReadState(cfg)
	if err != nil {
		bad(w, 500, err.Error())
		return
	}
	accepted := []chatReadReceipt{}
	changed := false
	for _, receipt := range req.Receipts {
		summary, ok := current[receipt.SID]
		running, _ := s.chatSessionTaskbarSnapshot(summary)
		if !ok || running || summary.Result == nil || *summary.Result != receipt.Result {
			continue
		}
		if state[receipt.SID] != receipt.Result {
			state[receipt.SID] = receipt.Result
			changed = true
		}
		accepted = append(accepted, receipt)
	}
	if changed {
		if err := saveChatReadState(cfg, state); err != nil {
			bad(w, 500, err.Error())
			return
		}
	}
	writeJSON(w, map[string]interface{}{"receipts": accepted})
}
