package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

const (
	// A malformed next_prompt gets one corrective re-ask before the loop stops.
	chatLoopControllerAttempts = 2
	// A controller that keeps asking for the identical next step is spinning.
	chatLoopMaxPromptRepeats = 2

	chatLoopStatusWaiting    = "waiting"
	chatLoopStatusRunning    = "running"
	chatLoopStatusEvaluating = "evaluating"
	chatLoopStatusStopped    = "stopped"
	chatLoopStatusCompleted  = "completed"
	chatLoopStatusError      = "error"
	chatLoopStatusPaused     = "paused"
)

var (
	chatLoopNextPromptTagRE = regexp.MustCompile(`(?is)</?next_prompt\s*>`)
	errChatLoopStale        = errors.New("stale chat loop decision")
)

const (
	maxChatLoopRecords         = 40
	maxChatLoopRecordTextRunes = 360
)

func boundedChatLoopRecordText(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	runes := []rune(text)
	if len(runes) <= maxChatLoopRecordTextRunes {
		return text
	}
	return string(runes[:maxChatLoopRecordTextRunes]) + "..."
}

func appendChatLoopRecord(state *chatLoopState, phase, summary, prompt string) {
	if state == nil {
		return
	}
	state.Records = append(state.Records, chatLoopRecord{
		AtMS:    time.Now().UnixMilli(),
		Round:   state.Round,
		Phase:   boundedChatLoopRecordText(phase),
		Summary: boundedChatLoopRecordText(summary),
		Prompt:  boundedChatLoopRecordText(prompt),
	})
	if len(state.Records) > maxChatLoopRecords {
		state.Records = append([]chatLoopRecord(nil), state.Records[len(state.Records)-maxChatLoopRecords:]...)
	}
}

func appendChatLoopTerminalRecord(state *chatLoopState, status, reason string) {
	phase := "stopped"
	summary := "Loop stopped."
	switch {
	case status == chatLoopStatusCompleted && reason == "controller_no_action":
		phase = "no_action"
		summary = "Controller reported no further action."
	case status == chatLoopStatusCompleted:
		phase = "complete"
		summary = "Controller marked the objective complete."
	case status == chatLoopStatusError:
		phase = "error"
		summary = "Controller evaluation failed."
	case status == chatLoopStatusPaused:
		phase = "paused"
		summary = "Loop paused."
	}
	appendChatLoopRecord(state, phase, summary, "")
}

func chatLoopPromptFingerprint(prompt string) string {
	normalized := strings.ToLower(strings.Join(strings.Fields(prompt), " "))
	if normalized == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

func chatLoopHasTerminalAssistant(cs chatSession) bool {
	if len(cs.Messages) == 0 {
		return false
	}
	last := cs.Messages[len(cs.Messages)-1]
	return last.Role == "assistant" && !last.Error && strings.TrimSpace(last.Content) != ""
}

func chatLoopControllerPrompt(objective string, round int) string {
	return fmt.Sprintf(`You are the controller for an autonomous task loop. Do not perform the task yourself.

Loop objective (quoted): %q
Completed automatic rounds: %d.

Review the full conversation. If the objective is not yet complete and the worker needs another push, output the next reminder or corrective instruction inside exactly one <next_prompt>...</next_prompt> element.
If no further worker action is needed, do not output a <next_prompt> element.

Keep any next prompt concise and actionable. Do not use placeholder text, markdown fences, or more than one decision element.`, objective, round)
}

func chatLoopControllerRetryPrompt(objective string, round int) string {
	return chatLoopControllerPrompt(objective, round) + `

Your previous reply contained an empty, placeholder, or malformed next_prompt element. Return one complete non-empty <next_prompt>...</next_prompt> element if another worker action is needed; otherwise return no next_prompt element.`
}

type chatLoopDecision struct {
	Complete bool
	NoAction bool
	Prompt   string
}

func extractLastChatLoopElementAt(content string, tagRE *regexp.Regexp) (string, int, bool) {
	tags := tagRE.FindAllStringIndex(content, -1)
	for i := len(tags) - 1; i > 0; i-- {
		closeTag := content[tags[i][0]:tags[i][1]]
		openTag := content[tags[i-1][0]:tags[i-1][1]]
		if strings.HasPrefix(strings.ToLower(closeTag), "</") && !strings.HasPrefix(strings.ToLower(openTag), "</") {
			value := strings.TrimSpace(content[tags[i-1][1]:tags[i][0]])
			if value != "" {
				return value, tags[i][1], true
			}
		}
	}
	return "", -1, false
}

func extractLastChatLoopElement(content string, tagRE *regexp.Regexp) (string, bool) {
	value, _, ok := extractLastChatLoopElementAt(content, tagRE)
	return value, ok
}

func parseChatLoopNextPrompt(content string) string {
	prompt, _ := extractLastChatLoopElement(content, chatLoopNextPromptTagRE)
	return prompt
}

func isChatLoopPlaceholderPrompt(prompt string) bool {
	normalized := strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(prompt)), ""))
	if normalized == "" {
		return true
	}
	switch normalized {
	case "continue", "none", "null", "n/a", "na", "tbd", "placeholder", "继续", "待定":
		return true
	}
	for _, r := range normalized {
		switch r {
		case '.', '…', '·', '-', '_', '—':
		default:
			return false
		}
	}
	return true
}

