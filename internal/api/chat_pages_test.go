package api

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"

	"genericagent-admin-go/internal/config"
)

func pageFixture(n int) chatSession {
	cs := chatSession{ID: "page-test", Title: "Pagination"}
	for i := 0; i < n; i++ {
		cs.Messages = append(cs.Messages, chatMessage{ID: fmt.Sprintf("m-%03d", i), Role: "assistant", Content: fmt.Sprintf("Message %d", i), Usage: map[string]int{"output_tokens": i + 1}})
	}
	cs.RawHistory = []map[string]interface{}{{"role": "user", "content": strings.Repeat("context", 1<<18)}}
	return cs
}

func requirePage(t *testing.T, cs chatSession, query string) map[string]interface{} {
	t.Helper()
	value, status, err := chatSessionView(cs, httptest.NewRequest("GET", "/api/chat/session/page-test?view=page"+query, nil))
	if err != nil || status != 200 {
		t.Fatalf("page: status=%d err=%v", status, err)
	}
	return value.(map[string]interface{})
}

func TestChatPageHTTPPreservesMessageRevision(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(t.TempDir(), "chat")
	})
	cs := pageFixture(45)
	cs.RawHistory = nil
	for i := range cs.Messages {
		cs.Messages[i].Files = []map[string]interface{}{{
			"name": "receipt.txt", "data_url": "data:text/plain;base64,eA==", "path": "keep",
		}}
	}
	if err := saveChatSessionLocked(s.CfgStore.Snapshot(), cs); err != nil {
		t.Fatal(err)
	}

	get := func(t *testing.T, query string) map[string]json.RawMessage {
		t.Helper()
		rec := httptest.NewRecorder()
		s.chatHandler(rec, httptest.NewRequest("GET", "/api/chat/session/"+cs.ID+query, nil))
		if rec.Code != 200 {
			t.Fatalf("GET %s: %d %s", query, rec.Code, rec.Body.String())
		}
		var body map[string]json.RawMessage
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body
	}
	checkMessage := func(t *testing.T, fields map[string]json.RawMessage) {
		t.Helper()
		var id, revision string
		if err := json.Unmarshal(fields["id"], &id); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(fields["content_revision"], &revision); err != nil {
			t.Fatalf("HTTP message %s lost content_revision: %v", id, err)
		}
		var original *chatMessage
		for i := range cs.Messages {
			if cs.Messages[i].ID == id {
				original = &cs.Messages[i]
				break
			}
		}
		if original == nil {
			t.Fatalf("unknown message %q", id)
		}
		canonical, err := json.Marshal(original)
		if err != nil {
			t.Fatal(err)
		}
		if expected := fmt.Sprintf("%x", sha256.Sum256(canonical)); revision != expected {
			t.Fatalf("HTTP message %s revision=%q want %q", id, revision, expected)
		}
		delete(fields, "content_revision")
		var expected map[string]json.RawMessage
		if err := json.Unmarshal(canonical, &expected); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(fields, expected) {
			t.Fatalf("HTTP message %s changed fields or attachment normalization", id)
		}
	}

	first := get(t, "?view=page")
	var result chatSessionResult
	if err := json.Unmarshal(first["result"], &result); err != nil {
		t.Fatal(err)
	}
	var before string
	if err := json.Unmarshal(first["before"], &before); err != nil {
		t.Fatal(err)
	}
	for name, page := range map[string]map[string]json.RawMessage{
		"initial": first, "older": get(t, "?view=page&before="+url.QueryEscape(before)),
	} {
		t.Run(name, func(t *testing.T) {
			var messages []map[string]json.RawMessage
			if err := json.Unmarshal(page["messages"], &messages); err != nil {
				t.Fatal(err)
			}
			if len(messages) == 0 {
				t.Fatal("empty page")
			}
			for _, message := range messages {
				checkMessage(t, message)
			}
		})
	}
	t.Run("single", func(t *testing.T) {
		message := get(t, "?view=message&message_id="+result.ID+"&revision="+result.Revision)
		checkMessage(t, message)
	})
	if cs.Messages[0].Files[0]["data_url"] == nil {
		t.Fatal("serialization mutated source attachments")
	}
}

