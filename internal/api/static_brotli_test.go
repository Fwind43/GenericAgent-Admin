package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestStaticBrotliNegotiation(t *testing.T) {
	s := &Server{Static: fstest.MapFS{
		"assets/app.js":     &fstest.MapFile{Data: []byte("original javascript")},
		"assets/app.js.br":  &fstest.MapFile{Data: []byte("precompressed bytes")},
		"assets/missing.js": &fstest.MapFile{Data: []byte("fallback")},
		"index.html":        &fstest.MapFile{Data: []byte("index")},
		"index.html.br":     &fstest.MapFile{Data: []byte("must not serve")},
	}}
	for _, tc := range []struct{ accept, path, encoding string }{
		{"br, gzip", "/assets/app.js", "br"},
		{"br;q=0, gzip", "/assets/app.js", "gzip"},
		{"br;q=0.2, gzip;q=0.8", "/assets/app.js", "gzip"},
		{"br;q=0.8, gzip;q=0.2", "/assets/app.js", "br"},
		{"*;q=0.5, br;q=0", "/assets/app.js", "gzip"},
		{"br;q=invalid", "/assets/app.js", ""},
		{"", "/assets/app.js", ""},
		{"br, gzip", "/assets/missing.js", "gzip"},
		{"br", "/assets/missing.js", ""},
		{"br", "/", ""},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		req.Header.Set("Accept-Encoding", tc.accept)
		rr := httptest.NewRecorder()
		s.static(rr, req)
		if rr.Code != 200 || rr.Header().Get("Content-Encoding") != tc.encoding {
			t.Fatalf("%+v: status=%d headers=%v", tc, rr.Code, rr.Header())
		}
		if tc.encoding == "br" && rr.Body.String() != "precompressed bytes" {
			t.Fatal("sidecar not served")
		}
		head := httptest.NewRecorder()
		req.Method = http.MethodHead
		s.static(head, req)
		if head.Body.Len() != 0 || head.Header().Get("Content-Length") != rr.Header().Get("Content-Length") {
			t.Fatal("HEAD mismatch")
		}
		req.Method = http.MethodGet
		req.Header.Set("If-None-Match", rr.Header().Get("ETag"))
		cached := httptest.NewRecorder()
		s.static(cached, req)
		if cached.Code != 304 || cached.Body.Len() != 0 {
			t.Fatal("revalidation failed")
		}
	}
}
