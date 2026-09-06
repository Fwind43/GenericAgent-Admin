package modelconfig

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"genericagent-admin-go/internal/pyfind"
)

type OptionalBool bool

func (b *OptionalBool) UnmarshalJSON(data []byte) error {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" || trimmed == "null" {
		return nil
	}
	var raw interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	switch v := raw.(type) {
	case bool:
		*b = OptionalBool(v)
		return nil
	case string:
		parsed := parseOptionalBoolString(v)
		*b = OptionalBool(parsed)
		return nil
	default:
		return fmt.Errorf("fake_cc_system_prompt must be a boolean or boolean string")
	}
}

func parseOptionalBoolString(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", "0", "false", "f", "no", "n", "off":
		return false
	case "1", "true", "t", "yes", "y", "on":
		return true
	default:
		// Preserve the old string-field behavior for legacy non-empty values:
		// GA treats any non-empty fake_cc_system_prompt value as enabled.
		return true
	}
}

type ModelConfig struct {
	InstanceID         string                 `json:"instance_id,omitempty"`
	Model              string                 `json:"model"`
	Name               string                 `json:"name,omitempty"`
	SortOrder          *int                   `json:"sort_order,omitempty"`
	Stream             *bool                  `json:"stream,omitempty"`
	MaxRetries         *int                   `json:"max_retries,omitempty"`
	ReadTimeout        *int                   `json:"read_timeout,omitempty"`
	ConnectTimeout     *int                   `json:"connect_timeout,omitempty"`
	UserAgent          string                 `json:"user_agent,omitempty"`
	APIMode            string                 `json:"api_mode,omitempty"`
	ServiceTier        string                 `json:"service_tier,omitempty"`
	ThinkingType       string                 `json:"thinking_type,omitempty"`
	ReasoningEffort    string                 `json:"reasoning_effort,omitempty"`
	FakeCCSystemPrompt *OptionalBool          `json:"fake_cc_system_prompt,omitempty"`
	FailoverOrder      *int                   `json:"failover_order,omitempty"`
	FailoverMaxRetries *int                   `json:"failover_max_retries,omitempty"`
	FailoverBaseDelay  *float64               `json:"failover_base_delay,omitempty"`
	FailoverSpringBack *int                   `json:"failover_spring_back,omitempty"`
	Extra              map[string]interface{} `json:"extra,omitempty"`
}

type Profile struct {
	VarName            string                 `json:"var_name"`
	DisplayName        string                 `json:"display_name,omitempty"`
	SourceVarName      string                 `json:"source_var_name,omitempty"`
	ProviderSortOrder  *int                   `json:"provider_sort_order,omitempty"`
	Type               string                 `json:"type"`
	Name               string                 `json:"name"`
	APIBase            string                 `json:"apibase"`
	Model              string                 `json:"model"`
	Models             []string               `json:"models,omitempty"`
	ModelConfigs       []ModelConfig          `json:"model_configs,omitempty"`
	APIKey             string                 `json:"apikey"`
	Stream             *bool                  `json:"stream,omitempty"`
	MaxRetries         *int                   `json:"max_retries,omitempty"`
	ReadTimeout        *int                   `json:"read_timeout,omitempty"`
	ConnectTimeout     *int                   `json:"connect_timeout,omitempty"`
	UserAgent          string                 `json:"user_agent,omitempty"`
	APIMode            string                 `json:"api_mode,omitempty"`
	ServiceTier        string                 `json:"service_tier,omitempty"`
	ThinkingType       string                 `json:"thinking_type,omitempty"`
	ReasoningEffort    string                 `json:"reasoning_effort,omitempty"`
	FakeCCSystemPrompt *OptionalBool          `json:"fake_cc_system_prompt,omitempty"`
	Extra              map[string]interface{} `json:"extra,omitempty"`
}

type FailoverMember struct {
	ProviderVarName string `json:"provider_var_name"`
	Model           string `json:"model"`
	InstanceID      string `json:"instance_id,omitempty"`
}

type FailoverGroup struct {
	VarName    string           `json:"var_name"`
	Members    []FailoverMember `json:"members"`
	MaxRetries int              `json:"max_retries"`
	BaseDelay  float64          `json:"base_delay"`
	SpringBack *int             `json:"spring_back,omitempty"`
}

type Draft struct {
	UpdatedAt      string          `json:"updated_at,omitempty"`
	Profiles       []Profile       `json:"profiles"`
	FailoverGroups []FailoverGroup `json:"failover_groups,omitempty"`
}
type Store struct{ Root string }

var (
	nameRe                 = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	failoverGroupNameRe    = regexp.MustCompile(`^mixin_config_[A-Za-z0-9_]+$`)
	managedModelsBeginRe   = regexp.MustCompile(`(?m)^# >>> GA Admin managed models >>>\r?$`)
	managedModelsEndRe     = regexp.MustCompile(`(?m)^# <<< GA Admin managed models <<<\r?$`)
	legacyProviderGroupsRe = regexp.MustCompile(`(?m)^_ga_admin_provider_groups = [^\r\n]*\r?$`)
)

const (
	managedModelsBegin   = "# >>> GA Admin managed models >>>"
	managedModelsEnd     = "# <<< GA Admin managed models <<<"
	legacyRenderedHeader = "# Auto-generated by GenericAgent-Admin-Go."
)

func NewStore(root string) *Store { return &Store{Root: root} }
func (s *Store) path() string     { return filepath.Join(s.Root, "model_profiles.json") }

func unsafeGARoot(p string) bool {
	clean := filepath.Clean(strings.TrimSpace(p))
	if clean == "" || clean == "." {
		return true
	}
	vol := filepath.VolumeName(clean)
	rest := strings.TrimPrefix(clean, vol)
	rest = filepath.Clean(rest)
	return rest == "" || rest == "." || rest == string(filepath.Separator)
}

func validateExportRoot(gaRoot string) error {
	if unsafeGARoot(gaRoot) {
		return fmt.Errorf("ga_root must not be empty or a filesystem root")
	}
	return nil
}

func Defaults() []Profile {
	b := true
	mr := 3
	rt := 300
	return []Profile{{VarName: "native_oai_config1", Type: "native_oai", Name: "main", APIBase: "https://api.openai.com/v1", Model: "gpt-4.1", Models: []string{"gpt-4.1"}, Stream: &b, MaxRetries: &mr, ReadTimeout: &rt, Extra: map[string]interface{}{}}}
}

func (s *Store) Load(raw bool) (Draft, error) {
	data, err := os.ReadFile(s.path())
	if err != nil {
		d := Draft{Profiles: Defaults()}
		return d, nil
	}
	var d Draft
	if err := json.Unmarshal(data, &d); err != nil {
		return d, err
	}
	if len(d.Profiles) == 0 {
		d.Profiles = Defaults()
	}
	d.Profiles = normalizeProfiles(d.Profiles)
	if !raw {
		for i := range d.Profiles {
			if d.Profiles[i].APIKey != "" {
				d.Profiles[i].APIKey = "******"
			}
		}
	}
	return d, nil
}

