package api

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGlobalProjectRuntimeMode(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	cfg := s.CfgStore.Snapshot()
	for _, origin := range []string{"official", "admin"} {
		cs := chatSession{ProjectProvider: origin, ProjectID: "existing"}
		for _, mode := range []string{"official", "admin"} {
			cfg.DefaultProjectProvider = mode
			fields := projectRequestFields(cs, cfg)
			if fields["project_provider"] != mode {
				t.Fatalf("origin %s mode %s: %v", origin, mode, fields)
			}
			if mode == "official" && fields["project_mode"] != "existing" {
				t.Fatal(fields)
			}
			if mode == "admin" && fields["project_memory_dir"] != adminProjectDir(cfg, "existing") {
				t.Fatal(fields)
			}
			if cs.ProjectProvider != origin {
				t.Fatal("session provenance changed")
			}
		}
	}
	if fields := projectRequestFields(chatSession{}, cfg); fields["project_mode"] != "" || fields["project_memory_dir"] != nil {
		t.Fatal(fields)
	}
	cfg.DefaultProjectProvider = "admin"
	if fields := projectRequestFields(chatSession{ProjectMode: "legacy"}, cfg); fields["project_provider"] != "admin" || fields["project_id"] != "legacy" {
		t.Fatal(fields)
	}
}

func TestAdminProjectMemoryResolveAndPreserve(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	cfg := s.CfgStore.Snapshot()
	item, dir, err := ensureAdminProject(cfg, "memory-contract")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"project_mem_insight.txt", "project_mem.txt", "memory_management_sop.md"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
	}
	contents := map[string]string{"project_mem_insight.txt": "persistent rules", "project_mem.txt": "project knowledge", "detail_sop.md": "detail knowledge"}
	for name, content := range contents {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	meta, err := os.ReadFile(filepath.Join(dir, "project.json"))
	if err != nil {
		t.Fatal(err)
	}
	again, againDir, err := ensureAdminProject(cfg, item.ID)
	if err != nil || again != item || againDir != dir {
		t.Fatalf("second ensure: item=%+v dir=%q err=%v", again, againDir, err)
	}
	for name, want := range contents {
		got, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil || string(got) != want {
			t.Fatalf("memory changed: %s got=%q err=%v", name, got, err)
		}
	}
	after, err := os.ReadFile(filepath.Join(dir, "project.json"))
	if err != nil || string(after) != string(meta) {
		t.Fatalf("metadata changed: %v", err)
	}
	resolved, resolvedDir, err := resolveProject(cfg, "admin", item.ID)
	if err != nil || resolved != item || resolvedDir != projectModeWorkspace(cfg, item.ID) {
		t.Fatalf("resolve: item=%+v dir=%q err=%v", resolved, resolvedDir, err)
	}
	if _, workspace, err := resolveProject(cfg, "official", item.ID); err != nil || workspace != projectModeWorkspace(cfg, item.ID) {
		t.Fatal("project must share its workspace across modes")
	}
	if _, _, err := resolveProject(cfg, "admin", "missing-project"); !os.IsNotExist(err) {
		t.Fatalf("missing project error=%v", err)
	}
}

func TestProjectWorkspaceSwitch(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	cfg := s.CfgStore.Snapshot()
	for _, mode := range []string{"official", "admin"} {
		cfg.DefaultProjectProvider = mode
		for _, workspace := range []string{adminProjectDir(cfg, "existing"), projectModeWorkspace(cfg, "existing"), "custom-workspace"} {
			cs := chatSession{ProjectProvider: "admin", ProjectID: "existing", Workspace: workspace}
			req := map[string]interface{}{"workspace": workspace}
			applyProjectRequestFields(req, cs, cfg)
			want := workspace
			if workspace == adminProjectDir(cfg, "existing") {
				want = projectModeWorkspace(cfg, "existing")
			}
			if req["workspace"] != want {
				t.Fatalf("mode %s: %v", mode, req)
			}
		}
	}
}
