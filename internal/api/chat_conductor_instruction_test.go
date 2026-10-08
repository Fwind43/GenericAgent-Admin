package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func instructionTestPair(t *testing.T, status string) (*Server, string, string, string) {
	t.Helper()
	s := newChatLoopTestServer(t)
	p, w, d := "instruction-parent", "instruction-worker", "instruction-dispatch"
	saveChatLoopTestSession(t, s, chatSession{ID: p, Conductor: &chatConductorState{Role: conductorRoleParent}, ConductorChildren: []chatConductorChild{{DispatchID: d, SessionID: w, Objective: "original", Status: status}}})
	saveChatLoopTestSession(t, s, chatSession{ID: w, Conductor: &chatConductorState{Role: conductorRoleWorker, ParentSessionID: p, DispatchID: d, Status: status}})
	return s, p, w, d
}

func instructionDiskSnapshot(t *testing.T, s *Server) map[string]string {
	t.Helper()
	result := map[string]string{}
	err := filepath.WalkDir(chatSessionDir(s.CfgStore.Snapshot()), func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		result[path] = string(data)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestConductorInstructionFIFOAndDurableIdempotency(t *testing.T) {
	s, p, w, d := instructionTestPair(t, conductorRunning)
	for _, id := range []string{"one", "two"} {
		row, err := s.instructConductorChild(p, d, id, "guidance "+id)
		if err != nil || row.Status != "queued" {
			t.Fatalf("enqueue: %+v %v", row, err)
		}
	}
	before := instructionDiskSnapshot(t, s)
	if _, err := s.instructConductorChild(p, d, "one", "guidance one"); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, instructionDiskSnapshot(t, s)) {
		t.Fatal("retry changed persisted bytes")
	}
	if _, err := s.instructConductorChild(p, d, "one", "different"); err == nil {
		t.Fatal("conflicting id accepted")
	}
	reply, err := s.checkConductorInstructions(w, d, true)
	if err != nil || reply["closed"] != false {
		t.Fatalf("pending must prevent closure: %v %v", reply, err)
	}
	rows := reply["instructions"].([]conductorInstruction)
	if len(rows) != 2 || rows[0].ID != "one" || rows[1].ID != "two" {
		t.Fatalf("FIFO: %+v", rows)
	}
	if err := s.acknowledgeConductorInstructions(w, d, []string{"one", "unknown"}); err == nil {
		t.Fatal("unknown acknowledgment accepted")
	}
	if !reflect.DeepEqual(before, instructionDiskSnapshot(t, s)) {
		t.Fatal("partial invalid acknowledgment persisted")
	}
	if err := s.acknowledgeConductorInstructions(w, d, []string{"one", "two"}); err != nil {
		t.Fatal(err)
	}
	before = instructionDiskSnapshot(t, s)
	if err := s.acknowledgeConductorInstructions(w, d, []string{"one", "two"}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, instructionDiskSnapshot(t, s)) {
		t.Fatal("duplicate acknowledgment changed disk")
	}
	parent, err := loadChatSession(s.CfgStore.Snapshot(), p)
	if err != nil {
		t.Fatal(err)
	}
	child := parent.ConductorChildren[0]
	if child.Status != conductorRunning || child.Review != nil || len(parent.ConductorChildren) != 1 {
		t.Fatal("instruction changed dispatch/review")
	}
	for _, row := range child.Instructions {
		if row.Status != "delivered" || row.DeliveredAt == 0 {
			t.Fatalf("receipt: %+v", row)
		}
	}
	reply, err = s.checkConductorInstructions(w, d, true)
	if err != nil || reply["closed"] != true {
		t.Fatalf("close: %v %v", reply, err)
	}
	before = instructionDiskSnapshot(t, s)
	if _, err = s.checkConductorInstructions(w, d, true); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, instructionDiskSnapshot(t, s)) {
		t.Fatal("repeat seal changed disk")
	}
	if _, err = s.instructConductorChild(p, d, "late", "late correction"); err == nil {
		t.Fatal("sealed dispatch admitted input")
	}
}

