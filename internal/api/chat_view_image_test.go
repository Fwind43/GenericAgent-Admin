package api

import (
	"testing"

	"genericagent-admin-go/internal/config"
)

func TestResolveChatViewImage(t *testing.T) {
	options := []chatTitleModelOption{{ProviderVarName: "p1", Model: "m1", LLMNo: 0}, {ProviderVarName: "p2", Model: "vis", LLMNo: 1}}
	if got, ok := resolveChatViewImage(nil, options); !ok || got != nil {
		t.Fatalf("nil ref: %#v %v", got, ok)
	}
	got, ok := resolveChatViewImage(&config.ChatViewImageRef{Enable: true, Model: "ignored", LLMNo: 7}, options)
	if !ok || *got != (config.ChatViewImageRef{Enable: true, Mode: "main"}) {
		t.Fatalf("main mode should drop routing fields: %#v %v", got, ok)
	}
	got, ok = resolveChatViewImage(&config.ChatViewImageRef{Enable: true, Mode: "vision", ProviderVarName: " p2 ", Model: "vis", LLMNo: 9}, options)
	if !ok || got.LLMNo != 1 || got.ProviderVarName != "p2" {
		t.Fatalf("vision should resolve current llm_no: %#v %v", got, ok)
	}
	if _, ok := resolveChatViewImage(&config.ChatViewImageRef{Enable: true, Mode: "vision", ProviderVarName: "p3", Model: "gone"}, options); ok {
		t.Fatal("missing vision model must be rejected")
	}
	if _, ok := resolveChatViewImage(&config.ChatViewImageRef{Mode: "other"}, options); ok {
		t.Fatal("unknown mode must be rejected")
	}
}

func TestApplyViewImageRequestField(t *testing.T) {
	req := map[string]interface{}{}
	applyViewImageRequestField(req, config.AppConfig{})
	applyViewImageRequestField(req, config.AppConfig{ChatViewImage: &config.ChatViewImageRef{Enable: false, Mode: "main"}})
	if _, ok := req["view_image"]; ok {
		t.Fatalf("disabled must not inject: %#v", req)
	}
	applyViewImageRequestField(req, config.AppConfig{ChatViewImage: &config.ChatViewImageRef{Enable: true, Mode: "main", LLMNo: 3}})
	field := req["view_image"].(map[string]interface{})
	if field["mode"] != "main" || field["enabled"] != true {
		t.Fatalf("main field: %#v", field)
	}
	if _, ok := field["llm_no"]; ok {
		t.Fatalf("main mode must not carry llm_no: %#v", field)
	}
	applyViewImageRequestField(req, config.AppConfig{ChatViewImage: &config.ChatViewImageRef{Enable: true, Mode: "vision", LLMNo: 2}})
	if field := req["view_image"].(map[string]interface{}); field["llm_no"] != 2 {
		t.Fatalf("vision field: %#v", field)
	}
}
