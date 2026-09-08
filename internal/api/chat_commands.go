package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type immediateChatCommand struct {
	Name, Mode, Arg string
	RestoreMode, To string
	Count           int
	Names           []string
}

func parseImmediateChatCommand(prompt string) (immediateChatCommand, bool, error) {
	text := strings.TrimSpace(prompt)
	if text == "" || text[0] != '/' {
		return immediateChatCommand{}, false, nil
	}
	fields := strings.Fields(text)
	name := strings.ToLower(fields[0])
	known := map[string]bool{"/scheduler": true, "/rewind": true, "/clear": true, "/export": true, "/help": true, "/status": true, "/verbose": true, "/resume": true, "/worldline": true}
	if !known[name] {
		return immediateChatCommand{}, false, nil
	}
	c := immediateChatCommand{Name: name, Count: 1}
	switch name {
	case "/scheduler":
		if len(fields) == 1 {
			c.Mode = "list"
			return c, true, nil
		}
		c.Mode = strings.ToLower(fields[1])
		if c.Mode == "run" {
			c.Mode = "start"
		}
		if c.Mode != "list" && c.Mode != "start" {
			return c, true, fmt.Errorf("usage: /scheduler [list|start <service...>]")
		}
		if c.Mode == "list" && len(fields) != 2 {
			return c, true, fmt.Errorf("scheduler list accepts no service names")
		}
		if c.Mode == "start" {
			if len(fields) < 3 {
				return c, true, fmt.Errorf("scheduler start requires at least one service name")
			}
			c.Names = append([]string(nil), fields[2:]...)
		}
	case "/rewind":
		if len(fields) > 2 {
			return c, true, fmt.Errorf("usage: /rewind [n]")
		}
		if len(fields) == 2 {
			n, e := strconv.Atoi(fields[1])
			if e != nil || n < 1 {
				return c, true, fmt.Errorf("rewind count must be a positive integer")
			}
			c.Count = n
		}
	case "/worldline":
		c.Mode = "list"
		if len(fields) > 1 {
			if strings.ToLower(fields[1]) != "restore" || len(fields) < 3 || len(fields) > 5 {
				return c, true, fmt.Errorf("usage: /worldline [restore <node> [both|conversation|code] [at|before]]")
			}
			c.Mode, c.Arg, c.RestoreMode, c.To = "restore", fields[2], "both", "at"
			if len(fields) >= 4 {
				c.RestoreMode = strings.ToLower(fields[3])
			}
			if len(fields) == 5 {
				c.To = strings.ToLower(fields[4])
			}
			if c.RestoreMode != "both" && c.RestoreMode != "conversation" && c.RestoreMode != "code" {
				return c, true, fmt.Errorf("worldline restore mode must be both, conversation, or code")
			}
			if c.To != "at" && c.To != "before" {
				return c, true, fmt.Errorf("worldline restore target must be at or before")
			}
		}
	case "/clear", "/help", "/status", "/verbose":
		if len(fields) != 1 {
			return c, true, fmt.Errorf("%s accepts no arguments", name)
		}
	case "/resume":
		return c, false, nil
	case "/export":
		c.Mode = "last"
		if len(fields) > 3 {
			return c, true, fmt.Errorf("usage: /export [last|all] [name]")
		}
		if len(fields) >= 2 {
			c.Mode = strings.ToLower(fields[1])
			if c.Mode != "last" && c.Mode != "all" {
				return c, true, fmt.Errorf("export mode must be last or all")
			}
		}
		if len(fields) == 3 {
			c.Arg = fields[2]
		}
	}
	return c, true, nil
}

func commandNeedsDanger(c immediateChatCommand) bool {
	return c.Name == "/rewind" || c.Name == "/clear" || (c.Name == "/worldline" && c.Mode == "restore") || (c.Name == "/scheduler" && c.Mode == "start")
}

