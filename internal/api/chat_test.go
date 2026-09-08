package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"genericagent-admin-go/internal/config"
	"genericagent-admin-go/internal/modelconfig"
)

func TestChatSessionsIncludesPinnedState(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	cs := chatSession{ID: "pinned-summary", Title: "Pinned", UpdatedAt: 123, Messages: []chatMessage{}, Pinned: true}
	if err := saveChatSessionLocked(s.CfgStore.Snapshot(), cs); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	s.chatSessions(rec, httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Sessions []struct {
			ID     string `json:"id"`
			Pinned bool   `json:"pinned"`
		} `json:"sessions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Sessions) != 1 || payload.Sessions[0].ID != cs.ID || !payload.Sessions[0].Pinned {
		t.Fatalf("sessions = %#v, want pinned summary for %q", payload.Sessions, cs.ID)
	}
}

func TestNormalizeChatSettingsPreservesOfficialReasoningEffortLevels(t *testing.T) {
	levels := []string{"off", "none", "minimal", "low", "medium", "high", "xhigh", "max"}
	for _, level := range levels {
		t.Run(level, func(t *testing.T) {
			got := normalizeChatSettings(chatSettings{ReasoningEffort: level}).ReasoningEffort
			if got != level {
				t.Fatalf("normalizeChatSettings(%q)=%q want=%q", level, got, level)
			}
		})
	}
}

func TestChatTitleGenerationReplacesTemporaryTitle(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	// Title generation defaults to disabled, so opt in for this test.
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatTitleModel = &config.ChatTitleModelRef{Enable: true}
	})
	cs := chatSession{
		ID:          "title-success",
		Title:       "请帮我同步上游并解决冲突",
		TitleSource: chatTitleSourceTemporary,
		Settings:    chatSettings{LLMNo: 2},
		Messages: []chatMessage{
			{ID: "u1", Role: "user", Content: "请帮我同步上游并解决冲突", CreatedAt: 1},
			{ID: "a1", Role: "assistant", Content: "已完成同步并保留本地修改", CreatedAt: 2},
		},
	}
	cs.UpdatedAt = 123
	if err := saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), cs); err != nil {
		t.Fatal(err)
	}

	old := runOneShotChatTitleWorkerFunc
	defer func() { runOneShotChatTitleWorkerFunc = old }()
	called := make(chan struct{})
	runOneShotChatTitleWorkerFunc = func(_ config.AppConfig, sid string, req map[string]interface{}) (string, error) {
		if sid != cs.ID || req["llm_no"] != 2 {
			t.Errorf("unexpected title request sid=%q req=%#v", sid, req)
		}
		close(called)
		return "\"上游同步与冲突解决！\"", nil
	}

	s.scheduleChatTitleGeneration(cs.ID, cs)
	select {
	case <-called:
	case <-time.After(time.Second):
		t.Fatal("title worker was not called")
	}
	var stored chatSession
	deadline := time.Now().Add(time.Second)
	for {
		stored, _ = loadChatSession(s.CfgStore.Snapshot(), cs.ID)
		if stored.TitleSource == chatTitleSourceGenerated || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if stored.Title != "上游同步与冲突解决" || stored.TitleSource != chatTitleSourceGenerated {
		t.Fatalf("generated title was not persisted: %+v", stored)
	}

	if stored.UpdatedAt != 123 {
		t.Fatalf("title generation changed activity time: %d", stored.UpdatedAt)
	}
	fresh := &Server{}
	summaries, err := fresh.loadChatSessionSummaries(s.CfgStore.Snapshot())
	if err != nil || len(summaries) != 1 || summaries[0].Title != stored.Title || summaries[0].UpdatedAt != 123 {
		t.Fatalf("cold read lost generated title/time: %v %#v", err, summaries)
	}
}

func TestAutomaticChatTitleBackfillUsesConfiguredModel(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatTitleModel = &config.ChatTitleModelRef{
			Enable:          true,
			ProviderVarName: "native_oai_config2",
			Model:           "title-model",
			LLMNo:           7,
		}
	})
	cs := chatSession{
		ID:       "legacy-title",
		Title:    "同步上游更新",
		Settings: chatSettings{LLMNo: 2},
		Messages: []chatMessage{
			{ID: "u1", Role: "user", Content: "同步上游更新", CreatedAt: 1},
			{ID: "a1", Role: "assistant", Content: "已经解决冲突", CreatedAt: 2},
			{ID: "u2", Role: "user", Content: "再添加对话标题功能", CreatedAt: 3},
			{ID: "a2", Role: "assistant", Content: "会使用独立模型生成", CreatedAt: 4},
		},
	}
	cs.UpdatedAt = 123
	if err := saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), cs); err != nil {
		t.Fatal(err)
	}

	old := runOneShotChatTitleWorkerFunc
	defer func() { runOneShotChatTitleWorkerFunc = old }()
	runOneShotChatTitleWorkerFunc = func(_ config.AppConfig, sid string, req map[string]interface{}) (string, error) {
		if sid != cs.ID || req["llm_no"] != 7 {
			t.Fatalf("unexpected title request sid=%q req=%#v", sid, req)
		}
		context, ok := req["conversation"].(chatTitleContext)
		if !ok || len(context.Messages) != 4 {
			t.Fatalf("conversation=%#v, want four-message title context", req["conversation"])
		}
		return "上游同步与独立标题模型", nil
	}

	got, err := s.generateLegacyChatTitle(cs.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "上游同步与独立标题模型" || got.TitleSource != chatTitleSourceGenerated {
		t.Fatalf("generated legacy title not persisted: %#v", got)
	}

	// A fresh runtime must reconstruct the title from durable session/index data.
	fresh := &Server{}
	for attempt := 0; attempt < 2; attempt++ {
		summaries, err := fresh.loadChatSessionSummaries(s.CfgStore.Snapshot())
		if err != nil || len(summaries) != 1 {
			t.Fatalf("cold title list: %v %#v", err, summaries)
		}
		if summaries[0].TitleSource != chatTitleSourceGenerated || summaries[0].UpdatedAt != 123 {
			t.Fatalf("title/time did not survive cold load: %#v", summaries[0])
		}
		fresh = &Server{}
	}
}

func TestManualChatTitleGenerationEndpointIsNotExposed(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/chat/title/legacy-title", strings.NewReader(`{}`))
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s, want 404", rr.Code, rr.Body.String())
	}
}

func TestChatTitleBackfillAutomaticallyGeneratesOnlyLegacyDefaultTitles(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	// Title generation defaults to disabled, so opt in for this test.
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatTitleModel = &config.ChatTitleModelRef{Enable: true}
	})
	legacy := chatSession{
		ID:       "legacy-default-title",
		Title:    "第一句话作为旧标题",
		Settings: chatSettings{LLMNo: 3},
		Messages: []chatMessage{
			{ID: "u1", Role: "user", Content: "第一句话作为旧标题 后面还有旧实现没有保留的内容", CreatedAt: 1},
			{ID: "a1", Role: "assistant", Content: "第一轮回答", CreatedAt: 2},
			{ID: "u2", Role: "user", Content: "真正主题是自动回填", CreatedAt: 3},
			{ID: "a2", Role: "assistant", Content: "准备生成新标题", CreatedAt: 4},
		},
	}
	custom := chatSession{
		ID:       "legacy-custom-title",
		Title:    "保留我的旧标题",
		Settings: chatSettings{LLMNo: 3},
		Messages: []chatMessage{
			{ID: "u1", Role: "user", Content: "这不是当前标题", CreatedAt: 1},
			{ID: "a1", Role: "assistant", Content: "回答", CreatedAt: 2},
		},
	}
	for _, session := range []chatSession{legacy, custom} {
		if err := saveChatSessionLocked(s.CfgStore.Snapshot(), session); err != nil {
			t.Fatal(err)
		}
	}

	old := runOneShotChatTitleWorkerFunc
	defer func() { runOneShotChatTitleWorkerFunc = old }()
	called := make(chan string, 2)
	runOneShotChatTitleWorkerFunc = func(_ config.AppConfig, sid string, _ map[string]interface{}) (string, error) {
		called <- sid
		return "旧会话自动标题", nil
	}

	if !s.StartAutomaticChatTitleBackfill() {
		t.Fatal("first automatic title backfill did not start")
	}
	select {
	case sid := <-called:
		if sid != legacy.ID {
			t.Fatalf("backfill generated title for %q, want %q", sid, legacy.ID)
		}
	case <-time.After(time.Second):
		t.Fatal("automatic title backfill did not start")
	}

	deadline := time.Now().Add(time.Second)
	var stored chatSession
	for {
		stored, _ = loadChatSession(s.CfgStore.Snapshot(), legacy.ID)
		if stored.TitleSource == chatTitleSourceGenerated || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if stored.Title != "旧会话自动标题" || stored.TitleSource != chatTitleSourceGenerated {
		t.Fatalf("legacy title was not backfilled: %+v", stored)
	}
	preserved, err := loadChatSession(s.CfgStore.Snapshot(), custom.ID)
	if err != nil {
		t.Fatal(err)
	}
	if preserved.Title != custom.Title || preserved.TitleSource != "" {
		t.Fatalf("custom legacy title was overwritten: %+v", preserved)
	}

	if s.StartAutomaticChatTitleBackfill() {
		t.Fatal("automatic title backfill started more than once")
	}
}

func TestChatTitleGenerationNeverOverwritesManualRename(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	// Title generation defaults to disabled, so opt in for this test.
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatTitleModel = &config.ChatTitleModelRef{Enable: true}
	})
	cs := chatSession{
		ID:          "title-manual-race",
		Title:       "第一句话",
		TitleSource: chatTitleSourceTemporary,
		Messages: []chatMessage{
			{ID: "u1", Role: "user", Content: "第一句话", CreatedAt: 1},
			{ID: "a1", Role: "assistant", Content: "第一轮回答", CreatedAt: 2},
		},
	}
	if err := saveChatSessionLocked(s.CfgStore.Snapshot(), cs); err != nil {
		t.Fatal(err)
	}

	old := runOneShotChatTitleWorkerFunc
	defer func() { runOneShotChatTitleWorkerFunc = old }()
	started := make(chan struct{})
	release := make(chan struct{})
	runOneShotChatTitleWorkerFunc = func(config.AppConfig, string, map[string]interface{}) (string, error) {
		close(started)
		<-release
		return "模型生成标题", nil
	}

	s.scheduleChatTitleGeneration(cs.ID, cs)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("title worker was not called")
	}
	s.SessionMu.Lock()
	latest, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID)
	if err == nil {
		latest.Title = "我自己的标题"
		latest.TitleSource = chatTitleSourceManual
		err = saveChatSessionLocked(s.CfgStore.Snapshot(), latest)
	}
	s.SessionMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	close(release)

	deadline := time.Now().Add(time.Second)
	for {
		s.ChatMu.Lock()
		running := s.ChatTitleJobs[cs.ID]
		s.ChatMu.Unlock()
		if !running || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	stored, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Title != "我自己的标题" || stored.TitleSource != chatTitleSourceManual {
		t.Fatalf("manual title was overwritten: %+v", stored)
	}
}

func TestChatTerminalSavePreservesManualRenameAndPinnedState(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	latest := chatSession{
		ID:          "title-terminal-race",
		Title:       "手动标题",
		TitleSource: chatTitleSourceManual,
		Pinned:      true,
		Messages:    []chatMessage{{ID: "u1", Role: "user", Content: "第一句话"}},
	}
	if err := saveChatSessionLocked(s.CfgStore.Snapshot(), latest); err != nil {
		t.Fatal(err)
	}
	staleWorkerCopy := latest
	staleWorkerCopy.Title = "第一句话"
	staleWorkerCopy.TitleSource = chatTitleSourceTemporary
	staleWorkerCopy.Pinned = false
	staleWorkerCopy.Messages = append(staleWorkerCopy.Messages, chatMessage{ID: "a1", Role: "assistant", Content: "回答"})

	if err := s.saveChatSessionMerged(staleWorkerCopy); err != nil {
		t.Fatal(err)
	}
	stored, err := loadChatSession(s.CfgStore.Snapshot(), latest.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Title != "手动标题" || stored.TitleSource != chatTitleSourceManual {
		t.Fatalf("terminal save overwrote manual title: %+v", stored)
	}
	if !stored.Pinned {
		t.Fatalf("terminal save overwrote pinned state: %+v", stored)
	}
}

func TestChatExactTerminalSavePreservesPinnedState(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	latest := chatSession{ID: "pin-exact-race", Pinned: true, Messages: []chatMessage{{ID: "u1", Role: "user", Content: "question"}}}
	if err := saveChatSessionLocked(s.CfgStore.Snapshot(), latest); err != nil {
		t.Fatal(err)
	}
	staleWorkerCopy := latest
	staleWorkerCopy.Pinned = false
	staleWorkerCopy.Messages = append(staleWorkerCopy.Messages, chatMessage{ID: "a1", Role: "assistant", Content: "answer"})

	if err := s.saveChatSessionExact(staleWorkerCopy); err != nil {
		t.Fatal(err)
	}
	stored, err := loadChatSession(s.CfgStore.Snapshot(), latest.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !stored.Pinned {
		t.Fatalf("exact terminal save overwrote pinned state: %+v", stored)
	}
}

func TestChatTitleGenerationOnlyUsesFirstCompletedTurn(t *testing.T) {
	cs := chatSession{
		Title:       "第一条消息",
		TitleSource: chatTitleSourceTemporary,
		Messages: []chatMessage{
			{ID: "u1", Role: "user", Content: "第一条消息"},
			{ID: "a1", Role: "assistant", Content: "第一轮回答"},
		},
	}
	exchange, ok := chatTitleExchangeForGeneration(cs)
	if !ok || exchange.User != "第一条消息" || exchange.Assistant != "第一轮回答" {
		t.Fatalf("first exchange not accepted: ok=%v exchange=%+v", ok, exchange)
	}
	cs.Messages = append(cs.Messages,
		chatMessage{ID: "u2", Role: "user", Content: "第二条消息"},
		chatMessage{ID: "a2", Role: "assistant", Content: "第二轮回答"},
	)
	if _, ok := chatTitleExchangeForGeneration(cs); ok {
		t.Fatal("multi-turn session unexpectedly scheduled title generation")
	}
	if title := sanitizeGeneratedChatTitle("!!!Error: HTTP 401"); title != "" {
		t.Fatalf("transport error was accepted as a title: %q", title)
	}
	if title := sanitizeGeneratedChatTitle("我们被要求为这个对话生成一个标题并总结主要内容"); title != "" {
		t.Fatalf("verbose meta response was accepted as a title: %q", title)
	}
	if title := sanitizeGeneratedChatTitle(strings.Repeat("过长标题", 20)); title != "" {
		t.Fatalf("overlong response was accepted as a title: %q", title)
	}
	attachmentSession := chatSession{
		Title:       "附件会话",
		TitleSource: chatTitleSourceTemporary,
		Messages: []chatMessage{
			{ID: "u-file", Role: "user", Content: "\n\n[附件已保存]\n/tmp/report.pdf", Files: []map[string]interface{}{{"name": "report.pdf"}}},
			{ID: "a-file", Role: "assistant", Content: "这是一份季度报告"},
		},
	}
	attachmentExchange, ok := chatTitleExchangeForGeneration(attachmentSession)
	if !ok || attachmentExchange.User != "用户上传了附件" {
		t.Fatalf("attachment-only exchange was not normalized: ok=%v exchange=%+v", ok, attachmentExchange)
	}
}

func TestParseLLMJSONArrayFromMixedOutputIgnoresGAStartupLogs(t *testing.T) {
	out := []byte("[ContextGuard] installed\r\n[MemoryLauncher] native\r\n[Info] Load mykeys from E:\\AITools\\GenericAgent\\mykey.py\r\n" +
		`[{"index":0,"label":"NativeOAISession/gpt-5.5/cpa","name":"gpt-5.5/cpa","model":"cpa","active":true},{"index":1,"label":"NativeOAISession/deepseek-v4-pro/newapi","name":"deepseek-v4-pro/newapi","model":"newapi","active":false}]` +
		"\r\n[DelegationHintGuard] installed")

	llms, err := parseLLMJSONArrayFromMixedOutput(out)
	if err != nil {
		t.Fatalf("parse mixed GA output: %v", err)
	}
	if len(llms) != 2 {
		t.Fatalf("len(llms)=%d want=2: %#v", len(llms), llms)
	}
	if llms[0]["name"] != "gpt-5.5/cpa" || llms[1]["name"] != "deepseek-v4-pro/newapi" {
		t.Fatalf("unexpected llms: %#v", llms)
	}
}

func TestAnnotateChatLLMProvidersUsesOfficialOrderAndStableModelFallback(t *testing.T) {
	order0, order1, order2, order3 := 0, 1, 2, 3
	profiles := []modelconfig.Profile{
		{
			VarName: "native_claude_config_beta",
			Name:    "hidden beta name",
			APIBase: "https://beta.example/v1",
			APIKey:  "sk-beta-secret",
			ModelConfigs: []modelconfig.ModelConfig{
				{Model: "model-b", SortOrder: &order1},
				{Model: "shared", SortOrder: &order3},
			},
		},
		{
			VarName: "native_oai_config_alpha",
			Name:    "hidden alpha name",
			APIBase: "https://alpha.example/v1",
			APIKey:  "sk-alpha-secret",
			ModelConfigs: []modelconfig.ModelConfig{
				{Model: "model-a", SortOrder: &order0},
				{Model: "shared", SortOrder: &order2},
			},
		},
	}
	llms := []map[string]interface{}{
		{"index": 0, "model": "model-b", "provider": "NativeOAISession"},
		{"index": 1, "model": "model-a", "provider": "NativeOAISession"},
		{"index": 2, "model": "shared", "provider": "NativeOAISession"},
		{"index": 3, "model": "shared", "provider": "NativeOAISession"},
	}

	annotateChatLLMProviders(llms, profiles)

	want := []string{"beta", "alpha", "alpha", "beta"}
	for i, provider := range want {
		if llms[i]["provider"] != provider {
			t.Fatalf("llms[%d].provider=%v want=%q: %#v", i, llms[i]["provider"], provider, llms)
		}
	}
	encoded, err := json.Marshal(llms)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"sk-alpha-secret", "sk-beta-secret", "alpha.example", "beta.example"} {
		if bytes.Contains(encoded, []byte(secret)) {
			t.Fatalf("annotated LLM response leaked %q: %s", secret, encoded)
		}
	}
}

func TestAnnotateChatLLMProvidersIncludesConfiguredReasoningEffort(t *testing.T) {
	profiles := []modelconfig.Profile{{
		VarName: "native_oai_config_alpha",
		ModelConfigs: []modelconfig.ModelConfig{{
			Model: "model-a", ReasoningEffort: "HIGH",
		}},
	}}
	llms := []map[string]interface{}{{"index": 0, "model": "model-a"}}

	annotateChatLLMProviders(llms, profiles)

	if got := llms[0]["reasoning_effort"]; got != "high" {
		t.Fatalf("reasoning_effort=%v want=%q: %#v", got, "high", llms)
	}
}

func TestAnnotateChatLLMProvidersUsesConfiguredModelDisplayName(t *testing.T) {
	var draft modelconfig.Draft
	data := []byte(`{"profiles":[{"var_name":"native_oai_config_alpha","model_configs":[{"model":"model-a","name":"Alpha Friendly"},{"model":"model-b"}]}]}`)
	if err := json.Unmarshal(data, &draft); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	llms := []map[string]interface{}{
		{"index": 0, "model": "model-a", "label": "NativeOAISession/model-a"},
		{"index": 1, "model": "model-b", "label": "NativeOAISession/model-b"},
	}

	annotateChatLLMProviders(llms, draft.Profiles)

	if got := llms[0]["label"]; got != "Alpha Friendly" {
		t.Fatalf("configured label=%v want=%q: %#v", got, "Alpha Friendly", llms)
	}
	if got := llms[1]["label"]; got != "NativeOAISession/model-b" {
		t.Fatalf("unconfigured label changed to %v: %#v", got, llms)
	}
}

func TestChatProviderDisplayNameMatchesModelsProviderProjection(t *testing.T) {
	cases := []struct {
		profile modelconfig.Profile
		want    string
	}{
		{profile: modelconfig.Profile{VarName: "native_oai_config_internal", DisplayName: "  Acme Cloud  ", Name: "gpt-5.6-sol"}, want: "Acme Cloud"},
		{profile: modelconfig.Profile{VarName: "native_oai_config_gpt55_medium_responses", Name: "gpt-5.6-sol"}, want: "gpt55_medium_responses"},
		{profile: modelconfig.Profile{VarName: "native_claude_config_fwind_opus48", Name: "claude-opus-4-8[1m]"}, want: "fwind_opus48"},
		{profile: modelconfig.Profile{VarName: "acme_api", Name: "acme-chat"}, want: "acme_api"},
		{profile: modelconfig.Profile{VarName: "native_oai_config", Name: "must-not-be-used", Type: "native_oai"}, want: "Unknown provider"},
		{profile: modelconfig.Profile{Name: "must-not-be-used", Type: "oai"}, want: "Unknown provider"},
	}
	for _, tc := range cases {
		if got := chatProviderDisplayName(tc.profile); got != tc.want {
			t.Fatalf("chatProviderDisplayName(%#v)=%q want=%q", tc.profile, got, tc.want)
		}
	}
}

func TestAnnotateChatLLMProvidersKeepsModelsInOneProfileUnderOneProvider(t *testing.T) {
	profiles := []modelconfig.Profile{
		{
			VarName: "native_oai_config_gpt55_medium_responses",
			Name:    "gpt-5.6-sol",
			ModelConfigs: []modelconfig.ModelConfig{
				{Model: "gpt-5.6-sol"},
				{Model: "gpt-5.6-terra"},
				{Model: "gpt-5.6-luna"},
			},
		},
	}
	llms := []map[string]interface{}{
		{"index": 0, "model": "gpt-5.6-sol"},
		{"index": 1, "model": "gpt-5.6-terra"},
		{"index": 2, "model": "gpt-5.6-luna"},
	}

	annotateChatLLMProviders(llms, profiles)

	for i, llm := range llms {
		if got := llm["provider"]; got != "gpt55_medium_responses" {
			t.Fatalf("llms[%d].provider=%v want=%q: %#v", i, got, "gpt55_medium_responses", llms)
		}
	}
}

func TestAnnotateChatLLMFailoverGroupsUsesSavedSuffixesAndOnlyTouchesMixins(t *testing.T) {
	llms := []map[string]interface{}{
		{"index": 0, "label": "NativeOAISession/model-a", "provider": "alpha", "model": "model-a"},
		{"index": 1, "label": "Mixin/model-a -> model-b", "provider": "MixinSession"},
		{"index": 2, "label": "NativeClaudeSession/model-b", "provider": "beta", "model": "model-b"},
		{"index": 3, "label": "Mixin/model-b -> model-a", "provider": "MixinSession"},
		{"index": 4, "label": "Mixin/orphan", "provider": "MixinSession"},
	}
	groups := []modelconfig.FailoverGroup{
		{VarName: "mixin_config_primary"},
		{VarName: "mixin_config_backup_2"},
	}

	annotateChatLLMFailoverGroups(llms, groups)

	if got := llms[1]["label"]; got != "primary" {
		t.Fatalf("first mixin label=%v want=%q: %#v", got, "primary", llms)
	}
	if got := llms[1]["failover_group"]; got != "primary" {
		t.Fatalf("first mixin failover_group=%v want=%q: %#v", got, "primary", llms)
	}
	if got := llms[3]["label"]; got != "backup_2" {
		t.Fatalf("second mixin label=%v want=%q: %#v", got, "backup_2", llms)
	}
	if got := llms[3]["failover_group"]; got != "backup_2" {
		t.Fatalf("second mixin failover_group=%v want=%q: %#v", got, "backup_2", llms)
	}
	if got := llms[0]["label"]; got != "NativeOAISession/model-a" {
		t.Fatalf("ordinary LLM label changed to %v: %#v", got, llms)
	}
	if got := llms[4]["label"]; got != "Mixin/orphan" {
		t.Fatalf("unmatched mixin label changed to %v: %#v", got, llms)
	}
}

func TestMarkChatLLMActiveUsesSessionLLMNo(t *testing.T) {
	llms := []map[string]interface{}{
		{"index": float64(0), "active": true},
		{"index": float64(3), "active": false},
	}

	markChatLLMActive(llms, 3)

	if llms[0]["active"] != false {
		t.Fatalf("llms[0].active=%v want false", llms[0]["active"])
	}
	if llms[1]["active"] != true {
		t.Fatalf("llms[1].active=%v want true", llms[1]["active"])
	}
}

func TestChatPythonForConfigPrefersConfiguredPythonPath(t *testing.T) {
	root := t.TempDir()
	venvDir := filepath.Join(root, ".venv", "bin")
	venvPython := filepath.Join(venvDir, "python")
	if runtime.GOOS == "windows" {
		venvDir = filepath.Join(root, ".venv", "Scripts")
		venvPython = filepath.Join(venvDir, "python.exe")
	}
	if err := os.MkdirAll(venvDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(venvPython, []byte("fake"), 0755); err != nil {
		t.Fatal(err)
	}
	configured := filepath.Join(t.TempDir(), "configured-python")

	got := chatPythonForConfig(config.AppConfig{GARoot: root, PythonPath: configured})

	if got != configured {
		t.Fatalf("chatPythonForConfig()=%q want configured python %q", got, configured)
	}
}

func TestMarkChatLLMActiveAllowsIndexZero(t *testing.T) {
	llms := []map[string]interface{}{
		{"index": "0", "active": false},
		{"index": "3", "active": true},
	}

	markChatLLMActive(llms, 0)

	if llms[0]["active"] != true {
		t.Fatalf("llms[0].active=%v want true", llms[0]["active"])
	}
	if llms[1]["active"] != false {
		t.Fatalf("llms[1].active=%v want false", llms[1]["active"])
	}
}

func TestChatPostPropagatesLLMNoZeroAndPersistsWorkerStartError(t *testing.T) {
	old := startChatWorkerFunc
	startChatWorkerFunc = func(config.AppConfig, string) (*chatWorker, error) {
		return nil, fmt.Errorf("boom")
	}
	defer func() { startChatWorkerFunc = old }()

	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	h := s.Routes()

	req := httptest.NewRequest(http.MethodPost, "/api/chat/session-a", strings.NewReader(`{"prompt":"hello","settings":{"llm_no":0},"client_user_id":"u1"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("post status=%d body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"type":"error"`) || !strings.Contains(rr.Body.String(), "boom") {
		t.Fatalf("expected streamed worker error, got %q", rr.Body.String())
	}

	cs, err := loadChatSession(s.CfgStore.Snapshot(), "session-a")
	if err != nil {
		t.Fatal(err)
	}
	if cs.Settings.LLMNo != 0 {
		t.Fatalf("LLMNo=%d want 0", cs.Settings.LLMNo)
	}
	if len(cs.Messages) != 2 || cs.Messages[1].Role != "assistant" || !cs.Messages[1].Error || !strings.Contains(cs.Messages[1].Content, "boom") {
		t.Fatalf("unexpected messages: %#v", cs.Messages)
	}
}

func TestChatProjectModeCommandLifecycleAndPreservesMemory(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	h := s.Routes()

	projectDir := filepath.Join(root, "temp", "projects", "alpha")
	if err := os.MkdirAll(projectDir, 0755); err != nil {
		t.Fatal(err)
	}
	memoryPath := filepath.Join(projectDir, "project_memory.md")
	const originalMemory = "# existing project memory\n"
	if err := os.WriteFile(memoryPath, []byte(originalMemory), 0644); err != nil {
		t.Fatal(err)
	}

	post := func(prompt string) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(map[string]string{"prompt": prompt})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/chat/project-session", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("prompt %q status=%d body=%s", prompt, rr.Code, rr.Body.String())
		}
		return rr
	}

	activate := post("/project alpha")
	if !strings.Contains(activate.Body.String(), `"project_mode":"alpha"`) {
		t.Fatalf("activation stream missing project mode: %s", activate.Body.String())
	}
	cs, err := loadChatSession(s.CfgStore.Snapshot(), "project-session")
	if err != nil {
		t.Fatal(err)
	}
	if cs.ProjectMode != "alpha" {
		t.Fatalf("ProjectMode=%q want alpha", cs.ProjectMode)
	}
	gotMemory, err := os.ReadFile(memoryPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(gotMemory) != originalMemory {
		t.Fatalf("existing project memory was changed: %q", gotMemory)
	}

	status := post("/project status")
	if !strings.Contains(status.Body.String(), "alpha") {
		t.Fatalf("status response missing active project: %s", status.Body.String())
	}
	if got, err := loadChatSession(s.CfgStore.Snapshot(), "project-session"); err != nil || got.ProjectMode != "alpha" {
		t.Fatalf("status changed persisted project mode: mode=%q err=%v", got.ProjectMode, err)
	}

	disable := post("/project off")
	if !strings.Contains(disable.Body.String(), `"project_mode":""`) {
		t.Fatalf("disable stream missing cleared project mode: %s", disable.Body.String())
	}
	cs, err = loadChatSession(s.CfgStore.Snapshot(), "project-session")
	if err != nil {
		t.Fatal(err)
	}
	if cs.ProjectMode != "" {
		t.Fatalf("ProjectMode=%q want disabled", cs.ProjectMode)
	}
	gotMemory, err = os.ReadFile(memoryPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(gotMemory) != originalMemory {
		t.Fatalf("disabling project mode changed memory: %q", gotMemory)
	}
}

func TestChatProjectModeRejectsUnsafeNames(t *testing.T) {
	invalid := []string{".", "..", "../escape", `a/b`, `a\\b`, "C:escape", "trailing.", "control\x1fchar"}
	for _, raw := range invalid {
		if got, ok := validProjectModeName(raw); ok {
			t.Errorf("validProjectModeName(%q)=(%q, true), want rejection", raw, got)
		}
	}

	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	body := strings.NewReader(`{"prompt":"/project ../escape"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/chat/project-unsafe", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	cs, err := loadChatSession(s.CfgStore.Snapshot(), "project-unsafe")
	if err != nil {
		t.Fatal(err)
	}
	if cs.ProjectMode != "" {
		t.Fatalf("unsafe command persisted ProjectMode=%q", cs.ProjectMode)
	}
	if _, err := os.Stat(filepath.Join(root, "temp", "escape")); !os.IsNotExist(err) {
		t.Fatalf("unsafe command created an escaped path: %v", err)
	}
}

func TestChatPostSendsPriorMessagesRawHistoryAndPersistsModelID(t *testing.T) {
	var captured map[string]interface{}
	old := startChatWorkerFunc
	startChatWorkerFunc = func(config.AppConfig, string) (*chatWorker, error) {
		stdinR, stdinW := io.Pipe()
		stdoutR, stdoutW := io.Pipe()
		go func() {
			defer stdinR.Close()
			defer stdoutW.Close()
			_ = json.NewDecoder(stdinR).Decode(&captured)
			done := chatMessage{ID: "a2", Role: "assistant", Content: "ok", CreatedAt: time.Now().Unix()}
			rawHistory := []map[string]interface{}{
				{"role": "user", "content": []map[string]interface{}{{"type": "text", "text": "first question"}}},
				{"role": "assistant", "content": []map[string]interface{}{{"type": "tool_result", "tool_name": "calc", "content": "42"}}},
				{"role": "assistant", "content": []map[string]interface{}{{"type": "text", "text": "ok"}}},
			}
			_ = json.NewEncoder(stdoutW).Encode(map[string]interface{}{"type": "model", "model_id": "vendor/model-real"})
			_ = json.NewEncoder(stdoutW).Encode(map[string]interface{}{"type": "model_first_token"})
			_ = json.NewEncoder(stdoutW).Encode(map[string]interface{}{
				"type":      "done",
				"message":   done,
				"ctx_chars": 3800,
				"ctx_msgs":  3,
				"usage": map[string]interface{}{
					"input_tokens": 310, "output_tokens": 18, "generation_ms": 900,
				},
				"usages": []map[string]interface{}{
					{"input_tokens": 120, "output_tokens": 5, "generation_ms": 300},
					{"input_tokens": 190, "output_tokens": 13, "generation_ms": 600},
				},
				"raw_history":  rawHistory,
				"history_info": []interface{}{map[string]interface{}{"turn": "final"}},
				"working":      map[string]interface{}{"phase": "complete"},
			})
		}()
		return &chatWorker{SID: "session-hist", Stdin: stdinW, Stdout: stdoutR}, nil
	}
	defer func() { startChatWorkerFunc = old }()

	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	seedRawHistory := []map[string]interface{}{
		{"role": "user", "content": []map[string]interface{}{{"type": "text", "text": "first question"}}},
		{"role": "assistant", "content": []map[string]interface{}{{"type": "tool_result", "tool_name": "search", "content": "tool data"}}},
	}
	seed := chatSession{
		ID: "session-hist", Title: "History", UpdatedAt: time.Now().Unix(), Settings: chatSettings{LLMNo: 2}, ProjectMode: "alpha", ExtraSysPrompts: []string{"be concise", "cite sources"}, RawHistory: seedRawHistory,
		HistoryInfo: []interface{}{map[string]interface{}{"turn": "seed"}}, Working: map[string]interface{}{"phase": "draft"},
		Messages: []chatMessage{
			{ID: "u0", Role: "user", Content: "first question", CreatedAt: 1},
			{ID: "a0", Role: "assistant", Content: "first answer", CreatedAt: 2},
		},
	}
	if err := saveChatSession(s.CfgStore.Snapshot(), seed); err != nil {
		t.Fatal(err)
	}

	imageData := base64.StdEncoding.EncodeToString([]byte("png-bytes"))
	body := fmt.Sprintf(`{"prompt":"second question","client_user_id":"u1","files":[{"name":"sample.png","type":"image/png","dataURL":"data:image/png;base64,%s"},{"name":"notes.txt","type":"text/plain","dataURL":"data:text/plain;base64,dGV4dA=="}]}`, imageData)
	req := httptest.NewRequest(http.MethodPost, "/api/chat/session-hist", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	if captured == nil {
		t.Fatalf("worker request was not captured")
	}
	prompt, _ := captured["prompt"].(string)
	if !strings.HasPrefix(prompt, "second question\n\n[附件已保存]\n") || !strings.Contains(prompt, "[image:") || !strings.Contains(prompt, "[FILE:") {
		t.Fatalf("prompt=%#v", captured["prompt"])
	}
	if captured["llm_no"].(float64) != 2 {
		t.Fatalf("llm_no=%#v want 2", captured["llm_no"])
	}
	if captured["project_mode"] != "alpha" {
		t.Fatalf("project_mode=%#v want alpha", captured["project_mode"])
	}
	images, ok := captured["images"].([]interface{})
	if !ok || len(images) != 1 {
		t.Fatalf("images=%#v want one supported image", captured["images"])
	}
	imagePath, ok := images[0].(string)
	if !ok || filepath.Ext(imagePath) != ".png" {
		t.Fatalf("image path=%#v want saved PNG path", images[0])
	}
	if data, err := os.ReadFile(imagePath); err != nil || string(data) != "png-bytes" {
		t.Fatalf("saved image data=%q err=%v", data, err)
	}
	extraPrompts, ok := captured["extra_sys_prompts"].([]interface{})
	if !ok || len(extraPrompts) != 2 || extraPrompts[0] != "be concise" || extraPrompts[1] != "cite sources" {
		t.Fatalf("extra_sys_prompts=%#v want persisted session prompts", captured["extra_sys_prompts"])
	}
	history, ok := captured["history"].([]interface{})
	if !ok || len(history) != 2 {
		t.Fatalf("history=%#v want two prior messages only", captured["history"])
	}
	first := history[0].(map[string]interface{})
	second := history[1].(map[string]interface{})
	if first["role"] != "user" || first["content"] != "first question" || second["role"] != "assistant" || second["content"] != "first answer" {
		t.Fatalf("unexpected structured history: %#v", history)
	}
	rawHistory, ok := captured["raw_history"].([]interface{})
	if !ok || len(rawHistory) != len(seedRawHistory) {
		t.Fatalf("raw_history=%#v want prior backend history", captured["raw_history"])
	}
	rawSecond := rawHistory[1].(map[string]interface{})
	rawSecondContent := rawSecond["content"].([]interface{})[0].(map[string]interface{})
	if rawSecondContent["type"] != "tool_result" || rawSecondContent["content"] != "tool data" {
		t.Fatalf("raw_history missing tool result: %#v", rawHistory)
	}
	historyInfo, ok := captured["history_info"].([]interface{})
	if !ok || len(historyInfo) != 1 || historyInfo[0].(map[string]interface{})["turn"] != "seed" {
		t.Fatalf("history_info=%#v want persisted structured context", captured["history_info"])
	}
	working, ok := captured["working"].(map[string]interface{})
	if !ok || working["phase"] != "draft" {
		t.Fatalf("working=%#v want persisted working state", captured["working"])
	}
	if strings.Contains(rr.Body.String(), "first question") || strings.Contains(rr.Body.String(), "first answer") || strings.Contains(rr.Body.String(), "raw_history") || strings.Contains(rr.Body.String(), "tool_result") {
		t.Fatalf("stream unexpectedly leaked prior/raw history: %s", rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "model_first_token") {
		t.Fatalf("stream leaked internal first-token marker: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"first_token_ms":`) || strings.Contains(rr.Body.String(), `"first_token_ms":0`) {
		t.Fatalf("stream terminal message missing non-zero first-token timing: %s", rr.Body.String())
	}
	if strings.Count(rr.Body.String(), `"model_id":"vendor/model-real"`) < 2 {
		t.Fatalf("stream missing model event or terminal message model_id: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"ctx_chars":3800`) || !strings.Contains(rr.Body.String(), `"ctx_msgs":3`) {
		t.Fatalf("stream terminal message missing context stats: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"generation_ms":900`) || !strings.Contains(rr.Body.String(), `"generation_ms":300`) || !strings.Contains(rr.Body.String(), `"generation_ms":600`) {
		t.Fatalf("stream terminal event missing generation timing: %s", rr.Body.String())
	}
	stored, err := loadChatSession(s.CfgStore.Snapshot(), "session-hist")
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Messages) == 0 || stored.Messages[len(stored.Messages)-1].ModelID != "vendor/model-real" {
		t.Fatalf("stored assistant model_id=%q want vendor/model-real: %#v", stored.Messages[len(stored.Messages)-1].ModelID, stored.Messages)
	}
	storedFinal := stored.Messages[len(stored.Messages)-1]
	if storedFinal.FirstTokenMS <= 0 {
		t.Fatalf("stored assistant first_token_ms=%d want positive: %#v", storedFinal.FirstTokenMS, storedFinal)
	}
	if storedFinal.CtxChars != 3800 || storedFinal.CtxMsgs != 3 {
		t.Fatalf("stored assistant context stats=(%d,%d) want (3800,3): %#v", storedFinal.CtxChars, storedFinal.CtxMsgs, storedFinal)
	}
	if storedFinal.Usage["generation_ms"] != 900 || len(storedFinal.Usages) != 2 || storedFinal.Usages[0]["generation_ms"] != 300 || storedFinal.Usages[1]["generation_ms"] != 600 {
		t.Fatalf("stored assistant generation timing mismatch: usage=%#v usages=%#v", storedFinal.Usage, storedFinal.Usages)
	}

	reloadReq := httptest.NewRequest(http.MethodGet, "/api/chat/session/session-hist", nil)
	reloadRR := httptest.NewRecorder()
	s.Routes().ServeHTTP(reloadRR, reloadReq)
	if reloadRR.Code != http.StatusOK {
		t.Fatalf("reload status=%d body=%s", reloadRR.Code, reloadRR.Body.String())
	}
	var reloaded chatSession
	if err := json.Unmarshal(reloadRR.Body.Bytes(), &reloaded); err != nil {
		t.Fatalf("decode reloaded session: %v body=%s", err, reloadRR.Body.String())
	}
	if len(reloaded.Messages) == 0 || reloaded.Messages[len(reloaded.Messages)-1].ModelID != "vendor/model-real" {
		t.Fatalf("reloaded assistant model_id=%q want vendor/model-real: %#v", reloaded.Messages[len(reloaded.Messages)-1].ModelID, reloaded.Messages)
	}
	reloadedFinal := reloaded.Messages[len(reloaded.Messages)-1]
	if reloadedFinal.FirstTokenMS <= 0 {
		t.Fatalf("reloaded assistant first_token_ms=%d want positive: %#v", reloadedFinal.FirstTokenMS, reloadedFinal)
	}
	if reloadedFinal.CtxChars != 3800 || reloadedFinal.CtxMsgs != 3 {
		t.Fatalf("reloaded assistant context stats=(%d,%d) want (3800,3): %#v", reloadedFinal.CtxChars, reloadedFinal.CtxMsgs, reloadedFinal)
	}
	if reloadedFinal.Usage["generation_ms"] != 900 || len(reloadedFinal.Usages) != 2 || reloadedFinal.Usages[0]["generation_ms"] != 300 || reloadedFinal.Usages[1]["generation_ms"] != 600 {
		t.Fatalf("reloaded assistant generation timing mismatch: usage=%#v usages=%#v", reloadedFinal.Usage, reloadedFinal.Usages)
	}
	if len(stored.RawHistory) != 3 {
		t.Fatalf("stored raw_history len=%d want 3: %#v", len(stored.RawHistory), stored.RawHistory)
	}
	storedContent := stored.RawHistory[1]["content"].([]interface{})[0].(map[string]interface{})
	if storedContent["type"] != "tool_result" || storedContent["content"] != "42" {
		t.Fatalf("stored raw_history not updated from worker: %#v", stored.RawHistory)
	}
	if len(stored.HistoryInfo) != 1 || stored.HistoryInfo[0].(map[string]interface{})["turn"] != "final" {
		t.Fatalf("stored history_info not updated from worker: %#v", stored.HistoryInfo)
	}
	if stored.Working["phase"] != "complete" {
		t.Fatalf("stored working not updated from worker: %#v", stored.Working)
	}
	if len(reloaded.HistoryInfo) != 1 || reloaded.HistoryInfo[0].(map[string]interface{})["turn"] != "final" || reloaded.Working["phase"] != "complete" {
		t.Fatalf("reloaded structured context mismatch: history_info=%#v working=%#v", reloaded.HistoryInfo, reloaded.Working)
	}
}

func TestChatWorkerEOFAppendsCurrentTurnToRawHistoryFallback(t *testing.T) {
	var captured map[string]interface{}
	old := startChatWorkerFunc
	startChatWorkerFunc = func(config.AppConfig, string) (*chatWorker, error) {
		stdinR, stdinW := io.Pipe()
		stdoutR, stdoutW := io.Pipe()
		go func() {
			defer stdinR.Close()
			defer stdoutW.Close()
			_ = json.NewDecoder(stdinR).Decode(&captured)
			_ = json.NewEncoder(stdoutW).Encode(map[string]interface{}{"type": "delta", "delta": "partial answer"})
		}()
		return &chatWorker{SID: "session-eof", Stdin: stdinW, Stdout: stdoutR}, nil
	}
	defer func() { startChatWorkerFunc = old }()

	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	seedRawHistory := []map[string]interface{}{
		{"role": "user", "content": []map[string]interface{}{{"type": "text", "text": "first question"}}},
		{"role": "assistant", "content": []map[string]interface{}{{"type": "tool_result", "tool_name": "search", "content": "tool data"}}},
	}
	seed := chatSession{
		ID: "session-eof", Title: "History", UpdatedAt: time.Now().Unix(), RawHistory: seedRawHistory,
		Messages: []chatMessage{
			{ID: "u0", Role: "user", Content: "first question", CreatedAt: 1},
			{ID: "a0", Role: "assistant", Content: "first answer", CreatedAt: 2},
		},
	}
	if err := saveChatSession(s.CfgStore.Snapshot(), seed); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/chat/session-eof", strings.NewReader(`{"prompt":"second question","client_user_id":"u1"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	if captured == nil {
		t.Fatalf("worker request was not captured")
	}
	if rawHistory, ok := captured["raw_history"].([]interface{}); !ok || len(rawHistory) != len(seedRawHistory) {
		t.Fatalf("worker raw_history=%#v want prior backend history", captured["raw_history"])
	}
	if strings.Contains(rr.Body.String(), "raw_history") || strings.Contains(rr.Body.String(), "tool_result") {
		t.Fatalf("stream unexpectedly leaked raw history: %s", rr.Body.String())
	}

	stored, err := loadChatSession(s.CfgStore.Snapshot(), "session-eof")
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.RawHistory) != len(seedRawHistory)+2 {
		t.Fatalf("raw_history len=%d want %d: %#v", len(stored.RawHistory), len(seedRawHistory)+2, stored.RawHistory)
	}
	keptTool := stored.RawHistory[1]["content"].([]interface{})[0].(map[string]interface{})
	if keptTool["type"] != "tool_result" || keptTool["content"] != "tool data" {
		t.Fatalf("prior tool_result not preserved: %#v", stored.RawHistory)
	}
	userContent := stored.RawHistory[len(stored.RawHistory)-2]["content"].([]interface{})[0].(map[string]interface{})
	assistantContent := stored.RawHistory[len(stored.RawHistory)-1]["content"].([]interface{})[0].(map[string]interface{})
	if stored.RawHistory[len(stored.RawHistory)-2]["role"] != "user" || userContent["text"] != "second question" {
		t.Fatalf("current user not appended to raw_history: %#v", stored.RawHistory)
	}
	if stored.RawHistory[len(stored.RawHistory)-1]["role"] != "assistant" || !strings.Contains(fmt.Sprint(assistantContent["text"]), "partial answer") {
		t.Fatalf("partial assistant not appended to raw_history: %#v", stored.RawHistory)
	}
}

func TestChatNewSessionDoesNotPersistDraftUntilFirstSend(t *testing.T) {
	old := startChatWorkerFunc
	startChatWorkerFunc = func(config.AppConfig, string) (*chatWorker, error) {
		return nil, fmt.Errorf("expected worker start failure")
	}
	defer func() { startChatWorkerFunc = old }()

	root := t.TempDir()
	s := newGoalTestServer(t, root)
	h := s.Routes()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/chat/session/new", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var created chatSession
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if created.ID == "" {
		t.Fatal("new session response has empty id")
	}
	if _, err := os.Stat(chatSessionPath(s.CfgStore.Snapshot(), created.ID)); !os.IsNotExist(err) {
		t.Fatalf("draft session was persisted before first message: %v", err)
	}

	listRR := httptest.NewRecorder()
	listReq := httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil)
	h.ServeHTTP(listRR, listReq)
	if listRR.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", listRR.Code, listRR.Body.String())
	}
	if strings.Contains(listRR.Body.String(), created.ID) {
		t.Fatalf("draft session appeared in list before first message: %s", listRR.Body.String())
	}

	sendRR := httptest.NewRecorder()
	sendReq := httptest.NewRequest(http.MethodPost, "/api/chat/"+created.ID, strings.NewReader(`{"prompt":"first message","client_user_id":"u1"}`))
	sendReq.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(sendRR, sendReq)
	if sendRR.Code != http.StatusOK {
		t.Fatalf("send status=%d body=%s", sendRR.Code, sendRR.Body.String())
	}
	if _, err := os.Stat(chatSessionPath(s.CfgStore.Snapshot(), created.ID)); err != nil {
		t.Fatalf("session was not persisted by first send: %v", err)
	}

	listAfterSendRR := httptest.NewRecorder()
	h.ServeHTTP(listAfterSendRR, httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil))
	if listAfterSendRR.Code != http.StatusOK {
		t.Fatalf("list after send status=%d body=%s", listAfterSendRR.Code, listAfterSendRR.Body.String())
	}
	if !strings.Contains(listAfterSendRR.Body.String(), created.ID) {
		t.Fatalf("session missing from list after first send: %s", listAfterSendRR.Body.String())
	}
}

