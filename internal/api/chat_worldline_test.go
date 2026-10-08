package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorldlineHandlersRejectMalformedInput(t *testing.T) {
	s := newChatCommandTestServer(t)

	stateReq := httptest.NewRequest(http.MethodGet, "/api/chat/worldline/bad%2Fsid", nil)
	stateRec := httptest.NewRecorder()
	s.chatWorldlineState(stateRec, stateReq, "bad/sid")
	if stateRec.Code != http.StatusBadRequest {
		t.Fatalf("malformed SID status = %d, want 400: %s", stateRec.Code, stateRec.Body.String())
	}

	for name, body := range map[string]string{
		"malformed_node":   `{"node_id":"../other"}`,
		"unsupported_mode": `{"node_id":"node-1","mode":"code"}`,
		"empty_mode":       `{"node_id":"node-1","mode":""}`,
		"unknown_field":    `{"node_id":"node-1","extra":true}`,
		"trailing_object":  `{"node_id":"node-1"}{}`,
	} {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/chat/worldline/sid/switch", strings.NewReader(body))
			rec := httptest.NewRecorder()
			s.chatWorldlineSwitch(rec, req, "sid")
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestPublicWorldlineContractAndVersionNavigation(t *testing.T) {
	root := "root"
	head := "b"
	parent := "root"
	aUser, aAssistant := "u-a", "a-a"
	bUser, bAssistant := "u-b", "a-b"
	resp := chatWorldlineResponse{
		Tree: chatWorldlineTree{RootID: &root, Head: &head, CurrentPath: []string{"root", "b"}, SidecarStatus: "ok", Nodes: []chatWorldlineNode{
			{ID: "root", Kind: "origin", Children: []string{"a", "b"}, Depth: 0, Ordinal: 1, Title: "same", MappingStatus: "unmapped"},
			{ID: "b", Kind: "edit", ParentID: &parent, Children: []string{}, Depth: 1, Ordinal: 3, Title: "same", CreatedAt: 22, MappingStatus: "mapped", UserMessageID: &bUser, AssistantMessageID: &bAssistant},
			{ID: "a", Kind: "edit", ParentID: &parent, Children: []string{}, Depth: 1, Ordinal: 2, Title: "same", CreatedAt: 11, MappingStatus: "mapped", UserMessageID: &aUser, AssistantMessageID: &aAssistant},
		}},
		Result: map[string]interface{}{"display_path": []interface{}{1.0}}, RawHistory: []map[string]interface{}{{"secret": true}},
		HistoryInfo: []interface{}{map[string]interface{}{"secret": true}}, Working: map[string]interface{}{"secret": true},
	}
	got := publicWorldline(resp)
	if got.SchemaVersion != 1 || got.Truncated {
		t.Fatalf("schema metadata = version %d truncated %v", got.SchemaVersion, got.Truncated)
	}
	if !got.Available || got.DegradedReason != "" || len(got.Nodes) != 3 || len(got.MessageVersions) != 2 || len(got.AssistantMessageIDs) != 2 {
		t.Fatalf("unexpected public projection: %#v", got)
	}
	if got.Nodes[1].ID != "b" || got.Nodes[1].Depth != 1 || got.Nodes[1].Ordinal != 3 || got.Nodes[1].CreatedAt != 22 {
		t.Fatalf("node metadata changed: %#v", got.Nodes[1])
	}
	if got.Nodes[0].Kind != "origin" || got.Nodes[1].Kind != "edit" {
		t.Fatalf("node kind not exposed: %#v", got.Nodes)
	}
	first, ok := got.MessageVersions["u-b"]
	if !ok {
		t.Fatalf("missing u-b version navigation: %#v", got.MessageVersions)
	}
	second, ok := got.MessageVersions["u-a"]
	if !ok {
		t.Fatalf("missing u-a version navigation: %#v", got.MessageVersions)
	}
	if got.AssistantMessageIDs["u-b"] != "a-b" || got.AssistantMessageIDs["u-a"] != "a-a" {
		t.Fatalf("assistant mapping = %#v", got.AssistantMessageIDs)
	}
	if first.NodeID != "b" || first.Index != 1 || first.Total != 2 || first.PreviousNodeID != nil || first.NextNodeID == nil || *first.NextNodeID != "a" {
		t.Fatalf("first navigation = %#v", first)
	}
	if second.NodeID != "a" || second.Index != 2 || second.Total != 2 || second.PreviousNodeID == nil || *second.PreviousNodeID != "b" || second.NextNodeID != nil {
		t.Fatalf("second navigation = %#v", second)
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	body := string(encoded)
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &shape); err != nil {
		t.Fatal(err)
	}
	expectedKeys := []string{"schema_version", "available", "degraded_reason", "root_id", "head", "current_path", "truncated", "nodes", "message_versions", "assistant_message_ids"}
	if len(shape) != len(expectedKeys) {
		t.Fatalf("public top-level shape = %v", shape)
	}
	for _, key := range expectedKeys {
		value, ok := shape[key]
		if !ok || string(value) == "null" {
			t.Fatalf("public field %q missing or null: %s", key, body)
		}
	}
	for _, forbidden := range []string{"version_groups", "raw_history", "history_info", "working", "result", "tree", "sidecar_status", "files", "ago", "rw_tag"} {
		if strings.Contains(body, `"`+forbidden+`"`) {
			t.Fatalf("public DTO leaked %q: %s", forbidden, body)
		}
	}
}

func TestWorldlineRunOwnershipIsExclusive(t *testing.T) {
	s := newChatCommandTestServer(t)
	first := s.beginChatRun("sid")
	if first == nil || !s.ownsChatRun("sid", first) {
		t.Fatal("first owner did not acquire the run")
	}
	if second := s.beginChatRun("sid"); second != nil {
		t.Fatal("second owner unexpectedly acquired an active run")
	}
	s.endChatRunOwned("sid", first)
	if s.ownsChatRun("sid", first) {
		t.Fatal("ended token still owns the run")
	}
}

func TestWorldlineWorkerHelper(t *testing.T) {
	if os.Getenv("GA_WORLDLINE_TEST_WORKER") != "1" {
		return
	}
	scanner := bufio.NewScanner(os.Stdin)
	enc := json.NewEncoder(os.Stdout)
	currentNode := "left"
	for scanner.Scan() {
		var req map[string]interface{}
		if json.Unmarshal(scanner.Bytes(), &req) != nil {
			continue
		}
		prompt, _ := req["prompt"].(string)
		if prompt != "" {
			response := map[string]interface{}{
				"type": "done",
				"message": map[string]interface{}{
					"id": "answer-" + prompt, "role": "assistant", "content": "answer " + prompt, "created_at": 20,
				},
				"raw_history":  []map[string]interface{}{{"role": "assistant", "content": "raw " + prompt}},
				"history_info": []interface{}{map[string]interface{}{"prompt": prompt}},
				"working":      map[string]interface{}{"prompt": prompt, "images": req["images"]},
			}
			if enc.Encode(response) != nil {
				return
			}
			continue
		}
		action, _ := req["action"].(string)
		node, _ := req["node_id"].(string)
		if (action == "restore_mapped" || action == "restore") && node != "" {
			currentNode = node
		}
		if node == "" {
			node = currentNode
		}
		userID, assistantID := "u-"+node, "a-"+node
		other := "right"
		if node == "right" {
			other = "left"
		}
		response := map[string]interface{}{
			"type": "worldline", "action": req["action"],
			"tree": map[string]interface{}{
				"root_id": "root", "head": node, "current_path": []string{"root", node}, "sidecar_status": "ok",
				"nodes": []map[string]interface{}{
					{"id": "root", "parent_id": nil, "children": []string{"left", "right"}, "depth": 0, "ordinal": 0, "title": "root", "created_at": 1, "ago": 0, "mapping_status": "unmapped", "user_message_id": nil, "assistant_message_id": nil},
					{"id": node, "parent_id": "root", "children": []string{}, "depth": 1, "ordinal": 0, "title": node, "created_at": 2, "ago": 7, "mapping_status": "mapped", "user_message_id": userID, "assistant_message_id": assistantID},
					{"id": other, "parent_id": "root", "children": []string{}, "depth": 1, "ordinal": 1, "title": other, "created_at": 3, "ago": 9, "mapping_status": "mapped", "user_message_id": "u-" + other, "assistant_message_id": "a-" + other},
				},
			},
			"result": map[string]interface{}{
				"display_path": []map[string]interface{}{
					{"id": userID, "role": "user", "content": "question " + node, "created_at": 10},
					{"id": assistantID, "role": "assistant", "content": "answer " + node, "created_at": 11},
				},
				"source_nodes": map[string]interface{}{"u-left": "left", "u-right": "right", "u-folded": "folded"},
			},
			"raw_history":  []map[string]interface{}{{"role": "assistant", "content": "raw " + node}},
			"history_info": []interface{}{map[string]interface{}{"branch": node}},
			"working":      map[string]interface{}{"branch": node},
		}
		if enc.Encode(response) != nil {
			return
		}
	}
	os.Exit(0)
}

func installWorldlineTestWorker(t *testing.T, s *Server, sid string) *chatWorker {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestWorldlineWorkerHelper$")
	cmd.Env = append(os.Environ(), "GA_WORLDLINE_TEST_WORKER=1")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	worker := &chatWorker{SID: sid, Cmd: cmd, Stdin: stdin, Stdout: stdout}
	s.ChatWorkers[sid] = worker
	t.Cleanup(func() {
		_ = stdin.Close()
		_ = cmd.Wait()
		if t.Failed() && stderr.Len() > 0 {
			t.Logf("worker stderr: %s", stderr.String())
		}
	})
	return worker
}

func TestWorldlineActivationCarriesPersistedSessionState(t *testing.T) {
	s := newChatCommandTestServer(t)
	const sid = "activation-payload"
	initial := chatSession{
		ID: sid, Title: sid,
		Messages: []chatMessage{
			{ID: "u-old", Role: "user", Content: "old question", CreatedAt: 1},
			{ID: "a-old", Role: "assistant", Content: "old answer", CreatedAt: 2},
		},
		RawHistory:  []map[string]interface{}{{"role": "assistant", "content": "backend"}},
		HistoryInfo: []interface{}{map[string]interface{}{"step": float64(1)}},
		Working:     map[string]interface{}{"key_info": "restored"},
		Settings:    normalizeChatSettings(chatSettings{}),
	}
	if err := saveChatSession(s.CfgStore.Snapshot(), initial); err != nil {
		t.Fatal(err)
	}
	installWorldlineTestWorker(t, s, sid)

	var activationChecked, readonlyChecked bool
	s.chatWorldlineRPCHook = func(_ string, req map[string]interface{}) error {
		if active, _ := req["activate"].(bool); active {
			messages, ok := req["history"].([]chatMessage)
			if !ok || len(messages) != 2 || messages[0].ID != "u-old" || messages[1].ID != "a-old" {
				t.Fatalf("activation history = %#v", req["history"])
			}
			raw, ok := req["raw_history"].([]map[string]interface{})
			if !ok || len(raw) != 1 || raw[0]["content"] != "backend" {
				t.Fatalf("activation raw history = %#v", req["raw_history"])
			}
			info, ok := req["history_info"].([]interface{})
			if !ok || len(info) != 1 {
				t.Fatalf("activation history info = %#v", req["history_info"])
			}
			working, ok := req["working"].(map[string]interface{})
			if !ok || working["key_info"] != "restored" {
				t.Fatalf("activation working = %#v", req["working"])
			}
			activationChecked = true
			return nil
		}
		for _, key := range []string{"history", "raw_history", "history_info", "working"} {
			if _, exists := req[key]; exists {
				t.Fatalf("read-only state unexpectedly carried %q", key)
			}
		}
		readonlyChecked = true
		return nil
	}

	if _, err := s.chatWorldlineRPC(sid, map[string]interface{}{"action": "state"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.chatWorldlineRPC(sid, map[string]interface{}{"action": "state", "activate": true}); err != nil {
		t.Fatal(err)
	}
	if !readonlyChecked || !activationChecked {
		t.Fatalf("hook coverage readonly=%v activation=%v", readonlyChecked, activationChecked)
	}
}

func TestWorldlineSwitchRoundTripPersistsAcrossServerRestart(t *testing.T) {
	s := newChatCommandTestServer(t)
	const sid = "roundtrip"
	initial := chatSession{ID: sid, Title: "roundtrip", Messages: []chatMessage{{ID: "seed", Role: "user", Content: "seed", CreatedAt: 1}}, Settings: normalizeChatSettings(chatSettings{})}
	if err := saveChatSession(s.CfgStore.Snapshot(), initial); err != nil {
		t.Fatal(err)
	}
	installWorldlineTestWorker(t, s, sid)

	switchTo := func(server *Server, node string) map[string]interface{} {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/chat/sessions/"+sid+"/worldline/switch", strings.NewReader(`{"node_id":"`+node+`"}`))
		server.chatWorldlineSwitch(rec, req, sid)
		if rec.Code != http.StatusOK {
			t.Fatalf("switch %s status=%d body=%s", node, rec.Code, rec.Body.String())
		}
		var body map[string]interface{}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body
	}
	assertDisk := func(node string) {
		t.Helper()
		got, err := loadChatSession(s.CfgStore.Snapshot(), sid)
		if err != nil {
			t.Fatal(err)
		}
		if got.WorldlineHead != node || len(got.Messages) != 2 || got.Messages[0].ID != "u-"+node || got.Messages[1].ID != "a-"+node {
			t.Fatalf("disk display state for %s = %+v", node, got)
		}
		if len(got.RawHistory) != 1 || got.RawHistory[0]["content"] != "raw "+node || len(got.HistoryInfo) != 1 || got.Working["branch"] != node {
			t.Fatalf("disk restore state for %s = raw=%+v info=%+v working=%+v", node, got.RawHistory, got.HistoryInfo, got.Working)
		}
	}

	body := switchTo(s, "right")
	assertDisk("right")
	session := body["session"].(map[string]interface{})
	if len(session["messages"].([]interface{})) != 2 {
		t.Fatalf("switch created an extra visible bubble: %+v", session["messages"])
	}

	// Recreate the server and worker while retaining only the persisted config/data roots.
	s2 := New(s.CfgStore, s.Svc, s.Models, s.Static)
	installWorldlineTestWorker(t, s2, sid)
	body = switchTo(s2, "left")
	assertDisk("left")
	worldline := body["worldline"].(map[string]interface{})
	if worldline["head"] != "left" || len(worldline) != 10 || worldline["schema_version"] != float64(1) || worldline["truncated"] != false {
		t.Fatalf("public worldline after restart = %+v", worldline)
	}
}

func TestWorldlineTerminalCommitFailuresAreObservableAndIsolated(t *testing.T) {
	t.Run("bind failure has no false done and persists degraded terminal", func(t *testing.T) {
		s := newChatCommandTestServer(t)
		const sid = "bind-failure"
		initial := chatSession{ID: sid, Title: sid, Settings: normalizeChatSettings(chatSettings{})}
		if err := saveChatSession(s.CfgStore.Snapshot(), initial); err != nil {
			t.Fatal(err)
		}
		installWorldlineTestWorker(t, s, sid)
		s.chatWorldlineRPCHook = func(_ string, req map[string]interface{}) error {
			if req["action"] == "bind" {
				return errors.New("injected bind failure")
			}
			return nil
		}

		post := func(prompt string) string {
			t.Helper()
			body, _ := json.Marshal(map[string]interface{}{"prompt": prompt, "client_user_id": "user-" + prompt})
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/chat/sessions/"+sid+"/messages", bytes.NewReader(body))
			s.chatPost(rec, req, sid)
			if rec.Code != http.StatusOK {
				t.Fatalf("post status=%d body=%s", rec.Code, rec.Body.String())
			}
			return rec.Body.String()
		}
		failed := post("first")
		if strings.Contains(failed, `"type":"done"`) || !strings.Contains(failed, `"type":"error"`) || !strings.Contains(failed, "injected bind failure") {
			t.Fatalf("bind failure terminal SSE = %s", failed)
		}
		got, err := loadChatSession(s.CfgStore.Snapshot(), sid)
		if err != nil {
			t.Fatal(err)
		}
		if len(got.Messages) != 2 || !got.Messages[1].Error || !strings.Contains(got.Messages[1].Content, "injected bind failure") {
			t.Fatalf("degraded terminal session = %+v", got.Messages)
		}

		s.chatWorldlineRPCHook = nil
		succeeded := post("second")
		if !strings.Contains(succeeded, `"type":"done"`) || strings.Contains(succeeded, `"type":"error"`) {
			t.Fatalf("success after isolated bind failure = %s", succeeded)
		}
	})

	t.Run("exact save failure has no false done and preserves prior disk state", func(t *testing.T) {
		s := newChatCommandTestServer(t)
		const sid = "exact-save-failure"
		initial := chatSession{ID: sid, Title: sid, Messages: []chatMessage{{ID: "seed", Role: "user", Content: "seed", CreatedAt: 1}}, Settings: normalizeChatSettings(chatSettings{})}
		if err := saveChatSession(s.CfgStore.Snapshot(), initial); err != nil {
			t.Fatal(err)
		}
		installWorldlineTestWorker(t, s, sid)

		switchRec := httptest.NewRecorder()
		switchReq := httptest.NewRequest(http.MethodPost, "/api/chat/sessions/"+sid+"/worldline/switch", strings.NewReader(`{"node_id":"left"}`))
		s.chatWorldlineSwitch(switchRec, switchReq, sid)
		if switchRec.Code != http.StatusOK {
			t.Fatalf("switch status=%d body=%s", switchRec.Code, switchRec.Body.String())
		}

		resend := func(prompt string) string {
			t.Helper()
			body, _ := json.Marshal(map[string]interface{}{
				"prompt": prompt, "source_user_message_id": "u-left", "client_user_id": "edited-u-left",
			})
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/chat/sessions/"+sid+"/messages", bytes.NewReader(body))
			s.chatPost(rec, req, sid)
			if rec.Code != http.StatusOK {
				t.Fatalf("resend status=%d body=%s", rec.Code, rec.Body.String())
			}
			return rec.Body.String()
		}

		exactSaveCalls := 0
		s.chatExactSaveHook = func(chatSession) error {
			exactSaveCalls++
			if exactSaveCalls == 2 {
				return errors.New("injected exact save failure")
			}
			return nil
		}
		failed := resend("edited left")
		if strings.Contains(failed, `"type":"done"`) || !strings.Contains(failed, `"type":"error"`) || !strings.Contains(failed, "injected exact save failure") {
			t.Fatalf("exact save failure terminal SSE = %s", failed)
		}
		after, err := loadChatSession(s.CfgStore.Snapshot(), sid)
		if err != nil {
			t.Fatal(err)
		}
		if len(after.Messages) != 1 || after.Messages[0].ID != "edited-u-left" || after.Messages[0].Role != "user" || after.Messages[0].Content != "edited left" {
			t.Fatalf("failed terminal save exposed a false assistant or lost pending edit: %+v", after.Messages)
		}

		s.chatExactSaveHook = nil
		switchRec = httptest.NewRecorder()
		switchReq = httptest.NewRequest(http.MethodPost, "/api/chat/sessions/"+sid+"/worldline/switch", strings.NewReader(`{"node_id":"left"}`))
		s.chatWorldlineSwitch(switchRec, switchReq, sid)
		if switchRec.Code != http.StatusOK {
			t.Fatalf("restore after failed save status=%d body=%s", switchRec.Code, switchRec.Body.String())
		}
		succeeded := resend("edited left retry")
		if !strings.Contains(succeeded, `"type":"done"`) || strings.Contains(succeeded, `"type":"error"`) {
			t.Fatalf("success after isolated exact save failure = %s", succeeded)
		}
	})
}

func TestWorldlineEditResendUsesSameSIDAndPersistsExactBranch(t *testing.T) {
	s := newChatCommandTestServer(t)
	const sid = "edit-resend"
	initial := chatSession{ID: sid, Title: "edit-resend", Messages: []chatMessage{{ID: "seed", Role: "user", Content: "seed", CreatedAt: 1}}, Settings: normalizeChatSettings(chatSettings{})}
	if err := saveChatSession(s.CfgStore.Snapshot(), initial); err != nil {
		t.Fatal(err)
	}
	installWorldlineTestWorker(t, s, sid)
	var stateActivations []bool
	s.chatWorldlineRPCHook = func(_ string, req map[string]interface{}) error {
		if req["action"] == "state" {
			active, _ := req["activate"].(bool)
			stateActivations = append(stateActivations, active)
		}
		return nil
	}

	switchBranch := func(server *Server, node string) {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/chat/sessions/"+sid+"/worldline/switch", strings.NewReader(`{"node_id":"`+node+`"}`))
		server.chatWorldlineSwitch(rec, req, sid)
		if rec.Code != http.StatusOK {
			t.Fatalf("switch %s status=%d body=%s", node, rec.Code, rec.Body.String())
		}
	}
	attachSource := func(sourceID, path string) {
		t.Helper()
		current, err := loadChatSession(s.CfgStore.Snapshot(), sid)
		if err != nil {
			t.Fatal(err)
		}
		name, mime := "report.txt", "text/plain"
		if strings.EqualFold(filepath.Ext(path), ".png") {
			name, mime = "report.png", "image/png"
		}
		found := false
		for i := range current.Messages {
			if current.Messages[i].ID != sourceID || current.Messages[i].Role != "user" {
				continue
			}
			current.Messages[i].Files = []map[string]interface{}{{
				"path": path,
				"name": name,
				"mime": mime,
			}}
			ref := "[FILE:" + path + "]"
			if mime == "image/png" {
				ref = "[image:" + path + "]"
			}
			current.Messages[i].Content += "\n\n[\u9644\u4ef6\u5df2\u4fdd\u5b58]\n" + ref
			found = true
			break
		}
		if !found {
			t.Fatalf("source message %s not found in %+v", sourceID, current.Messages)
		}
		if err := saveChatSession(s.CfgStore.Snapshot(), current); err != nil {
			t.Fatal(err)
		}
	}

	resend := func(server *Server, sourceID, prompt string) {
		t.Helper()
		body, err := json.Marshal(map[string]interface{}{
			"prompt": prompt, "source_user_message_id": sourceID, "client_user_id": "edited-" + sourceID,
		})
		if err != nil {
			t.Fatal(err)
		}
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/chat/sessions/"+sid+"/messages", bytes.NewReader(body))
		server.chatPost(rec, req, sid)
		if rec.Code != http.StatusOK {
			t.Fatalf("resend %s status=%d body=%s", sourceID, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), `"type":"done"`) {
			t.Fatalf("resend %s missing done SSE: %s", sourceID, rec.Body.String())
		}
	}
	assertExact := func(wantUserID, wantPrompt, wantPath string) {
		t.Helper()
		got, err := loadChatSession(s.CfgStore.Snapshot(), sid)
		if err != nil {
			t.Fatal(err)
		}
		name, mime, ref := "report.txt", "text/plain", "[FILE:"+wantPath+"]"
		wantImage := strings.EqualFold(filepath.Ext(wantPath), ".png")
		if wantImage {
			name, mime, ref = "report.png", "image/png", "[image:"+wantPath+"]"
		}
		display := wantPrompt + "\n\n[\u9644\u4ef6\u5df2\u4fdd\u5b58]\n" + ref
		if len(got.Messages) != 2 || got.Messages[0].ID != wantUserID || got.Messages[0].Content != display || got.Messages[1].Content != "answer "+display {
			t.Fatalf("exact branch messages = %+v, want user=%s display=%s", got.Messages, wantUserID, display)
		}
		if len(got.Messages[0].Files) != 1 || got.Messages[0].Files[0]["path"] != wantPath || got.Messages[0].Files[0]["name"] != name || got.Messages[0].Files[0]["mime"] != mime {
			t.Fatalf("exact branch attachment = %+v, want path=%s", got.Messages[0].Files, wantPath)
		}
		images, ok := got.Working["images"].([]interface{})
		if !ok || (wantImage && (len(images) != 1 || images[0] != wantPath)) || (!wantImage && len(images) != 0) {
			t.Fatalf("exact branch worker images = %#v, want image=%t path=%s", got.Working["images"], wantImage, wantPath)
		}
		if len(got.RawHistory) != 1 || got.RawHistory[0]["content"] != "raw "+display || got.Working["prompt"] != display {
			t.Fatalf("exact branch restore state = raw=%+v working=%+v, want display=%s", got.RawHistory, got.Working, display)
		}
	}

	switchBranch(s, "right")
	attachSource("u-right", "uploads/right-report.png")
	resend(s, "u-right", "edited right")
	assertExact("edited-u-right", "edited right", "uploads/right-report.png")
	if len(stateActivations) != 1 || !stateActivations[0] {
		t.Fatalf("resend state activation after first edit = %#v, want [true]", stateActivations)
	}

	switchBranch(s, "left")
	attachSource("u-left", "uploads/left-report.txt")
	resend(s, "u-left", "edited left")
	assertExact("edited-u-left", "edited left", "uploads/left-report.txt")
	if len(stateActivations) != 2 || !stateActivations[1] {
		t.Fatalf("resend state activation after second edit = %#v, want [true true]", stateActivations)
	}

	// A fresh server must observe the same exact terminal branch, with no stale sibling messages merged back in.
	s2 := New(s.CfgStore, s.Svc, s.Models, s.Static)
	got, err := loadChatSession(s2.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	reloadedDisplay := "edited left\n\n[附件已保存]\n[FILE:uploads/left-report.txt]"
	if len(got.Messages) != 2 || got.Messages[0].ID != "edited-u-left" || got.Messages[0].Content != reloadedDisplay || got.Messages[1].Content != "answer "+reloadedDisplay {
		t.Fatalf("reloaded exact branch = %+v", got.Messages)
	}
	if len(got.Messages[0].Files) != 1 || got.Messages[0].Files[0]["path"] != "uploads/left-report.txt" {
		t.Fatalf("reloaded attachment = %+v", got.Messages[0].Files)
	}
}

func TestWorldlineEditResendAcceptsFoldedSourceOnSelectedPhysicalPath(t *testing.T) {
	s := newChatCommandTestServer(t)
	const sid = "edit-resend-folded"
	initial := chatSession{
		ID: sid, Title: sid,
		Messages: []chatMessage{{ID: "u-folded", Role: "user", Content: "old prompt", CreatedAt: 1}},
		Settings: normalizeChatSettings(chatSettings{}),
	}
	if err := saveChatSession(s.CfgStore.Snapshot(), initial); err != nil {
		t.Fatal(err)
	}
	installWorldlineTestWorker(t, s, sid)
	token := s.beginChatRun(sid)
	if token == nil {
		t.Fatal("failed to acquire chat run")
	}
	defer s.endChatRunOwned(sid, token)
	if err := s.prepareChatWorldlineResend(sid, token, &initial, "u-folded"); err != nil {
		t.Fatalf("folded source rejected despite private selected-path mapping: %v", err)
	}
	if len(initial.Messages) != 0 {
		t.Fatalf("folded resend did not trim through source message: %+v", initial.Messages)
	}
	if initial.WorldlineHead != "folded" || len(initial.RawHistory) != 1 || initial.RawHistory[0]["content"] != "raw folded" {
		t.Fatalf("folded restore state = head=%q raw=%+v", initial.WorldlineHead, initial.RawHistory)
	}
}

func TestWorldlineEditResendPreservesAskUserContext(t *testing.T) {
	s := newChatCommandTestServer(t)
	const sid = "edit-resend-folded"
	ask := map[string]interface{}{"role": "assistant", "content": []interface{}{map[string]interface{}{"type": "tool_use", "id": "ask-1", "name": "ask_user", "input": map[string]interface{}{"question": "Which branch?"}}}}
	answer := map[string]interface{}{"role": "user", "content": []interface{}{map[string]interface{}{"type": "tool_result", "tool_use_id": "ask-1", "content": "left"}}}
	initial := chatSession{
		ID: sid, Title: sid,
		Messages:   []chatMessage{{ID: "u-first", Role: "user", Content: "first"}, {ID: "u-folded", Role: "user", Content: "old prompt"}},
		RawHistory: []map[string]interface{}{rawUserItem("first"), ask, answer, rawUserItem("old prompt"), rawAssistantItem("discarded")},
		Settings:   normalizeChatSettings(chatSettings{}),
	}
	if err := saveChatSession(s.CfgStore.Snapshot(), initial); err != nil {
		t.Fatal(err)
	}
	installWorldlineTestWorker(t, s, sid)
	token := s.beginChatRun(sid)
	if token == nil {
		t.Fatal("failed to acquire run")
	}
	defer s.endChatRunOwned(sid, token)
	if err := s.prepareChatWorldlineResend(sid, token, &initial, "u-folded"); err != nil {
		t.Fatal(err)
	}
	if len(initial.RawHistory) != 3 || initial.RawHistory[1]["role"] != "assistant" || initial.RawHistory[2]["role"] != "user" {
		t.Fatalf("lost ask_user context: %+v", initial.RawHistory)
	}
	data, err := json.Marshal(initial.RawHistory)
	if err != nil || !strings.Contains(string(data), "Which branch?") || !strings.Contains(string(data), "left") || strings.Contains(string(data), "discarded") {
		t.Fatalf("wrong resend tool boundary: %s err=%v", data, err)
	}
	if initial.WorldlineHead != "folded" || len(initial.Messages) != 1 {
		t.Fatalf("wrong branch: %+v", initial)
	}
}

func TestWorldlineDeleteIsNarrowAndRejectsBusySession(t *testing.T) {
	s := newChatCommandTestServer(t)
	makeArtifacts := func(sid string) (string, string) {
		t.Helper()
		session := chatSessionPath(s.CfgStore.Snapshot(), sid)
		sidecar := filepath.Join(s.CfgStore.Snapshot().GARoot, "temp", "rewind_data", "ga-admin", "admin_sidecars", sid+".json")
		for _, p := range []string{session, sidecar} {
			if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(p, []byte(`{}`), 0644); err != nil {
				t.Fatal(err)
			}
		}
		return session, sidecar
	}

	guardSession, guardSidecar := makeArtifacts("guard")
	invalidRec := httptest.NewRecorder()
	s.chatDeleteSession(invalidRec, httptest.NewRequest(http.MethodDelete, "/api/chat/sessions/bad%2Fsid", nil), "bad/sid")
	if invalidRec.Code != http.StatusBadRequest {
		t.Fatalf("malformed delete status = %d, want 400", invalidRec.Code)
	}
	for _, p := range []string{guardSession, guardSidecar} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("malformed delete changed guarded artifact: %s: %v", p, err)
		}
	}

	busySession, busySidecar := makeArtifacts("busy")
	token := s.beginChatRun("busy")
	busyRec := httptest.NewRecorder()
	s.chatDeleteSession(busyRec, httptest.NewRequest(http.MethodDelete, "/api/chat/sessions/busy", nil), "busy")
	if busyRec.Code != http.StatusConflict {
		t.Fatalf("busy delete status = %d, want 409", busyRec.Code)
	}
	for _, p := range []string{busySession, busySidecar} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("busy artifact removed: %s: %v", p, err)
		}
	}
	s.endChatRunOwned("busy", token)

	targetSession, targetSidecar := makeArtifacts("target")
	otherSession, otherSidecar := makeArtifacts("other")
	unrelated := filepath.Join(filepath.Dir(targetSidecar), "unrelated.txt")
	if err := os.WriteFile(unrelated, []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	s.chatDeleteSession(rec, httptest.NewRequest(http.MethodDelete, "/api/chat/sessions/target", nil), "target")
	if rec.Code != http.StatusOK {
		t.Fatalf("delete status = %d: %s", rec.Code, rec.Body.String())
	}
	for _, p := range []string{targetSession, targetSidecar} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatalf("target artifact still exists: %s", p)
		}
	}
	for _, p := range []string{otherSession, otherSidecar, unrelated} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("unrelated artifact changed: %s: %v", p, err)
		}
	}
}

