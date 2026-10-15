package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestConductorInspectBrokerLiveReadOnly(t *testing.T) {
	s, p, w, d := instructionTestPair(t, conductorRunning)
	start := 1
	parent, _ := loadChatSession(s.CfgStore.Snapshot(), p)
	parent.ConductorChildren[0].MessageStart = &start
	saveChatLoopTestSession(t, s, parent)
	worker, _ := loadChatSession(s.CfgStore.Snapshot(), w)
	worker.Messages = []chatMessage{{ID: "old", Role: "assistant", Content: "old delivery"}, {ID: "pending", Role: "assistant", Kind: "pending"}}
	saveChatLoopTestSession(t, s, worker)
	token := s.beginChatRun(w)
	defer s.endChatRunOwned(w, token)
	token.PendingAssistantID = "pending"
	token.RunStartedAtMS = time.Now().Add(-time.Second).UnixMilli()
	for i := 0; i < 3; i++ {
		s.publishChatRun(w, map[string]interface{}{"type": "turn", "summary": "Inspecting source", "thinking": "PRIVATE", "content": "Latest visible output", "tool_calls": []string{"PRIVATE"}})
	}
	s.publishChatRun(w, map[string]interface{}{"type": "delta", "delta": "PRIVATE TOOL ARGS/RESULTS"})
	s.publishChatRun(w, map[string]interface{}{"type": "tool_timing", "tool_active_count": 1, "tool_name": "code_run", "tool_phase": "started"})
	before := instructionDiskSnapshot(t, s)
	dir := chatConductorBrokerDirForSession(chatSessionDir(s.CfgStore.Snapshot()), p)
	request := map[string]interface{}{"type": "conductor_inspect", "request_id": "inspect-one", "dispatch_id": d, "broker_dir": dir}
	s.handleConductorInspectEvent(p, request)
	data, err := os.ReadFile(filepath.Join(dir, "inspect-one.response.json"))
	if err != nil {
		t.Fatalf("live inspection returned no broker reply: %v", err)
	}
	var reply struct {
		OK       bool   `json:"ok"`
		Status   string `json:"status"`
		Progress struct {
			Phase   string `json:"phase"`
			Summary string `json:"latest_summary"`
			Output  string `json:"latest_output"`
			Tool    string `json:"tool_name"`
			Active  int    `json:"active_tools"`
			Step    int    `json:"step"`
			Updated int64  `json:"updated_at_ms"`
		} `json:"progress"`
	}
	if err := json.Unmarshal(data, &reply); err != nil {
		t.Fatal(err)
	}
	if !reply.OK || reply.Status != conductorRunning || reply.Progress.Phase != "tool" || reply.Progress.Tool != "code_run" || reply.Progress.Active != 1 || reply.Progress.Step != 3 || reply.Progress.Summary != "Inspecting source" || reply.Progress.Output != "Latest visible output" || reply.Progress.Updated == 0 {
		t.Fatalf("incomplete live inspection: %s", data)
	}
	if strings.Contains(string(data), "PRIVATE") || strings.Contains(string(data), "old delivery") {
		t.Fatalf("leaked non-progress context: %s", data)
	}
	request["request_id"] = "inspect-two"
	s.handleConductorInspectEvent(p, request)
	after := instructionDiskSnapshot(t, s)
	delete(after, filepath.Join(dir, "inspect-one.response.json"))
	delete(after, filepath.Join(dir, "inspect-two.response.json"))
	if !reflect.DeepEqual(before, after) {
		t.Fatal("inspection changed persistent session, evidence, or read acknowledgments")
	}
}

