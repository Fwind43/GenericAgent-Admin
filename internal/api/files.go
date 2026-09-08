package api

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"genericagent-admin-go/internal/ga"
)

func (s *Server) filesList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, 405, "method not allowed")
		return
	}
	items, err := ga.ListSafe(s.CfgStore.Snapshot().GARoot, r.URL.Query().Get("path"))
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"items": items})
}

func (s *Server) filesRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, 405, "method not allowed")
		return
	}
	d, err := ga.ReadSafeAny(s.CfgStore.Snapshot().GARoot, r.URL.Query().Get("path"))
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	writeJSON(w, d)
}

func (s *Server) filesImage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, 405, "method not allowed")
		return
	}
	p := strings.TrimSpace(r.URL.Query().Get("path"))
	if p == "" {
		bad(w, 400, "path required")
		return
	}
	var err error
	p, _, err = ga.SafeResolveAny(s.CfgStore.Snapshot().GARoot, p)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	ext := strings.ToLower(filepath.Ext(p))
	mime := map[string]string{
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
		".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml",
	}[ext]
	if mime == "" {
		bad(w, 415, "not a supported image")
		return
	}
	info, err := os.Stat(p)
	if err != nil {
		bad(w, 404, err.Error())
		return
	}
	if info.IsDir() {
		bad(w, 400, "path is directory")
		return
	}
	if info.Size() > 20*1024*1024 {
		bad(w, 413, "image too large")
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if ext == ".svg" {
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'")
	}
	w.Header().Set("Cache-Control", "private, max-age=60")
	http.ServeFile(w, r, p)
}

func (s *Server) filesWrite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		bad(w, 405, "method not allowed")
		return
	}
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := decode(r, &req); err != nil {
		bad(w, 400, err.Error())
		return
	}
	d, err := ga.WriteSafe(s.CfgStore.Snapshot().GARoot, req.Path, req.Content)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	writeJSON(w, d)
}

func (s *Server) filesDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		bad(w, 405, "method not allowed")
		return
	}
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path == "" && r.Body != nil {
		var req struct {
			Path string `json:"path"`
		}
		if err := decode(r, &req); err == nil {
			path = strings.TrimSpace(req.Path)
		}
	}
	if path == "" {
		bad(w, 400, "path required")
		return
	}
	if err := ga.DeleteSafe(s.CfgStore.Snapshot().GARoot, path); err != nil {
		bad(w, 400, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) filesDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, 405, "method not allowed")
		return
	}
	p := strings.TrimSpace(r.URL.Query().Get("path"))
	if p == "" {
		bad(w, 400, "path required")
		return
	}
	var clean string
	var err error
	p, clean, err = ga.SafeResolveAny(s.CfgStore.Snapshot().GARoot, p)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	info, err := os.Stat(p)
	if err != nil {
		bad(w, 404, err.Error())
		return
	}
	if info.IsDir() {
		bad(w, 400, "cannot download directory")
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+strings.ReplaceAll(filepath.Base(clean), "\"", "")+"\"")
	http.ServeFile(w, r, p)
}

func (s *Server) filesTail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, 405, "method not allowed")
		return
	}
	lines := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("lines")); raw != "" {
		var err error
		lines, err = strconv.Atoi(raw)
		if err != nil || lines <= 0 {
			bad(w, 400, "lines must be a positive integer")
			return
		}
	}
	d, err := ga.TailSafe(s.CfgStore.Snapshot().GARoot, r.URL.Query().Get("path"), lines)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	writeJSON(w, d)
}

func (s *Server) filesSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, 405, "method not allowed")
		return
	}
	limit := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		var err error
		limit, err = strconv.Atoi(raw)
		if err != nil || limit <= 0 {
			bad(w, 400, "limit must be a positive integer")
			return
		}
	}
	hits, err := ga.SearchSafe(s.CfgStore.Snapshot().GARoot, r.URL.Query().Get("path"), r.URL.Query().Get("q"), limit)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"hits": hits})
}

func (s *Server) filesOpen(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	var req struct {
		Path string `json:"path"`
		Mode string `json:"mode"`
		ProjectProvider string `json:"project_provider"`
		ProjectID string `json:"project_id"`
	}
	if err := decode(r, &req); err != nil {
		bad(w, 400, "bad request")
		return
	}
	p := strings.TrimSpace(req.Path)
	var err error
	cfg := s.CfgStore.Snapshot()
	if req.ProjectProvider != "" || req.ProjectID != "" {
		if req.ProjectProvider == "" || req.ProjectID == "" || p != "" || req.Mode != "folder" {
			bad(w, 400, "project provider and id require folder mode without path")
			return
		}
		_, p, err = resolveProject(cfg, req.ProjectProvider, req.ProjectID)
	} else {
		if p == "" {
			bad(w, 400, "path required")
			return
		}
		p, _, err = ga.SafeResolveAny(cfg.GARoot, p)
	}
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	info, err := os.Stat(p)
	if err != nil {
		bad(w, 404, err.Error())
		return
	}
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "file"
	}
	if mode != "file" && mode != "folder" {
		bad(w, 400, "mode must be file or folder")
		return
	}
	if err := openLocalPath(p, info.IsDir(), mode); err != nil {
		bad(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

type localPathLaunch struct {
	name       string
	args       []string
	hideWindow bool
}

func localPathLaunchSpec(goos, p string, isDir bool, mode string) localPathLaunch {
	switch goos {
	case "windows":
		if mode == "folder" {
			if isDir {
				return localPathLaunch{name: "explorer", args: []string{p}}
			}
			return localPathLaunch{name: "explorer", args: []string{"/select," + p}}
		}
		return localPathLaunch{
			name:       "rundll32",
			args:       []string{"url.dll,FileProtocolHandler", p},
			hideWindow: true,
		}
	case "darwin":
		if mode == "folder" {
			if isDir {
				return localPathLaunch{name: "open", args: []string{p}, hideWindow: true}
			}
			return localPathLaunch{name: "open", args: []string{"-R", p}, hideWindow: true}
		}
		return localPathLaunch{name: "open", args: []string{p}, hideWindow: true}
	default:
		if mode == "folder" && !isDir {
			p = filepath.Dir(p)
		}
		return localPathLaunch{name: "xdg-open", args: []string{p}, hideWindow: true}
	}
}

func openLocalPath(p string, isDir bool, mode string) error {
	launch := localPathLaunchSpec(runtime.GOOS, p, isDir, mode)
	cmd := exec.Command(launch.name, launch.args...)
	if launch.hideWindow {
		hideChildWindow(cmd)
	}
	return cmd.Start()
}
