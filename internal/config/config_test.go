package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestStoreSaveCreatesRootAndWritesLoadableConfig(t *testing.T) {
	root := filepath.Join(t.TempDir(), "missing", "config-root")
	store := NewStore(root)
	cfg := Default()
	cfg.Host = "127.0.0.1"
	cfg.Port = 18787
	cfg.LogTailLines = 321

	if err := store.Save(cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	path := filepath.Join(root, "config.local.json")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("saved config missing: %v", err)
	}
	if info.IsDir() {
		t.Fatalf("saved config is directory")
	}
	if got := info.Mode().Perm(); got&0222 == 0 {
		t.Fatalf("mode=%#o is not writable", got)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	var got AppConfig
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("saved config is not valid JSON: %v\n%s", err, data)
	}
	if got.Port != cfg.Port || got.LogTailLines != cfg.LogTailLines {
		t.Fatalf("unexpected saved config: %#v", got)
	}

	reloaded := NewStore(root)
	if reloaded.Snapshot().Port != cfg.Port || reloaded.Snapshot().LogTailLines != cfg.LogTailLines {
		t.Fatalf("unexpected reloaded config: %#v", reloaded.Snapshot())
	}
}

func TestStoreSaveCleansTempFileOnValidationError(t *testing.T) {
	root := t.TempDir()
	store := NewStore(root)
	cfg := Default()
	cfg.Port = -1

	if err := store.Save(cfg); err == nil {
		t.Fatalf("Save() expected validation error")
	}
	matches, err := filepath.Glob(filepath.Join(root, ".config.local.json-*.tmp"))
	if err != nil {
		t.Fatalf("Glob() error = %v", err)
	}
	if len(matches) != 0 {
		t.Fatalf("unexpected temp files after validation failure: %v", matches)
	}
}

func TestStorePersistsIndependentChatTitleModel(t *testing.T) {
	root := t.TempDir()
	store := NewStore(root)
	cfg := Default()
	cfg.ChatTitleModel = &ChatTitleModelRef{
		ProviderVarName: "native_oai_config2",
		Model:           "gpt-title",
		LLMNo:           4,
	}
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}
	reloaded := NewStore(root)
	if reloaded.Snapshot().ChatTitleModel == nil || *reloaded.Snapshot().ChatTitleModel != *cfg.ChatTitleModel {
		t.Fatalf("chat title model was not persisted: %#v", reloaded.Snapshot().ChatTitleModel)
	}

	cfg.ChatTitleModel = &ChatTitleModelRef{ProviderVarName: "native_oai_config2", Model: "gpt-title", LLMNo: -1}
	if err := store.Save(cfg); err == nil || !strings.Contains(err.Error(), "llm_no") {
		t.Fatalf("Save() err=%v, want invalid llm_no", err)
	}
}

func TestStoreLoadRejectsInvalidPersistedConfig(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "config.local.json"), []byte(`{"port":-1}`), 0644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	store := &Store{Root: root, cfg: Default()}
	before := store.Snapshot()

	err := store.Load()
	if err == nil || !strings.Contains(err.Error(), "port must be between") {
		t.Fatalf("Load() err = %v, want port validation error", err)
	}
	if !reflect.DeepEqual(store.Snapshot(), before) {
		t.Fatalf("Load() mutated cfg on validation error: got %#v want %#v", store.Snapshot(), before)
	}
}

func TestStoreLoadRejectsInvalidRuntimeBounds(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "config.local.json"), []byte(`{"log_tail_lines":-1,"buffer_lines":-1}`), 0644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	store := &Store{Root: root, cfg: Default()}

	err := store.Load()
	if err == nil || !strings.Contains(err.Error(), "log_tail_lines must be positive") {
		t.Fatalf("Load() err = %v, want log tail validation error", err)
	}
	if store.Snapshot().LogTailLines != Default().LogTailLines || store.Snapshot().BufferLines != Default().BufferLines {
		t.Fatalf("Load() applied invalid runtime bounds: %#v", store.Snapshot())
	}
}

