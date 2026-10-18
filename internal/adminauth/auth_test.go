package adminauth

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"genericagent-admin-go/internal/config"
)

func authRequest(handler http.Handler, method, path, remote, user, password string, body any) *httptest.ResponseRecorder {
	var payload *bytes.Reader
	if body == nil {
		payload = bytes.NewReader(nil)
	} else {
		data, _ := json.Marshal(body)
		payload = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, path, payload)
	req.RemoteAddr = remote
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if user != "" || password != "" {
		req.SetBasicAuth(user, password)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func testConfigStore(t *testing.T, root string, update func(*config.AppConfig)) *config.Store {
	t.Helper()
	store := config.NewStore(root)
	if update != nil {
		if err := store.UpdateRuntime(update); err != nil {
			t.Fatal(err)
		}
	}
	return store
}

// okHandler stands in for the application behind the auth middleware.
func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
}

func TestAuthManagerRequiresEnvironmentPair(t *testing.T) {
	root := t.TempDir()
	if _, err := newManager(root, "admin", "", testConfigStore(t, root, nil)); err == nil {
		t.Fatal("expected incomplete environment credentials to fail")
	}
	manager, err := newManager(root, "operator", "configured-secret", testConfigStore(t, root, nil))
	if err != nil {
		t.Fatal(err)
	}
	if !manager.external || !manager.PasswordConfigured() {
		t.Fatalf("environment manager state = external %v, configured %v", manager.external, manager.PasswordConfigured())
	}
}

func TestLocalAccessNeedsNoPassword(t *testing.T) {
	root := t.TempDir()
	manager, err := newManager(root, "", "", testConfigStore(t, root, nil))
	if err != nil {
		t.Fatal(err)
	}
	if manager.PasswordConfigured() {
		t.Fatal("a fresh app root must not carry a password")
	}
	handler := manager.Middleware(okHandler())

	for _, path := range []string{"/", "/api/config", "/api/chat/sessions"} {
		if got := authRequest(handler, http.MethodGet, path, "127.0.0.1:5000", "", "", nil); got.Code != http.StatusNoContent {
			t.Fatalf("loopback %s = %d, want 204", path, got.Code)
		}
	}
}

// Remote access binds a dual-stack socket, so the same desktop browser may
// arrive over ::1. It is still the local machine and must stay password-free.
func TestIPv6LoopbackCountsAsLocal(t *testing.T) {
	root := t.TempDir()
	store := testConfigStore(t, root, func(cfg *config.AppConfig) {
		cfg.RemoteAccess = true
		cfg.Port = 8787
	})
	manager, err := newManager(root, "", "", store)
	if err != nil {
		t.Fatal(err)
	}
	handler := manager.Middleware(okHandler())
	password := "Abc12345"
	if got := authRequest(handler, http.MethodPost, authPasswordPath, "127.0.0.1:5000", "", "",
		setPasswordRequest{NewPassword: password, ConfirmPassword: password}); got.Code != http.StatusOK {
		t.Fatalf("set password = %d %s", got.Code, got.Body.String())
	}

	if got := authRequest(handler, http.MethodGet, "/api/config", "[::1]:5000", "", "", nil); got.Code != http.StatusNoContent {
		t.Fatalf("IPv6 loopback = %d, want 204", got.Code)
	}
	// A v4-mapped remote address is loopback only when the mapped address is.
	if got := authRequest(handler, http.MethodGet, "/api/config", "[::ffff:192.168.1.2]:5000", "", "", nil); got.Code != http.StatusUnauthorized {
		t.Fatalf("v4-mapped LAN address = %d, want 401", got.Code)
	}
	if got := authRequest(handler, http.MethodGet, "/api/config", "[fe80::1]:5000", "", "", nil); got.Code != http.StatusUnauthorized {
		t.Fatalf("link-local address = %d, want 401", got.Code)
	}
}

func TestRemoteAccessFailsClosedWithoutPassword(t *testing.T) {
	root := t.TempDir()
	manager, err := newManager(root, "", "", testConfigStore(t, root, nil))
	if err != nil {
		t.Fatal(err)
	}
	handler := manager.Middleware(okHandler())

	got := authRequest(handler, http.MethodGet, "/api/config", "192.168.1.2:5000", "", "", nil)
	if got.Code != http.StatusUnauthorized {
		t.Fatalf("remote request without a password = %d, want 401", got.Code)
	}
	if got.Header().Get("WWW-Authenticate") == "" {
		t.Fatal("401 response is missing the Basic challenge")
	}
	if guessed := authRequest(handler, http.MethodGet, "/api/config", "192.168.1.2:5000", "admin", "admin", nil); guessed.Code != http.StatusUnauthorized {
		t.Fatalf("guessed default credential = %d, want 401", guessed.Code)
	}
}

func TestRemoteAccessAllowsAnonymousWhenOptedIn(t *testing.T) {
	root := t.TempDir()
	store := testConfigStore(t, root, func(cfg *config.AppConfig) {
		cfg.RemoteAccess = true
		cfg.RemoteAllowAnonymous = true
	})
	manager, err := newManager(root, "", "", store)
	if err != nil {
		t.Fatal(err)
	}
	handler := manager.Middleware(okHandler())

	if got := authRequest(handler, http.MethodGet, "/api/config", "192.168.1.2:5000", "", "", nil); got.Code != http.StatusNoContent {
		t.Fatalf("anonymous remote request = %d, want 204", got.Code)
	}
}

func TestPasswordEndpointRejectsUnauthenticatedRemoteClients(t *testing.T) {
	root := t.TempDir()
	store := testConfigStore(t, root, func(cfg *config.AppConfig) {
		cfg.RemoteAccess = true
		cfg.RemoteAllowAnonymous = true
	})
	manager, err := newManager(root, "", "", store)
	if err != nil {
		t.Fatal(err)
	}
	handler := manager.Middleware(okHandler())

	// An anonymous remote client reaches the rest of the API, but must not be
	// able to claim the password and lock the owner out.
	body := setPasswordRequest{NewPassword: "Abc12345", ConfirmPassword: "Abc12345"}
	got := authRequest(handler, http.MethodPost, authPasswordPath, "192.168.1.2:5000", "", "", body)
	if got.Code != http.StatusUnauthorized {
		t.Fatalf("remote password change = %d, want 401", got.Code)
	}
	if manager.PasswordConfigured() {
		t.Fatal("remote client managed to set a password")
	}
}

func TestSetPasswordPersistsAndAuthenticatesRemoteClients(t *testing.T) {
	root := t.TempDir()
	manager, err := newManager(root, "", "", testConfigStore(t, root, nil))
	if err != nil {
		t.Fatal(err)
	}
	handler := manager.Middleware(okHandler())

	weak := "Abc1234"
	weakResponse := authRequest(handler, http.MethodPost, authPasswordPath, "127.0.0.1:5000", "", "",
		setPasswordRequest{NewPassword: weak, ConfirmPassword: weak})
	if weakResponse.Code != http.StatusBadRequest || !bytes.Contains(weakResponse.Body.Bytes(), []byte(`"minimumLength":8`)) {
		t.Fatalf("seven-character password = %d %s, want 400 with minimumLength 8", weakResponse.Code, weakResponse.Body.String())
	}

	// The first password needs no current password: only this machine can set it.
	password := "Abc12345"
	created := authRequest(handler, http.MethodPost, authPasswordPath, "127.0.0.1:5000", "", "",
		setPasswordRequest{NewPassword: password, ConfirmPassword: password})
	if created.Code != http.StatusOK {
		t.Fatalf("set first password = %d %s", created.Code, created.Body.String())
	}

	path := filepath.Join(root, authStateFilename)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatalf("auth file mode = %o, want 600", info.Mode().Perm())
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte(password)) || bytes.Contains(data, []byte(`"password"`)) {
		t.Fatal("auth file contains a plaintext password field or value")
	}

	if got := authRequest(handler, http.MethodGet, "/api/config", "192.168.1.2:5000", "admin", "wrong-secret", nil); got.Code != http.StatusUnauthorized {
		t.Fatalf("wrong credential = %d, want 401", got.Code)
	}
	if got := authRequest(handler, http.MethodGet, "/api/config", "192.168.1.2:5000", "admin", password, nil); got.Code != http.StatusNoContent {
		t.Fatalf("correct credential = %d, want 204", got.Code)
	}

	reloaded, err := newManager(root, "", "", testConfigStore(t, root, nil))
	if err != nil {
		t.Fatal(err)
	}
	if !reloaded.PasswordConfigured() || !reloaded.authenticatePassword("admin", password) {
		t.Fatal("persisted credential was not restored")
	}
}

