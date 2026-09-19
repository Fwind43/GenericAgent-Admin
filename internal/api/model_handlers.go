package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"genericagent-admin-go/internal/config"
	"genericagent-admin-go/internal/modelconfig"
)

type chatTitleModelOption struct {
	ProviderVarName     string `json:"provider_var_name"`
	ProviderDisplayName string `json:"provider_display_name,omitempty"`
	Model               string `json:"model"`
	LLMNo               int    `json:"llm_no"`
}

func orderedChatTitleModelOptions(profiles []modelconfig.Profile) []chatTitleModelOption {
	type orderedOption struct {
		chatTitleModelOption
		order    int
		sequence int
	}
	rows := make([]orderedOption, 0)
	sequence := 0
	for _, profile := range profiles {
		configs := profile.ModelConfigs
		if len(configs) == 0 {
			models := profile.Models
			if len(models) == 0 && strings.TrimSpace(profile.Model) != "" {
				models = []string{profile.Model}
			}
			configs = make([]modelconfig.ModelConfig, 0, len(models))
			for _, model := range models {
				configs = append(configs, modelconfig.ModelConfig{Model: model})
			}
		}
		for _, modelConfig := range configs {
			model := strings.TrimSpace(modelConfig.Model)
			if model == "" {
				continue
			}
			order := sequence
			if modelConfig.SortOrder != nil {
				order = *modelConfig.SortOrder
			}
			rows = append(rows, orderedOption{
				chatTitleModelOption: chatTitleModelOption{
					ProviderVarName:     strings.TrimSpace(profile.VarName),
					ProviderDisplayName: strings.TrimSpace(profile.DisplayName),
					Model:               model,
				},
				order:    order,
				sequence: sequence,
			})
			sequence++
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].order != rows[j].order {
			return rows[i].order < rows[j].order
		}
		return rows[i].sequence < rows[j].sequence
	})
	options := make([]chatTitleModelOption, len(rows))
	for i, row := range rows {
		row.LLMNo = i
		options[i] = row.chatTitleModelOption
	}
	return options
}

func resolveChatTitleModel(ref *config.ChatTitleModelRef, options []chatTitleModelOption) (*config.ChatTitleModelRef, bool) {
	if ref == nil {
		return nil, true
	}
	provider := strings.TrimSpace(ref.ProviderVarName)
	model := strings.TrimSpace(ref.Model)
	// Empty provider+model means "follow the conversation model"; it is a valid
	// selection that carries no routing target, so it never appears in options.
	if provider == "" && model == "" {
		return &config.ChatTitleModelRef{Enable: ref.Enable}, true
	}
	for _, option := range options {
		if option.ProviderVarName == provider && option.Model == model {
			return &config.ChatTitleModelRef{
				Enable:          ref.Enable,
				ProviderVarName: option.ProviderVarName,
				Model:           option.Model,
				LLMNo:           option.LLMNo,
			}, true
		}
	}
	return nil, false
}

func (s *Server) reconcileChatTitleModel(profiles []modelconfig.Profile) error {
	// Instance-scoped model requests use an in-memory derived config store.
	// Chat title selection is Admin-wide, so model-file edits must not rewrite it.
	if s.BaseCfgStore != nil && s.BaseCfgStore != s.CfgStore {
		return nil
	}
	current := s.CfgStore.Snapshot().ChatTitleModel
	if current == nil {
		return nil
	}
	resolved, _ := resolveChatTitleModel(current, orderedChatTitleModelOptions(profiles))
	if resolved != nil &&
		resolved.ProviderVarName == current.ProviderVarName &&
		resolved.Model == current.Model &&
		resolved.LLMNo == current.LLMNo {
		return nil
	}
	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()
	cfg := s.CfgStore.Snapshot()
	cfg.ChatTitleModel = resolved
	return s.CfgStore.Save(cfg)
}