func TestWorldlineEditResendFallsBackForLegacyUnmappedMessage(t *testing.T) {
	s := newChatCommandTestServer(t)
	const sid = "legacy-edit-resend"
	cs := chatSession{
		ID: sid,
		Messages: []chatMessage{
			{ID: "first-user", Role: "user", Content: "first question"},
			{ID: "first-assistant", Role: "assistant", Content: "first answer"},
			{ID: "legacy-user", Role: "user", Content: "legacy question"},
			{ID: "legacy-assistant", Role: "assistant", Content: "legacy answer"},
		},
		RawHistory: []map[string]interface{}{
			{"role": "user", "content": "first question"},
			{"role": "assistant", "content": "first answer"},
			{"role": "user", "content": "legacy question"},
			{"role": "assistant", "content": "legacy answer"},
		},
		HistoryInfo: []interface{}{map[string]interface{}{"stale": true}},
		Working:     map[string]interface{}{"stale": true},
	}
	installWorldlineTestWorker(t, s, sid)
	token := s.beginChatRun(sid)
	if token == nil {
		t.Fatal("failed to acquire chat run")
	}
	defer s.endChatRunOwned(sid, token)

	if err := s.prepareChatWorldlineResend(sid, token, &cs, "legacy-user"); err != nil {
		t.Fatalf("legacy unmapped resend fallback failed: %v", err)
	}
	if len(cs.Messages) != 2 || cs.Messages[0].ID != "first-user" || cs.Messages[1].ID != "first-assistant" {
		t.Fatalf("messages were not truncated before legacy source: %+v", cs.Messages)
	}
	if len(cs.RawHistory) != 2 || cs.RawHistory[0]["content"] != "first question" || cs.RawHistory[1]["content"] != "first answer" {
		t.Fatalf("raw history was not truncated before legacy source: %+v", cs.RawHistory)
	}
	if len(cs.HistoryInfo) != 0 || cs.Working != nil {
		t.Fatalf("unsafe legacy GA state survived: info=%+v working=%+v", cs.HistoryInfo, cs.Working)
	}
}
