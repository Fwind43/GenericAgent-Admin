package modelconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestPythonUTF8EnvOverridesEncoding(t *testing.T) {
	env := pythonUTF8Env([]string{
		"PATH=C:\\bin",
		"pythonioencoding=gbk",
		"PYTHONUTF8=0",
		"PythonIoEncoding=cp936",
		"OTHER=value",
	})
	values := make(map[string][]string)
	for _, item := range env {
		key, value, ok := strings.Cut(item, "=")
		if !ok {
			continue
		}
		values[strings.ToUpper(key)] = append(values[strings.ToUpper(key)], value)
	}
	if got := values["PYTHONIOENCODING"]; len(got) != 1 || got[0] != "utf-8" {
		t.Fatalf("PYTHONIOENCODING = %#v, want [utf-8]", got)
	}
	if got := values["PYTHONUTF8"]; len(got) != 1 || got[0] != "1" {
		t.Fatalf("PYTHONUTF8 = %#v, want [1]", got)
	}
	if got := values["PATH"]; len(got) != 1 || got[0] != `C:\bin` {
		t.Fatalf("PATH = %#v, want [C:\\bin]", got)
	}
	if got := values["OTHER"]; len(got) != 1 || got[0] != "value" {
		t.Fatalf("OTHER = %#v, want [value]", got)
	}
}

func TestProfileAcceptsBooleanFakeCCSystemPrompt(t *testing.T) {
	data := []byte(`{"profiles":[{"var_name":"api_config_main","type":"native_claude","name":"main","apibase":"https://api.example/v1","model":"claude-test","apikey":"sk-real-secret","fake_cc_system_prompt":true}]}`)
	var draft Draft
	if err := json.Unmarshal(data, &draft); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if len(draft.Profiles) != 1 || draft.Profiles[0].FakeCCSystemPrompt == nil || !bool(*draft.Profiles[0].FakeCCSystemPrompt) {
		t.Fatalf("FakeCCSystemPrompt = %#v, want true", draft.Profiles)
	}
	rendered, err := Render(draft.Profiles)
	if err != nil {
		t.Fatalf("Render() error = %v", err)
	}
	if !strings.Contains(rendered, `"fake_cc_system_prompt": True`) {
		t.Fatalf("rendered fake_cc_system_prompt not Python bool:\n%s", rendered)
	}
}

func TestProfileAcceptsLegacyStringFakeCCSystemPrompt(t *testing.T) {
	data := []byte(`{"profiles":[{"var_name":"api_config_main","type":"native_claude","name":"main","apibase":"https://api.example/v1","model":"claude-test","apikey":"sk-real-secret","fake_cc_system_prompt":"false"}]}`)
	var draft Draft
	if err := json.Unmarshal(data, &draft); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if len(draft.Profiles) != 1 || draft.Profiles[0].FakeCCSystemPrompt == nil || bool(*draft.Profiles[0].FakeCCSystemPrompt) {
		t.Fatalf("FakeCCSystemPrompt = %#v, want false", draft.Profiles)
	}
	rendered, err := Render(draft.Profiles)
	if err != nil {
		t.Fatalf("Render() error = %v", err)
	}
	if !strings.Contains(rendered, `"fake_cc_system_prompt": False`) {
		t.Fatalf("rendered fake_cc_system_prompt not Python false:\n%s", rendered)
	}
}

func TestLegacyProfileServiceTierRenders(t *testing.T) {
	data := []byte(`{"profiles":[{"var_name":"native_oai_config_main","type":"native_oai","name":"main","apibase":"https://api.example/v1","model":"gpt-test","apikey":"sk-real-secret","service_tier":"priority"}]}`)
	var draft Draft
	if err := json.Unmarshal(data, &draft); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if len(draft.Profiles) != 1 || draft.Profiles[0].ServiceTier != "priority" {
		t.Fatalf("ServiceTier = %#v, want priority", draft.Profiles)
	}
	rendered, err := Render(draft.Profiles)
	if err != nil {
		t.Fatalf("Render() error = %v", err)
	}
	if !strings.Contains(rendered, `"service_tier": "priority"`) {
		t.Fatalf("rendered service_tier missing:\n%s", rendered)
	}
}

func TestStoreSaveCreatesRootAndLoadsMaskedSecrets(t *testing.T) {
	root := filepath.Join(t.TempDir(), "missing", "models")
	store := NewStore(root)
	profiles := []Profile{{
		VarName: "api_config_main",
		Type:    "openai",
		Name:    "main",
		APIBase: "https://api.example/v1",
		Model:   "gpt-test",
		APIKey:  "sk-real-secret",
	}}
	if _, err := store.Save(profiles); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	st, err := os.Stat(filepath.Join(root, "model_profiles.json"))
	if err != nil {
		t.Fatalf("saved file missing: %v", err)
	}
	if runtime.GOOS != "windows" && st.Mode().Perm() != 0600 {
		t.Fatalf("saved file perm = %v, want 0600", st.Mode().Perm())
	}
	draft, err := store.Load(false)
	if err != nil {
		t.Fatalf("Load(false) error = %v", err)
	}
	if got := draft.Profiles[0].APIKey; got != "******" {
		t.Fatalf("masked APIKey = %q, want ******", got)
	}
	raw, err := store.Load(true)
	if err != nil {
		t.Fatalf("Load(true) error = %v", err)
	}
	if got := raw.Profiles[0].APIKey; got != "sk-real-secret" {
		t.Fatalf("raw APIKey = %q", got)
	}
}

func TestStoreSavePreservesExistingSecretWhenSubmittedBlank(t *testing.T) {
	root := t.TempDir()
	store := NewStore(root)
	profiles := []Profile{{
		VarName: "api_config_main",
		Type:    "openai",
		Name:    "main",
		APIBase: "https://api.example/v1",
		Model:   "gpt-test",
		APIKey:  "sk-real-secret",
	}}
	if _, err := store.Save(profiles); err != nil {
		t.Fatalf("seed Save() error = %v", err)
	}
	profiles[0].APIKey = ""
	profiles[0].Model = "gpt-updated"
	if _, err := store.Save(profiles); err != nil {
		t.Fatalf("Save(blank secret) error = %v", err)
	}
	raw, err := store.Load(true)
	if err != nil {
		t.Fatalf("Load(true) error = %v", err)
	}
	if got := raw.Profiles[0].APIKey; got != "sk-real-secret" {
		t.Fatalf("preserved APIKey = %q, want old secret", got)
	}
	if got := raw.Profiles[0].Model; got != "gpt-updated" {
		t.Fatalf("updated model = %q", got)
	}
}