func (s *Server) modelsTitleModel(w http.ResponseWriter, r *http.Request) {
	d, err := s.loadModelsFromOfficialMyKey(false)
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	options := orderedChatTitleModelOptions(d.Profiles)
	if r.Method == http.MethodGet {
		resolved, _ := resolveChatTitleModel(s.CfgStore.Snapshot().ChatTitleModel, options)
		writeJSON(w, map[string]interface{}{"model": resolved, "options": options})
		return
	}
	if r.Method != http.MethodPut {
		bad(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Model *config.ChatTitleModelRef `json:"model"`
	}
	if err := decode(r, &req); err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	resolved, found := resolveChatTitleModel(req.Model, options)
	if !found {
		bad(w, http.StatusBadRequest, "selected title model is not present in the saved model configuration")
		return
	}
	s.ConfigMu.Lock()
	cfg := s.CfgStore.Snapshot()
	cfg.ChatTitleModel = resolved
	err = s.CfgStore.Save(cfg)
	s.ConfigMu.Unlock()
	if err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"model": resolved, "options": options})
}

func (s *Server) models(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		d, err := s.loadModelsFromOfficialMyKey(false)
		if err != nil {
			bad(w, 500, err.Error())
			return
		}
		writeJSON(w, map[string]interface{}{"profiles": d.Profiles, "failover_groups": d.FailoverGroups, "updated_at": d.UpdatedAt, "source": modelconfig.SourceStatus(s.CfgStore.Snapshot().GARoot)})
		return
	}
	if r.Method == "PUT" {
		if !requireDangerousHeader(w, r) {
			return
		}
		var p struct {
			Profiles       []modelconfig.Profile       `json:"profiles"`
			FailoverGroups []modelconfig.FailoverGroup `json:"failover_groups"`
		}
		if err := decode(r, &p); err != nil {
			bad(w, 400, err.Error())
			return
		}
		profiles, err := s.mergeModelSecretsForWrite(p.Profiles)
		if err != nil {
			bad(w, 400, err.Error())
			return
		}
		if _, err := modelconfig.ExportWithFailoverGroups(s.CfgStore.Snapshot().GARoot, profiles, p.FailoverGroups, true); err != nil {
			bad(w, 400, err.Error())
			return
		}
		d, err := s.loadModelsFromOfficialMyKey(false)
		if err != nil {
			bad(w, 500, err.Error())
			return
		}
		if err := s.reconcileChatTitleModel(d.Profiles); err != nil {
			bad(w, http.StatusInternalServerError, err.Error())
			return
		}
		s.invalidateGARuntimeLLMs(s.CfgStore.Snapshot())
		writeJSON(w, d)
		return
	}
	bad(w, http.StatusMethodNotAllowed, "method not allowed")
}

func (s *Server) modelsRaw(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requireDangerousHeader(w, r) {
		return
	}
	d, err := s.loadModelsFromOfficialMyKey(true)
	if err != nil {
		bad(w, 500, err.Error())
		return
	}
	writeJSON(w, d)
}

func (s *Server) loadModelsFromOfficialMyKey(reveal bool) (modelconfig.Draft, error) {
	return modelconfig.ImportMyKeyWithPython(s.CfgStore.Snapshot().GARoot, s.CfgStore.Snapshot().PythonPath, reveal)
}

func (s *Server) mergeModelSecretsForWrite(profiles []modelconfig.Profile) ([]modelconfig.Profile, error) {
	return s.mergeModelSecretsForWriteByPreviousVar(profiles, nil)
}