func parseChatLoopDecision(content string) (chatLoopDecision, error) {
	prompt, hasPrompt := extractLastChatLoopElement(content, chatLoopNextPromptTagRE)
	if hasPrompt {
		if isChatLoopPlaceholderPrompt(prompt) {
			return chatLoopDecision{}, errors.New("controller returned an empty or placeholder next_prompt")
		}
		return chatLoopDecision{Prompt: prompt}, nil
	}
	if chatLoopNextPromptTagRE.MatchString(content) {
		return chatLoopDecision{}, errors.New("controller returned a malformed next_prompt element")
	}
	return chatLoopDecision{Complete: true, NoAction: true}, nil
}

func (s *Server) chatLoopStart(w http.ResponseWriter, r *http.Request, sid string) {
	var req struct {
		Objective        string `json:"objective"`
		ControllerPrompt string `json:"controller_prompt"`
		ControllerLLMNo  *int   `json:"controller_llm_no"`
	}
	if err := decode(r, &req); err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	objective := strings.TrimSpace(req.Objective)
	if objective == "" {
		objective = strings.TrimSpace(req.ControllerPrompt)
	}
	if objective == "" {
		bad(w, http.StatusBadRequest, "objective is required")
		return
	}

	sid = safeChatID(sid)
	running := s.chatRunActive(sid)
	controllerEpoch := int64(0)
	s.SessionMu.Lock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err == nil {
		if cs.ID == "" {
			cs = chatSession{
				ID:         sid,
				Title:      "New chat",
				UpdatedAt:  time.Now().Unix(),
				Messages:   []chatMessage{},
				Settings:   s.defaultChatSettings(),
				RawHistory: []map[string]interface{}{},
			}
		}
		controllerEpoch = cs.Loop.Epoch
		controllerLLMNo := cs.Settings.LLMNo
		if req.ControllerLLMNo != nil {
			controllerLLMNo = *req.ControllerLLMNo
		}
		cs.Loop = chatLoopState{
			Enabled:          true,
			Status:           chatLoopStatusWaiting,
			Epoch:            cs.Loop.Epoch + 1,
			Round:            0,
			ControllerPrompt: objective,
			ControllerLLMNo:  controllerLLMNo,
		}
		appendChatLoopRecord(&cs.Loop, "started", "Loop started.", "")
		if running {
			cs.Loop.Status = chatLoopStatusRunning
		} else if len(cs.Messages) == 0 {
			// An empty session has no completed run for the controller to evaluate.
			// Queue the objective itself as the first worker round instead of leaving
			// the loop waiting forever for a terminal event that cannot arrive.
			cs.Loop.Status = chatLoopStatusEvaluating
		}
		err = saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
	}
	s.SessionMu.Unlock()
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.cancelChatLoopController(sid, controllerEpoch)

	if !running && len(cs.Messages) == 0 {
		go continueChatLoopFunc(s, sid, cs.Loop.Epoch, objective)
	} else if !running && chatLoopHasTerminalAssistant(cs) {
		s.afterChatRunTerminal(sid, true)
	}
	writeJSON(w, map[string]interface{}{"ok": true, "loop": cs.Loop})
}

