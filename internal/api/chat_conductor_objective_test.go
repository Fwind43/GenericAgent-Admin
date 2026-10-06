package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConductorObjectiveLengthRejectsWithoutMutation(t *testing.T) {
	s := newChatLoopTestServer(t)
	saveChatLoopTestSession(t, s, chatSession{ID: "objective-parent", Conductor: &chatConductorState{Role: conductorRoleParent}})
	path := chatSessionPath(s.CfgStore.Snapshot(), "objective-parent")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, objective := range []string{strings.Repeat("a", 4097), strings.Repeat("界", 4097)} {
		if _, err := s.dispatchConductor("objective-parent", objective, ""); err == nil || !strings.Contains(err.Error(), "exceeds 4096 characters") {
			t.Fatalf("expected explicit length error, got %v", err)
		}
		after, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(before, after) {
			t.Fatal("rejected objective changed persistent parent")
		}
	}
	for i, objective := range []interface{}{strings.Repeat("a", 4097), strings.Repeat("界", 4097), nil, 123} {
		requestID := fmt.Sprintf("reject-%d", i)
		broker := chatConductorBrokerDirForSession(chatSessionDir(s.CfgStore.Snapshot()), "objective-parent")
		s.handleConductorDispatchEvent("objective-parent", map[string]interface{}{"request_id": requestID, "broker_dir": broker, "objective": objective})
		data, err := os.ReadFile(filepath.Join(broker, requestID+".response.json"))
		if err != nil {
			t.Fatal(err)
		}
		var response conductorDispatchResponse
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		if response.OK || response.Error == "" {
			t.Fatalf("invalid objective accepted: %s", data)
		}
		after, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(before, after) {
			t.Fatal("rejected event mutated parent")
		}
	}
	if s.beginChatRun("objective-parent") == nil {
		t.Fatal("parent run not started")
	}
	objective := strings.Repeat("界", 4095) + "!"
	child, err := s.dispatchConductor("objective-parent", "  "+objective+"  ", "")
	if err != nil {
		t.Fatal(err)
	}
	if child.Objective != objective {
		t.Fatal("boundary objective or trailing constraint changed")
	}
}