func TestStoreSaveAllowsMaskedSecret(t *testing.T) {
	root := t.TempDir()
	store := NewStore(root)
	profiles := []Profile{{
		VarName: "api_config_main",
		Type:    "openai",
		Name:    "main",
		APIBase: "https://api.example/v1",
		Model:   "gpt-test",
		APIKey:  "sk-****cret",
	}}
	if _, err := store.Save(profiles); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	raw, err := store.Load(true)
	if err != nil {
		t.Fatalf("Load(true) error = %v", err)
	}
	if got := raw.Profiles[0].APIKey; got != "sk-****cret" {
		t.Fatalf("saved APIKey = %q, want masked placeholder", got)
	}
}

func TestExportPreservesChannelsAndOtherMyKeySource(t *testing.T) {
	root := t.TempDir()
	const original = `# User-maintained settings must survive model saves.
telegram_bot_token = "telegram-secret"
telegram_allowed_users = ["alice"]
custom_settings = {"theme": "dark"}

native_oai_config_old = {
    "apikey": "sk-old-secret",
    "apibase": "https://old.example/v1",
    "model": "old-model",
}
`
	active := filepath.Join(root, "mykey.py")
	if err := os.WriteFile(active, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	profiles := []Profile{{
		VarName:       "native_oai_config_new",
		SourceVarName: "native_oai_config_old",
		Type:          "native_oai",
		Name:          "new",
		APIBase:       "https://new.example/v1",
		Model:         "new-model",
		APIKey:        "sk-new-secret",
	}}
	if _, err := Export(root, profiles, true); err != nil {
		t.Fatalf("Export() error = %v", err)
	}

	data, err := os.ReadFile(active)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{
		`telegram_bot_token = "telegram-secret"`,
		`telegram_allowed_users = ["alice"]`,
		`custom_settings = {"theme": "dark"}`,
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("Export() removed unrelated mykey.py source %q:\n%s", want, text)
		}
	}
	if got := strings.Count(text, "# >>> GA Admin managed models >>>"); got != 1 {
		t.Fatalf("managed model block begin count = %d, want 1:\n%s", got, text)
	}
	if got := strings.Count(text, "# <<< GA Admin managed models <<<"); got != 1 {
		t.Fatalf("managed model block end count = %d, want 1:\n%s", got, text)
	}

	draft, err := ImportMyKeyWithPython(root, "", true)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython() error = %v", err)
	}
	if len(draft.Profiles) != 1 || draft.Profiles[0].VarName != "native_oai_config_new" {
		t.Fatalf("runtime profiles = %#v, want only newly managed profile", draft.Profiles)
	}

	profiles[0].Model = "newer-model"
	if _, err := Export(root, profiles, true); err != nil {
		t.Fatalf("second Export() error = %v", err)
	}
	data, err = os.ReadFile(active)
	if err != nil {
		t.Fatal(err)
	}
	text = string(data)
	if got := strings.Count(text, "# >>> GA Admin managed models >>>"); got != 1 {
		t.Fatalf("second Export() managed block count = %d, want 1:\n%s", got, text)
	}
	if got := strings.Count(text, `telegram_bot_token = "telegram-secret"`); got != 1 {
		t.Fatalf("second Export() channel assignment count = %d, want 1:\n%s", got, text)
	}
}

func TestExportRejectsUnsafeSourceAssignmentsWithoutWriting(t *testing.T) {
	tests := []struct {
		name       string
		original   string
		wantErrSub string
	}{
		{
			name: "duplicate assignments",
			original: "native_oai_config_old = {'model': 'one'}\n" +
				"native_oai_config_old = {'model': 'two'}\n",
			wantErrSub: "multiple top-level assignments found",
		},
		{
			name:       "chained assignment",
			original:   "alias = native_oai_config_old = {'model': 'one'}\n",
			wantErrSub: "not a standalone single-target assignment",
		},
		{
			name:       "invalid syntax",
			original:   "native_oai_config_old = {\n",
			wantErrSub: "mykey.py syntax error",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			active := filepath.Join(root, "mykey.py")
			if err := os.WriteFile(active, []byte(tt.original), 0600); err != nil {
				t.Fatal(err)
			}
			profiles := []Profile{{
				VarName:       "native_oai_config_new",
				SourceVarName: "native_oai_config_old",
				Type:          "native_oai",
				Name:          "new",
				APIBase:       "https://new.example/v1",
				Model:         "new-model",
				APIKey:        "sk-new-secret",
			}}

			if _, err := Export(root, profiles, true); err == nil || !strings.Contains(err.Error(), tt.wantErrSub) {
				t.Fatalf("Export() error = %v, want substring %q", err, tt.wantErrSub)
			}
			got, err := os.ReadFile(active)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != tt.original {
				t.Fatalf("mykey.py changed after rejected export:\n%s", got)
			}
			backups, err := filepath.Glob(filepath.Join(root, "mykey.py.bak-*"))
			if err != nil {
				t.Fatal(err)
			}
			if len(backups) != 0 {
				t.Fatalf("rejected export created backups: %v", backups)
			}
		})
	}
}

func TestExportWritesOfficialMyKeyAtomically(t *testing.T) {
	root := filepath.Join(t.TempDir(), "missing", "ga")
	profiles := []Profile{{
		VarName: "api_config_main",
		Type:    "openai",
		Name:    "main",
		APIBase: "https://api.example/v1",
		Model:   "gpt-test",
		APIKey:  "sk-real-secret",
	}}
	res, err := Export(root, profiles, true)
	if err != nil {
		t.Fatalf("Export() error = %v", err)
	}
	if res["activated"] != true {
		t.Fatalf("activated = %v, want true", res["activated"])
	}
	p := filepath.Join(root, "mykey.py")
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("mykey.py missing: %v", err)
	}
	if !strings.Contains(string(data), "sk-real-secret") || !strings.Contains(string(data), "api_config_main") {
		t.Fatalf("mykey.py content missing rendered profile: %q", string(data))
	}
	if st, err := os.Stat(p); err != nil {
		t.Fatalf("stat mykey.py: %v", err)
	} else if runtime.GOOS != "windows" && st.Mode().Perm() != 0600 {
		t.Fatalf("mykey.py perm = %v, want 0600", st.Mode().Perm())
	}
	if _, err := os.Stat(filepath.Join(root, "mykey_admin.generated.py")); !os.IsNotExist(err) {
		t.Fatalf("mykey_admin.generated.py should not be written; stat err=%v", err)
	}
}

