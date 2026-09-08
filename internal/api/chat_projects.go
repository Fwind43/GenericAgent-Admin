package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"

	"genericagent-admin-go/internal/config"
)

// A project is nothing but a directory under {GA_ROOT}/temp/projects, so there is
// no per-project record that could carry a pin. Keep the pinned names beside the
// chat sessions instead: that is per-instance state just like the sessions, and
// pinning must not write anything into the user's project directory.
func chatProjectPrefsPath(cfg config.AppConfig) string {
	return filepath.Join(chatDataDir(cfg), "chat_projects.json")
}

type chatProjectPrefs struct {
	Pinned []string `json:"pinned"`
	Order  []string `json:"order"`
}

// loadPinnedProjects never fails the caller: a missing or corrupt preferences
// file means "nothing is pinned", which degrades to plain alphabetical order
// rather than breaking the sidebar.
func loadPinnedProjects(cfg config.AppConfig) []string {
	b, err := os.ReadFile(chatProjectPrefsPath(cfg))
	if err != nil {
		return []string{}
	}
	var prefs chatProjectPrefs
	if err := json.Unmarshal(b, &prefs); err != nil {
		return []string{}
	}
	return normalizePinnedProjects(prefs.Pinned)
}

// Preference keys accept legacy official names and explicit provider identities.
func validProjectPreferenceKey(raw string) (string, bool) {
	for _, provider := range []string{chatProjectProviderAdmin, chatProjectProviderOfficial} {
		prefix := provider + ":"
		if len(raw) >= len(prefix) && raw[:len(prefix)] == prefix {
			id, ok := validProjectModeName(raw[len(prefix):])
			if !ok {
				return "", false
			}
			return id, true
		}
	}
	return validProjectModeName(raw)
}

func normalizePinnedProjects(names []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(names))
	for _, raw := range names {
		name, ok := validProjectPreferenceKey(raw)
		if !ok || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func savePinnedProjects(cfg config.AppConfig, names []string) error {
	prefs := loadProjectPrefs(cfg)
	prefs.Pinned = normalizePinnedProjects(names)
	b, err := json.MarshalIndent(prefs, "", "  ")
	if err != nil {
		return err
	}
	return writeChatFileAtomic(chatProjectPrefsPath(cfg), b, 0644)
}

// A pin outlives the project it names on purpose: pins are kept even for names
// that are not currently on disk, so a project that disappears and comes back
// (a rename, a moved GA root) returns pinned.
func setProjectPinned(cfg config.AppConfig, name string, pinned bool) ([]string, error) {
	current := loadPinnedProjects(cfg)
	next := make([]string, 0, len(current)+1)
	for _, existing := range current {
		sameProject := existing == name || projectKey(chatProjectProviderOfficial, existing) == name || existing == projectKey(chatProjectProviderOfficial, name)
		if !sameProject {
			next = append(next, existing)
		}
	}
	if pinned {
		next = append(next, name)
	}
	if err := savePinnedProjects(cfg, next); err != nil {
		return nil, err
	}
	return normalizePinnedProjects(next), nil
}

// chatCreateProject backs the sidebar's new-project button. Project Mode used to
// be reachable only by typing /project <name>, which left the Projects tab
// listing projects with no way to add one.
//
// The refreshed project list is returned so the sidebar can show the new project
// without a second round trip.
func (s *Server) chatCreateProject(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string `json:"name"`
		Provider string `json:"provider"`
	}
	if err := decode(r, &req); err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	name, ok := validProjectModeName(req.Name)
	if !ok {
		bad(w, http.StatusBadRequest, errProjectNameInvalid.Error())
		return
	}
	cfg := s.CfgStore.Snapshot()
	// Requests from older clients create official projects by default.
	if req.Provider == "" {
		req.Provider = chatProjectProviderOfficial
	}
	provider, validProvider := normalizeProjectProvider(req.Provider)
	if !validProvider {
		bad(w, http.StatusBadRequest, "invalid project provider")
		return
	}
	if provider == chatProjectProviderAdmin {
		existed := false
		for _, item := range discoverAdminProjects(cfg) {
			if item.ID == name {
				existed = true
				break
			}
		}
		item, _, err := ensureAdminProject(cfg, name)
		if err != nil {
			bad(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, map[string]interface{}{"ok": true, "created": !existed, "name": item.Name, "id": item.ID, "provider": item.Provider, "workspace": projectModeWorkspace(cfg, name), "projects": discoverProjectNames(cfg.GARoot), "project_items": discoverProjectItems(cfg), "pinned_projects": loadPinnedProjects(cfg)})
		return
	}
	existed := false
	for _, existing := range discoverProjectNames(cfg.GARoot) {
		if existing == name {
			existed = true
			break
		}
	}
	dir, memoryPath, err := ensureProjectMode(cfg, name)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errProjectNameInvalid) || errors.Is(err, errProjectGARootMissing) {
			status = http.StatusBadRequest
		}
		bad(w, status, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{
		"ok":            true,
		"name":          name,
		"created":       !existed,
		"dir":           dir,
		"memory":        memoryPath,
		"projects":      discoverProjectNames(cfg.GARoot),
		"project_items": discoverProjectItems(cfg),
		"workspace":     dir,
	})
}

func (s *Server) chatSetProjectPinned(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name   string    `json:"name"`
		Pinned bool      `json:"pinned"`
		Order  *[]string `json:"order"`
	}
	if err := decode(r, &req); err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Order != nil {
		cfg := s.CfgStore.Snapshot()
		s.SessionMu.Lock()
		prefs := loadProjectPrefs(cfg)
		prefs.Order = []string{}
		seen := map[string]bool{}
		for _, raw := range *req.Order {
			name, valid := validProjectPreferenceKey(raw)
			if !valid {
				s.SessionMu.Unlock()
				bad(w, http.StatusBadRequest, errProjectNameInvalid.Error())
				return
			}
			if !seen[name] {
				prefs.Order = append(prefs.Order, name)
				seen[name] = true
			}
		}
		b, err := json.MarshalIndent(prefs, "", "  ")
		if err == nil {
			err = writeChatFileAtomic(chatProjectPrefsPath(cfg), b, 0644)
		}
		s.SessionMu.Unlock()
		if err != nil {
			bad(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, map[string]interface{}{"ok": true, "project_order": prefs.Order})
		return
	}
	name, ok := validProjectPreferenceKey(req.Name)
	if !ok {
		bad(w, http.StatusBadRequest, errProjectNameInvalid.Error())
		return
	}
	cfg := s.CfgStore.Snapshot()
	s.SessionMu.Lock()
	pinned, err := setProjectPinned(cfg, name, req.Pinned)
	s.SessionMu.Unlock()
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{
		"ok":              true,
		"name":            name,
		"pinned":          req.Pinned,
		"pinned_projects": pinned,
	})
}

func chatProjectNamesFor(cfg config.AppConfig) (names []string, pinned []string) {
	names = discoverProjectNames(cfg.GARoot)
	if names == nil {
		names = []string{}
	}
	return names, loadPinnedProjects(cfg)
}
func loadProjectPrefs(cfg config.AppConfig) chatProjectPrefs {
	prefs := chatProjectPrefs{Pinned: []string{}, Order: []string{}}
	if b, err := os.ReadFile(chatProjectPrefsPath(cfg)); err == nil {
		_ = json.Unmarshal(b, &prefs)
	}
	return prefs
}
