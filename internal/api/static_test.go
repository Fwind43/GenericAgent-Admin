package api

import (
	"compress/gzip"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"genericagent-admin-go/internal/config"
)

func TestStaticRejectsTraversalSegments(t *testing.T) {
	s := &Server{Static: fstest.MapFS{
		"index.html":      &fstest.MapFile{Data: []byte("index")},
		"assets/app.js":   &fstest.MapFile{Data: []byte("app")},
		"../secret.txt":   &fstest.MapFile{Data: []byte("secret")},
		`assets\\evil.js`: &fstest.MapFile{Data: []byte("evil")},
	}}
	for _, target := range []string{
		"/../secret.txt",
		"/assets/../secret.txt",
		`/assets\\evil.js`,
	} {
		t.Run(target, func(t *testing.T) {
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, target, nil)
			s.static(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want=%d body=%s", rr.Code, http.StatusBadRequest, rr.Body.String())
			}
		})
	}
}

func TestStaticRejectsNonReadMethods(t *testing.T) {
	s := &Server{Static: fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("index")},
	}}
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
		t.Run(method, func(t *testing.T) {
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(method, "/", nil)
			s.static(rr, req)
			if rr.Code != http.StatusMethodNotAllowed {
				t.Fatalf("status=%d want=%d body=%s", rr.Code, http.StatusMethodNotAllowed, rr.Body.String())
			}
		})
	}
}

func TestStaticServesCleanAssetPath(t *testing.T) {
	s := &Server{Static: fstest.MapFS{
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log('ok')")},
	}}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	s.static(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=%d body=%s", rr.Code, http.StatusOK, rr.Body.String())
	}
	if rr.Body.String() != "console.log('ok')" {
		t.Fatalf("body=%q", rr.Body.String())
	}
}

func TestStaticCachesAndCompressesHashedAssets(t *testing.T) {
	body := strings.Repeat("console.log('compress me');", 40)
	s := &Server{Static: fstest.MapFS{
		"assets/app-abc123.js": &fstest.MapFile{Data: []byte(body)},
	}}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/assets/app-abc123.js", nil)
	req.Header.Set("Accept-Encoding", "br, gzip")
	s.static(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=%d body=%s", rr.Code, http.StatusOK, rr.Body.String())
	}
	if got := rr.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("Cache-Control=%q", got)
	}
	if got := rr.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding=%q", got)
	}
	if got := rr.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Fatalf("Vary=%q", got)
	}
	if got := rr.Header().Get("Content-Type"); got != "application/javascript" {
		t.Fatalf("Content-Type=%q", got)
	}
	zr, err := gzip.NewReader(rr.Body)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	if err := zr.Close(); err != nil {
		t.Fatal(err)
	}
	if string(decoded) != body {
		t.Fatalf("decoded body mismatch: got %d bytes want %d", len(decoded), len(body))
	}
}

func TestStaticDoesNotGzipWhenExplicitlyRejected(t *testing.T) {
	body := strings.Repeat("body{}", 40)
	s := &Server{Static: fstest.MapFS{
		"assets/app.css": &fstest.MapFile{Data: []byte(body)},
	}}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/assets/app.css", nil)
	req.Header.Set("Accept-Encoding", "br, gzip;q=0")
	s.static(rr, req)

	if got := rr.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("Content-Encoding=%q", got)
	}
	if rr.Body.String() != body {
		t.Fatalf("body mismatch: got %d bytes want %d", rr.Body.Len(), len(body))
	}
}

func TestStaticDoesNotCacheIndexOrSPAFallback(t *testing.T) {
	s := &Server{Static: fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<main>app</main>")},
	}}
	for _, target := range []string{"/", "/settings/models"} {
		t.Run(target, func(t *testing.T) {
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, target, nil)
			s.static(rr, req)
			if got := rr.Header().Get("Cache-Control"); got != "no-cache" {
				t.Fatalf("Cache-Control=%q", got)
			}
			if got := rr.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
				t.Fatalf("Content-Type=%q", got)
			}
			if rr.Body.String() != "<main>app</main>" {
				t.Fatalf("body=%q", rr.Body.String())
			}
		})
	}
}

func TestStaticHEADMatchesSelectedGzipRepresentationWithoutBody(t *testing.T) {
	body := strings.Repeat("export const answer = 42;", 40)
	s := &Server{Static: fstest.MapFS{
		"assets/app-hash.js": &fstest.MapFile{Data: []byte(body)},
	}}
	get := httptest.NewRecorder()
	getReq := httptest.NewRequest(http.MethodGet, "/assets/app-hash.js", nil)
	getReq.Header.Set("Accept-Encoding", "gzip")
	s.static(get, getReq)

	head := httptest.NewRecorder()
	headReq := httptest.NewRequest(http.MethodHead, "/assets/app-hash.js", nil)
	headReq.Header.Set("Accept-Encoding", "gzip")
	s.static(head, headReq)

	if head.Body.Len() != 0 {
		t.Fatalf("HEAD body has %d bytes", head.Body.Len())
	}
	for _, name := range []string{"Cache-Control", "Content-Encoding", "Content-Length", "Content-Type", "Vary"} {
		if got, want := head.Header().Get(name), get.Header().Get(name); got != want {
			t.Fatalf("%s=%q want %q", name, got, want)
		}
	}
}