func TestChatSessionsIncludesDiscoveredProjects(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"zeta", "alpha"} {
		if err := os.MkdirAll(filepath.Join(root, "temp", "projects", name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	h := s.Routes()

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var got struct {
		Projects []string `json:"projects"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if strings.Join(got.Projects, ",") != "alpha,zeta" {
		t.Fatalf("projects=%v want [alpha zeta]", got.Projects)
	}
}

func TestChatNewSessionForProjectPersistsMode(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "temp", "projects", "alpha"), 0755); err != nil {
		t.Fatal(err)
	}
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	h := s.Routes()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/chat/session/new", strings.NewReader(`{"project_mode":"alpha"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var created chatSession
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if created.ID == "" || created.ProjectMode != "alpha" {
		t.Fatalf("created=%+v", created)
	}
	stored, err := loadChatSession(s.CfgStore.Snapshot(), created.ID)
	if err != nil {
		t.Fatalf("load persisted session: %v", err)
	}
	if stored.ProjectMode != "alpha" {
		t.Fatalf("stored project_mode=%q want alpha", stored.ProjectMode)
	}
}

func TestChatNewSessionRejectsUnknownProject(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	h := s.Routes()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/chat/session/new", strings.NewReader(`{"project_mode":"missing"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "project does not exist") {
		t.Fatalf("unexpected body: %s", rr.Body.String())
	}
}

func TestChatFirstImmediateCommandPersistsSessionWithoutHistory(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	h := s.Routes()

	newRR := httptest.NewRecorder()
	h.ServeHTTP(newRR, httptest.NewRequest(http.MethodPost, "/api/chat/session/new", nil))
	if newRR.Code != http.StatusOK {
		t.Fatalf("new status=%d body=%s", newRR.Code, newRR.Body.String())
	}
	var created chatSession
	if err := json.Unmarshal(newRR.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode new session: %v", err)
	}

	helpRR := httptest.NewRecorder()
	helpReq := httptest.NewRequest(http.MethodPost, "/api/chat/"+created.ID, strings.NewReader(`{"prompt":"/help","client_user_id":"help-user"}`))
	helpReq.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(helpRR, helpReq)
	if helpRR.Code != http.StatusOK {
		t.Fatalf("help command=%d body=%s", helpRR.Code, helpRR.Body.String())
	}
	if !strings.Contains(helpRR.Body.String(), `"type":"command_result"`) {
		t.Fatalf("missing command result: %s", helpRR.Body.String())
	}
	if _, err := os.Stat(chatSessionPath(s.CfgStore.Snapshot(), created.ID)); err != nil {
		t.Fatalf("session was not persisted by first immediate command: %v", err)
	}
	stored, err := loadChatSession(s.CfgStore.Snapshot(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.ID != created.ID || stored.Title != "新会话" || len(stored.Messages) != 0 || len(stored.RawHistory) != 0 || len(stored.HistoryInfo) != 0 || stored.Working != nil {
		t.Fatalf("immediate command polluted persisted session: %+v", stored)
	}

	listRR := httptest.NewRecorder()
	h.ServeHTTP(listRR, httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil))
	if listRR.Code != http.StatusOK || !strings.Contains(listRR.Body.String(), created.ID) {
		t.Fatalf("session missing after first immediate command: status=%d body=%s", listRR.Code, listRR.Body.String())
	}
}

func TestSaveChatUploadsRejectsTooManyFiles(t *testing.T) {
	cfg := config.AppConfig{GARoot: t.TempDir(), ChatDataDir: t.TempDir()}
	files := make([]chatUpload, maxChatUploadFiles+1)
	for i := range files {
		files[i] = chatUpload{Name: fmt.Sprintf("f%d.txt", i), DataURL: base64.StdEncoding.EncodeToString([]byte("x"))}
	}

	if _, _, err := saveChatUploads(cfg, files); err == nil || !strings.Contains(err.Error(), "too many upload files") {
		t.Fatalf("saveChatUploads too many files err = %v", err)
	}
}

func TestSaveChatUploadsRejectsTooLargeFile(t *testing.T) {
	cfg := config.AppConfig{GARoot: t.TempDir(), ChatDataDir: t.TempDir()}
	tooLarge := make([]byte, maxChatUploadBytesPerFile+1)
	encoded := base64.StdEncoding.EncodeToString(tooLarge)

	if _, _, err := saveChatUploads(cfg, []chatUpload{{Name: "big.bin", DataURL: encoded}}); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("saveChatUploads too large file err = %v", err)
	}
}

func TestSaveChatUploadsRejectsTooLargeTotal(t *testing.T) {
	cfg := config.AppConfig{GARoot: t.TempDir(), ChatDataDir: t.TempDir()}
	chunk := make([]byte, maxChatUploadBytesTotal/3+1)
	encoded := base64.StdEncoding.EncodeToString(chunk)
	files := []chatUpload{
		{Name: "a.bin", DataURL: encoded},
		{Name: "b.bin", DataURL: encoded},
		{Name: "c.bin", DataURL: encoded},
	}

	if _, _, err := saveChatUploads(cfg, files); err == nil || !strings.Contains(err.Error(), "chat uploads too large") {
		t.Fatalf("saveChatUploads total too large err = %v", err)
	}
}

func TestSaveChatUploadsUsesImageRefsForVisionFiles(t *testing.T) {
	cfg := config.AppConfig{GARoot: t.TempDir(), ChatDataDir: t.TempDir()}
	encoded := base64.StdEncoding.EncodeToString([]byte("fake image bytes"))

	saved, refs, err := saveChatUploads(cfg, []chatUpload{{
		Name:    "photo.png",
		Type:    "image/png",
		DataURL: "data:image/png;base64," + encoded,
	}})
	if err != nil {
		t.Fatalf("saveChatUploads: %v", err)
	}
	if len(saved) != 1 || len(refs) != 1 {
		t.Fatalf("saved=%d refs=%d", len(saved), len(refs))
	}
	path, _ := saved[0]["path"].(string)
	if refs[0] != "[image:"+path+"]" {
		t.Fatalf("image ref=%q want [image:%s]", refs[0], path)
	}
}

func TestSaveChatUploadsKeepsFileRefsForNonImages(t *testing.T) {
	cfg := config.AppConfig{GARoot: t.TempDir(), ChatDataDir: t.TempDir()}
	encoded := base64.StdEncoding.EncodeToString([]byte("hello"))

	saved, refs, err := saveChatUploads(cfg, []chatUpload{{
		Name:    "notes.txt",
		Type:    "text/plain",
		DataURL: encoded,
	}})
	if err != nil {
		t.Fatalf("saveChatUploads: %v", err)
	}
	path, _ := saved[0]["path"].(string)
	if len(refs) != 1 || refs[0] != "[FILE:"+path+"]" {
		t.Fatalf("file refs=%#v want [FILE:%s]", refs, path)
	}
}

func TestReadChatWorkerLineAcceptsLargeNDJSONLine(t *testing.T) {
	payload := strings.Repeat("x", 9*1024*1024)
	input := []byte(`{"type":"delta","delta":"` + payload + `"}` + "\n")
	line, err := readChatWorkerLine(bufio.NewReaderSize(bytes.NewReader(input), 64*1024))
	if err != nil {
		t.Fatalf("readChatWorkerLine: %v", err)
	}
	if string(line) != string(input) {
		t.Fatalf("line length=%d want %d", len(line), len(input))
	}
}

func TestSaveChatUploadsSanitizesUnsafeNames(t *testing.T) {
	cfg := config.AppConfig{GARoot: t.TempDir(), ChatDataDir: t.TempDir()}
	encoded := base64.StdEncoding.EncodeToString([]byte("x"))

	saved, refs, err := saveChatUploads(cfg, []chatUpload{
		{Name: `..\evil:name?.txt`, Type: "text/plain", DataURL: encoded},
		{Name: "   ...   ", DataURL: encoded},
	})
	if err != nil {
		t.Fatalf("saveChatUploads: %v", err)
	}
	if len(saved) != 2 || len(refs) != 2 {
		t.Fatalf("saved=%d refs=%d", len(saved), len(refs))
	}
	for i, meta := range saved {
		name, _ := meta["name"].(string)
		if strings.ContainsAny(name, `\/:*?"<>|`) {
			t.Fatalf("saved[%d] unsafe name %q", i, name)
		}
		path, _ := meta["path"].(string)
		if filepath.Dir(path) != chatUploadDir(cfg) {
			t.Fatalf("saved[%d] path dir=%q want %q", i, filepath.Dir(path), chatUploadDir(cfg))
		}
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("saved[%d] stat %q: %v", i, path, err)
		}
	}
	if !strings.Contains(saved[0]["name"].(string), "evil_name_.txt") {
		t.Fatalf("first sanitized name = %q", saved[0]["name"])
	}
	if !strings.Contains(saved[1]["name"].(string), "upload.bin") {
		t.Fatalf("fallback sanitized name = %q", saved[1]["name"])
	}
}

func TestSaveChatUploadsSanitizesClosingBracket(t *testing.T) {
	cfg := config.AppConfig{GARoot: t.TempDir(), ChatDataDir: t.TempDir()}
	encoded := base64.StdEncoding.EncodeToString([]byte("x"))

	saved, refs, err := saveChatUploads(cfg, []chatUpload{{
		Name:    "report].txt",
		Type:    "text/plain",
		DataURL: encoded,
	}})
	if err != nil {
		t.Fatalf("saveChatUploads: %v", err)
	}
	if len(saved) != 1 || len(refs) != 1 {
		t.Fatalf("saved=%d refs=%d", len(saved), len(refs))
	}
	name, _ := saved[0]["name"].(string)
	if strings.Contains(name, "]") {
		t.Fatalf("saved name still contains closing bracket: %q", name)
	}
	if !strings.Contains(name, "report_.txt") {
		t.Fatalf("sanitized name=%q want report_.txt", name)
	}
	path, _ := saved[0]["path"].(string)
	if refs[0] != "[FILE:"+path+"]" {
		t.Fatalf("file ref=%q want [FILE:%s]", refs[0], path)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("saved file %q: %v", path, err)
	}
}

func TestSaveChatUploadsCleansPartialFilesOnLaterFailure(t *testing.T) {
	cfg := config.AppConfig{GARoot: t.TempDir(), ChatDataDir: t.TempDir()}
	encoded := base64.StdEncoding.EncodeToString([]byte("ok"))

	_, _, err := saveChatUploads(cfg, []chatUpload{
		{Name: "kept.txt", DataURL: encoded},
		{Name: "bad.txt", DataURL: "not-base64!"},
	})
	if err == nil {
		t.Fatalf("saveChatUploads err=nil, want decode error")
	}
	entries, readErr := os.ReadDir(chatUploadDir(cfg))
	if readErr != nil {
		t.Fatalf("read upload dir: %v", readErr)
	}
	if len(entries) != 0 {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("partial upload files left after failure: %v", names)
	}
}

func TestChatSaveSettingsRejectsMalformedJSON(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	req := httptest.NewRequest(http.MethodPost, "/api/chat/settings/session-bad", strings.NewReader(`{"llm_no":`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	s.Routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=%d body=%s", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if _, err := os.Stat(chatSessionPath(s.CfgStore.Snapshot(), "session-bad")); !os.IsNotExist(err) {
		t.Fatalf("malformed settings request should not create session file, stat err=%v", err)
	}
}

func TestChatSaveSettingsPersistsValidJSON(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	req := httptest.NewRequest(http.MethodPost, "/api/chat/settings/session-ok", strings.NewReader(`{"llm_no":3,"extra_sys_prompts":["  be concise  "," ","cite sources"]}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	s.Routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	cs, err := loadChatSession(s.CfgStore.Snapshot(), "session-ok")
	if err != nil {
		t.Fatal(err)
	}
	if cs.Settings.LLMNo != 3 {
		t.Fatalf("settings not persisted: %#v", cs.Settings)
	}
	if len(cs.ExtraSysPrompts) != 2 || cs.ExtraSysPrompts[0] != "be concise" || cs.ExtraSysPrompts[1] != "cite sources" {
		t.Fatalf("extra system prompts not normalized and persisted: %#v", cs.ExtraSysPrompts)
	}
}

func TestSaveChatSessionReportsCreateDirError(t *testing.T) {
	blocked := filepath.Join(t.TempDir(), "blocked")
	if err := os.WriteFile(blocked, []byte("not a dir"), 0644); err != nil {
		t.Fatal(err)
	}
	cfg := config.AppConfig{GARoot: t.TempDir(), ChatDataDir: blocked}

	if err := saveChatSession(cfg, chatSession{ID: "mkdir-fail"}); err == nil {
		t.Fatalf("saveChatSession err=nil, want create dir error")
	}
}

func TestSaveChatUploadsReportsCreateDirError(t *testing.T) {
	blocked := filepath.Join(t.TempDir(), "blocked")
	if err := os.WriteFile(blocked, []byte("not a dir"), 0644); err != nil {
		t.Fatal(err)
	}
	cfg := config.AppConfig{GARoot: t.TempDir(), ChatDataDir: blocked}
	encoded := base64.StdEncoding.EncodeToString([]byte("x"))

	if _, _, err := saveChatUploads(cfg, []chatUpload{{Name: "x.txt", DataURL: encoded}}); err == nil {
		t.Fatalf("saveChatUploads err=nil, want create dir error")
	}
}

func TestChatSessionsReportsUnwritableDataDir(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	blocked := filepath.Join(t.TempDir(), "blocked")
	if err := os.MkdirAll(blocked, 0755); err != nil {
		t.Fatal(err)
	}
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = blocked
	})
	if err := os.Remove(blocked); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(blocked, []byte("not a dir"), 0644); err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestLoadChatSessionReportsCorruptJSON(t *testing.T) {
	cfg := config.AppConfig{GARoot: t.TempDir(), ChatDataDir: t.TempDir()}
	if err := os.MkdirAll(chatSessionDir(cfg), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(chatSessionPath(cfg, "bad-json"), []byte("{"), 0644); err != nil {
		t.Fatal(err)
	}

	_, err := loadChatSession(cfg, "bad-json")
	if err == nil {
		t.Fatal("expected corrupt session JSON error")
	}
}

func TestChatGetSessionReportsCorruptJSON(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	if err := os.MkdirAll(chatSessionDir(s.CfgStore.Snapshot()), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(chatSessionPath(s.CfgStore.Snapshot(), "bad-json"), []byte("{"), 0644); err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/chat/session/bad-json", nil)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestChatSessionsReportsMigrationCreateDirError(t *testing.T) {
	gaRoot := t.TempDir()
	legacyDir := legacyChatSessionDir(gaRoot)
	if err := os.MkdirAll(legacyDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacyDir, "legacy.json"), []byte(`{"id":"legacy"}`), 0644); err != nil {
		t.Fatal(err)
	}
	chatDataPath := filepath.Join(t.TempDir(), "chat-data-file")
	if err := os.MkdirAll(chatDataPath, 0755); err != nil {
		t.Fatal(err)
	}

	s := newGoalTestServer(t, gaRoot)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = chatDataPath
	})
	if err := os.RemoveAll(chatDataPath); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(chatDataPath, []byte("not a directory"), 0644); err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestLoadChatSessionReportsMigrationCreateDirError(t *testing.T) {
	gaRoot := t.TempDir()
	legacyDir := legacyChatSessionDir(gaRoot)
	if err := os.MkdirAll(legacyDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacyDir, "legacy.json"), []byte(`{"id":"legacy"}`), 0644); err != nil {
		t.Fatal(err)
	}
	chatDataPath := filepath.Join(t.TempDir(), "chat-data-file")
	if err := os.WriteFile(chatDataPath, []byte("not a directory"), 0644); err != nil {
		t.Fatal(err)
	}

	cfg := config.AppConfig{GARoot: gaRoot, ChatDataDir: chatDataPath}
	if _, err := loadChatSession(cfg, "legacy"); err == nil {
		t.Fatal("expected migration create directory error")
	}
}

func TestChatWriteRoutesRejectTrailingJSONValues(t *testing.T) {
	h := newGoalTestServer(t, t.TempDir()).Routes()
	for _, tc := range []struct {
		name string
		path string
		body string
	}{
		{name: "rename", path: "/api/chat/session/chat-trailing", body: `{"title":"new"} {"extra":true}`},
		{name: "settings", path: "/api/chat/settings/chat-trailing", body: `{"llm_no":0} {"extra":true}`},
		{name: "post", path: "/api/chat/chat-trailing", body: `{"prompt":"hello"} {"extra":true}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			method := http.MethodPost
			if tc.name == "rename" {
				method = http.MethodPatch
			}
			req := httptest.NewRequest(method, tc.path, strings.NewReader(tc.body))
			h.ServeHTTP(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want=%d body=%s", rr.Code, http.StatusBadRequest, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), "single JSON value") {
				t.Fatalf("body missing single JSON value guidance: %s", rr.Body.String())
			}
		})
	}
}

func TestChatWriteRoutesRejectOversizedJSONBody(t *testing.T) {
	h := newGoalTestServer(t, t.TempDir()).Routes()
	for _, tc := range []struct {
		name       string
		path       string
		body       string
		wantStatus int
	}{
		{name: "rename", path: "/api/chat/session/chat-big", body: `{"title":"` + strings.Repeat("x", maxJSONBodyBytes) + `"}`, wantStatus: http.StatusRequestEntityTooLarge},
		{name: "settings", path: "/api/chat/settings/chat-big", body: `{"provider":"` + strings.Repeat("x", maxJSONBodyBytes) + `"}`, wantStatus: http.StatusRequestEntityTooLarge},
		{name: "post", path: "/api/chat/chat-big", body: `{"prompt":"` + strings.Repeat("x", int(maxChatPostBodyBytes)) + `"}`, wantStatus: http.StatusRequestEntityTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			method := http.MethodPost
			if tc.name == "rename" {
				method = http.MethodPatch
			}
			req := httptest.NewRequest(method, tc.path, strings.NewReader(tc.body))
			h.ServeHTTP(rr, req)
			if rr.Code != tc.wantStatus {
				t.Fatalf("status=%d want=%d body=%s", rr.Code, tc.wantStatus, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), errRequestBodyTooLarge.Error()) {
				t.Fatalf("body missing too-large guidance: %s", rr.Body.String())
			}
		})
	}
}

func TestChatSessionPathSanitizesUntrustedIDsInsideChatDataDir(t *testing.T) {
	chatDataDirRoot := t.TempDir()
	cfg := config.AppConfig{GARoot: t.TempDir(), ChatDataDir: chatDataDirRoot}
	for _, sid := range []string{"../../outside", `..\\outside`, "semi;colon", "space id", "nested/path"} {
		t.Run(sid, func(t *testing.T) {
			got := chatSessionPath(cfg, sid)
			wantRoot := chatSessionDir(cfg) + string(os.PathSeparator)
			if !strings.HasPrefix(got, wantRoot) {
				t.Fatalf("chatSessionPath(%q)=%q outside %q", sid, got, wantRoot)
			}
			base := filepath.Base(got)
			if base == sid+".json" || strings.Contains(base, "..") || strings.ContainsAny(base, `/\\ ;`) {
				t.Fatalf("chatSessionPath(%q) kept unsafe base %q", sid, base)
			}
			if filepath.Dir(got) != chatSessionDir(cfg) {
				t.Fatalf("chatSessionPath(%q) dir=%q want %q", sid, filepath.Dir(got), chatSessionDir(cfg))
			}
		})
	}
}

func TestChatWriteRoutesWithUnsafeIDsStayInsideChatDataDir(t *testing.T) {
	gaRoot := t.TempDir()
	chatDataDirRoot := t.TempDir()
	s := newGoalTestServer(t, gaRoot)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = chatDataDirRoot
	})
	h := s.Routes()
	for _, tc := range []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "rename", method: http.MethodPatch, path: "/api/chat/session/semi;colon", body: `{"title":"kept inside"}`},
		{name: "settings", method: http.MethodPost, path: "/api/chat/settings/space%20id", body: `{"llm_no":2}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			h.ServeHTTP(rr, req)
			if rr.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
			}
			if _, err := os.Stat(filepath.Join(chatDataDirRoot, "outside.json")); !os.IsNotExist(err) {
				t.Fatalf("unsafe route wrote outside chat session dir: err=%v", err)
			}
			entries, err := os.ReadDir(chatSessionDir(s.CfgStore.Snapshot()))
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 1 {
				t.Fatalf("session files=%d want=1 entries=%v", len(entries), entries)
			}
			if strings.Contains(entries[0].Name(), "outside") || strings.Contains(entries[0].Name(), "..") {
				t.Fatalf("unsafe id leaked into file name: %q", entries[0].Name())
			}
			_ = os.Remove(filepath.Join(chatSessionDir(s.CfgStore.Snapshot()), entries[0].Name()))
		})
	}
}

func TestChatFileRouteUsesBaseNameOnly(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	if err := os.MkdirAll(chatUploadDir(s.CfgStore.Snapshot()), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(chatUploadDir(s.CfgStore.Snapshot()), "safe.txt"), []byte("safe upload"), 0644); err != nil {
		t.Fatal(err)
	}
	outsideDir := filepath.Dir(chatUploadDir(s.CfgStore.Snapshot()))
	if err := os.WriteFile(filepath.Join(outsideDir, "outside.txt"), []byte("outside"), 0644); err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/chat/file/..%2Foutside.txt", nil)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code == http.StatusOK || strings.Contains(rr.Body.String(), "outside") {
		t.Fatalf("chat file traversal succeeded status=%d body=%q", rr.Code, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/chat/file/nested/safe.txt", nil)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || rr.Body.String() != "safe upload" {
		t.Fatalf("chat file basename lookup status=%d body=%q", rr.Code, rr.Body.String())
	}
}

func TestChatBTWPreservesMainResultThatFinishesFirst(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	base := chatMessage{ID: "base", Role: "user", Content: "main question"}
	originalRaw := []map[string]interface{}{{"role": "user", "content": "raw main question"}}
	if err := saveChatSession(s.CfgStore.Snapshot(), chatSession{
		ID:         "btw-first",
		Title:      "main question",
		Messages:   []chatMessage{base},
		RawHistory: originalRaw,
	}); err != nil {
		t.Fatal(err)
	}

	old := runOneShotBTWWorkerFunc
	defer func() { runOneShotBTWWorkerFunc = old }()
	calls := 0
	runOneShotBTWWorkerFunc = func(cfg config.AppConfig, sid string, req map[string]interface{}) (chatMessage, error) {
		calls++
		if sid != "btw-first" || req["prompt"] != "/btw side question" {
			t.Fatalf("unexpected btw request sid=%q req=%#v", sid, req)
		}
		history, ok := req["history"].([]chatMessage)
		if !ok || len(history) != 1 || history[0].ID != "base" {
			t.Fatalf("unexpected btw history snapshot: %#v", req["history"])
		}
		latest, err := loadChatSession(cfg, sid)
		if err != nil {
			return chatMessage{}, err
		}
		latest.Messages = append(latest.Messages, chatMessage{ID: "main", Role: "assistant", Content: "main result"})
		if err := saveChatSession(cfg, latest); err != nil {
			return chatMessage{}, err
		}
		return chatMessage{ID: "btw", Role: "assistant", Content: "side result"}, nil
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/chat/btw/btw-first", strings.NewReader(`{"prompt":"/btw side question"}`))
	req.Header.Set("Content-Type", "application/json")
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	if calls != 1 {
		t.Fatalf("btw worker calls=%d want=1", calls)
	}
	var response struct {
		Message chatMessage `json:"message"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v body=%s", err, rr.Body.String())
	}
	if response.Message.Kind != "btw" || response.Message.SideQuestion != "side question" {
		t.Fatalf("response btw metadata=%#v", response.Message)
	}
	stored, err := loadChatSession(s.CfgStore.Snapshot(), "btw-first")
	if err != nil {
		t.Fatal(err)
	}
	wantIDs := []string{"base", "main", "btw"}
	if len(stored.Messages) != len(wantIDs) {
		t.Fatalf("stored messages=%#v", stored.Messages)
	}
	for i, want := range wantIDs {
		if stored.Messages[i].ID != want {
			t.Fatalf("stored message[%d].ID=%q want=%q: %#v", i, stored.Messages[i].ID, want, stored.Messages)
		}
	}
	btwStored := stored.Messages[len(stored.Messages)-1]
	if btwStored.Kind != "btw" || btwStored.SideQuestion != "side question" {
		t.Fatalf("stored btw metadata=%#v", btwStored)
	}
	if len(stored.RawHistory) != 1 || stored.RawHistory[0]["content"] != "raw main question" {
		t.Fatalf("btw changed raw history: %#v", stored.RawHistory)
	}
}