func (s *Server) chatLoopStop(w http.ResponseWriter, r *http.Request, sid string) {
	sid = safeChatID(sid)
	controllerEpoch := int64(0)
	s.SessionMu.Lock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err == nil {
		if cs.ID == "" {
			err = fmt.Errorf("chat session not found")
		} else {
			controllerEpoch = cs.Loop.Epoch
			cs.Loop.Enabled = false
			cs.Loop.Status = chatLoopStatusStopped
			cs.Loop.StopReason = "user"
			cs.Loop.Epoch++
			err = saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
		}
	}
	s.SessionMu.Unlock()
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.cancelChatLoopController(sid, controllerEpoch)
	if _, cancelErr := s.cancelChatRun(sid); cancelErr != nil {
		bad(w, http.StatusInternalServerError, fmt.Sprintf("loop stopped but failed to persist canceled run: %v", cancelErr))
		return
	}
	s.publishChatLoopState(sid, cs.Loop)
	writeJSON(w, map[string]interface{}{"ok": true, "loop": cs.Loop})
}

func (s *Server) publishChatLoopState(sid string, state chatLoopState) {
	s.publishChatRun(sid, map[string]interface{}{"type": "loop", "loop": state})
}

func (s *Server) afterChatRunTerminal(sid string, success bool) {
	s.resetChatAutorunAfterReply(sid)
	if !success {
		return
	}
	sid = safeChatID(sid)

	s.SessionMu.Lock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		s.SessionMu.Unlock()
		return
	}

	// Check queued messages first
	if success && len(cs.QueuedMessages) > 0 {
		s.SessionMu.Unlock()
		go s.processNextQueuedMessage(sid)
		return
	}

	// Then check loop mode
	if !cs.Loop.Enabled || cs.Loop.Status == chatLoopStatusEvaluating {
		s.SessionMu.Unlock()
		return
	}
	cs.Loop.Status = chatLoopStatusEvaluating
	cs.Loop.StopReason = ""
	appendChatLoopRecord(&cs.Loop, "checking", "Observer is checking the latest run.", "")
	epoch := cs.Loop.Epoch
	if err = saveChatSessionLocked(s.CfgStore.Snapshot(), cs); err != nil {
		s.SessionMu.Unlock()
		return
	}
	s.SessionMu.Unlock()
	s.publishChatLoopState(sid, cs.Loop)
	go s.evaluateChatLoop(sid, epoch, cs)
}

func (s *Server) runChatLoopController(sid string, epoch int64, req map[string]interface{}) (chatMessage, error) {
	sid = safeChatID(sid)
	owner := &chatLoopControllerRun{Epoch: epoch}
	observer := &oneShotBTWWorkerObserver{
		Started: func(worker *chatWorker) bool {
			s.ChatMu.Lock()
			defer s.ChatMu.Unlock()
			current := s.ChatLoopControllers[sid]
			if current != nil && (current.Epoch > epoch || current.Epoch == epoch && current.Canceled) {
				return false
			}
			owner.Worker = worker
			s.ChatLoopControllers[sid] = owner
			return true
		},
		Finished: func(worker *chatWorker) {
			s.ChatMu.Lock()
			if current := s.ChatLoopControllers[sid]; current == owner && current.Worker == worker {
				delete(s.ChatLoopControllers, sid)
			}
			s.ChatMu.Unlock()
		},
	}
	controllerReq := make(map[string]interface{}, len(req)+1)
	for key, value := range req {
		controllerReq[key] = value
	}
	controllerReq[oneShotBTWWorkerObserverKey] = observer
	return runOneShotBTWWorkerFunc(s.CfgStore.Snapshot(), sid+"-loop", controllerReq)
}

func (s *Server) cancelChatLoopController(sid string, epoch int64) bool {
	sid = safeChatID(sid)
	s.ChatMu.Lock()
	current := s.ChatLoopControllers[sid]
	if current != nil && current.Epoch > epoch {
		s.ChatMu.Unlock()
		return false
	}
	if current == nil || current.Epoch < epoch {
		current = &chatLoopControllerRun{Epoch: epoch}
		s.ChatLoopControllers[sid] = current
	}
	current.Canceled = true
	worker := current.Worker
	s.ChatMu.Unlock()
	if worker != nil {
		worker.Mu.Lock()
		if worker.Cmd != nil && worker.Cmd.Process != nil {
			_ = worker.Cmd.Process.Kill()
		}
		worker.Mu.Unlock()
	}
	return worker != nil
}