func (s *Store) Save(profiles []Profile) (Draft, error) {
	merged, err := s.MergePreservedSecrets(profiles)
	if err != nil {
		return Draft{}, err
	}
	merged = normalizeProfiles(merged)
	if err := Validate(merged); err != nil {
		return Draft{}, err
	}
	d := Draft{UpdatedAt: time.Now().Format(time.RFC3339), Profiles: merged}
	data, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return d, err
	}
	return d, writeFileAtomic(s.path(), data, 0600)
}

func (s *Store) MergePreservedSecrets(profiles []Profile) ([]Profile, error) {
	old, err := s.Load(true)
	if err != nil {
		return nil, err
	}
	byVar := map[string]string{}
	for _, p := range old.Profiles {
		if p.APIKey == "" || IsMaskedSecret(p.APIKey) {
			continue
		}
		if p.VarName != "" {
			byVar[p.VarName] = p.APIKey
		}
		if p.SourceVarName != "" {
			byVar[p.SourceVarName] = p.APIKey
		}
	}
	merged := make([]Profile, len(profiles))
	copy(merged, profiles)
	for i := range merged {
		if merged[i].APIKey != "" && !IsMaskedSecret(merged[i].APIKey) {
			continue
		}
		lookupVar := merged[i].SourceVarName
		if lookupVar == "" {
			lookupVar = merged[i].VarName
		}
		if oldKey := byVar[lookupVar]; oldKey != "" {
			merged[i].APIKey = oldKey
		}
	}
	return merged, nil
}

func normalizeProfiles(profiles []Profile) []Profile {
	out := make([]Profile, len(profiles))
	for i, p := range profiles {
		out[i] = normalizeProfile(p)
	}
	return out
}

func normalizeProfile(p Profile) Profile {
	p.DisplayName = strings.TrimSpace(p.DisplayName)
	configs := profileModelConfigs(p)
	p.ModelConfigs = configs
	p.Models = make([]string, 0, len(configs))
	for _, config := range configs {
		p.Models = append(p.Models, config.Model)
	}
	if len(configs) > 0 {
		p.Model = configs[0].Model
	} else {
		p.Model = strings.TrimSpace(p.Model)
	}
	return p
}

func legacyProfileModels(p Profile) []string {
	seen := map[string]bool{}
	models := []string{}
	add := func(v string) {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			return
		}
		seen[v] = true
		models = append(models, v)
	}
	add(p.Model)
	for _, m := range p.Models {
		add(m)
	}
	return models
}

func profileModelConfigs(p Profile) []ModelConfig {
	if len(p.ModelConfigs) > 0 {
		configs := make([]ModelConfig, len(p.ModelConfigs))
		copy(configs, p.ModelConfigs)
		for i := range configs {
			configs[i].Model = strings.TrimSpace(configs[i].Model)
			configs[i].Name = strings.TrimSpace(configs[i].Name)
		}
		return configs
	}
	models := legacyProfileModels(p)
	configs := make([]ModelConfig, 0, len(models))
	for _, model := range models {
		configs = append(configs, ModelConfig{
			Model:              model,
			Stream:             p.Stream,
			MaxRetries:         p.MaxRetries,
			ReadTimeout:        p.ReadTimeout,
			ConnectTimeout:     p.ConnectTimeout,
			UserAgent:          p.UserAgent,
			APIMode:            p.APIMode,
			ServiceTier:        p.ServiceTier,
			ThinkingType:       p.ThinkingType,
			ReasoningEffort:    p.ReasoningEffort,
			FakeCCSystemPrompt: p.FakeCCSystemPrompt,
			Extra:              p.Extra,
		})
	}
	return configs
}

func profileModels(p Profile) []string {
	configs := profileModelConfigs(p)
	models := make([]string, 0, len(configs))
	for _, config := range configs {
		models = append(models, config.Model)
	}
	return models
}

func expandedVarName(base string, index int) string {
	if index == 0 {
		return base
	}
	return fmt.Sprintf("%s_%d", base, index+1)
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) (err error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+"-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		if err != nil {
			_ = os.Remove(tmpName)
		}
	}()
	if _, err = tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmpName, path); err != nil {
		return err
	}
	return nil
}
func Validate(profiles []Profile) error {
	return validateProfiles(profiles, false)
}

func validateProfiles(profiles []Profile, allowMaskedSecrets bool) error {
	seen := map[string]bool{}
	type failoverMember struct {
		order      int
		family     string
		model      string
		maxRetries int
		baseDelay  float64
		springBack *int
	}
	members := []failoverMember{}
	for _, raw := range profiles {
		p := normalizeProfile(raw)
		if p.VarName == "" || !nameRe.MatchString(p.VarName) {
			return fmt.Errorf("invalid var_name: %s", p.VarName)
		}
		if !strings.Contains(strings.ToLower(p.VarName), "api") && !strings.Contains(strings.ToLower(p.VarName), "config") && !strings.Contains(strings.ToLower(p.VarName), "cookie") {
			return fmt.Errorf("var_name must contain api/config/cookie: %s", p.VarName)
		}
		configs := profileModelConfigs(p)
		instanceSeen := map[string]bool{}
		for i, config := range configs {
			if config.Model == "" {
				return fmt.Errorf("model is required at index %d", i)
			}
			if config.InstanceID != "" {
				if instanceSeen[config.InstanceID] {
					return fmt.Errorf("duplicate model instance_id: %s", config.InstanceID)
				}
				instanceSeen[config.InstanceID] = true
			}
			if config.MaxRetries != nil && *config.MaxRetries < 0 {
				return fmt.Errorf("max_retries must be zero or greater for model %s", config.Model)
			}
			if config.ReadTimeout != nil && *config.ReadTimeout <= 0 {
				return fmt.Errorf("read_timeout must be greater than zero for model %s", config.Model)
			}
			if config.ConnectTimeout != nil && *config.ConnectTimeout <= 0 {
				return fmt.Errorf("connect_timeout must be greater than zero for model %s", config.Model)
			}
			varName := expandedVarName(p.VarName, i)
			if seen[varName] {
				return fmt.Errorf("duplicate var_name: %s", varName)
			}
			seen[varName] = true
			if config.FailoverOrder != nil {
				if *config.FailoverOrder < 0 {
					return fmt.Errorf("failover_order must be zero or greater for model %s", config.Model)
				}
				maxRetries := 10
				if config.FailoverMaxRetries != nil {
					maxRetries = *config.FailoverMaxRetries
				}
				baseDelay := 0.5
				if config.FailoverBaseDelay != nil {
					baseDelay = *config.FailoverBaseDelay
				}
				if maxRetries < 0 || baseDelay < 0 {
					return fmt.Errorf("failover retry settings must be zero or greater for model %s", config.Model)
				}
				if config.FailoverSpringBack != nil && *config.FailoverSpringBack <= 0 {
					return fmt.Errorf("failover_spring_back must be greater than zero for model %s", config.Model)
				}
				family := "legacy"
				if strings.HasPrefix(strings.ToLower(strings.TrimSpace(p.Type)), "native_") {
					family = "native"
				}
				members = append(members, failoverMember{*config.FailoverOrder, family, config.Model, maxRetries, baseDelay, config.FailoverSpringBack})
			}
		}
		if p.APIBase == "" {
			return errors.New("apibase and model are required")
		}
	}
	if len(members) > 0 {
		if len(members) < 2 {
			return errors.New("failover requires at least two model sessions")
		}
		sort.Slice(members, func(i, j int) bool { return members[i].order < members[j].order })
		first := members[0]
		for i, member := range members {
			if member.order != i {
				return errors.New("failover_order values must be unique and consecutive from zero")
			}
			if member.family != first.family {
				return errors.New("failover cannot mix Native and Legacy model families")
			}
			if member.maxRetries != first.maxRetries || member.baseDelay != first.baseDelay {
				return errors.New("failover retry settings must match for every member")
			}
			if (member.springBack == nil) != (first.springBack == nil) || (member.springBack != nil && *member.springBack != *first.springBack) {
				return errors.New("failover spring_back must match for every member")
			}
		}
	}
	return nil
}