func TestStaticInjectsPersistedUIThemeIntoIndex(t *testing.T) {
	store := config.NewStore(t.TempDir())
	cfg := store.Snapshot()
	cfg.UITheme = "dark"
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}
	html := "<html><head></head><body>app</body></html>"
	s := &Server{
		CfgStore: store,
		Static: fstest.MapFS{
			"index.html": &fstest.MapFile{Data: []byte(html)},
		},
	}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	s.static(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	got := rr.Body.String()
	if !strings.Contains(got, `window.__GA_UI_THEME__="dark"`) {
		t.Fatalf("missing injected theme: body=%q", got)
	}
	if !strings.Contains(got, html) && !strings.Contains(got, "</head>") {
		t.Fatalf("expected original index markup, body=%q", got)
	}
}

func TestStaticDoesNotInjectUIThemeWhenUnset(t *testing.T) {
	html := "<main>app</main>"
	s := &Server{Static: fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte(html)},
	}}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	s.static(rr, req)
	if rr.Body.String() != html {
		t.Fatalf("unset theme should not rewrite index, body=%q", rr.Body.String())
	}
}

func TestStaticRevalidatesRootAssetsWithETag(t *testing.T) {
	font := "wOF2 font bytes"
	s := &Server{Static: fstest.MapFS{
		"fonts/misans/a.woff2": &fstest.MapFile{Data: []byte(font)},
	}}
	first := httptest.NewRecorder()
	s.static(first, httptest.NewRequest(http.MethodGet, "/fonts/misans/a.woff2", nil))
	etag := first.Header().Get("ETag")
	if first.Code != http.StatusOK || etag == "" {
		t.Fatalf("status=%d ETag=%q", first.Code, etag)
	}
	if got := first.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("Cache-Control=%q", got)
	}
	for name, validator := range map[string]string{
		"exact": etag,
		"weak":  "W/" + etag,
		"list":  `"stale", ` + etag,
		"any":   "*",
	} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			t.Run(name+"/"+method, func(t *testing.T) {
				rr := httptest.NewRecorder()
				req := httptest.NewRequest(method, "/fonts/misans/a.woff2", nil)
				req.Header.Set("If-None-Match", validator)
				s.static(rr, req)
				if rr.Code != http.StatusNotModified || rr.Body.Len() != 0 {
					t.Fatalf("status=%d body=%d bytes", rr.Code, rr.Body.Len())
				}
				if got := rr.Header().Get("ETag"); got != etag {
					t.Fatalf("ETag=%q want %q", got, etag)
				}
				if got := rr.Header().Get("Cache-Control"); got != "no-cache" {
					t.Fatalf("Cache-Control=%q", got)
				}
			})
		}
	}
	stale := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/fonts/misans/a.woff2", nil)
	req.Header.Set("If-None-Match", `"stale"`)
	s.static(stale, req)
	if stale.Code != http.StatusOK || stale.Body.String() != font {
		t.Fatalf("stale validator status=%d body=%q", stale.Code, stale.Body.String())
	}
}

func TestStaticETagDistinguishesGzipRepresentation(t *testing.T) {
	body := strings.Repeat("body{color:red}", 40)
	s := &Server{Static: fstest.MapFS{
		"theme.css": &fstest.MapFile{Data: []byte(body)},
	}}
	fetch := func(acceptEncoding, validator string) *httptest.ResponseRecorder {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/theme.css", nil)
		if acceptEncoding != "" {
			req.Header.Set("Accept-Encoding", acceptEncoding)
		}
		if validator != "" {
			req.Header.Set("If-None-Match", validator)
		}
		s.static(rr, req)
		return rr
	}
	gz := fetch("gzip", "")
	plain := fetch("", "")
	gzTag, plainTag := gz.Header().Get("ETag"), plain.Header().Get("ETag")
	if gzTag == "" || plainTag == "" || gzTag == plainTag {
		t.Fatalf("gzip ETag=%q identity ETag=%q", gzTag, plainTag)
	}
	cross := fetch("gzip", plainTag)
	if cross.Code != http.StatusOK || cross.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("identity validator on gzip request: status=%d encoding=%q", cross.Code, cross.Header().Get("Content-Encoding"))
	}
	notModified := fetch("gzip", gzTag)
	if notModified.Code != http.StatusNotModified || notModified.Body.Len() != 0 {
		t.Fatalf("status=%d body=%d bytes", notModified.Code, notModified.Body.Len())
	}
	if got := notModified.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Fatalf("Vary=%q", got)
	}
}

func TestStaticIndexETagTracksInjectedTheme(t *testing.T) {
	store := config.NewStore(t.TempDir())
	setTheme := func(theme string) {
		cfg := store.Snapshot()
		cfg.UITheme = theme
		if err := store.Save(cfg); err != nil {
			t.Fatal(err)
		}
	}
	setTheme("dark")
	s := &Server{
		CfgStore: store,
		Static: fstest.MapFS{
			"index.html": &fstest.MapFile{Data: []byte("<html><head></head><body>app</body></html>")},
		},
	}
	dark := httptest.NewRecorder()
	s.static(dark, httptest.NewRequest(http.MethodGet, "/", nil))
	darkTag := dark.Header().Get("ETag")
	if dark.Code != http.StatusOK || darkTag == "" {
		t.Fatalf("status=%d ETag=%q", dark.Code, darkTag)
	}

	setTheme("light")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("If-None-Match", darkTag)
	s.static(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("theme change must invalidate cached index: status=%d", rr.Code)
	}
	if got := rr.Header().Get("ETag"); got == "" || got == darkTag {
		t.Fatalf("ETag=%q dark ETag=%q", got, darkTag)
	}
	if rr.Body.String() == dark.Body.String() {
		t.Fatalf("index body did not change with theme: %q", rr.Body.String())
	}
}

var _ fs.FS = fstest.MapFS{}