func TestEmptyProviderValidatesAndRoundTripsThroughMyKey(t *testing.T) {
	root := t.TempDir()
	profiles := []Profile{{
		VarName: "native_oai_config_empty",
		Type:    "native_oai",
		Name:    "Empty provider",
		APIBase: "https://api.empty.example/v1",
		APIKey:  "sk-empty-secret",
	}}

	if err := Validate(profiles); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if _, err := Export(root, profiles, true); err != nil {
		t.Fatalf("Export() error = %v", err)
	}
	data, err := os.ReadFile(filepath.Join(root, "mykey.py"))
	if err != nil {
		t.Fatalf("read mykey.py: %v", err)
	}
	text := string(data)
	if strings.Contains(text, "\nnative_oai_config_empty =") {
		t.Fatalf("empty provider must not render a discoverable GA model config:\n%s", text)
	}
	if !strings.Contains(text, "_ga_admin_provider_groups") || !strings.Contains(text, "native_oai_config_empty") {
		t.Fatalf("empty provider metadata missing:\n%s", text)
	}

	draft, err := ImportMyKeyWithPython(root, "", true)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython() error = %v", err)
	}
	if len(draft.Profiles) != 1 {
		t.Fatalf("profiles len = %d, want one empty provider: %#v", len(draft.Profiles), draft.Profiles)
	}
	got := draft.Profiles[0]
	if got.VarName != profiles[0].VarName || got.Type != profiles[0].Type || got.Name != profiles[0].Name || got.APIBase != profiles[0].APIBase || got.APIKey != profiles[0].APIKey {
		t.Fatalf("round-tripped provider = %#v, want %#v", got, profiles[0])
	}
	if len(got.ModelConfigs) != 0 || len(got.Models) != 0 || got.Model != "" {
		t.Fatalf("empty provider gained models: %#v", got)
	}
}

func TestExportImportKeepsProviderModelsGrouped(t *testing.T) {
	root := t.TempDir()
	profiles := []Profile{{
		VarName: "native_oai_config_acme",
		Type:    "native_oai",
		Name:    "Acme",
		APIBase: "https://api.acme.example/v1",
		Model:   "acme-chat",
		Models:  []string{"acme-chat", "acme-reasoning"},
		APIKey:  "sk-real-secret",
	}}
	if _, err := Export(root, profiles, true); err != nil {
		t.Fatalf("Export() error = %v", err)
	}

	draft, err := ImportMyKeyWithPython(root, "", true)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython() error = %v", err)
	}
	if len(draft.Profiles) != 1 {
		t.Fatalf("profiles len = %d, want one provider: %#v", len(draft.Profiles), draft.Profiles)
	}
	got := draft.Profiles[0]
	if got.VarName != "native_oai_config_acme" {
		t.Fatalf("provider var_name = %q, want native_oai_config_acme", got.VarName)
	}
	if got.Model != "acme-chat" {
		t.Fatalf("primary model = %q, want acme-chat", got.Model)
	}
	if len(got.Models) != 2 || got.Models[0] != "acme-chat" || got.Models[1] != "acme-reasoning" {
		t.Fatalf("provider models = %#v, want both exported models", got.Models)
	}
}

func TestExportImportPreservesPerModelDisplayNames(t *testing.T) {
	root := t.TempDir()
	data := []byte(`{"profiles":[{"var_name":"native_oai_config_acme","type":"native_oai","name":"Acme","apibase":"https://api.acme.example/v1","apikey":"sk-test-only","model_configs":[{"model":"acme-chat","name":"Acme Chat"},{"model":"acme-reasoning","name":"Acme Reasoning"}]}]}`)
	var input Draft
	if err := json.Unmarshal(data, &input); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if _, err := Export(root, input.Profiles, true); err != nil {
		t.Fatalf("Export() error = %v", err)
	}

	draft, err := ImportMyKeyWithPython(root, "", true)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython() error = %v", err)
	}
	encoded, err := json.Marshal(draft.Profiles[0].ModelConfigs)
	if err != nil {
		t.Fatalf("Marshal result error = %v", err)
	}
	var got []map[string]interface{}
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatalf("Unmarshal result error = %v", err)
	}
	if got[0]["name"] != "Acme Chat" || got[1]["name"] != "Acme Reasoning" {
		t.Fatalf("display names = %#v, want preserved per model", got)
	}

	mykey, err := os.ReadFile(filepath.Join(root, "mykey.py"))
	if err != nil {
		t.Fatalf("read mykey.py: %v", err)
	}
	// New contract: the "name" field is both display name and routing key.
	// Verify that the exported mykey.py uses display names consistently.
	for _, expected := range []string{`"name": "Acme Chat"`, `"name": "Acme Reasoning"`} {
		if !strings.Contains(string(mykey), expected) {
			t.Fatalf("missing display name in mykey.py: %q\n%s", expected, mykey)
		}
	}
}

func TestExportImportPreservesProviderDisplayName(t *testing.T) {
	root := t.TempDir()
	wantDisplayName := "中文供应商"
	profiles := []Profile{{
		VarName:     "native_oai_config_cn",
		DisplayName: wantDisplayName,
		Type:        "native_oai",
		APIBase:     "https://api.example.com/v1",
		APIKey:      "sk-test-only",
		ModelConfigs: []ModelConfig{{
			Model: "example-chat",
		}},
	}}
	if _, err := Export(root, profiles, true); err != nil {
		t.Fatalf("Export() error = %v", err)
	}

	draft, err := ImportMyKeyWithPython(root, "", true)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython() error = %v", err)
	}
	if len(draft.Profiles) != 1 {
		t.Fatalf("profiles len = %d, want 1", len(draft.Profiles))
	}
	got := draft.Profiles[0]
	if got.DisplayName != wantDisplayName {
		t.Fatalf("DisplayName = %q, want %q", got.DisplayName, wantDisplayName)
	}
	if got.VarName != "native_oai_config_cn" {
		t.Fatalf("VarName = %q, want stable ASCII identifier", got.VarName)
	}

	mykey, err := os.ReadFile(filepath.Join(root, "mykey.py"))
	if err != nil {
		t.Fatalf("read mykey.py: %v", err)
	}
	if !strings.Contains(string(mykey), `"display_name":"`+wantDisplayName+`"`) {
		t.Fatalf("provider display name missing from metadata:\n%s", mykey)
	}
}

