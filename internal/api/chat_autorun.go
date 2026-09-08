package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

type chatAutorunState struct {
	Enabled   bool   `json:"enabled"`
	NextRunAt int64  `json:"next_run_at"`
	Language  string `json:"language,omitempty"`
}

func (s *Server) chatAutorunSet(w http.ResponseWriter, r *http.Request, sid string) {
	var req struct {
		Enabled  *bool  `json:"enabled"`
		Language string `json:"language"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req) != nil || req.Enabled == nil {
		bad(w, 400, "enabled is required")
		return
	}
	s.SessionMu.Lock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), safeChatID(sid))
	if err != nil {
		s.SessionMu.Unlock()
		bad(w, 404, "session not found")
		return
	}
	if cs.Autorun.Enabled != *req.Enabled {
		cs.Autorun.Enabled = *req.Enabled
		cs.Autorun.NextRunAt = 0
		if *req.Enabled {
			cs.Autorun.NextRunAt = time.Now().Add(time.Minute).Unix()
		}
	}
	if req.Language == "en" {
		cs.Autorun.Language = "en"
	} else {
		cs.Autorun.Language = "zh"
	}
	err = saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
	s.SessionMu.Unlock()
	if err != nil {
		bad(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"autorun": cs.Autorun})
}

func (s *Server) resetChatAutorunAfterReply(sid string) {
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err == nil && cs.Autorun.Enabled {
		cs.Autorun.NextRunAt = time.Now().Add(30 * time.Minute).Unix()
		_ = saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
	}
}

func (s *Server) StartChatAutorun() {
	s.autorunMu.Lock()
	defer s.autorunMu.Unlock()
	if s.autorunCancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.autorunCancel = cancel
	s.autorunDone = make(chan struct{})
	go func() {
		defer close(s.autorunDone)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.tickChatAutorun(ctx)
			}
		}
	}()
}
func (s *Server) StopChatAutorun() {
	s.autorunMu.Lock()
	defer s.autorunMu.Unlock()
	if s.autorunCancel != nil {
		s.autorunCancel()
		<-s.autorunDone
		s.autorunCancel = nil
	}
}
func (s *Server) tickChatAutorun(ctx context.Context) {
	base := s.BaseCfgStore
	if base == nil {
		base = s.CfgStore
	}
	cfg := base.Snapshot()
	ids := []string{}
	for _, instance := range cfg.Instances {
		ids = append(ids, instance.ID)
	}
	if len(ids) == 0 {
		ids = append(ids, "")
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			return
		}
		req, _ := http.NewRequest(http.MethodGet, "/", nil)
		q := req.URL.Query()
		q.Set("instance_id", id)
		req.URL.RawQuery = q.Encode()
		scoped, _, err := s.chatServerForRequest(req)
		if err != nil {
			continue
		}
		if scoped.recoverChatLoopsAfterRestart() != nil {
			continue
		}
		summaries, err := scoped.loadChatSessionSummaries(scoped.CfgStore.Snapshot())
		if err != nil {
			continue
		}
		for _, cs := range summaries {
			if ctx.Err() != nil {
				return
			}
			if cs.Autorun.Enabled && cs.Autorun.NextRunAt <= time.Now().Unix() {
				scoped.dispatchChatAutorun(cs.ID, time.Now().Unix())
			}
		}
	}
}
func (s *Server) dispatchChatAutorun(sid string, now int64) bool {
	token := s.beginChatRun(sid)
	if token == nil {
		return false
	}
	s.SessionMu.Lock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil || !cs.Autorun.Enabled || cs.Autorun.NextRunAt > now || cs.Loop.Enabled || len(cs.QueuedMessages) > 0 {
		s.SessionMu.Unlock()
		s.endChatRunOwned(sid, token)
		return false
	}
	cs.Autorun.NextRunAt = now + 30*60
	// Persist the claim before spawning a worker; restart cannot duplicate the slot.
	if err = saveChatSessionLocked(s.CfgStore.Snapshot(), cs); err != nil {
		s.SessionMu.Unlock()
		s.endChatRunOwned(sid, token)
		return false
	}
	prompt := "[AUTO] 用户已开启自主行动，请阅读自动化 SOP，执行自动任务。"
	if cs.Autorun.Language == "en" {
		prompt = "[AUTO] Autonomous action is enabled. Read the automation SOP and execute automatic tasks."
	}
	queuedItem := chatQueuedMessage{Text: prompt}
	cs.UpdatedAt = now
	pendingID := newChatID()
	runStartedAtMS := time.Now().UnixMilli()
	pendingMsg := chatMessage{
		ID:             pendingID,
		Role:           "assistant",
		CreatedAt:      time.Now().Unix(),
		RunStartedAtMS: runStartedAtMS,
	}
	queuedUserMsg := chatMessage{
		ID:        newChatID(),
		Role:      "user",
		Content:   queuedItem.Text,
		Files:     convertChatUploadsToMaps(queuedItem.Files),
		CreatedAt: time.Now().Unix(),
	}
	cs.Messages = append(cs.Messages, queuedUserMsg, pendingMsg)
	if queuedItem.LLMNo > 0 {
		cs.Settings.LLMNo = queuedItem.LLMNo
	}
	if queuedItem.ReasoningEffort != "" {
		cs.Settings.ReasoningEffort = queuedItem.ReasoningEffort
	}
	workerHistory := append([]chatMessage(nil), cs.Messages...)
	for i := len(workerHistory) - 1; i >= 0; i-- {
		if workerHistory[i].ID == queuedUserMsg.ID {
			workerHistory = workerHistory[:i]
			break
		}
	}
	cmdReq := map[string]interface{}{
		"prompt":                   queuedItem.Text,
		"files":                    queuedItem.Files,
		"history":                  workerHistory,
		"raw_history":              cs.RawHistory,
		"history_info":             cs.HistoryInfo,
		"working":                  cs.Working,
		"workspace":                cs.Workspace,
		"project_mode":             cs.ProjectMode,
		"extra_sys_prompts":        cs.ExtraSysPrompts,
		"llm_no":                   cs.Settings.LLMNo,
		"reasoning_effort":         cs.Settings.ReasoningEffort,
		"ga_root":                  s.CfgStore.Snapshot().GARoot,
		"_ga_pending_assistant_id": pendingID,
		"_ga_run_started_at_ms":    runStartedAtMS,
	}

	// Publish the pending assistant identity together with the persisted session.
	// Reattaching clients use these fields to bind live deltas to the placeholder;
	// without them a guided queue run only appears after the final session reload.
	s.SessionMu.Unlock()
	owned, saveErr := s.saveChatRunPending(sid, token, pendingID, runStartedAtMS, func() error {
		s.SessionMu.Lock()
		defer s.SessionMu.Unlock()
		latest, err := loadChatSession(s.CfgStore.Snapshot(), sid)
		if err != nil {
			return err
		}
		preserveLatestChatUserMetadata(&cs, latest)
		return saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
	})
	if !owned || saveErr != nil {
		s.endChatRunOwned(sid, token)
		return false
	}

	// Automatic queue consumption bypasses the frontend's optimistic guide path.
	// Publish the persisted user turn on the run stream so attached clients render
	// it immediately; replay and the frontend's message-id dedupe make reconnects safe.
	s.publishChatRun(sid, map[string]interface{}{"type": "user", "message": queuedUserMsg})

	s.ChatMu.Lock()
	if current := s.ChatRuns[sid]; current == token {
		current.PendingAssistantID = pendingID
		current.RunStartedAtMS = runStartedAtMS
	}
	s.ChatMu.Unlock()

	go s.runChatWorkerOwned(sid, token, cs, cmdReq)
	return true
}