func (s *Server) maybeHandleImmediateChatCommand(w http.ResponseWriter, r *http.Request, sid string, token *chatRun, c immediateChatCommand) bool {
	if !s.ownsChatRun(sid, token) {
		s.streamChatRun(w, r, sid, 0)
		return true
	}
	result := map[string]interface{}{"command": strings.TrimPrefix(c.Name, "/")}
	var cs chatSession
	var err error
	switch c.Name {
	case "/rewind":
		cs, err = s.mutateChatSession(sid, token, func(x *chatSession) error { return rewindSession(x, c.Count, result) })
	case "/clear":
		cs, err = s.mutateChatSession(sid, token, func(x *chatSession) error {
			x.Messages = []chatMessage{}
			x.RawHistory = []map[string]interface{}{}
			x.HistoryInfo = []interface{}{}
			x.Working = nil
			return nil
		})
	default:
		s.SessionMu.Lock()
		cs, err = loadChatSession(s.CfgStore.Snapshot(), sid)
		s.SessionMu.Unlock()
	}
	if err == nil {
		switch c.Name {
		case "/scheduler":
			err = s.schedulerCommand(c, result)
		case "/export":
			err = exportCommand(cs, c, result)
		case "/help":
			result["commands"] = immediateCommandCatalog()
		case "/status":
			result["session"] = map[string]interface{}{"id": cs.ID, "title": cs.Title, "active": false, "message_count": len(cs.Messages), "updated_at": cs.UpdatedAt, "settings": cs.Settings, "workspace": cs.Workspace, "project_mode": cs.ProjectMode, "project_provider": cs.ProjectProvider, "project_id": cs.ProjectID}
			result["services"] = safeServiceSummary(s)
		case "/verbose":
			result["records"] = verboseRecords(cs.RawHistory)
		case "/worldline":
			err = s.worldlineCommand(&cs, c, result)
		case "/clear":
			result["cleared"] = true
			result["session"] = cs
		case "/rewind":
			result["session"] = cs
		}
	}
	if !s.ownsChatRun(sid, token) {
		s.streamChatRun(w, r, sid, 0)
		return true
	}
	if err == nil && c.Name != "/clear" && c.Name != "/rewind" {
		if c.Name == "/worldline" && c.Mode == "restore" {
			err = s.saveChatSessionExact(cs)
		} else {
			err = s.persistChatSessionIfMissing(cs)
		}
	}
	if !s.ownsChatRun(sid, token) {
		s.streamChatRun(w, r, sid, 0)
		return true
	}
	if err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return true
	}
	s.publishChatRun(sid, map[string]interface{}{"type": "command_result", "result": result})
	s.endChatRunOwned(sid, token)
	s.streamChatRun(w, r, sid, 0)
	return true
}

func rewindSession(cs *chatSession, n int, out map[string]interface{}) error {
	idx := -1
	seen := 0
	for i := len(cs.Messages) - 1; i >= 0; i-- {
		if cs.Messages[i].Role == "user" {
			seen++
			if seen == n {
				idx = i
				break
			}
		}
	}
	if idx < 0 {
		return fmt.Errorf("rewind target is out of range")
	}
	prefill := cs.Messages[idx].Content
	removed := len(cs.Messages) - idx
	cs.Messages = append([]chatMessage(nil), cs.Messages[:idx]...)
	rawIdx := -1
	seen = 0
	for i := len(cs.RawHistory) - 1; i >= 0; i-- {
		if strings.EqualFold(fmt.Sprint(cs.RawHistory[i]["role"]), "user") {
			seen++
			if seen == n {
				rawIdx = i
				break
			}
		}
	}
	rawRemoved := 0
	if rawIdx >= 0 {
		rawRemoved = len(cs.RawHistory) - rawIdx
		cs.RawHistory = append([]map[string]interface{}(nil), cs.RawHistory[:rawIdx]...)
	} else {
		cs.RawHistory = []map[string]interface{}{}
	}
	cs.HistoryInfo = []interface{}{}
	cs.Working = nil
	out["prefill"] = prefill
	out["removed_messages"] = removed
	out["removed_raw_records"] = rawRemoved
	return nil
}

func exportCommand(cs chatSession, c immediateChatCommand, out map[string]interface{}) error {
	msgs := cs.Messages
	if c.Mode == "last" {
		idx := -1
		for i := len(msgs) - 1; i >= 0; i-- {
			if msgs[i].Role == "user" {
				idx = i
				break
			}
		}
		if idx >= 0 {
			msgs = msgs[idx:]
		} else {
			msgs = nil
		}
	}
	if len(msgs) == 0 {
		return fmt.Errorf("nothing to export")
	}
	var b strings.Builder
	for _, m := range msgs {
		fmt.Fprintf(&b, "## %s\n\n%s\n\n", strings.Title(m.Role), m.Content)
	}
	base := c.Arg
	if base == "" {
		base = "ga-chat"
	}
	if strings.ContainsAny(base, "/\\") || base == "." || base == ".." {
		return fmt.Errorf("export filename must be a basename")
	}
	base = regexp.MustCompile(`[^A-Za-z0-9._-]+`).ReplaceAllString(base, "-")
	base = strings.Trim(base, ".-")
	if base == "" {
		return fmt.Errorf("invalid export filename")
	}
	if filepath.Ext(base) == "" {
		base += ".txt"
	}
	out["content"] = b.String()
	out["mime_type"] = "text/plain; charset=utf-8"
	out["filename"] = base
	out["mode"] = c.Mode
	return nil
}