func TestChangePasswordRequiresCurrentPasswordOnceSet(t *testing.T) {
	root := t.TempDir()
	manager, err := newManager(root, "", "", testConfigStore(t, root, nil))
	if err != nil {
		t.Fatal(err)
	}
	handler := manager.Middleware(okHandler())
	first := "Abc12345"
	if got := authRequest(handler, http.MethodPost, authPasswordPath, "127.0.0.1:5000", "", "",
		setPasswordRequest{NewPassword: first, ConfirmPassword: first}); got.Code != http.StatusOK {
		t.Fatalf("set first password = %d", got.Code)
	}

	next := "Xyz98765"
	blocked := authRequest(handler, http.MethodPost, authPasswordPath, "127.0.0.1:5000", "", "",
		setPasswordRequest{CurrentPassword: "not-it", NewPassword: next, ConfirmPassword: next})
	if blocked.Code != http.StatusUnauthorized {
		t.Fatalf("change with wrong current password = %d, want 401", blocked.Code)
	}
	allowed := authRequest(handler, http.MethodPost, authPasswordPath, "127.0.0.1:5000", "", "",
		setPasswordRequest{CurrentPassword: first, NewPassword: next, ConfirmPassword: next})
	if allowed.Code != http.StatusOK {
		t.Fatalf("change with correct current password = %d %s", allowed.Code, allowed.Body.String())
	}
	if !manager.authenticatePassword("admin", next) {
		t.Fatal("new password does not authenticate")
	}
}

