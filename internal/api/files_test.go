package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestFilesTailRejectsInvalidLinesQuery(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "sample.log"), []byte("one\ntwo\n"), 0644); err != nil {
		t.Fatal(err)
	}
	h := newGoalTestServer(t, root).Routes()

	for _, raw := range []string{"abc", "0", "-3"} {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/files/tail?path=sample.log&lines="+raw, nil)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("lines=%q status=%d want=400 body=%s", raw, rr.Code, rr.Body.String())
		}
		if !strings.Contains(rr.Body.String(), "lines") {
			t.Fatalf("lines=%q unexpected error body: %s", raw, rr.Body.String())
		}
	}
}

func TestFilesSearchRejectsInvalidLimitQuery(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "sample.log"), []byte("alpha\nbeta\n"), 0644); err != nil {
		t.Fatal(err)
	}
	h := newGoalTestServer(t, root).Routes()

	for _, raw := range []string{"abc", "0", "-3"} {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/files/search?path=.&q=alpha&limit="+raw, nil)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("limit=%q status=%d want=400 body=%s", raw, rr.Code, rr.Body.String())
		}
		if !strings.Contains(rr.Body.String(), "limit") {
			t.Fatalf("limit=%q unexpected error body: %s", raw, rr.Body.String())
		}
	}
}

func TestFilesImageServesSVGWithIsolationHeaders(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "x.svg"), []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), 0644); err != nil {
		t.Fatal(err)
	}
	h := newGoalTestServer(t, root).Routes()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/files/image?path=x.svg", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("Content-Type"); !strings.Contains(got, "image/svg+xml") {
		t.Fatalf("Content-Type=%q want image/svg+xml", got)
	}
	if got := rr.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options=%q want nosniff", got)
	}
	if got := rr.Header().Get("Content-Security-Policy"); !strings.Contains(got, "sandbox") || !strings.Contains(got, "default-src 'none'") {
		t.Fatalf("Content-Security-Policy=%q missing SVG sandbox", got)
	}
}

func TestFilesOpenRequiresDangerousConfirm(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "sample.txt"), []byte("visible"), 0644); err != nil {
		t.Fatal(err)
	}
	h := newGoalTestServer(t, root).Routes()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/files/open", strings.NewReader(`{"path":"sample.txt","mode":"file"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("status=%d want=428 body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "X-GA-Confirm") {
		t.Fatalf("unexpected error body: %s", rr.Body.String())
	}
}

