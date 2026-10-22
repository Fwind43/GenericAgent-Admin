package api

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode"
)

func chatRawHistoryFromEvent(ev map[string]interface{}) []map[string]interface{} {
	items, ok := ev["raw_history"].([]interface{})
	if !ok || len(items) == 0 {
		return nil
	}
	out := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		if m, ok := item.(map[string]interface{}); ok {
			out = append(out, m)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func chatHistoryInfoFromEvent(ev map[string]interface{}) []interface{} {
	items, ok := ev["history_info"].([]interface{})
	if !ok {
		return nil
	}
	return append([]interface{}(nil), items...)
}

func chatWorkingFromEvent(ev map[string]interface{}) map[string]interface{} {
	m, ok := ev["working"].(map[string]interface{})
	if !ok {
		return nil
	}
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

var chatPlanMarkerTimestampRE = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*`)

func cloneChatValue(v interface{}) interface{} {
	switch value := v.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(value))
		for k, child := range value {
			out[k] = cloneChatValue(child)
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(value))
		for i, child := range value {
			out[i] = cloneChatValue(child)
		}
		return out
	case []map[string]interface{}:
		out := make([]map[string]interface{}, len(value))
		for i, child := range value {
			out[i] = cloneChatValue(child).(map[string]interface{})
		}
		return out
	default:
		return value
	}
}

func normalizeChatPlan(plan map[string]interface{}) map[string]interface{} {
	if plan == nil {
		return nil
	}
	adapted := cloneChatValue(plan).(map[string]interface{})
	rawItems, ok := adapted["items"].([]interface{})
	if !ok {
		return adapted
	}

	items := make([]interface{}, 0, len(rawItems))
	done := 0
	for _, rawItem := range rawItems {
		item, ok := rawItem.(map[string]interface{})
		if !ok {
			items = append(items, rawItem)
			continue
		}
		content, ok := item["content"].(string)
		if ok {
			rest := content
			inlineTitles := make([]string, 0, 1)
			markerDone := false
			consumed := false
			for {
				trimmedLeft := strings.TrimLeftFunc(rest, unicode.IsSpace)
				if !strings.HasPrefix(trimmedLeft, "[") {
					break
				}
				end := strings.IndexByte(trimmedLeft, ']')
				if end < 0 {
					break
				}
				marker := strings.TrimSpace(trimmedLeft[1:end])
				runes := []rune(marker)
				known := marker == "" || strings.EqualFold(marker, "D") || strings.EqualFold(marker, "P")
				if !known && len(runes) > 0 && strings.ContainsRune("xX\u2713\u2714\u221a\u2611", runes[0]) {
					known = true
					markerDone = true
					inline := strings.TrimSpace(string(runes[1:]))
					inline = strings.TrimSpace(chatPlanMarkerTimestampRE.ReplaceAllString(inline, ""))
					if inline != "" {
						inlineTitles = append(inlineTitles, inline)
					}
				}
				if !known {
					break
				}
				consumed = true
				rest = strings.TrimLeftFunc(trimmedLeft[end+1:], unicode.IsSpace)
			}
			if consumed {
				parts := append(inlineTitles, strings.TrimSpace(rest))
				nonEmpty := parts[:0]
				for _, part := range parts {
					if part != "" {
						nonEmpty = append(nonEmpty, part)
					}
				}
				if len(nonEmpty) > 0 {
					item["content"] = strings.Join(nonEmpty, " ")
				}
				if markerDone {
					item["status"] = "done"
				}
			}
		}
		if item["status"] == "done" {
			done++
		}
		items = append(items, item)
	}
	adapted["items"] = items
	adapted["done"] = float64(done)
	adapted["total"] = float64(len(items))
	adapted["complete"] = len(items) > 0 && done == len(items)
	return adapted
}

func chatPlanFromEvent(ev map[string]interface{}) map[string]interface{} {
	m, ok := ev["plan"].(map[string]interface{})
	if !ok {
		return nil
	}
	return normalizeChatPlan(m)
}

// updateChatPlanFromEvent keeps the last useful session snapshot when a later
// worker turn reports plan:null. A map (including an empty map) is an explicit
// snapshot update; a missing or non-map value means this turn has no update.
func updateChatPlanFromEvent(current map[string]interface{}, ev map[string]interface{}) (map[string]interface{}, bool) {
	if _, exists := ev["plan"]; !exists {
		return current, false
	}
	if next := chatPlanFromEvent(ev); next != nil {
		return next, true
	}
	return current, false
}

func chatUltraPlanStateFromEvent(ev map[string]interface{}) map[string]interface{} {
	m, ok := ev["state"].(map[string]interface{})
	if !ok {
		return nil
	}
	return mergeChatMaps(nil, m)
}

func chatGoalStateFromEvent(ev map[string]interface{}) map[string]interface{} {
	m, ok := ev["state"].(map[string]interface{})
	if !ok {
		return nil
	}
	return mergeChatMaps(nil, m)
}

func mergeChatMaps(dst map[string]interface{}, src map[string]interface{}) map[string]interface{} {
	if len(src) == 0 {
		return dst
	}
	if dst == nil {
		dst = make(map[string]interface{}, len(src))
	}
	for k, v := range src {
		if existing, ok := dst[k].(map[string]interface{}); ok {
			if incoming, ok := v.(map[string]interface{}); ok {
				dst[k] = mergeChatMaps(existing, incoming)
				continue
			}
		}
		dst[k] = v
	}
	return dst
}

func appendChatRawHistoryFallback(raw []map[string]interface{}, messages ...chatMessage) []map[string]interface{} {
	out := append([]map[string]interface{}(nil), raw...)
	for _, msg := range messages {
		text := strings.TrimSpace(msg.Content)
		if text == "" {
			continue
		}
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		if role != "assistant" && role != "system" {
			role = "user"
		}
		out = append(out, map[string]interface{}{
			"role": role,
			"content": []map[string]interface{}{{
				"type": "text",
				"text": text,
			}},
		})
	}
	return out
}

func chatUsageFromEvent(ev map[string]interface{}) (map[string]int, []map[string]int) {
	var usage map[string]int
	if raw, ok := ev["usage"].(map[string]interface{}); ok && len(raw) > 0 {
		parsed := make(map[string]int)
		for key, value := range raw {
			if number, ok := value.(float64); ok {
				parsed[key] = int(number)
			}
		}
		if len(parsed) > 0 {
			usage = parsed
		}
	}

	var usages []map[string]int
	if raw, ok := ev["usages"].([]interface{}); ok && len(raw) > 0 {
		parsed := make([]map[string]int, 0, len(raw))
		for _, item := range raw {
			values, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			turn := make(map[string]int)
			for key, value := range values {
				if number, ok := value.(float64); ok {
					turn[key] = int(number)
				}
			}
			if len(turn) > 0 {
				parsed = append(parsed, turn)
			}
		}
		if len(parsed) > 0 {
			usages = parsed
		}
	}
	return usage, usages
}

func chatUsageFromEvents(events [][]byte) (map[string]int, []map[string]int) {
	var usage map[string]int
	var usages []map[string]int
	for _, line := range events {
		var ev map[string]interface{}
		if json.Unmarshal(line, &ev) != nil {
			continue
		}
		nextUsage, nextUsages := chatUsageFromEvent(ev)
		if ev["type"] == "turn_usage" {
			if len(nextUsage) == 0 {
				continue
			}
			indexNumber, ok := ev["index"].(float64)
			if !ok || indexNumber < 0 || indexNumber > float64(len(usages)) {
				continue
			}
			index := int(indexNumber)
			if indexNumber != float64(index) {
				continue
			}
			if index == len(usages) {
				usages = append(usages, nextUsage)
			} else {
				usages[index] = nextUsage
			}
			usage = make(map[string]int)
			for _, turn := range usages {
				for key, value := range turn {
					usage[key] += value
				}
			}
			continue
		}
		if len(nextUsage) > 0 {
			usage = nextUsage
		}
		if len(nextUsages) > 0 {
			usages = nextUsages
		}
	}
	return usage, usages
}

func chatCtxStatsFromEvent(ev map[string]interface{}) (int, int) {
	ctxChars, _ := chatLLMIndex(ev["ctx_chars"])
	ctxMsgs, _ := chatLLMIndex(ev["ctx_msgs"])
	if msg, ok := ev["message"].(map[string]interface{}); ok {
		if ctxChars <= 0 {
			ctxChars, _ = chatLLMIndex(msg["ctx_chars"])
		}
		if ctxMsgs <= 0 {
			ctxMsgs, _ = chatLLMIndex(msg["ctx_msgs"])
		}
	}
	return ctxChars, ctxMsgs
}

func chatCtxStatsFromEvents(events [][]byte) (int, int) {
	ctxChars, ctxMsgs := 0, 0
	for _, line := range events {
		var ev map[string]interface{}
		if json.Unmarshal(line, &ev) != nil {
			continue
		}
		nextChars, nextMsgs := chatCtxStatsFromEvent(ev)
		if nextChars > 0 {
			ctxChars = nextChars
		}
		if nextMsgs > 0 {
			ctxMsgs = nextMsgs
		}
	}
	return ctxChars, ctxMsgs
}

func chatPartialContentFromEvents(events [][]byte) string {
	var b strings.Builder
	for _, line := range events {
		var ev map[string]interface{}
		if json.Unmarshal(line, &ev) != nil {
			continue
		}
		if delta, ok := ev["delta"].(string); ok && delta != "" {
			b.WriteString(delta)
		}
	}
	return b.String()
}
