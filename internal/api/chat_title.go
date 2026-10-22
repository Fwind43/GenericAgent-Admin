package api

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"unicode"
)

func truncateChatRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func chatTitleVisibleContent(content string) string {
	content = strings.TrimSpace(content)
	if i := strings.Index(content, "[附件已保存]"); i >= 0 {
		content = content[:i]
	}
	return strings.Join(strings.Fields(content), " ")
}

func chatTitleUserContent(msg chatMessage) string {
	content := chatTitleVisibleContent(msg.Content)
	if content == "" && len(msg.Files) > 0 {
		return "用户上传了附件"
	}
	return content
}

func temporaryChatTitle(messages []chatMessage) string {
	for _, msg := range messages {
		if msg.Role != "user" {
			continue
		}
		title := chatTitleVisibleContent(msg.Content)
		if title == "" && len(msg.Files) > 0 {
			title = "附件会话"
		}
		if title != "" {
			return truncateChatRunes(title, 64)
		}
	}
	return ""
}

func updateChatTitle(cs *chatSession) {
	syncConductorChatTitle(cs)
	if conductorObjectiveChatTitle(*cs) != "" {
		return
	}
	// Never overwrite manually set or AI-generated titles
	if cs.TitleSource == chatTitleSourceManual || cs.TitleSource == chatTitleSourceGenerated {
		return
	}
	if cs.Title != "" && cs.Title != "新会话" {
		return
	}
	if title := temporaryChatTitle(cs.Messages); title != "" {
		cs.Title = title
		cs.TitleSource = chatTitleSourceTemporary
	}
}

func sanitizeGeneratedChatTitle(title string) string {
	title = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(title, "\r", " "), "\n", " "))
	lower := strings.ToLower(title)
	if strings.HasPrefix(lower, "!!!error:") || strings.HasPrefix(lower, "[error:") ||
		strings.HasPrefix(lower, "error:") || strings.HasPrefix(title, "执行失败：") {
		return ""
	}
	title = strings.Trim(title, "`\"'“”‘’ ")
	for _, prefix := range []string{"标题:", "标题：", "Title:", "Title："} {
		if strings.HasPrefix(strings.ToLower(title), strings.ToLower(prefix)) {
			title = strings.TrimSpace(title[len(prefix):])
			break
		}
	}
	title = strings.Join(strings.Fields(title), " ")
	title = strings.TrimFunc(title, func(r rune) bool {
		return unicode.IsPunct(r) && r != '+' && r != '#'
	})
	title = strings.TrimSpace(title)
	if len([]rune(title)) > maxChatTitleRunes {
		return ""
	}
	lower = strings.ToLower(title)
	for _, prefix := range []string{
		"the conversation", "this conversation", "the user", "we were asked", "i was asked",
		"我们被要求", "我被要求", "用户要求", "这个对话", "该对话", "对话内容", "以下对话", "我们根据", "总结为",
	} {
		if strings.HasPrefix(lower, strings.ToLower(prefix)) {
			return ""
		}
	}
	return title
}

func chatTitleExchangeForGeneration(cs chatSession) (chatTitleExchange, bool) {
	if conductorObjectiveChatTitle(cs) != "" {
		return chatTitleExchange{}, false
	}
	messages := make([]chatMessage, 0, 2)
	for _, msg := range cs.Messages {
		if msg.Kind == "btw" || (msg.Role != "user" && msg.Role != "assistant") {
			continue
		}
		if strings.TrimSpace(msg.Content) == "" {
			continue
		}
		messages = append(messages, msg)
	}
	if len(messages) != 2 || messages[0].Role != "user" || messages[1].Role != "assistant" || messages[1].Error {
		return chatTitleExchange{}, false
	}
	temporary := temporaryChatTitle(messages)
	if temporary == "" {
		return chatTitleExchange{}, false
	}
	switch cs.TitleSource {
	case chatTitleSourceGenerated, chatTitleSourceManual:
		return chatTitleExchange{}, false
	}
	title := strings.TrimSpace(cs.Title)
	if title != "" && title != "新会话" && title != temporary {
		return chatTitleExchange{}, false
	}
	return chatTitleExchange{
		User:               truncateChatRunes(chatTitleUserContent(messages[0]), 2000),
		Assistant:          truncateChatRunes(chatTitleVisibleContent(messages[1].Content), 4000),
		UserMessageID:      messages[0].ID,
		AssistantMessageID: messages[1].ID,
	}, true
}

func chatTitleExchangeStillExists(cs chatSession, exchange chatTitleExchange) bool {
	var userFound, assistantFound bool
	for _, msg := range cs.Messages {
		switch msg.ID {
		case exchange.UserMessageID:
			userFound = msg.Role == "user" &&
				truncateChatRunes(chatTitleUserContent(msg), 2000) == exchange.User
		case exchange.AssistantMessageID:
			assistantFound = msg.Role == "assistant" && !msg.Error &&
				truncateChatRunes(chatTitleVisibleContent(msg.Content), 4000) == exchange.Assistant
		}
	}
	return userFound && assistantFound
}

