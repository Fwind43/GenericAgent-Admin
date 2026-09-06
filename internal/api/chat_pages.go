package api

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

const chatPageSize = 40
const chatPageBytes = 512 << 10

type chatMessageIndex struct {
	ID       string `json:"id"`
	Revision string `json:"revision"`
}
type chatPageMessage struct {
	chatMessage
	ContentRevision string `json:"content_revision"`
}
type chatPageCursor struct {
	End    int    `json:"end"`
	Prefix string `json:"prefix"`
}

func chatPagePrefix(index []chatMessageIndex) string {
	b, _ := json.Marshal(index)
	return fmt.Sprintf("%x", sha256.Sum256(b))
}

// Views affect transport only. The stored session and worker history stay intact.
func chatSessionView(cs chatSession, r *http.Request) (interface{}, int, error) {
	q := r.URL.Query()
	switch q.Get("view") {
	case "":
		return chatSessionForClient(cs), http.StatusOK, nil
	case "context":
		return map[string]interface{}{"raw_history": cs.RawHistory, "history_info": cs.HistoryInfo, "working": cs.Working}, http.StatusOK, nil
	case "message":
		for _, m := range cs.Messages {
			if m.ID != q.Get("message_id") {
				continue
			}
			b, err := json.Marshal(m)
			if err != nil {
				return nil, 500, err
			}
			revision := fmt.Sprintf("%x", sha256.Sum256(b))
			if expected := q.Get("revision"); expected != "" && expected != revision {
				return nil, http.StatusConflict, fmt.Errorf("message changed; refresh history")
			}
			return chatPageMessage{chatMessage: m, ContentRevision: revision}, http.StatusOK, nil
		}
		return nil, http.StatusNotFound, fmt.Errorf("message not found")
	case "page":
	default:
		return nil, http.StatusBadRequest, fmt.Errorf("unknown session view")
	}
	limit := chatPageSize
	if value := q.Get("limit"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 || n > 100 {
			return nil, 400, fmt.Errorf("limit must be between 1 and 100")
		}
		limit = n
	}
	index := make([]chatMessageIndex, len(cs.Messages))
	stats := make([]chatMessage, 0)
	for i, m := range cs.Messages {
		b, err := json.Marshal(m)
		if err != nil {
			return nil, 500, err
		}
		index[i] = chatMessageIndex{ID: m.ID, Revision: fmt.Sprintf("%x", sha256.Sum256(b))}
		if m.Role == "assistant" && m.Kind != "btw" {
			stats = append(stats, chatMessage{ID: m.ID, Role: m.Role, Kind: m.Kind, Usage: m.Usage, Usages: m.Usages,
				ElapsedMS: m.ElapsedMS, LLMElapsedMS: m.LLMElapsedMS, ToolElapsedMS: m.ToolElapsedMS,
				FirstTokenMS: m.FirstTokenMS, RunStartedAtMS: m.RunStartedAtMS})
		}
	}
	end := len(cs.Messages)
	if encoded := q.Get("before"); encoded != "" {
		b, err := base64.RawURLEncoding.DecodeString(encoded)
		var cursor chatPageCursor
		if err != nil || json.Unmarshal(b, &cursor) != nil || cursor.End < 1 {
			return nil, 400, fmt.Errorf("invalid history cursor")
		}
		if cursor.End > end || chatPagePrefix(index[:cursor.End]) != cursor.Prefix {
			return nil, http.StatusConflict, fmt.Errorf("history changed; refresh history")
		}
		end = cursor.End
	}
	start, used := end, 0
	page := make([]chatPageMessage, 0, limit)
	for start > 0 && len(page) < limit {
		i := start - 1
		m := chatPageMessage{chatMessage: cs.Messages[i], ContentRevision: index[i].Revision}
		// Pages contain whole messages, even when one message exceeds the byte budget.
		b, err := json.Marshal(m)
		if err != nil {
			return nil, 500, err
		}
		if used+len(b) > chatPageBytes && len(page) > 0 {
			break
		}
		used += len(b)
		page = append(page, m)
		start--
	}
	for i, j := 0, len(page)-1; i < j; i, j = i+1, j-1 {
		page[i], page[j] = page[j], page[i]
	}
	before := ""
	if start > 0 {
		b, _ := json.Marshal(chatPageCursor{End: start, Prefix: chatPagePrefix(index[:start])})
		before = base64.RawURLEncoding.EncodeToString(b)
	}
	// Explicit metadata avoids accidentally adding future heavy session fields to the page.
	result := map[string]interface{}{
		"id": cs.ID, "title": cs.Title, "updated_at": cs.UpdatedAt, "settings": cs.Settings,
		"workspace": cs.Workspace, "project_mode": cs.ProjectMode, "queued_messages": cs.QueuedMessages,
		"plan": cs.Plan, "worldline_head": cs.WorldlineHead, "result": latestChatSessionResult(cs),
		"messages": page, "total_messages": len(cs.Messages), "has_more": start > 0, "before": before,
		"message_index": index, "stats_messages": stats, "context_count": len(cs.RawHistory),
	}
	// Earlier pages need no repeated whole-session metadata or statistics.
	if q.Get("before") != "" {
		result = map[string]interface{}{"id": cs.ID, "messages": page, "has_more": start > 0, "before": before}
	}
	return result, http.StatusOK, nil
}
