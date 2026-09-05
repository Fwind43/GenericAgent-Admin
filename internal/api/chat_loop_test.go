package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"genericagent-admin-go/internal/config"
)

func newChatLoopTestServer(t *testing.T) *Server {
	t.Helper()
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	return s
}

func saveChatLoopTestSession(t *testing.T, s *Server, cs chatSession) {
	t.Helper()
	if cs.Title == "" {
		cs.Title = "Loop test"
	}
	if cs.Messages == nil {
		cs.Messages = []chatMessage{}
	}
	if err := saveChatSessionLocked(s.CfgStore.Snapshot(), cs); err != nil {
		t.Fatalf("save chat session: %v", err)
	}
}

func blockChatLoopTestWorker(t *testing.T, s *Server, sid string) {
	t.Helper()
	old := startChatWorkerFunc
	release := make(chan struct{})
	startChatWorkerFunc = func(config.AppConfig, string) (*chatWorker, error) {
		<-release
		return nil, fmt.Errorf("test chat worker released")
	}
	t.Cleanup(func() {
		close(release)
		deadline := time.Now().Add(2 * time.Second)
		for s.chatRunActive(sid) && time.Now().Before(deadline) {
			time.Sleep(5 * time.Millisecond)
		}
		startChatWorkerFunc = old
		if s.chatRunActive(sid) {
			t.Errorf("chat run %q did not stop during test cleanup", sid)
		}
	})
}

func TestProcessNextQueuedMessageStartsAfterCompletedRun(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "queue-after-completed-run"
	saveChatLoopTestSession(t, s, chatSession{
		ID:       sid,
		Messages: []chatMessage{{ID: "assistant-old", Role: "assistant", Content: "done"}},
		QueuedMessages: []chatQueuedMessage{{
			ID: "queued-1", Text: "send me next",
		}},
	})

	completed := s.beginChatRun(sid)
	if completed == nil {
		t.Fatal("failed to create completed run fixture")
	}
	s.endChatRunOwned(sid, completed)
	if s.chatRunActive(sid) {
		t.Fatal("completed run is still active")
	}

	s.processNextQueuedMessage(sid)

	s.ChatMu.Lock()
	started := s.ChatRuns[sid]
	s.ChatMu.Unlock()
	if started == nil || started == completed {
		t.Fatalf("queued run token = %p, want a new token after completed %p", started, completed)
	}

	s.ChatMu.Lock()
	events := append([][]byte(nil), started.Events...)
	s.ChatMu.Unlock()
	if len(events) < 2 {
		t.Fatalf("queued run events = %q, want user before queue_item_start", events)
	}
	var userEvent struct {
		Type    string      `json:"type"`
		Message chatMessage `json:"message"`
	}
	if err := json.Unmarshal(events[0], &userEvent); err != nil {
		t.Fatalf("decode queued user event: %v", err)
	}
	if userEvent.Type != "user" || userEvent.Message.ID == "" || userEvent.Message.Role != "user" || userEvent.Message.Content != "send me next" {
		t.Fatalf("queued user event = %#v", userEvent)
	}
	var startEvent struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(events[1], &startEvent); err != nil || startEvent.Type != "queue_item_start" {
		t.Fatalf("event after queued user = %q, decoded=%#v err=%v", events[1], startEvent, err)
	}

	stored, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.QueuedMessages) != 0 {
		t.Fatalf("queued messages = %#v, want consumed", stored.QueuedMessages)
	}
	if len(stored.Messages) < 3 || stored.Messages[len(stored.Messages)-2].Role != "user" || stored.Messages[len(stored.Messages)-2].Content != "send me next" {
		t.Fatalf("messages = %#v, want queued user message followed by pending assistant", stored.Messages)
	}
	if stored.Messages[len(stored.Messages)-2].ID != userEvent.Message.ID {
		t.Fatalf("stream user id = %q, persisted user id = %q", userEvent.Message.ID, stored.Messages[len(stored.Messages)-2].ID)
	}
}

