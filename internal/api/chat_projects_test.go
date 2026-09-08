package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"genericagent-admin-go/internal/config"
)

func newProjectTestServer(t *testing.T) (*Server, string, http.Handler) {
	t.Helper()
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	return s, root, s.Routes()
}

func createProject(t *testing.T, h http.Handler, name string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]string{"name": name})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/chat/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func TestCreateProjectMakesTheDirectoryAndListsIt(t *testing.T) {
	_, root, h := newProjectTestServer(t)
	rr := createProject(t, h, "  alpha  ")
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var payload struct {
		Name     string   `json:"name"`
		Created  bool     `json:"created"`
		Dir      string   `json:"dir"`
		Memory   string   `json:"memory"`
		Projects []string `json:"projects"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Name != "alpha" || !payload.Created {
		t.Fatalf("payload=%#v want the trimmed name and created=true", payload)
	}
	if strings.Join(payload.Projects, ",") != "alpha" {
		t.Fatalf("projects=%v want the refreshed list to include alpha", payload.Projects)
	}
	wantDir := filepath.Join(root, "temp", "projects", "alpha")
	if payload.Dir != wantDir {
		t.Fatalf("dir=%q want=%q", payload.Dir, wantDir)
	}
	if st, err := os.Stat(wantDir); err != nil || !st.IsDir() {
		t.Fatalf("project directory was not created: %v", err)
	}
	if _, err := os.Stat(filepath.Join(wantDir, "project_memory.md")); err != nil {
		t.Fatalf("project memory was not initialized: %v", err)
	}
}

// The sidebar filters known names before posting, so a repeat can only come from
// a race or a project made outside the UI. Neither should destroy project memory.
func TestCreateProjectIsIdempotentAndKeepsExistingMemory(t *testing.T) {
	_, root, h := newProjectTestServer(t)
	dir := filepath.Join(root, "temp", "projects", "beta")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	const memory = "# existing project memory\n"
	memoryPath := filepath.Join(dir, "project_memory.md")
	if err := os.WriteFile(memoryPath, []byte(memory), 0o644); err != nil {
		t.Fatal(err)
	}

	rr := createProject(t, h, "beta")
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var payload struct {
		Created bool `json:"created"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Created {
		t.Fatal("created should be false for a project that already existed")
	}
	got, err := os.ReadFile(memoryPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != memory {
		t.Fatalf("memory=%q want it left untouched", got)
	}
}

func TestCreateProjectRefusesNamesThatEscapeTheProjectsDirectory(t *testing.T) {
	_, root, h := newProjectTestServer(t)
	for _, name := range []string{"", "   ", ".", "..", "../escape", `a\b`, "a/b", "C:", "alpha."} {
		rr := createProject(t, h, name)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("name=%q status=%d want=400 body=%s", name, rr.Code, rr.Body.String())
		}
	}
	if entries, err := os.ReadDir(filepath.Join(root, "temp", "projects")); err == nil && len(entries) > 0 {
		t.Fatalf("rejected names must not create anything, found %d entries", len(entries))
	}
}

func TestCreateProjectReportsAnUnconfiguredGARoot(t *testing.T) {
	s := newGoalTestServer(t, "")
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.GARoot = ""
		cfg.ChatDataDir = t.TempDir()
	})
	rr := createProject(t, s.Routes(), "alpha")
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=400 body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "GA Root") {
		t.Fatalf("body=%s want it to name the missing GA Root", rr.Body.String())
	}
}

// A project created through the button must be immediately usable by
// /api/chat/session/new, which rejects projects it cannot discover.
func TestCreatedProjectIsAcceptedByNewSession(t *testing.T) {
	_, _, h := newProjectTestServer(t)
	if rr := createProject(t, h, "gamma"); rr.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", rr.Code, rr.Body.String())
	}
	req := httptest.NewRequest(http.MethodPost, "/api/chat/session/new", strings.NewReader(`{"project_mode":"gamma"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("new session status=%d body=%s", rr.Code, rr.Body.String())
	}
	var session struct {
		ID          string `json:"id"`
		ProjectMode string `json:"project_mode"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.ID == "" || session.ProjectMode != "gamma" {
		t.Fatalf("session=%#v want a saved session bound to gamma", session)
	}
}

func TestCreateProjectRejectsNonPostMethods(t *testing.T) {
	_, _, h := newProjectTestServer(t)
	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest(method, "/api/chat/projects", nil))
		if rr.Code != http.StatusNotFound {
			t.Fatalf("%s status=%d want=404", method, rr.Code)
		}
	}
}

func pinProject(t *testing.T, h http.Handler, name string, pinned bool) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]interface{}{"name": name, "pinned": pinned})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPatch, "/api/chat/projects/pin", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func sessionsPayload(t *testing.T, h http.Handler) (projects []string, pinned []string) {
	t.Helper()
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("sessions status=%d body=%s", rr.Code, rr.Body.String())
	}
	var payload struct {
		Projects       []string `json:"projects"`
		PinnedProjects []string `json:"pinned_projects"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Projects, payload.PinnedProjects
}

func TestPinnedProjectsRoundTripThroughTheSessionsPayload(t *testing.T) {
	_, _, h := newProjectTestServer(t)
	for _, name := range []string{"alpha", "beta"} {
		if rr := createProject(t, h, name); rr.Code != http.StatusOK {
			t.Fatalf("create %s status=%d body=%s", name, rr.Code, rr.Body.String())
		}
	}
	if _, pinned := sessionsPayload(t, h); len(pinned) != 0 {
		t.Fatalf("pinned=%v want nothing pinned before any pin", pinned)
	}

	rr := pinProject(t, h, "beta", true)
	if rr.Code != http.StatusOK {
		t.Fatalf("pin status=%d body=%s", rr.Code, rr.Body.String())
	}
	var payload struct {
		Pinned         bool     `json:"pinned"`
		PinnedProjects []string `json:"pinned_projects"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Pinned || strings.Join(payload.PinnedProjects, ",") != "beta" {
		t.Fatalf("payload=%#v want beta pinned", payload)
	}

	projects, pinned := sessionsPayload(t, h)
	if strings.Join(projects, ",") != "alpha,beta" {
		t.Fatalf("projects=%v want both projects still listed", projects)
	}
	if strings.Join(pinned, ",") != "beta" {
		t.Fatalf("pinned=%v want beta", pinned)
	}

	if rr := pinProject(t, h, "beta", false); rr.Code != http.StatusOK {
		t.Fatalf("unpin status=%d body=%s", rr.Code, rr.Body.String())
	}
	if _, pinned := sessionsPayload(t, h); len(pinned) != 0 {
		t.Fatalf("pinned=%v want the pin removed", pinned)
	}
}

