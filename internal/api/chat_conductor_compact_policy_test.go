package api

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestConductorCompactPolicyPreservesBoundary(t *testing.T) {
	s := newChatLoopTestServer(t)
	cs := chatSession{ID: "compact-policy", Conductor: &chatConductorState{Role: conductorRoleParent, ModelStrategy: "User policy: \"lookup\" / design"}}
	req := map[string]interface{}{}
	if err := s.prepareConductorWorkerRequest(cs, req); err != nil {
		t.Fatal(err)
	}
	prompts := req["extra_sys_prompts"].([]string)
	for _, prefix := range []string{"Current persistent subtask defaults:", "Current session model-selection strategy"} {
		found := false
		for _, prompt := range prompts {
			if strings.HasPrefix(prompt, prefix) {
				found = true
				if len(prompt) > 800 {
					t.Fatalf("wrapper regressed: %d", len(prompt))
				}
			}
		}
		if !found {
			t.Fatal("missing policy snapshot", prefix)
		}
	}
	joined := strings.Join(prompts, "\n")
	encoded, _ := json.Marshal(cs.Conductor.ModelStrategy)
	for _, want := range []string{string(encoded), "Explicit user choices for a task take precedence", "authorized revisions only", "Fresh each request", "queued/running workers are unchanged", "never grants permissions", "empty=disabled once", "default null=cleared"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing contract: %s", want)
		}
	}
}
