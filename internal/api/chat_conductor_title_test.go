package api

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"genericagent-admin-go/internal/config"
)

func TestConductorObjectiveTitleNormalization(t *testing.T) {
	for _, source := range []string{"", chatTitleSourceTemporary, chatTitleSourceGenerated, chatTitleSourceObjective} {
		cs := chatSession{Title: "old", TitleSource: source, Conductor: &chatConductorState{Role: conductorRoleWorker, Objective: "  fix\n\t layout  "}}
		updateChatTitle(&cs)
		if cs.Title != "fix layout" || cs.TitleSource != chatTitleSourceObjective {
			t.Fatalf("source %q: %+v", source, cs)
		}
		if _, ok := chatTitleExchangeForGeneration(cs); ok {
			t.Fatal("worker accepted for AI title generation")
		}
		if chatTitleNeedsAutomaticBackfill(cs) {
			t.Fatal("worker accepted for AI title backfill")
		}
	}
	cs := chatSession{Conductor: &chatConductorState{Role: conductorRoleWorker, Objective: strings.Repeat("\u4e2d", 80)}}
	syncConductorChatTitle(&cs)
	if len([]rune(cs.Title)) != maxChatTitleRunes {
		t.Fatalf("unicode truncation: %q", cs.Title)
	}
	for _, cs := range []chatSession{
		{Title: "manual", TitleSource: chatTitleSourceManual, Conductor: &chatConductorState{Role: conductorRoleWorker, Objective: "goal"}},
		{Title: "parent", Conductor: &chatConductorState{Role: conductorRoleParent, Objective: "goal"}},
		{Title: "ordinary"},
		{Title: "empty goal", Conductor: &chatConductorState{Role: conductorRoleWorker, Objective: "  "}},
	} {
		original := cs.Title
		syncConductorChatTitle(&cs)
		if cs.Title != original {
			t.Fatalf("unrelated or explicit title changed: %+v", cs)
		}
	}
}

func TestConductorObjectiveTitleLegacyReadAndIndex(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	cs := chatSession{ID: "legacy-objective", Title: "wrong AI title", TitleSource: chatTitleSourceGenerated, UpdatedAt: 123, Messages: []chatMessage{{ID: "a1", Role: "assistant", Content: "history"}}, Conductor: &chatConductorState{Role: conductorRoleWorker, Objective: "current objective"}}
	path := chatSessionPath(cfg, cs.ID)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(cs)
	if err := os.WriteFile(path, before, 0644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	stale := chatSessionListIndex{Version: chatSessionListIndexVersion - 1, Entries: map[string]chatSessionListIndexEntry{filepath.Base(path): {Size: info.Size(), ModTimeNS: info.ModTime().UnixNano(), Summary: chatSessionSummary{ID: cs.ID, Title: cs.Title, TitleSource: cs.TitleSource}}}}
	indexBytes, _ := json.Marshal(stale)
	if err := os.WriteFile(chatSessionListIndexPath(cfg), indexBytes, 0644); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		loaded, err := loadChatSession(cfg, cs.ID)
		if err != nil || loaded.Title != "current objective" || loaded.TitleSource != chatTitleSourceObjective || loaded.UpdatedAt != 123 || len(loaded.Messages) != 1 || loaded.Messages[0].Content != "history" {
			t.Fatalf("legacy load: %+v %v", loaded, err)
		}
		summaries, err := s.loadChatSessionSummaries(cfg)
		if err != nil || len(summaries) != 1 || summaries[0].Title != loaded.Title || summaries[0].TitleSource != chatTitleSourceObjective || summaries[0].UpdatedAt != 123 {
			t.Fatalf("summary: %+v %v", summaries, err)
		}
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("read mutated persisted history: %v", err)
	}
	for _, touch := range []bool{false, true} {
		if err := saveChatSessionWithUpdatedAtLocked(cfg, cs, touch); err != nil {
			t.Fatal(err)
		}
		persisted, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var saved chatSession
		if err := json.Unmarshal(persisted, &saved); err != nil {
			t.Fatal(err)
		}
		if saved.Title != "current objective" || saved.TitleSource != chatTitleSourceObjective {
			t.Fatalf("write path not normalized: %+v", saved)
		}
		if !touch && saved.UpdatedAt != 123 {
			t.Fatal("normalization changed timestamp")
		}
	}
}