func (s *Server) evaluateChatLoop(sid string, epoch int64, cs chatSession) {
	state := cs.Loop
	cmdReq := map[string]interface{}{
		"op":                "btw",
		"history":           cs.Messages,
		"raw_history":       cs.RawHistory,
		"history_info":      cs.HistoryInfo,
		"working":           cs.Working,
		"workspace":         cs.Workspace,
		"project_mode":      cs.ProjectMode,
		"project_provider":  cs.ProjectProvider,
		"project_id":        cs.ProjectID,
		"extra_sys_prompts": cs.ExtraSysPrompts,
		"llm_no":            state.ControllerLLMNo,
		"reasoning_effort":  cs.Settings.ReasoningEffort,
		"ga_root":           s.CfgStore.Snapshot().GARoot,
	}
	applyProjectRequestFields(cmdReq, cs, s.CfgStore.Snapshot())
	var decision chatLoopDecision
	var parseErr error
	for attempt := 0; attempt < chatLoopControllerAttempts; attempt++ {
		if attempt == 0 {
			cmdReq["prompt"] = chatLoopControllerPrompt(state.ControllerPrompt, state.Round)
		} else {
			cmdReq["prompt"] = chatLoopControllerRetryPrompt(state.ControllerPrompt, state.Round)
		}
		msg, err := s.runChatLoopController(sid, epoch, cmdReq)
		if err != nil {
			s.finishChatLoop(sid, epoch, chatLoopStatusError, "controller_error: "+err.Error())
			return
		}
		decision, parseErr = parseChatLoopDecision(msg.Content)
		if parseErr == nil {
			break
		}
		if attempt+1 < chatLoopControllerAttempts && !s.recordChatLoopRetry(sid, epoch) {
			return
		}
	}
	if parseErr != nil {
		s.finishChatLoop(sid, epoch, chatLoopStatusError, "controller_protocol_error: "+parseErr.Error())
		return
	}
	if decision.Complete {
		reason := "controller_complete"
		if decision.NoAction {
			reason = "controller_no_action"
		}
		s.finishChatLoop(sid, epoch, chatLoopStatusCompleted, reason)
		return
	}
	s.continueChatLoop(sid, epoch, decision.Prompt)
}

// recordChatLoopRetry reports whether the loop is still live and owned by this
// evaluation, so a stopped loop never spends a second controller call. The
// record itself is advisory: failing to persist it must not strand the loop.
func (s *Server) recordChatLoopRetry(sid string, epoch int64) bool {
	s.SessionMu.Lock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil || !cs.Loop.Enabled || cs.Loop.Epoch != epoch || cs.Loop.Status != chatLoopStatusEvaluating {
		s.SessionMu.Unlock()
		return false
	}
	appendChatLoopRecord(&cs.Loop, "retry", "Controller reply was unusable; asking once more.", "")
	saved := saveChatSessionLocked(s.CfgStore.Snapshot(), cs) == nil
	s.SessionMu.Unlock()
	if saved {
		s.publishChatLoopState(sid, cs.Loop)
	}
	return true
}

func (s *Server) finishChatLoop(sid string, epoch int64, status, reason string) {
	s.SessionMu.Lock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil || !cs.Loop.Enabled || cs.Loop.Epoch != epoch {
		s.SessionMu.Unlock()
		return
	}
	cs.Loop.Enabled = false
	cs.Loop.Status = status
	cs.Loop.StopReason = reason
	appendChatLoopTerminalRecord(&cs.Loop, status, reason)
	cs.Loop.Epoch++
	err = saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
	s.SessionMu.Unlock()
	if err == nil {
		s.publishChatLoopState(sid, cs.Loop)
	}
}

var continueChatLoopFunc = func(s *Server, sid string, epoch int64, prompt string) {
	s.continueChatLoop(sid, epoch, prompt)
}

