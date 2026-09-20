package api

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func historyOptimizationFixture(n int) chatSession {
	cs := pageFixture(n)
	for i := range cs.Messages {
		m := &cs.Messages[i]
		m.Content = strings.Repeat("x", 1024)
		if i%2 == 0 {
			m.Role = "user"
		}
		if i%7 == 0 {
			m.Kind = "btw"
		}
		m.StructuredContent = []map[string]interface{}{{"text": "synthetic", "items": []interface{}{1, "two"}}}
	}
	return cs
}

func TestChatPagesCompatibilityBytes(t *testing.T) {
	golden := map[string]string{
		"0/0":   "ba8c99b732d01d414e8f050c822805d9946e46e1bb13be00be3dffa3de6e10c4",
		"103/0": "d0b444a78541ce9a77cda3d84e2710b58d88f401048cce774a22e6138e696b8b",
		"103/1": "9db53dbf3a93b5a7a2f13af7a247294291daf4ecbb81a0bd61b1a5ceee1bc521",
		"103/2": "ff7f6391a113c6f7df2d2ac8c8b72d840169f371a3cd90b3ee05fc8f8a063a8e",
	}

	for _, n := range []int{0, 103} {
		cs := historyOptimizationFixture(n)
		page := requirePage(t, cs, "")
		stats := page["stats_messages"].([]chatMessage)
		expected := 0
		for _, m := range cs.Messages {
			if m.Role == "assistant" && m.Kind != "btw" {
				expected++
			}
		}
		if stats == nil || len(stats) != expected {
			t.Fatalf("stats = %v expected %d", stats, expected)
		}
		for _, m := range stats {
			if m.Usage["output_tokens"] == 0 {
				t.Fatal("lost usage")
			}
		}
		for i := 0; ; i++ {
			b, err := json.Marshal(page)
			if err != nil {
				t.Fatal(err)
			}
			digest := fmt.Sprintf("%x", sha256.Sum256(b))
			if digest != golden[fmt.Sprintf("%d/%d", n, i)] {
				t.Fatalf("serialized response changed: %d/%d %s", n, i, digest)
			}
			t.Logf("fixture=%d page=%d bytes=%d sha256=%s", n, i, len(b), digest)
			if i > 0 && len(page) != 4 {
				t.Fatal("history metadata leaked")
			}
			if !page["has_more"].(bool) {
				break
			}
			page = requirePage(t, cs, "&before="+url.QueryEscape(page["before"].(string)))
		}
	}
}

func BenchmarkChatSessionViewHistoryOptimization(b *testing.B) {
	cs := historyOptimizationFixture(1000)
	first, _, err := chatSessionView(cs, httptest.NewRequest("GET", "/?view=page", nil))
	if err != nil {
		b.Fatal(err)
	}
	cursor := first.(map[string]interface{})["before"].(string)
	for _, tc := range []struct{ name, query string }{{"first", ""}, {"history", "&before=" + url.QueryEscape(cursor)}} {
		b.Run(tc.name, func(b *testing.B) {
			r := httptest.NewRequest("GET", "/?view=page"+tc.query, nil)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, status, err := chatSessionView(cs, r)
				if err != nil || status != 200 {
					b.Fatal(status, err)
				}
			}
		})
	}
}

func TestChatPagesConditionalHistory(t *testing.T) {
	s := newChatLoopTestServer(t)
	cs := historyOptimizationFixture(103)
	saveChatLoopTestSession(t, s, cs)
	get := func(query, tag string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/?view=page"+query, nil)
		r.Header.Set("If-None-Match", tag)
		w := httptest.NewRecorder()
		s.chatGetSession(w, r, cs.ID)
		return w
	}
	first := get("", "")
	if first.Code != 200 {
		t.Fatal(first.Code)
	}
	var page map[string]interface{}
	if err := json.Unmarshal(first.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	query := "&before=" + url.QueryEscape(page["before"].(string))
	older := get(query, "")
	if older.Code != 200 || older.Header().Get("ETag") == "" {
		t.Fatal("history missing")
	}
	cached := get(query, older.Header().Get("ETag"))
	if cached.Code != 304 || cached.Body.Len() != 0 {
		t.Fatal("history revalidation failed")
	}
	// Outside the visible first page, but included in full-session statistics.
	cs.Messages[1].Usage["output_tokens"]++
	saveChatLoopTestSession(t, s, cs)
	changed := get("", first.Header().Get("ETag"))
	if changed.Code != 200 || changed.Header().Get("ETag") == first.Header().Get("ETag") {
		t.Fatal("statistics change hidden")
	}
}

func TestChatPagesInvalidParameters(t *testing.T) {
	for _, query := range []string{"&limit=0", "&limit=201", "&limit=no", "&before=invalid"} {
		_, status, err := chatSessionView(historyOptimizationFixture(3), httptest.NewRequest("GET", "/?view=page"+query, nil))
		if status != 400 || err == nil {
			t.Fatalf("%s: %d %v", query, status, err)
		}
	}
}

// Exercise the actual page revision loop against the previous encoding, including
// a digest with a zero first byte (two leading hexadecimal zeroes).
func TestChatPagesRevisionEncoding(t *testing.T) {
	cs := historyOptimizationFixture(1)
	found := false
	for i := 0; i < 4096; i++ {
		cs.Messages[0].Content = fmt.Sprintf("synthetic-leading-zero-%d", i)
		raw, err := json.Marshal(cs.Messages[0])
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(raw)
		if i != 0 && sum[0] != 0 {
			continue
		}
		want := fmt.Sprintf("%x", sum)
		view, status, err := chatSessionView(cs, httptest.NewRequest("GET", "/?view=page", nil))
		if err != nil || status != 200 {
			t.Fatal(status, err)
		}
		page := view.(map[string]interface{})
		index := page["message_index"].([]chatMessageIndex)
		messages := page["messages"].([]chatPageMessage)
		if index[0].Revision != want || messages[0].ContentRevision != want || len(want) != 64 || strings.ToLower(want) != want {
			t.Fatalf("revision mismatch: %v %v want %s", index, messages, want)
		}
		if sum[0] == 0 {
			if !strings.HasPrefix(index[0].Revision, "00") {
				t.Fatal("lost leading zeroes")
			}
			found = true
			break
		}
	}
	if !found {
		t.Fatal("no leading-zero fixture within bounded search")
	}
}