func TestSaveChatSessionMergedPreservesBTWThatFinishesFirst(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	base := chatMessage{ID: "base", Role: "user", Content: "main question"}
	initial := chatSession{ID: "main-last", Messages: []chatMessage{base}}
	if err := saveChatSession(s.CfgStore.Snapshot(), initial); err != nil {
		t.Fatal(err)
	}
	staleMain, err := loadChatSession(s.CfgStore.Snapshot(), initial.ID)
	if err != nil {
		t.Fatal(err)
	}
	latest, err := loadChatSession(s.CfgStore.Snapshot(), initial.ID)
	if err != nil {
		t.Fatal(err)
	}
	latest.Messages = append(latest.Messages, chatMessage{ID: "btw", Role: "assistant", Content: "side result"})
	if err := saveChatSession(s.CfgStore.Snapshot(), latest); err != nil {
		t.Fatal(err)
	}
	staleMain.Messages = append(staleMain.Messages, chatMessage{ID: "main", Role: "assistant", Content: "main result"})
	if err := s.saveChatSessionMerged(staleMain); err != nil {
		t.Fatal(err)
	}
	stored, err := loadChatSession(s.CfgStore.Snapshot(), initial.ID)
	if err != nil {
		t.Fatal(err)
	}
	wantIDs := []string{"base", "btw", "main"}
	if len(stored.Messages) != len(wantIDs) {
		t.Fatalf("stored messages=%#v", stored.Messages)
	}
	for i, want := range wantIDs {
		if stored.Messages[i].ID != want {
			t.Fatalf("stored message[%d].ID=%q want=%q: %#v", i, stored.Messages[i].ID, want, stored.Messages)
		}
	}
}