func TestConductorInstructionTerminalRace(t *testing.T) {
	for n := 0; n < 20; n++ {
		s, p, w, d := instructionTestPair(t, conductorRunning)
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		var enqueueErr, checkErr error
		var reply map[string]interface{}
		go func() {
			defer wg.Done()
			<-start
			_, enqueueErr = s.instructConductorChild(p, d, "race", "new guidance")
		}()
		go func() { defer wg.Done(); <-start; reply, checkErr = s.checkConductorInstructions(w, d, true) }()
		close(start)
		wg.Wait()
		if checkErr != nil {
			t.Fatal(checkErr)
		}
		rows := reply["instructions"].([]conductorInstruction)
		if enqueueErr == nil {
			if reply["closed"] != false || len(rows) != 1 {
				t.Fatalf("admitted input lost: %+v", reply)
			}
		} else if reply["closed"] != true || len(rows) != 0 {
			t.Fatalf("rejected input not sealed: %+v", reply)
		}
	}
}

func TestConductorInstructionOwnershipLimitsAndWorkerConfig(t *testing.T) {
	s, p, w, d := instructionTestPair(t, conductorQueued)
	if _, err := s.instructConductorChild(p, d, "queued", "queued correction"); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"", "  ", strings.Repeat("x", 4097)} {
		if _, err := s.instructConductorChild(p, d, "invalid", text); err == nil {
			t.Fatal("invalid input admitted")
		}
	}
	if _, err := s.instructConductorChild(w, d, "wrong-parent", "input"); err == nil {
		t.Fatal("worker admitted parent tool")
	}
	if _, err := s.instructConductorChild(p, "foreign-dispatch", "foreign", "input"); err == nil {
		t.Fatal("foreign dispatch admitted")
	}
	if _, err := s.checkConductorInstructions(w, "stale-dispatch", false); err == nil {
		t.Fatal("stale check accepted")
	}
	for n := 1; n < 32; n++ {
		id := strings.Repeat("x", n)
		if _, err := s.instructConductorChild(p, d, id, "input"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.instructConductorChild(p, d, "overflow", "input"); err == nil {
		t.Fatal("limit not enforced")
	}
	worker, err := loadChatSession(s.CfgStore.Snapshot(), w)
	if err != nil {
		t.Fatal(err)
	}
	worker.Conductor.Status = conductorRunning
	saveChatLoopTestSession(t, s, worker)
	req := map[string]interface{}{}
	if err := s.prepareConductorWorkerRequest(worker, req); err != nil {
		t.Fatal(err)
	}
	cfg := req["conductor"].(map[string]interface{})
	if cfg["role"] != conductorRoleWorker || cfg["dispatch_id"] != d || cfg["broker_dir"] != chatConductorBrokerDirForSession(chatSessionDir(s.CfgStore.Snapshot()), p) {
		t.Fatalf("worker config: %+v", cfg)
	}
	worker.Conductor.Status = conductorSucceeded
	saveChatLoopTestSession(t, s, worker)
	if _, err := s.instructConductorChild(p, d, "terminal", "input"); err == nil {
		t.Fatal("terminal dispatch admitted input")
	}
}

func TestConductorInstructionBrokerTransport(t *testing.T) {
	s, p, w, d := instructionTestPair(t, conductorRunning)
	dir := chatConductorBrokerDirForSession(chatSessionDir(s.CfgStore.Snapshot()), p)
	event := map[string]interface{}{"type": "conductor_instruct", "request_id": "transport", "dispatch_id": d, "broker_dir": dir, "instruction": "verify current change"}
	s.handleConductorInstructionEvent(p, event)
	data, err := os.ReadFile(filepath.Join(dir, "transport.response.json"))
	if err != nil {
		t.Fatal(err)
	}
	var reply map[string]interface{}
	if err = json.Unmarshal(data, &reply); err != nil {
		t.Fatal(err)
	}
	if reply["ok"] != true || reply["dispatch_id"] != d {
		t.Fatalf("reply: %+v", reply)
	}
	s.handleConductorInstructionEvent(w, map[string]interface{}{"type": "conductor_instruction_check", "request_id": "check", "dispatch_id": d, "broker_dir": dir})
	data, err = os.ReadFile(filepath.Join(dir, "check.response.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &reply); err != nil {
		t.Fatal(err)
	}
	if reply["ok"] != true || len(reply["instructions"].([]interface{})) != 1 {
		t.Fatalf("check: %+v", reply)
	}
	before := instructionDiskSnapshot(t, s)
	event["broker_dir"] = t.TempDir()
	event["request_id"] = "foreign-dir"
	s.handleConductorInstructionEvent(p, event)
	if !reflect.DeepEqual(before, instructionDiskSnapshot(t, s)) {
		t.Fatal("foreign broker event changed session")
	}
}