func (s *Server) mergeModelSecretsForWriteByPreviousVar(profiles []modelconfig.Profile, previousVarNames []string) ([]modelconfig.Profile, error) {
	merged := make([]modelconfig.Profile, len(profiles))
	copy(merged, profiles)
	if s == nil || s.CfgStore == nil || strings.TrimSpace(s.CfgStore.Snapshot().GARoot) == "" {
		return merged, nil
	}
	imported, err := modelconfig.ImportMyKeyWithPython(s.CfgStore.Snapshot().GARoot, s.CfgStore.Snapshot().PythonPath, true)
	if err != nil {
		return merged, nil
	}
	byVar := map[string]string{}
	byProtoBase := map[string]string{} // fallback: "type|apibase" -> first real key found
	for _, p := range imported.Profiles {
		name := strings.TrimSpace(p.VarName)
		key := strings.TrimSpace(p.APIKey)
		if key == "" || modelconfig.IsMaskedSecret(key) {
			continue
		}
		if name != "" {
			byVar[name] = key
		}
		pbk := strings.ToLower(strings.TrimSpace(p.Type)) + "|" + strings.TrimRight(strings.TrimSpace(p.APIBase), "/")
		if _, exists := byProtoBase[pbk]; !exists {
			byProtoBase[pbk] = key
		}
	}
	if len(byVar) == 0 && len(byProtoBase) == 0 {
		return merged, nil
	}
	for i := range merged {
		key := strings.TrimSpace(merged[i].APIKey)
		if key != "" && !modelconfig.IsMaskedSecret(key) {
			continue // already has a real key, skip
		}
		// An explicit previous variable identity is used first for atomic renames.
		if i < len(previousVarNames) {
			if oldKey := byVar[strings.TrimSpace(previousVarNames[i])]; oldKey != "" {
				merged[i].APIKey = oldKey
				continue
			}
		}
		// primary: match by VarName
		if oldKey := byVar[strings.TrimSpace(merged[i].VarName)]; oldKey != "" {
			merged[i].APIKey = oldKey
			continue
		}
		// fallback: match by (protocol + apibase) — handles profiles added from
		// the discovery list which inherit a masked key but get a new var_name
		pbk := strings.ToLower(strings.TrimSpace(merged[i].Type)) + "|" + strings.TrimRight(strings.TrimSpace(merged[i].APIBase), "/")
		if oldKey := byProtoBase[pbk]; oldKey != "" {
			merged[i].APIKey = oldKey
		}
	}
	return merged, nil
}

func (s *Server) modelsPreview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var p struct {
		Profiles       []modelconfig.Profile       `json:"profiles"`
		FailoverGroups []modelconfig.FailoverGroup `json:"failover_groups"`
	}
	if err := decode(r, &p); err != nil {
		bad(w, 400, err.Error())
		return
	}
	txt, err := modelconfig.RenderPreviewWithFailoverGroups(p.Profiles, p.FailoverGroups)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	writeJSON(w, map[string]string{"python": txt})
}

type discoveredModel struct {
	ID      string `json:"id"`
	OwnedBy string `json:"owned_by,omitempty"`
}

var errInvalidModelBaseURL = errors.New("invalid base_url: must be an http(s) URL")