func TestChatBTWRejectsEmptyQuestionWithoutStartingWorker(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	old := runOneShotBTWWorkerFunc
	defer func() { runOneShotBTWWorkerFunc = old }()
	calls := 0
	runOneShotBTWWorkerFunc = func(config.AppConfig, string, map[string]interface{}) (chatMessage, error) {
		calls++
		return chatMessage{}, nil
	}

	for _, prompt := range []string{"/btw", "not a btw command"} {
		rr := httptest.NewRecorder()
		body, _ := json.Marshal(map[string]string{"prompt": prompt})
		req := httptest.NewRequest(http.MethodPost, "/api/chat/btw/invalid", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		s.Routes().ServeHTTP(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("prompt=%q status=%d body=%s", prompt, rr.Code, rr.Body.String())
		}
	}
	if calls != 0 {
		t.Fatalf("btw worker calls=%d want=0", calls)
	}
}

func TestChatWorkerEnvironmentInjectsOnlyCurrentSessionID(t *testing.T) {
	t.Setenv("GA_ADMIN_SESSION_ID", "stale-parent-session")
	env := chatWorkerEnvironment(config.AppConfig{}, t.TempDir(), "safe-session")

	var values []string
	for _, item := range env {
		key, value, ok := strings.Cut(item, "=")
		if ok && strings.EqualFold(key, "GA_ADMIN_SESSION_ID") {
			values = append(values, value)
		}
	}
	if len(values) != 1 || values[0] != "safe-session" {
		t.Fatalf("GA_ADMIN_SESSION_ID values=%#v want=[safe-session]", values)
	}
}

func TestChatPlanNormalizationRepairsLegacyMarkersWithoutMutatingSource(t *testing.T) {
	plan := map[string]interface{}{
		"active":      true,
		"placeholder": "working",
		"done":        float64(0),
		"total":       float64(99),
		"complete":    false,
		"items": []interface{}{
			map[string]interface{}{"content": "[D] [\u2713] [VERIFY] wired", "status": "open"},
			map[string]interface{}{"content": "[P] pending", "status": "open"},
			map[string]interface{}{"content": "[\u2714 2026-07-21 09:30 shipped]", "status": "open"},
			map[string]interface{}{"content": "[VERIFY] keep semantic tag", "status": "done"},
		},
	}

	got := normalizeChatPlan(plan)
	items, ok := got["items"].([]interface{})
	if !ok || len(items) != 4 {
		t.Fatalf("normalized items=%#v", got["items"])
	}
	wantContent := []string{"[VERIFY] wired", "pending", "shipped", "[VERIFY] keep semantic tag"}
	wantStatus := []string{"done", "open", "done", "done"}
	for i := range items {
		item, ok := items[i].(map[string]interface{})
		if !ok || item["content"] != wantContent[i] || item["status"] != wantStatus[i] {
			t.Fatalf("item[%d]=%#v want content=%q status=%q", i, items[i], wantContent[i], wantStatus[i])
		}
	}
	if got["done"] != float64(3) || got["total"] != float64(4) || got["complete"] != false {
		t.Fatalf("aggregates done=%#v total=%#v complete=%#v", got["done"], got["total"], got["complete"])
	}

	sourceItems := plan["items"].([]interface{})
	firstSource := sourceItems[0].(map[string]interface{})
	if firstSource["content"] != "[D] [\u2713] [VERIFY] wired" || firstSource["status"] != "open" {
		t.Fatalf("source plan mutated: %#v", firstSource)
	}
	items[0].(map[string]interface{})["content"] = "changed"
	if firstSource["content"] != "[D] [\u2713] [VERIFY] wired" {
		t.Fatalf("normalized plan aliases source: %#v", firstSource)
	}
}

func TestChatPlanNormalizationPersistsAndReloads(t *testing.T) {
	cfg := config.AppConfig{ChatDataDir: t.TempDir()}
	cs := chatSession{
		ID: "legacy-plan",
		Plan: map[string]interface{}{
			"done":     float64(0),
			"total":    float64(1),
			"complete": false,
			"items": []interface{}{
				map[string]interface{}{"content": "[\u2713] [VERIFY] persisted", "status": "open"},
			},
		},
	}
	if err := saveChatSession(cfg, cs); err != nil {
		t.Fatal(err)
	}

	loaded, err := loadChatSession(cfg, cs.ID)
	if err != nil {
		t.Fatal(err)
	}
	items, ok := loaded.Plan["items"].([]interface{})
	if !ok || len(items) != 1 {
		t.Fatalf("loaded plan items=%#v", loaded.Plan["items"])
	}
	item := items[0].(map[string]interface{})
	if item["content"] != "[VERIFY] persisted" || item["status"] != "done" {
		t.Fatalf("loaded item=%#v", item)
	}
	if loaded.Plan["done"] != float64(1) || loaded.Plan["total"] != float64(1) || loaded.Plan["complete"] != true {
		t.Fatalf("loaded aggregates=%#v", loaded.Plan)
	}

	raw, err := os.ReadFile(chatSessionPath(cfg, cs.ID))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("[\\u2713]")) || bytes.Contains(raw, []byte("[\u2713]")) {
		t.Fatalf("legacy marker remained on disk: %s", raw)
	}
	if !bytes.Contains(raw, []byte("[VERIFY] persisted")) {
		t.Fatalf("semantic tag missing on disk: %s", raw)
	}
}