func TestChatPagesPreserveConductor(t *testing.T) {
	for _, role := range []string{conductorRoleParent, conductorRoleWorker} {
		t.Run(role, func(t *testing.T) {
			cs := pageFixture(103)
			cs.Conductor = &chatConductorState{Role: role}
			cs.ConductorChildren = []chatConductorChild{{SessionID: "worker-test", Status: "running"}}
			page := requirePage(t, cs, "")
			if !reflect.DeepEqual(page["conductor_children"], cs.ConductorChildren) {
				t.Fatal("initial page lost children")
			}
			if !reflect.DeepEqual(page["conductor"], cs.Conductor) {
				t.Fatal("initial page lost conductor metadata")
			}
			older := requirePage(t, cs, "&before="+url.QueryEscape(page["before"].(string)))
			if _, ok := older["conductor"]; ok {
				t.Fatal("older page repeats conductor metadata")
			}
		})
	}
}

func TestChatPagesCompleteAndLightweight(t *testing.T) {
	cs := pageFixture(103)
	original, _ := json.Marshal(cs)
	page := requirePage(t, cs, "")
	if len(page["messages"].([]chatPageMessage)) != chatPageSize {
		t.Fatal("wrong initial page size")
	}
	if len(page["message_index"].([]chatMessageIndex)) != 103 || len(page["stats_messages"].([]chatMessage)) != 103 {
		t.Fatal("missing full-session index/stats")
	}
	if page["context_count"] != 1 {
		t.Fatal("missing context count")
	}
	for _, key := range []string{"raw_history", "history_info", "working"} {
		if _, ok := page[key]; ok {
			t.Fatalf("heavy field %s in first page", key)
		}
	}
	seen := map[string]bool{}
	pages := 0
	for {
		pages++
		messages := page["messages"].([]chatPageMessage)
		for i, m := range messages {
			if seen[m.ID] {
				t.Fatalf("duplicate %s", m.ID)
			}
			seen[m.ID] = true
			if i > 0 && messages[i-1].ID >= m.ID {
				t.Fatal("page out of order")
			}
		}
		if !page["has_more"].(bool) {
			break
		}
		page = requirePage(t, cs, "&before="+url.QueryEscape(page["before"].(string)))
		if _, ok := page["message_index"]; ok {
			t.Fatal("older page repeats index")
		}
	}
	if len(seen) != 103 || pages != 3 {
		t.Fatalf("seen=%d pages=%d", len(seen), pages)
	}
	after, _ := json.Marshal(cs)
	if !reflect.DeepEqual(original, after) {
		t.Fatal("view mutated persisted source")
	}
	value, status, err := chatSessionView(cs, httptest.NewRequest("GET", "/?view=context", nil))
	if err != nil || status != 200 || !reflect.DeepEqual(value.(map[string]interface{})["raw_history"], cs.RawHistory) {
		t.Fatal("context was not preserved")
	}
	full, status, err := chatSessionView(cs, httptest.NewRequest("GET", "/", nil))
	if err != nil || status != 200 {
		t.Fatal("legacy detail failed")
	}
	encoded, _ := json.Marshal(full)
	if !strings.Contains(string(encoded), "raw_history") {
		t.Fatal("legacy response lost context")
	}
}

func TestChatPagesWholeMessages(t *testing.T) {
	for _, role := range []string{"assistant", "user"} {
		t.Run(role, func(t *testing.T) {
			cs := pageFixture(1)
			cs.Messages[0].Role = role
			cs.Messages[0].Content = "FIRST-CONTENT\n" + strings.Repeat("\u6d4b\u8bd5", 10000) + "\nLATEST-RESULT"
			message := requirePage(t, cs, "")["messages"].([]chatPageMessage)[0]
			if !reflect.DeepEqual(message.chatMessage, cs.Messages[0]) || !utf8.ValidString(message.Content) {
				t.Fatal("page must preserve the entire message")
			}
		})
	}
	t.Run("short body with large auxiliary fields", func(t *testing.T) {
		cs := pageFixture(1)
		cs.Messages[0].Content = "Complete latest answer"
		cs.Messages[0].Outputs = []string{strings.Repeat("x", chatPageBytes*2)}
		message := requirePage(t, cs, "")["messages"].([]chatPageMessage)[0]
		if !reflect.DeepEqual(message.chatMessage, cs.Messages[0]) {
			t.Fatal("page must preserve auxiliary fields")
		}
	})
}