func TestConductorObjectiveTitleDispatchAndReuse(t *testing.T) {
	s := newChatLoopTestServer(t)
	parent := chatSession{ID: "objective-parent", Conductor: &chatConductorState{Role: conductorRoleParent}}
	for i := 0; i < conductorMaxRunning; i++ {
		parent.ConductorChildren = append(parent.ConductorChildren, chatConductorChild{DispatchID: string(rune('a' + i)), Status: conductorRunning})
	}
	parent.ConductorChildren = append(parent.ConductorChildren, chatConductorChild{DispatchID: "old", SessionID: "objective-worker", Status: conductorSucceeded, Result: "old result"})
	saveChatLoopTestSession(t, s, parent)
	saveChatLoopTestSession(t, s, chatSession{ID: "objective-worker", Title: "previous manual name", TitleSource: chatTitleSourceManual, Messages: []chatMessage{{Role: "assistant", Content: "remember me"}}, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: parent.ID, DispatchID: "old", Status: conductorSucceeded, Objective: "previous objective"}})
	token := s.beginChatRun(parent.ID)
	defer s.endChatRunOwned(parent.ID, token)
	for _, id := range []string{"", "objective-worker"} {
		child, err := s.dispatchConductor(parent.ID, "  new\n task  ", id)
		if err != nil {
			t.Fatal(err)
		}
		worker, err := loadChatSession(s.CfgStore.Snapshot(), child.SessionID)
		if err != nil || worker.Title != "new task" || worker.TitleSource != chatTitleSourceObjective || worker.Conductor.Objective != "new\n task" {
			t.Fatalf("dispatch title: %+v %v", worker, err)
		}
		if id != "" && (child.SessionID != id || len(worker.Messages) != 1 || worker.Messages[0].Content != "remember me") {
			t.Fatalf("reuse lost history: %+v", worker)
		}
	}
}

func TestConductorObjectiveTitleManualRenameAndMergedSave(t *testing.T) {
	s := newChatLoopTestServer(t)
	cs := chatSession{ID: "manual-objective", Title: "goal", TitleSource: chatTitleSourceObjective, Conductor: &chatConductorState{Role: conductorRoleWorker, Objective: "goal"}}
	saveChatLoopTestSession(t, s, cs)
	manual := cs
	manual.Title = "custom name"
	manual.TitleSource = chatTitleSourceManual
	if err := saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), manual); err != nil {
		t.Fatal(err)
	}
	cs.Title = "stale generated title"
	cs.TitleSource = chatTitleSourceGenerated
	if err := s.saveChatSessionMergedLocked(cs); err != nil {
		t.Fatal(err)
	}
	saved, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID)
	if err != nil || saved.Title != "custom name" || saved.TitleSource != chatTitleSourceManual {
		t.Fatalf("manual rename overwritten: %+v %v", saved, err)
	}
}

func TestConductorObjectiveTitleSkipsAI(t *testing.T) {
	s := newChatLoopTestServer(t)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) { cfg.ChatTitleModel = &config.ChatTitleModelRef{Enable: true} })
	cs := chatSession{ID: "skip-ai-objective", Title: "request", TitleSource: chatTitleSourceTemporary, Messages: []chatMessage{{ID: "u1", Role: "user", Content: "request"}, {ID: "a1", Role: "assistant", Content: "done"}}, Conductor: &chatConductorState{Role: conductorRoleWorker, Objective: "objective"}}
	saveChatLoopTestSession(t, s, cs)
	old := runOneShotChatTitleWorkerFunc
	defer func() { runOneShotChatTitleWorkerFunc = old }()
	runOneShotChatTitleWorkerFunc = func(config.AppConfig, string, map[string]interface{}) (string, error) {
		t.Error("unexpected AI title call")
		return "wrong", nil
	}
	s.scheduleChatTitleGeneration(cs.ID, cs)
	if _, err := s.generateLegacyChatTitle(cs.ID); err != errChatTitleNotLegacy {
		t.Fatalf("worker eligible for backfill: %v", err)
	}
}

func TestConductorObjectiveTitleRejectsInFlightAI(t *testing.T) {
	s := newChatLoopTestServer(t)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) { cfg.ChatTitleModel = &config.ChatTitleModelRef{Enable: true} })
	cs := chatSession{ID: "racing-objective", Title: "request", TitleSource: chatTitleSourceTemporary, Messages: []chatMessage{{ID: "u1", Role: "user", Content: "request"}, {ID: "a1", Role: "assistant", Content: "done"}}}
	saveChatLoopTestSession(t, s, cs)
	old := runOneShotChatTitleWorkerFunc
	entered, release := make(chan struct{}), make(chan struct{})
	runOneShotChatTitleWorkerFunc = func(config.AppConfig, string, map[string]interface{}) (string, error) {
		close(entered)
		<-release
		return "stale AI title", nil
	}
	released := false
	defer func() {
		if !released {
			close(release)
		}
		runOneShotChatTitleWorkerFunc = old
	}()
	s.scheduleChatTitleGeneration(cs.ID, cs)
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("title job did not start")
	}
	cs.Conductor = &chatConductorState{Role: conductorRoleWorker, Objective: "new objective"}
	if err := saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), cs); err != nil {
		t.Fatal(err)
	}
	close(release)
	released = true
	deadline := time.Now().Add(2 * time.Second)
	for {
		s.ChatMu.Lock()
		active := s.ChatTitleJobs[cs.ID]
		s.ChatMu.Unlock()
		if !active {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("title job did not finish")
		}
		time.Sleep(time.Millisecond)
	}
	raw, err := os.ReadFile(chatSessionPath(s.CfgStore.Snapshot(), cs.ID))
	if err != nil {
		t.Fatal(err)
	}
	var saved chatSession
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Title != "new objective" || saved.TitleSource != chatTitleSourceObjective {
		t.Fatalf("in-flight AI overwrote objective: %+v", saved)
	}
}
