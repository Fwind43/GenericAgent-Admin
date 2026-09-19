package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUIThemeGetReturnsDefaultWhenUnset(t *testing.T) {
	s := newConfigTestServer(t)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/ui/theme", nil)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["theme"] != "warm" {
		t.Fatalf("theme=%q want warm", got["theme"])
	}
}

func TestUIThemePutRequiresDangerousHeader(t *testing.T) {
	s := newConfigTestServer(t)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/ui/theme", bytes.NewReader([]byte(`{"theme":"dark"}`)))
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != 428 {
		t.Fatalf("status=%d want 428 body=%s", rr.Code, rr.Body.String())
	}
}

func TestUIThemePutPersistsCanonicalTheme(t *testing.T) {
	s := newConfigTestServer(t)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/ui/theme", bytes.NewReader([]byte(`{"theme":"dark"}`)))
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["theme"] != "dark" {
		t.Fatalf("theme=%q want dark", got["theme"])
	}
	if snap := s.CfgStore.Snapshot().UITheme; snap != "dark" {
		t.Fatalf("stored ui_theme=%q want dark", snap)
	}

	get := httptest.NewRecorder()
	getReq := httptest.NewRequest(http.MethodGet, "/api/ui/theme", nil)
	s.Routes().ServeHTTP(get, getReq)
	if get.Code != http.StatusOK {
		t.Fatalf("GET status=%d body=%s", get.Code, get.Body.String())
	}
	got = map[string]any{}
	if err := json.Unmarshal(get.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["theme"] != "dark" {
		t.Fatalf("GET theme=%q want dark", got["theme"])
	}
}

func TestUIThemePutRejectsUnknownTheme(t *testing.T) {
	s := newConfigTestServer(t)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/ui/theme", bytes.NewReader([]byte(`{"theme":"not-a-theme"}`)))
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", rr.Code, rr.Body.String())
	}
	if snap := s.CfgStore.Snapshot().UITheme; snap == "not-a-theme" {
		t.Fatal("rejected theme was persisted")
	}
}

func TestUIThemePutStoresWhitelistedCustomColorsOnly(t *testing.T) {
	s := newConfigTestServer(t)
	body := []byte(`{"theme":"green","custom":{"--bg":"#F4FAF3","accent":"#2F7D4F","bogus":"#000000","oa-bg":"red; } html{display:none} /*","accent-hover":"url(evil)"}}`)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/ui/theme", bytes.NewReader(body))
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	custom, ok := got["custom"].(map[string]any)
	if !ok {
		t.Fatalf("custom=%v want object", got["custom"])
	}
	if len(custom) != 2 || custom["bg"] != "#F4FAF3" || custom["accent"] != "#2F7D4F" {
		t.Fatalf("custom=%v want only bg/accent whitelist entries", custom)
	}
	stored := s.CfgStore.Snapshot().UICustomColors
	if len(stored) != 2 {
		t.Fatalf("stored=%v want 2 entries", stored)
	}
}

func TestUIThemePutKeepsCustomColorsWhenOnlyThemeChanges(t *testing.T) {
	s := newConfigTestServer(t)
	put := func(body string) *httptest.ResponseRecorder {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/api/ui/theme", bytes.NewReader([]byte(body)))
		markDangerous(req)
		s.Routes().ServeHTTP(rr, req)
		return rr
	}
	if rr := put(`{"theme":"green","custom":{"bg":"#F4FAF3"}}`); rr.Code != http.StatusOK {
		t.Fatalf("seed status=%d body=%s", rr.Code, rr.Body.String())
	}
	// Switching theme without sending custom must not drop the saved palette.
	if rr := put(`{"theme":"dark"}`); rr.Code != http.StatusOK {
		t.Fatalf("switch status=%d body=%s", rr.Code, rr.Body.String())
	}
	if got := s.CfgStore.Snapshot().UICustomColors["bg"]; got != "#F4FAF3" {
		t.Fatalf("bg=%q want #F4FAF3 kept across theme switch", got)
	}
	// An explicit empty object clears it.
	if rr := put(`{"custom":{}}`); rr.Code != http.StatusOK {
		t.Fatalf("clear status=%d body=%s", rr.Code, rr.Body.String())
	}
	if stored := s.CfgStore.Snapshot().UICustomColors; len(stored) != 0 {
		t.Fatalf("stored=%v want cleared", stored)
	}
	get := httptest.NewRecorder()
	s.Routes().ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/api/ui/theme", nil))
	var payload map[string]any
	if err := json.Unmarshal(get.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if empty, ok := payload["custom"].(map[string]any); !ok || len(empty) != 0 {
		t.Fatalf("custom=%v want empty object after clear", payload["custom"])
	}
}

func TestInjectUIPaletteEmitsEscapedBootScript(t *testing.T) {
	data := []byte("<html><head></head><body></body></html>")
	out := string(injectUIPalette(data, "green", map[string]string{"bg": "#F4FAF3", "accent": "</script><script>alert(1)</script>"}, true))
	if !strings.Contains(out, `window.__GA_UI_THEME__="green"`) {
		t.Fatalf("theme boot script missing: %s", out)
	}
	if !strings.Contains(out, `window.__GA_UI_CUSTOM_COLORS__={"bg":"#F4FAF3"}`) {
		t.Fatalf("custom boot script missing or not sanitized: %s", out)
	}
	if strings.Contains(out, "alert(1)") {
		t.Fatalf("unsanitized value reached the injected script: %s", out)
	}
	// An empty palette leaves the document untouched.
	if plain := string(injectUIPalette(data, "green", nil, true)); strings.Contains(plain, "__GA_UI_CUSTOM_COLORS__") {
		t.Fatalf("empty palette injected a script: %s", plain)
	}
}