func TestChatPlanFromEventNormalizesPlanOnly(t *testing.T) {
	ev := map[string]interface{}{
		"message": map[string]interface{}{"content": "assistant keeps [\u2713] verbatim"},
		"plan": map[string]interface{}{
			"items": []interface{}{map[string]interface{}{"content": "[\u2713] task", "status": "open"}},
		},
	}
	got := chatPlanFromEvent(ev)
	item := got["items"].([]interface{})[0].(map[string]interface{})
	if item["content"] != "task" || item["status"] != "done" {
		t.Fatalf("event plan not normalized: %#v", got)
	}
	message := ev["message"].(map[string]interface{})
	if message["content"] != "assistant keeps [\u2713] verbatim" {
		t.Fatalf("assistant prose was changed: %#v", message)
	}
}

func TestUpdateChatPlanFromEventRetainsSnapshotUntilExplicitUpdate(t *testing.T) {
	current := map[string]interface{}{
		"items": []interface{}{map[string]interface{}{"content": "approved step", "status": "open"}},
		"done":  float64(0), "total": float64(1), "complete": false,
	}

	got, changed := updateChatPlanFromEvent(current, map[string]interface{}{"plan": nil})
	if changed || got["total"] != float64(1) {
		t.Fatalf("plan:null replaced current snapshot: changed=%v plan=%#v", changed, got)
	}
	got, changed = updateChatPlanFromEvent(got, map[string]interface{}{"type": "done"})
	if changed || got["total"] != float64(1) {
		t.Fatalf("missing plan replaced current snapshot: changed=%v plan=%#v", changed, got)
	}

	got, changed = updateChatPlanFromEvent(got, map[string]interface{}{"plan": map[string]interface{}{
		"items": []interface{}{map[string]interface{}{"content": "[\u2713] approved step", "status": "open"}},
	}})
	if !changed || got["done"] != float64(1) || got["complete"] != true {
		t.Fatalf("explicit plan update was not applied: changed=%v plan=%#v", changed, got)
	}
}