func (s *Server) continueChatLoop(sid string, epoch int64, prompt string) {
	token := s.beginChatRun(sid)
	if token == nil {
		s.deferChatLoopForActiveRun(sid, epoch)
		return
	}

	runStartedAtMS := time.Now().UnixMilli()
	userMsg := chatMessage{ID: newChatID(), Role: "user", Content: prompt, CreatedAt: time.Now().Unix()}
	pendingMsg := chatMessage{ID: newChatID(), Role: "assistant", CreatedAt: time.Now().Unix(), RunStartedAtMS: runStartedAtMS}
	var cs chatSession
	var terminalLoop *chatLoopState
	owned, saveErr := s.saveChatRunPending(sid, token, pendingMsg.ID, runStartedAtMS, func() error {
		s.SessionMu.Lock()
		defer s.SessionMu.Unlock()
		latest, err := loadChatSession(s.CfgStore.Snapshot(), sid)
		if err != nil {
			return err
		}
		if !latest.Loop.Enabled || latest.Loop.Epoch != epoch || latest.Loop.Status != chatLoopStatusEvaluating {
			return errChatLoopStale
		}
		fingerprint := chatLoopPromptFingerprint(prompt)
		if fingerprint != "" && fingerprint == latest.Loop.LastPromptFingerprint {
			latest.Loop.RepeatStreak++
		} else {
			latest.Loop.RepeatStreak = 0
		}
		latest.Loop.LastPromptFingerprint = fingerprint
		if latest.Loop.RepeatStreak >= chatLoopMaxPromptRepeats {
			latest.Loop.Enabled = false
			latest.Loop.Status = chatLoopStatusStopped
			latest.Loop.StopReason = "controller_stalled"
			appendChatLoopRecord(&latest.Loop, "stalled", "Controller kept asking for the same next step.", "")
			latest.Loop.Epoch++
			if err := saveChatSessionLocked(s.CfgStore.Snapshot(), latest); err != nil {
				return err
			}
			finished := latest.Loop
			terminalLoop = &finished
			return errChatLoopStale
		}
		latest.Loop.Round++
		latest.Loop.Status = chatLoopStatusRunning
		latest.Loop.StopReason = ""
		appendChatLoopRecord(&latest.Loop, "continue", "Controller queued the next step.", prompt)
		latest.Messages = append(latest.Messages, userMsg, pendingMsg)
		latest.UpdatedAt = time.Now().Unix()
		updateChatTitle(&latest)
		if err := saveChatSessionLocked(s.CfgStore.Snapshot(), latest); err != nil {
			return err
		}
		cs = latest
		return nil
	})
	if !owned || saveErr != nil {
		s.endChatRunOwned(sid, token)
		if terminalLoop != nil {
			s.publishChatLoopState(sid, *terminalLoop)
		}
		if saveErr != nil && !errors.Is(saveErr, errChatLoopStale) {
			s.finishChatLoop(sid, epoch, chatLoopStatusError, "persist_error: "+saveErr.Error())
		}
		return
	}

	s.publishChatLoopState(sid, cs.Loop)
	s.publishChatRun(sid, map[string]interface{}{"type": "user", "message": userMsg})
	workerHistory := append([]chatMessage(nil), cs.Messages...)
	for i := len(workerHistory) - 1; i >= 0; i-- {
		if workerHistory[i].ID == userMsg.ID {
			workerHistory = workerHistory[:i]
			break
		}
	}
	cmdReq := map[string]interface{}{
		"prompt":                   prompt,
		"history":                  workerHistory,
		"raw_history":              cs.RawHistory,
		"history_info":             cs.HistoryInfo,
		"working":                  cs.Working,
		"workspace":                cs.Workspace,
		"project_mode":             cs.ProjectMode,
		"project_provider":         cs.ProjectProvider,
		"project_id":               cs.ProjectID,
		"extra_sys_prompts":        cs.ExtraSysPrompts,
		"llm_no":                   cs.Settings.LLMNo,
		"reasoning_effort":         cs.Settings.ReasoningEffort,
		"ga_root":                  s.CfgStore.Snapshot().GARoot,
		"_ga_pending_assistant_id": pendingMsg.ID,
		"_ga_run_started_at_ms":    runStartedAtMS,
	}
	applyProjectRequestFields(cmdReq, cs, s.CfgStore.Snapshot())
	go s.runChatWorkerOwned(sid, token, cs, cmdReq)
}

