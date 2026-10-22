package api

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"genericagent-admin-go/internal/config"
)

func safeChatID(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	for _, c := range v {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return newChatID()
		}
	}
	return v
}

var chatDataMigrationMu sync.Mutex

var chatDataMigrated = map[string]bool{}

func chatDataDir(cfg config.AppConfig) string {
	dir := strings.TrimSpace(cfg.ChatDataDir)
	if dir == "" {
		dir = config.DefaultChatDataDir()
	}
	if abs, err := filepath.Abs(dir); err == nil {
		return abs
	}
	return dir
}

func chatSessionDir(cfg config.AppConfig) string {
	return filepath.Join(chatDataDir(cfg), "chat_sessions")
}

func chatUploadDir(cfg config.AppConfig) string {
	return filepath.Join(chatDataDir(cfg), "chat_uploads")
}

func legacyChatSessionDir(root string) string {
	return filepath.Join(root, "temp", "react_frontend_sessions")
}

func legacyChatUploadDir(root string) string {
	return filepath.Join(root, "temp", "react_frontend_uploads")
}

func chatSessionPath(cfg config.AppConfig, sid string) string {
	return filepath.Join(chatSessionDir(cfg), safeChatID(sid)+".json")
}

func ensureChatDataMigrated(cfg config.AppConfig) error {
	key := cfg.GARoot + "|" + chatDataDir(cfg)
	chatDataMigrationMu.Lock()
	if chatDataMigrated[key] {
		chatDataMigrationMu.Unlock()
		return nil
	}
	chatDataMigrationMu.Unlock()
	if err := copyDirIfTargetEmpty(legacyChatSessionDir(cfg.GARoot), chatSessionDir(cfg)); err != nil {
		return err
	}
	if err := copyDirIfTargetEmpty(legacyChatUploadDir(cfg.GARoot), chatUploadDir(cfg)); err != nil {
		return err
	}
	chatDataMigrationMu.Lock()
	chatDataMigrated[key] = true
	chatDataMigrationMu.Unlock()
	return nil
}

func copyDirIfTargetEmpty(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil || len(entries) == 0 {
		return nil
	}
	if existing, err := os.ReadDir(dst); err == nil && len(existing) > 0 {
		return nil
	}
	if err := os.MkdirAll(dst, 0755); err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		in := filepath.Join(src, e.Name())
		out := filepath.Join(dst, e.Name())
		if _, err := os.Stat(out); err == nil {
			continue
		}
		b, err := os.ReadFile(in)
		if err != nil {
			return err
		}
		if err := writeChatFileAtomic(out, b, 0644); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) mutateChatSession(sid string, token *chatRun, mutate func(*chatSession) error) (chatSession, error) {
	if !s.ownsChatRun(sid, token) {
		return chatSession{}, fmt.Errorf("chat run is no longer owned")
	}
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	if s.chatSessionMutationHook != nil {
		s.chatSessionMutationHook()
	}
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		return chatSession{}, err
	}
	if err = mutate(&cs); err != nil {
		return chatSession{}, err
	}
	err = saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
	return cs, err
}

func loadChatSession(cfg config.AppConfig, sid string) (chatSession, error) {
	if err := ensureChatDataMigrated(cfg); err != nil {
		return chatSession{}, err
	}
	sid = safeChatID(sid)
	cs := chatSession{ID: sid, Title: "新会话", Messages: []chatMessage{}, Settings: defaultChatSettingsFor(cfg)}
	b, err := os.ReadFile(chatSessionPath(cfg, sid))
	if err != nil {
		if os.IsNotExist(err) {
			return cs, nil
		}
		return cs, err
	}
	if err := json.Unmarshal(b, &cs); err != nil {
		return cs, err
	}
	if cs.ID == "" {
		cs.ID = sid
	}
	if cs.Messages == nil {
		cs.Messages = []chatMessage{}
	}
	if cs.RawHistory == nil {
		cs.RawHistory = []map[string]interface{}{}
	}
	cs.Plan = normalizeChatPlan(cs.Plan)
	cs.Settings = normalizeChatSettings(cs.Settings)
	syncConductorChatTitle(&cs)
	return cs, nil
}