func TestOfficialParametersRoundTrip(t *testing.T) {
	root := t.TempDir()
	var input Draft
	if err := json.Unmarshal([]byte(`{"profiles":[{"var_name":"native_claude_config_test","type":"native_claude","apibase":"https://example.test/v1","model_configs":[{"model":"test","connect_timeout":17,"thinking_type":"enabled","reasoning_effort":"max","extra":{"temperature":0,"max_tokens":8192,"thinking_budget_tokens":2048,"api_key_header":"bearer","omit_thinking":false,"max_retry_after":0}}]}]}`), &input); err != nil {
		t.Fatal(err)
	}
	for pass := 0; pass < 2; pass++ {
		rendered, err := Render(input.Profiles)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(rendered, `"timeout": 17`) || strings.Contains(rendered, `"connect_timeout"`) {
			t.Fatalf("incorrect official timeout key: %s", rendered)
		}
		if _, err := Export(root, input.Profiles, true); err != nil {
			t.Fatal(err)
		}
		input, err = ImportMyKeyWithPython(root, "", true)
		if err != nil {
			t.Fatal(err)
		}
		config := input.Profiles[0].ModelConfigs[0]
		if config.ConnectTimeout == nil || *config.ConnectTimeout != 17 || config.ReasoningEffort != "max" {
			t.Fatalf("lost official parameters: %+v", config)
		}
		for key, want := range map[string]interface{}{"temperature": float64(0), "max_tokens": float64(8192), "thinking_budget_tokens": float64(2048), "api_key_header": "bearer", "omit_thinking": false, "max_retry_after": float64(0)} {
			if config.Extra[key] != want {
				t.Fatalf("pass %d: %s = %#v, want %#v", pass, key, config.Extra[key], want)
			}
		}
	}
}

func TestExportImportPreservesPerModelAdvancedConfig(t *testing.T) {
	root := t.TempDir()
	data := []byte(`{"profiles":[{"var_name":"native_oai_config_acme","type":"native_oai","name":"Acme","apibase":"https://api.acme.example/v1","apikey":"sk-real-secret","model_configs":[{"model":"acme-chat","reasoning_effort":"low","service_tier":"default","read_timeout":120},{"model":"acme-reasoning","reasoning_effort":"high","service_tier":"priority","read_timeout":600}]}]}`)
	var input Draft
	if err := json.Unmarshal(data, &input); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if _, err := Export(root, input.Profiles, true); err != nil {
		t.Fatalf("Export() error = %v", err)
	}

	draft, err := ImportMyKeyWithPython(root, "", true)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython() error = %v", err)
	}
	if len(draft.Profiles) != 1 {
		t.Fatalf("profiles len = %d, want one provider: %#v", len(draft.Profiles), draft.Profiles)
	}
	encoded, err := json.Marshal(draft.Profiles[0])
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	var got struct {
		ModelConfigs []struct {
			Model           string `json:"model"`
			ReasoningEffort string `json:"reasoning_effort"`
			ServiceTier     string `json:"service_tier"`
			ReadTimeout     *int   `json:"read_timeout"`
		} `json:"model_configs"`
	}
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatalf("Unmarshal result error = %v", err)
	}
	if len(got.ModelConfigs) != 2 {
		t.Fatalf("model_configs = %#v, want two entries", got.ModelConfigs)
	}
	if got.ModelConfigs[0].Model != "acme-chat" || got.ModelConfigs[0].ReasoningEffort != "low" || got.ModelConfigs[0].ServiceTier != "default" || got.ModelConfigs[0].ReadTimeout == nil || *got.ModelConfigs[0].ReadTimeout != 120 {
		t.Fatalf("first model config = %#v", got.ModelConfigs[0])
	}
	if got.ModelConfigs[1].Model != "acme-reasoning" || got.ModelConfigs[1].ReasoningEffort != "high" || got.ModelConfigs[1].ServiceTier != "priority" || got.ModelConfigs[1].ReadTimeout == nil || *got.ModelConfigs[1].ReadTimeout != 600 {
		t.Fatalf("second model config = %#v", got.ModelConfigs[1])
	}
}

func TestRenderUsesGlobalModelSortOrderAcrossProviders(t *testing.T) {
	data := []byte(`{"profiles":[{"var_name":"native_oai_config_a","type":"native_oai","name":"Provider A","apibase":"https://a.example/v1","apikey":"sk-a-secret","model_configs":[{"model":"a-one","sort_order":0},{"model":"a-two","sort_order":2}]},{"var_name":"native_claude_config_b","type":"native_claude","name":"Provider B","apibase":"https://b.example/v1","apikey":"sk-b-secret","model_configs":[{"model":"b-one","sort_order":1}]}]}`)
	var input Draft
	if err := json.Unmarshal(data, &input); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}

	rendered, err := Render(input.Profiles)
	if err != nil {
		t.Fatalf("Render() error = %v", err)
	}
	first := strings.Index(rendered, "\nnative_oai_config_a =")
	second := strings.Index(rendered, "\nnative_claude_config_b =")
	third := strings.Index(rendered, "\nnative_oai_config_a_2 =")
	if first < 0 || second < 0 || third < 0 || !(first < second && second < third) {
		t.Fatalf("render order does not follow sort_order (want A1, B1, A2):\n%s", rendered)
	}
	if strings.Contains(rendered, `"sort_order"`) {
		t.Fatalf("sort_order is admin metadata and must not enter model dictionaries:\n%s", rendered)
	}
	for _, modelID := range []string{"a-one", "b-one", "a-two"} {
		want := fmt.Sprintf(`"name": %q`, modelID)
		if !strings.Contains(rendered, want) {
			t.Fatalf("rendered model %q does not use its model ID as name:\n%s", modelID, rendered)
		}
	}
	if strings.Count(rendered, "Provider A") != 1 || strings.Count(rendered, "Provider B") != 1 {
		t.Fatalf("provider names must remain only in provider grouping metadata:\n%s", rendered)
	}
}

func TestImportMyKeyPreservesGlobalModelDeclarationOrderAcrossGroupedProviders(t *testing.T) {
	root := t.TempDir()
	mykey := `native_oai_config_a = {
    "apikey": "sk-a-secret",
    "apibase": "https://a.example/v1",
    "model": "a-one",
}

native_claude_config_b = {
    "apikey": "sk-b-secret",
    "apibase": "https://b.example/v1",
    "model": "b-one",
}

native_oai_config_a_2 = {
    "apikey": "sk-a-secret",
    "apibase": "https://a.example/v1",
    "model": "a-two",
}
`
	if err := os.WriteFile(filepath.Join(root, "mykey.py"), []byte(mykey), 0600); err != nil {
		t.Fatalf("write mykey.py: %v", err)
	}

	draft, err := ImportMyKeyWithPython(root, "", true)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython() error = %v", err)
	}
	encoded, err := json.Marshal(draft.Profiles)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	var profiles []struct {
		VarName      string `json:"var_name"`
		ModelConfigs []struct {
			Model     string `json:"model"`
			SortOrder *int   `json:"sort_order"`
		} `json:"model_configs"`
	}
	if err := json.Unmarshal(encoded, &profiles); err != nil {
		t.Fatalf("Unmarshal result error = %v", err)
	}
	orders := map[string]int{}
	for _, profile := range profiles {
		for _, config := range profile.ModelConfigs {
			if config.SortOrder == nil {
				t.Fatalf("model %q has no imported sort_order: %s", config.Model, encoded)
			}
			orders[config.Model] = *config.SortOrder
		}
	}
	if orders["a-one"] != 0 || orders["b-one"] != 1 || orders["a-two"] != 2 {
		t.Fatalf("imported declaration orders = %#v, want a-one=0 b-one=1 a-two=2", orders)
	}
}

