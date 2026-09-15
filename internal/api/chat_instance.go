package api

import (
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync"

	"genericagent-admin-go/internal/config"
)

type chatInstanceNotFoundError struct {
	instanceID string
}

func (e *chatInstanceNotFoundError) Error() string {
	return fmt.Sprintf("instance %q not found", e.instanceID)
}

// chatRuntime owns all mutable in-memory chat state for one GA instance.
// Keeping the mutexes with the maps prevents request-scoped Server copies from
// accidentally copying a live mutex.
type chatLoopControllerRun struct {
	Epoch    int64
	Worker   *chatWorker
	Canceled bool
}

type chatRuntime struct {
	chatMu              sync.Mutex
	sessionMu           sync.Mutex
	usageMu             sync.Mutex
	queueEventMu        sync.Mutex
	queueEventRev       map[string]uint64
	queueEventSubs      map[string]map[chan uint64]struct{}
	runs                map[string]*chatRun
	workers             map[string]*chatWorker
	loopControllers     map[string]*chatLoopControllerRun
	titleJobs           map[string]bool
	loopRecoveryOnce    sync.Once
	loopRecoveryErr     error
	sessionListMu       sync.Mutex
	sessionListPath     string
	sessionListEntries  map[string]chatSessionListIndexEntry
	sessionListLoaded   bool
	sessionListLoadHook func(string)
}

type chatRuntimeRegistry struct {
	mu      sync.Mutex
	entries map[string]*chatRuntime
}

func newChatRuntimeRegistry() *chatRuntimeRegistry {
	return &chatRuntimeRegistry{entries: make(map[string]*chatRuntime)}
}

func (r *chatRuntimeRegistry) runtime(instanceID string) *chatRuntime {
	instanceID = strings.TrimSpace(instanceID)
	r.mu.Lock()
	defer r.mu.Unlock()
	if runtime := r.entries[instanceID]; runtime != nil {
		return runtime
	}
	runtime := &chatRuntime{
		queueEventRev:   make(map[string]uint64),
		queueEventSubs:  make(map[string]map[chan uint64]struct{}),
		runs:            make(map[string]*chatRun),
		workers:         make(map[string]*chatWorker),
		loopControllers: make(map[string]*chatLoopControllerRun),
		titleJobs:       make(map[string]bool),
	}
	r.entries[instanceID] = runtime
	return runtime
}

func requestedInstanceID(r *http.Request) string {
	instanceID := strings.TrimSpace(r.URL.Query().Get("instance_id"))
	if instanceID == "" {
		instanceID = strings.TrimSpace(r.Header.Get("X-GA-Instance-ID"))
	}
	return instanceID
}

func (s *Server) chatRequestServer(cfgStore, baseStore *config.Store, runtime *chatRuntime) *Server {
	clone := &Server{
		CfgStore:                cfgStore,
		Svc:                     s.Svc,
		InstanceManagers:        s.InstanceManagers,
		Models:                  s.Models,
		Static:                  s.Static,
		ReactApp:                s.ReactApp,
		ChatMu:                  s.ChatMu,
		SessionMu:               s.SessionMu,
		UsageMu:                 s.UsageMu,
		ConfigMu:                s.ConfigMu,
		ChatRuns:                s.ChatRuns,
		ChatWorkers:             s.ChatWorkers,
		ChatLoopControllers:     s.ChatLoopControllers,
		ChatTitleJobs:           s.ChatTitleJobs,
		ChatRuntimes:            s.ChatRuntimes,
		ChatRuntime:             s.ChatRuntime,
		ChatLLMCache:            s.ChatLLMCache,
		BaseCfgStore:            baseStore,
		titleBackfillStarted:    s.titleBackfillStarted,
		chatSessionMutationHook: s.chatSessionMutationHook,
		chatExactSaveHook:       s.chatExactSaveHook,
		chatWorldlineRPCHook:    s.chatWorldlineRPCHook,
	}
	if runtime != nil {
		clone.ChatMu = &runtime.chatMu
		clone.SessionMu = &runtime.sessionMu
		clone.UsageMu = &runtime.usageMu
		clone.ChatRuns = runtime.runs
		clone.ChatWorkers = runtime.workers
		clone.ChatLoopControllers = runtime.loopControllers
		clone.ChatTitleJobs = runtime.titleJobs
		clone.ChatRuntime = runtime
	}
	return clone
}

