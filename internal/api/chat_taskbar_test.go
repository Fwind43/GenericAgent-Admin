package api

import (
	"encoding/json"
	"sync"
	"testing"
)

const taskbarAskFixture = "\U0001f6e0\ufe0f Tool: `functions.ask_user`\n```json\n{\"question\":\"Choose\"}\n```\n"

func TestChatTaskbarQuestion(t *testing.T) {
	for _, tc := range []struct {
		name, content string
		want          bool
	}{
		{"pending", taskbarAskFixture, true},
		{"waiting", taskbarAskFixture + "`````\nWaiting for user input\n`````\n", true},
		{"answered", taskbarAskFixture + "`````\nYes\n`````\n", false},
		{"prose", taskbarAskFixture + "Finished", false},
		{"next tool", taskbarAskFixture + "\U0001f6e0\ufe0f Tool: `file_read`\n```json\n{}\n```", false},
		{"quoted", "````markdown\n" + taskbarAskFixture + "````", false},
		{"ordinary mention", "Please use ask_user", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := chatTaskbarTextWaiting(tc.content); got != tc.want {
				t.Fatalf("waiting=%v want %v", got, tc.want)
			}
		})
	}
	call := map[string]interface{}{"type": "tool_use", "name": "functions.ask_user", "id": "q1"}
	m := chatMessage{StructuredContent: []map[string]interface{}{call}}
	if !chatTaskbarQuestion(m) {
		t.Fatal("structured pending not waiting")
	}
	m.StructuredContent = append(m.StructuredContent, map[string]interface{}{"type": "tool_result", "tool_use_id": "q1", "content": "Waiting for user reply"})
	if !chatTaskbarQuestion(m) {
		t.Fatal("structured wait result not waiting")
	}
	m.StructuredContent = append(m.StructuredContent, map[string]interface{}{"type": "text", "text": "Finished"})
	if chatTaskbarQuestion(m) {
		t.Fatal("later prose kept stale question")
	}
}

func TestChatTaskbarSummary(t *testing.T) {
	for _, tc := range []struct {
		name, want string
		m          chatMessage
	}{
		{"completed", "completed", chatMessage{ID: "m", Role: "assistant", Content: "Done"}},
		{"failed", "failed", chatMessage{ID: "m", Role: "assistant", Error: true}},
		{"waiting", "waiting", chatMessage{ID: "m", Role: "assistant", Content: taskbarAskFixture}},
		{"user", "idle", chatMessage{ID: "m", Role: "user", Content: "New question"}},
		{"stopped", "idle", chatMessage{ID: "m", Role: "assistant", Content: "Partial\n\n[\u7528\u6237\u624b\u52a8\u4e2d\u6b62\u751f\u6210]", Error: true}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cs := chatSession{Messages: []chatMessage{tc.m}}
			summary := summaryFromChatSession(cs)
			if summary.TaskbarState != tc.want {
				t.Fatalf("state=%s want %s", summary.TaskbarState, tc.want)
			}
			if (summary.Result == nil) != (tc.want == "idle") {
				t.Fatalf("unexpected result: %#v", summary.Result)
			}
		})
	}
}

func TestChatTaskbarLiveSnapshot(t *testing.T) {
	s := &Server{ChatMu: &sync.Mutex{}, ChatRuns: map[string]*chatRun{"test": {Subscribers: map[chan []byte]bool{}}}}
	summary := chatSessionSummary{ID: "test", TaskbarState: "completed"}
	check := func(wantRunning bool, want string) {
		t.Helper()
		if running, got := s.chatSessionTaskbarSnapshot(summary); running != wantRunning || got != want {
			t.Fatalf("snapshot=(%v,%s) want (%v,%s)", running, got, wantRunning, want)
		}
	}
	check(true, "running")
	emit := func(delta string) {
		b, _ := json.Marshal(map[string]string{"type": "delta", "delta": delta})
		s.publishChatLine("test", b)
	}
	emit(taskbarAskFixture)
	check(true, "waiting")
	check(true, "waiting")
	emit("`````\nAnswered\n`````\n")
	check(true, "running")
	s.ChatRuns["test"].Done = true
	check(false, "completed")
}
