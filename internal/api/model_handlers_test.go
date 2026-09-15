package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"genericagent-admin-go/internal/config"
	"genericagent-admin-go/internal/modelconfig"
	"genericagent-admin-go/internal/service"
)

func newModelTestServer(t *testing.T, gaRoot string) *Server {
	t.Helper()
	cfg := config.NewStore(t.TempDir())
	updateTestConfig(t, cfg, func(cfg *config.AppConfig) {
		cfg.GARoot = gaRoot
	})
	models := modelconfig.NewStore(t.TempDir())
	return New(cfg, service.NewManager(cfg.Snapshot().GARoot, cfg.Snapshot().BufferLines), models, nil)
}

func TestModelsRawAndPreviewMethodContracts(t *testing.T) {
	s := newModelTestServer(t, t.TempDir())
	h := s.Routes()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/models/raw", strings.NewReader(`{}`))
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusMethodNotAllowed || !strings.Contains(rr.Body.String(), "method not allowed") {
		t.Fatalf("raw POST status=%d want=%d body=%s", rr.Code, http.StatusMethodNotAllowed, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/models/preview", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusMethodNotAllowed || !strings.Contains(rr.Body.String(), "method not allowed") {
		t.Fatalf("preview GET status=%d want=%d body=%s", rr.Code, http.StatusMethodNotAllowed, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/models/preview", strings.NewReader(`{"profiles":[]}`))
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"python"`) {
		t.Fatalf("preview POST status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
}

func TestModelsTitleModelPersistsStableReferenceAndReconcilesOrder(t *testing.T) {
	root := t.TempDir()
	s := newModelTestServer(t, root)
	firstOrder, secondOrder := 0, 1
	profiles := []modelconfig.Profile{
		{
			VarName:     "native_oai_config1",
			DisplayName: "\u6807\u9898\u4f9b\u5e94\u5546",
			Type:        "native_oai",
			Name:        "main",
			APIBase:     "https://api.example/v1",
			Model:       "chat-model",
			ModelConfigs: []modelconfig.ModelConfig{
				{Model: "chat-model", SortOrder: &firstOrder},
				{Model: "title-model", SortOrder: &secondOrder},
			},
			APIKey: "sk-test",
		},
	}
	if _, err := modelconfig.Export(root, profiles, true); err != nil {
		t.Fatal(err)
	}

	getRR := httptest.NewRecorder()
	getReq := httptest.NewRequest(http.MethodGet, "/api/models/title-model", nil)
	s.Routes().ServeHTTP(getRR, getReq)
	if getRR.Code != http.StatusOK {
		t.Fatalf("GET status=%d body=%s", getRR.Code, getRR.Body.String())
	}
	var getResponse struct {
		Options []chatTitleModelOption `json:"options"`
	}
	if err := json.Unmarshal(getRR.Body.Bytes(), &getResponse); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	if len(getResponse.Options) != 2 || getResponse.Options[0].ProviderDisplayName != profiles[0].DisplayName {
		t.Fatalf("GET options=%#v, want provider display name %q", getResponse.Options, profiles[0].DisplayName)
	}

	body := []byte(`{"model":{"provider_var_name":"native_oai_config1","model":"title-model","llm_no":99}}`)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/models/title-model", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("PUT status=%d body=%s", rr.Code, rr.Body.String())
	}
	if got := s.CfgStore.Snapshot().ChatTitleModel; got == nil || got.LLMNo != 1 || got.Model != "title-model" {
		t.Fatalf("saved title model=%#v, want resolved llm_no 1", got)
	}

	profiles[0].ModelConfigs[0].SortOrder = &secondOrder
	profiles[0].ModelConfigs[1].SortOrder = &firstOrder
	if err := s.reconcileChatTitleModel(profiles); err != nil {
		t.Fatal(err)
	}
	if got := s.CfgStore.Snapshot().ChatTitleModel; got == nil || got.LLMNo != 0 {
		t.Fatalf("reconciled title model=%#v, want llm_no 0", got)
	}

	profiles[0].ModelConfigs = profiles[0].ModelConfigs[:1]
	if err := s.reconcileChatTitleModel(profiles); err != nil {
		t.Fatal(err)
	}
	if s.CfgStore.Snapshot().ChatTitleModel != nil {
		t.Fatalf("deleted model should clear selection: %#v", s.CfgStore.Snapshot().ChatTitleModel)
	}
}

func TestModelsSaveAcceptsBooleanFakeCCSystemPrompt(t *testing.T) {
	root := t.TempDir()
	s := newModelTestServer(t, root)
	body := []byte(`{"profiles":[{"var_name":"api_config_main","type":"native_claude","name":"main","apibase":"https://api.example/v1","model":"claude-test","apikey":"sk-real-secret","fake_cc_system_prompt":true}]}`)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/models", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	raw, err := modelconfig.ImportMyKeyWithPython(root, "", true)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython(true) error = %v", err)
	}
	if len(raw.Profiles) != 1 || raw.Profiles[0].FakeCCSystemPrompt == nil || !bool(*raw.Profiles[0].FakeCCSystemPrompt) {
		t.Fatalf("FakeCCSystemPrompt = %#v, want true", raw.Profiles)
	}
}

func TestModelsPreviewRendersBooleanFakeCCSystemPrompt(t *testing.T) {
	s := newModelTestServer(t, t.TempDir())
	body := []byte(`{"profiles":[{"var_name":"api_config_main","type":"native_claude","name":"main","apibase":"https://api.example/v1","model":"claude-test","apikey":"sk-real-secret","fake_cc_system_prompt":true}]}`)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/models/preview", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `\"fake_cc_system_prompt\": True`) {
		t.Fatalf("preview did not render Python bool: %s", rr.Body.String())
	}
}

func TestModelsRawRequiresDangerousConfirm(t *testing.T) {
	root := t.TempDir()
	writeTestMyKey(t, root, "sk-raw-secret")
	s := newModelTestServer(t, root)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/models/raw", nil)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("status=%d want=%d body=%s", rr.Code, http.StatusPreconditionRequired, rr.Body.String())
	}
}

func TestModelsSaveRequiresDangerousConfirm(t *testing.T) {
	s := newModelTestServer(t, t.TempDir())

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/models", strings.NewReader(`{"profiles":[]}`))
	req.Header.Set("Content-Type", "application/json")
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("status=%d want=%d body=%s", rr.Code, http.StatusPreconditionRequired, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPut, "/api/models", strings.NewReader(`{"profiles":[]}`))
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("confirmed status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
}

func TestModelsSaveInvalidatesChatLLMCache(t *testing.T) {
	root := t.TempDir()
	s := newModelTestServer(t, root)
	cfg := s.CfgStore.Snapshot()
	key := chatLLMKey(cfg)
	calls := 0
	loader := func() ([]map[string]interface{}, error) {
		calls++
		return []map[string]interface{}{{"model": "cached"}}, nil
	}
	if _, err := s.ChatLLMCache.load(key, loader); err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/models", strings.NewReader(`{"profiles":[]}`))
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("PUT status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	if _, err := s.ChatLLMCache.load(key, loader); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("loader calls=%d want 2 after models save", calls)
	}
}

func TestModelsRawWithDangerousConfirmReturnsUnmaskedSecret(t *testing.T) {
	root := t.TempDir()
	writeTestMyKey(t, root, "sk-raw-secret")
	s := newModelTestServer(t, root)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/models/raw", nil)
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "sk-raw-secret") {
		t.Fatalf("raw response did not include unmasked secret from mykey.py: %s", rr.Body.String())
	}
}

func TestModelsRawWithDangerousConfirmOverlaysMaskedCacheFromMyKey(t *testing.T) {
	gaRoot := t.TempDir()
	writeTestMyKey(t, gaRoot, "sk-test-secret-value")
	s := newModelTestServer(t, gaRoot)
	masked := modelconfig.Draft{Profiles: []modelconfig.Profile{{
		VarName: "api_config_main",
		Type:    "openai",
		Name:    "main",
		APIBase: "https://api.example/v1",
		Model:   "gpt-test",
		APIKey:  "sk-****alue",
	}}}
	data, err := json.Marshal(masked)
	if err != nil {
		t.Fatalf("marshal masked cache: %v", err)
	}
	if err := os.WriteFile(filepath.Join(s.Models.Root, "model_profiles.json"), data, 0600); err != nil {
		t.Fatalf("write masked cache: %v", err)
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/models/raw", nil)
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, "sk-test-secret-value") {
		t.Fatalf("raw response did not overlay secret from mykey.py: %s", body)
	}
	if strings.Contains(body, "sk-****alue") {
		t.Fatalf("raw response still contained masked cache value: %s", body)
	}
}

func TestModelsRawWithDangerousConfirmIncludesMyKeyProfilesWhenCacheDiffers(t *testing.T) {
	gaRoot := t.TempDir()
	text := "native_oai_primary = {\n" +
		"    'name': 'from-mykey',\n" +
		"    'apibase': 'https://api.example/v1',\n" +
		"    'model': 'gpt-live',\n" +
		"    'apikey': 'sk-live-secret-value',\n" +
		"}\n"
	if err := os.WriteFile(filepath.Join(gaRoot, "mykey.py"), []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	s := newModelTestServer(t, gaRoot)
	cache := modelconfig.Draft{Profiles: []modelconfig.Profile{{
		VarName: "native_oai_config1",
		Type:    "openai",
		Name:    "stale-cache",
		APIBase: "https://api.example/v1",
		Model:   "gpt-stale",
		APIKey:  "",
	}}}
	data, err := json.Marshal(cache)
	if err != nil {
		t.Fatalf("marshal cache: %v", err)
	}
	if err := os.WriteFile(filepath.Join(s.Models.Root, "model_profiles.json"), data, 0600); err != nil {
		t.Fatalf("write cache: %v", err)
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/models/raw", nil)
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, "native_oai_primary") || !strings.Contains(body, "sk-live-secret-value") {
		t.Fatalf("raw response did not include revealed mykey profile: %s", body)
	}
	if strings.Contains(body, "native_oai_config1") || strings.Contains(body, "gpt-stale") || strings.Contains(body, "stale-cache") {
		t.Fatalf("raw response should ignore stale cache profiles and only reflect mykey.py: %s", body)
	}
}

func TestModelsImportMyKeyRevealRequiresDangerousConfirm(t *testing.T) {
	gaRoot := t.TempDir()
	writeTestMyKey(t, gaRoot, "sk-test-secret-value")
	s := newModelTestServer(t, gaRoot)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/models/import-mykey", strings.NewReader(`{"reveal":true,"save":false}`))
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("status=%d want=%d body=%s", rr.Code, http.StatusPreconditionRequired, rr.Body.String())
	}
}

func TestModelsImportMyKeyRevealWithDangerousConfirm(t *testing.T) {
	gaRoot := t.TempDir()
	writeTestMyKey(t, gaRoot, "sk-test-secret-value")
	s := newModelTestServer(t, gaRoot)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/models/import-mykey", strings.NewReader(`{"reveal":true,"save":false}`))
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, "sk-test-secret-value") || strings.Contains(body, `"masked":true`) {
		t.Fatalf("reveal response did not include unmasked secret metadata: %s", body)
	}
}

