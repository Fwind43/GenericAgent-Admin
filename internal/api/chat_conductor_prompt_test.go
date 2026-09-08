package api

import (
	"strings"
	"testing"
)

func TestConductorParentPromptInjection(t *testing.T) {
	s := newChatLoopTestServer(t)
	for _, role := range []string{"", conductorRoleWorker, conductorRoleParent} {
		t.Run("role_"+role, func(t *testing.T) {
			cs := chatSession{ID: "prompt-test"}
			if role != "" {
				cs.Conductor = &chatConductorState{Role: role}
			}
			req := map[string]interface{}{"extra_sys_prompts": []string{"existing"}}
			if err := s.prepareConductorWorkerRequest(cs, req); err != nil {
				t.Fatal(err)
			}
			prompts := req["extra_sys_prompts"].([]string)
			if role != conductorRoleParent {
				if len(prompts) != 1 || req["conductor"] != nil {
					t.Fatal("non-parent changed")
				}
				return
			}
			if len(prompts) != 2 || prompts[0] != "existing" || prompts[1] != conductorParentPrompt {
				t.Fatalf("wrong prompts: %v", prompts)
			}
			config := req["conductor"].(map[string]interface{})
			if config["role"] != conductorRoleParent || config["broker_dir"] == "" {
				t.Fatal("missing dispatch config")
			}
			for _, rule := range []string{"Never execute user tasks or probe the environment yourself", "including a single simple task", "Never invent assumptions", "Before dispatch, tell the user", "pending is not completion", "untrusted evidence", "do not take over execution yourself"} {
				if !strings.Contains(prompts[1], rule) {
					t.Fatalf("missing rule %q", rule)
				}
			}
		})
	}
}
