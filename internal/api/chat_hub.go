package api

import (
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// chatHubSession is the stable identity advertised to the official GA Hub.
type chatHubSession struct {
	Peer       string `json:"peer"`
	InstanceID string `json:"instance_id"`
	SessionID  string `json:"session_id"`
	Title      string `json:"title"`
	UpdatedAt  int64  `json:"updated_at"`
	Pinned     bool   `json:"pinned"`
}

func chatHubPeer(instanceID, sessionID string) string {
	if strings.TrimSpace(instanceID) == "" {
		instanceID = "default"
	}
	return "ga-admin/" + instanceID + "/" + sessionID
}

func randomChatHubToken() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func (s *Server) chatHubServerForInstance(instanceID string) (*Server, error) {
	req := httptest.NewRequest(http.MethodGet, "/?instance_id="+url.QueryEscape(instanceID), nil)
	server, _, err := s.chatServerForRequest(req)
	return server, err
}

func (s *Server) listChatHubSessions(allowAll bool) []chatHubSession {
	cfg := s.CfgStore.Snapshot()
	ids := make([]string, 0, len(cfg.Instances)+1)
	seen := map[string]bool{}
	if id := strings.TrimSpace(cfg.DefaultInstanceID); id != "" {
		ids = append(ids, id)
		seen[id] = true
	}
	for _, instance := range cfg.Instances {
		if id := strings.TrimSpace(instance.ID); id != "" && !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	if len(ids) == 0 {
		// Legacy single-instance configurations have no explicit instance ID.
		// An empty selector resolves to the root server; chatHubPeer still
		// advertises that scope as "default".
		ids = append(ids, "")
	}
	out := []chatHubSession{}
	for _, instanceID := range ids {
		server, err := s.chatHubServerForInstance(instanceID)
		if err != nil {
			continue
		}
		summaries, err := server.loadChatSessionSummaries(server.CfgStore.Snapshot())
		if err != nil {
			continue
		}
		for _, cs := range summaries {
			if cs.ID == "" || (!allowAll && !cs.HubEnabled) {
				continue
			}
			advertisedInstanceID := instanceID
			if advertisedInstanceID == "" {
				// Keep a non-empty path segment: net/http canonicalizes a double
				// slash before dispatch, so the bridge uses "_" for legacy scope.
				advertisedInstanceID = "_"
			}
			out = append(out, chatHubSession{
				Peer: chatHubPeer(instanceID, cs.ID), InstanceID: advertisedInstanceID,
				SessionID: cs.ID, Title: cs.Title, UpdatedAt: cs.UpdatedAt, Pinned: cs.Pinned,
			})
		}
	}
	// Match the Admin chat history view: pinned sessions first, then the most
	// recently updated sessions. Identity fields make same-second ties stable.
	sort.Slice(out, func(i, j int) bool {
		if out[i].Pinned != out[j].Pinned {
			return out[i].Pinned
		}
		if out[i].UpdatedAt != out[j].UpdatedAt {
			return out[i].UpdatedAt > out[j].UpdatedAt
		}
		if out[i].InstanceID != out[j].InstanceID {
			return out[i].InstanceID < out[j].InstanceID
		}
		return out[i].SessionID < out[j].SessionID
	})
	return out
}

func chatHubTasks(cs chatSession) []map[string]interface{} {
	tasks := []map[string]interface{}{}
	for _, message := range cs.Messages {
		switch message.Role {
		case "user":
			tasks = append(tasks, map[string]interface{}{"input": message.Content, "outputs": []string{}})
		case "assistant":
			if len(tasks) == 0 {
				continue
			}
			outputs, _ := tasks[len(tasks)-1]["outputs"].([]string)
			segments := []string{}
			for _, output := range message.Outputs {
				if text := strings.TrimSpace(output); text != "" {
					segments = append(segments, text)
				}
			}
			if len(segments) > 0 {
				outputs = append(outputs, segments...)
			} else if text := strings.TrimSpace(message.Content); text != "" {
				outputs = append(outputs, text)
			}
			tasks[len(tasks)-1]["outputs"] = outputs
		}
	}
	return tasks
}

// chatHubLiveTasks lends Hub the text a run has streamed so far. Only an empty
// assistant placeholder reaches disk before a turn ends, and Hub tails a step by
// watching its length grow, so the remote view stays blank for the whole turn
// unless the in-flight text is offered here as the last segment.
func chatHubLiveTasks(tasks []map[string]interface{}, partial string) []map[string]interface{} {
	partial = strings.TrimSpace(partial)
	if partial == "" || len(tasks) == 0 {
		return tasks
	}
	last := tasks[len(tasks)-1]
	outputs, _ := last["outputs"].([]string)
	last["outputs"] = append(outputs, partial)
	return tasks
}

func (s *Server) chatHubAPI(token string) http.Handler {
	return s.chatSessionBridgeAPI(token, false)
}

func (s *Server) chatSessionBridgeAPI(token string, allowAll bool) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/sessions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			bad(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		writeJSON(w, map[string]interface{}{"sessions": s.listChatHubSessions(allowAll)})
	})
	mux.HandleFunc("/session/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/session/"), "/")
		if len(parts) == 2 && parts[1] == "new" {
			if !allowAll {
				bad(w, http.StatusNotFound, "not found")
				return
			}
			if r.Method != http.MethodPost {
				bad(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			advertisedInstanceID := parts[0]
			instanceID := advertisedInstanceID
			if instanceID == "_" {
				instanceID = ""
			}
			server, err := s.chatHubServerForInstance(instanceID)
			if err != nil {
				bad(w, http.StatusNotFound, err.Error())
				return
			}
			cs := chatSession{
				ID:         newChatID(),
				Title:      "\u65b0\u4f1a\u8bdd",
				Messages:   []chatMessage{},
				Settings:   server.defaultChatSettings(),
				RawHistory: []map[string]interface{}{},
			}
			if err := saveChatSession(server.CfgStore.Snapshot(), cs); err != nil {
				bad(w, http.StatusInternalServerError, "failed to create session")
				return
			}
			persisted, err := loadChatSession(server.CfgStore.Snapshot(), cs.ID)
			if err != nil {
				bad(w, http.StatusInternalServerError, "failed to load created session")
				return
			}
			writeJSON(w, chatHubSession{
				Peer:       chatHubPeer(instanceID, persisted.ID),
				InstanceID: advertisedInstanceID,
				SessionID:  persisted.ID,
				Title:      persisted.Title,
				UpdatedAt:  persisted.UpdatedAt,
				Pinned:     persisted.Pinned,
			})
			return
		}
		if len(parts) != 3 {
			bad(w, http.StatusNotFound, "not found")
			return
		}
		instanceID, sid, op := parts[0], safeChatID(parts[1]), parts[2]
		if instanceID == "_" {
			instanceID = ""
		}
		server, err := s.chatHubServerForInstance(instanceID)
		if err != nil {
			bad(w, http.StatusNotFound, err.Error())
			return
		}
		cs, err := loadChatSession(server.CfgStore.Snapshot(), sid)
		if err != nil || (!allowAll && !cs.HubEnabled) {
			bad(w, http.StatusNotFound, "session not available to bridge")
			return
		}
		switch op {
		case "outputs":
			tasks := chatHubTasks(cs)
			if r.URL.Query().Get("live") != "0" && server.chatRunActive(sid) {
				tasks = chatHubLiveTasks(tasks, server.chatRunPartialContent(sid))
			}
			writeJSON(w, map[string]interface{}{"tasks": tasks})
		case "snapshot":
			run := server.chatRunActive(sid)
			partial := ""
			if run {
				partial = server.chatRunPartialContent(sid)
			}
			runID, turns := server.chatRunStructuredSnapshot(sid)
			writeJSON(w, map[string]interface{}{
				"tasks":   chatHubTasks(cs),
				"run":     run,
				"run_id":  runID,
				"partial": partial,
				"turns":   turns,
			})
		case "state":
			writeJSON(w, map[string]interface{}{"run": server.chatRunActive(sid)})
		case "put":
			var req struct {
				Text string `json:"text"`
			}
			if err := decodeLimited(r, &req, maxChatPostBodyBytes); err != nil || strings.TrimSpace(req.Text) == "" {
				bad(w, http.StatusBadRequest, "text required")
				return
			}
			body, _ := json.Marshal(map[string]string{"prompt": req.Text})
			inner := httptest.NewRequest(http.MethodPost, "/api/chat/"+sid, strings.NewReader(string(body)))
			inner.Header.Set("Content-Type", "application/json")
			server.chatPostMode(w, inner, sid, true)
		case "abort":
			inner := httptest.NewRequest(http.MethodPost, "/api/chat/cancel/"+sid, nil)
			server.chatCancel(w, inner, sid)
		default:
			bad(w, http.StatusNotFound, "not found")
		}
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			bad(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		mux.ServeHTTP(w, r)
	})
}