// pythonFallbackRoots lists the interpreters and GA roots that may lend an
// interpreter to the instance identified by skipID: every sibling instance's
// configured python and root, plus the base config's own python and root.
// Order matters, callers probe these in sequence.
func pythonFallbackRoots(base config.AppConfig, skipID string) []string {
	var out []string
	add := func(v string) {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	for _, sibling := range base.Instances {
		if sibling.ID == skipID {
			continue
		}
		add(sibling.PythonPath)
		add(sibling.EffectivePython)
		add(sibling.GARoot)
	}
	add(base.PythonPath)
	add(base.EffectivePython)
	add(base.GARoot)
	return out
}

func (s *Server) chatServerForRequest(r *http.Request) (*Server, string, error) {
	baseStore := s.BaseCfgStore
	if baseStore == nil {
		baseStore = s.CfgStore
	}
	if baseStore == nil {
		return nil, "", fmt.Errorf("config store is not initialized")
	}

	instanceID := requestedInstanceID(r)
	instance, ok := baseStore.Snapshot().Instance(instanceID)
	if !ok {
		// Preserve the legacy single-instance test/server setup, which has no
		// instance registry yet.
		if instanceID == "" && len(baseStore.Snapshot().Instances) == 0 {
			return s.chatRequestServer(s.CfgStore, baseStore, nil), "", nil
		}
		return nil, instanceID, &chatInstanceNotFoundError{instanceID: instanceID}
	}
	instanceID = instance.ID

	cfg := baseStore.Snapshot()
	cfg.GARoot = instance.GARoot
	cfg.PythonPath = instance.PythonPath
	cfg.EffectivePython = instance.EffectivePython
	// A freshly created instance is a bare GA checkout: no .venv of its own, so
	// the only interpreter that can import GA's dependencies usually belongs to
	// another instance. Carry those roots so interpreter resolution can borrow
	// one instead of falling back to a bare launcher that lacks requests.
	cfg.PythonFallbackRoots = pythonFallbackRoots(baseStore.Snapshot(), instance.ID)
	// NewRuntimeStore normalizes the legacy GARoot/Python compatibility fields
	// from DefaultInstanceID. Scope the derived request configuration to the
	// selected instance so normalization cannot restore the global default.
	cfg.DefaultInstanceID = instanceID
	cfg.Instances = []config.InstanceConfig{instance}
	runtimeID := instanceID
	if instanceID == "default" {
		// The migrated legacy instance keeps both the legacy data directory and
		// in-memory runtime. This prevents a first config save from moving an
		// active legacy chat into instances/default halfway through its lifetime.
		cfg.ChatDataDir = baseStore.Snapshot().ChatDataDir
		runtimeID = ""
	} else {
		cfg.ChatDataDir = filepath.Join(baseStore.Snapshot().ChatDataDir, "instances", instanceID)
	}
	instanceStore, err := config.NewRuntimeStore(baseStore.Root, cfg)
	if err != nil {
		return nil, instanceID, fmt.Errorf("prepare runtime config for instance %q: %w", instanceID, err)
	}

	registry := s.ChatRuntimes
	if registry == nil {
		registry = newChatRuntimeRegistry()
		s.ChatRuntimes = registry
	}
	runtime := registry.runtime(runtimeID)
	return s.chatRequestServer(instanceStore, baseStore, runtime), instanceID, nil
}

func (s *Server) withChatInstance(next func(*Server, http.ResponseWriter, *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		chatServer, instanceID, err := s.chatServerForRequest(r)
		if err != nil {
			status := http.StatusInternalServerError
			var notFound *chatInstanceNotFoundError
			if errors.As(err, &notFound) {
				status = http.StatusNotFound
			}
			bad(w, status, err.Error())
			return
		}
		if err := chatServer.recoverChatLoopsAfterRestart(); err != nil {
			bad(w, http.StatusInternalServerError, err.Error())
			return
		}
		setResolvedInstanceHeader(w, instanceID)
		next(chatServer, w, r)
	}
}
