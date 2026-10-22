package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os/exec"
	"sort"
	"strconv"
	"strings"

	"genericagent-admin-go/internal/config"
	"genericagent-admin-go/internal/modelconfig"
)

func chatPythonForConfig(cfg config.AppConfig) string {
	// Chat must honor the Python selected during setup. Falling back to a bare
	// launcher can miss GA dependencies (for example requests) and hide models.
	// With nothing configured, borrow a sibling instance's interpreter rather
	// than trusting a path that merely exists.
	return resolveUsablePythonForRoot(cfg.GARoot, cfg.PythonPath, cfg.PythonFallbackRoots)
}

func (s *Server) listGARuntimeLLMs(cfg config.AppConfig) ([]map[string]interface{}, error) {
	root := cfg.GARoot
	py := chatPythonForConfig(cfg)
	code := `import json, os, sys
root = sys.argv[1]
if root not in sys.path:
    sys.path.insert(0, root)
os.chdir(root)
from agentmain import GenericAgent
agent = GenericAgent()
items = []
for idx, label, active in agent.list_llms():
    text = str(label)
    client = agent.llmclients[int(idx)]
    backend = client.backend
    name = str(getattr(backend, 'name', '') or '')
    model = str(getattr(backend, 'model', '') or '')
    provider = type(backend).__name__
    items.append({'index': int(idx), 'label': text, 'name': name, 'provider': provider, 'model': model, 'active': bool(active)})
print(json.dumps(items, ensure_ascii=False))`
	cmd := exec.Command(py, "-c", code, root)
	cmd.Dir = root
	hideChildWindow(cmd)
	cmd.Env = pythonEnvWithAdminProxy(cfg, "PYTHONUNBUFFERED=1", "PYTHONUTF8=1", "PYTHONIOENCODING=utf-8")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return []map[string]interface{}{}, &chatLLMListError{Stage: "list GA LLMs failed", Python: py, Root: root, Output: string(out), Err: err}
	}
	clean := bytes.TrimSpace(out)
	llms, parseErr := parseLLMJSONArrayFromMixedOutput(clean)
	if parseErr != nil {
		return []map[string]interface{}{}, &chatLLMListError{Stage: "parse GA LLMs failed", Python: py, Root: root, Output: string(out), Err: parseErr}
	}
	if draft, importErr := s.loadModelsFromOfficialMyKey(false); importErr == nil {
		annotateChatLLMProviders(llms, draft.Profiles)
		annotateChatLLMFailoverGroups(llms, draft.FailoverGroups)
	}
	return llms, nil
}

type chatProviderModel struct {
	providerOrder   int
	provider        string
	model           string
	displayName     string
	reasoningEffort string
	order           int
	sequence        int
}

func annotateChatLLMProviders(llms []map[string]interface{}, profiles []modelconfig.Profile) {
	configured := make([]chatProviderModel, 0)
	sequence := 0
	for profileIndex, profile := range profiles {
		providerOrder := profileIndex
		if profile.ProviderSortOrder != nil {
			providerOrder = *profile.ProviderSortOrder
		}
		provider := chatProviderDisplayName(profile)
		configs := profile.ModelConfigs
		if len(configs) == 0 {
			configs = make([]modelconfig.ModelConfig, 0, len(profile.Models))
			for _, model := range profile.Models {
				configs = append(configs, modelconfig.ModelConfig{Model: model})
			}
		}
		for _, config := range configs {
			model := strings.TrimSpace(config.Model)
			if model == "" {
				continue
			}
			order := int(^uint(0) >> 1)
			if config.SortOrder != nil {
				order = *config.SortOrder
			}
			configured = append(configured, chatProviderModel{
				providerOrder:   providerOrder,
				provider:        provider,
				model:           model,
				displayName:     strings.TrimSpace(config.Name),
				reasoningEffort: strings.ToLower(strings.TrimSpace(config.ReasoningEffort)),
				order:           order,
				sequence:        sequence,
			})
			sequence++
		}
	}
	sort.SliceStable(configured, func(i, j int) bool {
		if configured[i].order == configured[j].order {
			return configured[i].sequence < configured[j].sequence
		}
		return configured[i].order < configured[j].order
	})

	used := make([]bool, len(configured))
	unresolved := make([]int, 0)
	for i, item := range llms {
		if isChatLLMFailover(item) {
			continue
		}
		model := chatLLMModel(item)
		if i < len(configured) && (model == "" || configured[i].model == model) {
			applyChatProviderModel(item, configured[i])
			used[i] = true
			continue
		}
		unresolved = append(unresolved, i)
	}
	for _, llmIndex := range unresolved {
		item := llms[llmIndex]
		model := chatLLMModel(item)
		for configuredIndex, candidate := range configured {
			if used[configuredIndex] || candidate.model != model {
				continue
			}
			applyChatProviderModel(item, candidate)
			used[configuredIndex] = true
			break
		}
	}
}