func chatTitleContextForSession(cs chatSession) (chatTitleContext, bool) {
	messages := make([]chatTitleContextMessage, 0, 6)
	hasUser := false
	for index, msg := range cs.Messages {
		if msg.Kind == "btw" || msg.Error || (msg.Role != "user" && msg.Role != "assistant") {
			continue
		}
		content := chatTitleVisibleContent(msg.Content)
		if msg.Role == "user" {
			content = chatTitleUserContent(msg)
			hasUser = hasUser || content != ""
		}
		if content == "" {
			continue
		}
		limit := 4000
		if msg.Role == "user" {
			limit = 2000
		}
		messages = append(messages, chatTitleContextMessage{
			Role:        msg.Role,
			Content:     truncateChatRunes(content, limit),
			SourceIndex: index,
		})
	}
	if !hasUser || len(messages) == 0 {
		return chatTitleContext{}, false
	}
	if len(messages) > 6 {
		messages = append([]chatTitleContextMessage{messages[0]}, messages[len(messages)-5:]...)
	}
	return chatTitleContext{Messages: messages}, true
}

func chatTitleContextStillExists(cs chatSession, context chatTitleContext) bool {
	for _, expected := range context.Messages {
		if expected.SourceIndex < 0 || expected.SourceIndex >= len(cs.Messages) {
			return false
		}
		msg := cs.Messages[expected.SourceIndex]
		content := chatTitleVisibleContent(msg.Content)
		if expected.Role == "user" {
			content = chatTitleUserContent(msg)
		}
		limit := 4000
		if expected.Role == "user" {
			limit = 2000
		}
		if msg.Role != expected.Role || msg.Error || truncateChatRunes(content, limit) != expected.Content {
			return false
		}
	}
	return true
}

func chatTitleNeedsAutomaticBackfill(cs chatSession) bool {
	if conductorObjectiveChatTitle(cs) != "" {
		return false
	}
	if cs.TitleSource == chatTitleSourceGenerated || cs.TitleSource == chatTitleSourceManual {
		return false
	}
	if _, ok := chatTitleContextForSession(cs); !ok {
		return false
	}
	current := strings.TrimSpace(cs.Title)
	temporary := temporaryChatTitle(cs.Messages)
	return current == "" || current == "新会话" ||
		(temporary != "" && (current == temporary ||
			(cs.TitleSource == "" && strings.HasPrefix(temporary, current))))
}

func (s *Server) chatTitleLLMNo(fallback int) int {
	selected := s.CfgStore.Snapshot().ChatTitleModel
	if selected == nil || !selected.Enable {
		return -1 // Disabled by default or explicitly
	}
	// Enable=true: empty provider/model = follow conversation model
	if strings.TrimSpace(selected.ProviderVarName) == "" && strings.TrimSpace(selected.Model) == "" {
		if fallback < 0 {
			return -1
		}
		return fallback
	}
	// Enable=true with specific provider/model = use configured LLMNo
	if selected.LLMNo >= 0 {
		return selected.LLMNo
	}
	return -1
}

func (s *Server) beginChatTitleJob(sid string) bool {
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	if s.ChatTitleJobs == nil {
		s.ChatTitleJobs = map[string]bool{}
	}
	if s.ChatTitleJobs[sid] {
		return false
	}
	s.ChatTitleJobs[sid] = true
	return true
}

func (s *Server) finishChatTitleJob(sid string) {
	s.ChatMu.Lock()
	delete(s.ChatTitleJobs, sid)
	s.ChatMu.Unlock()
}

func (s *Server) scheduleChatTitleGeneration(sid string, cs chatSession) {
	exchange, ok := chatTitleExchangeForGeneration(cs)
	if !ok {
		return
	}
	llmNo := s.chatTitleLLMNo(cs.Settings.LLMNo)
	if llmNo == -1 {
		return // Title generation explicitly disabled
	}
	sid = safeChatID(sid)
	if !s.beginChatTitleJob(sid) {
		return
	}

	go func() {
		defer s.finishChatTitleJob(sid)
		title, err := runOneShotChatTitleWorkerFunc(s.CfgStore.Snapshot(), sid, map[string]interface{}{
			"op":           "title",
			"conversation": exchange,
			"llm_no":       llmNo,
			"ga_root":      s.CfgStore.Snapshot().GARoot,
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "chat title generation failed for %s: %v\n", sid, err)
			return
		}
		title = sanitizeGeneratedChatTitle(title)
		if title == "" {
			return
		}
		s.SessionMu.Lock()
		defer s.SessionMu.Unlock()
		latest, err := loadChatSession(s.CfgStore.Snapshot(), sid)
		if err != nil || conductorObjectiveChatTitle(latest) != "" || latest.TitleSource == chatTitleSourceManual || latest.TitleSource == chatTitleSourceGenerated {
			return
		}
		if !chatTitleExchangeStillExists(latest, exchange) {
			return
		}
		temporary := temporaryChatTitle(latest.Messages)
		current := strings.TrimSpace(latest.Title)
		if current != "" && current != "新会话" && current != temporary {
			return
		}
		latest.Title = title
		latest.TitleSource = chatTitleSourceGenerated
		if err := saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), latest); err != nil {
			fmt.Fprintf(os.Stderr, "chat title persistence failed for %s: %v\n", sid, err)
		}
	}()
}