func TestConductorInspectIsolationAndLifecycle(t *testing.T) {
	for _, name := range []string{"live", "starting", "queued", "succeeded", "failed", "cancelled", "missing-run", "done", "canceled", "different-parent", "reused-dispatch", "missing-start", "negative-start", "past-start", "old-pending", "missing-pending", "non-pending"} {
		t.Run(name, func(t *testing.T) {
			s, p, w, d := instructionTestPair(t, conductorRunning)
			parent, _ := loadChatSession(s.CfgStore.Snapshot(), p)
			worker, _ := loadChatSession(s.CfgStore.Snapshot(), w)
			start := 1
			parent.ConductorChildren[0].MessageStart = &start
			worker.Messages = []chatMessage{{ID: "old", Role: "assistant", Kind: "pending"}, {ID: "pending", Role: "assistant", Kind: "pending"}}
			token := s.beginChatRun(w)
			defer s.endChatRunOwned(w, token)
			token.PendingAssistantID = "pending"
			token.ConductorProgress = conductorRunProgress{Available: true, Phase: "tool", LatestOutput: "live-public", ToolName: "code_run", UpdatedAtMS: 1, RecentSteps: []conductorProgressStep{{Step: 1, Summary: "live-public", UpdatedAtMS: 1}}}
			switch name {
			case "starting":
				token.ConductorProgress = conductorRunProgress{}
			case "queued", "succeeded", "failed", "cancelled":
				parent.ConductorChildren[0].Status = name
				parent.ConductorChildren[0].Objective = "original"
			case "missing-run":
				delete(s.ChatRuns, w)
			case "done":
				token.Done = true
			case "canceled":
				token.Canceled = true
			case "different-parent":
				worker.Conductor.ParentSessionID = "other-parent"
			case "reused-dispatch":
				worker.Conductor.DispatchID = "newer-dispatch"
			case "missing-start":
				parent.ConductorChildren[0].MessageStart = nil
			case "negative-start":
				start = -1
			case "past-start":
				start = 3
			case "old-pending":
				token.PendingAssistantID = "old"
			case "missing-pending":
				token.PendingAssistantID = "absent"
			case "non-pending":
				worker.Messages[1].Kind = "final"
			}
			saveChatLoopTestSession(t, s, parent)
			saveChatLoopTestSession(t, s, worker)
			before := instructionDiskSnapshot(t, s)
			for i := 0; i < 2; i++ {
				reply, err := s.inspectConductorChild(p, d)
				if err != nil {
					t.Fatal(err)
				}
				progress := reply["progress"].(conductorRunProgress)
				wantLive := name == "live" || name == "starting"
				if progress.Available != wantLive {
					t.Fatalf("available=%v for %s", progress.Available, name)
				}
				wantReason := map[string]string{
					"live": "", "starting": "no_public_steps", "queued": "waiting_to_start",
					"succeeded": "not_running", "failed": "not_running", "cancelled": "not_running",
					"missing-run": "no_active_run", "done": "no_active_run", "canceled": "no_active_run",
					"different-parent": "worker_mismatch", "reused-dispatch": "worker_mismatch",
					"missing-start": "dispatch_boundary_unavailable", "negative-start": "dispatch_boundary_unavailable", "past-start": "dispatch_boundary_unavailable",
					"old-pending": "pending_message_unavailable", "missing-pending": "pending_message_unavailable", "non-pending": "pending_message_unavailable",
				}[name]
				if progress.Reason != wantReason || progress.Message == "" {
					t.Fatalf("missing progress explanation for %s: %+v", name, progress)
				}
				if !wantLive && (len(progress.RecentSteps) > 0 || progress.UpdateAgeMS != nil) {
					t.Fatalf("leaked unrelated history/freshness: %+v", progress)
				}
				if !wantLive && (progress.LatestOutput != "" || progress.ToolName != "") {
					t.Fatalf("leaked unrelated run: %+v", progress)
				}
				if name == "starting" && progress.Phase != "starting" {
					t.Fatalf("starting phase: %+v", progress)
				}
				if reply["status"] != parent.ConductorChildren[0].Status {
					t.Fatalf("wrong lifecycle status: %v", reply)
				}
			}
			if _, err := s.inspectConductorChild(p, "other-dispatch"); err == nil {
				t.Fatal("foreign dispatch accepted")
			}
			if _, err := s.inspectConductorChild(w, d); err == nil {
				t.Fatal("worker accepted as parent")
			}
			if !reflect.DeepEqual(before, instructionDiskSnapshot(t, s)) {
				t.Fatal("read query changed persistent state")
			}
		})
	}
}

