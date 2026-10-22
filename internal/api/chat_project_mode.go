package api

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"genericagent-admin-go/internal/config"
)

func projectModeWorkspace(cfg config.AppConfig, name string) string {
	name, ok := validProjectModeName(name)
	if !ok {
		return ""
	}
	return filepath.Join(cfg.GARoot, "temp", "projects", name)
}

var (
	errProjectNameInvalid   = errors.New("项目名必须是 1 个安全的目录名称（不能包含路径分隔符、冒号、控制字符或 `.` / `..`）")
	errProjectGARootMissing = errors.New("GA Root 未配置")
)

// ensureProjectMode gives a project the directory and memory file it needs. It
// is idempotent, because entering a project that already exists must never
// disturb what is in it.
//
// Both /project <name> and the sidebar's new-project button go through here, so
// a project is laid out the same way no matter which one created it.
func ensureProjectMode(cfg config.AppConfig, name string) (string, string, error) {
	clean, ok := validProjectModeName(name)
	if !ok {
		return "", "", errProjectNameInvalid
	}
	if strings.TrimSpace(cfg.GARoot) == "" {
		return "", "", errProjectGARootMissing
	}
	dir := projectModeWorkspace(cfg, clean)
	if dir == "" {
		return "", "", errProjectNameInvalid
	}
	if st, err := os.Lstat(dir); err == nil {
		if st.Mode()&os.ModeSymlink != 0 || !st.IsDir() {
			return "", "", fmt.Errorf("项目路径不是安全目录：`%s`", dir)
		}
	} else if !os.IsNotExist(err) {
		return "", "", fmt.Errorf("无法检查项目目录：%v", err)
	} else if err := os.MkdirAll(dir, 0755); err != nil {
		return "", "", fmt.Errorf("无法创建项目目录：%v", err)
	}
	memoryPath := filepath.Join(dir, "project_memory.md")
	// O_EXCL keeps an existing memory file untouched instead of truncating it.
	if f, err := os.OpenFile(memoryPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644); err == nil {
		if closeErr := f.Close(); closeErr != nil {
			return "", "", fmt.Errorf("无法初始化项目记忆：%v", closeErr)
		}
	} else if !os.IsExist(err) {
		return "", "", fmt.Errorf("无法初始化项目记忆：%v", err)
	}
	return dir, memoryPath, nil
}