// Pinning must not touch the project directory: a project is the user's working
// data, and a UI preference has no business writing into it.
func TestPinningWritesOnlyToTheChatDataDir(t *testing.T) {
	s, root, h := newProjectTestServer(t)
	if rr := createProject(t, h, "alpha"); rr.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", rr.Code, rr.Body.String())
	}
	dir := filepath.Join(root, "temp", "projects", "alpha")
	before, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if rr := pinProject(t, h, "alpha", true); rr.Code != http.StatusOK {
		t.Fatalf("pin status=%d body=%s", rr.Code, rr.Body.String())
	}
	after, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(before) != len(after) {
		t.Fatalf("project directory gained entries: %d -> %d", len(before), len(after))
	}
	if _, err := os.Stat(chatProjectPrefsPath(s.CfgStore.Snapshot())); err != nil {
		t.Fatalf("pin was not persisted beside the chat sessions: %v", err)
	}
}

func TestPinProjectRejectsUnsafeNamesAndWrongMethods(t *testing.T) {
	_, _, h := newProjectTestServer(t)
	for _, name := range []string{"", "..", "a/b", `a\b`} {
		if rr := pinProject(t, h, name, true); rr.Code != http.StatusBadRequest {
			t.Fatalf("name=%q status=%d want=400", name, rr.Code)
		}
	}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest(method, "/api/chat/projects/pin", strings.NewReader(`{"name":"alpha","pinned":true}`)))
		if rr.Code != http.StatusNotFound {
			t.Fatalf("%s status=%d want=404", method, rr.Code)
		}
	}
}

// A pin survives a project vanishing, so a rename or a moved GA root brings the
// project back pinned instead of silently losing the preference.
func TestPinnedProjectsSurviveAProjectDisappearing(t *testing.T) {
	_, root, h := newProjectTestServer(t)
	if rr := createProject(t, h, "alpha"); rr.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", rr.Code, rr.Body.String())
	}
	if rr := pinProject(t, h, "alpha", true); rr.Code != http.StatusOK {
		t.Fatalf("pin status=%d body=%s", rr.Code, rr.Body.String())
	}
	if err := os.RemoveAll(filepath.Join(root, "temp", "projects", "alpha")); err != nil {
		t.Fatal(err)
	}
	projects, pinned := sessionsPayload(t, h)
	if len(projects) != 0 {
		t.Fatalf("projects=%v want the deleted project gone", projects)
	}
	if strings.Join(pinned, ",") != "alpha" {
		t.Fatalf("pinned=%v want the pin kept for alpha", pinned)
	}
}

func TestLoadPinnedProjectsIgnoresACorruptPrefsFile(t *testing.T) {
	s, _, _ := newProjectTestServer(t)
	cfg := s.CfgStore.Snapshot()
	path := chatProjectPrefsPath(cfg)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := loadPinnedProjects(cfg); len(got) != 0 {
		t.Fatalf("loadPinnedProjects=%v want empty for a corrupt file", got)
	}
}

func TestNormalizePinnedProjectsDropsUnsafeAndDuplicateNames(t *testing.T) {
	got := normalizePinnedProjects([]string{"beta", "  beta  ", "", "..", "a/b", "alpha"})
	if strings.Join(got, ",") != "alpha,beta" {
		t.Fatalf("normalizePinnedProjects=%v want [alpha beta]", got)
	}
}

// The slash command and the button share ensureProjectMode so a project has the
// same layout either way; a symlinked project path must be refused by both.
func TestEnsureProjectModeRefusesANonDirectoryProjectPath(t *testing.T) {
	root := t.TempDir()
	projects := filepath.Join(root, "temp", "projects")
	if err := os.MkdirAll(projects, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(projects, "delta"), []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ensureProjectMode(config.AppConfig{GARoot: root}, "delta"); err == nil {
		t.Fatal("a project path that is not a directory must be refused")
	}
}

func TestProjectOrderPersistsAndPreservesPins(t *testing.T) {
	s, _, h := newProjectTestServer(t)
	cfg := s.CfgStore.Snapshot()
	for _, body := range []string{`{"name":"a","pinned":true}`, `{"order":["b","a"]}`, `{"order":["b","a"]}`, `{"name":"c","pinned":true}`} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest(http.MethodPatch, "/api/chat/projects/pin", strings.NewReader(body)))
		if rr.Code != 200 {
			t.Fatalf("%d %s", rr.Code, rr.Body.String())
		}
	}
	prefs := loadProjectPrefs(cfg)
	if strings.Join(prefs.Order, ",") != "b,a" || strings.Join(prefs.Pinned, ",") != "a,c" {
		t.Fatalf("prefs=%+v", prefs)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil))
	if !strings.Contains(rr.Body.String(), `"project_order":["b","a"]`) {
		t.Fatal(rr.Body.String())
	}
}