type resolvedFailoverGroup struct {
	VarName      string
	SessionNames []string
	MaxRetries   int
	BaseDelay    float64
	SpringBack   *int
}

func legacyFailoverGroups(profiles []Profile) []FailoverGroup {
	type orderedMember struct {
		order  int
		member FailoverMember
		config ModelConfig
	}
	ordered := []orderedMember{}
	for _, profile := range normalizeProfiles(profiles) {
		for _, config := range profileModelConfigs(profile) {
			if config.FailoverOrder == nil {
				continue
			}
			ordered = append(ordered, orderedMember{
				order: *config.FailoverOrder,
				member: FailoverMember{
					ProviderVarName: profile.VarName,
					Model:           config.Model,
				},
				config: config,
			})
		}
	}
	if len(ordered) == 0 {
		return nil
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].order < ordered[j].order })
	first := ordered[0].config
	maxRetries := 10
	if first.FailoverMaxRetries != nil {
		maxRetries = *first.FailoverMaxRetries
	}
	baseDelay := 0.5
	if first.FailoverBaseDelay != nil {
		baseDelay = *first.FailoverBaseDelay
	}
	members := make([]FailoverMember, 0, len(ordered))
	for _, item := range ordered {
		members = append(members, item.member)
	}
	return []FailoverGroup{{
		VarName:    "mixin_config_1",
		Members:    members,
		MaxRetries: maxRetries,
		BaseDelay:  baseDelay,
		SpringBack: first.FailoverSpringBack,
	}}
}

func resolveFailoverGroups(profiles []Profile, groups []FailoverGroup) ([]resolvedFailoverGroup, error) {
	type memberTarget struct {
		sessionName string
		family      string
	}
	type providerTargets struct {
		byInstance map[string]memberTarget
		byModel    map[string][]memberTarget
	}
	targets := map[string]providerTargets{}
	generatedNames := map[string]bool{}
	for _, profile := range profiles {
		family := "legacy"
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(profile.Type)), "native_") {
			family = "native"
		}
		provider := providerTargets{byInstance: map[string]memberTarget{}, byModel: map[string][]memberTarget{}}
		for index, config := range profileModelConfigs(profile) {
			sessionName := expandedVarName(profile.VarName, index)
			generatedNames[sessionName] = true
			target := memberTarget{sessionName: sessionName, family: family}
			if config.InstanceID != "" {
				provider.byInstance[config.InstanceID] = target
			}
			provider.byModel[config.Model] = append(provider.byModel[config.Model], target)
		}
		targets[profile.VarName] = provider
	}

	seenGroups := map[string]bool{}
	resolved := make([]resolvedFailoverGroup, 0, len(groups))
	for groupIndex, raw := range groups {
		group := raw
		group.VarName = strings.TrimSpace(group.VarName)
		if !failoverGroupNameRe.MatchString(group.VarName) {
			return nil, fmt.Errorf("failover group var_name must match mixin_config_[A-Za-z0-9_]+ at index %d: %s", groupIndex, group.VarName)
		}
		if seenGroups[group.VarName] || generatedNames[group.VarName] {
			return nil, fmt.Errorf("duplicate failover group var_name: %s", group.VarName)
		}
		seenGroups[group.VarName] = true
		if len(group.Members) < 2 {
			return nil, fmt.Errorf("failover group %s requires at least two model sessions", group.VarName)
		}
		if group.MaxRetries < 0 || group.BaseDelay < 0 {
			return nil, fmt.Errorf("failover retry settings must be zero or greater for group %s", group.VarName)
		}
		if group.SpringBack != nil && *group.SpringBack <= 0 {
			return nil, fmt.Errorf("spring_back must be greater than zero for group %s", group.VarName)
		}

		sessionNames := make([]string, 0, len(group.Members))
		seenMembers := map[string]bool{}
		family := ""
		for memberIndex, member := range group.Members {
			providerVarName := strings.TrimSpace(member.ProviderVarName)
			model := strings.TrimSpace(member.Model)
			provider, ok := targets[providerVarName]
			if !ok {
				return nil, fmt.Errorf("unknown provider_var_name %q in failover group %s", providerVarName, group.VarName)
			}
			var target memberTarget
			if instanceID := strings.TrimSpace(member.InstanceID); instanceID != "" {
				target, ok = provider.byInstance[instanceID]
				if !ok {
					return nil, fmt.Errorf("unknown model instance_id %q for provider %s in failover group %s", instanceID, providerVarName, group.VarName)
				}
			} else {
				matches := provider.byModel[model]
				if len(matches) == 0 {
					return nil, fmt.Errorf("unknown model %q for provider %s in failover group %s", model, providerVarName, group.VarName)
				}
				if len(matches) > 1 {
					return nil, fmt.Errorf("model %q is ambiguous for provider %s in failover group %s; instance_id is required", model, providerVarName, group.VarName)
				}
				target = matches[0]
			}
			if seenMembers[target.sessionName] {
				return nil, fmt.Errorf("duplicate member at index %d in failover group %s", memberIndex, group.VarName)
			}
			seenMembers[target.sessionName] = true
			if family == "" {
				family = target.family
			} else if family != target.family {
				return nil, fmt.Errorf("failover group %s cannot mix Native and Legacy model families", group.VarName)
			}
			sessionNames = append(sessionNames, target.sessionName)
		}
		resolved = append(resolved, resolvedFailoverGroup{
			VarName:      group.VarName,
			SessionNames: sessionNames,
			MaxRetries:   group.MaxRetries,
			BaseDelay:    group.BaseDelay,
			SpringBack:   group.SpringBack,
		})
	}
	return resolved, nil
}