func TestModelsImportMyKeyMasksByDefaultAndDoesNotSave(t *testing.T) {
	gaRoot := t.TempDir()
	writeTestMyKey(t, gaRoot, "sk-test-secret-value")
	s := newModelTestServer(t, gaRoot)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/models/import-mykey", strings.NewReader(`{"reveal":false,"save":false}`))
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if strings.Contains(body, "sk-test-secret-value") || !strings.Contains(body, `"masked":true`) || !strings.Contains(body, "sk-****alue") {
		t.Fatalf("masked import leaked or missing mask metadata: %s", body)
	}
}

func TestModelsImportMyKeyRefusesToSaveMaskedProfiles(t *testing.T) {
	gaRoot := t.TempDir()
	writeTestMyKey(t, gaRoot, "sk-test-secret-value")
	s := newModelTestServer(t, gaRoot)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/models/import-mykey", strings.NewReader(`{"reveal":false,"save":true}`))
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("status=%d want=428 body=%s", rr.Code, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/models/import-mykey", strings.NewReader(`{"reveal":false,"save":true}`))
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want=400 body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "refusing to save masked") {
		t.Fatalf("unexpected body: %s", rr.Body.String())
	}
}

func TestModelsExportAllowsMaskedAPIKey(t *testing.T) {
	s := newModelTestServer(t, t.TempDir())
	payload := map[string]interface{}{
		"overwrite_active": false,
		"profiles":         []modelconfig.Profile{{VarName: "api_config_main", Type: "openai", Name: "main", APIBase: "https://api.example/v1", Model: "gpt", APIKey: "sk-****alue"}},
	}
	data, _ := json.Marshal(payload)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/models/export", bytes.NewReader(data))
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
}