func TestConductorInspectBoundedPublicTelemetry(t *testing.T) {
	run := &chatRun{}
	text := strings.Repeat("\u4e2d\U0001f642", 1000) + string([]byte{0xff})
	turn, _ := json.Marshal(map[string]interface{}{"type": "turn", "summary": text, "content": text, "thinking": "PRIVATE", "tool_calls": []string{"PRIVATE"}})
	run.updateConductorProgress(turn)
	p := run.ConductorProgress
	if p.Step != 1 || p.Phase != "model" || !utf8.ValidString(p.LatestSummary) || !utf8.ValidString(p.LatestOutput) || len(p.LatestSummary) > 256 || len(p.LatestOutput) > 512 {
		t.Fatalf("invalid bounded progress: %+v", p)
	}
	run.updateConductorProgress([]byte(`{"type":"delta","delta":"PRIVATE"}`))
	run.updateConductorProgress([]byte(`{"type":"tool_result","content":"PRIVATE"}`))
	run.updateConductorProgress([]byte(`{broken`))
	if !reflect.DeepEqual(p, run.ConductorProgress) {
		t.Fatal("raw stream/result altered public snapshot")
	}
	run.updateConductorProgress([]byte(`{"type":"tool_timing","tool_active_count":1,"tool_name":"code_run"}`))
	if run.ConductorProgress.Phase != "tool" {
		t.Fatal("missing active tool phase")
	}
	run.updateConductorProgress([]byte(`{"type":"tool_timing","tool_active_count":0,"tool_name":"stale"}`))
	if run.ConductorProgress.ToolName != "" || run.ConductorProgress.Phase != "model" {
		t.Fatal("stale tool retained after completion")
	}
	for _, tail := range []bool{false, true} {
		value := conductorProgressText(text, 17, tail)
		if !utf8.ValidString(value) || len(value) > 17 {
			t.Fatal("UTF8 cap broken")
		}
	}
}

func TestConductorInspectRejectsForeignBroker(t *testing.T) {
	s, p, _, d := instructionTestPair(t, conductorRunning)
	before := instructionDiskSnapshot(t, s)
	s.handleConductorInspectEvent(p, map[string]interface{}{"request_id": "foreign", "dispatch_id": d, "broker_dir": t.TempDir()})
	dir := chatConductorBrokerDirForSession(chatSessionDir(s.CfgStore.Snapshot()), p)
	s.handleConductorInspectEvent(p, map[string]interface{}{"request_id": "../bad", "dispatch_id": d, "broker_dir": dir})
	if !reflect.DeepEqual(before, instructionDiskSnapshot(t, s)) {
		t.Fatal("invalid transport changed disk")
	}
}

func TestConductorInspectRecentStepsBoundedAndImmutable(t *testing.T) {
	run := &chatRun{}
	var old []conductorProgressStep
	for i := 1; i <= 8; i++ {
		event, _ := json.Marshal(map[string]interface{}{"type": "turn", "summary": strings.Repeat("s", 400), "content": strings.Repeat("o", 900), "raw_delta": "RAW_SECRET", "reasoning": "PRIVATE_SECRET", "tool_result": "RESULT_SECRET"})
		run.updateConductorProgress(event)
		if i == 5 {
			old = run.ConductorProgress.RecentSteps
		}
	}
	progress := run.ConductorProgress
	if progress.Step != 8 || len(progress.RecentSteps) != conductorRecentStepLimit || progress.RecentSteps[0].Step != 4 || progress.RecentSteps[4].Step != 8 {
		t.Fatalf("unbounded or out-of-order history: %+v", progress)
	}
	if old[0].Step != 1 || old[4].Step != 5 {
		t.Fatalf("mutated old snapshot: %+v", old)
	}
	for _, step := range progress.RecentSteps {
		if len(step.Summary) > 256 || len(step.Output) > 512 || step.UpdatedAtMS <= 0 {
			t.Fatal(step)
		}
	}
	// Blank or tool-only turns still count, but must not erase the last readable step.
	run.updateConductorProgress([]byte(`{"type":"turn","summary":"  ","content":"\n "}`))
	run.updateConductorProgress([]byte(`{"type":"tool_timing","tool_phase":"start","tool_name":"code_run","tool_active_count":1,"args":"ARGS_SECRET"}`))
	if run.ConductorProgress.Step != 9 || !reflect.DeepEqual(progress.RecentSteps, run.ConductorProgress.RecentSteps) || run.ConductorProgress.LatestSummary != progress.LatestSummary || run.ConductorProgress.Phase != "tool" {
		t.Fatalf("lost readable progress: %+v", run.ConductorProgress)
	}
	encoded, _ := json.Marshal(run.ConductorProgress)
	if strings.Contains(string(encoded), "SECRET") || len(encoded) > 6500 {
		t.Fatalf("unsafe or oversized snapshot: %s", encoded)
	}
}

