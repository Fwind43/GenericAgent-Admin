package api

import "testing"

func TestChatResultVersion(t *testing.T) {
	cs := pageFixture(2)
	original := latestChatSessionResult(cs)
	if original == nil || original.ID != "m-001" {
		t.Fatal("missing latest result")
	}
	cs.Title, cs.UpdatedAt, cs.Pinned = "Renamed", 12345, true
	if got := latestChatSessionResult(cs); *got != *original {
		t.Fatal("metadata changed result version")
	}
	if got := summaryFromChatSession(cs).Result; *got != *original {
		t.Fatal("summary version mismatch")
	}
	page := requirePage(t, cs, "")
	if got := page["result"].(*chatSessionResult); *got != *original {
		t.Fatal("page result mismatch")
	}
	messages := page["messages"].([]chatPageMessage)
	if messages[len(messages)-1].ContentRevision != original.Revision {
		t.Fatal("message revision mismatch")
	}
	cs.Messages[1].Content = "Revised answer"
	if got := latestChatSessionResult(cs); got.ID != original.ID || got.Revision == original.Revision {
		t.Fatal("content change did not change revision")
	}
	cs.Messages = append(cs.Messages, chatMessage{ID: "btw", Kind: "btw", Role: "assistant", Content: "Side answer"})
	if latestChatSessionResult(cs).ID != original.ID {
		t.Fatal("side question replaced main result")
	}
}

func TestChatResultRejectsIncompleteOrStopped(t *testing.T) {
	for _, message := range []chatMessage{
		{ID: "m", Role: "user", Content: "New question"},
		{ID: "m", Role: "assistant"},
		{ID: "m", Role: "assistant", Content: "Stopped."},
		{ID: "m", Role: "assistant", Content: "已中止。"},
	} {
		cs := pageFixture(1)
		cs.Messages = append(cs.Messages, message)
		if got := latestChatSessionResult(cs); got != nil {
			t.Fatalf("unexpected result for %#v: %#v", message, got)
		}
	}
	if latestChatSessionResult(chatSession{}) != nil {
		t.Fatal("empty session has result")
	}
}