func IsMaskedSecret(s string) bool {
	if s == "******" {
		return true
	}
	return strings.Contains(s, "****")
}

func SourceStatus(gaRoot string) map[string]interface{} {
	mykey := filepath.Join(gaRoot, "mykey.py")
	jsonp := filepath.Join(gaRoot, "mykey.json")
	return map[string]interface{}{
		"mykey_py_exists":   exists(mykey),
		"mykey_json_exists": exists(jsonp),
		"mykey_py_path":     mykey,
		"safe_note":         "mykey.py is the official GenericAgent model configuration file. Import loads the current mykey.py in an isolated Python process so computed runtime values match GenericAgent.",
	}
}
func exists(p string) bool { st, err := os.Stat(p); return err == nil && !st.IsDir() }

func ImportMyKey(gaRoot string, reveal bool) (Draft, error) {
	return ImportMyKeyWithPython(gaRoot, "", reveal)
}

func ImportMyKeyWithPython(gaRoot, configuredPython string, reveal bool) (Draft, error) {
	mykey := filepath.Join(gaRoot, "mykey.py")
	if !exists(mykey) {
		return Draft{UpdatedAt: time.Now().Format(time.RFC3339), Profiles: Defaults()}, nil
	}
	py := pythonExe(gaRoot, configuredPython)
	script := `import importlib.util, json, os, sys
path=sys.argv[1]
reveal=sys.argv[2]=='1'
ga_root=os.path.dirname(os.path.abspath(path))
if ga_root not in sys.path:
    sys.path.insert(0, ga_root)

spec=importlib.util.spec_from_file_location('mykey', path)
if spec is None or spec.loader is None:
    raise RuntimeError('cannot load mykey.py')
mod=importlib.util.module_from_spec(spec)
sys.modules['mykey']=mod
spec.loader.exec_module(mod)


def jsonable(v):
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    if isinstance(v, dict):
        return {str(k): jsonable(val) for k, val in v.items()}
    if isinstance(v, (list, tuple, set)):
        return [jsonable(x) for x in v]
    return str(v)


def mask(s):
    if not isinstance(s,str) or not s: return s
    if reveal: return s
    if len(s)<=8: return '******'
    return s[:3]+'****'+s[-4:]

profiles_by_var={}
profile_order=[]
declaration_order_by_var={}
aggregation_key_by_var={}
model_instances=getattr(mod, '_ga_admin_model_instances', {})
if not isinstance(model_instances, dict):
    model_instances={}
mixin_groups_raw=[]
for mixin_var, mixin_value in vars(mod).items():
    if mixin_var.startswith('_') or 'mixin' not in mixin_var.lower() or not isinstance(mixin_value, dict):
        continue
    mixin_data=jsonable(mixin_value)
    if not isinstance(mixin_data, dict):
        continue
    refs=mixin_data.get('llm_nos', [])
    if isinstance(refs, (list, tuple)):
        mixin_groups_raw.append((mixin_var, dict(mixin_data)))
mixin=getattr(mod, 'mixin_config', {})
failover_refs={}
failover_values={}
if isinstance(mixin, dict):
    llm_nos=mixin.get('llm_nos', [])
    if isinstance(llm_nos, (list, tuple)):
        for order, ref in enumerate(llm_nos):
            if isinstance(ref, str) and ref:
                failover_refs.setdefault(ref, order)
    max_retries=mixin.get('max_retries')
    base_delay=mixin.get('base_delay')
    spring_back=mixin.get('spring_back')
    if isinstance(max_retries, int) and not isinstance(max_retries, bool):
        failover_values['failover_max_retries']=max_retries
    if isinstance(base_delay, (int, float)) and not isinstance(base_delay, bool):
        failover_values['failover_base_delay']=base_delay
    if isinstance(spring_back, int) and not isinstance(spring_back, bool):
        failover_values['failover_spring_back']=spring_back
for var, value in vars(mod).items():
    if var.startswith('_'):
        continue
    low=var.lower()
    if 'mixin' in low:
        continue
    official = any(x in low for x in ('native_claude','native_oai','claude','oai'))
    legacy = any(x in low for x in ('api','config','cookie'))
    if not (official or legacy):
        continue
    if not isinstance(value, dict):
        continue
    d=jsonable(value)
    if not isinstance(d, dict):
        continue
    d=dict(d)
    def pop_any(keys, default=''):
        for k in keys:
            if k in d: return d.pop(k)
        return default
    apikey=pop_any(['apikey','api_key','key','token','cookie'], '')
    apikey_text=str(apikey) if apikey is not None else ''
    name=str(pop_any(['name'], '') or '')
    apibase=str(pop_any(['apibase','api_base','base_url','baseURL'], '') or '')
    model=str(pop_any(['model','model_name'], '') or '')
    if 'native' in low and 'claude' in low:
        typ='native_claude'
    elif 'native' in low and 'oai' in low:
        typ='native_oai'
    elif 'claude' in low:
        typ='claude'
    elif 'oai' in low:
        typ='oai'
    else:
        typ='native_oai'
    p={'var_name':var,'source_var_name':var,'type':typ,'name':name,'apibase':apibase,'model':model,'apikey':mask(apikey_text)}
    failover_order=failover_refs.get(var)
    if failover_order is None and name:
        failover_order=failover_refs.get(name)
    if failover_order is not None:
        p['failover_order']=failover_order
        p.update(failover_values)
    for src,dst in [('models','models'),('stream','stream'),('max_retries','max_retries'),('read_timeout','read_timeout'),('connect_timeout','connect_timeout'),('user_agent','user_agent'),('api_mode','api_mode'),('service_tier','service_tier'),('thinking_type','thinking_type'),('reasoning_effort','reasoning_effort'),('fake_cc_system_prompt','fake_cc_system_prompt')]:
        if src in d: p[dst]=d.pop(src)
    if 'timeout' in d:
        p['connect_timeout']=d.pop('timeout')
    instance_id=model_instances.get(var)
    if isinstance(instance_id, str) and instance_id:
        p['instance_id']=instance_id
    p['extra']=d
    p['sort_order']=len(profile_order)
    profiles_by_var[var]=p
    declaration_order_by_var[var]=len(profile_order)
    profile_order.append(var)

def model_configs_of(profile):
    existing=profile.get('model_configs')
    if isinstance(existing, list):
        configs=[]
        for item in existing:
            if isinstance(item, dict) and str(item.get('model', '')).strip():
                configs.append(dict(item))
        if configs:
            return configs
    model=str(profile.get('model', '') or '').strip()
    if not model:
        return []
    config={'model':model}
    for key in ('instance_id','name','sort_order','stream','max_retries','read_timeout','connect_timeout','user_agent','api_mode','service_tier','thinking_type','reasoning_effort','fake_cc_system_prompt','failover_order','failover_max_retries','failover_base_delay','failover_spring_back'):
        if key in profile:
            config[key]=profile[key]
    extra=profile.get('extra')
    if isinstance(extra, dict) and extra:
        config['extra']=dict(extra)
    return [config]

groups=getattr(mod, '_ga_admin_provider_groups', {})
grouped={}
grouped_order=[]
child_to_provider={}
if isinstance(groups, dict):
    for provider, group_meta in groups.items():
        if not isinstance(provider, str) or not provider:
            continue
        meta=group_meta if isinstance(group_meta, dict) else {}
        child_vars=meta.get('children', []) if meta else group_meta
        if not isinstance(child_vars, (list, tuple)):
            continue
        children=[]
        for child_var in child_vars:
            if isinstance(child_var, str) and child_var in profiles_by_var and child_var not in child_to_provider:
                children.append(profiles_by_var[child_var])
        if children:
            base=dict(children[0])
        elif meta:
            base={}
        else:
            continue
        configs=[]
        display_names=meta.get('display_names', {}) if meta else {}
        if not isinstance(display_names, dict):
            display_names={}
        for child in children:
            child_var=str(child.get('var_name', '') or '')
            for config in model_configs_of(child):
                model=str(config.get('model', '')).strip()
                if model:
                    # Read name from config itself (new convention)
                    name_from_config=config.get('name')
                    if isinstance(name_from_config, str) and name_from_config.strip():
                        config['name']=name_from_config.strip()
                    else:
                        # Fallback to legacy display_names metadata for backward compatibility
                        display_name=display_names.get(child_var)
                        if isinstance(display_name, str) and display_name.strip():
                            config['name']=display_name.strip()
                    configs.append(config)
        models=[config['model'] for config in configs]
        base['var_name']=provider
        provider_sort_order=meta.get('provider_sort_order') if meta else None
        if isinstance(provider_sort_order, int) and not isinstance(provider_sort_order, bool):
            base['provider_sort_order']=provider_sort_order
        if children:
            base['source_var_name']=children[0].get('source_var_name', '')
        if meta:
            display_name=str(meta.get('display_name', '') or '').strip()
            base['display_name']=display_name
            base['type']=str(meta.get('type', base.get('type', 'native_oai')) or 'native_oai')
            base['name']=str(meta.get('name', base.get('name', '')) or '')
            base['apibase']=str(meta.get('apibase', base.get('apibase', '')) or '')
            meta_apikey=str(meta.get('apikey', '') or '')
            base['apikey']=mask(meta_apikey)
            if display_name:
                aggregation_key_by_var[provider]=display_name
        base['model']=models[0] if models else ''
        base['models']=models
        base['model_configs']=configs
        grouped[provider]=base
        grouped_order.append(provider)
        for child_var in child_vars:
            if isinstance(child_var, str) and child_var in profiles_by_var:
                child_to_provider[child_var]=provider

profiles=[]
emitted=set()
for var in profile_order:
    provider=child_to_provider.get(var)
    if provider:
        if provider not in emitted:
            profiles.append(grouped[provider])
            emitted.add(provider)
        continue
    profiles.append(profiles_by_var[var])
for provider in grouped_order:
    if provider not in emitted:
        profiles.append(grouped[provider])
        emitted.add(provider)

provider_index={}
merged_profiles=[]
for profile in profiles:
    aggregation_key=aggregation_key_by_var.get(profile.get('var_name'))
    if aggregation_key is None or aggregation_key not in provider_index:
        if aggregation_key is not None:
            provider_index[aggregation_key]=len(merged_profiles)
        merged_profiles.append(profile)
        continue
    base=merged_profiles[provider_index[aggregation_key]]
    configs=[]
    for source in (base, profile):
        for config in model_configs_of(source):
            model=str(config.get('model', '')).strip()
            if model:
                configs.append(config)
    models=[config['model'] for config in configs]
    base['model']=models[0] if models else ''
    base['models']=models
    base['model_configs']=configs
profiles=merged_profiles
for profile in profiles:
    configs=model_configs_of(profile)
    models=[config['model'] for config in configs]
    profile['model']=models[0] if models else ''
    profile['models']=models
    profile['model_configs']=configs

final_by_aggregation_key={}
final_by_var={}
for profile in profiles:
    var_name=profile.get('var_name')
    if isinstance(var_name, str) and var_name:
        final_by_var[var_name]=profile
        aggregation_key=aggregation_key_by_var.get(var_name)
        if aggregation_key is not None:
            final_by_aggregation_key[aggregation_key]=profile
session_targets={}
for source_var, source_profile in profiles_by_var.items():
    provider_var=child_to_provider.get(source_var, source_var)
    aggregation_key=aggregation_key_by_var.get(provider_var)
    final_profile=final_by_aggregation_key.get(aggregation_key) if aggregation_key is not None else None
    if final_profile is None:
        final_profile=final_by_var.get(provider_var) or final_by_var.get(source_var)
    model=str(source_profile.get('model', '') or '').strip()
    final_var=final_profile.get('var_name') if isinstance(final_profile, dict) else ''
    if not isinstance(final_var, str) or not final_var or not model:
        continue
    target={'provider_var_name':final_var, 'model':model}
    instance_id=source_profile.get('instance_id')
    if isinstance(instance_id, str) and instance_id:
        target['instance_id']=instance_id
    session_targets[source_var]=target
    source_name=source_profile.get('name')
    if isinstance(source_name, str) and source_name:
        session_targets[source_name]=target

failover_groups=[]
for mixin_var, mixin_data in mixin_groups_raw:
    refs=mixin_data.get('llm_nos', [])
    members=[]
    unresolved=False
    for ref in refs:
        target=session_targets.get(ref) if isinstance(ref, str) else None
        if target is None:
            unresolved=True
            break
        members.append(dict(target))
    if unresolved or len(members) < 2:
        continue
    max_retries=mixin_data.get('max_retries', 10)
    if not isinstance(max_retries, int) or isinstance(max_retries, bool):
        max_retries=10
    base_delay=mixin_data.get('base_delay', 0.5)
    if not isinstance(base_delay, (int, float)) or isinstance(base_delay, bool):
        base_delay=0.5
    group={'var_name':mixin_var, 'members':members, 'max_retries':max_retries, 'base_delay':base_delay}
    spring_back=mixin_data.get('spring_back')
    if isinstance(spring_back, int) and not isinstance(spring_back, bool):
        group['spring_back']=spring_back
    failover_groups.append(group)
print(json.dumps({'updated_at':'','profiles':profiles,'failover_groups':failover_groups}, ensure_ascii=False))`
	cmd := exec.Command(py, "-c", script, mykey, boolArg(reveal))
	cmd.Env = pythonUTF8Env(os.Environ())
	hideChildWindow(cmd)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return Draft{}, fmt.Errorf("parse mykey.py failed via %s: %v: %s", py, err, strings.TrimSpace(stderr.String()))
	}
	var d Draft
	if err := json.Unmarshal(out, &d); err != nil {
		return Draft{}, err
	}
	if d.UpdatedAt == "" {
		d.UpdatedAt = time.Now().Format(time.RFC3339)
	}
	return d, nil
}