func TestRemovePasswordIsBlockedWhileRemoteAccessNeedsIt(t *testing.T) {
	root := t.TempDir()
	store := testConfigStore(t, root, nil)
	manager, err := newManager(root, "", "", store)
	if err != nil {
		t.Fatal(err)
	}
	handler := manager.Middleware(okHandler())
	password := "Abc12345"
	if got := authRequest(handler, http.MethodPost, authPasswordPath, "127.0.0.1:5000", "", "",
		setPasswordRequest{NewPassword: password, ConfirmPassword: password}); got.Code != http.StatusOK {
		t.Fatalf("set password = %d", got.Code)
	}

	if err := store.UpdateRuntime(func(cfg *config.AppConfig) { cfg.RemoteAccess = true }); err != nil {
		t.Fatal(err)
	}
	blocked := authRequest(handler, http.MethodDelete, authPasswordPath, "127.0.0.1:5000", "", "", nil)
	if blocked.Code != http.StatusConflict {
		t.Fatalf("remove password while remote access needs it = %d, want 409", blocked.Code)
	}

	if err := store.UpdateRuntime(func(cfg *config.AppConfig) { cfg.RemoteAccess = false }); err != nil {
		t.Fatal(err)
	}
	removed := authRequest(handler, http.MethodDelete, authPasswordPath, "127.0.0.1:5000", "", "", nil)
	if removed.Code != http.StatusOK {
		t.Fatalf("remove password = %d %s", removed.Code, removed.Body.String())
	}
	if manager.PasswordConfigured() {
		t.Fatal("password survived removal")
	}
	if _, err := os.Stat(filepath.Join(root, authStateFilename)); !os.IsNotExist(err) {
		t.Fatalf("auth state file still exists: %v", err)
	}
}

func TestAuthStatusReportsPasswordState(t *testing.T) {
	root := t.TempDir()
	manager, err := newManager(root, "", "", testConfigStore(t, root, nil))
	if err != nil {
		t.Fatal(err)
	}
	handler := manager.Middleware(okHandler())

	before := authRequest(handler, http.MethodGet, authStatusPath, "127.0.0.1:5000", "", "", nil)
	if before.Code != http.StatusOK || !bytes.Contains(before.Body.Bytes(), []byte(`"passwordSet":false`)) {
		t.Fatalf("status before setup = %d %s", before.Code, before.Body.String())
	}

	password := "Abc12345"
	if got := authRequest(handler, http.MethodPost, authPasswordPath, "127.0.0.1:5000", "", "",
		setPasswordRequest{NewPassword: password, ConfirmPassword: password}); got.Code != http.StatusOK {
		t.Fatalf("set password = %d", got.Code)
	}
	after := authRequest(handler, http.MethodGet, authStatusPath, "127.0.0.1:5000", "", "", nil)
	if after.Code != http.StatusOK || !bytes.Contains(after.Body.Bytes(), []byte(`"passwordSet":true`)) {
		t.Fatalf("status after setup = %d %s", after.Code, after.Body.String())
	}
}

func (a *Manager) authenticatePassword(user, password string) bool {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.SetBasicAuth(user, password)
	return a.authenticateRequest(req)
}

func TestDerivePasswordHashMatchesPBKDF2Vectors(t *testing.T) {
	for _, tc := range []struct {
		iterations int
		want       string
	}{
		{1, "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"},
		{2, "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43"},
		{4096, "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a"},
	} {
		got := hex.EncodeToString(derivePasswordHash([]byte("password"), []byte("salt"), tc.iterations))
		if got != tc.want {
			t.Fatalf("iterations %d = %s, want %s", tc.iterations, got, tc.want)
		}
	}
}

func TestVerifiedPasswordCacheRejectsWrongAndStalePasswords(t *testing.T) {
	root := t.TempDir()
	manager, err := newManager(root, "", "", testConfigStore(t, root, nil))
	if err != nil {
		t.Fatal(err)
	}
	handler := manager.Middleware(okHandler())
	set := func(current, next string) {
		t.Helper()
		res := authRequest(handler, http.MethodPost, authPasswordPath, "127.0.0.1:5000", "", "", map[string]string{"currentPassword": current, "newPassword": next, "confirmPassword": next})
		if res.Code != http.StatusOK {
			t.Fatalf("set password = %d %s", res.Code, res.Body.String())
		}
	}
	set("", "first-password")
	for i := 0; i < 2; i++ {
		if !manager.authenticatePassword("admin", "first-password") {
			t.Fatalf("attempt %d rejected the correct password", i)
		}
	}
	if manager.authenticatePassword("admin", "wrong-password") || manager.authenticatePassword("other", "first-password") {
		t.Fatal("cache accepted a wrong credential")
	}
	set("first-password", "second-password")
	if manager.authenticatePassword("admin", "first-password") {
		t.Fatal("old password still accepted after change")
	}
	if !manager.authenticatePassword("admin", "second-password") {
		t.Fatal("new password rejected")
	}
}
