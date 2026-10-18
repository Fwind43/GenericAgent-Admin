// Package adminauth guards non-loopback access to the admin server.
package adminauth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"genericagent-admin-go/internal/config"
)

// UserEnv and PasswordEnv name the credential an operator can pin from outside
// the app. They only take effect together.
const (
	UserEnv     = "GA_ADMIN_AUTH_USER"
	PasswordEnv = "GA_ADMIN_AUTH_PASSWORD"
)

const (
	defaultAuthUser      = "admin"
	authStateFilename    = "auth.local.json"
	authHashIterations   = 210000
	authSaltBytes        = 16
	minimumAdminPassword = 8
	maximumAuthBodyBytes = 64 << 10
	authStatusPath       = "/api/auth/status"
	authPasswordPath     = "/api/auth/password"
)

type authDiskState struct {
	Username   string `json:"username"`
	Salt       string `json:"salt"`
	Hash       string `json:"hash"`
	Iterations int    `json:"iterations"`
}

// Manager guards non-loopback access to the admin server. Requests from
// this machine are always trusted: the admin server binds loopback unless the
// operator explicitly turns on remote access, so a local request already
// implies local control of the account.
type Manager struct {
	mu         sync.RWMutex
	path       string
	cfg        *config.Store
	username   string
	password   string
	salt       []byte
	hash       []byte
	iterations int
	configured bool
	external   bool

	// The derived hash costs tens of milliseconds and browsers resend Basic
	// credentials on every request, so the last verified password is kept as
	// a keyed digest; cleared whenever the credential changes.
	cacheKey []byte
	verified atomic.Pointer[[]byte]
}

// New builds a manager for appRoot, taking the credential from the environment
// when UserEnv and PasswordEnv are set.
func New(appRoot string, cfg *config.Store) (*Manager, error) {
	return newManager(appRoot, os.Getenv(UserEnv), os.Getenv(PasswordEnv), cfg)
}

func newManager(appRoot, envUser, envPassword string, cfg *config.Store) (*Manager, error) {
	cacheKey := make([]byte, sha256.Size)
	if _, err := rand.Read(cacheKey); err != nil {
		return nil, fmt.Errorf("init auth cache: %w", err)
	}
	manager := &Manager{path: filepath.Join(appRoot, authStateFilename), cfg: cfg, username: defaultAuthUser, cacheKey: cacheKey}
	if (envUser == "") != (envPassword == "") {
		return nil, fmt.Errorf("%s and %s must be set together", UserEnv, PasswordEnv)
	}
	if envUser != "" {
		manager.username = envUser
		manager.password = envPassword
		manager.configured = true
		manager.external = true
		return manager, nil
	}

	data, err := os.ReadFile(manager.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// No password yet. That is the normal state for a loopback-only
			// install and must not block anything.
			return manager, nil
		}
		return nil, fmt.Errorf("read %s: %w", authStateFilename, err)
	}
	var state authDiskState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("parse %s: %w", authStateFilename, err)
	}
	salt, saltErr := base64.RawStdEncoding.DecodeString(state.Salt)
	hash, hashErr := base64.RawStdEncoding.DecodeString(state.Hash)
	if saltErr != nil || hashErr != nil || state.Username == "" || len(salt) < authSaltBytes || len(hash) != sha256.Size || state.Iterations < 100000 {
		return nil, fmt.Errorf("invalid %s", authStateFilename)
	}
	manager.username = state.Username
	manager.salt = salt
	manager.hash = hash
	manager.iterations = state.Iterations
	manager.configured = true
	return manager, nil
}