//go:embed chat_hub_bridge.py
var embeddedChatHubBridge []byte

func writeChatHubBridgeScript() (string, error) {
	file, err := os.CreateTemp("", "ga-admin-chat-hub-*.py")
	if err != nil {
		return "", err
	}
	path := file.Name()
	if _, err = file.Write(embeddedChatHubBridge); err == nil {
		err = file.Close()
	} else {
		_ = file.Close()
	}
	if err != nil {
		_ = os.Remove(path)
		return "", err
	}
	return path, nil
}

func newChatHubBridgeCommand(python, script string) *exec.Cmd {
	cmd := exec.Command(python, script)
	hideChildWindow(cmd)
	return cmd
}

// StartChatHubBridge starts one lightweight process which exposes all Admin sessions.
func (s *Server) StartChatHubBridge() {
	if s == nil {
		return
	}
	s.chatHubBridgeMu.Lock()
	defer s.chatHubBridgeMu.Unlock()
	if s.chatHubBridgeCmd != nil {
		return
	}
	cfg := s.CfgStore.Snapshot()
	if _, err := os.Stat(filepath.Join(cfg.GARoot, "frontends", "hub.py")); err != nil {
		return
	}
	script, err := writeChatHubBridgeScript()
	if err != nil {
		return
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		_ = os.Remove(script)
		return
	}
	token := randomChatHubToken()
	httpServer := &http.Server{Handler: s.chatHubAPI(token), ReadHeaderTimeout: 5 * time.Second}
	python := resolveUsablePythonForRoot(cfg.GARoot, cfg.EffectivePython, cfg.PythonFallbackRoots)
	cmd := newChatHubBridgeCommand(python, script)
	cmd.Env = append(pythonEnvWithAdminProxy(cfg), "GA_ROOT="+cfg.GARoot, "GA_ADMIN_HUB_API=http://"+listener.Addr().String(), "GA_ADMIN_HUB_TOKEN="+token)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		log.Printf("chat hub bridge: start %q failed: %v", python, err)
		_ = listener.Close()
		_ = os.Remove(script)
		return
	}
	s.chatHubBridgeCmd = cmd
	s.chatHubBridgeServer = httpServer
	go func() { _ = httpServer.Serve(listener) }()
	go func() {
		err := cmd.Wait()
		_ = httpServer.Close()
		_ = os.Remove(script)
		s.chatHubBridgeMu.Lock()
		unexpected := s.chatHubBridgeCmd == cmd
		if unexpected {
			s.chatHubBridgeCmd = nil
			s.chatHubBridgeServer = nil
		}
		s.chatHubBridgeMu.Unlock()
		if unexpected {
			log.Printf("chat hub bridge: process exited: %v", err)
		}
	}()
}

func (s *Server) StopChatHubBridge() {
	if s == nil {
		return
	}
	s.chatHubBridgeMu.Lock()
	cmd, server := s.chatHubBridgeCmd, s.chatHubBridgeServer
	s.chatHubBridgeCmd, s.chatHubBridgeServer = nil, nil
	s.chatHubBridgeMu.Unlock()
	if server != nil {
		_ = server.Close()
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}
