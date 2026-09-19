package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"

	"genericagent-admin-go/internal/config"
)

func (s *Server) uiTheme(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, map[string]any{
			"theme":  effectiveUITheme(s.storedUITheme()),
			"custom": s.storedUICustomColors(),
		})
		return
	case http.MethodPut:
		if !requireDangerousHeader(w, r) {
			return
		}
		var req struct {
			Theme  string             `json:"theme"`
			Custom *map[string]string `json:"custom"`
		}
		if err := decode(r, &req); err != nil {
			bad(w, http.StatusBadRequest, err.Error())
			return
		}
		theme := canonicalUITheme(req.Theme)
		if strings.TrimSpace(req.Theme) != "" && theme == "" {
			bad(w, http.StatusBadRequest, "ui_theme must be one of light, warm, dark, green")
			return
		}
		if s.ConfigMu != nil {
			s.ConfigMu.Lock()
			defer s.ConfigMu.Unlock()
		}
		cfg := s.CfgStore.Snapshot()
		if theme != "" {
			cfg.UITheme = theme
		}
		if req.Custom != nil {
			// An explicit object replaces the palette; an empty object clears it.
			cfg.UICustomColors = config.NormalizeUICustomColors(*req.Custom)
		}
		if err := s.CfgStore.Save(cfg); err != nil {
			bad(w, http.StatusBadRequest, err.Error())
			return
		}
		saved := s.CfgStore.Snapshot()
		writeJSON(w, map[string]any{
			"theme":  effectiveUITheme(saved.UITheme),
			"custom": sanitizeUICustomColors(saved.UICustomColors),
		})
		return
	default:
		bad(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) storedUITheme() string {
	if s == nil || s.CfgStore == nil {
		return ""
	}
	return canonicalUITheme(s.CfgStore.Snapshot().UITheme)
}

func (s *Server) storedUICustomColors() map[string]string {
	if s == nil || s.CfgStore == nil {
		return map[string]string{}
	}
	return sanitizeUICustomColors(s.CfgStore.Snapshot().UICustomColors)
}

// sanitizeUICustomColors returns a non-nil map so the JSON payload always
// carries a `custom` object the client can render without extra guards.
func sanitizeUICustomColors(value map[string]string) map[string]string {
	out := config.NormalizeUICustomColors(value)
	if out == nil {
		return map[string]string{}
	}
	return out
}

func canonicalUITheme(value string) string {
	theme := strings.TrimSpace(value)
	if config.ValidUITheme(theme) {
		return theme
	}
	return ""
}

func effectiveUITheme(value string) string {
	if theme := canonicalUITheme(value); theme != "" {
		return theme
	}
	return config.DefaultUITheme
}

func injectUITheme(data []byte, theme string) []byte {
	return injectUIPalette(data, theme, nil, false)
}

func injectUIPalette(data []byte, theme string, custom map[string]string, withCustom bool) []byte {
	if len(data) == 0 {
		return data
	}
	snippet := []byte{}
	if canonicalTheme := canonicalUITheme(theme); canonicalTheme != "" {
		if encoded, err := json.Marshal(canonicalTheme); err == nil {
			snippet = append(snippet, []byte(`<script>window.__GA_UI_THEME__=`)...)
			snippet = append(snippet, encoded...)
			snippet = append(snippet, []byte(`;</script>`)...)
		}
	}
	if withCustom {
		// The boot script paints custom tokens before React mounts so the first
		// frame already matches the persisted palette. An empty palette leaves
		// the HTML untouched.
		if colors := sanitizeUICustomColors(custom); len(colors) > 0 {
			if encoded, err := json.Marshal(colors); err == nil {
				snippet = append(snippet, []byte(`<script>window.__GA_UI_CUSTOM_COLORS__=`)...)
				snippet = append(snippet, encoded...)
				snippet = append(snippet, []byte(`;</script>`)...)
			}
		}
	}
	if len(snippet) == 0 {
		return data
	}
	if i := bytes.Index(data, []byte("</head>")); i >= 0 {
		out := make([]byte, 0, len(data)+len(snippet))
		out = append(out, data[:i]...)
		out = append(out, snippet...)
		out = append(out, data[i:]...)
		return out
	}
	return append(snippet, data...)
}
