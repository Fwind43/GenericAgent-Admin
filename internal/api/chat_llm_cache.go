package api

import (
	"strings"
	"sync"
	"time"

	"genericagent-admin-go/internal/config"
)

const (
	chatLLMCacheTTL      = 15 * time.Second
	chatLLMErrorCacheTTL = time.Second
)

type chatLLMCacheKey struct {
	gaRoot     string
	python     string
	instanceID string
	proxyMode  string
	httpProxy  string
	httpsProxy string
	allProxy   string
	noProxy    string
}

type chatLLMCacheEntry struct {
	ready     chan struct{}
	llms      []map[string]interface{}
	err       error
	expiresAt time.Time
}

type chatLLMCache struct {
	mu       sync.Mutex
	entries  map[chatLLMCacheKey]*chatLLMCacheEntry
	ttl      time.Duration
	errorTTL time.Duration
	now      func() time.Time
}

func newChatLLMCache() *chatLLMCache {
	return &chatLLMCache{
		entries:  make(map[chatLLMCacheKey]*chatLLMCacheEntry),
		ttl:      chatLLMCacheTTL,
		errorTTL: chatLLMErrorCacheTTL,
		now:      time.Now,
	}
}

func chatLLMKey(cfg config.AppConfig) chatLLMCacheKey {
	return chatLLMCacheKey{
		gaRoot:     strings.TrimSpace(cfg.GARoot),
		python:     strings.TrimSpace(chatPythonForConfig(cfg)),
		instanceID: strings.TrimSpace(cfg.DefaultInstanceID),
		proxyMode:  strings.TrimSpace(cfg.ProxyMode),
		httpProxy:  strings.TrimSpace(cfg.HTTPProxy),
		httpsProxy: strings.TrimSpace(cfg.HTTPSProxy),
		allProxy:   strings.TrimSpace(cfg.AllProxy),
		noProxy:    strings.TrimSpace(cfg.NoProxy),
	}
}

func (s *Server) cachedGARuntimeLLMs(cfg config.AppConfig) ([]map[string]interface{}, error) {
	if s == nil || s.ChatLLMCache == nil {
		llms, err := s.listGARuntimeLLMs(cfg)
		return cloneChatLLMs(llms), err
	}
	key := chatLLMKey(cfg)
	return s.ChatLLMCache.load(key, func() ([]map[string]interface{}, error) {
		return s.listGARuntimeLLMs(cfg)
	})
}

func (s *Server) invalidateGARuntimeLLMs(cfg config.AppConfig) {
	if s == nil || s.ChatLLMCache == nil {
		return
	}
	s.ChatLLMCache.invalidate(chatLLMKey(cfg))
}

func (c *chatLLMCache) load(key chatLLMCacheKey, loader func() ([]map[string]interface{}, error)) ([]map[string]interface{}, error) {
	for {
		c.mu.Lock()
		now := c.now()
		if entry := c.entries[key]; entry != nil {
			if entry.ready != nil {
				ready := entry.ready
				c.mu.Unlock()
				<-ready
				continue
			}
			if now.Before(entry.expiresAt) {
				llms, err := cloneChatLLMs(entry.llms), entry.err
				c.mu.Unlock()
				return llms, err
			}
			delete(c.entries, key)
		}

		entry := &chatLLMCacheEntry{ready: make(chan struct{})}
		c.entries[key] = entry
		c.mu.Unlock()

		llms, err := loader()
		stored := cloneChatLLMs(llms)

		c.mu.Lock()
		entry.llms = stored
		entry.err = err
		ttl := c.ttl
		if err != nil {
			ttl = c.errorTTL
		}
		entry.expiresAt = c.now().Add(ttl)
		close(entry.ready)
		entry.ready = nil
		// Invalidation can remove this entry while its loader is running. In that
		// case, leave it removed so requests started after the save cannot observe
		// the pre-save model list.
		if current := c.entries[key]; current != entry {
			c.mu.Unlock()
			return cloneChatLLMs(stored), err
		}
		c.mu.Unlock()
		return cloneChatLLMs(stored), err
	}
}

func (c *chatLLMCache) invalidate(key chatLLMCacheKey) {
	c.mu.Lock()
	delete(c.entries, key)
	c.mu.Unlock()
}

func cloneChatLLMs(llms []map[string]interface{}) []map[string]interface{} {
	if llms == nil {
		return nil
	}
	cloned := make([]map[string]interface{}, len(llms))
	for i, item := range llms {
		cloned[i] = make(map[string]interface{}, len(item))
		for key, value := range item {
			cloned[i][key] = cloneChatLLMValue(value)
		}
	}
	return cloned
}

func cloneChatLLMValue(value interface{}) interface{} {
	switch value := value.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(value))
		for key, item := range value {
			out[key] = cloneChatLLMValue(item)
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(value))
		for i, item := range value {
			out[i] = cloneChatLLMValue(item)
		}
		return out
	case []map[string]interface{}:
		return cloneChatLLMs(value)
	default:
		return value
	}
}
