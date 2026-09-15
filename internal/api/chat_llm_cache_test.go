package api

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestChatLLMCacheHitExpiryAndErrorRecovery(t *testing.T) {
	now := time.Unix(100, 0)
	cache := newChatLLMCache()
	cache.ttl = 10 * time.Second
	cache.errorTTL = time.Second
	cache.now = func() time.Time { return now }
	key := chatLLMCacheKey{gaRoot: "ga", python: "python"}
	var calls atomic.Int32
	loader := func() ([]map[string]interface{}, error) {
		n := calls.Add(1)
		if n == 2 {
			return nil, errors.New("temporary")
		}
		return []map[string]interface{}{{"model": "m", "load": n}}, nil
	}

	first, err := cache.load(key, loader)
	if err != nil || calls.Load() != 1 || first[0]["load"] != int32(1) {
		t.Fatalf("cold load: calls=%d llms=%#v err=%v", calls.Load(), first, err)
	}
	second, err := cache.load(key, loader)
	if err != nil || calls.Load() != 1 || second[0]["load"] != int32(1) {
		t.Fatalf("cache hit: calls=%d llms=%#v err=%v", calls.Load(), second, err)
	}

	now = now.Add(11 * time.Second)
	if _, err = cache.load(key, loader); err == nil || calls.Load() != 2 {
		t.Fatalf("expired error load: calls=%d err=%v", calls.Load(), err)
	}
	if _, err = cache.load(key, loader); err == nil || calls.Load() != 2 {
		t.Fatalf("error should be briefly cached: calls=%d err=%v", calls.Load(), err)
	}
	now = now.Add(2 * time.Second)
	recovered, err := cache.load(key, loader)
	if err != nil || calls.Load() != 3 || recovered[0]["load"] != int32(3) {
		t.Fatalf("error recovery: calls=%d llms=%#v err=%v", calls.Load(), recovered, err)
	}
}

func TestChatLLMCacheMergesConcurrentLoads(t *testing.T) {
	cache := newChatLLMCache()
	key := chatLLMCacheKey{gaRoot: "ga", python: "python"}
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	loader := func() ([]map[string]interface{}, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return []map[string]interface{}{{"model": "m"}}, nil
	}

	const workers = 12
	results := make(chan []map[string]interface{}, workers)
	for i := 0; i < workers; i++ {
		go func() {
			llms, err := cache.load(key, loader)
			if err != nil {
				t.Errorf("load: %v", err)
			}
			results <- llms
		}()
	}
	<-started
	time.Sleep(20 * time.Millisecond)
	close(release)
	for i := 0; i < workers; i++ {
		if got := <-results; len(got) != 1 {
			t.Fatalf("result %d=%#v", i, got)
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("loader calls=%d want 1", got)
	}
}

func TestChatLLMCacheInvalidationAndKeyIsolation(t *testing.T) {
	cache := newChatLLMCache()
	keyA := chatLLMCacheKey{gaRoot: "ga-a", python: "python"}
	keyB := chatLLMCacheKey{gaRoot: "ga-b", python: "python"}
	var mu sync.Mutex
	calls := map[chatLLMCacheKey]int{}
	loader := func(key chatLLMCacheKey) func() ([]map[string]interface{}, error) {
		return func() ([]map[string]interface{}, error) {
			mu.Lock()
			calls[key]++
			n := calls[key]
			mu.Unlock()
			return []map[string]interface{}{{"load": n}}, nil
		}
	}

	_, _ = cache.load(keyA, loader(keyA))
	_, _ = cache.load(keyB, loader(keyB))
	cache.invalidate(keyA)
	a, _ := cache.load(keyA, loader(keyA))
	b, _ := cache.load(keyB, loader(keyB))
	if a[0]["load"] != 2 || b[0]["load"] != 1 {
		t.Fatalf("after targeted invalidation: a=%#v b=%#v calls=%#v", a, b, calls)
	}
}

func TestChatLLMCacheInvalidationDuringLoadPreventsStaleRefill(t *testing.T) {
	cache := newChatLLMCache()
	key := chatLLMCacheKey{gaRoot: "ga", python: "python"}
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	loader := func() ([]map[string]interface{}, error) {
		n := calls.Add(1)
		if n == 1 {
			close(started)
			<-release
		}
		return []map[string]interface{}{{"load": n}}, nil
	}

	firstDone := make(chan struct{})
	go func() {
		defer close(firstDone)
		_, _ = cache.load(key, loader)
	}()
	<-started
	cache.invalidate(key)
	close(release)
	<-firstDone
	fresh, err := cache.load(key, loader)
	if err != nil || calls.Load() != 2 || fresh[0]["load"] != int32(2) {
		t.Fatalf("stale refill survived: calls=%d fresh=%#v err=%v", calls.Load(), fresh, err)
	}
}

func TestChatLLMCacheReturnsSessionIsolatedCopies(t *testing.T) {
	cache := newChatLLMCache()
	key := chatLLMCacheKey{gaRoot: "ga", python: "python"}
	loader := func() ([]map[string]interface{}, error) {
		return []map[string]interface{}{
			{"model": "a", "metadata": map[string]interface{}{"tags": []interface{}{"one"}}},
			{"model": "b"},
		}, nil
	}

	first, _ := cache.load(key, loader)
	second, _ := cache.load(key, loader)
	markChatLLMActive(first, 1)
	first[0]["metadata"].(map[string]interface{})["tags"].([]interface{})[0] = "changed"
	if _, ok := second[1]["active"]; ok {
		t.Fatalf("active selection leaked across sessions: %#v", second)
	}
	if got := second[0]["metadata"].(map[string]interface{})["tags"].([]interface{})[0]; got != "one" {
		t.Fatalf("nested mutation leaked through cache: got=%v", got)
	}
	third, _ := cache.load(key, loader)
	if _, ok := third[1]["active"]; ok {
		t.Fatalf("active selection polluted cached source: %#v", third)
	}
}