func TestFilesOpenRejectsInvalidProjectFields(t *testing.T) {
	h := newGoalTestServer(t, t.TempDir()).Routes()
	cases := []struct {
		name string
		body string
	}{
		{"missing_provider", `{"project_id":"demo","mode":"folder"}`},
		{"missing_id", `{"project_provider":"admin","mode":"folder"}`},
		{"mixed_path", `{"project_provider":"admin","project_id":"demo","path":".","mode":"folder"}`},
		{"file_mode", `{"project_provider":"admin","project_id":"demo","mode":"file"}`},
		{"unknown_provider", `{"project_provider":"unknown","project_id":"demo","mode":"folder"}`},
		{"admin_traversal", `{"project_provider":"admin","project_id":"../outside","mode":"folder"}`},
		{"official_traversal", `{"project_provider":"official","project_id":"../outside","mode":"folder"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/files/open", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-GA-Confirm", "dangerous")
			h.ServeHTTP(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want=400 body=%s", rr.Code, rr.Body.String())
			}
		})
	}
}

func TestFilesOpenRejectsInvalidMode(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "sample.txt"), []byte("visible"), 0644); err != nil {
		t.Fatal(err)
	}
	h := newGoalTestServer(t, root).Routes()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/files/open", strings.NewReader(`{"path":"sample.txt","mode":"bogus"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GA-Confirm", "dangerous")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=400 body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "mode") {
		t.Fatalf("unexpected error body: %s", rr.Body.String())
	}
}

func TestFilesEndpointsRejectRelativePathTraversal(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "ga-root")
	if err := os.Mkdir(root, 0755); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(base, "outside.txt")
	if err := os.WriteFile(outside, []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	outsideImage := filepath.Join(base, "outside.svg")
	if err := os.WriteFile(outsideImage, []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 0644); err != nil {
		t.Fatal(err)
	}
	h := newGoalTestServer(t, root).Routes()

	cases := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "list", method: http.MethodGet, path: "/api/files/list?path=.."},
		{name: "read", method: http.MethodGet, path: "/api/files/read?path=" + url.QueryEscape("../outside.txt")},
		{name: "image", method: http.MethodGet, path: "/api/files/image?path=" + url.QueryEscape("../outside.svg")},
		{name: "download", method: http.MethodGet, path: "/api/files/download?path=" + url.QueryEscape("../outside.txt")},
		{name: "tail", method: http.MethodGet, path: "/api/files/tail?path=" + url.QueryEscape("../outside.txt")},
		{name: "search", method: http.MethodGet, path: "/api/files/search?path=..&q=secret"},
		{name: "write", method: http.MethodPost, path: "/api/files/write", body: `{"path":"../outside.txt","content":"pwned"}`},
		{name: "open", method: http.MethodPost, path: "/api/files/open", body: `{"path":"../outside.txt","mode":"file"}`},
		{name: "delete", method: http.MethodPost, path: "/api/files/delete", body: `{"path":"../outside.txt"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, bytes.NewBufferString(tc.body))
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			if tc.method == http.MethodPost {
				req.Header.Set("X-GA-Confirm", "dangerous")
			}
			h.ServeHTTP(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want=400 body=%s", rr.Code, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), "escapes GA root") {
				t.Fatalf("unexpected error body: %s", rr.Body.String())
			}
		})
	}
	got, err := os.ReadFile(outside)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "secret" {
		t.Fatalf("outside file was modified: %q", got)
	}
}

func TestFilesEndpointsAcceptExplicitAbsolutePathsOutsideRoot(t *testing.T) {
	root := t.TempDir()
	outsideDir := t.TempDir()
	target := filepath.Join(outsideDir, "outside.txt")
	if err := os.WriteFile(target, []byte("alpha\nomega"), 0644); err != nil {
		t.Fatal(err)
	}
	image := filepath.Join(outsideDir, "outside.svg")
	imageContent := `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>`
	if err := os.WriteFile(image, []byte(imageContent), 0644); err != nil {
		t.Fatal(err)
	}
	h := newGoalTestServer(t, root).Routes()

	do := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if method == http.MethodPost {
			req.Header.Set("X-GA-Confirm", "dangerous")
		}
		h.ServeHTTP(rr, req)
		return rr
	}
	assertOK := func(name string, rr *httptest.ResponseRecorder) {
		t.Helper()
		if rr.Code != http.StatusOK {
			t.Fatalf("%s status=%d want=200 body=%s", name, rr.Code, rr.Body.String())
		}
	}

	rr := do(http.MethodGet, "/api/files/list?path="+url.QueryEscape(outsideDir), "")
	assertOK("list", rr)
	if !strings.Contains(rr.Body.String(), "outside.txt") {
		t.Fatalf("list body missing outside.txt: %s", rr.Body.String())
	}

	rr = do(http.MethodGet, "/api/files/read?path="+url.QueryEscape(target), "")
	assertOK("read", rr)
	if !strings.Contains(rr.Body.String(), "omega") {
		t.Fatalf("read body missing content: %s", rr.Body.String())
	}

	rr = do(http.MethodGet, "/api/files/tail?path="+url.QueryEscape(target)+"&lines=1", "")
	assertOK("tail", rr)
	if !strings.Contains(rr.Body.String(), "omega") {
		t.Fatalf("tail body missing final line: %s", rr.Body.String())
	}

	rr = do(http.MethodGet, "/api/files/search?path="+url.QueryEscape(outsideDir)+"&q=omega", "")
	assertOK("search", rr)
	if !strings.Contains(rr.Body.String(), "omega") {
		t.Fatalf("search body missing hit: %s", rr.Body.String())
	}

	rr = do(http.MethodGet, "/api/files/download?path="+url.QueryEscape(target), "")
	assertOK("download", rr)
	if rr.Body.String() != "alpha\nomega" {
		t.Fatalf("download body=%q", rr.Body.String())
	}

	rr = do(http.MethodGet, "/api/files/image?path="+url.QueryEscape(image), "")
	assertOK("image", rr)
	if rr.Body.String() != imageContent {
		t.Fatalf("image body=%q", rr.Body.String())
	}

	missing := filepath.Join(outsideDir, "missing.txt")
	rr = do(http.MethodPost, "/api/files/open", `{"path":`+strconv.Quote(missing)+`,"mode":"file"}`)
	if rr.Code != http.StatusNotFound || strings.Contains(rr.Body.String(), "escapes GA root") {
		t.Fatalf("open status=%d want=404 after absolute path resolution body=%s", rr.Code, rr.Body.String())
	}

	created := filepath.Join(outsideDir, "created.txt")
	rr = do(http.MethodPost, "/api/files/write", `{"path":`+strconv.Quote(created)+`,"content":"created"}`)
	assertOK("write", rr)
	got, err := os.ReadFile(created)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "created" {
		t.Fatalf("written content=%q", got)
	}

	rr = do(http.MethodPost, "/api/files/delete", `{"path":`+strconv.Quote(created)+`}`)
	assertOK("delete", rr)
	if _, err := os.Stat(created); !os.IsNotExist(err) {
		t.Fatalf("deleted absolute path still exists or stat failed unexpectedly: %v", err)
	}
}

func TestFilesDownloadServesFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "download.txt"), []byte("payload"), 0644); err != nil {
		t.Fatal(err)
	}
	h := newGoalTestServer(t, root).Routes()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/files/download?path=download.txt", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	if rr.Body.String() != "payload" {
		t.Fatalf("body=%q want payload", rr.Body.String())
	}
	if got := rr.Header().Get("Content-Disposition"); !strings.Contains(got, "download.txt") {
		t.Fatalf("Content-Disposition=%q", got)
	}
}

func TestFilesDeleteRequiresDangerousConfirmAndDeletes(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "delete-me.txt")
	if err := os.WriteFile(target, []byte("gone"), 0644); err != nil {
		t.Fatal(err)
	}
	h := newGoalTestServer(t, root).Routes()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/files/delete", strings.NewReader(`{"path":"delete-me.txt"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("status=%d want=428 body=%s", rr.Code, rr.Body.String())
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("file removed without dangerous confirm: %v", err)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/files/delete", strings.NewReader(`{"path":"delete-me.txt"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GA-Confirm", "dangerous")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("file still exists or stat failed unexpectedly: %v", err)
	}
}

func TestFilesEndpointsHideLegacyGeneratedModelConfig(t *testing.T) {
	root := t.TempDir()
	legacyPath := filepath.Join(root, "mykey_admin.generated.py")
	if err := os.WriteFile(legacyPath, []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "mykey.py"), []byte("official"), 0644); err != nil {
		t.Fatal(err)
	}
	h := newGoalTestServer(t, root).Routes()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/files/list?path=.", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "mykey_admin.generated.py") {
		t.Fatalf("legacy generated model config leaked in list response: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "mykey.py") {
		t.Fatalf("official mykey.py missing from list response: %s", rr.Body.String())
	}

	cases := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "read", method: http.MethodGet, path: "/api/files/read?path=mykey_admin.generated.py"},
		{name: "tail", method: http.MethodGet, path: "/api/files/tail?path=mykey_admin.generated.py"},
		{name: "image", method: http.MethodGet, path: "/api/files/image?path=mykey_admin.generated.py"},
		{name: "download", method: http.MethodGet, path: "/api/files/download?path=mykey_admin.generated.py"},
		{name: "search direct", method: http.MethodGet, path: "/api/files/search?path=mykey_admin.generated.py&q=secret"},
		{name: "write", method: http.MethodPost, path: "/api/files/write", body: `{"path":"mykey_admin.generated.py","content":"changed"}`},
		{name: "open", method: http.MethodPost, path: "/api/files/open", body: `{"path":"mykey_admin.generated.py","mode":"file"}`},
		{name: "delete", method: http.MethodPost, path: "/api/files/delete", body: `{"path":"mykey_admin.generated.py"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := bytes.NewReader([]byte(tc.body))
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, body)
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			if tc.method == http.MethodPost {
				req.Header.Set("X-GA-Confirm", "dangerous")
			}
			h.ServeHTTP(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want=400 body=%s", rr.Code, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), "legacy generated model config is hidden") {
				t.Fatalf("unexpected body: %s", rr.Body.String())
			}
		})
	}

	got, err := os.ReadFile(legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "secret" {
		t.Fatalf("legacy file content changed to %q", got)
	}
}

func TestLocalPathLaunchSpecWindowsExplorerIsVisible(t *testing.T) {
	path := `C:\\work\\report.txt`

	dir := localPathLaunchSpec("windows", path, true, "folder")
	if dir.name != "explorer" || len(dir.args) != 1 || dir.args[0] != path || dir.hideWindow {
		t.Fatalf("directory launch=%#v, want visible explorer %q", dir, path)
	}

	fileInFolder := localPathLaunchSpec("windows", path, false, "folder")
	if fileInFolder.name != "explorer" || len(fileInFolder.args) != 1 || fileInFolder.args[0] != "/select,"+path || fileInFolder.hideWindow {
		t.Fatalf("file-in-folder launch=%#v, want visible explorer selection", fileInFolder)
	}

	file := localPathLaunchSpec("windows", path, false, "file")
	wantArgs := []string{"url.dll,FileProtocolHandler", path}
	if file.name != "rundll32" || len(file.args) != len(wantArgs) || file.args[0] != wantArgs[0] || file.args[1] != wantArgs[1] || !file.hideWindow {
		t.Fatalf("file launch=%#v, want hidden rundll32 %#v", file, wantArgs)
	}
}