func TestChatPlanSnapshotSurvivesPlanNullFollowUpTurn(t *testing.T) {
	old := startChatWorkerFunc
	startChatWorkerFunc = func(config.AppConfig, string) (*chatWorker, error) {
		stdinR, stdinW := io.Pipe()
		stdoutR, stdoutW := io.Pipe()
		go func() {
			defer stdinR.Close()
			defer stdoutW.Close()
			decoder := json.NewDecoder(stdinR)
			encoder := json.NewEncoder(stdoutW)
			for turn := 1; turn <= 2; turn++ {
				var request map[string]interface{}
				if err := decoder.Decode(&request); err != nil {
					return
				}
				event := map[string]interface{}{
					"type": "done",
					"message": map[string]interface{}{
						"role": "assistant", "content": fmt.Sprintf("answer %d", turn),
					},
				}
				if turn == 1 {
					event["plan"] = map[string]interface{}{
						"objective": "Ship the dashboard",
						"items":     []interface{}{map[string]interface{}{"content": "Implement inspector", "status": "open"}},
					}
				} else {
					event["plan"] = nil
				}
				if err := encoder.Encode(event); err != nil {
					return
				}
				var bindRequest map[string]interface{}
				if err := decoder.Decode(&bindRequest); err != nil {
					return
				}
				if bindRequest["op"] != "worldline" || bindRequest["action"] != "bind" {
					return
				}
				if err := encoder.Encode(map[string]interface{}{"type": "worldline"}); err != nil {
					return
				}
			}
		}()
		return &chatWorker{SID: "plan-lifecycle", Stdin: stdinW, Stdout: stdoutR}, nil
	}
	defer func() { startChatWorkerFunc = old }()

	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	h := s.Routes()
	post := func(prompt string) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(map[string]string{"prompt": prompt})
		if err != nil {
			t.Fatal(err)
		}
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/chat/plan-lifecycle", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("prompt %q status=%d body=%s", prompt, rr.Code, rr.Body.String())
		}
		return rr
	}

	first := post("make a plan")
	if !strings.Contains(first.Body.String(), `"objective":"Ship the dashboard"`) {
		t.Fatalf("first stream missing plan snapshot: %s", first.Body.String())
	}
	second := post("confirmed, execute it")
	if !strings.Contains(second.Body.String(), `"objective":"Ship the dashboard"`) || strings.Contains(second.Body.String(), `"plan":null`) {
		t.Fatalf("follow-up stream did not retain plan snapshot: %s", second.Body.String())
	}

	stored, err := loadChatSession(s.CfgStore.Snapshot(), "plan-lifecycle")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Plan["objective"] != "Ship the dashboard" || stored.Plan["total"] != float64(1) {
		t.Fatalf("stored plan was lost after follow-up: %#v", stored.Plan)
	}

	reloadRR := httptest.NewRecorder()
	h.ServeHTTP(reloadRR, httptest.NewRequest(http.MethodGet, "/api/chat/session/plan-lifecycle", nil))
	if reloadRR.Code != http.StatusOK || !strings.Contains(reloadRR.Body.String(), `"objective":"Ship the dashboard"`) {
		t.Fatalf("reloaded session missing retained plan: status=%d body=%s", reloadRR.Code, reloadRR.Body.String())
	}
}

