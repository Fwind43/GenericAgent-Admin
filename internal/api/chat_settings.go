package api

import (
	"strings"

	"genericagent-admin-go/internal/config"
)

const (
	chatReasoningEffortOff     = "off"
	chatReasoningEffortNone    = "none"
	chatReasoningEffortMinimal = "minimal"
	chatReasoningEffortLow     = "low"
	chatReasoningEffortMedium  = "medium"
	chatReasoningEffortHigh    = "high"
	chatReasoningEffortXHigh   = "xhigh"
	chatReasoningEffortMax     = "max"
)

type chatSettings struct {
	LLMNo           int    `json:"llm_no"`
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
}

type chatSettingsPatch struct {
	LLMNo                  int       `json:"llm_no"`
	ReasoningEffort        string    `json:"reasoning_effort,omitempty"`
	ExtraSysPrompts        *[]string `json:"extra_sys_prompts"`
	ExtraSysPromptPresetID *string   `json:"extra_sys_prompt_preset_id,omitempty"`
}

func normalizeChatExtraSysPrompts(prompts []string) []string {
	cleaned := make([]string, 0, len(prompts))
	for _, prompt := range prompts {
		prompt = strings.TrimSpace(prompt)
		if prompt != "" {
			cleaned = append(cleaned, prompt)
		}
	}
	if len(cleaned) == 0 {
		return nil
	}
	return cleaned
}

func normalizeChatSettings(st chatSettings) chatSettings {
	switch strings.ToLower(strings.TrimSpace(st.ReasoningEffort)) {
	case "", "default", "model":
		st.ReasoningEffort = ""
	case chatReasoningEffortOff, "clear", "unset":
		st.ReasoningEffort = chatReasoningEffortOff
	case chatReasoningEffortNone:
		st.ReasoningEffort = chatReasoningEffortNone
	case chatReasoningEffortMinimal:
		st.ReasoningEffort = chatReasoningEffortMinimal
	case chatReasoningEffortLow:
		st.ReasoningEffort = chatReasoningEffortLow
	case chatReasoningEffortMedium:
		st.ReasoningEffort = chatReasoningEffortMedium
	case chatReasoningEffortHigh:
		st.ReasoningEffort = chatReasoningEffortHigh
	case chatReasoningEffortXHigh:
		st.ReasoningEffort = chatReasoningEffortXHigh
	case chatReasoningEffortMax:
		st.ReasoningEffort = chatReasoningEffortMax
	default:
		st.ReasoningEffort = chatReasoningEffortOff
	}
	return st
}

// defaultChatSettingsFor builds the settings a brand new chat session starts
// with. The model index comes from config (the one last picked in Admin Chat)
// so a new conversation keeps the current model instead of snapping back to the
// first configured one.
func defaultChatSettingsFor(cfg config.AppConfig) chatSettings {
	st := chatSettings{}
	if cfg.ChatDefaultLLMNo > 0 {
		st.LLMNo = cfg.ChatDefaultLLMNo
	}
	return normalizeChatSettings(st)
}

func (s *Server) defaultChatSettings() chatSettings {
	if s == nil || s.CfgStore == nil {
		return normalizeChatSettings(chatSettings{})
	}
	return defaultChatSettingsFor(s.CfgStore.Snapshot())
}

// rememberDefaultChatLLMNo persists llmNo as the seed for future sessions.
// Request-scoped chat servers use an in-memory instance Store, so persist the
// preference through the base Store instead. This remains best effort: a
// config write failure must not undo the session settings already saved.
func (s *Server) rememberDefaultChatLLMNo(llmNo int) {
	if s == nil || llmNo < 0 {
		return
	}
	store := s.BaseCfgStore
	if store == nil {
		store = s.CfgStore
	}
	if store == nil {
		return
	}
	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()
	cfg := store.Snapshot()
	if cfg.ChatDefaultLLMNo == llmNo {
		return
	}
	cfg.ChatDefaultLLMNo = llmNo
	_ = store.Save(cfg)
}
