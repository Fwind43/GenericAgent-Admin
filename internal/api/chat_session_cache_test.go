package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatSessionConditionalCache(t *testing.T) {
	s := newChatLoopTestServer(t)
	cs := chatSession{ID: "cache-test", Title: "Before", UpdatedAt: 123,
		Messages: []chatMessage{{ID: "m1", Role: "assistant", Content: strings.Repeat("x", 10*1024*1024)}}}
	saveChatLoopTestSession(t, s, cs)
	get := func(tag string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/api/chat/session/"+cs.ID, nil)
		r.Header.Set("If-None-Match", tag)
		w := httptest.NewRecorder()
		s.chatGetSession(w, r, cs.ID)
		return w
	}
	first := get("")
	tag := first.Header().Get("ETag")
	if first.Code != 200 || tag == "" || first.Body.Len() < 10*1024*1024 || first.Header().Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("first response: status=%d bytes=%d headers=%v", first.Code, first.Body.Len(), first.Header())
	}
	for _, match := range []string{tag, "W/" + tag, `"unrelated", ` + tag, "*"} {
		cached := get(match)
		if cached.Code != 304 || cached.Body.Len() != 0 || cached.Header().Get("ETag") != tag {
			t.Fatalf("validation %q: status=%d bytes=%d", match, cached.Code, cached.Body.Len())
		}
	}
	// Keep ID, message count and timestamp unchanged, but replace the snapshot.
	cs.Title = "After"
	cs.Messages[0].Content = "changed"
	saveChatLoopTestSession(t, s, cs)
	changed := get(tag)
	var got chatSession
	if err := json.Unmarshal(changed.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if changed.Code != 200 || changed.Header().Get("ETag") == tag || got.Messages[0].Content != "changed" || got.Title != "After" {
		t.Fatalf("changed snapshot not returned: status=%d session=%+v", changed.Code, got)
	}
	t.Logf("unchanged 10MiB snapshot: first=%d bytes, revalidation=0 body bytes", first.Body.Len())
}