func TestModelsExportRequiresDangerousConfirm(t *testing.T) {
	s := newModelTestServer(t, t.TempDir())
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/models/export", strings.NewReader(`{"profiles":[]}`))
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("status=%d want=428 body=%s", rr.Code, rr.Body.String())
	}
}

func TestModelsExportRenamedProviderInheritsSecretByPreviousVarName(t *testing.T) {
	root := t.TempDir()
	const oldVar = "native_oai_config_gpt55_medium"
	const newVar = "native_claude_config_gpt55_medium"
	const secret = "sk-renamed-provider-secret"
	writeTestMyKeyVar(t, root, oldVar, secret)
	s := newModelTestServer(t, root)

	payload := map[string]interface{}{
		"overwrite_active": true,
		"profiles": []map[string]interface{}{{
			"var_name":          newVar,
			"previous_var_name": oldVar,
			"type":              "native_claude",
			"name":              "renamed provider",
			"apibase":           "https://api.example/v1",
			"model":             "claude-test",
			"apikey":            "sk-****cret",
		}},
	}
	body, _ := json.Marshal(payload)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/models/export", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}

	active, err := os.ReadFile(filepath.Join(root, "mykey.py"))
	if err != nil {
		t.Fatalf("read mykey.py: %v", err)
	}
	activeText := string(active)
	if !strings.Contains(activeText, newVar) || !strings.Contains(activeText, secret) {
		t.Fatalf("renamed provider did not inherit its saved secret:\n%s", activeText)
	}
	if strings.Contains(activeText, oldVar+" =") || strings.Contains(activeText, "previous_var_name") || strings.Contains(activeText, "****") {
		t.Fatalf("transient rename data leaked into mykey.py:\n%s", activeText)
	}
}