func mergeChatMessageLists(first, second []chatMessage) []chatMessage {
	out := append([]chatMessage(nil), first...)
	positions := make(map[string]int, len(out))
	for i, msg := range out {
		if msg.ID != "" {
			positions[msg.ID] = i
		}
	}
	for _, msg := range second {
		if i, ok := positions[msg.ID]; msg.ID != "" && ok {
			out[i] = msg
			continue
		}
		if msg.ID != "" {
			positions[msg.ID] = len(out)
		}
		out = append(out, msg)
	}
	return out
}

func replacePendingChatMessage(messages []chatMessage, pendingID string, final chatMessage) []chatMessage {
	if pendingID == "" {
		if final.ID == "" {
			final.ID = newChatID()
		}
		return append(messages, final)
	}
	final.ID = pendingID
	for i := range messages {
		if messages[i].ID == pendingID {
			messages[i] = final
			return messages
		}
	}
	return append(messages, final)
}

func (s *Server) saveChatSessionMerged(cs chatSession) error {
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	return s.saveChatSessionMergedLocked(cs)
}

func (s *Server) saveChatSessionMergedLocked(cs chatSession) error {
	latest, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID)
	if err != nil {
		return err
	}
	cs.Messages = mergeChatMessageLists(latest.Messages, cs.Messages)
	preserveLatestChatUserMetadata(&cs, latest)
	return saveChatSession(s.CfgStore.Snapshot(), cs)
}

func (s *Server) saveChatSessionExact(cs chatSession) error {
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	return s.saveChatSessionExactLocked(cs)
}

func (s *Server) saveChatSessionExactLocked(cs chatSession) error {
	if s.chatExactSaveHook != nil {
		if err := s.chatExactSaveHook(cs); err != nil {
			return err
		}
	}
	if latest, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID); err == nil {
		preserveLatestChatUserMetadata(&cs, latest)
	}
	return saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
}

func preserveLatestChatUserMetadata(candidate *chatSession, latest chatSession) {
	candidate.Pinned = latest.Pinned
	candidate.Loop = latest.Loop
	candidate.Autorun = latest.Autorun
	candidate.QueuedMessages = latest.QueuedMessages
	candidate.Conductor = latest.Conductor
	candidate.ConductorChildren = latest.ConductorChildren
	if latest.TitleSource == chatTitleSourceManual ||
		(latest.TitleSource == chatTitleSourceGenerated && candidate.TitleSource != chatTitleSourceManual) {
		candidate.Title = latest.Title
		candidate.TitleSource = latest.TitleSource
	}
}

func (s *Server) persistChatSessionIfMissing(cs chatSession) error {
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	_, err := os.Stat(chatSessionPath(s.CfgStore.Snapshot(), cs.ID))
	if err == nil {
		return nil
	}
	if !os.IsNotExist(err) {
		return err
	}
	return saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
}

func saveChatSession(cfg config.AppConfig, cs chatSession) error {
	return saveChatSessionLocked(cfg, cs)
}

func saveChatSessionLocked(cfg config.AppConfig, cs chatSession) error {
	return saveChatSessionWithUpdatedAtLocked(cfg, cs, true)
}

func saveChatSessionPreserveUpdatedAtLocked(cfg config.AppConfig, cs chatSession) error {
	return saveChatSessionWithUpdatedAtLocked(cfg, cs, false)
}

func saveChatSessionWithUpdatedAtLocked(cfg config.AppConfig, cs chatSession, touchUpdatedAt bool) error {
	syncConductorChatTitle(&cs)
	if err := ensureChatDataMigrated(cfg); err != nil {
		return err
	}
	if err := os.MkdirAll(chatSessionDir(cfg), 0755); err != nil {
		return err
	}
	cs.Settings = normalizeChatSettings(cs.Settings)
	cs.Plan = normalizeChatPlan(cs.Plan)
	if touchUpdatedAt {
		cs.UpdatedAt = time.Now().Unix()
	}
	b, _ := json.MarshalIndent(cs, "", "  ")
	return writeChatFileAtomic(chatSessionPath(cfg, cs.ID), b, 0644)
}

func writeChatFileAtomic(path string, data []byte, perm os.FileMode) (err error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+"-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		if err != nil {
			_ = os.Remove(tmpName)
		}
	}()
	if _, err = tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}