func TestBootstrapConfigDefaultsAndEffectivePythonPersistence(t *testing.T) {
	root := t.TempDir()
	store := NewStore(root)
	if store.Snapshot().GARoot != "" {
		t.Fatalf("default ga_root=%q, want empty for first-run bootstrap", store.Snapshot().GARoot)
	}
	if store.Snapshot().BootstrapDone {
		t.Fatalf("bootstrap_done default should be false")
	}
	if store.Snapshot().EffectivePython != "" {
		t.Fatalf("default effective_python=%q, want empty", store.Snapshot().EffectivePython)
	}

	py := filepath.Join(root, "python.exe")
	if err := os.WriteFile(py, []byte("stub"), 0755); err != nil {
		t.Fatal(err)
	}
	cfg := Default()
	cfg.GARoot = root
	cfg.PythonPath = py
	cfg.EffectivePython = filepath.Join(root, "ignored-python.exe")
	cfg.BootstrapDone = true
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}

	reloaded := NewStore(root)
	if !reloaded.Snapshot().BootstrapDone {
		t.Fatalf("bootstrap_done was not persisted: %#v", reloaded.Snapshot())
	}
	if reloaded.Snapshot().EffectivePython != py {
		t.Fatalf("effective_python=%q, want python_path %q", reloaded.Snapshot().EffectivePython, py)
	}
}

func TestStoreLoadMigratesLegacyConfigToDefaultInstance(t *testing.T) {
	appRoot := t.TempDir()
	gaRoot := filepath.Join(t.TempDir(), "ga")
	if err := os.MkdirAll(gaRoot, 0755); err != nil {
		t.Fatal(err)
	}
	pythonPath := filepath.Join(gaRoot, "python.exe")
	if err := os.WriteFile(pythonPath, []byte("stub"), 0755); err != nil {
		t.Fatal(err)
	}
	legacy := map[string]interface{}{
		"ga_root":       gaRoot,
		"python_path":   pythonPath,
		"chat_data_dir": filepath.Join(appRoot, "chat"),
		"port":          18787,
	}
	data, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appRoot, "config.local.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	store := NewStore(appRoot)
	if store.Snapshot().DefaultInstanceID != "default" || len(store.Snapshot().Instances) != 1 {
		t.Fatalf("legacy config was not migrated: %#v", store.Snapshot())
	}
	instance := store.Snapshot().Instances[0]
	if instance.ID != "default" || instance.Name != "Default" || instance.GARoot != gaRoot {
		t.Fatalf("unexpected migrated instance: %#v", instance)
	}
	if instance.PythonPath != pythonPath || instance.EffectivePython != pythonPath {
		t.Fatalf("unexpected migrated Python fields: %#v", instance)
	}
}

func TestStoreRoundTripsInstanceRegistryAndLegacyMirror(t *testing.T) {
	appRoot := t.TempDir()
	rootA := filepath.Join(t.TempDir(), "ga-a")
	rootB := filepath.Join(t.TempDir(), "ga-b")
	for _, root := range []string{rootA, rootB} {
		if err := os.MkdirAll(root, 0755); err != nil {
			t.Fatal(err)
		}
	}
	pythonB := filepath.Join(rootB, "python.exe")
	if err := os.WriteFile(pythonB, []byte("stub"), 0755); err != nil {
		t.Fatal(err)
	}

	cfg := Default()
	cfg.GARoot = rootA
	cfg.DefaultInstanceID = "beta"
	cfg.Instances = []InstanceConfig{
		{ID: "alpha", Name: "Alpha", GARoot: rootA},
		{ID: "beta", Name: "Beta", GARoot: rootB, PythonPath: pythonB},
	}
	store := NewStore(appRoot)
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}

	reloaded := NewStore(appRoot)
	if reloaded.Snapshot().DefaultInstanceID != "beta" || len(reloaded.Snapshot().Instances) != 2 {
		t.Fatalf("unexpected registry after reload: %#v", reloaded.Snapshot())
	}
	if reloaded.Snapshot().GARoot != rootB || reloaded.Snapshot().PythonPath != pythonB || reloaded.Snapshot().EffectivePython != pythonB {
		t.Fatalf("legacy fields do not mirror selected instance: %#v", reloaded.Snapshot())
	}
	instance, ok := reloaded.Snapshot().Instance("")
	if !ok || instance.ID != "beta" {
		t.Fatalf("default instance lookup = %#v, %v", instance, ok)
	}
}

