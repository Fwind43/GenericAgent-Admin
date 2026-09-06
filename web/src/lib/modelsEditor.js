const text = value => String(value ?? '').trim()

const DEFAULT_MODEL_PROTOCOL = 'native_oai'
const MODEL_PROTOCOL_FIELDS = {
  native_oai: { apiMode: true, serviceTier: true, reasoningFamily: 'oai' },
  native_claude: { thinkingType: true, reasoningFamily: 'claude', userAgent: true, fakeClaudeCode: true },
  oai: { apiMode: true, serviceTier: true, reasoningFamily: 'oai' },
  claude: { thinkingType: true, reasoningFamily: 'claude' },
}

export const API_MODE_OPTIONS = ['chat_completions', 'responses'].map(value => ({ value, label: value }))
export const SERVICE_TIER_OPTIONS = ['auto', 'default', 'priority', 'flex'].map(value => ({ value, label: value }))
export const THINKING_TYPE_OPTIONS = ['adaptive', 'enabled', 'disabled'].map(value => ({ value, label: value }))

const REASONING_EFFORT_OPTIONS = {
  oai: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => ({ value, label: value })),
  claude: ['low', 'medium', 'high', 'xhigh', 'max'].map(value => ({ value, label: value })),
}

export const modelProtocolFields = protocol => (
  MODEL_PROTOCOL_FIELDS[protocol] || MODEL_PROTOCOL_FIELDS[DEFAULT_MODEL_PROTOCOL]
)

export const reasoningEffortOptions = protocol => (
  REASONING_EFFORT_OPTIONS[modelProtocolFields(protocol).reasoningFamily] || []
)

const MODEL_SETTING_KEYS = [
  'stream',
  'max_retries',
  'read_timeout',
  'connect_timeout',
  'user_agent',
  'api_mode',
  'service_tier',
  'thinking_type',
  'reasoning_effort',
  'fake_cc_system_prompt',
  'extra',
]

const modelIdOf = value => text(
  typeof value === 'string'
    ? value
    : value?.id || value?.model || value?.name,
)

const uniqueModelIds = values => {
  const seen = new Set()
  return (values || []).map(modelIdOf).filter(model => {
    if (!model || seen.has(model)) return false
    seen.add(model)
    return true
  })
}

const copyPresentSettings = source => {
  const settings = {}
  for (const key of MODEL_SETTING_KEYS) {
    if (source?.[key] !== undefined) settings[key] = source[key]
  }
  return settings
}