func (s *Server) deferChatLoopForActiveRun(sid string, epoch int64) {
	s.SessionMu.Lock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err == nil && cs.Loop.Enabled && cs.Loop.Epoch == epoch && cs.Loop.Status == chatLoopStatusEvaluating {
		cs.Loop.Status = chatLoopStatusRunning
		err = saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
	}
	s.SessionMu.Unlock()
	if err == nil {
		s.publishChatLoopState(sid, cs.Loop)
	}
}

func (s *Server) recoverChatLoopsAfterRestart() error {
	if s.ChatRuntime == nil {
		return nil
	}
	s.ChatRuntime.loopRecoveryOnce.Do(func() {
		cfg := s.CfgStore.Snapshot()
		if err := ensureChatDataMigrated(cfg); err != nil {
			s.ChatRuntime.loopRecoveryErr = err
			return
		}
		if err := os.MkdirAll(chatSessionDir(cfg), 0755); err != nil {
			s.ChatRuntime.loopRecoveryErr = err
			return
		}
		entries, err := os.ReadDir(chatSessionDir(cfg))
		if err != nil {
			s.ChatRuntime.loopRecoveryErr = err
			return
		}

		s.SessionMu.Lock()
		defer s.SessionMu.Unlock()
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			sid := strings.TrimSuffix(entry.Name(), ".json")
			cs, err := loadChatSession(cfg, sid)
			if err != nil {
				continue
			}
			next, changed := normalizePersistedChatLoop(cs.Loop)
			if !changed {
				continue
			}
			cs.Loop = next
			if err := saveChatSessionPreserveUpdatedAtLocked(cfg, cs); err != nil {
				s.ChatRuntime.loopRecoveryErr = err
				return
			}
		}
	})
	return s.ChatRuntime.loopRecoveryErr
}

func normalizePersistedChatLoop(state chatLoopState) (chatLoopState, bool) {
	if !state.Enabled {
		return state, false
	}
	state.Enabled = false
	state.Status = chatLoopStatusPaused
	state.StopReason = "server_restart"
	state.Epoch++
	return state, true
}

// convertChatUploadsToMaps converts []chatUpload to []map[string]interface{} for message files
func convertChatUploadsToMaps(uploads []chatUpload) []map[string]interface{} {
	if len(uploads) == 0 {
		return nil
	}
	result := make([]map[string]interface{}, len(uploads))
	for i, upload := range uploads {
		result[i] = map[string]interface{}{
			"id":      upload.ID,
			"name":    upload.Name,
			"type":    upload.Type,
			"size":    upload.Size,
			"dataURL": upload.DataURL,
		}
	}
	return result
}

// processNextQueuedMessage executes the first queued message for a session.
// It is called after a chat run completes successfully and there are queued messages.
func (s *Server) processNextQueuedMessage(sid string) bool {
	return s.processQueuedMessage(sid, "")
}

