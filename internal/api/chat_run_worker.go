package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"
)

func (s *Server) runChatWorker(sid string, cs chatSession, cmdReq map[string]interface{}) {
	s.runChatWorkerOwned(sid, nil, cs, cmdReq)
}

func (s *Server) runChatWorkerOwned(sid string, token *chatRun, cs chatSession, cmdReq map[string]interface{}) {
	worldlineResend, _ := cmdReq["_ga_worldline_resend"].(bool)
	delete(cmdReq, "_ga_worldline_resend")
	pendingID, _ := cmdReq["_ga_pending_assistant_id"].(string)
	delete(cmdReq, "_ga_pending_assistant_id")
	startedAtMS, _ := cmdReq["_ga_run_started_at_ms"].(int64)
	delete(cmdReq, "_ga_run_started_at_ms")
	saveProgress := func(session chatSession) error {
		if worldlineResend {
			return s.saveChatSessionExact(session)
		}
		return s.saveChatSessionMerged(session)
	}
	saveTerminal := func(session chatSession) error {
		err := saveProgress(session)
		if err == nil {
			s.syncConductorTerminal(session)
		}
		return err
	}
	startedAt := time.UnixMilli(startedAtMS)
	if startedAtMS <= 0 {
		startedAt = time.Now()
		startedAtMS = startedAt.UnixMilli()
	}
	elapsedMillis := func() int64 {
		ms := time.Since(startedAt).Milliseconds()
		if ms < 1 {
			return 1
		}
		return ms
	}
	worker, err := s.getChatWorker(sid)
	if err != nil {
		msg := chatMessage{ID: pendingID, Role: "assistant", Content: fmt.Sprintf("提交失败：%v", err), CreatedAt: time.Now().Unix(), Error: true, ElapsedMS: elapsedMillis()}
		cs.Messages = replacePendingChatMessage(cs.Messages, pendingID, msg)
		_ = saveTerminal(cs)
		s.publishChatRun(sid, map[string]interface{}{"type": "error", "message": msg})
		s.endChatRunOwned(sid, token)
		return
	}
	defer s.releaseChatWorker(sid, worker)
	s.setChatRunCmd(sid, worker.Cmd)
	if token != nil && !s.ownsChatRun(sid, token) {
		s.dropChatWorker(sid, worker)
		s.endChatRunOwned(sid, token)
		return
	}
	worker.Mu.Lock()
	defer worker.Mu.Unlock()
	if token != nil && !s.ownsChatRun(sid, token) {
		s.endChatRunOwned(sid, token)
		return
	}
	if err := json.NewEncoder(worker.Stdin).Encode(cmdReq); err != nil {
		s.dropChatWorker(sid, worker)
		msg := chatMessage{ID: pendingID, Role: "assistant", Content: fmt.Sprintf("提交失败：%v", err), CreatedAt: time.Now().Unix(), Error: true, ElapsedMS: elapsedMillis()}
		cs.Messages = replacePendingChatMessage(cs.Messages, pendingID, msg)
		_ = saveTerminal(cs)
		s.publishChatRun(sid, map[string]interface{}{"type": "error", "message": msg})
		s.endChatRunOwned(sid, token)
		return
	}
	reader := bufio.NewReaderSize(worker.Stdout, 64*1024)
	// Publish start event so frontend can base its live timer on backend clock
	if startLine, err := json.Marshal(map[string]interface{}{
		"type":              "start",
		"run_started_at_ms": startedAt.UnixMilli(),
	}); err == nil {
		s.publishChatLine(sid, startLine)
	}
	var final chatMessage
	var finalRawHistory []map[string]interface{}
	var finalHistoryInfo []interface{}
	var finalWorking map[string]interface{}
	var rawHistorySeen, historyInfoSeen, workingSeen bool
	var finalUltraPlanState map[string]interface{}
	var finalGoalState map[string]interface{}
	var finalReasoningEffort string
	var finalModelID string
	var taskOutputsAccumulator = make(map[string][]string)
	var terminalLine []byte
	var readErr error
	var firstTokenMS int64
	for {
		line, err := readChatWorkerLine(reader)
		if len(bytes.TrimSpace(line)) == 0 {
			if err != nil {
				readErr = err
				break
			}
			continue
		}
		line = bytes.TrimSpace(line)
		var ev map[string]interface{}
		if json.Unmarshal(line, &ev) != nil {
			if err != nil {
				readErr = err
				break
			}
			continue
		}
		if ev["type"] == "conductor_defaults" || ev["type"] == "conductor_models" || ev["type"] == "conductor_model_strategy" || ev["type"] == "conductor_limits" {
			s.handleConductorSettingsEvent(sid, ev)
			continue
		}
		if ev["type"] == "conductor_instruct" || ev["type"] == "conductor_instruction_check" || ev["type"] == "conductor_instruction_ack" {
			s.handleConductorInstructionEvent(sid, ev)
			continue
		}
		if ev["type"] == "conductor_dispatch" {
			s.handleConductorDispatchEvent(sid, ev)
			continue
		}
		if ev["type"] == "conductor_resolve" {
			s.handleConductorResolveEvent(sid, ev)
			continue
		}
		if ev["type"] == "conductor_review" {
			s.handleConductorReviewEvent(sid, ev)
			continue
		}
		if ev["type"] == "conductor_cancel" {
			s.handleConductorCancelEvent(sid, ev)
			continue
		}
		if ev["type"] == "conductor_read" {
			if readErr := s.confirmConductorRead(sid, ev); readErr != nil {
				s.publishChatRun(sid, map[string]interface{}{"type": "warning", "message": "Conductor read receipt persistence failed: " + readErr.Error()})
			}
			continue
		}
		if ev["type"] == "conductor_inspect" {
			s.handleConductorInspectEvent(sid, ev)
			continue
		}
		if ev["type"] == "conductor_collect" {
			s.handleConductorCollectEvent(sid, ev)
			continue
		}
		if ev["type"] == "model" {
			if modelID, ok := ev["model_id"].(string); ok {
				finalModelID = strings.TrimSpace(modelID)
			}
		}
		if ev["type"] == "ultraplan_event" {
			if state := chatUltraPlanStateFromEvent(ev); state != nil {
				finalUltraPlanState = mergeChatMaps(finalUltraPlanState, state)
			}
		}
		if ev["type"] == "goal_event" {
			if state := chatGoalStateFromEvent(ev); state != nil {
				finalGoalState = mergeChatMaps(finalGoalState, state)
			}
		}
		if ev["type"] == "ultraplan_output" {
			if taskID, ok := ev["task_id"].(string); ok {
				if lines, ok := ev["lines"].([]interface{}); ok {
					for _, line := range lines {
						if lineStr, ok := line.(string); ok {
							taskOutputsAccumulator[taskID] = append(taskOutputsAccumulator[taskID], lineStr)
						}
					}
				}
			}
		}
		structuredChanged := false
		if _, ok := ev["raw_history"]; ok {
			rawHistorySeen = true
			finalRawHistory = chatRawHistoryFromEvent(ev)
			cs.RawHistory = finalRawHistory
			structuredChanged = true
		}
		if _, ok := ev["history_info"]; ok {
			historyInfoSeen = true
			finalHistoryInfo = chatHistoryInfoFromEvent(ev)
			cs.HistoryInfo = finalHistoryInfo
			structuredChanged = true
		}
		if _, ok := ev["working"]; ok {
			workingSeen = true
			finalWorking = chatWorkingFromEvent(ev)
			cs.Working = finalWorking
			structuredChanged = true
		}
		if _, ok := ev["plan"]; ok {
			var planChanged bool
			cs.Plan, planChanged = updateChatPlanFromEvent(cs.Plan, ev)
			// Always echo the retained snapshot so a plan-less follow-up turn does
			// not make the already visible card disappear in streaming clients.
			ev["plan"] = cloneChatValue(cs.Plan)
			structuredChanged = structuredChanged || planChanged
		}
		isTerminalEvent := ev["type"] == "done" || ev["type"] == "error"
		if structuredChanged && !isTerminalEvent && (token == nil || s.ownsChatRun(sid, token)) {
			_ = saveProgress(cs)
		}
		if msg, ok := ev["message"].(map[string]interface{}); ok && (ev["type"] == "done" || ev["type"] == "error") {
			b, _ := json.Marshal(msg)
			_ = json.Unmarshal(b, &final)
			if pendingID != "" {
				final.ID = pendingID
			}
			final.ModelID = strings.TrimSpace(final.ModelID)
			if final.ModelID != "" {
				finalModelID = final.ModelID
			} else if finalModelID != "" {
				final.ModelID = finalModelID
				msg["model_id"] = finalModelID
			}
			if final.ElapsedMS <= 0 {
				final.ElapsedMS = elapsedMillis()
			}
			msg["elapsed_ms"] = final.ElapsedMS
			if firstTokenMS > 0 {
				final.FirstTokenMS = firstTokenMS
				msg["first_token_ms"] = firstTokenMS
			}
			ev["message"] = msg
			final.Usage, final.Usages = chatUsageFromEvent(ev)
			final.CtxChars, final.CtxMsgs = chatCtxStatsFromEvent(ev)
			if final.CtxChars > 0 {
				msg["ctx_chars"] = final.CtxChars
			}
			if final.CtxMsgs > 0 {
				msg["ctx_msgs"] = final.CtxMsgs
			}
			if finalUltraPlanState != nil {
				final.UltraPlanState = mergeChatMaps(mergeChatMaps(nil, finalUltraPlanState), final.UltraPlanState)
			}
			if len(taskOutputsAccumulator) > 0 {
				if final.UltraPlanState == nil {
					final.UltraPlanState = make(map[string]interface{})
				}
				final.UltraPlanState["task_outputs"] = taskOutputsAccumulator
				final.TaskOutputs = taskOutputsAccumulator
				msg["task_outputs"] = taskOutputsAccumulator
			}
			if final.UltraPlanState != nil {
				msg["ultraplan_state"] = final.UltraPlanState
			}
			if finalGoalState != nil {
				final.GoalState = mergeChatMaps(mergeChatMaps(nil, finalGoalState), final.GoalState)
			}
			if final.GoalState != nil {
				msg["goal_state"] = final.GoalState
			}
			if v, ok := ev["llm_elapsed_ms"].(float64); ok && v > 0 {
				final.LLMElapsedMS = int64(v)
				msg["llm_elapsed_ms"] = final.LLMElapsedMS
			}
			if v, ok := ev["tool_elapsed_ms"].(float64); ok && v > 0 {
				final.ToolElapsedMS = int64(v)
				msg["tool_elapsed_ms"] = final.ToolElapsedMS
			}
			if v, ok := ev["reasoning_effort"].(string); ok {
				finalReasoningEffort = v
			}
			delete(ev, "raw_history")
			delete(ev, "history_info")
			delete(ev, "working")
			if cleanLine, err := json.Marshal(ev); err == nil {
				terminalLine = cleanLine
			} else {
				terminalLine = append([]byte(nil), line...)
			}
			break
		}
		if ev["type"] == "model_first_token" {
			if firstTokenMS == 0 {
				firstTokenMS = elapsedMillis()
			}
			if err != nil {
				readErr = err
				break
			}
			continue
		}
		s.publishChatLine(sid, line)
		if err != nil {
			readErr = err
			break
		}
	}
	if final.ID == "" {
		partial := s.chatRunPartialContent(sid)
		if s.chatRunCanceled(sid) {
			content := strings.TrimSpace(partial)
			if content != "" {
				content += "\n\n[用户手动中止生成]"
			} else {
				content = "已停止生成"
			}
			final = chatMessage{ID: pendingID, Role: "assistant", Content: content, ModelID: finalModelID, CreatedAt: time.Now().Unix(), Error: true, ElapsedMS: elapsedMillis(), UltraPlanState: mergeChatMaps(nil, finalUltraPlanState), GoalState: mergeChatMaps(nil, finalGoalState)}
			s.publishChatRun(sid, map[string]interface{}{"type": "error", "message": final})
		} else {
			err := readErr
			if err == nil || err == io.EOF {
				err = fmt.Errorf("worker exited before done")
			}
			s.dropChatWorker(sid, worker)
			content := strings.TrimSpace(partial)
			if content != "" {
				content += fmt.Sprintf("\n\n[生成中断：%v]", err)
			} else {
				content = fmt.Sprintf("生成失败：%v", err)
			}
			final = chatMessage{ID: pendingID, Role: "assistant", Content: content, ModelID: finalModelID, CreatedAt: time.Now().Unix(), Error: true, ElapsedMS: elapsedMillis(), UltraPlanState: mergeChatMaps(nil, finalUltraPlanState), GoalState: mergeChatMaps(nil, finalGoalState)}
			s.publishChatRun(sid, map[string]interface{}{"type": "error", "message": final})
		}
	}
	var fallbackMessages []chatMessage
	for i := len(cs.Messages) - 1; i >= 0; i-- {
		if cs.Messages[i].Role == "user" {
			fallbackMessages = append(fallbackMessages, cs.Messages[i])
			break
		}
	}
	fallbackMessages = append(fallbackMessages, final)
	cs.Messages = replacePendingChatMessage(cs.Messages, pendingID, final)
	if !final.Error && s.ownsChatRun(sid, token) && len(cs.Messages) >= 2 {
		userMsg := cs.Messages[len(cs.Messages)-2]
		if userMsg.Role == "user" {
			bound, bindErr := s.chatWorldlineRPCLocked(sid, worker, cs.Workspace, map[string]interface{}{
				"action":               "bind",
				"turn_status":          "completed",
				"has_final_answer":     true,
				"user_message_id":      userMsg.ID,
				"assistant_message_id": final.ID,
				"display_path":         cs.Messages,
			})
			if bindErr != nil {
				final.Error = true
				final.Content = strings.TrimSpace(final.Content) + fmt.Sprintf("\n\n[Worldline bind failed: %v]", bindErr)
				cs.Messages[len(cs.Messages)-1] = final
				terminalLine, _ = json.Marshal(map[string]interface{}{"type": "error", "message": final})
			} else if bound.Tree.Head != nil && s.ownsChatRun(sid, token) {
				cs.WorldlineHead = *bound.Tree.Head
			}
		}
	}
	if rawHistorySeen {
		cs.RawHistory = finalRawHistory
	} else {
		cs.RawHistory = appendChatRawHistoryFallback(cs.RawHistory, fallbackMessages...)
	}
	if historyInfoSeen {
		cs.HistoryInfo = finalHistoryInfo
	}
	if workingSeen {
		cs.Working = finalWorking
	}
	if strings.TrimSpace(finalReasoningEffort) != "" {
		cs.Settings.ReasoningEffort = normalizeChatSettings(chatSettings{ReasoningEffort: finalReasoningEffort}).ReasoningEffort
	}
	cs.UpdatedAt = time.Now().Unix()
	if token != nil && !s.ownsChatRun(sid, token) {
		s.endChatRunOwned(sid, token)
		return
	}
	if saveErr := saveTerminal(cs); saveErr != nil {
		commitFailure := chatMessage{
			ID:        newChatID(),
			Role:      "assistant",
			Content:   fmt.Sprintf("Failed to persist terminal chat state: %v", saveErr),
			CreatedAt: time.Now().Unix(),
			Error:     true,
		}
		s.publishChatRun(sid, map[string]interface{}{"type": "error", "message": commitFailure})
		s.endChatRunOwned(sid, token)
		return
	}
	if usageErr := s.recordSessionUsage(cs); usageErr != nil {
		s.publishChatRun(sid, map[string]interface{}{"type": "usage_error", "error": usageErr.Error()})
	}
	if len(terminalLine) > 0 {
		s.publishChatLine(sid, terminalLine)
	}
	if !final.Error {
		s.scheduleChatTitleGeneration(sid, cs)
	}
	s.endChatRunOwned(sid, token)
	s.afterChatRunTerminal(sid, !final.Error)
}
