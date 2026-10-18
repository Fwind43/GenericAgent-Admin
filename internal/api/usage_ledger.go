package api

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"genericagent-admin-go/internal/config"
)

const usageLedgerVersion = 1

type usageLedgerEntry struct {
	Key       string      `json:"key"`
	SessionID string      `json:"session_id"`
	Title     string      `json:"title,omitempty"`
	MessageID string      `json:"message_id,omitempty"`
	ModelID   string      `json:"model_id,omitempty"`
	CreatedAt int64       `json:"created_at,omitempty"`
	Totals    usageTotals `json:"totals"`
}

type usageLedger struct {
	Version int                `json:"version"`
	Entries []usageLedgerEntry `json:"entries"`
}

func usageLedgerPath(cfg config.AppConfig) string {
	return filepath.Join(chatDataDir(cfg), "usage_ledger.json")
}

func usageEntryKey(sessionID, messageID string, index int) string {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		messageID = fmt.Sprintf("legacy-%d", index)
	}
	return sessionID + ":" + messageID
}

func usageEntriesFromSession(cs chatSession) []usageLedgerEntry {
	entries := make([]usageLedgerEntry, 0)
	for index, message := range cs.Messages {
		if message.Role != "assistant" {
			continue
		}
		totals, ok := normalizedMessageUsage(message)
		if !ok {
			continue
		}
		entries = append(entries, usageLedgerEntry{
			Key:       usageEntryKey(cs.ID, message.ID, index),
			SessionID: cs.ID,
			Title:     cs.Title,
			MessageID: message.ID,
			ModelID:   message.ModelID,
			CreatedAt: message.CreatedAt,
			Totals:    totals,
		})
	}
	return entries
}

func readUsageLedger(cfg config.AppConfig) (usageLedger, error) {
	contents, err := os.ReadFile(usageLedgerPath(cfg))
	if err != nil {
		return usageLedger{}, err
	}
	var ledger usageLedger
	if err := json.Unmarshal(contents, &ledger); err != nil {
		return usageLedger{}, err
	}
	if ledger.Version != usageLedgerVersion {
		return usageLedger{}, fmt.Errorf("unsupported usage ledger version %d", ledger.Version)
	}
	if ledger.Entries == nil {
		ledger.Entries = []usageLedgerEntry{}
	}
	return ledger, nil
}

func writeUsageLedger(cfg config.AppConfig, ledger usageLedger) error {
	ledger.Version = usageLedgerVersion
	sort.Slice(ledger.Entries, func(i, j int) bool { return ledger.Entries[i].Key < ledger.Entries[j].Key })
	contents, err := json.MarshalIndent(ledger, "", "  ")
	if err != nil {
		return err
	}
	contents = append(contents, '\n')
	return writeChatFileAtomic(usageLedgerPath(cfg), contents, 0644)
}

func migrateUsageLedger(cfg config.AppConfig) (usageLedger, int, error) {
	ledger := usageLedger{Version: usageLedgerVersion, Entries: []usageLedgerEntry{}}
	dir := chatSessionDir(cfg)
	files, err := os.ReadDir(dir)
	if err != nil && !os.IsNotExist(err) {
		return usageLedger{}, 0, err
	}
	skipped := 0
	for _, file := range files {
		if file.IsDir() || !strings.HasSuffix(file.Name(), ".json") {
			continue
		}
		contents, readErr := os.ReadFile(filepath.Join(dir, file.Name()))
		var cs chatSession
		if readErr == nil {
			readErr = json.Unmarshal(contents, &cs)
		}
		if readErr != nil {
			skipped++
			continue
		}
		if strings.TrimSpace(cs.ID) == "" {
			cs.ID = strings.TrimSuffix(file.Name(), ".json")
		}
		ledger.Entries = append(ledger.Entries, usageEntriesFromSession(cs)...)
	}
	if err := writeUsageLedger(cfg, ledger); err != nil {
		return usageLedger{}, skipped, err
	}
	return ledger, skipped, nil
}

func (s *Server) loadOrMigrateUsageLedger() (usageLedger, int, error) {
	s.UsageMu.Lock()
	defer s.UsageMu.Unlock()
	ledger, err := readUsageLedger(s.CfgStore.Snapshot())
	if err == nil {
		return ledger, 0, nil
	}
	if !os.IsNotExist(err) {
		return usageLedger{}, 0, err
	}
	return migrateUsageLedger(s.CfgStore.Snapshot())
}

func (s *Server) recordSessionUsage(cs chatSession) error {
	s.UsageMu.Lock()
	defer s.UsageMu.Unlock()
	ledger, err := readUsageLedger(s.CfgStore.Snapshot())
	if os.IsNotExist(err) {
		ledger, _, err = migrateUsageLedger(s.CfgStore.Snapshot())
	}
	if err != nil {
		return err
	}
	byKey := make(map[string]int, len(ledger.Entries))
	for index := range ledger.Entries {
		byKey[ledger.Entries[index].Key] = index
	}
	changed := false
	for _, entry := range usageEntriesFromSession(cs) {
		if index, ok := byKey[entry.Key]; ok {
			current := &ledger.Entries[index]
			if current.Title == entry.Title && current.ModelID == entry.ModelID &&
				current.Totals.InputTokens == entry.Totals.InputTokens &&
				current.Totals.OutputTokens == entry.Totals.OutputTokens &&
				current.Totals.TotalTokens == entry.Totals.TotalTokens &&
				maps.Equal(current.Totals.Other, entry.Totals.Other) {
				continue
			}
			// Persist corrections (including stale zero-values), not identical snapshots.
			current.Title = entry.Title
			current.Totals = entry.Totals
			current.ModelID = entry.ModelID
			changed = true
			continue
		}
		byKey[entry.Key] = len(ledger.Entries)
		ledger.Entries = append(ledger.Entries, entry)
		changed = true
	}
	if !changed {
		return nil
	}
	return writeUsageLedger(s.CfgStore.Snapshot(), ledger)
}
