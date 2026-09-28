package api

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTeamworkValidation(t *testing.T) {
	good := teamworkMember{ID: "research", Name: "Research", Role: "Check evidence", LLMNo: 2}
	if err := validateTeamwork([]teamworkMember{good}); err != nil {
		t.Fatal(err)
	}
	if err := validateTeamwork(nil); err != nil {
		t.Fatal(err)
	}
	cases := [][]teamworkMember{
		{good, good},
		{{ID: "bad/id", Name: "Research", Role: "Evidence"}},
		{{ID: "r", Name: " ", Role: "Evidence"}},
		{{ID: "r", Name: "Research", Role: " "}},
		{{ID: "r", Name: "Research", Role: "Evidence", LLMNo: -1}},
		{good, {ID: "other", Name: " research ", Role: "Review"}},
		make([]teamworkMember, 9),
	}
	for i, members := range cases {
		if validateTeamwork(members) == nil {
			t.Errorf("case %d accepted", i)
		}
	}
}

func TestTeamworkMemberRouting(t *testing.T) {
	member := teamworkMember{ID: "research", Name: "Research", Role: "Check evidence", LLMNo: 2}
	parent := chatSession{Conductor: &chatConductorState{Team: []teamworkMember{member}}}
	worker := chatSession{Conductor: &chatConductorState{}}
	child := chatConductorChild{}
	if err := resolveTeamworkMember(parent, conductorDispatchOptions{MemberID: member.ID}, &child, &worker); err != nil {
		t.Fatal(err)
	}
	if worker.Settings.LLMNo != 2 || worker.Conductor.MemberRole != member.Role || child.MemberName != member.Name {
		t.Fatal("member snapshot or model not assigned")
	}
	wrong := 3
	for _, options := range []conductorDispatchOptions{{}, {MemberID: "unknown"}, {MemberID: member.ID, LLMNo: &wrong}} {
		if resolveTeamworkMember(parent, options, &child, &worker) == nil {
			t.Errorf("accepted %+v", options)
		}
	}
	worker.Conductor.MemberID = "other"
	if resolveTeamworkMember(parent, conductorDispatchOptions{MemberID: member.ID, SessionID: "existing"}, &child, &worker) == nil {
		t.Fatal("cross-member reuse accepted")
	}
	if resolveTeamworkMember(chatSession{}, conductorDispatchOptions{}, &child, &worker) != nil {
		t.Fatal("ordinary dispatch broken")
	}
	if resolveTeamworkMember(chatSession{}, conductorDispatchOptions{MemberID: "research"}, &child, &worker) == nil {
		t.Fatal("member without roster accepted")
	}
}

func TestTeamworkLeadPrompt(t *testing.T) {
	if teamworkPrompt(nil) != "" {
		t.Fatal("ordinary conductor prompt changed")
	}
	prompt := teamworkPrompt([]teamworkMember{{ID: "review", Name: "Reviewer", Role: "Audit", LLMNo: 1}})
	for _, expected := range []string{"member_id", "review", "Audit", "synthesize", "serialize shared-file writes"} {
		if !strings.Contains(prompt, expected) {
			t.Errorf("missing %q", expected)
		}
	}
}

func TestTeamworkSaveAndLocks(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	s.ChatLLMCache = newChatLLMCache()
	s.ChatLLMCache.ttl = time.Hour
	_, err := s.ChatLLMCache.load(chatLLMKey(cfg), func() ([]map[string]interface{}, error) {
		return []map[string]interface{}{{"index": 2, "model": "test-model"}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	saveChatLoopTestSession(t, s, chatSession{ID: "team", Conductor: &chatConductorState{Role: conductorRoleParent}})
	post := func(body string, expected int) {
		t.Helper()
		w := httptest.NewRecorder()
		s.chatTeamwork(w, httptest.NewRequest("POST", "/", strings.NewReader(body)), "team")
		if w.Code != expected {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
	}
	body := `{"members":[{"id":"review","name":"Reviewer","role":"Check evidence","llm_no":2}]}`
	for i := 0; i < 2; i++ {
		post(body, 200)
		cs, err := loadChatSession(cfg, "team")
		if err != nil || len(cs.Conductor.Team) != 1 || cs.Conductor.Team[0].LLMNo != 2 {
			t.Fatalf("not persisted: %+v %v", cs.Conductor, err)
		}
	}
	post(strings.Replace(body, `"llm_no":2`, `"llm_no":99`, 1), 400)
	token := s.beginChatRun("team")
	post(`{"members":[]}`, 409)
	s.endChatRunOwned("team", token)
	cs, err := loadChatSession(cfg, "team")
	if err != nil {
		t.Fatal(err)
	}
	cs.ConductorChildren = []chatConductorChild{{DispatchID: "pending", Status: conductorQueued}}
	saveChatLoopTestSession(t, s, cs)
	post(`{"members":[]}`, 409)
	cs.ConductorChildren = nil
	saveChatLoopTestSession(t, s, cs)
	post(`{"members":[]}`, 200)
	cs, err = loadChatSession(cfg, "team")
	if err != nil || len(cs.Conductor.Team) != 0 {
		t.Fatal("team removal not persisted", err)
	}
}

func TestTeamworkWorkerSnapshotPrompt(t *testing.T) {
	s := newChatLoopTestServer(t)
	cs := chatSession{ID: "member", Conductor: &chatConductorState{Role: conductorRoleWorker, Status: conductorQueued, MemberID: "review", MemberName: "Reviewer", MemberRole: "Check evidence"}}
	saveChatLoopTestSession(t, s, cs)
	restored, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID)
	if err != nil {
		t.Fatal(err)
	}
	req := map[string]interface{}{"extra_sys_prompts": []string{"existing"}}
	if err = s.prepareConductorWorkerRequest(restored, req); err != nil {
		t.Fatal(err)
	}
	prompts := req["extra_sys_prompts"].([]string)
	if len(prompts) != 3 || prompts[0] != "existing" || !strings.Contains(prompts[2], "Check evidence") {
		t.Fatal("member responsibility not injected", prompts)
	}
	restored.Conductor.Status = conductorSucceeded
	req = map[string]interface{}{}
	if err = s.prepareConductorWorkerRequest(restored, req); err != nil {
		t.Fatal(err)
	}
	if _, ok := req["extra_sys_prompts"]; ok {
		t.Fatal("terminal worker leaked role into ordinary follow-up")
	}
}
