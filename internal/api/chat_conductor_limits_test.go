package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"genericagent-admin-go/internal/config"
)

func TestConductorLimitsLifecycle(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	id := "limits-parent"
	saveChatLoopTestSession(t, s, chatSession{ID: id, Conductor: &chatConductorState{Role: conductorRoleParent}})
	saveChatLoopTestSession(t, s, chatSession{ID: "other-parent", Conductor: &chatConductorState{Role: conductorRoleParent}})
	read := func() []byte {
		t.Helper()
		data, err := os.ReadFile(chatSessionPath(cfg, id))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	call := func(args map[string]interface{}, running, outstanding int) {
		t.Helper()
		got, err := s.conductorLimits(id, args)
		if err != nil {
			t.Fatal(err)
		}
		if got.MaxRunning != running || got.MaxNonTerminal != outstanding || got.Scope != "parent_session" || got.Snapshot != "tool_request" {
			t.Fatalf("unexpected receipt: %+v", got)
		}
	}
	before := read()
	call(map[string]interface{}{"action": "get"}, 3, 12)
	if !bytes.Equal(before, read()) {
		t.Fatal("get changed persistent state")
	}
	args := map[string]interface{}{"action": "set", "max_running": float64(6), "max_non_terminal": float64(24), "_index": 0}
	call(args, 6, 24)
	before = read()
	call(args, 6, 24)
	if !bytes.Equal(before, read()) {
		t.Fatal("repeated set changed persistent state")
	}
	loaded, err := loadChatSession(cfg, id)
	if err != nil || loaded.Conductor.Limits == nil || *loaded.Conductor.Limits != (conductorLimits{6, 24}) {
		t.Fatalf("not persisted: %+v, %v", loaded.Conductor, err)
	}
	req := map[string]interface{}{}
	if err := s.prepareConductorWorkerRequest(loaded, req); err != nil {
		t.Fatal(err)
	}
	got := req["conductor"].(map[string]interface{})["scheduler"].(conductorSchedulerSnapshot)
	prompts := strings.Join(req["extra_sys_prompts"].([]string), "\n")
	if got.MaxRunning != 6 || got.MaxNonTerminal != 24 || !strings.Contains(prompts, "conductor_limits get|set|reset") || !strings.Contains(prompts, "honor explicit user caps") {
		t.Fatal("fresh request omitted limits policy", got)
	}
	other, err := s.conductorLimits("other-parent", map[string]interface{}{"action": "get"})
	if err != nil || other.MaxRunning != 3 || other.MaxNonTerminal != 12 {
		t.Fatal("cross-parent limits leak", other, err)
	}
	call(map[string]interface{}{"action": "set", "max_running": 2}, 2, 24)
	call(map[string]interface{}{"action": "reset"}, 3, 12)
	loaded, _ = loadChatSession(cfg, id)
	if loaded.Conductor.Limits != nil {
		t.Fatal("reset retained override")
	}
	before = read()
	call(map[string]interface{}{"action": "reset"}, 3, 12)
	if !bytes.Equal(before, read()) {
		t.Fatal("repeated reset changed persistent state")
	}
}

func TestConductorLimitsValidation(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	saveChatLoopTestSession(t, s, chatSession{ID: "limits-parent", Conductor: &chatConductorState{Role: conductorRoleParent}})
	saveChatLoopTestSession(t, s, chatSession{ID: "limits-worker", Conductor: &chatConductorState{Role: conductorRoleWorker}})
	saveChatLoopTestSession(t, s, chatSession{ID: "limits-normal"})
	before, _ := os.ReadFile(chatSessionPath(cfg, "limits-parent"))
	for _, args := range []map[string]interface{}{
		{}, {"action": "invent"}, {"action": 1}, {"action": "set"},
		{"action": "set", "max_running": nil}, {"action": "set", "max_running": true},
		{"action": "set", "max_running": "4"}, {"action": "set", "max_running": 1.5},
		{"action": "set", "max_running": 0}, {"action": "set", "max_running": -1},
		{"action": "set", "max_running": 33}, {"action": "set", "max_non_terminal": 257},
		{"action": "set", "max_running": 13}, {"action": "set", "max_non_terminal": 2},
		{"action": "set", "max_running": 2, "unknown": 7},
		{"action": "get", "max_running": 4}, {"action": "reset", "max_running": 4},
	} {
		if _, err := s.conductorLimits("limits-parent", args); err == nil {
			t.Fatalf("accepted invalid input: %#v", args)
		}
		after, _ := os.ReadFile(chatSessionPath(cfg, "limits-parent"))
		if !bytes.Equal(before, after) {
			t.Fatal("rejection mutated session")
		}
	}
	for _, id := range []string{"limits-worker", "limits-normal", "missing"} {
		if _, err := s.conductorLimits(id, map[string]interface{}{"action": "set", "max_running": 4}); err == nil {
			t.Fatal("non-parent accepted", id)
		}
	}
	for _, limits := range []conductorLimits{{0, 12}, {33, 100}, {4, 3}, {3, 257}} {
		if got := effectiveConductorLimits(&chatConductorState{Limits: &limits}); got != (conductorLimits{3, 12}) {
			t.Fatal("invalid disk limits not bounded", got)
		}
	}
	got, err := s.conductorLimits("limits-parent", map[string]interface{}{"action": "set", "max_running": 32, "max_non_terminal": 256})
	if err != nil || got.MaxRunning != 32 || got.MaxNonTerminal != 256 {
		t.Fatal("valid boundary rejected", got, err)
	}
}

func TestConductorLimitsAdmissionAndLowering(t *testing.T) {
	s := newChatLoopTestServer(t)
	id := "limits-parent"
	token := s.beginChatRun(id)
	defer s.endChatRunOwned(id, token)
	children := []chatConductorChild{}
	for i := 0; i < 12; i++ {
		children = append(children, chatConductorChild{DispatchID: fmt.Sprint(i), Status: conductorRunning})
	}
	saveChatLoopTestSession(t, s, chatSession{ID: id, Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: children})
	if _, err := s.dispatchConductor(id, "over old limit"); err == nil {
		t.Fatal("default admission not enforced")
	}
	if _, err := s.conductorLimits(id, map[string]interface{}{"action": "set", "max_non_terminal": 13}); err != nil {
		t.Fatal(err)
	}
	child, err := s.dispatchConductor(id, "newly allowed")
	if err != nil || child.Status != conductorQueued {
		t.Fatal("raised limit not used by admission", child, err)
	}
	if _, err := s.dispatchConductor(id, "over new limit"); err == nil {
		t.Fatal("new limit not enforced")
	}
	got, err := s.conductorLimits(id, map[string]interface{}{"action": "set", "max_running": 1, "max_non_terminal": 1})
	if err != nil || got.ActiveSlots != 12 || got.NonTerminal != 13 || got.Queued != 1 {
		t.Fatal("lowering cancelled or lost work", got, err)
	}
	loaded, _ := loadChatSession(s.CfgStore.Snapshot(), id)
	for i, original := range children {
		if loaded.ConductorChildren[i].Status != original.Status {
			t.Fatal("lowering changed running worker")
		}
	}
	if _, err := s.dispatchConductor(id, "while above lowered cap"); err == nil {
		t.Fatal("lowered admission not enforced")
	}
}

func TestConductorLimitsImmediateScheduling(t *testing.T) {
	s := newChatLoopTestServer(t)
	id := "limits-scheduling-parent"
	parentRun := s.beginChatRun(id)
	defer s.endChatRunOwned(id, parentRun)
	children := make([]chatConductorChild, 3)
	for i := range children {
		sid, dispatch := fmt.Sprintf("limits-worker-%d", i), fmt.Sprintf("limits-dispatch-%d", i)
		children[i] = chatConductorChild{SessionID: sid, DispatchID: dispatch, Status: conductorQueued, Objective: "test task"}
		saveChatLoopTestSession(t, s, chatSession{ID: sid, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: id, DispatchID: dispatch, Status: conductorQueued}})
	}
	saveChatLoopTestSession(t, s, chatSession{ID: id, Conductor: &chatConductorState{Role: conductorRoleParent, Limits: &conductorLimits{1, 12}}, ConductorChildren: children})
	s.ChatMu.Lock()
	s.ChatRuntime.conductorOwned = make(map[string]bool)
	for _, child := range children {
		s.ChatRuntime.conductorOwned[conductorOwnershipKey(id, child.SessionID, child.DispatchID)] = true
	}
	s.ChatMu.Unlock()
	old := startChatWorkerFunc
	release, started := make(chan struct{}), make(chan string, 8)
	startChatWorkerFunc = func(_ config.AppConfig, sid string) (*chatWorker, error) {
		started <- sid
		<-release
		return nil, fmt.Errorf("test worker released")
	}
	defer func() {
		close(release)
		deadline := time.Now().Add(5 * time.Second)
		for _, child := range children {
			for s.chatRunActive(child.SessionID) && time.Now().Before(deadline) {
				time.Sleep(5 * time.Millisecond)
			}
			if s.chatRunActive(child.SessionID) {
				t.Errorf("worker still active: %s", child.SessionID)
			}
		}
		startChatWorkerFunc = old
	}()
	waitStart := func() {
		t.Helper()
		select {
		case <-started:
		case <-time.After(3 * time.Second):
			t.Fatal("scheduled worker did not launch")
		}
	}
	s.scheduleConductorChildren(id)
	waitStart()
	snapshot, err := s.conductorLimits(id, map[string]interface{}{"action": "get"})
	if err != nil || snapshot.ActiveSlots != 1 || snapshot.Queued != 2 {
		t.Fatalf("initial cap: %+v, %v", snapshot, err)
	}
	snapshot, err = s.conductorLimits(id, map[string]interface{}{"action": "set", "max_running": 3})
	if err != nil || snapshot.ActiveSlots != 3 || snapshot.Queued != 0 {
		t.Fatalf("raise did not immediately schedule: %+v, %v", snapshot, err)
	}
	waitStart()
	waitStart()
	snapshot, err = s.conductorLimits(id, map[string]interface{}{"action": "set", "max_running": 1})
	if err != nil || snapshot.ActiveSlots != 3 || snapshot.MaxRunning != 1 {
		t.Fatalf("lowering interrupted workers: %+v, %v", snapshot, err)
	}
	for _, child := range children {
		if !s.chatRunActive(child.SessionID) {
			t.Fatalf("worker cancelled by lowering: %s", child.SessionID)
		}
	}
}