func (s *Server) modelsDiscover(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		bad(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	protocol := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("protocol")))
	if protocol == "" {
		protocol = "native_oai"
	}
	isClaude := false
	switch protocol {
	case "native_oai", "oai", "openai", "openai-compatible", "chatgpt":
		// These protocols use OpenAI-compatible /models discovery.
	case "native_claude", "claude":
		isClaude = true
	default:
		bad(w, http.StatusBadRequest, "model discovery supports official OAI and Claude protocols only")
		return
	}
	baseURL := strings.TrimSpace(r.URL.Query().Get("base_url"))
	if baseURL == "" {
		baseURL = strings.TrimSpace(r.URL.Query().Get("apibase"))
	}
	if baseURL == "" {
		bad(w, http.StatusBadRequest, "base_url is required")
		return
	}
	endpoints, err := modelDiscoveryEndpoints(baseURL, isClaude)
	if err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	apiKey, err := s.resolveModelDiscoveryAPIKey(r)
	if err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	client := &http.Client{Timeout: 12 * time.Second}
	authHeaders := modelDiscoveryAuthHeaders(apiKey, isClaude)
	var lastErr error
	var lastMsg string
	for _, endpoint := range endpoints {
		for i, auth := range authHeaders {
			req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint, nil)
			if err != nil {
				bad(w, http.StatusBadRequest, err.Error())
				return
			}
			req.Header.Set("Accept", "application/json")
			for k, v := range auth {
				req.Header.Set(k, v)
			}
			resp, err := client.Do(req)
			if err != nil {
				lastErr = err
				continue
			}
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
			resp.Body.Close()
			if resp.StatusCode < 200 || resp.StatusCode >= 300 {
				msg := strings.TrimSpace(string(body))
				if msg == "" {
					msg = resp.Status
				}
				lastMsg = msg
				if isClaude && resp.StatusCode != http.StatusUnauthorized && resp.StatusCode != http.StatusForbidden {
					break
				}
				if i == len(authHeaders)-1 {
					break
				}
				continue
			}
			var payload struct {
				Data []struct {
					ID      string `json:"id"`
					OwnedBy string `json:"owned_by"`
				} `json:"data"`
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				lastErr = err
				lastMsg = "invalid models response from " + endpoint + ": " + err.Error()
				break
			}
			models := make([]discoveredModel, 0, len(payload.Data))
			seen := map[string]bool{}
			for _, item := range payload.Data {
				id := strings.TrimSpace(item.ID)
				if id == "" || seen[id] {
					continue
				}
				seen[id] = true
				models = append(models, discoveredModel{ID: id, OwnedBy: item.OwnedBy})
			}
			writeJSON(w, map[string]interface{}{"endpoint": endpoint, "models": models, "count": len(models)})
			return
		}
	}
	if lastMsg != "" {
		bad(w, http.StatusBadGateway, lastMsg)
		return
	}
	if lastErr != nil {
		bad(w, http.StatusBadGateway, lastErr.Error())
		return
	}
	bad(w, http.StatusBadGateway, "model discovery failed")
}

func (s *Server) resolveModelDiscoveryAPIKey(r *http.Request) (string, error) {
	apiKey := strings.TrimSpace(r.URL.Query().Get("api_key"))
	if apiKey != "" && !modelconfig.IsMaskedSecret(apiKey) {
		return apiKey, nil
	}
	varName := strings.TrimSpace(r.URL.Query().Get("var_name"))
	if varName == "" {
		return apiKey, nil
	}
	if s != nil && s.CfgStore != nil && strings.TrimSpace(s.CfgStore.Snapshot().GARoot) != "" {
		d, err := modelconfig.ImportMyKeyWithPython(s.CfgStore.Snapshot().GARoot, s.CfgStore.Snapshot().PythonPath, true)
		if err != nil {
			return "", err
		}
		for _, p := range d.Profiles {
			if p.VarName == varName && strings.TrimSpace(p.APIKey) != "" && !modelconfig.IsMaskedSecret(p.APIKey) {
				return strings.TrimSpace(p.APIKey), nil
			}
		}
	}
	if apiKey == "" {
		return "", nil
	}
	return "", errors.New("masked api_key cannot be used for discovery without a mykey.py secret for var_name")
}

func modelDiscoveryAuthHeaders(apiKey string, isClaude bool) []map[string]string {
	if isClaude {
		base := map[string]string{"anthropic-version": "2023-06-01"}
		if apiKey == "" {
			return []map[string]string{base}
		}
		return []map[string]string{
			{"anthropic-version": "2023-06-01", "x-api-key": apiKey},
			{"anthropic-version": "2023-06-01", "Authorization": "Bearer " + apiKey},
		}
	}
	if apiKey == "" {
		return []map[string]string{{}}
	}
	return []map[string]string{{"Authorization": "Bearer " + apiKey}}
}

func modelDiscoveryEndpoint(baseURL string) (string, error) {
	endpoints, err := modelDiscoveryEndpoints(baseURL, false)
	if err != nil {
		return "", err
	}
	return endpoints[0], nil
}