func TestImportLegacyMyKeyDoesNotGroupWithoutDisplayName(t *testing.T) {
	root := t.TempDir()
	mykey := `native_oai_config_gpt55 = {
    "apikey": "sk-shared-real-secret",
    "apibase": "https://code.example/v1/",
    "model": "gpt-5.5",
    "service_tier": "priority",
}

native_oai_config_gpt55_2 = {
    "apikey": "sk-shared-real-secret",
    "apibase": "https://code.example/v1",
    "model": "gpt-5.4",
}
`
	if err := os.WriteFile(filepath.Join(root, "mykey.py"), []byte(mykey), 0600); err != nil {
		t.Fatalf("write legacy mykey.py: %v", err)
	}

	draft, err := ImportMyKeyWithPython(root, "", false)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython() error = %v", err)
	}
	if len(draft.Profiles) != 2 {
		t.Fatalf("profiles len = %d, want providers without display_name kept separate: %#v", len(draft.Profiles), draft.Profiles)
	}
	if draft.Profiles[0].VarName != "native_oai_config_gpt55" || draft.Profiles[1].VarName != "native_oai_config_gpt55_2" {
		t.Fatalf("provider order changed: %#v", draft.Profiles)
	}
	if len(draft.Profiles[0].ModelConfigs) != 1 || draft.Profiles[0].ModelConfigs[0].Model != "gpt-5.5" || draft.Profiles[0].ModelConfigs[0].ServiceTier != "priority" {
		t.Fatalf("first provider config changed: %#v", draft.Profiles[0].ModelConfigs)
	}
	if len(draft.Profiles[1].ModelConfigs) != 1 || draft.Profiles[1].ModelConfigs[0].Model != "gpt-5.4" {
		t.Fatalf("second provider config changed: %#v", draft.Profiles[1].ModelConfigs)
	}
	if draft.Profiles[0].APIKey != "sk-****cret" || draft.Profiles[1].APIKey != "sk-****cret" {
		t.Fatalf("masked provider keys = %q, %q", draft.Profiles[0].APIKey, draft.Profiles[1].APIKey)
	}
}

func TestImportGroupsProfilesOnlyByDisplayName(t *testing.T) {
	root := t.TempDir()
	profiles := []Profile{
		{
			VarName:     "native_oai_config_shared_one",
			DisplayName: "Shared Provider",
			Type:        "native_oai",
			APIBase:     "https://api.example/v1",
			Model:       "model-one",
			APIKey:      "sk-shared-secret",
		},
		{
			VarName:     "native_oai_config_shared_two",
			DisplayName: "Shared Provider",
			Type:        "native_oai",
			APIBase:     "https://api.example/v1",
			Model:       "model-two",
			APIKey:      "sk-shared-secret",
		},
		{
			VarName:     "native_oai_config_distinct",
			DisplayName: "Distinct Provider",
			Type:        "native_oai",
			APIBase:     "https://api.example/v1",
			Model:       "model-three",
			APIKey:      "sk-shared-secret",
		},
	}
	if _, err := Export(root, profiles, true); err != nil {
		t.Fatalf("Export() error = %v", err)
	}

	draft, err := ImportMyKeyWithPython(root, "", false)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython() error = %v", err)
	}
	if len(draft.Profiles) != 2 {
		t.Fatalf("profiles len = %d, want same display_name grouped and different display_name separate: %#v", len(draft.Profiles), draft.Profiles)
	}
	grouped := draft.Profiles[0]
	if grouped.DisplayName != "Shared Provider" || grouped.VarName != "native_oai_config_shared_one" {
		t.Fatalf("grouped provider = %#v", grouped)
	}
	if len(grouped.Models) != 2 || grouped.Models[0] != "model-one" || grouped.Models[1] != "model-two" {
		t.Fatalf("grouped models = %#v, want display_name peers", grouped.Models)
	}
	distinct := draft.Profiles[1]
	if distinct.DisplayName != "Distinct Provider" || len(distinct.Models) != 1 || distinct.Models[0] != "model-three" {
		t.Fatalf("distinct provider changed or merged by credentials: %#v", distinct)
	}
}

func TestImportLegacyMyKeyDoesNotGroupDifferentKeysWithSameMask(t *testing.T) {
	root := t.TempDir()
	mykey := `native_oai_config_one = {
    "apikey": "sk-a-first-secret-tail",
    "apibase": "https://code.example/v1",
    "model": "gpt-one",
}

native_oai_config_two = {
    "apikey": "sk-a-other-secret-tail",
    "apibase": "https://code.example/v1",
    "model": "gpt-two",
}
`
	if err := os.WriteFile(filepath.Join(root, "mykey.py"), []byte(mykey), 0600); err != nil {
		t.Fatalf("write legacy mykey.py: %v", err)
	}

	draft, err := ImportMyKeyWithPython(root, "", false)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython() error = %v", err)
	}
	if len(draft.Profiles) != 2 {
		t.Fatalf("profiles len = %d, want different-key providers kept separate: %#v", len(draft.Profiles), draft.Profiles)
	}
	if draft.Profiles[0].APIKey != draft.Profiles[1].APIKey {
		t.Fatalf("test fixture masks differ: %q vs %q", draft.Profiles[0].APIKey, draft.Profiles[1].APIKey)
	}
}

func TestExportBacksUpExistingActive(t *testing.T) {
	root := t.TempDir()
	active := filepath.Join(root, "mykey.py")
	old := []byte("old active")
	if err := os.WriteFile(active, old, 0600); err != nil {
		t.Fatalf("seed active: %v", err)
	}
	profiles := []Profile{{
		VarName: "api_config_main",
		Type:    "openai",
		Name:    "main",
		APIBase: "https://api.example/v1",
		Model:   "gpt-test",
		APIKey:  "sk-real-secret",
	}}
	res, err := Export(root, profiles, true)
	if err != nil {
		t.Fatalf("Export() error = %v", err)
	}
	bak, ok := res["backup_path"].(string)
	if !ok || bak == "" {
		t.Fatalf("backup_path = %#v, want path", res["backup_path"])
	}
	data, err := os.ReadFile(bak)
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if string(data) != string(old) {
		t.Fatalf("backup content = %q, want %q", string(data), string(old))
	}
	activeData, err := os.ReadFile(active)
	if err != nil {
		t.Fatalf("read active: %v", err)
	}
	if string(activeData) == string(old) || !strings.Contains(string(activeData), "sk-real-secret") {
		t.Fatalf("active not replaced with rendered key: %q", string(activeData))
	}
}

