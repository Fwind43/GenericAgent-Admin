package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"genericagent-admin-go/internal/config"
)

const (
	chatProjectProviderAdmin    = "admin"
	chatProjectProviderOfficial = "official"
)

type chatProjectItem struct {
	Provider string `json:"provider"`
	ID       string `json:"id"`
	Name     string `json:"name"`
}

type adminProjectMeta struct {
	Version   int    `json:"version"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

func normalizeProjectProvider(raw string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", chatProjectProviderAdmin:
		return chatProjectProviderAdmin, true
	case chatProjectProviderOfficial:
		return chatProjectProviderOfficial, true
	default:
		return "", false
	}
}

func projectKey(provider, id string) string {
	return provider + ":" + id
}

func adminProjectRoot(cfg config.AppConfig) string {
	return filepath.Join(chatDataDir(cfg), "project-memory")
}

func legacyAdminProjectDir(cfg config.AppConfig, id string) string {
	return filepath.Join(adminProjectRoot(cfg), id)
}

func adminProjectDir(cfg config.AppConfig, id string) string {
	return filepath.Join(projectModeWorkspace(cfg, id), "memory")
}

func migrateAdminProjectMemory(cfg config.AppConfig, id string) error {
	if _, err := os.Stat(filepath.Join(adminProjectDir(cfg, id), "project_mem_insight.txt")); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	root := legacyAdminProjectDir(cfg, id)
	if _, err := os.Stat(root); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in legacy project memory: %s", path)
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		target := filepath.Join(adminProjectDir(cfg, id), rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		f, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if errors.Is(err, os.ErrExist) {
			return nil
		}
		if err != nil {
			return err
		}
		_, writeErr := f.Write(data)
		closeErr := f.Close()
		if writeErr != nil {
			_ = os.Remove(target)
			return writeErr
		}
		if closeErr != nil {
			_ = os.Remove(target)
			return closeErr
		}
		return nil
	})
}

func ensureAdminProject(cfg config.AppConfig, raw string) (chatProjectItem, string, error) {
	name, ok := validProjectModeName(raw)
	if !ok {
		return chatProjectItem{}, "", errProjectNameInvalid
	}
	id := name
	dir := adminProjectDir(cfg, id)
	if err := migrateAdminProjectMemory(cfg, id); err != nil {
		return chatProjectItem{}, "", err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return chatProjectItem{}, "", err
	}
	now := time.Now().Unix()
	metaPath := filepath.Join(dir, "project.json")
	if _, err := os.Stat(metaPath); os.IsNotExist(err) {
		meta := adminProjectMeta{Version: 1, ID: id, Name: name, CreatedAt: now, UpdatedAt: now}
		b, _ := json.MarshalIndent(meta, "", "  ")
		if err := writeChatFileAtomic(metaPath, b, 0644); err != nil {
			return chatProjectItem{}, "", err
		}
	} else if err != nil {
		return chatProjectItem{}, "", err
	}
	for _, f := range []struct{ name, content string }{
		{"project_mem_insight.txt", "# [Project Memory Insight]\nL0: memory_management_sop.md\nL2: project_mem.txt\nL3:\n[RULES]\n"},
		{"project_mem.txt", "# [Project Facts]\n"},
		{"memory_management_sop.md", "# Project Memory Management\nBefore writing, read this SOP. Retain only action-verified durable project knowledge; preserve originals.\nL1 project_mem_insight.txt: <=30 lines, preferably <1000 tokens; frequent scenario -> SOP/L2 section mappings, low-frequency keywords, and RULES for one-line red lines. No how-to, technical details, logs or secrets. Only small file patches; never overwrite or use code execution for L1.\nL2 project_mem.txt: verified facts under ## [SECTION]. L3: concise topic SOP .md/.py files in this directory. No L4.\nNew/deleted L2/L3 scenarios require matching L1 pointers; value-only changes need no index edit. Self-explanatory names need no explanation; parentheses only contain short scenario triggers.\nRetired l1.md/l2.md/l3/ must not be retained or referenced as sources after knowledge is migrated to canonical files. Move details out of L1 rather than truncating or deleting knowledge.\nDo not store transient state, guesses, transcripts or common knowledge. Project rules supplement global rules. Preserve global memory and official project_memory.md.\n"},
	} {
		path := filepath.Join(dir, f.name)
		h, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
		if err == nil {
			_, err = h.WriteString(f.content)
			if closeErr := h.Close(); err == nil {
				err = closeErr
			}
		}
		if err != nil && !os.IsExist(err) {
			return chatProjectItem{}, "", err
		}
	}
	return chatProjectItem{Provider: chatProjectProviderAdmin, ID: id, Name: name}, dir, nil
}

func discoverAdminProjects(cfg config.AppConfig) []chatProjectItem {
	entries, _ := os.ReadDir(adminProjectRoot(cfg))
	seen := map[string]bool{}
	out := make([]chatProjectItem, 0, len(entries))
	for _, id := range discoverProjectNames(cfg.GARoot) {
		if info, err := os.Stat(adminProjectDir(cfg, id)); err == nil && info.IsDir() {
			out = append(out, chatProjectItem{Provider: chatProjectProviderAdmin, ID: id, Name: id})
			seen[id] = true
		}
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		id, ok := validProjectModeName(entry.Name())
		if !ok || seen[id] {
			continue
		}
		name := id
		if b, err := os.ReadFile(filepath.Join(adminProjectRoot(cfg), id, "project.json")); err == nil {
			var meta adminProjectMeta
			if json.Unmarshal(b, &meta) == nil && strings.TrimSpace(meta.Name) != "" {
				name = strings.TrimSpace(meta.Name)
			}
		}
		out = append(out, chatProjectItem{Provider: chatProjectProviderAdmin, ID: id, Name: name})
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

func discoverProjectItems(cfg config.AppConfig) []chatProjectItem {
	out := discoverAdminProjects(cfg)
	for _, name := range discoverProjectNames(cfg.GARoot) {
		out = append(out, chatProjectItem{Provider: chatProjectProviderOfficial, ID: name, Name: name})
	}
	return out
}

func resolveProject(cfg config.AppConfig, provider, id string) (chatProjectItem, string, error) {
	provider, ok := normalizeProjectProvider(provider)
	if !ok {
		return chatProjectItem{}, "", errors.New("invalid project provider")
	}
	id, ok = validProjectModeName(id)
	if !ok {
		return chatProjectItem{}, "", errProjectNameInvalid
	}
	if provider == chatProjectProviderAdmin {
		for _, item := range discoverAdminProjects(cfg) {
			if item.ID == id {
				return item, projectModeWorkspace(cfg, id), nil
			}
		}
		return chatProjectItem{}, "", os.ErrNotExist
	}
	for _, name := range discoverProjectNames(cfg.GARoot) {
		if name == id {
			return chatProjectItem{Provider: provider, ID: id, Name: name}, projectModeWorkspace(cfg, id), nil
		}
	}
	return chatProjectItem{}, "", os.ErrNotExist
}

func projectRequestFields(cs chatSession, cfg config.AppConfig) map[string]interface{} {
	provider := strings.TrimSpace(cs.ProjectProvider)
	id := strings.TrimSpace(cs.ProjectID)
	if provider == "" && cs.ProjectMode != "" {
		provider, id = chatProjectProviderOfficial, cs.ProjectMode
	}
	// Resolve the runtime mode per request; never rewrite session provenance.
	if id != "" {
		provider = chatProjectProviderOfficial
		if cfg.DefaultProjectProvider == chatProjectProviderAdmin {
			provider = chatProjectProviderAdmin
		}
	}
	fields := map[string]interface{}{"project_provider": provider, "project_id": id, "project_mode": ""}
	if id != "" {
		fields["project_workspace"] = projectModeWorkspace(cfg, id)
	}
	if provider == chatProjectProviderOfficial {
		fields["project_mode"] = id
	}
	if provider == chatProjectProviderAdmin {
		fields["project_memory_dir"] = adminProjectDir(cfg, id)
		fields["project_memory_legacy_dir"] = legacyAdminProjectDir(cfg, id)
	}
	return fields
}

func applyProjectRequestFields(req map[string]interface{}, cs chatSession, cfg config.AppConfig) {
	for k, v := range projectRequestFields(cs, cfg) {
		req[k] = v
	}
}

func validateProjectSelection(cfg config.AppConfig, provider, id string) (chatProjectItem, error) {
	item, _, err := resolveProject(cfg, provider, id)
	if err != nil {
		return chatProjectItem{}, fmt.Errorf("project not found")
	}
	return item, nil
}