func TestChatGuideCancelsActiveRunAndStartsSelectedQueueItem(t *testing.T) {
	capturedReq := make(chan map[string]interface{}, 1)
	releaseWorker := make(chan struct{})
	oldStart := startChatWorkerFunc
	startChatWorkerFunc = func(config.AppConfig, string) (*chatWorker, error) {
		stdinR, stdinW := io.Pipe()
		stdoutR, stdoutW := io.Pipe()
		go func() {
			defer stdinR.Close()
			defer stdoutW.Close()
			var req map[string]interface{}
			_ = json.NewDecoder(stdinR).Decode(&req)
			capturedReq <- req
			<-releaseWorker
		}()
		return &chatWorker{SID: "guide-interrupts-active-run", Stdin: stdinW, Stdout: stdoutR}, nil
	}
	defer func() {
		close(releaseWorker)
		startChatWorkerFunc = oldStart
	}()

	s := newChatLoopTestServer(t)
	sid := "guide-interrupts-active-run"
	const pendingID = "assistant-active"
	saveChatLoopTestSession(t, s, chatSession{
		ID: sid,
		Messages: []chatMessage{
			{ID: "user-active", Role: "user", Content: "current request", CreatedAt: 1},
			{ID: pendingID, Role: "assistant", CreatedAt: 2, RunStartedAtMS: 1234},
		},
		QueuedMessages: []chatQueuedMessage{
			{ID: "queued-first", Text: "leave me queued"},
			{ID: "queued-guide", Text: "run this guidance now"},
		},
	})

	active := s.beginChatRun(sid)
	if active == nil {
		t.Fatal("failed to create active run")
	}
	s.ChatMu.Lock()
	active.PendingAssistantID = pendingID
	active.RunStartedAtMS = 1234
	s.ChatMu.Unlock()
	s.publishChatRun(sid, map[string]interface{}{"type": "delta", "delta": "partial answer"})

	rr := httptest.NewRecorder()
	s.chatGuidePost(rr, httptest.NewRequest(http.MethodPost, "/api/chat/guide/"+sid+"/queued-guide", nil), sid, "queued-guide")
	if rr.Code != http.StatusOK {
		t.Fatalf("guide status=%d body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"status":"started"`) {
		t.Fatalf("guide body=%s, want started", rr.Body.String())
	}
	if !active.Canceled {
		t.Fatal("guide did not cancel the active run")
	}

	s.ChatMu.Lock()
	started := s.ChatRuns[sid]
	s.ChatMu.Unlock()
	if started == nil || started == active {
		t.Fatalf("guide run token = %p, want replacement for %p", started, active)
	}
	defer s.endChatRunOwned(sid, started)

	stored, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.QueuedMessages) != 1 || stored.QueuedMessages[0].ID != "queued-first" {
		t.Fatalf("queued messages = %#v, want untouched first item", stored.QueuedMessages)
	}
	if len(stored.Messages) < 4 {
		t.Fatalf("messages = %#v, want canceled output and guided turn", stored.Messages)
	}
	if got := stored.Messages[len(stored.Messages)-2]; got.Role != "user" || got.Content != "run this guidance now" {
		t.Fatalf("guided user message = %#v", got)
	}
	var canceled chatMessage
	for _, msg := range stored.Messages {
		if msg.ID == pendingID {
			canceled = msg
			break
		}
	}
	if canceled.Content != "partial answer\n\n[\u7528\u6237\u624b\u52a8\u4e2d\u6b62\u751f\u6210]" || !canceled.Error {
		t.Fatalf("canceled partial message = %#v", canceled)
	}

	select {
	case req := <-capturedReq:
		if req["prompt"] != "run this guidance now" {
			t.Fatalf("worker prompt = %#v", req["prompt"])
		}
		history, ok := req["history"].([]interface{})
		if !ok || len(history) != 2 {
			t.Fatalf("worker history = %#v, want interrupted user/assistant pair only", req["history"])
		}
		first, _ := history[0].(map[string]interface{})
		second, _ := history[1].(map[string]interface{})
		if first["content"] != "current request" || second["content"] != "partial answer\n\n[\u7528\u6237\u624b\u52a8\u4e2d\u6b62\u751f\u6210]" {
			t.Fatalf("worker history lost interrupted turn: %#v", history)
		}
		rawHistory, ok := req["raw_history"].([]interface{})
		if !ok || len(rawHistory) != 2 {
			t.Fatalf("worker raw_history = %#v, want interrupted raw turn", req["raw_history"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for guided worker request")
	}
}

func TestParseChatLoopNextPromptUsesLastCompleteTag(t *testing.T) {
	content := "analysis <next_prompt>first</next_prompt> tail <next_prompt>  final action  </next_prompt>"
	if got := parseChatLoopNextPrompt(content); got != "final action" {
		t.Fatalf("parseChatLoopNextPrompt() = %q, want final action", got)
	}
	if got := parseChatLoopNextPrompt("<next_prompt>unfinished"); got != "" {
		t.Fatalf("parseChatLoopNextPrompt(incomplete) = %q, want empty", got)
	}
}

func TestParseChatLoopNextPromptDoesNotIncludeEchoedTemplateTail(t *testing.T) {
	content := `<next_prompt>...</next_prompt> block or do not emit a <next_prompt> tag.
- Keep the next prompt self-contained and focused on the highest-value next action.

<summary>尚未查看桌面，需要主代理执行检查。</summary>
<next_prompt>请检查当前桌面内容，并简要列出可见的文件、文件夹或窗口。</next_prompt>`
	want := "请检查当前桌面内容，并简要列出可见的文件、文件夹或窗口。"
	if got := parseChatLoopNextPrompt(content); got != want {
		t.Fatalf("parseChatLoopNextPrompt(echoed template) = %q, want %q", got, want)
	}
}

func TestParseChatLoopDecisionUsesOptionalNextPrompt(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    chatLoopDecision
		wantErr bool
	}{
		{
			name:    "actionable guidance",
			content: "<next_prompt>inspect the desktop and verify the release</next_prompt>",
			want:    chatLoopDecision{Prompt: "inspect the desktop and verify the release"},
		},
		{
			name:    "no guidance completes",
			content: "The objective is complete; no further action is needed.",
			want:    chatLoopDecision{Complete: true, NoAction: true},
		},
		{
			name:    "placeholder guidance retries",
			content: "<next_prompt>continue</next_prompt>",
			wantErr: true,
		},
		{
			name:    "malformed guidance retries",
			content: "<next_prompt>inspect the desktop",
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseChatLoopDecision(tt.content)
			if (err != nil) != tt.wantErr {
				t.Fatalf("parseChatLoopDecision() error = %v, wantErr %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("parseChatLoopDecision() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestNormalizePersistedChatLoopPausesActiveState(t *testing.T) {
	state := chatLoopState{
		Enabled:          true,
		Status:           chatLoopStatusEvaluating,
		Epoch:            7,
		Round:            3,
		ControllerPrompt: "ship it",
	}
	got, changed := normalizePersistedChatLoop(state)
	if !changed {
		t.Fatal("normalizePersistedChatLoop() did not report a change")
	}
	if got.Enabled || got.Status != chatLoopStatusPaused || got.StopReason != "server_restart" {
		t.Fatalf("normalized state = %#v, want disabled paused/server_restart", got)
	}
	if got.Epoch != 8 || got.Round != 3 || got.ControllerPrompt != state.ControllerPrompt {
		t.Fatalf("normalized state lost progress: %#v", got)
	}

	inactive := chatLoopState{Status: chatLoopStatusCompleted, Epoch: 4}
	if same, changed := normalizePersistedChatLoop(inactive); changed || !reflect.DeepEqual(same, inactive) {
		t.Fatalf("inactive state changed: got %#v changed=%v", same, changed)
	}
}

func TestChatLoopStartAndStopAPI(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "loop-start-stop"
	saveChatLoopTestSession(t, s, chatSession{ID: sid})

	type firstRoundCall struct {
		sid    string
		epoch  int64
		prompt string
	}
	calls := make(chan firstRoundCall, 1)
	oldContinue := continueChatLoopFunc
	defer func() { continueChatLoopFunc = oldContinue }()
	continueChatLoopFunc = func(_ *Server, gotSID string, epoch int64, prompt string) {
		calls <- firstRoundCall{sid: gotSID, epoch: epoch, prompt: prompt}
	}

	start := httptest.NewRecorder()
	startReq := httptest.NewRequest(http.MethodPost, "/api/chat/loop/"+sid+"/start", bytes.NewBufferString(`{"objective":"Finish the release","max_rounds":999}`))
	startReq.Header.Set("Content-Type", "application/json")
	s.chatHandler(start, startReq)
	if start.Code != http.StatusOK {
		t.Fatalf("start status = %d: %s", start.Code, start.Body.String())
	}
	var startPayload struct {
		Loop chatLoopState `json:"loop"`
	}
	if err := json.Unmarshal(start.Body.Bytes(), &startPayload); err != nil {
		t.Fatal(err)
	}
	if !startPayload.Loop.Enabled || startPayload.Loop.Status != chatLoopStatusEvaluating {
		t.Fatalf("start loop = %#v", startPayload.Loop)
	}
	if startPayload.Loop.ControllerPrompt != "Finish the release" || startPayload.Loop.Epoch != 1 {
		t.Fatalf("start loop metadata = %#v", startPayload.Loop)
	}
	select {
	case call := <-calls:
		if call.sid != sid || call.epoch != 1 || call.prompt != "Finish the release" {
			t.Fatalf("first round call = %#v", call)
		}
	case <-time.After(time.Second):
		t.Fatal("empty chat loop did not schedule its first worker round")
	}

	stop := httptest.NewRecorder()
	s.chatHandler(stop, httptest.NewRequest(http.MethodPost, "/api/chat/loop/"+sid+"/stop", nil))
	if stop.Code != http.StatusOK {
		t.Fatalf("stop status = %d: %s", stop.Code, stop.Body.String())
	}
	persisted, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Loop.Enabled || persisted.Loop.Status != chatLoopStatusStopped || persisted.Loop.StopReason != "user" {
		t.Fatalf("persisted stopped loop = %#v", persisted.Loop)
	}
	if persisted.Loop.Epoch != 2 {
		t.Fatalf("stopped epoch = %d, want 2", persisted.Loop.Epoch)
	}
}

func TestChatLoopBlockingControllerHelper(t *testing.T) {
	if os.Getenv("GA_CHAT_LOOP_BLOCKING_CONTROLLER") != "1" {
		return
	}
	for {
		time.Sleep(time.Hour)
	}
}

func TestChatLoopStopKillsActiveController(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "loop-stop-controller"
	saveChatLoopTestSession(t, s, chatSession{
		ID: sid,
		Loop: chatLoopState{
			Enabled: true,
			Status:  chatLoopStatusEvaluating,
			Epoch:   7,
		},
	})

	started := make(chan struct{}, 1)
	finished := make(chan error, 1)
	oldRun := runOneShotBTWWorkerFunc
	defer func() { runOneShotBTWWorkerFunc = oldRun }()
	runOneShotBTWWorkerFunc = func(_ config.AppConfig, workerSID string, req map[string]interface{}) (chatMessage, error) {
		observer, ok := req[oneShotBTWWorkerObserverKey].(*oneShotBTWWorkerObserver)
		if !ok || observer == nil {
			return chatMessage{}, fmt.Errorf("missing loop controller observer")
		}
		cmd := exec.Command(os.Args[0], "-test.run=^TestChatLoopBlockingControllerHelper$")
		cmd.Env = append(os.Environ(), "GA_CHAT_LOOP_BLOCKING_CONTROLLER=1")
		if err := cmd.Start(); err != nil {
			return chatMessage{}, err
		}
		worker := &chatWorker{SID: workerSID, Cmd: cmd}
		if observer.Started == nil || !observer.Started(worker) {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			return chatMessage{}, errChatLoopStale
		}
		started <- struct{}{}
		err := cmd.Wait()
		if observer.Finished != nil {
			observer.Finished(worker)
		}
		return chatMessage{}, err
	}

	go func() {
		_, err := s.runChatLoopController(sid, 7, map[string]interface{}{"prompt": "decide next"})
		finished <- err
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("loop controller did not start")
	}

	stop := httptest.NewRecorder()
	s.chatHandler(stop, httptest.NewRequest(http.MethodPost, "/api/chat/loop/"+sid+"/stop", nil))
	if stop.Code != http.StatusOK {
		t.Fatalf("stop status = %d: %s", stop.Code, stop.Body.String())
	}
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("controller returned nil after Stop; want killed process error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Stop did not kill the active loop controller")
	}

	s.ChatMu.Lock()
	controller := s.ChatLoopControllers[sid]
	s.ChatMu.Unlock()
	if controller != nil {
		t.Fatalf("controller ownership leaked after Stop: %#v", controller)
	}
	persisted, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Loop.Enabled || persisted.Loop.Status != chatLoopStatusStopped || persisted.Loop.StopReason != "user" || persisted.Loop.Epoch != 8 {
		t.Fatalf("persisted stopped loop = %#v", persisted.Loop)
	}
}

func TestChatLoopRestartKillsActiveController(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "loop-restart-controller"
	saveChatLoopTestSession(t, s, chatSession{
		ID: sid,
		Loop: chatLoopState{
			Enabled: true,
			Status:  chatLoopStatusEvaluating,
			Epoch:   7,
		},
	})

	started := make(chan struct{}, 1)
	finished := make(chan error, 1)
	oldRun := runOneShotBTWWorkerFunc
	defer func() { runOneShotBTWWorkerFunc = oldRun }()
	runOneShotBTWWorkerFunc = func(_ config.AppConfig, workerSID string, req map[string]interface{}) (chatMessage, error) {
		observer, ok := req[oneShotBTWWorkerObserverKey].(*oneShotBTWWorkerObserver)
		if !ok || observer == nil {
			return chatMessage{}, fmt.Errorf("missing loop controller observer")
		}
		cmd := exec.Command(os.Args[0], "-test.run=^TestChatLoopBlockingControllerHelper$")
		cmd.Env = append(os.Environ(), "GA_CHAT_LOOP_BLOCKING_CONTROLLER=1")
		if err := cmd.Start(); err != nil {
			return chatMessage{}, err
		}
		worker := &chatWorker{SID: workerSID, Cmd: cmd}
		if observer.Started == nil || !observer.Started(worker) {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			return chatMessage{}, errChatLoopStale
		}
		started <- struct{}{}
		err := cmd.Wait()
		if observer.Finished != nil {
			observer.Finished(worker)
		}
		return chatMessage{}, err
	}

	go func() {
		_, err := s.runChatLoopController(sid, 7, map[string]interface{}{"prompt": "old decision"})
		finished <- err
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("old loop controller did not start")
	}

	oldContinue := continueChatLoopFunc
	defer func() { continueChatLoopFunc = oldContinue }()
	continueChatLoopFunc = func(_ *Server, _ string, _ int64, _ string) {}
	restart := httptest.NewRecorder()
	restartReq := httptest.NewRequest(http.MethodPost, "/api/chat/loop/"+sid+"/start", bytes.NewBufferString(`{"objective":"replacement objective"}`))
	restartReq.Header.Set("Content-Type", "application/json")
	s.chatHandler(restart, restartReq)
	if restart.Code != http.StatusOK {
		s.cancelChatLoopController(sid, 7)
		<-finished
		t.Fatalf("restart status = %d: %s", restart.Code, restart.Body.String())
	}
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("old controller returned nil after restart; want killed process error")
		}
	case <-time.After(2 * time.Second):
		s.cancelChatLoopController(sid, 7)
		<-finished
		t.Fatal("restarting the loop did not kill the old controller")
	}

	persisted, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if !persisted.Loop.Enabled || persisted.Loop.Status != chatLoopStatusEvaluating || persisted.Loop.Epoch != 8 || persisted.Loop.ControllerPrompt != "replacement objective" {
		t.Fatalf("persisted restarted loop = %#v", persisted.Loop)
	}
}

func TestChatLoopStateAppearsInSessionAPIs(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "loop-projection"
	want := chatLoopState{
		Enabled:          true,
		Status:           chatLoopStatusRunning,
		Epoch:            6,
		Round:            2,
		ControllerPrompt: "complete rollout",
	}
	saveChatLoopTestSession(t, s, chatSession{ID: sid, UpdatedAt: 42, Loop: want})

	stateRec := httptest.NewRecorder()
	s.chatState(stateRec, httptest.NewRequest(http.MethodGet, "/api/chat/state/"+sid, nil), sid)
	if stateRec.Code != http.StatusOK {
		t.Fatalf("state status = %d: %s", stateRec.Code, stateRec.Body.String())
	}
	var statePayload struct {
		Loop chatLoopState `json:"loop"`
	}
	if err := json.Unmarshal(stateRec.Body.Bytes(), &statePayload); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(statePayload.Loop, want) {
		t.Fatalf("state loop = %#v, want %#v", statePayload.Loop, want)
	}

	listRec := httptest.NewRecorder()
	s.chatSessions(listRec, httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil))
	if listRec.Code != http.StatusOK {
		t.Fatalf("sessions status = %d: %s", listRec.Code, listRec.Body.String())
	}
	var listPayload struct {
		Sessions []struct {
			ID   string        `json:"id"`
			Loop chatLoopState `json:"loop"`
		} `json:"sessions"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listPayload); err != nil {
		t.Fatal(err)
	}
	if len(listPayload.Sessions) != 1 || listPayload.Sessions[0].ID != sid || !reflect.DeepEqual(listPayload.Sessions[0].Loop, want) {
		t.Fatalf("sessions payload = %#v", listPayload.Sessions)
	}
}

func TestChatStateShipsActiveRunIdentity(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "state-run-identity"
	token := s.beginChatRun(sid)
	if token == nil {
		t.Fatal("beginChatRun returned nil")
	}
	const pendingID = "assistant-pending"
	const startedAtMS int64 = 1787725441243
	owned, err := s.saveChatRunPending(sid, token, pendingID, startedAtMS, func() error { return nil })
	if err != nil || !owned {
		t.Fatalf("saveChatRunPending owned=%v err=%v", owned, err)
	}

	rec := httptest.NewRecorder()
	s.chatState(rec, httptest.NewRequest(http.MethodGet, "/api/chat/state/"+sid, nil), sid)
	if rec.Code != http.StatusOK {
		t.Fatalf("state status = %d: %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Running            bool   `json:"running"`
		PendingAssistantID string `json:"pending_assistant_id"`
		RunStartedAtMS     int64  `json:"run_started_at_ms"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Running || payload.PendingAssistantID != pendingID || payload.RunStartedAtMS != startedAtMS {
		t.Fatalf("state run identity = %#v", payload)
	}
}

func TestRecoverChatLoopsAfterRestartRunsOncePerRuntime(t *testing.T) {
	s := newChatLoopTestServer(t)
	firstID := "loop-recover-first"
	saveChatLoopTestSession(t, s, chatSession{ID: firstID, Loop: chatLoopState{
		Enabled: true, Status: chatLoopStatusRunning, Epoch: 2, Round: 1,
	}})

	if err := s.recoverChatLoopsAfterRestart(); err != nil {
		t.Fatal(err)
	}
	first, err := loadChatSession(s.CfgStore.Snapshot(), firstID)
	if err != nil {
		t.Fatal(err)
	}
	if first.Loop.Enabled || first.Loop.Status != chatLoopStatusPaused || first.Loop.StopReason != "server_restart" || first.Loop.Epoch != 3 {
		t.Fatalf("recovered loop = %#v", first.Loop)
	}

	secondID := "loop-created-after-recovery"
	secondWant := chatLoopState{Enabled: true, Status: chatLoopStatusRunning, Epoch: 9}
	saveChatLoopTestSession(t, s, chatSession{ID: secondID, Loop: secondWant})
	if err := s.recoverChatLoopsAfterRestart(); err != nil {
		t.Fatal(err)
	}
	second, err := loadChatSession(s.CfgStore.Snapshot(), secondID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(second.Loop, secondWant) {
		t.Fatalf("second recovery reran: loop = %#v, want %#v", second.Loop, secondWant)
	}
}

func TestStreamChatRunExposesRunIdentity(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "loop-stream-identity"
	s.ChatMu.Lock()
	s.ChatRuns[sid] = &chatRun{
		SID:                sid,
		Done:               true,
		PendingAssistantID: "assistant-loop-round-2",
		RunStartedAtMS:     987654321,
		Events:             [][]byte{[]byte(`{"type":"done"}`)},
	}
	s.ChatMu.Unlock()

	rec := httptest.NewRecorder()
	s.streamChatRun(rec, httptest.NewRequest(http.MethodGet, "/api/chat/stream/"+sid, nil), sid, 0)
	if got := rec.Header().Get("X-Chat-Pending-ID"); got != "assistant-loop-round-2" {
		t.Fatalf("X-Chat-Pending-ID = %q", got)
	}
	if got := rec.Header().Get("X-Chat-Run-Started-At-Ms"); got != "987654321" {
		t.Fatalf("X-Chat-Run-Started-At-Ms = %q", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-cache, no-transform" {
		t.Fatalf("Cache-Control = %q", got)
	}
	if got := rec.Header().Get("X-Accel-Buffering"); got != "no" {
		t.Fatalf("X-Accel-Buffering = %q", got)
	}
	if got := rec.Body.String(); got != "{\"type\":\"done\"}\n" {
		t.Fatalf("stream body = %q", got)
	}
}

func TestLateTerminalSavePreservesLatestChatLoopState(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "loop-late-terminal"
	oldSnapshot := chatSession{
		ID:       sid,
		Title:    "Loop",
		Messages: []chatMessage{{ID: "assistant-old", Role: "assistant", Content: "done"}},
		Loop:     chatLoopState{Enabled: true, Status: chatLoopStatusRunning, Epoch: 3, Round: 1},
	}
	latestLoop := chatLoopState{Enabled: false, Status: chatLoopStatusStopped, Epoch: 4, Round: 1, StopReason: "user_stopped"}
	latest := oldSnapshot
	latest.Loop = latestLoop
	saveChatLoopTestSession(t, s, latest)

	if err := s.saveChatSessionMerged(oldSnapshot); err != nil {
		t.Fatal(err)
	}
	persisted, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(persisted.Loop, latestLoop) {
		t.Fatalf("late terminal save regressed loop = %#v, want %#v", persisted.Loop, latestLoop)
	}
}

func TestAppendChatLoopRecordBoundsHistoryAndUnicode(t *testing.T) {
	state := chatLoopState{}
	longSummary := strings.Repeat("界", maxChatLoopRecordTextRunes+9)
	for i := 0; i < maxChatLoopRecords+5; i++ {
		state.Round = i
		appendChatLoopRecord(&state, "checking", longSummary, "next")
	}
	if len(state.Records) != maxChatLoopRecords {
		t.Fatalf("records length = %d, want %d", len(state.Records), maxChatLoopRecords)
	}
	if state.Records[0].Round != 5 || state.Records[len(state.Records)-1].Round != maxChatLoopRecords+4 {
		t.Fatalf("bounded records kept wrong rounds: first=%d last=%d", state.Records[0].Round, state.Records[len(state.Records)-1].Round)
	}
	wantSummary := strings.Repeat("界", maxChatLoopRecordTextRunes) + "..."
	if got := state.Records[0].Summary; got != wantSummary {
		t.Fatalf("bounded Unicode summary = %q, want %q", got, wantSummary)
	}
	if got := len([]rune(state.Records[0].Summary)); got != maxChatLoopRecordTextRunes+3 {
		t.Fatalf("bounded Unicode summary rune count = %d", got)
	}

	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(encoded, []byte(`"records"`)) {
		t.Fatalf("serialized loop omitted records: %s", encoded)
	}
}

func TestEvaluateChatLoopRetriesUnusableControllerReply(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "loop-controller-retry"
	blockChatLoopTestWorker(t, s, sid)
	const unusableReply = "<next_prompt>continue</next_prompt>"
	const nextPrompt = "verify the shipped release"
	cs := chatSession{ID: sid, Loop: chatLoopState{
		Enabled:          true,
		Status:           chatLoopStatusEvaluating,
		Epoch:            3,
		Round:            1,
		ControllerPrompt: "ship the release",
	}}
	saveChatLoopTestSession(t, s, cs)

	old := runOneShotBTWWorkerFunc
	defer func() { runOneShotBTWWorkerFunc = old }()
	var prompts []string
	runOneShotBTWWorkerFunc = func(_ config.AppConfig, _ string, req map[string]interface{}) (chatMessage, error) {
		prompt, _ := req["prompt"].(string)
		prompts = append(prompts, prompt)
		if len(prompts) == 1 {
			return chatMessage{Content: unusableReply}, nil
		}
		return chatMessage{Content: "<next_prompt>" + nextPrompt + "</next_prompt>"}, nil
	}

	s.evaluateChatLoop(sid, 3, cs)

	if len(prompts) != 2 {
		t.Fatalf("controller calls = %d, want 2", len(prompts))
	}
	if strings.Contains(prompts[0], "previous reply was rejected") {
		t.Fatalf("first attempt already carried the corrective instruction: %q", prompts[0])
	}
	if !strings.Contains(prompts[1], "previous reply contained an empty, placeholder, or malformed next_prompt") {
		t.Fatalf("retry attempt lost the corrective instruction: %q", prompts[1])
	}
	persisted, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if !persisted.Loop.Enabled || persisted.Loop.Status != chatLoopStatusRunning || persisted.Loop.StopReason != "" || persisted.Loop.Round != 2 {
		t.Fatalf("loop after successful retry = %#v", persisted.Loop)
	}
	if len(persisted.Messages) < 2 || persisted.Messages[len(persisted.Messages)-2].Content != nextPrompt {
		t.Fatalf("queued messages after successful retry = %#v", persisted.Messages)
	}
	retries := 0
	for _, record := range persisted.Loop.Records {
		if record.Phase == "retry" {
			retries++
			if record.Summary != "Controller reply was unusable; asking once more." || record.Prompt != "" {
				t.Fatalf("retry record = %#v", record)
			}
		}
	}
	if retries != 1 {
		t.Fatalf("retry records = %d, want 1: %#v", retries, persisted.Loop.Records)
	}
	recordsJSON, err := json.Marshal(persisted.Loop.Records)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(recordsJSON, []byte(unusableReply)) {
		t.Fatalf("controller output leaked into observer records: %s", recordsJSON)
	}
}

func TestEvaluateChatLoopFailsAfterRetryBudget(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "loop-controller-retry-budget"
	cs := chatSession{ID: sid, Loop: chatLoopState{
		Enabled:          true,
		Status:           chatLoopStatusEvaluating,
		Epoch:            2,
		ControllerPrompt: "ship the release",
	}}
	saveChatLoopTestSession(t, s, cs)

	old := runOneShotBTWWorkerFunc
	defer func() { runOneShotBTWWorkerFunc = old }()
	calls := 0
	runOneShotBTWWorkerFunc = func(config.AppConfig, string, map[string]interface{}) (chatMessage, error) {
		calls++
		return chatMessage{Content: "<next_prompt>continue</next_prompt>"}, nil
	}

	s.evaluateChatLoop(sid, 2, cs)

	if calls != chatLoopControllerAttempts {
		t.Fatalf("controller calls = %d, want %d", calls, chatLoopControllerAttempts)
	}
	persisted, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Loop.Enabled || persisted.Loop.Status != chatLoopStatusError {
		t.Fatalf("loop after exhausted retries = %#v", persisted.Loop)
	}
	if !strings.HasPrefix(persisted.Loop.StopReason, "controller_protocol_error") {
		t.Fatalf("stop reason = %q", persisted.Loop.StopReason)
	}
}

func TestContinueChatLoopQueuesControllerGuidance(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "loop-repeated-continue"
	blockChatLoopTestWorker(t, s, sid)
	saveChatLoopTestSession(t, s, chatSession{ID: sid, Loop: chatLoopState{
		Enabled:          true,
		Status:           chatLoopStatusEvaluating,
		Epoch:            5,
		Round:            2,
		ControllerPrompt: "make the suite green",
	}})

	const nextPrompt = "run the release verification suite and inspect failures"
	s.continueChatLoop(sid, 5, nextPrompt)

	persisted, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if !persisted.Loop.Enabled || persisted.Loop.Status != chatLoopStatusRunning || persisted.Loop.StopReason != "" {
		t.Fatalf("continued loop = %#v", persisted.Loop)
	}
	if persisted.Loop.Round != 3 {
		t.Fatalf("continued loop round = %d, want 3", persisted.Loop.Round)
	}
	if len(persisted.Messages) < 2 || persisted.Messages[len(persisted.Messages)-2].Content != nextPrompt {
		t.Fatalf("continued loop messages = %#v", persisted.Messages)
	}
	last := persisted.Loop.Records[len(persisted.Loop.Records)-1]
	if last.Phase != "continue" || last.Prompt != nextPrompt {
		t.Fatalf("continue record = %#v", last)
	}
}

func TestFinishChatLoopRecordDoesNotExposeControllerOutput(t *testing.T) {
	s := newChatLoopTestServer(t)
	sid := "loop-record-redaction"
	const secretControllerOutput = "RAW_CONTROLLER_OUTPUT_MUST_NOT_REACH_RECORDS"
	saveChatLoopTestSession(t, s, chatSession{
		ID:       sid,
		Messages: []chatMessage{},
		Loop: chatLoopState{
			Enabled: true,
			Status:  chatLoopStatusEvaluating,
			Epoch:   7,
		},
	})

	// The terminal helper receives diagnostic reasons, but the user-facing
	// observer record must remain a fixed verdict summary rather than exposing
	// controller output or hidden reasoning.
	s.finishChatLoop(sid, 7, chatLoopStatusError, "controller_error: "+secretControllerOutput)
	persisted, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if len(persisted.Loop.Records) != 1 {
		t.Fatalf("terminal records = %#v", persisted.Loop.Records)
	}
	record := persisted.Loop.Records[0]
	if record.Phase != "error" || record.Summary != "Controller evaluation failed." || record.Prompt != "" {
		t.Fatalf("terminal record = %#v", record)
	}
	recordsJSON, err := json.Marshal(persisted.Loop.Records)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(recordsJSON, []byte(secretControllerOutput)) {
		t.Fatalf("controller output leaked into observer records: %s", recordsJSON)
	}
}
