package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"genericagent-admin-go/internal/config"
)

func hubRequest(t *testing.T, h http.Handler, token, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestResolvePythonForChatHubPrefersGARootVirtualenv(t *testing.T) {
	gaRoot := t.TempDir()
	var python string
	if runtime.GOOS == "windows" {
		python = filepath.Join(gaRoot, ".venv", "Scripts", "python.exe")
	} else {
		python = filepath.Join(gaRoot, ".venv", "bin", "python")
	}
	if err := os.MkdirAll(filepath.Dir(python), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(python, []byte("test"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolvePythonForRoot(gaRoot, ""); got != python {
		t.Fatalf("empty configured Python resolved to %q, want GA virtualenv %q", got, python)
	}
	const configured = "custom-python"
	if got := resolvePythonForRoot(gaRoot, configured); got != configured {
		t.Fatalf("configured Python resolved to %q, want %q", got, configured)
	}
}

func TestEmbeddedChatHubBridgeIsMaterialized(t *testing.T) {
	path, err := writeChatHubBridgeScript()
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(path)
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(body) == 0 || !strings.Contains(string(body), "HubClient") {
		t.Fatalf("materialized bridge is invalid: %d bytes", len(body))
	}
	bridge := string(body)
	if !strings.Contains(bridge, "def stop(self):") || !strings.Contains(bridge, "set(clients) - set(wanted)") {
		t.Fatal("materialized bridge must disconnect sessions removed from Hub discovery")
	}
}

func TestChatSessionBridgeAPIExposesAllSessionsWithoutLiveOutput(t *testing.T) {
	store := config.NewStore(t.TempDir())
	s := New(store, nil, nil, nil)
	cs := chatSession{ID: "session-private", Title: "Private chat", Messages: []chatMessage{
		{Role: "user", Content: "task"},
		{Role: "assistant", Content: "final response"},
	}}
	if err := saveChatSession(store.Snapshot(), cs); err != nil {
		t.Fatal(err)
	}

	const token = "private-secret"
	hub := s.chatHubAPI(token)
	private := s.chatSessionBridgeAPI(token, true)
	if got := hubRequest(t, hub, token, http.MethodGet, "/session/_/session-private/outputs", "").Code; got != http.StatusNotFound {
		t.Fatalf("Hub hidden session status = %d, want %d", got, http.StatusNotFound)
	}
	w := hubRequest(t, private, token, http.MethodGet, "/sessions", "")
	var listing struct {
		Sessions []chatHubSession `json:"sessions"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusOK || len(listing.Sessions) != 1 || listing.Sessions[0].SessionID != "session-private" {
		t.Fatalf("private sessions status=%d listing=%#v", w.Code, listing.Sessions)
	}

	run := s.beginChatRun("session-private")
	if run == nil {
		t.Fatal("beginChatRun returned nil")
	}
	defer s.endChatRunOwned("session-private", run)
	s.publishChatRun("session-private", map[string]interface{}{"delta": "in-flight"})
	s.publishChatRun("session-private", map[string]interface{}{
		"type": "turn", "summary": "Inspect state", "thinking": "reason",
		"content": "checked", "tool_calls": []interface{}{},
	})

	decodeOutputs := func(path string) []interface{} {
		t.Helper()
		response := hubRequest(t, private, token, http.MethodGet, path, "")
		if response.Code != http.StatusOK {
			t.Fatalf("outputs status = %d: %s", response.Code, response.Body.String())
		}
		var payload struct {
			Tasks []map[string]interface{} `json:"tasks"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		outputs, _ := payload.Tasks[0]["outputs"].([]interface{})
		return outputs
	}
	stable := decodeOutputs("/session/_/session-private/outputs?live=0")
	if len(stable) != 1 || stable[0] != "final response" {
		t.Fatalf("stable outputs = %#v", stable)
	}
	live := decodeOutputs("/session/_/session-private/outputs")
	if len(live) != 2 || live[1] != "in-flight" {
		t.Fatalf("live outputs = %#v", live)
	}

	snapshotResponse := hubRequest(t, private, token, http.MethodGet, "/session/_/session-private/snapshot", "")
	if snapshotResponse.Code != http.StatusOK {
		t.Fatalf("snapshot status = %d: %s", snapshotResponse.Code, snapshotResponse.Body.String())
	}
	var snapshot struct {
		Tasks   []map[string]interface{} `json:"tasks"`
		Run     bool                     `json:"run"`
		RunID   string                   `json:"run_id"`
		Partial string                   `json:"partial"`
		Turns   []map[string]interface{} `json:"turns"`
	}
	if err := json.Unmarshal(snapshotResponse.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if !snapshot.Run || snapshot.RunID != run.ID || snapshot.Partial != "in-flight" {
		t.Fatalf("snapshot run=%v runID=%q partial=%q", snapshot.Run, snapshot.RunID, snapshot.Partial)
	}
	if len(snapshot.Turns) != 1 || snapshot.Turns[0]["summary"] != "Inspect state" || snapshot.Turns[0]["content"] != "checked" {
		t.Fatalf("snapshot turns = %#v", snapshot.Turns)
	}
	snapshotOutputs, _ := snapshot.Tasks[0]["outputs"].([]interface{})
	if len(snapshotOutputs) != 1 || snapshotOutputs[0] != "final response" {
		t.Fatalf("snapshot stable outputs = %#v", snapshotOutputs)
	}
}

func TestChatHubSessionListMatchesHistoryOrder(t *testing.T) {
	store := config.NewStore(t.TempDir())
	s := New(store, nil, nil, nil)
	fixtures := []chatSession{
		{ID: "session-recent", Title: "Recent", UpdatedAt: 300},
		{ID: "session-pinned", Title: "Pinned", UpdatedAt: 100, Pinned: true},
		{ID: "session-older", Title: "Older", UpdatedAt: 200},
	}
	s.SessionMu.Lock()
	for _, cs := range fixtures {
		if err := saveChatSessionPreserveUpdatedAtLocked(store.Snapshot(), cs); err != nil {
			s.SessionMu.Unlock()
			t.Fatal(err)
		}
	}
	s.SessionMu.Unlock()

	const token = "private-secret"
	w := hubRequest(t, s.chatSessionBridgeAPI(token, true), token, http.MethodGet, "/sessions", "")
	if w.Code != http.StatusOK {
		t.Fatalf("sessions status = %d: %s", w.Code, w.Body.String())
	}
	var listing struct {
		Sessions []chatHubSession `json:"sessions"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if len(listing.Sessions) != 3 {
		t.Fatalf("sessions = %#v", listing.Sessions)
	}
	wantIDs := []string{"session-pinned", "session-recent", "session-older"}
	for i, wantID := range wantIDs {
		if listing.Sessions[i].SessionID != wantID {
			t.Fatalf("sessions[%d].session_id = %q, want %q; all=%#v", i, listing.Sessions[i].SessionID, wantID, listing.Sessions)
		}
	}
	if !listing.Sessions[0].Pinned || listing.Sessions[0].UpdatedAt != 100 {
		t.Fatalf("pinned metadata = %#v", listing.Sessions[0])
	}
	if listing.Sessions[1].Pinned || listing.Sessions[1].UpdatedAt != 300 {
		t.Fatalf("recent metadata = %#v", listing.Sessions[1])
	}
}

func TestPrivateChatBridgeCanCreatePersistentSession(t *testing.T) {
	store := config.NewStore(t.TempDir())
	cfg := store.Snapshot()
	cfg.ChatDefaultLLMNo = 2
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}
	s := New(store, nil, nil, nil)
	token := "private-token"
	private := s.chatSessionBridgeAPI(token, true)
	hub := s.chatSessionBridgeAPI(token, false)

	unauthorized := httptest.NewRecorder()
	private.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodPost, "/session/_/new", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized new status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}
	if hidden := hubRequest(t, hub, token, http.MethodPost, "/session/_/new", ""); hidden.Code != http.StatusNotFound {
		t.Fatalf("Hub new status = %d, want %d", hidden.Code, http.StatusNotFound)
	}

	created := hubRequest(t, private, token, http.MethodPost, "/session/_/new", "")
	if created.Code != http.StatusOK {
		t.Fatalf("private new status = %d: %s", created.Code, created.Body.String())
	}
	var item chatHubSession
	if err := json.Unmarshal(created.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if item.SessionID == "" || item.InstanceID != "_" || item.Title != "新会话" || item.Peer != chatHubPeer("", item.SessionID) {
		t.Fatalf("created session = %#v", item)
	}
	persisted, err := loadChatSession(store.Snapshot(), item.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.ID != item.SessionID || persisted.Title != "新会话" || persisted.Settings != s.defaultChatSettings() {
		t.Fatalf("persisted session = %#v; default settings = %#v", persisted, s.defaultChatSettings())
	}
	if len(persisted.Messages) != 0 || len(persisted.RawHistory) != 0 {
		t.Fatalf("new session must be empty: messages=%#v raw_history=%#v", persisted.Messages, persisted.RawHistory)
	}

	put := hubRequest(t, private, token, http.MethodPost, "/session/_/"+item.SessionID+"/put", `{"text":"first message"}`)
	if put.Code == http.StatusNotFound {
		t.Fatalf("first put could not load persisted session: %s", put.Body.String())
	}
	if put.Code != http.StatusOK {
		t.Fatalf("first put status = %d: %s", put.Code, put.Body.String())
	}
	if !s.chatRunActive(item.SessionID) {
		t.Fatal("first put did not start the new session")
	}
	s.chatCancel(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/chat/cancel/"+item.SessionID, nil), item.SessionID)
}

func TestChatHubAPIExposesPersistentSessionAndControlsRun(t *testing.T) {
	store := config.NewStore(t.TempDir())
	s := New(store, nil, nil, nil)
	cs := chatSession{ID: "session-1", Title: "Hub chat", Messages: []chatMessage{
		{Role: "user", Content: "first task"},
		{Role: "assistant", Content: "joined response", Outputs: []string{"step one", "step two"}},
		{Role: "user", Content: "second task"},
		{Role: "assistant", Content: "legacy response"},
	}}
	if err := saveChatSession(store.Snapshot(), cs); err != nil {
		t.Fatal(err)
	}

	const token = "test-secret"
	h := s.chatHubAPI(token)
	if got := hubRequest(t, h, "", http.MethodGet, "/sessions", "").Code; got != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, want %d", got, http.StatusUnauthorized)
	}

	w := hubRequest(t, h, token, http.MethodGet, "/sessions", "")
	if w.Code != http.StatusOK {
		t.Fatalf("sessions status = %d: %s", w.Code, w.Body.String())
	}
	var listing struct {
		Sessions []chatHubSession `json:"sessions"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if len(listing.Sessions) != 0 {
		t.Fatalf("sessions before opt-in = %#v, want none", listing.Sessions)
	}
	if hidden := hubRequest(t, h, token, http.MethodGet, "/session/_/session-1/outputs", ""); hidden.Code != http.StatusNotFound {
		t.Fatalf("hidden session direct access status = %d, want %d", hidden.Code, http.StatusNotFound)
	}

	toggle := httptest.NewRecorder()
	s.chatSetHubEnabled(toggle, httptest.NewRequest(http.MethodPatch, "/api/chat/hub/session-1", strings.NewReader(`{"enabled":true}`)), "session-1")
	if toggle.Code != http.StatusOK {
		t.Fatalf("enable Hub status = %d: %s", toggle.Code, toggle.Body.String())
	}
	w = hubRequest(t, h, token, http.MethodGet, "/sessions", "")
	listing.Sessions = nil
	if err := json.Unmarshal(w.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if len(listing.Sessions) != 1 || listing.Sessions[0].Peer != "ga-admin/default/session-1" {
		t.Fatalf("sessions after opt-in = %#v", listing.Sessions)
	}

	w = hubRequest(t, h, token, http.MethodGet, "/session/_/session-1/outputs", "")
	var outputs struct {
		Tasks []map[string]interface{} `json:"tasks"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &outputs); err != nil {
		t.Fatal(err)
	}
	if len(outputs.Tasks) != 2 {
		t.Fatalf("tasks = %#v, want 2", outputs.Tasks)
	}
	steps, _ := outputs.Tasks[0]["outputs"].([]interface{})
	if len(steps) != 2 || steps[0] != "step one" || steps[1] != "step two" {
		t.Fatalf("first task outputs = %#v", steps)
	}
	legacy, _ := outputs.Tasks[1]["outputs"].([]interface{})
	if len(legacy) != 1 || legacy[0] != "legacy response" {
		t.Fatalf("legacy task outputs = %#v", legacy)
	}

	run := s.beginChatRun("session-1")
	if run == nil {
		t.Fatal("beginChatRun returned nil")
	}
	w = hubRequest(t, h, token, http.MethodPost, "/session/_/session-1/put", `{"text":"remote task"}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("busy put status = %d: %s", w.Code, w.Body.String())
	}
	w = hubRequest(t, h, token, http.MethodPost, "/session/_/session-1/abort", "")
	if w.Code != http.StatusOK || s.chatRunActive("session-1") {
		t.Fatalf("abort status = %d active=%v body=%s", w.Code, s.chatRunActive("session-1"), w.Body.String())
	}

	started := time.Now()
	w = hubRequest(t, h, token, http.MethodPost, "/session/_/session-1/put", `{"text":"accepted remote task"}`)
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("idle put took %v; Hub requires admission ACK before its 15s timeout", elapsed)
	}
	if w.Code != http.StatusOK || !s.chatRunActive("session-1") {
		t.Fatalf("idle put status = %d active=%v body=%s", w.Code, s.chatRunActive("session-1"), w.Body.String())
	}
	w = hubRequest(t, h, token, http.MethodPost, "/session/_/session-1/abort", "")
	if w.Code != http.StatusOK {
		t.Fatalf("cleanup abort status = %d: %s", w.Code, w.Body.String())
	}

	toggle = httptest.NewRecorder()
	s.chatSetHubEnabled(toggle, httptest.NewRequest(http.MethodPatch, "/api/chat/hub/session-1", strings.NewReader(`{"enabled":false}`)), "session-1")
	if toggle.Code != http.StatusOK {
		t.Fatalf("disable Hub status = %d: %s", toggle.Code, toggle.Body.String())
	}
	w = hubRequest(t, h, token, http.MethodGet, "/sessions", "")
	listing.Sessions = nil
	if err := json.Unmarshal(w.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if len(listing.Sessions) != 0 {
		t.Fatalf("sessions after opt-out = %#v, want none", listing.Sessions)
	}
	if hidden := hubRequest(t, h, token, http.MethodGet, "/session/_/session-1/state", ""); hidden.Code != http.StatusNotFound {
		t.Fatalf("opted-out session direct access status = %d, want %d", hidden.Code, http.StatusNotFound)
	}
}

func TestChatSetPinnedPersistsWithoutChangingUpdatedAt(t *testing.T) {
	store := config.NewStore(t.TempDir())
	s := New(store, nil, nil, nil)
	const updatedAt int64 = 1700000000
	if err := saveChatSession(store.Snapshot(), chatSession{ID: "session-pin", Title: "Pin me", UpdatedAt: updatedAt}); err != nil {
		t.Fatal(err)
	}
	baseline, err := loadChatSession(store.Snapshot(), "session-pin")
	if err != nil {
		t.Fatal(err)
	}

	w := httptest.NewRecorder()
	s.chatSetPinned(w, httptest.NewRequest(http.MethodPatch, "/api/chat/pin/session-pin", strings.NewReader(`{"pinned":true}`)), "session-pin")
	if w.Code != http.StatusOK {
		t.Fatalf("pin status = %d: %s", w.Code, w.Body.String())
	}
	persisted, err := loadChatSession(store.Snapshot(), "session-pin")
	if err != nil {
		t.Fatal(err)
	}
	if !persisted.Pinned {
		t.Fatal("pinned state was not persisted")
	}
	if persisted.UpdatedAt != baseline.UpdatedAt {
		t.Fatalf("updated_at = %d, want unchanged %d", persisted.UpdatedAt, baseline.UpdatedAt)
	}

	w = httptest.NewRecorder()
	s.chatSetPinned(w, httptest.NewRequest(http.MethodPatch, "/api/chat/pin/session-pin", strings.NewReader(`{"pinned":false}`)), "session-pin")
	if w.Code != http.StatusOK {
		t.Fatalf("unpin status = %d: %s", w.Code, w.Body.String())
	}
	persisted, err = loadChatSession(store.Snapshot(), "session-pin")
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Pinned {
		t.Fatal("unpinned state was not persisted")
	}
}

func TestChatHubSessionListReusesSessionSummaryIndex(t *testing.T) {
	store := config.NewStore(t.TempDir())
	s := New(store, nil, nil, nil)
	for _, cs := range []chatSession{
		{ID: "hub-on", Title: "Shared", HubEnabled: true, Messages: []chatMessage{{Role: "user", Content: "task"}}},
		{ID: "hub-off", Title: "Hidden", Messages: []chatMessage{{Role: "user", Content: "task"}}},
	} {
		if err := saveChatSession(store.Snapshot(), cs); err != nil {
			t.Fatal(err)
		}
	}
	loads := 0
	s.ChatRuntime.sessionListLoadHook = func(string) { loads++ }

	first := s.listChatHubSessions(false)
	if len(first) != 1 || first[0].SessionID != "hub-on" || first[0].Title != "Shared" {
		t.Fatalf("first Hub listing = %#v", first)
	}
	coldLoads := loads
	if coldLoads != 2 {
		t.Fatalf("Hub listing bypassed the session summary index: cold loads = %d, want 2", coldLoads)
	}
	if got := s.listChatHubSessions(false); len(got) != 1 || loads != coldLoads {
		t.Fatalf("unchanged Hub listing decoded sessions again: loads %d -> %d, listing=%#v", coldLoads, loads, got)
	}
	if got := s.listChatHubSessions(true); len(got) != 2 || loads != coldLoads {
		t.Fatalf("bridge listing decoded sessions again: loads %d -> %d, listing=%#v", coldLoads, loads, got)
	}

	hidden, err := loadChatSession(store.Snapshot(), "hub-off")
	if err != nil {
		t.Fatal(err)
	}
	hidden.HubEnabled = true
	hidden.Title = "Now shared"
	hidden.UpdatedAt += 10
	if err := saveChatSession(store.Snapshot(), hidden); err != nil {
		t.Fatal(err)
	}
	got := s.listChatHubSessions(false)
	if len(got) != 2 || got[0].SessionID != "hub-off" || got[0].Title != "Now shared" {
		t.Fatalf("changed session not refreshed in Hub listing: %#v", got)
	}
}