func TestSyncDefaultInstanceFromLegacy(t *testing.T) {
	rootA := filepath.Join(t.TempDir(), "ga-a")
	rootB := filepath.Join(t.TempDir(), "ga-b")
	for _, root := range []string{rootA, rootB} {
		if err := os.MkdirAll(root, 0755); err != nil {
			t.Fatal(err)
		}
	}
	pythonB := filepath.Join(rootB, "python.exe")
	if err := os.WriteFile(pythonB, []byte("stub"), 0755); err != nil {
		t.Fatal(err)
	}
	cfg := AppConfig{
		GARoot:            rootB,
		PythonPath:        pythonB,
		DefaultInstanceID: "alpha",
		Instances: []InstanceConfig{
			{ID: "alpha", Name: "Alpha", GARoot: rootA},
		},
	}
	if !cfg.SyncDefaultInstanceFromLegacy() {
		t.Fatal("SyncDefaultInstanceFromLegacy() = false, want true")
	}
	instance := cfg.Instances[0]
	if instance.GARoot != rootB || instance.PythonPath != pythonB || instance.EffectivePython != pythonB {
		t.Fatalf("default instance was not synchronized: %#v", instance)
	}
	cfg.DefaultInstanceID = "missing"
	if cfg.SyncDefaultInstanceFromLegacy() {
		t.Fatal("SyncDefaultInstanceFromLegacy() = true for missing default")
	}
}

func TestStoreSaveRejectsInvalidInstanceRegistry(t *testing.T) {
	rootA := filepath.Join(t.TempDir(), "ga-a")
	rootB := filepath.Join(t.TempDir(), "ga-b")
	for _, root := range []string{rootA, rootB} {
		if err := os.MkdirAll(root, 0755); err != nil {
			t.Fatal(err)
		}
	}
	base := func() AppConfig {
		cfg := Default()
		cfg.DefaultInstanceID = "alpha"
		cfg.Instances = []InstanceConfig{
			{ID: "alpha", Name: "Alpha", GARoot: rootA},
			{ID: "beta", Name: "Beta", GARoot: rootB},
		}
		return cfg
	}
	tests := []struct {
		name string
		want string
		edit func(*AppConfig)
	}{
		{name: "invalid id", want: "instances[0].id", edit: func(cfg *AppConfig) { cfg.Instances[0].ID = "bad/id" }},
		{name: "duplicate id", want: "duplicate instance id", edit: func(cfg *AppConfig) { cfg.Instances[1].ID = "alpha" }},
		{name: "duplicate name", want: "duplicate instance name", edit: func(cfg *AppConfig) { cfg.Instances[1].Name = "ALPHA" }},
		{name: "duplicate root", want: "duplicate instance ga_root", edit: func(cfg *AppConfig) { cfg.Instances[1].GARoot = rootA }},
		{name: "missing default", want: "does not reference", edit: func(cfg *AppConfig) { cfg.DefaultInstanceID = "missing" }},
		{name: "missing root", want: "does not exist", edit: func(cfg *AppConfig) { cfg.Instances[1].GARoot = filepath.Join(rootB, "missing") }},
		{name: "empty root", want: "ga_root is required", edit: func(cfg *AppConfig) { cfg.Instances[1].GARoot = "" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := base()
			tt.edit(&cfg)
			store := NewStore(t.TempDir())
			err := store.Save(cfg)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("Save() err = %v, want substring %q", err, tt.want)
			}
		})
	}
}

func TestStoreChatDataDirDefaultsToStoreRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "admin-root")
	want := filepath.Join(root, "data")

	store := NewStore(root)
	if got := store.Snapshot().ChatDataDir; got != want {
		t.Fatalf("NewStore() chat_data_dir = %q, want %q", got, want)
	}

	cfg := store.Snapshot()
	cfg.ChatDataDir = ""
	if err := store.Save(cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if got := store.Snapshot().ChatDataDir; got != want {
		t.Fatalf("Save() normalized chat_data_dir = %q, want %q", got, want)
	}

	if err := os.WriteFile(filepath.Join(root, "config.local.json"), []byte(`{"chat_data_dir":""}`), 0644); err != nil {
		t.Fatal(err)
	}
	reloaded := NewStore(root)
	if got := reloaded.Snapshot().ChatDataDir; got != want {
		t.Fatalf("Load() normalized chat_data_dir = %q, want %q", got, want)
	}
}

func configWithReferenceFields(t *testing.T, store *Store) AppConfig {
	t.Helper()
	gaRoot := filepath.Join(t.TempDir(), "ga-root")
	if err := os.MkdirAll(gaRoot, 0755); err != nil {
		t.Fatal(err)
	}
	cfg := store.Snapshot()
	cfg.GARoot = gaRoot
	cfg.DefaultInstanceID = "alpha"
	cfg.Instances = []InstanceConfig{{ID: "alpha", Name: "Alpha", GARoot: gaRoot}}
	cfg.ServiceAutostart = []string{"svc-a"}
	cfg.ServiceModels = map[string]int{"svc-a": 3}
	cfg.ChatTitleModel = &ChatTitleModelRef{Model: "title-model", LLMNo: 4}
	cfg.SlashCommands = []SlashCommandItem{{Cmd: "/probe", Desc: "Probe", Content: "original command"}}
	cfg.ExtraSystemPromptPresets = []ExtraSystemPromptPreset{{ID: "probe", Name: "Probe", Content: "original preset"}}
	return cfg
}

func mutateConfigReferenceFields(cfg *AppConfig) {
	cfg.Instances[0].Name = "mutated instance"
	cfg.ServiceAutostart[0] = "mutated service"
	cfg.ServiceModels["svc-a"] = 99
	cfg.ServiceModels["new-service"] = 100
	cfg.ChatTitleModel.Model = "mutated title model"
	cfg.SlashCommands[0].Content = "mutated command"
	cfg.ExtraSystemPromptPresets[0].Content = "mutated preset"
}

func requireConfigEqual(t *testing.T, got, want AppConfig) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("config changed through an alias\ngot:  %#v\nwant: %#v", got, want)
	}
}

func TestValidateGitHubMirror(t *testing.T) {
	valid := []string{"", "https://mirror.example", "http://127.0.0.1:8080/base/"}
	for _, mirror := range valid {
		cfg := Default()
		cfg.GitHubMirror = mirror
		if err := Validate(cfg); err != nil {
			t.Fatalf("Validate(github_mirror=%q) returned %v", mirror, err)
		}
	}

	invalid := []string{"mirror.example", "ftp://mirror.example", "https://mirror.example/?token=x", "https://mirror.example/#fragment"}
	for _, mirror := range invalid {
		cfg := Default()
		cfg.GitHubMirror = mirror
		if err := Validate(cfg); err == nil || !strings.Contains(err.Error(), "github_mirror") {
			t.Fatalf("Validate(github_mirror=%q) error = %v, want github_mirror error", mirror, err)
		}
	}
}

func TestStoreSnapshotDoesNotAliasReferenceFields(t *testing.T) {
	store := NewStore(t.TempDir())
	if err := store.Save(configWithReferenceFields(t, store)); err != nil {
		t.Fatal(err)
	}
	want := store.Snapshot()
	leaked := store.Snapshot()

	mutateConfigReferenceFields(&leaked)

	requireConfigEqual(t, store.Snapshot(), want)
}

func TestStoreSaveDoesNotRetainInputAliases(t *testing.T) {
	store := NewStore(t.TempDir())
	input := configWithReferenceFields(t, store)
	if err := store.Save(input); err != nil {
		t.Fatal(err)
	}
	want := store.Snapshot()

	mutateConfigReferenceFields(&input)

	requireConfigEqual(t, store.Snapshot(), want)
}

