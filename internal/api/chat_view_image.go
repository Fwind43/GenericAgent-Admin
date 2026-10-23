package api

import (
	"net/http"
	"strings"

	"genericagent-admin-go/internal/config"
	"genericagent-admin-go/internal/modelconfig"
)

func resolveChatViewImage(ref *config.ChatViewImageRef, options []chatTitleModelOption) (*config.ChatViewImageRef, bool) {
	if ref == nil {
		return nil, true
	}
	mode := strings.TrimSpace(ref.Mode)
	if mode == "" {
		mode = "main"
	}
	if mode == "main" {
		return &config.ChatViewImageRef{Enable: ref.Enable, Mode: "main"}, true
	}
	if mode != "vision" {
		return nil, false
	}
	provider := strings.TrimSpace(ref.ProviderVarName)
	model := strings.TrimSpace(ref.Model)
	for _, option := range options {
		if option.ProviderVarName == provider && option.Model == model {
			return &config.ChatViewImageRef{
				Enable:          ref.Enable,
				Mode:            "vision",
				ProviderVarName: option.ProviderVarName,
				Model:           option.Model,
				LLMNo:           option.LLMNo,
			}, true
		}
	}
	return nil, false
}

func (s *Server) reconcileChatViewImage(profiles []modelconfig.Profile) error {
	if s.BaseCfgStore != nil && s.BaseCfgStore != s.CfgStore {
		return nil
	}
	current := s.CfgStore.Snapshot().ChatViewImage
	if current == nil {
		return nil
	}
	resolved, _ := resolveChatViewImage(current, orderedChatTitleModelOptions(profiles))
	if resolved != nil && *resolved == *current {
		return nil
	}
	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()
	cfg := s.CfgStore.Snapshot()
	cfg.ChatViewImage = resolved
	return s.CfgStore.Save(cfg)
}

func (s *Server) reconcileChatModelRefs(profiles []modelconfig.Profile) error {
	if err := s.reconcileChatTitleModel(profiles); err != nil {
		return err
	}
	return s.reconcileChatViewImage(profiles)
}

func (s *Server) modelsViewImageModel(w http.ResponseWriter, r *http.Request) {
	d, err := s.loadModelsFromOfficialMyKey(false)
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	options := orderedChatTitleModelOptions(d.Profiles)
	if r.Method == http.MethodGet {
		resolved, _ := resolveChatViewImage(s.CfgStore.Snapshot().ChatViewImage, options)
		writeJSON(w, map[string]interface{}{"config": resolved, "options": options})
		return
	}
	if r.Method != http.MethodPut {
		bad(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Config *config.ChatViewImageRef `json:"config"`
	}
	if err := decode(r, &req); err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	resolved, found := resolveChatViewImage(req.Config, options)
	if !found {
		bad(w, http.StatusBadRequest, "selected vision model is not present in the saved model configuration")
		return
	}
	s.ConfigMu.Lock()
	cfg := s.CfgStore.Snapshot()
	cfg.ChatViewImage = resolved
	err = s.CfgStore.Save(cfg)
	s.ConfigMu.Unlock()
	if err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"config": resolved, "options": options})
}

func applyViewImageRequestField(req map[string]interface{}, cfg config.AppConfig) {
	v := cfg.ChatViewImage
	if v == nil || !v.Enable {
		return
	}
	field := map[string]interface{}{"enabled": true, "mode": v.Mode}
	if v.Mode == "vision" {
		field["llm_no"] = v.LLMNo
	}
	req["view_image"] = field
}