func TestModelsSaveAndExportUseMyKeySecretForOfficialGeneratedVarName(t *testing.T) {
	root := t.TempDir()
	const varName = "native_oai_config_gpt55_medium_responses"
	const secret = "sk-gpt55-real-secret-value"
	writeTestMyKeyVar(t, root, varName, secret)
	s := newModelTestServer(t, root)
	profile := modelconfig.Profile{
		VarName: varName,
		Type:    "native_oai",
		Name:    "gpt55 medium responses",
		APIBase: "https://api.example/v1",
		Model:   "gpt-5.5-medium",
		APIKey:  "sk-****alue",
	}

	body, _ := json.Marshal(map[string]interface{}{"profiles": []modelconfig.Profile{profile}})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/models", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("PUT status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	loaded, err := modelconfig.ImportMyKeyWithPython(root, "", true)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython error = %v", err)
	}
	if len(loaded.Profiles) != 1 || loaded.Profiles[0].VarName != varName || loaded.Profiles[0].APIKey != secret {
		t.Fatalf("active mykey profiles = %#v, want %s with recovered secret", loaded.Profiles, varName)
	}

	payload := map[string]interface{}{
		"overwrite_active": true,
		"profiles":         []modelconfig.Profile{profile},
	}
	body, _ = json.Marshal(payload)
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/models/export", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("export status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	active, err := os.ReadFile(filepath.Join(root, "mykey.py"))
	if err != nil {
		t.Fatalf("read mykey.py: %v", err)
	}
	activeText := string(active)
	if !strings.Contains(activeText, varName) || !strings.Contains(activeText, secret) {
		t.Fatalf("active mykey.py did not write recovered secret:\n%s", activeText)
	}
	if strings.Contains(activeText, "****") {
		t.Fatalf("active mykey.py still contains masked key:\n%s", activeText)
	}
}

