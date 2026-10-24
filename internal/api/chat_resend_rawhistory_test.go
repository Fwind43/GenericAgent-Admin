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

func rawToolLoopItem(summary string) map[string]interface{} {
	return map[string]interface{}{
		"role": "user",
		"content": []interface{}{
			map[string]interface{}{"type": "tool_result", "tool_use_id": "t", "content": "ok"},
			map[string]interface{}{"type": "text", "text": "\n### [WORKING MEMORY]\n<earlier_context>\n" + summary + "\n</earlier_context>"},
		},
	}
}

func rawTrimmedToolOutput(summary string) map[string]interface{} {
	return map[string]interface{}{
		"role": "user",
		"content": []interface{}{
			map[string]interface{}{"type": "text", "text": "{\"status\": \"success\"}\n\n### [WORKING MEMORY]\n" + summary},
		},
	}
}

func TestRawHistoryUserTurnsSkipsToolLoopItems(t *testing.T) {
	raw := []map[string]interface{}{
		rawTrimmedToolOutput("[USER]: build the plugin"),
		rawAssistantItem("a"),
		rawUserItem("build the plugin"),
		rawAssistantItem("b"),
		rawToolLoopItem("[USER]: build the plugin"),
	}
	turns := rawHistoryUserTurns(raw)
	if len(turns) != 1 || turns[0].index != 2 {
		t.Fatalf("tool-loop items counted as user turns: %+v", turns)
	}
}

// Regression: the working-memory summary of a tool continuation quotes earlier
// requests as "[USER]: ...". Containment matching used to cut the resend there,
// leaving the agent with a half-finished tool loop and no task.
func TestResendIgnoresUserQuotesInsideToolLoop(t *testing.T) {
	cs := chatSession{
		Messages: []chatMessage{
			{ID: "u1", Role: "user", Content: "start the job"},
			{ID: "a1", Role: "assistant", Content: "done"},
			{ID: "u2", Role: "user", Content: "continue"},
			{ID: "a2", Role: "assistant", Content: "working"},
		},
		RawHistory: []map[string]interface{}{
			rawUserItem("start the job"), rawAssistantItem("done"),
			rawUserItem("continue"), rawAssistantItem("tool call"),
			rawToolLoopItem("[USER]: start the job\n[USER]: continue"), rawAssistantItem("tool call"),
			rawToolLoopItem("[USER]: continue"), rawAssistantItem("working"),
		},
	}
	got := rawHistoryBeforeMessageForResend(cs, 2)
	if len(got) != 2 {
		t.Fatalf("resend boundary = %d items, want 2: %+v", len(got), got)
	}
}

// When GA trimmed the selected turn out of the raw window, everything retained
// belongs to the discarded branch; history_info must still keep the earlier
// summaries so the agent remembers the conversation.
func TestResendOlderThanRawWindowKeepsEarlierHistoryInfo(t *testing.T) {
	cs := chatSession{
		Messages: []chatMessage{
			{ID: "u1", Role: "user", Content: "design the plugin"},
			{ID: "a1", Role: "assistant", Content: "plan"},
			{ID: "u2", Role: "user", Content: "go build it"},
			{ID: "a2", Role: "assistant", Content: "long run"},
		},
		RawHistory: []map[string]interface{}{
			rawTrimmedToolOutput("[USER]: go build it"), rawAssistantItem("tool call"),
			rawToolLoopItem("[USER]: go build it"), rawAssistantItem("long run"),
		},
		HistoryInfo: []interface{}{
			"[USER]: design the plugin", "[Agent] planned",
			"[USER]: go build it", "[Agent] step 1", "[Agent] step 2",
		},
	}
	raw := rawHistoryBeforeMessageForResend(cs, 2)
	if raw == nil || len(raw) != 0 {
		t.Fatalf("raw boundary should be empty, got %+v", raw)
	}
	info := historyInfoBeforeMessage(cs, 2)
	if len(info) != 2 || info[0] != "[USER]: design the plugin" {
		t.Fatalf("history_info boundary = %+v", info)
	}
	if got := historyInfoBeforeMessage(cs, 0); len(got) != 0 {
		t.Fatalf("resend of first message must drop all summaries: %+v", got)
	}
}

func TestHistoryInfoBeforeMessageHonoursDuplicatesFromTail(t *testing.T) {
	cs := chatSession{
		Messages: []chatMessage{
			{ID: "u1", Role: "user", Content: "continue"},
			{ID: "a1", Role: "assistant", Content: "x"},
			{ID: "u2", Role: "user", Content: "continue"},
			{ID: "a2", Role: "assistant", Content: "y"},
		},
		HistoryInfo: []interface{}{
			"[USER]: continue", "[Agent] x", "[USER]: continue", "[Agent] y",
		},
	}
	if got := historyInfoBeforeMessage(cs, 2); len(got) != 2 {
		t.Fatalf("second continue boundary = %+v", got)
	}
	if got := historyInfoBeforeMessage(cs, 0); len(got) != 0 {
		t.Fatalf("first continue boundary = %+v", got)
	}
}