func TestExportRejectsUnsafeGARoot(t *testing.T) {
	profiles := []Profile{{
		VarName: "api_config_main",
		Type:    "openai",
		Name:    "main",
		APIBase: "https://api.example/v1",
		Model:   "gpt-test",
		APIKey:  "sk-real-secret",
	}}
	for _, root := range []string{"", ".", filepath.VolumeName(t.TempDir()) + string(filepath.Separator)} {
		_, err := Export(root, profiles, false)
		if err == nil || !strings.Contains(err.Error(), "filesystem root") {
			t.Fatalf("Export(%q) error = %v, want filesystem root rejection", root, err)
		}
	}
}

func TestImportMyKeyExecutesCurrentFileAndUsesFinalRuntimeValues(t *testing.T) {
	root := t.TempDir()
	mykey := filepath.Join(root, "mykey.py")
	text := "native_oai_config1 = {\n" +
		"    'name': 'old-literal',\n" +
		"    'apibase': 'https://old.example/v1',\n" +
		"    'model': 'old-model',\n" +
		"    'apikey': 'sk-old-secret',\n" +
		"}\n" +
		"native_oai_config1.update({\n" +
		"    'name': 'current-runtime',\n" +
		"    'apibase': 'https://current.example/v1',\n" +
		"    'model': 'current-model',\n" +
		"    'apikey': 'sk-current-secret',\n" +
		"})\n"
	if err := os.WriteFile(mykey, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}

	draft, err := ImportMyKeyWithPython(root, "", false)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython() error = %v", err)
	}
	if len(draft.Profiles) != 1 {
		t.Fatalf("profiles len = %d, want 1: %#v", len(draft.Profiles), draft.Profiles)
	}
	p := draft.Profiles[0]
	if p.Name != "current-runtime" || p.APIBase != "https://current.example/v1" || p.Model != "current-model" {
		t.Fatalf("profile = %#v, want current runtime values", p)
	}
	if p.APIKey != "sk-****cret" {
		t.Fatalf("masked APIKey = %q", p.APIKey)
	}

	raw, err := ImportMyKeyWithPython(root, "", true)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython(reveal) error = %v", err)
	}
	if raw.Profiles[0].APIKey != "sk-current-secret" {
		t.Fatalf("raw APIKey = %q", raw.Profiles[0].APIKey)
	}
}

func TestRenderRejectsUnmarshalableExtraValue(t *testing.T) {
	profiles := []Profile{{
		VarName: "api_config_main",
		Type:    "openai",
		Name:    "main",
		APIBase: "https://api.example/v1",
		Model:   "gpt-test",
		APIKey:  "sk-real-secret",
		Extra: map[string]interface{}{
			"bad": func() {},
		},
	}}
	_, err := Render(profiles)
	if err == nil || !strings.Contains(err.Error(), "render \"bad\"") {
		t.Fatalf("Render() error = %v, want render bad", err)
	}
}

func TestPythonExePrefersConfiguredPath(t *testing.T) {
	configured := filepath.Join(t.TempDir(), "custom-python")
	if got := pythonExe(t.TempDir(), configured); got != configured {
		t.Fatalf("pythonExe configured = %q, want %q", got, configured)
	}
}

func TestPythonExeFindsPosixVirtualEnvBeforeFallback(t *testing.T) {
	root := t.TempDir()
	posixPython := filepath.Join(root, ".venv", "bin", "python")
	if err := os.MkdirAll(filepath.Dir(posixPython), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(posixPython, []byte(""), 0755); err != nil {
		t.Fatal(err)
	}
	if got := pythonExe(root, ""); got != posixPython {
		t.Fatalf("pythonExe posix venv = %q, want %q", got, posixPython)
	}
}

// A root with no virtualenv falls through to host discovery. The env is
// emptied so the result cannot depend on whether this machine happens to have
// uv or a PATH python installed; the ordering itself is covered by the pyfind
// package tests.
func TestPythonExeFallbackPrefersPython3OffWindows(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	t.Setenv("APPDATA", t.TempDir())
	t.Setenv("LOCALAPPDATA", t.TempDir())
	got := pythonExe(t.TempDir(), "")
	want := "python3"
	if runtime.GOOS == "windows" {
		want = "python"
	}
	if got != want {
		t.Fatalf("pythonExe fallback = %q, want %q", got, want)
	}
}

func TestStoreSavePreservesExistingSecretWhenSubmittedMasked(t *testing.T) {
	root := t.TempDir()
	store := NewStore(root)
	profiles := []Profile{{
		VarName: "api_config_main",
		Type:    "openai",
		Name:    "main",
		APIBase: "https://api.example/v1",
		Model:   "gpt-test",
		APIKey:  "sk-real-secret",
	}}
	if _, err := store.Save(profiles); err != nil {
		t.Fatalf("seed Save() error = %v", err)
	}
	profiles[0].APIKey = "sk-****cret"
	profiles[0].Model = "gpt-updated"
	if _, err := store.Save(profiles); err != nil {
		t.Fatalf("Save(masked secret) error = %v", err)
	}
	raw, err := store.Load(true)
	if err != nil {
		t.Fatalf("Load(true) error = %v", err)
	}
	if got := raw.Profiles[0].APIKey; got != "sk-real-secret" {
		t.Fatalf("preserved APIKey = %q, want old secret", got)
	}
	if got := raw.Profiles[0].Model; got != "gpt-updated" {
		t.Fatalf("updated model = %q", got)
	}
}

func TestRenderPreviewAllowsMaskedSecretWithoutUnmasking(t *testing.T) {
	profiles := []Profile{{
		VarName: "api_config_main",
		Type:    "openai",
		Name:    "main",
		APIBase: "https://api.example/v1",
		Model:   "gpt-test",
		APIKey:  "sk-****cret",
	}}
	rendered, err := RenderPreview(profiles)
	if err != nil {
		t.Fatalf("RenderPreview() error = %v", err)
	}
	if !strings.Contains(rendered, `"apikey": "sk-****cret"`) {
		t.Fatalf("preview did not keep masked placeholder:\n%s", rendered)
	}
	if strings.Contains(rendered, "sk-real-secret") {
		t.Fatalf("preview leaked real secret: %s", rendered)
	}
	renderedFull, err := Render(profiles)
	if err != nil {
		t.Fatalf("Render() error = %v", err)
	}
	if !strings.Contains(renderedFull, `"apikey": "sk-****cret"`) {
		t.Fatalf("render did not keep masked placeholder:\n%s", renderedFull)
	}
}

func TestImportOfficialFailoverMixin(t *testing.T) {
	root := t.TempDir()
	source := `native_oai_config_primary = {
    "apikey": "sk-primary", "apibase": "https://primary.example/v1",
    "model": "gpt-main", "name": "primary-session",
}
native_claude_config_backup = {
    "apikey": "sk-backup", "apibase": "https://backup.example/v1",
    "model": "claude-main", "name": "backup-session",
}
mixin_config = {
    "llm_nos": ["primary-session", "backup-session"],
    "max_retries": 7, "base_delay": 0.25, "spring_back": 90,
}
`
	if err := os.WriteFile(filepath.Join(root, "mykey.py"), []byte(source), 0600); err != nil {
		t.Fatalf("write mykey.py: %v", err)
	}
	draft, err := ImportMyKeyWithPython(root, "", true)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython() error = %v", err)
	}
	got := map[string]ModelConfig{}
	for _, profile := range draft.Profiles {
		for _, config := range profileModelConfigs(profile) {
			got[config.Model] = config
		}
	}
	for model, wantOrder := range map[string]int{"gpt-main": 0, "claude-main": 1} {
		config, ok := got[model]
		if !ok || config.FailoverOrder == nil || *config.FailoverOrder != wantOrder {
			t.Fatalf("imported %q failover order = %#v, want %d", model, config.FailoverOrder, wantOrder)
		}
		if config.FailoverMaxRetries == nil || *config.FailoverMaxRetries != 7 || config.FailoverBaseDelay == nil || *config.FailoverBaseDelay != 0.25 || config.FailoverSpringBack == nil || *config.FailoverSpringBack != 90 {
			t.Fatalf("imported %q failover settings = %#v", model, config)
		}
	}
}