func isChatLLMFailover(item map[string]interface{}) bool {
	return strings.EqualFold(strings.TrimSpace(fmt.Sprint(item["provider"])), "MixinSession")
}

func annotateChatLLMFailoverGroups(llms []map[string]interface{}, groups []modelconfig.FailoverGroup) {
	groupIndex := 0
	for _, item := range llms {
		if !isChatLLMFailover(item) || groupIndex >= len(groups) {
			continue
		}
		group := groups[groupIndex]
		name := strings.TrimSpace(group.VarName)
		groupIndex++
		name = strings.TrimPrefix(name, "mixin_config_")
		if name != "" {
			item["failover_group"] = name
		}
		label := strings.TrimSpace(group.DisplayName)
		if label == "" {
			label = name
		}
		if label != "" {
			item["label"] = label
		}
	}
}

func applyChatProviderModel(item map[string]interface{}, configured chatProviderModel) {
	item["provider"] = configured.provider
	item["provider_sort_order"] = configured.providerOrder
	if configured.reasoningEffort != "" {
		item["reasoning_effort"] = configured.reasoningEffort
	}
	if chatLLMModel(item) == "" {
		item["model"] = configured.model
	}
	if configured.displayName != "" {
		item["label"] = configured.displayName
	} else {
		// fallback to name when display_name is empty
		if name, ok := item["name"].(string); ok && strings.TrimSpace(name) != "" {
			item["label"] = name
		}
	}
}

func chatLLMModel(item map[string]interface{}) string {
	value, ok := item["model"]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func chatProviderDisplayName(profile modelconfig.Profile) string {
	if displayName := strings.TrimSpace(profile.DisplayName); displayName != "" {
		return displayName
	}
	name := strings.TrimSpace(profile.VarName)
	for _, prefix := range []string{"native_oai_config", "native_claude_config", "oai_config", "claude_config"} {
		if strings.HasPrefix(name, prefix) {
			name = strings.TrimPrefix(name, prefix)
			name = strings.TrimPrefix(name, "_")
			break
		}
	}
	if name != "" {
		return name
	}
	return "Unknown provider"
}

func parseLLMJSONArrayFromMixedOutput(out []byte) ([]map[string]interface{}, error) {
	var lastErr error
	for start := bytes.IndexByte(out, '['); start >= 0; {
		var llms []map[string]interface{}
		dec := json.NewDecoder(bytes.NewReader(out[start:]))
		if err := dec.Decode(&llms); err == nil {
			return llms, nil
		} else {
			lastErr = err
		}
		next := bytes.IndexByte(out[start+1:], '[')
		if next < 0 {
			break
		}
		start += next + 1
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("no JSON array found")
}

func markChatLLMActive(llms []map[string]interface{}, llmNo int) {
	for _, item := range llms {
		idx, ok := chatLLMIndex(item["index"])
		item["active"] = ok && idx == llmNo
	}
}

func chatLLMIndex(v interface{}) (int, bool) {
	switch x := v.(type) {
	case int:
		return x, true
	case int8:
		return int(x), true
	case int16:
		return int(x), true
	case int32:
		return int(x), true
	case int64:
		return int(x), true
	case uint:
		return int(x), true
	case uint8:
		return int(x), true
	case uint16:
		return int(x), true
	case uint32:
		return int(x), true
	case uint64:
		return int(x), true
	case float32:
		return int(x), true
	case float64:
		return int(x), true
	case json.Number:
		n, err := x.Int64()
		if err != nil {
			return 0, false
		}
		return int(n), true
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(x))
		if err != nil {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}