func pythonUTF8Env(env []string) []string {
	result := make([]string, 0, len(env)+2)
	for _, kv := range env {
		key := kv
		if i := strings.IndexByte(kv, '='); i >= 0 {
			key = kv[:i]
		}
		if strings.EqualFold(key, "PYTHONUTF8") || strings.EqualFold(key, "PYTHONIOENCODING") {
			continue
		}
		result = append(result, kv)
	}
	return append(result, "PYTHONUTF8=1", "PYTHONIOENCODING=utf-8")
}

// pythonExe resolves the interpreter used to parse mykey.py.
//
// Resolution is delegated to pyfind so the importer, the Admin API, and the
// goal runner share one order. The previous local copy fell through to a bare
// "python" on Windows, which resolves to the Microsoft Store stub on machines
// without a project venv; that stub exits 9009 without running the script.
func pythonExe(gaRoot, configuredPython string) string {
	return pyfind.Resolve(gaRoot, configuredPython)
}
func boolArg(v bool) string {
	if v {
		return "1"
	}
	return "0"
}

func Render(profiles []Profile) (string, error) {
	return renderWithFailoverGroups(profiles, legacyFailoverGroups(profiles), false)
}

func RenderPreview(profiles []Profile) (string, error) {
	return renderWithFailoverGroups(profiles, legacyFailoverGroups(profiles), true)
}

