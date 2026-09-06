package api

import (
	"encoding/json"
	"regexp"
	"strings"
)

var chatTaskbarAsk = regexp.MustCompile(`(?i)(^|[._-])ask_user$`)
var chatTaskbarWaiting = regexp.MustCompile(`(?i)waiting for (the )?user (input|reply|response)|waiting for your (answer|reply)|awaiting (user )?(input|reply|response)|等待用户|等待回复`)
var chatTaskbarTool = regexp.MustCompile("^🛠️ Tool: `([^`]+)`")

func chatTaskbarTextWaiting(content string) bool {
	if !strings.Contains(strings.ToLower(content), "ask_user") {
		return false
	}
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	type call struct{ name, result string }
	var calls []call
	var pending []int
	lastCall := -1
	for i := 0; i < len(lines); i++ {
		line := strings.TrimRight(lines[i], " \t")
		if strings.TrimSpace(line) == "" {
			continue
		}
		if match := chatTaskbarTool.FindStringSubmatch(line); match != nil {
			j := i + 1
			for j < len(lines) && strings.TrimSpace(lines[j]) == "" {
				j++
			}
			if j >= len(lines) || !strings.HasPrefix(lines[j], "```") {
				lastCall = -1
				continue
			}
			fence := len(lines[j]) - len(strings.TrimLeft(lines[j], "`"))
			j++
			for j < len(lines) && strings.TrimSpace(lines[j]) != strings.Repeat("`", fence) {
				j++
			}
			if j == len(lines) {
				return false
			}
			calls = append(calls, call{name: match[1]})
			lastCall = len(calls) - 1
			pending = append(pending, lastCall)
			i = j
			continue
		}
		if strings.HasPrefix(line, "`````") && strings.Trim(line, "`") == "" {
			j := i + 1
			for j < len(lines) && strings.TrimSpace(lines[j]) != line {
				j++
			}
			body := strings.Join(lines[i+1:j], "\n")
			if len(pending) > 0 {
				calls[pending[0]].result = body
				pending = pending[1:]
			} else {
				lastCall = -1
			}
			i = j
			continue
		}
		// Skip ordinary fenced examples so quoted tool protocols never become alerts.
		if strings.HasPrefix(line, "```") || strings.HasPrefix(line, "~~~") {
			fenceChar := line[:1]
			fence := strings.Repeat(fenceChar, len(line)-len(strings.TrimLeft(line, fenceChar)))
			for i++; i < len(lines) && strings.TrimSpace(lines[i]) != fence; i++ {
			}
		}
		lastCall = -1
		pending = nil
	}
	return lastCall >= 0 && chatTaskbarAsk.MatchString(calls[lastCall].name) &&
		(strings.TrimSpace(calls[lastCall].result) == "" || chatTaskbarWaiting.MatchString(calls[lastCall].result))
}

func chatTaskbarQuestion(m chatMessage) bool {
	if chatTaskbarTextWaiting(m.Content) {
		return true
	}
	last := -1
	for i, block := range m.StructuredContent {
		if block["type"] == "tool_use" {
			last = i
		}
	}
	if last < 0 {
		return false
	}
	call := m.StructuredContent[last]
	name, _ := call["name"].(string)
	if !chatTaskbarAsk.MatchString(name) {
		return false
	}
	var result map[string]interface{}
	for _, block := range m.StructuredContent[last+1:] {
		if text, _ := block["text"].(string); block["type"] == "text" && strings.TrimSpace(text) != "" {
			return false
		}
		if result == nil && block["type"] == "tool_result" && block["tool_use_id"] == call["id"] {
			result = block
		}
	}
	if result == nil {
		return true
	}
	value, _ := json.Marshal(result["content"])
	return chatTaskbarWaiting.Match(value)
}

func chatTaskbarStopped(text string) bool {
	return text == "Stopped." || text == "已中止。" || text == "已停止生成" || strings.HasSuffix(text, "[用户手动中止生成]")
}

func chatSessionTaskbarState(cs chatSession) string {
	for i := len(cs.Messages) - 1; i >= 0; i-- {
		m := cs.Messages[i]
		if m.Kind == "btw" || (m.Role != "assistant" && m.Role != "user") {
			continue
		}
		text := strings.TrimSpace(m.Content)
		if m.Role != "assistant" || chatTaskbarStopped(text) {
			return "idle"
		}
		if m.Error {
			return "failed"
		}
		if chatTaskbarQuestion(m) {
			return "waiting"
		}
		if text != "" || len(m.StructuredContent) > 0 || len(m.Files) > 0 {
			return "completed"
		}
		return "idle"
	}
	return "idle"
}

// The transcript is updated by the stream, but parsed at most once per list poll.
func (s *Server) chatSessionTaskbarSnapshot(summary chatSessionSummary) (bool, string) {
	s.ChatMu.Lock()
	defer s.ChatMu.Unlock()
	r := s.ChatRuns[safeChatID(summary.ID)]
	if r == nil || r.Done {
		return false, summary.TaskbarState
	}
	if r.Canceled {
		return true, "idle"
	}
	if r.TaskbarDirty {
		r.TaskbarWaiting = chatTaskbarTextWaiting(r.TaskbarText.String())
		r.TaskbarDirty = false
	}
	if r.TaskbarWaiting {
		return true, "waiting"
	}
	return true, "running"
}