func TestConductorInspectReadableStepsAndFreshness(t *testing.T) {
	s, p, w, d := instructionTestPair(t, conductorRunning)
	parent, _ := loadChatSession(s.CfgStore.Snapshot(), p)
	start := 0
	parent.ConductorChildren[0].MessageStart = &start
	if err := saveChatSession(s.CfgStore.Snapshot(), parent); err != nil {
		t.Fatal(err)
	}
	worker, _ := loadChatSession(s.CfgStore.Snapshot(), w)
	worker.Messages = []chatMessage{{ID: "pending-current", Role: "assistant", Kind: "pending"}}
	if err := saveChatSession(s.CfgStore.Snapshot(), worker); err != nil {
		t.Fatal(err)
	}
	run := s.beginChatRun(w)
	defer s.endChatRunOwned(w, run)
	run.PendingAssistantID = "pending-current"
	query := func() conductorRunProgress {
		t.Helper()
		reply, err := s.inspectConductorChild(p, d)
		if err != nil {
			t.Fatal(err)
		}
		return reply["progress"].(conductorRunProgress)
	}
	before := instructionDiskSnapshot(t, s)
	first := query()
	if !first.Available || first.Reason != "no_public_steps" || first.Phase != "starting" || first.UpdateAgeMS != nil {
		t.Fatal(first)
	}
	s.ChatMu.Lock()
	run.updateConductorProgress([]byte(`{"type":"tool_timing","tool_phase":"start","tool_name":"code_run","tool_active_count":1}`))
	s.ChatMu.Unlock()
	tool := query()
	if tool.Reason != "no_public_steps" || tool.ToolName != "code_run" || !strings.Contains(tool.Message, "tool is running") {
		t.Fatal(tool)
	}
	s.ChatMu.Lock()
	run.updateConductorProgress([]byte(`{"type":"turn","summary":"Updated parser; checking tests","content":"Worker reports patch applied; validation pending"}`))
	run.ConductorProgress.UpdatedAtMS = time.Now().Add(-2 * time.Second).UnixMilli()
	s.ChatMu.Unlock()
	readable := query()
	if !readable.Available || readable.Reason != "" || len(readable.RecentSteps) != 1 || readable.RecentSteps[0].Summary != "Updated parser; checking tests" || readable.UpdateAgeMS == nil || *readable.UpdateAgeMS < 1900 || !strings.Contains(readable.Message, "not verified") {
		t.Fatalf("missing readable progress/freshness: %+v", readable)
	}
	// A caller cannot mutate a later query's history via a previously returned slice.
	readable.RecentSteps[0].Summary = "CALLER MUTATION"
	again := query()
	if again.RecentSteps[0].Summary != "Updated parser; checking tests" || !reflect.DeepEqual(before, instructionDiskSnapshot(t, s)) {
		t.Fatal("query mutated runtime or persistent state")
	}
	// The lifecycle can say running even if the corresponding worker file is unavailable.
	parent.ConductorChildren[0].SessionID = "missing-worker-progress"
	if err := saveChatSession(s.CfgStore.Snapshot(), parent); err != nil {
		t.Fatal(err)
	}
	missing := query()
	if missing.Available || missing.Reason != "worker_unavailable" || len(missing.RecentSteps) != 0 || missing.UpdateAgeMS != nil {
		t.Fatal(missing)
	}
}