func TestConductorLimitsBrokerBoundary(t *testing.T) {
	s := newChatLoopTestServer(t)
	cfg := s.CfgStore.Snapshot()
	id := "limits-parent"
	saveChatLoopTestSession(t, s, chatSession{ID: id, Conductor: &chatConductorState{Role: conductorRoleParent}})
	broker := chatConductorBrokerDirForSession(chatSessionDir(cfg), id)
	call := func(requestID, directory string) {
		s.handleConductorSettingsEvent(id, map[string]interface{}{"type": "conductor_limits", "request_id": requestID, "broker_dir": directory,
			"args": map[string]interface{}{"action": "set", "max_running": 5}})
	}
	before, _ := os.ReadFile(chatSessionPath(cfg, id))
	call("../escape", broker)
	foreign := t.TempDir()
	call("foreign", foreign)
	after, _ := os.ReadFile(chatSessionPath(cfg, id))
	if !bytes.Equal(before, after) {
		t.Fatal("invalid broker mutated limits")
	}
	if _, err := os.Stat(filepath.Join(foreign, "foreign.response.json")); !os.IsNotExist(err) {
		t.Fatal("foreign broker wrote receipt")
	}
	call("valid", broker)
	data, err := os.ReadFile(filepath.Join(broker, "valid.response.json"))
	if err != nil {
		t.Fatal(err)
	}
	var reply struct {
		OK        bool                       `json:"ok"`
		Scheduler conductorSchedulerSnapshot `json:"scheduler"`
	}
	if err := json.Unmarshal(data, &reply); err != nil || !reply.OK || reply.Scheduler.MaxRunning != 5 || reply.Scheduler.Snapshot != "tool_request" {
		t.Fatalf("bad broker receipt: %s, %v", data, err)
	}
}