func TestModelsExportPreservesExistingSecretWhenSubmittedBlank(t *testing.T) {
	root := t.TempDir()
	writeTestMyKey(t, root, "sk-real-secret")
	s := newModelTestServer(t, root)
	payload := map[string]interface{}{
		"overwrite_active": true,
		"profiles": []modelconfig.Profile{{
			VarName: "api_config_main",
			Type:    "openai",
			Name:    "main",
			APIBase: "https://api.example/v1",
			Model:   "gpt-updated",
			APIKey:  "",
		}},
	}
	body, _ := json.Marshal(payload)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/models/export", bytes.NewReader(body))
	s.modelsExport(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	active, err := os.ReadFile(filepath.Join(root, "mykey.py"))
	if err != nil {
		t.Fatalf("read mykey.py: %v", err)
	}
	if text := string(active); !strings.Contains(text, "sk-real-secret") || strings.Contains(text, "\"apikey\": \"\"") {
		t.Fatalf("active mykey.py did not preserve secret:\n%s", text)
	}
	loaded, err := modelconfig.ImportMyKeyWithPython(root, "", true)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython error = %v", err)
	}
	if len(loaded.Profiles) != 1 || loaded.Profiles[0].APIKey != "sk-real-secret" || loaded.Profiles[0].Model != "gpt-updated" {
		t.Fatalf("active mykey profile = %#v, want preserved secret and updated model", loaded.Profiles)
	}
}

func TestModelsDiscoverUsesSecretFromMyKeyWhenQueryKeyIsMasked(t *testing.T) {
	var gotAuth string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if gotAuth == "Bearer ********" || strings.Contains(gotAuth, "****") {
			t.Errorf("masked API key was forwarded upstream: %q", gotAuth)
		}
		if gotAuth != "Bearer sk-test-secret-value" {
			http.Error(w, `{"code":"INVALID_API_KEY","message":"Invalid API key"}`, http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"gpt-secret-model","owned_by":"test"}]}`))
	}))
	defer upstream.Close()

	gaRoot := t.TempDir()
	writeTestMyKey(t, gaRoot, "sk-test-secret-value")
	s := newModelTestServer(t, gaRoot)
	q := url.Values{}
	q.Set("protocol", "native_oai")
	q.Set("base_url", upstream.URL)
	q.Set("api_key", "********")
	q.Set("var_name", "api_config_main")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/models/discover?"+q.Encode(), nil)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s auth=%q", rr.Code, rr.Body.String(), gotAuth)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "gpt-secret-model") {
		t.Fatalf("missing discovered model: %s", body)
	}
	if strings.Contains(body, "sk-test-secret-value") {
		t.Fatalf("response leaked secret: %s", body)
	}
}

func TestModelsDiscoverOpenAIUsesV1FallbackWhenRootModelsReturnsHTML(t *testing.T) {
	var paths []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		switch r.URL.Path {
		case "/models":
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte(`<!doctype html><html><body>not api</body></html>`))
		case "/v1/models":
			if r.Header.Get("Authorization") != "Bearer sk-oai-test" {
				t.Errorf("Authorization header = %q", r.Header.Get("Authorization"))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"gpt-relay-model","owned_by":"relay"},{"id":"gpt-relay-model"}]}`))
		default:
			t.Errorf("unexpected upstream path %q", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	s := newModelTestServer(t, t.TempDir())
	q := url.Values{}
	q.Set("protocol", "native_oai")
	q.Set("base_url", upstream.URL)
	q.Set("api_key", "sk-oai-test")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/models/discover?"+q.Encode(), nil)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s paths=%v", rr.Code, rr.Body.String(), paths)
	}
	if got := strings.Join(paths, ","); got != "/models,/v1/models" {
		t.Fatalf("paths=%q", got)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "gpt-relay-model") || !strings.Contains(body, "/v1/models") {
		t.Fatalf("missing fallback model or endpoint: %s", body)
	}
}