func TestExportReplacesUnmanagedOfficialMixin(t *testing.T) {
	root := t.TempDir()
	old := []byte("custom_setting = 'keep'\n\nmixin_config = {'llm_nos': ['stale-a', 'stale-b']}\n")
	if err := os.WriteFile(filepath.Join(root, "mykey.py"), old, 0600); err != nil {
		t.Fatalf("write mykey.py: %v", err)
	}
	zero, one := 0, 1
	profiles := []Profile{
		{VarName: "native_oai_config_primary", Type: "native_oai", APIBase: "https://a.example/v1", APIKey: "sk-a", Model: "a", ModelConfigs: []ModelConfig{{Model: "a", FailoverOrder: &zero}}},
		{VarName: "native_oai_config_backup", Type: "native_oai", APIBase: "https://b.example/v1", APIKey: "sk-b", Model: "b", ModelConfigs: []ModelConfig{{Model: "b", FailoverOrder: &one}}},
	}
	if _, err := Export(root, profiles, true); err != nil {
		t.Fatalf("Export() error = %v", err)
	}
	data, err := os.ReadFile(filepath.Join(root, "mykey.py"))
	if err != nil {
		t.Fatalf("read exported mykey.py: %v", err)
	}
	text := string(data)
	if strings.Contains(text, "mixin_config =") || strings.Count(text, "mixin_config_1 =") != 1 || strings.Contains(text, "stale-a") || !strings.Contains(text, "custom_setting = 'keep'") {
		t.Fatalf("unexpected exported mykey.py:\n%s", text)
	}
}

func TestRenderOfficialFailoverMixin(t *testing.T) {
	zero, one := 0, 1
	retries, springBack := 10, 120
	delay := 0.5
	profiles := []Profile{
		{
			VarName: "native_oai_config_primary", Type: "native_oai", Name: "shared",
			APIBase: "https://primary.example/v1", APIKey: "sk-primary", Model: "gpt-main",
			ModelConfigs: []ModelConfig{{Model: "gpt-main", FailoverOrder: &zero, FailoverMaxRetries: &retries, FailoverBaseDelay: &delay, FailoverSpringBack: &springBack}},
		},
		{
			VarName: "native_claude_config_backup", Type: "native_claude", Name: "shared",
			APIBase: "https://backup.example/v1", APIKey: "sk-backup", Model: "claude-main",
			ModelConfigs: []ModelConfig{{Model: "claude-main", FailoverOrder: &one, FailoverMaxRetries: &retries, FailoverBaseDelay: &delay, FailoverSpringBack: &springBack}},
		},
	}
	rendered, err := Render(profiles)
	if err != nil {
		t.Fatalf("Render() error = %v", err)
	}
	for _, want := range []string{
		`"name": "gpt-main"`,
		`"name": "claude-main"`,
		`mixin_config_1 = {"base_delay": 0.5, "llm_nos": ["gpt-main", "claude-main"], "max_retries": 10, "spring_back": 120}`,
	} {
		if !strings.Contains(rendered, want) {
			t.Fatalf("rendered output missing %q:\n%s", want, rendered)
		}
	}
}

func TestRenderExplicitFailoverGroupPreservesModelNames(t *testing.T) {
	profiles := []Profile{
		{
			VarName: "native_oai_config_primary", Type: "native_oai",
			APIBase: "https://primary.example/v1", APIKey: "sk-primary", Model: "gpt-main",
			ModelConfigs: []ModelConfig{{Model: "gpt-main"}},
		},
		{
			VarName: "native_oai_config_backup", Type: "native_oai",
			APIBase: "https://backup.example/v1", APIKey: "sk-backup", Model: "gpt-backup",
			ModelConfigs: []ModelConfig{{Model: "gpt-backup"}},
		},
	}
	groups := []FailoverGroup{{
		VarName: "mixin_config_1",
		Members: []FailoverMember{
			{ProviderVarName: "native_oai_config_primary", Model: "gpt-main"},
			{ProviderVarName: "native_oai_config_backup", Model: "gpt-backup"},
		},
		MaxRetries: 10,
		BaseDelay:  0.5,
	}}
	rendered, err := RenderWithFailoverGroups(profiles, groups)
	if err != nil {
		t.Fatalf("RenderWithFailoverGroups() error = %v", err)
	}
	for _, want := range []string{
		`"name": "gpt-main"`,
		`"name": "gpt-backup"`,
		`"llm_nos": ["gpt-main", "gpt-backup"]`,
	} {
		if !strings.Contains(rendered, want) {
			t.Fatalf("rendered output missing %q:\n%s", want, rendered)
		}
	}
}

