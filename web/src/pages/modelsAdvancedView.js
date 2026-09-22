import { API_MODE_OPTIONS, SERVICE_TIER_OPTIONS, THINKING_TYPE_OPTIONS, modelProtocolFields, reasoningEffortOptions } from '../lib/modelsEditor'

// Host adapter: no raw config, protocol identifier, extra, labels from config or unknown values cross the surface.
export function modelAdvancedView(config, protocol, t, onChange) {
  const fields = modelProtocolFields(protocol)
  const specs = [
    ['api_mode', 'setApiMode', fields.apiMode, t.models.apiMode, API_MODE_OPTIONS],
    ['service_tier', 'setServiceTier', fields.serviceTier, t.models.serviceTier, SERVICE_TIER_OPTIONS],
    ['thinking_type', 'setThinkingType', fields.thinkingType, t.models.thinkingType, THINKING_TYPE_OPTIONS],
    ['reasoning_effort', 'setReasoningEffort', fields.reasoningFamily, t.models.reasoningEffort, reasoningEffortOptions(protocol)],
    ['fake_cc_system_prompt', 'setFakeClaude', fields.fakeClaudeCode, t.models.fakeClaude, [{ value: true, label: t.enabled }, { value: false, label: t.disabled }]],
  ]
  const controls = [], actions = {}, handled = []
  for (const [key, action, enabled, label, options] of specs) {
    if (!enabled) continue
    const value = config[key]
    // Preserve unsupported imported values in the original host control, never sanitize the draft silently.
    if (value !== undefined && value !== null && value !== '' && !options.some(option => option.value === value)) continue
    handled.push(key)
    controls.push({ key, action, label, value: value ?? '', options: options.map(option => ({ value: option.value, label: option.label })) })
    actions[action] = next => {
      // A package cannot inject arbitrary text or write another parameter through this action.
      if (next === undefined || options.some(option => option.value === next)) onChange({ [key]: next })
    }
  }
  return { model: { title: t.models.protocolParams, inherit: t.models.inherit, controls }, actions, handled }
}