func RenderWithFailoverGroups(profiles []Profile, groups []FailoverGroup) (string, error) {
	return renderWithFailoverGroups(profiles, groups, false)
}

func RenderPreviewWithFailoverGroups(profiles []Profile, groups []FailoverGroup) (string, error) {
	return renderWithFailoverGroups(profiles, groups, true)
}

func renderWithFailoverGroups(profiles []Profile, groups []FailoverGroup, allowMaskedSecrets bool) (string, error) {
	if err := validateProfiles(profiles, allowMaskedSecrets); err != nil {
		return "", err
	}
	profiles = normalizeProfiles(profiles)
	resolvedGroups, err := resolveFailoverGroups(profiles, groups)
	if err != nil {
		return "", err
	}
	failoverSessionNames := map[string]bool{}
	for _, group := range resolvedGroups {
		for _, sessionName := range group.SessionNames {
			failoverSessionNames[sessionName] = true
		}
	}
	type renderEntry struct {
		profile      Profile
		config       ModelConfig
		localIndex   int
		defaultOrder int
	}
	entries := []renderEntry{}
	providerGroups := map[string]interface{}{}
	defaultOrder := 0
	for _, p := range profiles {
		configs := profileModelConfigs(p)
		childVars := make([]string, 0, len(configs))
		for i, config := range configs {
			sessionName := expandedVarName(p.VarName, i)
			childVars = append(childVars, sessionName)
			entries = append(entries, renderEntry{
				profile:      p,
				config:       config,
				localIndex:   i,
				defaultOrder: defaultOrder,
			})

			defaultOrder++
		}
		groupMeta := map[string]interface{}{
			"children":     childVars,
			"display_name": p.DisplayName,
			"type":         p.Type,
			"name":         p.Name,
			"apibase":      p.APIBase,
			"apikey":       p.APIKey,
		}
		if p.ProviderSortOrder != nil {
			groupMeta["provider_sort_order"] = *p.ProviderSortOrder
		}
		providerGroups[p.VarName] = groupMeta
	}
	sort.SliceStable(entries, func(i, j int) bool {
		left := entries[i].defaultOrder
		right := entries[j].defaultOrder
		if entries[i].config.SortOrder != nil {
			left = *entries[i].config.SortOrder
		}
		if entries[j].config.SortOrder != nil {
			right = *entries[j].config.SortOrder
		}
		return left < right
	})

	// In mykey.py the "name" field is both the human-facing display name and the
	// routing key that mixin_config['llm_nos'] references (see mykey_template.py
	// and llmcore.py MixinSession). Resolve one effective name per session here so
	// the rendered config dict and llm_nos always agree.
	//
	// Failover members claim their names first: an ambiguous name would make
	// MixinSession route to the wrong session, so those must stay unique. Plain
	// sessions may still share a name (several providers can serve the same model
	// id), they just must not shadow a failover member's name.
	effectiveNames := make(map[string]string, len(entries))
	claimedNames := make(map[string]bool, len(entries))
	resolveName := func(entry renderEntry, sessionName string) string {
		if name := strings.TrimSpace(entry.config.Name); name != "" {
			return name
		}
		if model := strings.TrimSpace(entry.config.Model); model != "" {
			return model
		}
		return sessionName
	}
	for _, entry := range entries {
		sessionName := expandedVarName(entry.profile.VarName, entry.localIndex)
		if !failoverSessionNames[sessionName] {
			continue
		}
		name := resolveName(entry, sessionName)
		if claimedNames[name] {
			name = sessionName
		}
		claimedNames[name] = true
		effectiveNames[sessionName] = name
	}
	for _, entry := range entries {
		sessionName := expandedVarName(entry.profile.VarName, entry.localIndex)
		if _, done := effectiveNames[sessionName]; done {
			continue
		}
		name := resolveName(entry, sessionName)
		if claimedNames[name] {
			name = sessionName
		}
		effectiveNames[sessionName] = name
	}

	var b strings.Builder
	b.WriteString("# Auto-generated by GenericAgent-Admin-Go.\n# Review before copying to mykey.py. Keep this file private.\n# GenericAgent discovers official config dicts by variable name: native_claude/native_oai/claude/oai or api/config/cookie.\n\n")
	modelInstances := map[string]interface{}{}
	for _, entry := range entries {
		if instanceID := strings.TrimSpace(entry.config.InstanceID); instanceID != "" {
			modelInstances[expandedVarName(entry.profile.VarName, entry.localIndex)] = instanceID
		}
	}
	for _, entry := range entries {
		p := entry.profile
		config := entry.config
		m := map[string]interface{}{}
		sessionName := expandedVarName(p.VarName, entry.localIndex)
		if name := effectiveNames[sessionName]; name != "" {
			m["name"] = name
		}
		m["apikey"] = p.APIKey
		m["apibase"] = p.APIBase
		m["model"] = config.Model
		if config.Stream != nil {
			m["stream"] = *config.Stream
		}
		if config.MaxRetries != nil {
			m["max_retries"] = *config.MaxRetries
		}
		if config.ReadTimeout != nil {
			m["read_timeout"] = *config.ReadTimeout
		}
		if config.ConnectTimeout != nil {
			m["timeout"] = *config.ConnectTimeout
		}
		if config.UserAgent != "" {
			m["user_agent"] = config.UserAgent
		}
		if config.APIMode != "" {
			m["api_mode"] = config.APIMode
		}
		if config.ServiceTier != "" {
			m["service_tier"] = config.ServiceTier
		}
		if config.ThinkingType != "" {
			m["thinking_type"] = config.ThinkingType
		}
		if config.ReasoningEffort != "" {
			m["reasoning_effort"] = config.ReasoningEffort
		}
		if config.FakeCCSystemPrompt != nil {
			m["fake_cc_system_prompt"] = bool(*config.FakeCCSystemPrompt)
		}
		for k, v := range config.Extra {
			if _, ok := m[k]; !ok {
				m[k] = v
			}
		}
		dict, err := pyDict(m)
		if err != nil {
			return "", err
		}
		b.WriteString(fmt.Sprintf("%s = %s\n\n", expandedVarName(p.VarName, entry.localIndex), dict))
	}
	modelInstancesDict, err := pyDict(modelInstances)
	if err != nil {
		return "", err
	}
	b.WriteString(fmt.Sprintf("# Admin-only model instance metadata; GenericAgent ignores underscore-prefixed variables.\n_ga_admin_model_instances = %s\n", modelInstancesDict))
	providerGroupsDict, err := pyDict(providerGroups)
	if err != nil {
		return "", err
	}
	b.WriteString(fmt.Sprintf("# Admin-only provider grouping metadata; GenericAgent ignores underscore-prefixed variables.\n_ga_admin_provider_groups = %s\n", providerGroupsDict))
	for _, group := range resolvedGroups {
		// Map session names to their effective display names for llm_nos routing
		llmNos := make([]string, len(group.SessionNames))
		for i, sessionName := range group.SessionNames {
			if name, ok := effectiveNames[sessionName]; ok && name != "" {
				llmNos[i] = name
			} else {
				llmNos[i] = sessionName
			}
		}
		mixin := map[string]interface{}{
			"llm_nos":     llmNos,
			"max_retries": group.MaxRetries,
			"base_delay":  group.BaseDelay,
		}
		if group.SpringBack != nil {
			mixin["spring_back"] = *group.SpringBack
		}
		mixinDict, err := pyDict(mixin)
		if err != nil {
			return "", err
		}
		b.WriteString(fmt.Sprintf("\n%s = %s\n", group.VarName, mixinDict))
	}
	return b.String(), nil
}