func modelDiscoveryEndpoints(baseURL string, isClaude bool) ([]string, error) {
	u, err := parseModelDiscoveryBaseURL(baseURL)
	if err != nil {
		return nil, err
	}
	mainURL := *u
	path := strings.TrimRight(mainURL.Path, "/")
	if strings.HasSuffix(path, "/models") {
		mainURL.Path = path
	} else {
		mainURL.Path = path + "/models"
	}
	endpoints := []string{mainURL.String()}
	v1URL := *u
	v1Path := strings.TrimRight(v1URL.Path, "/")
	if strings.HasSuffix(v1Path, "/models") {
		v1Path = strings.TrimRight(strings.TrimSuffix(v1Path, "/models"), "/")
	}
	if !strings.HasSuffix(v1Path, "/v1") {
		v1URL.Path = v1Path + "/v1/models"
		if candidate := v1URL.String(); candidate != endpoints[0] {
			endpoints = append(endpoints, candidate)
		}
	}
	return endpoints, nil
}

func parseModelDiscoveryBaseURL(baseURL string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, errInvalidModelBaseURL
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, errInvalidModelBaseURL
	}
	u.RawQuery = ""
	u.Fragment = ""
	return u, nil
}

func (s *Server) modelsImportMyKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		bad(w, 405, "method not allowed")
		return
	}
	var p struct {
		Reveal bool `json:"reveal"`
		Save   bool `json:"save"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		if err := decode(r, &p); err != nil {
			bad(w, 400, err.Error())
			return
		}
	}
	if (p.Reveal || p.Save) && !requireDangerousHeader(w, r) {
		return
	}
	d, err := modelconfig.ImportMyKeyWithPython(s.CfgStore.Snapshot().GARoot, s.CfgStore.Snapshot().PythonPath, p.Reveal)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	if p.Save {
		if !p.Reveal {
			bad(w, 400, "refusing to save masked mykey import; set reveal=true with explicit authorization")
			return
		}
		// mykey.py is the source of truth; importing it must not persist a stale
		// model_profiles.json shadow copy.
	}
	writeJSON(w, map[string]interface{}{"profiles": d.Profiles, "failover_groups": d.FailoverGroups, "updated_at": d.UpdatedAt, "saved": false, "masked": !p.Reveal})
}

func (s *Server) modelsExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		bad(w, 405, "method not allowed")
		return
	}
	type exportProfileRequest struct {
		modelconfig.Profile
		PreviousVarName string `json:"previous_var_name"`
	}
	var p struct {
		Profiles        []exportProfileRequest      `json:"profiles"`
		FailoverGroups  []modelconfig.FailoverGroup `json:"failover_groups"`
		OverwriteActive bool                        `json:"overwrite_active"`
	}
	if err := decode(r, &p); err != nil {
		bad(w, 400, err.Error())
		return
	}
	requestedProfiles := make([]modelconfig.Profile, len(p.Profiles))
	previousVarNames := make([]string, len(p.Profiles))
	for i, profile := range p.Profiles {
		requestedProfiles[i] = profile.Profile
		previousVarNames[i] = strings.TrimSpace(profile.PreviousVarName)
		if requestedProfiles[i].SourceVarName == "" {
			requestedProfiles[i].SourceVarName = previousVarNames[i]
		}
	}
	profiles, err := s.mergeModelSecretsForWriteByPreviousVar(requestedProfiles, previousVarNames)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	res, err := modelconfig.ExportWithFailoverGroups(s.CfgStore.Snapshot().GARoot, profiles, p.FailoverGroups, p.OverwriteActive)
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	// Export has already rewritten the same runtime model files as save, so the cached runtime
	// list is stale from here on: drop it before any later step can return early.
	s.invalidateGARuntimeLLMs(s.CfgStore.Snapshot())
	if err := s.reconcileChatTitleModel(profiles); err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, res)
}