func (s *Server) generateLegacyChatTitle(sid string) (chatSession, error) {
	sid = safeChatID(sid)
	if s.chatRunActive(sid) {
		return chatSession{}, errChatTitleRunActive
	}
	if !s.beginChatTitleJob(sid) {
		return chatSession{}, errChatTitleBusy
	}
	defer s.finishChatTitleJob(sid)

	s.SessionMu.Lock()
	start, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		s.SessionMu.Unlock()
		return chatSession{}, err
	}
	if !chatTitleNeedsAutomaticBackfill(start) {
		s.SessionMu.Unlock()
		return chatSession{}, errChatTitleNotLegacy
	}
	llmNo := s.chatTitleLLMNo(start.Settings.LLMNo)
	if llmNo == -1 {
		s.SessionMu.Unlock()
		return chatSession{}, fmt.Errorf("title generation is disabled")
	}
	context, ok := chatTitleContextForSession(start)
	startTitle, startTitleSource := start.Title, start.TitleSource
	s.SessionMu.Unlock()
	if !ok {
		return chatSession{}, errChatTitleNoContext
	}

	title, err := runOneShotChatTitleWorkerFunc(s.CfgStore.Snapshot(), sid, map[string]interface{}{
		"op":           "title",
		"conversation": context,
		"llm_no":       llmNo,
		"ga_root":      s.CfgStore.Snapshot().GARoot,
	})
	if err != nil {
		return chatSession{}, err
	}
	title = sanitizeGeneratedChatTitle(title)
	if title == "" {
		return chatSession{}, errChatTitleEmpty
	}

	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	latest, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		return chatSession{}, err
	}
	if latest.Title != startTitle || latest.TitleSource != startTitleSource || !chatTitleContextStillExists(latest, context) {
		return chatSession{}, errChatTitleChanged
	}
	latest.Title = title
	latest.TitleSource = chatTitleSourceGenerated
	if err := saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), latest); err != nil {
		return chatSession{}, err
	}
	return latest, nil
}

func (s *Server) automaticChatTitleBackfillCandidates() ([]string, error) {
	s.SessionMu.Lock()
	summaries, err := s.loadChatSessionSummaries(s.CfgStore.Snapshot())
	s.SessionMu.Unlock()
	if err != nil {
		return nil, err
	}
	type candidate struct {
		id        string
		updatedAt int64
	}
	candidates := make([]candidate, 0, len(summaries))
	for _, summary := range summaries {
		if summary.titleNeedsBackfill {
			candidates = append(candidates, candidate{id: summary.ID, updatedAt: summary.UpdatedAt})
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].updatedAt > candidates[j].updatedAt })
	if len(candidates) > 80 {
		candidates = candidates[:80]
	}
	ids := make([]string, len(candidates))
	for index, item := range candidates {
		ids[index] = item.id
	}
	return ids, nil
}

func (s *Server) StartAutomaticChatTitleBackfill() bool {
	s.ChatMu.Lock()
	if s.titleBackfillStarted {
		s.ChatMu.Unlock()
		return false
	}
	s.titleBackfillStarted = true
	s.ChatMu.Unlock()

	go func() {
		ids, err := s.automaticChatTitleBackfillCandidates()
		if err != nil {
			fmt.Fprintf(os.Stderr, "chat title backfill scan failed: %v\n", err)
			return
		}
		jobs := make(chan string)
		var workers sync.WaitGroup
		for range 2 {
			workers.Add(1)
			go func() {
				defer workers.Done()
				for sid := range jobs {
					if _, err := s.generateLegacyChatTitle(sid); err != nil &&
						!errors.Is(err, errChatTitleBusy) &&
						!errors.Is(err, errChatTitleRunActive) &&
						!errors.Is(err, errChatTitleNotLegacy) &&
						!errors.Is(err, errChatTitleChanged) {
						fmt.Fprintf(os.Stderr, "chat title backfill failed for %s: %v\n", sid, err)
					}
				}
			}()
		}
		for _, sid := range ids {
			jobs <- sid
		}
		close(jobs)
		workers.Wait()
	}()
	return true
}