func pyDict(m map[string]interface{}) (string, error) {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := []string{}
	for _, k := range keys {
		val, err := pyVal(m[k])
		if err != nil {
			return "", fmt.Errorf("render %q: %w", k, err)
		}
		parts = append(parts, fmt.Sprintf("%q: %s", k, val))
	}
	return "{" + strings.Join(parts, ", ") + "}", nil
}
func pyVal(v interface{}) (string, error) {
	switch x := v.(type) {
	case string:
		return fmt.Sprintf("%q", x), nil
	case bool:
		if x {
			return "True", nil
		}
		return "False", nil
	case float64:
		return fmt.Sprintf("%v", x), nil
	case int:
		return fmt.Sprintf("%d", x), nil
	case []string:
		parts := make([]string, len(x))
		for i, item := range x {
			parts[i] = fmt.Sprintf("%q", item)
		}
		return "[" + strings.Join(parts, ", ") + "]", nil
	case nil:
		return "None", nil
	default:
		data, err := json.Marshal(x)
		if err != nil {
			return "", err
		}
		return string(data), nil
	}
}

func sourceVarNamesToRemove(profiles []Profile) ([]string, error) {
	seen := map[string]bool{}
	varNames := make([]string, 0, len(profiles))
	for _, p := range profiles {
		name := strings.TrimSpace(p.SourceVarName)
		if name == "" || seen[name] {
			continue
		}
		if !nameRe.MatchString(name) {
			return nil, fmt.Errorf("invalid source_var_name: %s", name)
		}
		seen[name] = true
		varNames = append(varNames, name)
	}
	sort.Strings(varNames)
	return varNames, nil
}