// processQueuedMessage reserves the session, removes the requested queue item,
// persists its pending assistant message, and starts the worker. An empty queueID
// selects the first item. Reserving before dequeueing prevents a competing run
// from causing an item to be removed and later reinserted in the wrong position.
func (s *Server) processQueuedMessage(sid, queueID string) bool {
	sid = safeChatID(sid)
	queueID = strings.TrimSpace(queueID)
	token := s.beginChatRun(sid)
	if token == nil {
		return false
	}

	s.SessionMu.Lock()
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil || len(cs.QueuedMessages) == 0 {
		s.SessionMu.Unlock()
		s.endChatRunOwned(sid, token)
		return false
	}
	queueIndex := 0
	if queueID != "" {
		queueIndex = -1
		for i := range cs.QueuedMessages {
			if cs.QueuedMessages[i].ID == queueID {
				queueIndex = i
				break
			}
		}
		if queueIndex < 0 {
			s.SessionMu.Unlock()
			s.endChatRunOwned(sid, token)
			return false
		}
	}
	conductorReq := map[string]interface{}{"extra_sys_prompts": cs.ExtraSysPrompts}
	if err := s.prepareConductorWorkerRequest(cs, conductorReq); err != nil {
		s.SessionMu.Unlock()
		s.endChatRunOwned(sid, token)
		return false
	}
	queuedItem := cs.QueuedMessages[queueIndex]
	s.SessionMu.Unlock()

	// Publish the queue identity before removing it from persisted state. Do not
	// take ChatMu while holding SessionMu: saveChatRunPending uses the opposite
	// lock order while atomically publishing the pending assistant identity.
	s.ChatMu.Lock()
	if current := s.ChatRuns[sid]; current != token || current.Done || current.Canceled {
		s.ChatMu.Unlock()
		s.endChatRunOwned(sid, token)
		return false
	}
	token.QueueID = queuedItem.ID
	s.ChatMu.Unlock()

	// Reload under SessionMu because queue replacement may have happened while
	// the lock was released to publish the token identity.
	s.SessionMu.Lock()
	cs, err = loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		s.SessionMu.Unlock()
		s.endChatRunOwned(sid, token)
		return false
	}
	queueIndex = -1
	for i := range cs.QueuedMessages {
		if cs.QueuedMessages[i].ID == queuedItem.ID {
			queueIndex = i
			queuedItem = cs.QueuedMessages[i]
			break
		}
	}
	if queueIndex < 0 {
		s.SessionMu.Unlock()
		s.endChatRunOwned(sid, token)
		return false
	}
	cs.QueuedMessages = append(cs.QueuedMessages[:queueIndex], cs.QueuedMessages[queueIndex+1:]...)
	cs.UpdatedAt = time.Now().Unix()

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
	// Internal completion evidence wakes the model, but is not a user turn.
	internalCompletion := queuedItem.Kind == "conductor_completion"
	workerHistory := append([]chatMessage(nil), cs.Messages...)
	if !internalCompletion {
		cs.Messages = append(cs.Messages, queuedUserMsg)
	}
	cs.Messages = append(cs.Messages, pendingMsg)
	if queuedItem.LLMNo > 0 {
		cs.Settings.LLMNo = queuedItem.LLMNo
	}
	if queuedItem.ReasoningEffort != "" {
		cs.Settings.ReasoningEffort = queuedItem.ReasoningEffort
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
		"project_provider":         cs.ProjectProvider,
		"project_id":               cs.ProjectID,
		"extra_sys_prompts":        cs.ExtraSysPrompts,
		"llm_no":                   cs.Settings.LLMNo,
		"reasoning_effort":         cs.Settings.ReasoningEffort,
		"ga_root":                  s.CfgStore.Snapshot().GARoot,
		"_ga_pending_assistant_id": pendingID,
		"_ga_run_started_at_ms":    runStartedAtMS,
	}

	if internalCompletion {
		cmdReq["input_kind"] = "conductor_completion"
	}

	for key, value := range conductorReq {
		cmdReq[key] = value
	}
	applyProjectRequestFields(cmdReq, cs, s.CfgStore.Snapshot())

	// Publish the pending assistant identity together with the persisted session.
	// Reattaching clients use these fields to bind live deltas to the placeholder;
	// without them a guided queue run only appears after the final session reload.
	s.SessionMu.Unlock()
	owned, saveErr := s.saveChatRunPending(sid, token, pendingID, runStartedAtMS, func() error {
		s.SessionMu.Lock()
		defer s.SessionMu.Unlock()
		return saveChatSessionLocked(s.CfgStore.Snapshot(), cs)
	})
	if !owned || saveErr != nil {
		s.endChatRunOwned(sid, token)
		return false
	}
	s.publishChatQueueChanged(sid)

	// Automatic queue consumption bypasses the frontend's optimistic guide path.
	// Publish the persisted user turn on the run stream so attached clients render
	// it immediately; replay and the frontend's message-id dedupe make reconnects safe.
	if !internalCompletion {
		s.publishChatRun(sid, map[string]interface{}{"type": "user", "message": queuedUserMsg})
	}

	s.ChatMu.Lock()
	if current := s.ChatRuns[sid]; current == token {
		current.PendingAssistantID = pendingID
		current.RunStartedAtMS = runStartedAtMS
	}
	s.ChatMu.Unlock()

	s.publishChatRun(sid, map[string]interface{}{
		"type":            "queue_item_start",
		"queue_item_id":   queuedItem.ID,
		"remaining_count": len(cs.QueuedMessages),
	})
	go s.runChatWorkerOwned(sid, token, cs, cmdReq)
	return true
}