func TestChatForkSessionUsesExactRawHistoryAndPreservesSource(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	textPart := func(text string) []interface{} {
		return []interface{}{map[string]interface{}{"type": "text", "text": text}}
	}
	source := chatSession{
		ID:    "fork-source",
		Title: "Original",
		Messages: []chatMessage{
			{ID: "u1", Role: "user", Content: "repeat"},
			{ID: "a1", Role: "assistant", Content: "first answer"},
			{ID: "u2", Role: "user", Content: "repeat"},
			{ID: "a2", Role: "assistant", Content: "future answer"},
		},
		Settings:    chatSettings{LLMNo: 2},
		Workspace:   "workspace-a",
		ProjectMode: "project-a",
		HistoryInfo: []interface{}{map[string]interface{}{"future": true}},
		Working:     map[string]interface{}{"future": true},
		RawHistory: []map[string]interface{}{
			{"role": "user", "content": textPart("repeat")},
			{"role": "assistant", "content": textPart("first answer")},
			{"role": "assistant", "content": []interface{}{map[string]interface{}{"type": "tool_use", "id": "tool-1", "name": "code_run"}}},
			{"role": "user", "content": []interface{}{map[string]interface{}{"type": "tool_result", "tool_use_id": "tool-1", "content": "result"}}},
			{"role": "user", "content": textPart("repeat")},
			{"role": "assistant", "content": textPart("future answer")},
		},
	}
	if err := saveChatSession(s.CfgStore.Snapshot(), source); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{"message_id": "u2"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/chat/fork/fork-source", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("fork status=%d body=%s", rr.Code, rr.Body.String())
	}
	var response chatSession
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.ID == "" || response.ID == source.ID {
		t.Fatalf("fork ID=%q source=%q", response.ID, source.ID)
	}
	fork, err := loadChatSession(s.CfgStore.Snapshot(), response.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(fork.Messages) != 2 || fork.Messages[0].ID != "u1" || fork.Messages[1].ID != "a1" {
		t.Fatalf("fork messages=%#v", fork.Messages)
	}
	if len(fork.RawHistory) != 4 {
		t.Fatalf("fork raw history len=%d want=4: %#v", len(fork.RawHistory), fork.RawHistory)
	}
	if got := fmt.Sprint(fork.RawHistory[2]["role"]); got != "assistant" {
		t.Fatalf("tool-use role=%q", got)
	}
	if got := fmt.Sprint(fork.RawHistory[3]["role"]); got != "user" {
		t.Fatalf("tool-result role=%q", got)
	}
	if fork.Settings.LLMNo != 2 || fork.Workspace != source.Workspace || fork.ProjectMode != source.ProjectMode {
		t.Fatalf("fork configuration changed: %#v", fork)
	}
	if len(fork.HistoryInfo) != 0 || fork.Working != nil {
		t.Fatalf("future state leaked: history_info=%#v working=%#v", fork.HistoryInfo, fork.Working)
	}
	storedSource, err := loadChatSession(s.CfgStore.Snapshot(), source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(storedSource.Messages) != 4 || len(storedSource.RawHistory) != 6 {
		t.Fatalf("source was mutated: %#v", storedSource)
	}
}

func TestChatForkSessionLegacyAndRawMismatch(t *testing.T) {
	for _, tc := range []struct {
		name       string
		raw        []map[string]interface{}
		wantStatus int
		wantRawLen int
	}{
		{name: "legacy empty raw", raw: []map[string]interface{}{}, wantStatus: http.StatusOK, wantRawLen: 0},
		{name: "raw mismatch", raw: []map[string]interface{}{{"role": "user", "content": []interface{}{map[string]interface{}{"type": "text", "text": "different"}}}}, wantStatus: http.StatusConflict},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := newGoalTestServer(t, t.TempDir())
			updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
				cfg.ChatDataDir = t.TempDir()
			})
			source := chatSession{ID: "fork-case", Messages: []chatMessage{{ID: "target", Role: "user", Content: "selected"}}, RawHistory: tc.raw}
			if err := saveChatSession(s.CfgStore.Snapshot(), source); err != nil {
				t.Fatal(err)
			}
			body := strings.NewReader(`{"message_id":"target"}`)
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/chat/fork/fork-case", body)
			req.Header.Set("Content-Type", "application/json")
			s.Routes().ServeHTTP(rr, req)
			if rr.Code != tc.wantStatus {
				t.Fatalf("status=%d want=%d body=%s", rr.Code, tc.wantStatus, rr.Body.String())
			}
			if tc.wantStatus == http.StatusOK {
				var fork chatSession
				if err := json.Unmarshal(rr.Body.Bytes(), &fork); err != nil {
					t.Fatal(err)
				}
				if len(fork.RawHistory) != tc.wantRawLen {
					t.Fatalf("raw len=%d want=%d", len(fork.RawHistory), tc.wantRawLen)
				}
			}
		})
	}
}