func TestRenderExplicitFailoverGroupKeepsRoutingNamesUnique(t *testing.T) {
	profiles := []Profile{
		{
			VarName: "native_oai_config_primary", Type: "native_oai",
			APIBase: "https://primary.example/v1", APIKey: "sk-primary", Model: "gpt-main",
			ModelConfigs: []ModelConfig{{Model: "gpt-main", Name: "shared-route"}},
		},
		{
			VarName: "native_oai_config_backup", Type: "native_oai",
			APIBase: "https://backup.example/v1", APIKey: "sk-backup", Model: "gpt-backup",
			ModelConfigs: []ModelConfig{{Model: "gpt-backup", Name: "shared-route"}},
		},
	}
	groups := []FailoverGroup{{
		VarName: "mixin_config_1",
		Members: []FailoverMember{
			{ProviderVarName: "native_oai_config_primary", Model: "gpt-main"},
			{ProviderVarName: "native_oai_config_backup", Model: "gpt-backup"},
		},
	}}
	rendered, err := RenderWithFailoverGroups(profiles, groups)
	if err != nil {
		t.Fatalf("RenderWithFailoverGroups() error = %v", err)
	}
	for _, want := range []string{
		`"name": "shared-route"`,
		`"name": "native_oai_config_backup"`,
		`"llm_nos": ["shared-route", "native_oai_config_backup"]`,
	} {
		if !strings.Contains(rendered, want) {
			t.Fatalf("rendered output missing %q:\n%s", want, rendered)
		}
	}
}

func TestDuplicateModelInstancesRoundTripWithFailoverMembers(t *testing.T) {
	profiles := []Profile{{
		VarName: "native_oai_config_shared", Type: "native_oai", Name: "shared",
		APIBase: "https://shared.example/v1", APIKey: "sk-shared", Model: "gpt-same",
		ModelConfigs: []ModelConfig{
			{InstanceID: "instance-primary", Model: "gpt-same", Name: "same-primary"},
			{InstanceID: "instance-backup", Model: "gpt-same", Name: "same-backup"},
		},
	}}
	groups := []FailoverGroup{{
		VarName: "mixin_config_same",
		Members: []FailoverMember{
			{InstanceID: "instance-primary", ProviderVarName: "native_oai_config_shared", Model: "gpt-same"},
			{InstanceID: "instance-backup", ProviderVarName: "native_oai_config_shared", Model: "gpt-same"},
		},
	}}
	rendered, err := RenderWithFailoverGroups(profiles, groups)
	if err != nil {
		t.Fatalf("RenderWithFailoverGroups() error = %v", err)
	}
	for _, want := range []string{
		`_ga_admin_model_instances = {"native_oai_config_shared": "instance-primary", "native_oai_config_shared_2": "instance-backup"}`,
		`"llm_nos": ["same-primary", "same-backup"]`,
	} {
		if !strings.Contains(rendered, want) {
			t.Fatalf("rendered output missing %q:\n%s", want, rendered)
		}
	}

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "mykey.py"), []byte(rendered), 0600); err != nil {
		t.Fatalf("write rendered mykey.py: %v", err)
	}
	draft, err := ImportMyKeyWithPython(root, "", true)
	if err != nil {
		t.Fatalf("ImportMyKeyWithPython() error = %v", err)
	}
	if len(draft.Profiles) != 1 || len(draft.Profiles[0].ModelConfigs) != 2 {
		t.Fatalf("round-trip profiles = %#v", draft.Profiles)
	}
	configs := draft.Profiles[0].ModelConfigs
	if configs[0].Model != "gpt-same" || configs[1].Model != "gpt-same" || configs[0].InstanceID != "instance-primary" || configs[1].InstanceID != "instance-backup" {
		t.Fatalf("round-trip configs = %#v", configs)
	}
	if len(draft.FailoverGroups) != 1 || len(draft.FailoverGroups[0].Members) != 2 {
		t.Fatalf("round-trip failover groups = %#v", draft.FailoverGroups)
	}
	members := draft.FailoverGroups[0].Members
	if members[0].InstanceID != "instance-primary" || members[1].InstanceID != "instance-backup" {
		t.Fatalf("round-trip members = %#v", members)
	}
}

func TestResolveFailoverGroupsRequiresFixedVariablePrefix(t *testing.T) {
	profiles := []Profile{
		{VarName: "native_oai_config_a", Type: "native_oai", Model: "a", ModelConfigs: []ModelConfig{{Model: "a"}}},
		{VarName: "native_oai_config_b", Type: "native_oai", Model: "b", ModelConfigs: []ModelConfig{{Model: "b"}}},
	}
	valid := FailoverGroup{
		VarName: "mixin_config_primary_2",
		Members: []FailoverMember{
			{ProviderVarName: "native_oai_config_a", Model: "a"},
			{ProviderVarName: "native_oai_config_b", Model: "b"},
		},
	}
	if _, err := resolveFailoverGroups(profiles, []FailoverGroup{valid}); err != nil {
		t.Fatalf("resolveFailoverGroups() rejected valid fixed-prefix name: %v", err)
	}
	for _, name := range []string{
		"mixin_config",
		"mixin_config_",
		"routing_mixin",
		"prefix_mixin_config_route",
		"mixin_config_bad-name",
	} {
		t.Run(name, func(t *testing.T) {
			invalid := valid
			invalid.VarName = name
			if _, err := resolveFailoverGroups(profiles, []FailoverGroup{invalid}); err == nil || !strings.Contains(err.Error(), "must match mixin_config_[A-Za-z0-9_]+") {
				t.Fatalf("resolveFailoverGroups() error = %v, want fixed-prefix validation error", err)
			}
		})
	}
}

func TestValidateRejectsMixedFailoverFamilies(t *testing.T) {
	zero, one := 0, 1
	profiles := []Profile{
		{VarName: "native_oai_config_primary", Type: "native_oai", APIBase: "https://a.example/v1", APIKey: "sk-a", Model: "a", ModelConfigs: []ModelConfig{{Model: "a", FailoverOrder: &zero}}},
		{VarName: "api_config_backup", Type: "openai", APIBase: "https://b.example/v1", APIKey: "sk-b", Model: "b", ModelConfigs: []ModelConfig{{Model: "b", FailoverOrder: &one}}},
	}
	if err := Validate(profiles); err == nil || !strings.Contains(strings.ToLower(err.Error()), "native") {
		t.Fatalf("Validate() error = %v, want Native/Legacy family error", err)
	}
}

func TestValidateRejectsSingleAndGappedFailover(t *testing.T) {
	zero, two := 0, 2
	base := Profile{VarName: "native_oai_config_a", Type: "native_oai", APIBase: "https://a.example/v1", APIKey: "sk-a", Model: "a", ModelConfigs: []ModelConfig{{Model: "a", FailoverOrder: &zero}}}
	if err := Validate([]Profile{base}); err == nil {
		t.Fatal("Validate() accepted a one-member failover group")
	}
	other := Profile{VarName: "native_oai_config_b", Type: "native_oai", APIBase: "https://b.example/v1", APIKey: "sk-b", Model: "b", ModelConfigs: []ModelConfig{{Model: "b", FailoverOrder: &two}}}
	if err := Validate([]Profile{base, other}); err == nil {
		t.Fatal("Validate() accepted non-consecutive failover_order values")
	}
}