// Middleware wraps next with the loopback exemption, the password challenge,
// and the two endpoints that report and change the credential.
func (a *Manager) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		local := isLoopbackRemote(r.RemoteAddr)

		if r.URL.Path == authPasswordPath {
			// Setting the credential is a local-machine operation. Were an
			// anonymous remote client allowed to do it, whoever reached the
			// port first could lock the owner out of their own admin server.
			if !local && !a.authenticateRequest(r) {
				a.challenge(w)
				return
			}
			a.handlePassword(w, r)
			return
		}

		if !local && !a.authorize(w, r) {
			return
		}
		if r.URL.Path == authStatusPath {
			a.handleStatus(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// authorize reports whether a non-loopback request may proceed, answering it
// with a challenge when it may not.
func (a *Manager) authorize(w http.ResponseWriter, r *http.Request) bool {
	if a.anonymousRemoteAllowed() {
		return true
	}
	if a.authenticateRequest(r) {
		return true
	}
	a.challenge(w)
	return false
}

func (a *Manager) challenge(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Basic realm="GA Admin", charset="UTF-8"`)
	w.Header().Set("Cache-Control", "no-store")
	http.Error(w, "authentication required", http.StatusUnauthorized)
}

// anonymousRemoteAllowed reports whether remote clients may skip the password.
// When no password has been configured this stays false, so an unfinished
// remote setup fails closed with a challenge instead of opening the server.
func (a *Manager) anonymousRemoteAllowed() bool {
	a.mu.RLock()
	external := a.external
	a.mu.RUnlock()
	if external {
		return false
	}
	return a.cfg.Snapshot().RemoteAllowAnonymous
}

func (a *Manager) authenticateRequest(r *http.Request) bool {
	user, password, ok := r.BasicAuth()
	if !ok {
		return false
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	if !a.configured || !secureEqual(user, a.username) {
		return false
	}
	return a.passwordMatchesLocked(password)
}

// PasswordConfigured reports whether a credential exists for remote clients.
func (a *Manager) PasswordConfigured() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.configured
}

func (a *Manager) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeAuthJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	writeAuthJSON(w, http.StatusOK, map[string]any{
		"username":             a.username,
		"passwordSet":          a.configured,
		"managedByEnvironment": a.external,
	})
}

type setPasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
	ConfirmPassword string `json:"confirmPassword"`
}

func (a *Manager) handlePassword(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		a.handleSetPassword(w, r)
	case http.MethodDelete:
		a.handleRemovePassword(w)
	default:
		w.Header().Set("Allow", http.MethodPost+", "+http.MethodDelete)
		writeAuthJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
	}
}

func (a *Manager) handleSetPassword(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		writeAuthJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "json_required"})
		return
	}
	var req setPasswordRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, maximumAuthBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeAuthJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	if req.NewPassword != req.ConfirmPassword {
		writeAuthJSON(w, http.StatusBadRequest, map[string]string{"error": "password_confirmation_mismatch"})
		return
	}
	if len(req.NewPassword) < minimumAdminPassword || len(req.NewPassword) > 256 {
		writeAuthJSON(w, http.StatusBadRequest, map[string]any{"error": "weak_password", "minimumLength": minimumAdminPassword})
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.external {
		writeAuthJSON(w, http.StatusConflict, map[string]string{"error": "managed_by_environment"})
		return
	}
	if a.configured && !a.passwordMatchesLocked(req.CurrentPassword) {
		writeAuthJSON(w, http.StatusUnauthorized, map[string]string{"error": "current_password_incorrect"})
		return
	}
	salt := make([]byte, authSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		writeAuthJSON(w, http.StatusInternalServerError, map[string]string{"error": "password_update_failed"})
		return
	}
	hash := derivePasswordHash([]byte(req.NewPassword), salt, authHashIterations)
	state := authDiskState{Username: a.username, Salt: base64.RawStdEncoding.EncodeToString(salt), Hash: base64.RawStdEncoding.EncodeToString(hash), Iterations: authHashIterations}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil || writePrivateFileAtomic(a.path, append(data, '\n')) != nil {
		writeAuthJSON(w, http.StatusInternalServerError, map[string]string{"error": "password_update_failed"})
		return
	}
	a.password = ""
	a.salt = salt
	a.hash = hash
	a.iterations = authHashIterations
	a.configured = true
	a.verified.Store(nil)
	writeAuthJSON(w, http.StatusOK, map[string]any{"ok": true, "passwordSet": true})
}

func (a *Manager) handleRemovePassword(w http.ResponseWriter) {
	cfg := a.cfg.Snapshot()
	if cfg.RemoteAccess && !cfg.RemoteAllowAnonymous {
		// Removing the credential here would leave remote access permanently
		// unanswerable; the operator has to relax remote access first.
		writeAuthJSON(w, http.StatusConflict, map[string]string{"error": "password_required_by_remote_access"})
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.external {
		writeAuthJSON(w, http.StatusConflict, map[string]string{"error": "managed_by_environment"})
		return
	}
	if err := os.Remove(a.path); err != nil && !errors.Is(err, os.ErrNotExist) {
		writeAuthJSON(w, http.StatusInternalServerError, map[string]string{"error": "password_update_failed"})
		return
	}
	a.password = ""
	a.salt = nil
	a.hash = nil
	a.iterations = 0
	a.configured = false
	a.verified.Store(nil)
	writeAuthJSON(w, http.StatusOK, map[string]any{"ok": true, "passwordSet": false})
}

func (a *Manager) passwordMatchesLocked(password string) bool {
	if a.password != "" {
		return secureEqual(password, a.password)
	}
	if len(a.hash) == 0 {
		return false
	}
	digest := a.cacheDigest(password)
	if cached := a.verified.Load(); cached != nil && hmac.Equal(*cached, digest) {
		return true
	}
	candidate := derivePasswordHash([]byte(password), a.salt, a.iterations)
	if subtle.ConstantTimeCompare(candidate, a.hash) != 1 {
		return false
	}
	a.verified.Store(&digest)
	return true
}

func (a *Manager) cacheDigest(password string) []byte {
	mac := hmac.New(sha256.New, a.cacheKey)
	mac.Write(a.hash)
	mac.Write([]byte(password))
	return mac.Sum(nil)
}

func derivePasswordHash(password, salt []byte, iterations int) []byte {
	mac := hmac.New(sha256.New, password)
	mac.Write(salt)
	mac.Write([]byte{0, 0, 0, 1})
	u := mac.Sum(nil)
	result := append([]byte(nil), u...)
	for i := 1; i < iterations; i++ {
		mac.Reset()
		mac.Write(u)
		u = mac.Sum(u[:0])
		for j := range result {
			result[j] ^= u[j]
		}
	}
	return result
}

func writePrivateFileAtomic(path string, data []byte) (err error) {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".auth-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		tmp.Close()
		if err != nil {
			os.Remove(tmpName)
		}
	}()
	if err = tmp.Chmod(0600); err != nil {
		return err
	}
	if _, err = tmp.Write(data); err != nil {
		return err
	}
	if err = tmp.Sync(); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmpName, path); err != nil {
		return err
	}
	return os.Chmod(path, 0600)
}

// isLoopbackRemote reports whether a request came from this machine. Remote
// access binds a dual-stack wildcard socket, so a local browser that resolves
// localhost to ::1 must be recognised as local just like one that picks
// 127.0.0.1; otherwise enabling remote access would start prompting the owner
// for a password on their own desktop.
func isLoopbackRemote(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func secureEqual(got, expected string) bool {
	gotHash := sha256.Sum256([]byte(got))
	expectedHash := sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(gotHash[:], expectedHash[:]) == 1
}

func writeAuthJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