func TestChatPickedModelBecomesDefaultForNewSessions(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = t.TempDir()
	})
	h := s.Routes()

	if s.CfgStore.Snapshot().ChatDefaultLLMNo != 0 {
		t.Fatalf("precondition: chat_default_llm_no=%d want 0", s.CfgStore.Snapshot().ChatDefaultLLMNo)
	}

	// Pick model #4 in an existing session.
	req := httptest.NewRequest(http.MethodPost, "/api/chat/settings/session-pick", strings.NewReader(`{"llm_no":4}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("save settings status=%d body=%s", rr.Code, rr.Body.String())
	}

	// The pick is remembered in config so it survives across sessions.
	if got := s.CfgStore.Snapshot().ChatDefaultLLMNo; got != 4 {
		t.Fatalf("chat_default_llm_no=%d want 4", got)
	}

	// A brand new session must start on the picked model, not fall back to 0.
	newRR := httptest.NewRecorder()
	h.ServeHTTP(newRR, httptest.NewRequest(http.MethodPost, "/api/chat/session/new", nil))
	if newRR.Code != http.StatusOK {
		t.Fatalf("new session status=%d body=%s", newRR.Code, newRR.Body.String())
	}
	var created chatSession
	if err := json.Unmarshal(newRR.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode new session: %v body=%s", err, newRR.Body.String())
	}
	if created.Settings.LLMNo != 4 {
		t.Fatalf("new session llm_no=%d want 4", created.Settings.LLMNo)
	}

	// Loading a session that has no file on disk yet keeps the same default.
	cs, err := loadChatSession(s.CfgStore.Snapshot(), created.ID)
	if err != nil {
		t.Fatalf("load fresh session: %v", err)
	}
	if cs.Settings.LLMNo != 4 {
		t.Fatalf("unsaved session llm_no=%d want 4", cs.Settings.LLMNo)
	}
}

func TestChatGuideIsIdempotentWhenQueuedItemAlreadyStarted(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	sid := "guide-race-session"
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	if err := saveChatSession(s.CfgStore.Snapshot(), chatSession{ID: sid, Title: "Guide race"}); err != nil {
		t.Fatalf("save session: %v", err)
	}

	s.ChatMu.Lock()
	s.ChatRuns[sid] = &chatRun{SID: sid, QueueID: "q-takeover", Subscribers: map[chan []byte]bool{}}
	s.ChatMu.Unlock()

	req := httptest.NewRequest(http.MethodPost, "/api/chat/guide/"+sid+"/q-takeover", nil)
	rr := httptest.NewRecorder()
	s.chatGuidePost(rr, req, sid, "q-takeover")
	if rr.Code != http.StatusOK {
		t.Fatalf("guide raced with queue consumption: status=%d body=%s", rr.Code, rr.Body.String())
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["status"] != "already_started" {
		t.Fatalf("status=%v want already_started", payload["status"])
	}
}

func TestChatGuideStillRejectsUnknownQueueItem(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	sid := "guide-missing-session"
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	if err := saveChatSession(s.CfgStore.Snapshot(), chatSession{ID: sid, Title: "Guide missing"}); err != nil {
		t.Fatalf("save session: %v", err)
	}

	s.ChatMu.Lock()
	s.ChatRuns[sid] = &chatRun{SID: sid, QueueID: "q-other", Done: true, Subscribers: map[chan []byte]bool{}}
	s.ChatMu.Unlock()

	req := httptest.NewRequest(http.MethodPost, "/api/chat/guide/"+sid+"/q-missing", nil)
	rr := httptest.NewRecorder()
	s.chatGuidePost(rr, req, sid, "q-missing")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("unknown queue item: status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestChatQueuePersistsWithSessionAndSurvivesRunSave(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	initial := chatSession{
		ID:        "queue-session",
		Title:     "Queue",
		UpdatedAt: 123,
		Messages:  []chatMessage{},
	}
	if err := saveChatSessionLocked(s.CfgStore.Snapshot(), initial); err != nil {
		t.Fatal(err)
	}
	baseline, err := loadChatSession(s.CfgStore.Snapshot(), initial.ID)
	if err != nil {
		t.Fatal(err)
	}

	body := `{"messages":[{"id":"q-1","text":"continue this work","files":[{"id":"file-1","name":"notes.txt","type":"text/plain","size":5,"dataURL":"data:text/plain;base64,aGVsbG8="}],"llmNo":3,"reasoningEffort":"high","queuedAt":456}]}`
	req := httptest.NewRequest(http.MethodPut, "/api/chat/queue/queue-session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.chatReplaceQueue(rec, req, initial.ID)
	if rec.Code != http.StatusOK {
		t.Fatalf("save queue status=%d body=%s", rec.Code, rec.Body.String())
	}

	stored, err := loadChatSession(s.CfgStore.Snapshot(), initial.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.UpdatedAt != baseline.UpdatedAt {
		t.Fatalf("queue update changed session ordering timestamp: got %d want %d", stored.UpdatedAt, baseline.UpdatedAt)
	}
	if len(stored.QueuedMessages) != 1 || stored.QueuedMessages[0].ID != "q-1" || stored.QueuedMessages[0].LLMNo != 3 {
		t.Fatalf("stored queue=%#v", stored.QueuedMessages)
	}
	if files := stored.QueuedMessages[0].Files; len(files) != 1 || files[0].ID != "file-1" || files[0].Size != 5 || files[0].DataURL == "" {
		t.Fatalf("stored queue files=%#v", files)
	}

	staleRunResult := initial
	staleRunResult.Messages = []chatMessage{{ID: "a-1", Role: "assistant", Content: "done"}}
	preserveLatestChatUserMetadata(&staleRunResult, stored)
	if len(staleRunResult.QueuedMessages) != 1 || staleRunResult.QueuedMessages[0].ID != "q-1" {
		t.Fatalf("run save dropped concurrent queue update: %#v", staleRunResult.QueuedMessages)
	}

	getRec := httptest.NewRecorder()
	s.chatGetSession(getRec, httptest.NewRequest(http.MethodGet, "/api/chat/session/queue-session", nil), initial.ID)
	if getRec.Code != http.StatusOK || !strings.Contains(getRec.Body.String(), `"queued_messages"`) || !strings.Contains(getRec.Body.String(), `"q-1"`) {
		t.Fatalf("session response does not restore queue: status=%d body=%s", getRec.Code, getRec.Body.String())
	}
}

func TestProcessNextQueuedMessageReplacesCompletedReplayToken(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	sid := "queue-after-completed-run"
	if err := saveChatSessionLocked(s.CfgStore.Snapshot(), chatSession{
		ID:             sid,
		QueuedMessages: []chatQueuedMessage{{ID: "q-next", Text: "take over now"}},
	}); err != nil {
		t.Fatal(err)
	}

	completed := &chatRun{SID: sid, Done: true, Events: [][]byte{[]byte(`{"type":"done"}`)}}
	s.ChatMu.Lock()
	s.ChatRuns[sid] = completed
	s.ChatMu.Unlock()

	s.processNextQueuedMessage(sid)

	stored, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.QueuedMessages) != 0 {
		t.Fatalf("completed replay token blocked queue: %#v", stored.QueuedMessages)
	}
	if len(stored.Messages) < 2 || stored.Messages[len(stored.Messages)-2].Role != "user" || stored.Messages[len(stored.Messages)-2].Content != "take over now" {
		t.Fatalf("queued user message was not persisted: %#v", stored.Messages)
	}
	s.ChatMu.Lock()
	current := s.ChatRuns[sid]
	s.ChatMu.Unlock()
	if current == nil || current == completed {
		t.Fatalf("completed replay token was not replaced: current=%p completed=%p", current, completed)
	}
	if current.PendingAssistantID == "" || current.RunStartedAtMS <= 0 {
		t.Fatalf("queued run did not expose stream identity: pending=%q started=%d", current.PendingAssistantID, current.RunStartedAtMS)
	}
	foundPending := false
	for _, message := range stored.Messages {
		if message.ID == current.PendingAssistantID && message.Role == "assistant" && message.RunStartedAtMS == current.RunStartedAtMS {
			foundPending = true
			break
		}
	}
	if !foundPending {
		t.Fatalf("stream identity does not match persisted assistant: pending=%q started=%d messages=%#v", current.PendingAssistantID, current.RunStartedAtMS, stored.Messages)
	}
}

func TestChatQueuePatchUsesLatestBackendState(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	const sid = "queue-authoritative"
	initial := chatSession{
		ID:             sid,
		QueuedMessages: []chatQueuedMessage{{ID: "q-consumed", Text: "already consumed"}},
	}
	if err := saveChatSessionLocked(s.CfgStore.Snapshot(), initial); err != nil {
		t.Fatal(err)
	}

	// Simulate the backend consuming the item while the browser still has the old snapshot.
	s.SessionMu.Lock()
	latest, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err == nil {
		latest.QueuedMessages = nil
		err = saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), latest)
	}
	s.SessionMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}

	patchReq := httptest.NewRequest(http.MethodPatch, "/api/chat/queue/"+sid, strings.NewReader(`{"op":"enqueue","message":{"id":"q-new","text":"new work"}}`))
	patchRec := httptest.NewRecorder()
	s.chatPatchQueue(patchRec, patchReq, sid)
	if patchRec.Code != http.StatusOK {
		t.Fatalf("patch status=%d body=%s", patchRec.Code, patchRec.Body.String())
	}

	getRec := httptest.NewRecorder()
	s.chatGetQueue(getRec, httptest.NewRequest(http.MethodGet, "/api/chat/queue/"+sid, nil), sid)
	if getRec.Code != http.StatusOK {
		t.Fatalf("get status=%d body=%s", getRec.Code, getRec.Body.String())
	}
	var payload struct {
		Messages []chatQueuedMessage `json:"queued_messages"`
	}
	if err := json.Unmarshal(getRec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Messages) != 1 || payload.Messages[0].ID != "q-new" {
		t.Fatalf("authoritative queue resurrected consumed item: %#v", payload.Messages)
	}
}

func TestChatQueueRejectsInvalidEntries(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	req := httptest.NewRequest(http.MethodPut, "/api/chat/queue/queue-session", strings.NewReader(`{"messages":[{"id":"","text":"missing id"}]}`))
	rec := httptest.NewRecorder()
	s.chatReplaceQueue(rec, req, "queue-session")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestChatQueueEventsPublishesPersistedPatch(t *testing.T) {
	root := t.TempDir()
	s := newGoalTestServer(t, root)
	updateTestConfig(t, s.CfgStore, func(cfg *config.AppConfig) {
		cfg.ChatDataDir = filepath.Join(root, "chat-data")
	})
	const sid = "queue-sse"

	stream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.chatQueueEvents(w, r, sid)
	}))
	defer stream.Close()
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, stream.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stream status=%d", resp.StatusCode)
	}

	events := make(chan string, 2)
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			if strings.HasPrefix(scanner.Text(), "event: ") {
				events <- strings.TrimPrefix(scanner.Text(), "event: ")
			}
		}
		close(events)
	}()
	waitEvent := func(want string) {
		t.Helper()
		select {
		case got := <-events:
			if got != want {
				t.Fatalf("event=%q want=%q", got, want)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for %q", want)
		}
	}
	waitEvent("ready")

	patchReq := httptest.NewRequest(http.MethodPatch, "/api/chat/queue/"+sid, strings.NewReader(`{"op":"enqueue","message":{"id":"q-sse","text":"pushed"}}`))
	patchRec := httptest.NewRecorder()
	s.chatPatchQueue(patchRec, patchReq, sid)
	if patchRec.Code != http.StatusOK {
		t.Fatalf("patch status=%d body=%s", patchRec.Code, patchRec.Body.String())
	}
	waitEvent("queue_changed")

	cancel()
	deadline := time.Now().Add(2 * time.Second)
	for {
		s.ChatRuntime.queueEventMu.Lock()
		remaining := len(s.ChatRuntime.queueEventSubs[sid])
		s.ChatRuntime.queueEventMu.Unlock()
		if remaining == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("subscriber was not removed after cancellation: %d", remaining)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestChatSaveSettingsPreservesGeneratedTitleAndActivity(t *testing.T) {
	s := newGoalTestServer(t, t.TempDir())
	cs := chatSession{ID: "generated-settings", Title: "Generated title", TitleSource: chatTitleSourceGenerated, UpdatedAt: 123, Messages: []chatMessage{}}
	if err := saveChatSessionPreserveUpdatedAtLocked(s.CfgStore.Snapshot(), cs); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"llm_no":0}`))
		s.chatSaveSettings(w, req, cs.ID)
		if w.Code != http.StatusOK {
			t.Fatalf("settings: %d %s", w.Code, w.Body.String())
		}
		stored, err := loadChatSession(s.CfgStore.Snapshot(), cs.ID)
		if err != nil || stored.Title != cs.Title || stored.TitleSource != cs.TitleSource || stored.UpdatedAt != cs.UpdatedAt {
			t.Fatalf("settings lost metadata: %v %#v", err, stored)
		}
	}
}
