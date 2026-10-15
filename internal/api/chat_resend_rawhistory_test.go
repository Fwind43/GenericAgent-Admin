package api

import "testing"

func rawUserItem(text string) map[string]interface{} {
	return map[string]interface{}{
		"role":    "user",
		"content": []interface{}{map[string]interface{}{"type": "text", "text": text}},
	}
}

func rawAssistantItem(text string) map[string]interface{} {
	return map[string]interface{}{
		"role":    "assistant",
		"content": []interface{}{map[string]interface{}{"type": "output_text", "text": text}},
	}
}

// The resend path must never fail to find a boundary: the turn was already
// located by message ID, so raw history is only used to cut context. Strict
// content equality used to reject these shapes with
// "raw history does not contain the selected user message".
func TestRawHistoryBeforeMessageForResendToleratesMismatch(t *testing.T) {
	// "\n\n[\u9644\u4ef6\u5df2\u4fdd\u5b58]\n" is the suffix the run handler
	// appends to session content when the turn carried uploads.
	attachSuffix := "\n\n[\u9644\u4ef6\u5df2\u4fdd\u5b58]\n- a.png"

	for _, tc := range []struct {
		name    string
		cs      chatSession
		index   int
		wantLen int
	}{
		{
			name: "attachment suffix only in session copy",
			cs: chatSession{
				Messages: []chatMessage{
					{ID: "u1", Role: "user", Content: "first"},
					{ID: "a1", Role: "assistant", Content: "ok"},
					{ID: "u2", Role: "user", Content: "look at this" + attachSuffix},
				},
				RawHistory: []map[string]interface{}{
					rawUserItem("first"),
					rawAssistantItem("ok"),
					rawUserItem("look at this"),
				},
			},
			index:   2,
			wantLen: 2,
		},
		{
			name: "whitespace and CRLF drift",
			cs: chatSession{
				Messages: []chatMessage{
					{ID: "u1", Role: "user", Content: "hello   world"},
				},
				RawHistory: []map[string]interface{}{
					rawUserItem("hello\r\nworld"),
				},
			},
			index:   0,
			wantLen: 0,
		},
		{
			name: "compacted raw history drops older user turns",
			cs: chatSession{
				Messages: []chatMessage{
					{ID: "u1", Role: "user", Content: "one"},
					{ID: "u2", Role: "user", Content: "two"},
					{ID: "u3", Role: "user", Content: "three"},
				},
				RawHistory: []map[string]interface{}{
					rawUserItem("two"),
					rawAssistantItem("summary"),
					rawUserItem("three"),
				},
			},
			index:   2,
			wantLen: 2,
		},
		{
			name: "content unrelated to raw history still yields a boundary",
			cs: chatSession{
				Messages: []chatMessage{
					{ID: "u1", Role: "user", Content: "selected"},
				},
				RawHistory: []map[string]interface{}{
					rawUserItem("totally different"),
				},
			},
			index:   0,
			wantLen: 0,
		},
		{
			name: "empty raw history",
			cs: chatSession{
				Messages:   []chatMessage{{ID: "u1", Role: "user", Content: "x"}},
				RawHistory: []map[string]interface{}{},
			},
			index:   0,
			wantLen: 0,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := rawHistoryBeforeMessageForResend(tc.cs, tc.index)
			if got == nil {
				t.Fatal("resend boundary must never be nil")
			}
			if len(got) != tc.wantLen {
				t.Fatalf("raw len=%d want=%d", len(got), tc.wantLen)
			}
		})
	}
}

func TestRawHistoryBeforeMessageForResendSkipsConductorCompletions(t *testing.T) {
	completion := "[Internal Conductor completion event; not a new user request] Completed dispatches: d-1. Use conductor_collect for full receipts if needed."
	for _, tc := range []struct {
		name        string
		selected    string
		rawSelected string
	}{
		{name: "position fallback after content compaction", selected: "selected user request", rawSelected: "compacted user text"},
		{name: "receipt text must not match the selected request", selected: "Completed dispatches: d-1.", rawSelected: "compacted user text"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cs := chatSession{
				Messages: []chatMessage{
					{ID: "u1", Role: "user", Content: "first"},
					{ID: "a1", Role: "assistant", Content: "dispatched"},
					{ID: "receipt", Role: "assistant", Content: "collected"},
					{ID: "u2", Role: "user", Content: tc.selected},
					{ID: "a2", Role: "assistant", Content: "old response"},
				},
				RawHistory: []map[string]interface{}{
					rawUserItem("first"), rawAssistantItem("dispatched"),
					rawUserItem(completion), rawAssistantItem("collected"),
					rawUserItem(tc.rawSelected), rawAssistantItem("old response"),
				},
			}
			got := rawHistoryBeforeMessageForResend(cs, 3)
			if len(got) != 4 {
				t.Fatalf("resend cut at raw index %d, want 4 (preserve the earlier receipt, remove the selected user turn)", len(got))
			}
		})
	}
}

// The fork path keeps strict semantics: forking off an unrelated raw history
// should still be refused rather than silently guessing a boundary.
func TestRawHistoryBeforeMessageStaysStrictForFork(t *testing.T) {
	cs := chatSession{
		Messages:   []chatMessage{{ID: "target", Role: "user", Content: "selected"}},
		RawHistory: []map[string]interface{}{rawUserItem("totally different")},
	}
	if _, err := rawHistoryBeforeMessage(cs, 0); err == nil {
		t.Fatal("expected strict fork matching to fail on unrelated raw history")
	}
}