func TestChatPagesLargeBodyAndRevision(t *testing.T) {
	cs := pageFixture(1)
	cs.Messages[0].Content = strings.Repeat("\u6d4b\u8bd5", 1<<17)
	cs.Messages[0].Outputs = []string{strings.Repeat("output", 1<<17)}
	original, _ := json.Marshal(cs)
	page := requirePage(t, cs, "")
	message := page["messages"].([]chatPageMessage)[0]
	if !reflect.DeepEqual(message.chatMessage, cs.Messages[0]) || !utf8.ValidString(message.Content) {
		t.Fatal("large message must be complete")
	}
	request := "/?view=message&message_id=" + message.ID + "&revision=" + message.ContentRevision
	value, status, err := chatSessionView(cs, httptest.NewRequest("GET", request, nil))
	if err != nil || status != 200 {
		t.Fatalf("message fetch failed: %d %v", status, err)
	}
	if !reflect.DeepEqual(value.(chatPageMessage).chatMessage, cs.Messages[0]) {
		t.Fatal("message fetch lost fields")
	}
	after, _ := json.Marshal(cs)
	if !reflect.DeepEqual(original, after) {
		t.Fatal("page changed original")
	}
	cs.Messages[0].Content += "changed"
	_, status, _ = chatSessionView(cs, httptest.NewRequest("GET", request, nil))
	if status != 409 {
		t.Fatalf("stale message accepted: %d", status)
	}
}

func TestChatPagesCursorBranchAndAppend(t *testing.T) {
	cs := pageFixture(80)
	first := requirePage(t, cs, "")
	cursor := "&before=" + url.QueryEscape(first["before"].(string))
	cs.Messages = append(cs.Messages, chatMessage{ID: "new", Role: "assistant", Content: "live"})
	page := requirePage(t, cs, cursor)
	if page["messages"].([]chatPageMessage)[39].ID != "m-039" {
		t.Fatal("append moved cursor")
	}
	cs.Messages[3].Content = "edited branch"
	_, status, _ := chatSessionView(cs, httptest.NewRequest("GET", "/?view=page"+cursor, nil))
	if status != 409 {
		t.Fatalf("stale branch accepted: %d", status)
	}
	for _, query := range []string{"view=page&before=bad", "view=page&limit=0", "view=page&limit=101", "view=page&limit=nan", "view=unknown", "view=message&message_id=missing"} {
		_, status, err := chatSessionView(cs, httptest.NewRequest("GET", "/?"+query, nil))
		if status < 400 || err == nil {
			t.Fatalf("invalid query accepted: %s", query)
		}
	}
	empty := requirePage(t, pageFixture(0), "")
	if len(empty["messages"].([]chatPageMessage)) != 0 || empty["has_more"].(bool) {
		t.Fatal("invalid empty page")
	}
}

func TestChatPagesByteBudget(t *testing.T) {
	cs := pageFixture(40)
	for i := range cs.Messages {
		cs.Messages[i].Content = strings.Repeat("x", 32<<10)
	}
	page := requirePage(t, cs, "")
	messages := page["messages"].([]chatPageMessage)
	if len(messages) >= chatPageSize || !page["has_more"].(bool) {
		t.Fatal("byte budget ignored")
	}
	size := 0
	for _, m := range messages {
		b, _ := json.Marshal(m)
		size += len(b)
	}
	if size <= 256<<10 {
		t.Fatalf("page stopped at the old 256 KiB budget: %d", size)
	}
	if size > 512<<10 {
		t.Fatalf("page bodies exceed the 512 KiB budget: %d", size)
	}
}