type sourceAssignmentRange struct {
	Name  string `json:"name"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

type sourceAssignmentResult struct {
	Names   []string                `json:"names"`
	Ranges  []sourceAssignmentRange `json:"ranges"`
	Missing []string                `json:"missing"`
}

const sourceAssignmentRangesScript = `import ast, json, sys
names=json.loads(sys.argv[1])
raw=sys.stdin.buffer.read()
try:
    source=raw.decode('utf-8')
except UnicodeDecodeError as exc:
    raise RuntimeError(f'mykey.py is not valid UTF-8: {exc}')
try:
    tree=ast.parse(source, filename='mykey.py')
except SyntaxError as exc:
    raise RuntimeError(f'mykey.py syntax error at line {exc.lineno}: {exc.msg}')

# Every top-level variable whose name contains "mixin" belongs to the GA
# failover surface. Discover it from the AST so deleting or renaming a group
# removes the previous declaration even when the caller no longer knows its
# name.
requested=set(names)

lines=raw.splitlines(keepends=True)
line_starts=[]
offset=0
for line in lines:
    line_starts.append(offset)
    offset += len(line)

def bound_names(target):
    return {node.id for node in ast.walk(target) if isinstance(node, ast.Name)}

for node in tree.body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            requested.update(name for name in bound_names(target) if 'mixin' in name)
    elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
        requested.update(name for name in bound_names(node.target) if 'mixin' in name)
names=sorted(requested)

def node_range(node):
    if getattr(node, 'end_lineno', None) is None or getattr(node, 'end_col_offset', None) is None:
        raise RuntimeError('Python AST does not expose assignment end positions')
    if node.lineno < 1 or node.end_lineno > len(lines):
        raise RuntimeError('assignment position is outside mykey.py')
    return (
        line_starts[node.lineno - 1] + node.col_offset,
        line_starts[node.end_lineno - 1] + node.end_col_offset,
    )

def line_content_end(line_number):
    line=lines[line_number - 1]
    size=len(line)
    if line.endswith(b'\r\n'):
        size -= 2
    elif line.endswith((b'\r', b'\n')):
        size -= 1
    return line_starts[line_number - 1] + size

hits={name: [] for name in names}
unsafe=set()
for node in tree.body:
    if isinstance(node, ast.Assign):
        assigned=set()
        for target in node.targets:
            assigned.update(bound_names(target))
        for name in assigned.intersection(hits):
            if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == name:
                hits[name].append(node)
            else:
                unsafe.add(name)
    elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
        for name in bound_names(node.target).intersection(hits):
            unsafe.add(name)

ranges=[]
missing=[]
for name in names:
    if name in unsafe:
        raise RuntimeError(f'{name} is not a standalone single-target assignment')
    if len(hits[name]) == 0:
        missing.append(name)
        continue
    if len(hits[name]) != 1:
        raise RuntimeError(f'multiple top-level assignments found for {name}')
    node=hits[name][0]
    start, end=node_range(node)
    prefix=raw[line_starts[node.lineno - 1]:start]
    suffix=raw[end:line_content_end(node.end_lineno)]
    suffix_without_space=suffix.lstrip(b' \t\f')
    if prefix.strip(b' \t\f') or (suffix_without_space and not suffix_without_space.startswith(b'#')):
        raise RuntimeError(f'{name} shares a physical line with other code')
    if start < 0 or end <= start or end > len(raw):
        raise RuntimeError(f'invalid source range for {name}')
    ranges.append({'name': name, 'start': start, 'end': end})
print(json.dumps({'names': names, 'ranges': ranges, 'missing': missing}, separators=(',', ':')))`

func stripExplicitSourceAssignments(gaRoot string, content []byte, profiles []Profile) ([]byte, error) {
	varNames, err := sourceVarNamesToRemove(profiles)
	if err != nil {
		return nil, err
	}
	// The AST helper also discovers every top-level variable whose name contains
	// "mixin", so deleting or renaming a failover group removes its old source
	// assignment even though it is absent from the new request.
	if len(varNames) == 0 && !bytes.Contains(content, []byte("mixin")) {
		return append([]byte(nil), content...), nil
	}
	namesJSON, err := json.Marshal(varNames)
	if err != nil {
		return nil, err
	}
	py := pythonExe(gaRoot, "")
	cmd := exec.Command(py, "-c", sourceAssignmentRangesScript, string(namesJSON))
	hideChildWindow(cmd)
	cmd.Stdin = bytes.NewReader(content)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("locate previous model assignments via %s: %v: %s", py, err, strings.TrimSpace(stderr.String()))
	}
	var result sourceAssignmentResult
	if err := json.Unmarshal(out, &result); err != nil {
		return nil, fmt.Errorf("decode previous model assignment ranges: %w", err)
	}
	requested := make(map[string]bool, len(varNames))
	for _, name := range varNames {
		requested[name] = true
	}
	expected := make(map[string]bool, len(result.Names))
	for _, name := range result.Names {
		if expected[name] || !nameRe.MatchString(name) {
			return nil, fmt.Errorf("unexpected discovered previous model assignment %q", name)
		}
		expected[name] = true
	}
	for name := range requested {
		if !expected[name] {
			return nil, fmt.Errorf("missing requested previous model assignment classification for %q", name)
		}
	}
	seen := make(map[string]bool, len(expected))
	for _, name := range result.Missing {
		if !expected[name] || seen[name] {
			return nil, fmt.Errorf("unexpected missing previous model assignment for %q", name)
		}
		seen[name] = true
	}
	sort.Slice(result.Ranges, func(i, j int) bool { return result.Ranges[i].Start > result.Ranges[j].Start })
	nextStart := len(content)
	for _, item := range result.Ranges {
		if !expected[item.Name] || seen[item.Name] {
			return nil, fmt.Errorf("unexpected previous model assignment range for %q", item.Name)
		}
		if item.Start < 0 || item.End <= item.Start || item.End > nextStart {
			return nil, fmt.Errorf("invalid or overlapping previous model assignment range for %q", item.Name)
		}
		seen[item.Name] = true
		nextStart = item.Start
	}
	if len(seen) != len(expected) {
		return nil, fmt.Errorf("located or classified %d previous model assignments, want %d", len(seen), len(expected))
	}
	cleaned := append([]byte(nil), content...)
	for _, item := range result.Ranges {
		cleaned = append(cleaned[:item.Start], cleaned[item.End:]...)
	}
	return cleaned, nil
}

func stripManagedModels(content string) (string, error) {
	begins := managedModelsBeginRe.FindAllStringIndex(content, -1)
	ends := managedModelsEndRe.FindAllStringIndex(content, -1)
	if len(begins) == 0 && len(ends) == 0 {
		return content, nil
	}
	if len(begins) != 1 || len(ends) != 1 || begins[0][0] >= ends[0][0] {
		return "", fmt.Errorf("mykey.py has malformed GA Admin managed model block markers")
	}
	end := ends[0][1]
	if end < len(content) && content[end] == '\n' {
		end++
	}
	return content[:begins[0][0]] + content[end:], nil
}

func stripLegacyRenderedModels(content string) string {
	firstEnd := strings.IndexByte(content, '\n')
	firstLine := content
	if firstEnd >= 0 {
		firstLine = content[:firstEnd]
	}
	firstLine = strings.TrimSuffix(firstLine, "\r")
	if firstLine != legacyRenderedHeader {
		return content
	}
	group := legacyProviderGroupsRe.FindStringIndex(content)
	if group == nil {
		return content
	}
	end := group[1]
	if end < len(content) && content[end] == '\n' {
		end++
	}
	return content[end:]
}

func mergeRenderedModels(existing, rendered string, profiles []Profile) (string, error) {
	base, err := stripManagedModels(existing)
	if err != nil {
		return "", err
	}
	base = stripLegacyRenderedModels(base)
	base = strings.TrimRight(base, " \t\r\n")

	var b strings.Builder
	if base != "" {
		b.WriteString(base)
		b.WriteString("\n\n")
	}
	b.WriteString(managedModelsBegin)
	b.WriteByte('\n')
	b.WriteString("# Model saves replace only this block; settings outside it remain user-managed.\n")
	b.WriteString(strings.TrimSpace(rendered))
	b.WriteByte('\n')
	b.WriteString(managedModelsEnd)
	b.WriteByte('\n')
	return b.String(), nil
}

func Export(gaRoot string, profiles []Profile, overwriteActive bool) (map[string]interface{}, error) {
	return ExportWithFailoverGroups(gaRoot, profiles, legacyFailoverGroups(profiles), overwriteActive)
}

func ExportWithFailoverGroups(gaRoot string, profiles []Profile, groups []FailoverGroup, overwriteActive bool) (map[string]interface{}, error) {
	if err := validateExportRoot(gaRoot); err != nil {
		return nil, err
	}
	rendered, err := RenderWithFailoverGroups(profiles, groups)
	if err != nil {
		return nil, err
	}
	active := filepath.Join(gaRoot, "mykey.py")
	var existing []byte
	if exists(active) {
		existing, err = os.ReadFile(active)
		if err != nil {
			return nil, err
		}
	}
	base, err := stripManagedModels(string(existing))
	if err != nil {
		return nil, err
	}
	base = stripLegacyRenderedModels(base)
	cleanedExisting, err := stripExplicitSourceAssignments(gaRoot, []byte(base), profiles)
	if err != nil {
		return nil, err
	}
	text, err := mergeRenderedModels(string(cleanedExisting), rendered, profiles)
	if err != nil {
		return nil, err
	}
	res := map[string]interface{}{"activated": true, "active_path": active, "saved_path": active, "backup_path": nil}
	if existing != nil {
		bak := filepath.Join(gaRoot, fmt.Sprintf("mykey.py.bak-%s", time.Now().Format("20060102-150405")))
		if err := writeFileAtomic(bak, existing, 0600); err != nil {
			return nil, err
		}
		res["backup_path"] = bak
	}
	if err := writeFileAtomic(active, []byte(text), 0600); err != nil {
		return nil, err
	}
	return res, nil
}