func TestStoreUpdateRuntimeIsAtomicAndDoesNotPublishAliases(t *testing.T) {
	store := NewStore(t.TempDir())
	input := configWithReferenceFields(t, store)
	var callbackView *AppConfig
	if err := store.UpdateRuntime(func(current *AppConfig) {
		*current = input
		callbackView = current
	}); err != nil {
		t.Fatal(err)
	}
	want := store.Snapshot()

	mutateConfigReferenceFields(callbackView)
	mutateConfigReferenceFields(&input)
	requireConfigEqual(t, store.Snapshot(), want)

	beforeRejectedUpdate := store.Snapshot()
	err := store.UpdateRuntime(func(current *AppConfig) {
		current.ServiceModels["svc-a"] = 101
		current.Port = -1
	})
	if err == nil {
		t.Fatal("UpdateRuntime() expected validation error")
	}
	requireConfigEqual(t, store.Snapshot(), beforeRejectedUpdate)
}

func TestDefaultAndValidUITheme(t *testing.T) {
	if Default().UITheme != DefaultUITheme {
		t.Fatalf("Default().UITheme=%q want %q", Default().UITheme, DefaultUITheme)
	}
	for _, theme := range []string{"light", "warm", "dark"} {
		if !ValidUITheme(theme) {
			t.Fatalf("ValidUITheme(%q)=false", theme)
		}
	}
	for _, theme := range []string{"", "dim", "not-a-theme"} {
		if ValidUITheme(theme) {
			t.Fatalf("ValidUITheme(%q)=true", theme)
		}
	}
}

func TestStorePersistsUITheme(t *testing.T) {
	root := t.TempDir()
	store := NewStore(root)
	cfg := Default()
	cfg.UITheme = "dark"
	if err := store.Save(cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if got := store.Snapshot().UITheme; got != "dark" {
		t.Fatalf("Snapshot().UITheme=%q want dark", got)
	}
	reloaded := NewStore(root)
	if got := reloaded.Snapshot().UITheme; got != "dark" {
		t.Fatalf("reloaded UITheme=%q want dark", got)
	}
}

func TestValidUIThemeAcceptsGreen(t *testing.T) {
	if !ValidUITheme("green") {
		t.Fatal("ValidUITheme(\"green\")=false")
	}
	cfg := Default()
	cfg.UITheme = "green"
	if err := Validate(cfg); err != nil {
		t.Fatalf("Validate(green)=%v", err)
	}
}

func TestNormalizeUICustomColorsKeepsOnlyWhitelistedSafeValues(t *testing.T) {
	got := NormalizeUICustomColors(map[string]string{
		"--bg":           "#F4FAF3",
		"accent":         "rgba(47, 125, 79, .5)",
		"oa-bg":          "red; } html{display:none} /*",
		"accent-hover":   "url(evil)",
		"no-such-token":  "#000000",
		"surface":        "expression(alert(1))",
		"text-on-accent": "not-a-color",
		"accent-text":    "#fff",
	})
	want := map[string]string{"bg": "#F4FAF3", "accent": "rgba(47, 125, 79, .5)", "accent-text": "#fff"}
	if len(got) != len(want) {
		t.Fatalf("NormalizeUICustomColors=%v want %v", got, want)
	}
	for token, value := range want {
		if got[token] != value {
			t.Fatalf("token %s=%q want %q (got %v)", token, got[token], value, got)
		}
	}
	if NormalizeUICustomColors(nil) != nil || NormalizeUICustomColors(map[string]string{}) != nil {
		t.Fatal("empty input must normalize to nil")
	}
	// A stored palette is normalized (and thus sanitized) when the config loads.
	cfg := Default()
	cfg.UICustomColors = map[string]string{"bg": "javascript:alert(1)", "accent": "#2F7D4F"}
	store := NewStore(t.TempDir())
	if err := store.Save(cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	reloaded := NewStore(t.TempDir())
	if snap := reloaded.Snapshot().UICustomColors; len(snap) != 0 && snap["bg"] == "javascript:alert(1)" {
		t.Fatalf("unsafe value survived reload: %v", snap)
	}
}