export const createModelInstanceId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `model-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export const createModelConfig = (model, settings = {}) => ({
  instance_id: settings.instance_id || createModelInstanceId(),
  model: modelIdOf(model),
  stream: true,
  max_retries: 3,
  read_timeout: 300,
  ...copyPresentSettings(settings),
})

export const profileModelConfigs = (profile = {}) => {
  if (Array.isArray(profile.model_configs) && profile.model_configs.length) {
    return profile.model_configs.map(config => ({
      ...config,
      model: modelIdOf(config),
    }))
  }

  const models = uniqueModelIds([
    ...(Array.isArray(profile.models) ? profile.models : []),
    profile.model,
  ])
  const settings = copyPresentSettings(profile)
  return models.map(model => ({ model, ...settings }))
}

export const withModelConfigs = (profile = {}, configs = []) => {
  const normalized = (configs || []).map(config => ({
    ...config,
    model: modelIdOf(config),
  }))
  const models = normalized.map(config => config.model).filter(Boolean)
  return {
    ...profile,
    model: models[0] || '',
    models,
    model_configs: normalized,
  }
}

export const addModelConfigs = (profile = {}, values = []) => {
  const configs = profileModelConfigs(profile)
  for (const model of uniqueModelIds(values)) {
    configs.push(createModelConfig(model))
  }
  return withModelConfigs(profile, configs)
}

export const updateModelConfig = (profile = {}, index, patch) => {
  const configs = profileModelConfigs(profile)
  if (index < 0 || index >= configs.length) return withModelConfigs(profile, configs)
  configs[index] = { ...configs[index], ...patch }
  return withModelConfigs(profile, configs)
}

export const removeModelConfig = (profile = {}, index) => withModelConfigs(
  profile,
  profileModelConfigs(profile).filter((_, rowIndex) => rowIndex !== index),
)

// Fields the editor keeps for its own bookkeeping. They never reach mykey.py,
// so a draft that differs only in these is not a change the user made.
const DRAFT_ONLY_KEYS = ['client_id', 'previous_var_name', 'provider_sort_order']

const sortedKeys = value => {
  if (Array.isArray(value)) return value.map(sortedKeys)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((sorted, key) => {
    if (value[key] === undefined) return sorted
    sorted[key] = sortedKeys(value[key])
    return sorted
  }, {})
}

const canonical = value => JSON.stringify(sortedKeys(value))

// comparableProfile strips bookkeeping and folds the three ways a profile can
// carry its models into one, so a profile read from mykey.py and the same
// profile after a round trip through the editor compare equal.
const comparableProfile = (profile = {}) => {
  const next = { ...profile, model_configs: profileModelConfigs(profile) }
  DRAFT_ONLY_KEYS.forEach(key => delete next[key])
  delete next.models
  delete next.model
  return canonical(next)
}

const providerIdentity = profile => text(profile?.previous_var_name) || text(profile?.var_name)

// draftChangeSummary counts what a save would write. Providers are matched by
// variable name rather than position so that reordering the list is reported
// once, not as an edit to every provider it shifted.
export const draftChangeSummary = (draftProfiles = [], persistedProfiles = [], draftGroups = [], persistedGroups = []) => {
  const persistedByName = new Map(persistedProfiles.map(profile => [text(profile?.var_name), profile]))
  const matched = new Set()
  let added = 0
  let edited = 0

  draftProfiles.forEach(profile => {
    const identity = providerIdentity(profile)
    const persisted = persistedByName.get(identity)
    if (!persisted) {
      added += 1
      return
    }
    matched.add(identity)
    if (comparableProfile(profile) !== comparableProfile(persisted)) edited += 1
  })

  const removed = persistedProfiles.filter(profile => !matched.has(text(profile?.var_name))).length
  const draftOrder = draftProfiles.map(providerIdentity).filter(name => matched.has(name))
  const persistedOrder = persistedProfiles.map(profile => text(profile?.var_name)).filter(name => matched.has(name))
  const reordered = draftOrder.join('\u0000') !== persistedOrder.join('\u0000')
  const failover = canonical(normalizeFailoverGroups(draftGroups)) !== canonical(normalizeFailoverGroups(persistedGroups))

  return {
    added,
    edited,
    removed,
    reordered,
    failover,
    total: added + edited + removed + (reordered ? 1 : 0) + (failover ? 1 : 0),
  }
}

export const orderedProviderProfiles = (profiles = []) => profiles
  .map((profile, index) => ({ profile, index, order: Number.isInteger(profile?.provider_sort_order) ? profile.provider_sort_order : index }))
  .sort((left, right) => left.order - right.order || left.index - right.index)
  .map(item => item.profile)

export const applyProviderOrder = (profiles = []) => profiles.map((profile, index) => ({
  ...profile,
  provider_sort_order: index,
}))

export const orderedModelRows = (profiles = []) => {
  let defaultOrder = 0
  const rows = profiles.flatMap((profile, profileIndex) => (
    profileModelConfigs(profile).map((config, configIndex) => {
      const row = {
        id: config.instance_id || `${profileIndex}:${configIndex}`,
        instanceId: config.instance_id || '',
        profileIndex,
        configIndex,
        model: text(config.model),
        providerVarName: text(profile.var_name),
        variableName: `${text(profile.var_name)}${configIndex ? `_${configIndex + 1}` : ''}`,
        order: Number.isInteger(config.sort_order) ? config.sort_order : defaultOrder,
        defaultOrder,
      }
      defaultOrder += 1
      return row
    })
  ))
  return rows.sort((left, right) => left.order - right.order)
}

export const orderedModelAndFailoverRows = (profiles = [], failoverGroups = []) => {
  let defaultOrder = 0
  
  // Model rows
  const modelRows = profiles.flatMap((profile, profileIndex) => (
    profileModelConfigs(profile).map((config, configIndex) => {
      const row = {
        type: 'model',
        id: config.instance_id || `${profileIndex}:${configIndex}`,
        instanceId: config.instance_id || '',
        profileIndex,
        configIndex,
        model: text(config.model),
        providerVarName: text(profile.var_name),
        variableName: `${text(profile.var_name)}${configIndex ? `_${configIndex + 1}` : ''}`,
        order: Number.isInteger(config.sort_order) ? config.sort_order : defaultOrder,
        defaultOrder,
      }
      defaultOrder += 1
      return row
    })
  ))
  
  // Failover group rows - place at the beginning by default (negative order)
  const failoverRows = (Array.isArray(failoverGroups) ? failoverGroups : []).map((group, groupIndex) => ({
    type: 'failover',
    id: `failover:${groupIndex}`,
    groupIndex,
    varName: text(group.var_name),
    members: group.members || [],
    order: Number.isInteger(group.sort_order) ? group.sort_order : -(failoverGroups.length - groupIndex),
    defaultOrder: -(failoverGroups.length - groupIndex),
  }))
  
  return [...modelRows, ...failoverRows].sort((left, right) => left.order - right.order)
}

export const FAILOVER_VAR_PREFIX = 'mixin_config_'

export const failoverGroupSuffix = value => {
  const name = String(value ?? '')
  return name.startsWith(FAILOVER_VAR_PREFIX) ? name.slice(FAILOVER_VAR_PREFIX.length) : name
}

export const failoverGroupVarName = suffix => `${FAILOVER_VAR_PREFIX}${String(suffix ?? '')}`

const legacyFailoverSuffix = (value, fallback) => {
  const suffix = text(value)
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return suffix || fallback
}

export const migrateFailoverGroupNames = (groups = []) => {
  const list = Array.isArray(groups) ? groups : []
  const reserved = new Set(list
    .map(group => text(group?.var_name))
    .filter(name => name.startsWith(FAILOVER_VAR_PREFIX)))
  const used = new Set()

  return list.map((group, index) => {
    const original = text(group?.var_name)
    if (original.startsWith(FAILOVER_VAR_PREFIX)) {
      used.add(original)
      return { ...group, var_name: original }
    }

    const suffix = legacyFailoverSuffix(original, String(index + 1))
    let varName = failoverGroupVarName(suffix)
    let serial = 2
    while (reserved.has(varName) || used.has(varName)) {
      varName = failoverGroupVarName(`${suffix}_${serial}`)
      serial += 1
    }
    used.add(varName)
    return { ...group, var_name: varName }
  })
}

export const normalizeFailoverGroups = (groups = []) => (Array.isArray(groups) ? groups : []).map(group => {
  const next = {
    var_name: text(group?.var_name),
    members: (Array.isArray(group?.members) ? group.members : []).map(member => ({
      provider_var_name: text(member?.provider_var_name),
      model: text(member?.model),
      ...(text(member?.instance_id) ? { instance_id: text(member.instance_id) } : {}),
    })),
    max_retries: Number(group?.max_retries ?? 10),
    base_delay: Number(group?.base_delay ?? 0.5),
  }
  if (group?.spring_back !== undefined && group?.spring_back !== null && group?.spring_back !== '') {
    next.spring_back = Number(group.spring_back)
  }
  if (group?.sort_order !== undefined && group?.sort_order !== null) {
    next.sort_order = Number(group.sort_order)
  }
  return next
})

export const nextFailoverGroupName = (groups = []) => {
  const used = new Set((Array.isArray(groups) ? groups : []).map(group => text(group?.var_name)))
  let suffix = 1
  while (used.has(failoverGroupVarName(suffix))) suffix += 1
  return failoverGroupVarName(suffix)
}

export const moveOrderedItem = (items = [], fromIndex, toIndex) => {
  if (
    !Number.isInteger(fromIndex)
    || !Number.isInteger(toIndex)
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= items.length
    || toIndex >= items.length
    || fromIndex === toIndex
  ) return items

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export const applyModelAndFailoverOrder = (profiles = [], failoverGroups = [], orderedRows = []) => {
  const orderById = new Map(orderedRows.map((row, order) => [row.id, order]))
  
  // Apply order to model configs
  const nextProfiles = profiles.map((profile, profileIndex) => withModelConfigs(
    profile,
    profileModelConfigs(profile).map((config, configIndex) => {
      const sortOrder = orderById.get(config.instance_id || `${profileIndex}:${configIndex}`)
      return sortOrder === undefined ? { ...config } : { ...config, sort_order: sortOrder }
    }),
  ))
  
  // Apply order to failover groups
  const nextFailoverGroups = (Array.isArray(failoverGroups) ? failoverGroups : []).map((group, groupIndex) => {
    const sortOrder = orderById.get(`failover:${groupIndex}`)
    return sortOrder === undefined ? { ...group } : { ...group, sort_order: sortOrder }
  })
  
  return { profiles: nextProfiles, failoverGroups: nextFailoverGroups }
}