func (s *Server) schedulerCommand(c immediateChatCommand, out map[string]interface{}) error {
	if c.Mode == "list" {
		out["services"] = safeServiceSummary(s)
		return nil
	}
	results := []interface{}{}
	for _, name := range c.Names {
		if _, ok := s.Svc.Find(name); !ok {
			return fmt.Errorf("service not found: %s", name)
		}
	}
	for _, name := range c.Names {
		svc, e := s.startServiceByName(name, nil)
		if e != nil {
			return e
		}
		results = append(results, svc)
	}
	out["services"] = results
	return nil
}
func safeServiceSummary(s *Server) []map[string]interface{} {
	out := []map[string]interface{}{}
	for _, v := range s.Svc.Discover() {
		out = append(out, map[string]interface{}{"name": v.Name, "kind": v.Kind, "running": v.Running, "pid": v.PID})
	}
	return out
}
func immediateCommandCatalog() []map[string]interface{} {
	rows := []map[string]interface{}{}
	for _, x := range []struct {
		s, d   string
		danger bool
	}{{"/scheduler [list|start <service...>]", "List/start configured services", true}, {"/rewind [n]", "Rewind user turns", true}, {"/clear", "Clear session", true}, {"/export [last|all] [name]", "Export transcript", false}, {"/help", "Show commands", false}, {"/status", "Show status", false}, {"/verbose", "Show tool audit", false}, {"/resume", "Resume through GA", false}, {"/btw <question>", "Ask without interrupting", false}} {
		rows = append(rows, map[string]interface{}{"syntax": x.s, "description": x.d, "category": "admin", "dangerous": x.danger})
	}
	return rows
}
func verboseRecords(raw []map[string]interface{}) []map[string]interface{} {
	out := []map[string]interface{}{}
	for i, v := range raw {
		b, _ := json.Marshal(v)
		var safe map[string]interface{}
		_ = json.Unmarshal([]byte(redactCommandSecrets(string(b))), &safe)
		role := fmt.Sprint(v["role"])
		if role == "tool" || v["tool"] != nil || v["tool_call_id"] != nil {
			out = append(out, map[string]interface{}{"index": i, "tool": safe["tool"], "call_id": safe["tool_call_id"], "arguments": safe["arguments"], "result": safe["content"], "raw": safe})
		}
	}
	return out
}
func redactCommandSecrets(v string) string {
	re := regexp.MustCompile(`(?i)(api[_-]?key|token|password|secret)([\\"' :=]+)([^\\"' ,}]+)`)
	return re.ReplaceAllString(v, "$1$2[REDACTED]")
}

func (s *Server) worldlineCommand(cs *chatSession, c immediateChatCommand, out map[string]interface{}) error {
	worker, err := s.getChatWorker(cs.ID)
	if err != nil {
		return fmt.Errorf("worldline worker: %w", err)
	}
	req := map[string]interface{}{"op": "worldline", "activate": true, "action": c.Mode, "sid": safeChatID(cs.ID), "ga_root": s.CfgStore.Snapshot().GARoot, "workspace": cs.Workspace}
	if c.Mode == "restore" {
		req["node_id"], req["mode"], req["to"] = c.Arg, c.RestoreMode, c.To
	}
	worker.Mu.Lock()
	defer worker.Mu.Unlock()
	if err := json.NewEncoder(worker.Stdin).Encode(req); err != nil {
		s.dropChatWorker(cs.ID, worker)
		return err
	}
	reader := bufio.NewReaderSize(worker.Stdout, 64*1024)
	for {
		line, readErr := readChatWorkerLine(reader)
		if len(bytes.TrimSpace(line)) > 0 {
			var ev map[string]interface{}
			if json.Unmarshal(bytes.TrimSpace(line), &ev) == nil {
				switch ev["type"] {
				case "worldline":
					out["action"], out["tree"], out["restore_result"] = ev["action"], ev["tree"], ev["result"]
					if c.Mode == "restore" {
						if raw, ok := ev["raw_history"].([]interface{}); ok {
							cs.RawHistory = interfaceSliceToMaps(raw)
							cs.Messages = visibleMessagesFromRaw(cs.RawHistory)
						}
						if hi, ok := ev["history_info"].([]interface{}); ok {
							cs.HistoryInfo = hi
						}
						if working, ok := ev["working"].(map[string]interface{}); ok {
							cs.Working = working
						}
						out["session"] = cs
					}
					return nil
				case "error":
					if m, ok := ev["message"].(map[string]interface{}); ok {
						return fmt.Errorf("%v", m["content"])
					}
					return fmt.Errorf("worldline worker failed")
				}
			}
		}
		if readErr != nil {
			s.dropChatWorker(cs.ID, worker)
			return readErr
		}
	}
}

func interfaceSliceToMaps(items []interface{}) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		if m, ok := item.(map[string]interface{}); ok {
			out = append(out, m)
		}
	}
	return out
}

func visibleMessagesFromRaw(raw []map[string]interface{}) []chatMessage {
	out := []chatMessage{}
	for _, item := range raw {
		role := strings.ToLower(strings.TrimSpace(fmt.Sprint(item["role"])))
		if role != "user" && role != "assistant" {
			continue
		}
		text := rawChatText(item["content"])
		if strings.TrimSpace(text) == "" {
			continue
		}
		out = append(out, chatMessage{ID: newChatID(), Role: role, Content: text, CreatedAt: time.Now().Unix()})
	}
	return out
}

func rawChatText(v interface{}) string {
	if text, ok := v.(string); ok {
		return text
	}
	parts, ok := v.([]interface{})
	if !ok {
		return ""
	}
	var b strings.Builder
	for _, part := range parts {
		if m, ok := part.(map[string]interface{}); ok && (m["type"] == "text" || m["type"] == "output_text" || m["type"] == "input_text") {
			if t, ok := m["text"].(string); ok {
				if b.Len() > 0 {
					b.WriteByte('\n')
				}
				b.WriteString(t)
			}
		}
	}
	return b.String()
}