func TestModelsDiscoverClaudeUsesAnthropicModelsFallback(t *testing.T) {
	var paths []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Errorf("anthropic-version header = %q", r.Header.Get("anthropic-version"))
		}
		if r.Header.Get("x-api-key") != "sk-ant-test" {
			t.Errorf("x-api-key header = %q", r.Header.Get("x-api-key"))
		}
		switch r.URL.Path {
		case "/anthropic/models":
			http.Error(w, "not found", http.StatusNotFound)
		case "/anthropic/v1/models":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"claude-relay-model","owned_by":"anthropic"},{"id":"claude-relay-model"}]}`))
		default:
			t.Errorf("unexpected upstream path %q", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	s := newModelTestServer(t, t.TempDir())
	q := url.Values{}
	q.Set("protocol", "native_claude")
	q.Set("base_url", upstream.URL+"/anthropic")
	q.Set("api_key", "sk-ant-test")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/models/discover?"+q.Encode(), nil)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s paths=%v", rr.Code, rr.Body.String(), paths)
	}
	if got := strings.Join(paths, ","); got != "/anthropic/models,/anthropic/v1/models" {
		t.Fatalf("paths=%q", got)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "claude-relay-model") || !strings.Contains(body, "/anthropic/v1/models") {
		t.Fatalf("missing fallback model or endpoint: %s", body)
	}
}

func writeTestMyKey(t *testing.T, root, key string) {
	t.Helper()
	writeTestMyKeyVar(t, root, "api_config_main", key)
}

func writeTestMyKeyVar(t *testing.T, root, varName, key string) {
	t.Helper()
	text := varName + " = {\n" +
		"    'name': 'main',\n" +
		"    'apibase': 'https://api.example/v1',\n" +
		"    'model': 'gpt-test',\n" +
		"    'apikey': '" + key + "',\n" +
		"}\n"
	if err := os.WriteFile(filepath.Join(root, "mykey.py"), []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestModelsPreviewAllowsMaskedSecretWithoutLeakingStoredSecret(t *testing.T) {
	s := newModelTestServer(t, t.TempDir())
	if _, err := s.Models.Save([]modelconfig.Profile{{
		VarName: "api_config_main",
		Type:    "openai",
		Name:    "main",
		APIBase: "https://api.example/v1",
		Model:   "gpt-test",
		APIKey:  "sk-real-secret",
	}}); err != nil {
		t.Fatalf("seed Save() error = %v", err)
	}
	body := []byte(`{"profiles":[{"var_name":"api_config_main","type":"openai","name":"main","apibase":"https://api.example/v1","model":"gpt-test","apikey":"sk-****cret"}]}`)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/models/preview", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	bodyText := rr.Body.String()
	if !strings.Contains(bodyText, `\"apikey\": \"sk-****cret\"`) {
		t.Fatalf("preview did not keep masked placeholder: %s", bodyText)
	}
	if strings.Contains(bodyText, "sk-real-secret") {
		t.Fatalf("preview leaked stored secret: %s", bodyText)
	}
}

func TestModelsAreScopedToRequestedInstance(t *testing.T) {
	appRoot := t.TempDir()
	defaultRoot := filepath.Join(t.TempDir(), "ga-default")
	betaRoot := filepath.Join(t.TempDir(), "ga-beta")
	for _, root := range []string{defaultRoot, betaRoot} {
		if err := os.MkdirAll(root, 0755); err != nil {
			t.Fatal(err)
		}
	}

	store := config.NewStore(appRoot)
	cfg := store.Snapshot()
	cfg.GARoot = defaultRoot
	cfg.DefaultInstanceID = "default"
	cfg.Instances = []config.InstanceConfig{
		{ID: "default", Name: "Default", GARoot: defaultRoot},
		{ID: "beta", Name: "Beta", GARoot: betaRoot},
	}
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}
	s := New(store, service.NewManager(defaultRoot, cfg.BufferLines), modelconfig.NewStore(defaultRoot), nil)

	body := `{"profiles":[{"var_name":"native_oai_config1","type":"native_oai","name":"Beta Model","apibase":"https://beta.example/v1","apikey":"sk-beta","model":"beta-model"}]}`
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/models", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GA-Instance-ID", "beta")
	markDangerous(req)
	s.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("beta PUT status=%d body=%s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("X-GA-Instance-ID"); got != "beta" {
		t.Fatalf("resolved instance header=%q want beta", got)
	}
	if _, err := os.Stat(filepath.Join(betaRoot, "mykey.py")); err != nil {
		t.Fatalf("beta mykey.py was not written: %v", err)
	}
	if _, err := os.Stat(filepath.Join(defaultRoot, "mykey.py")); !os.IsNotExist(err) {
		t.Fatalf("default mykey.py was unexpectedly written: %v", err)
	}

	for instanceID, wantModel := range map[string]string{"default": "", "beta": "beta-model"} {
		rr = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodGet, "/api/models", nil)
		req.Header.Set("X-GA-Instance-ID", instanceID)
		s.Routes().ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("%s GET status=%d body=%s", instanceID, rr.Code, rr.Body.String())
		}
		if wantModel == "" && strings.Contains(rr.Body.String(), "beta-model") {
			t.Fatalf("default response leaked beta model: %s", rr.Body.String())
		}
		if wantModel != "" && !strings.Contains(rr.Body.String(), wantModel) {
			t.Fatalf("beta response missing %q: %s", wantModel, rr.Body.String())
		}
	}
}
