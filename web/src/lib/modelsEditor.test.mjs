import test from 'node:test'
import assert from 'node:assert/strict'
import {
  API_MODE_OPTIONS,
  SERVICE_TIER_OPTIONS,
  THINKING_TYPE_OPTIONS,
  addModelConfigs,
  createModelConfig,
  modelProtocolFields,
  profileModelConfigs,
  orderedModelRows,
  orderedModelAndFailoverRows,
  applyModelAndFailoverOrder,
  applyProviderOrder,
  orderedProviderProfiles,
  draftChangeSummary,
  normalizeFailoverGroups,
  FAILOVER_VAR_PREFIX,
  failoverGroupSuffix,
  failoverGroupVarName,
  migrateFailoverGroupNames,
  nextFailoverGroupName,
  moveOrderedItem,
  reasoningEffortOptions,
  withModelConfigs,
} from './modelsEditor.js'

test('provider ordering respects persisted order and normalizes moved rows', () => {
  const profiles = [
    { var_name: 'first', provider_sort_order: 2 },
    { var_name: 'second', provider_sort_order: 0 },
    { var_name: 'third', provider_sort_order: 1 },
  ]
  assert.deepEqual(orderedProviderProfiles(profiles).map(profile => profile.var_name), ['second', 'third', 'first'])
  assert.deepEqual(applyProviderOrder(orderedProviderProfiles(profiles)).map(profile => profile.provider_sort_order), [0, 1, 2])
  assert.deepEqual(moveOrderedItem(profiles, 0, 2).map(profile => profile.var_name), ['second', 'third', 'first'])
})


test('profileModelConfigs migrates legacy provider settings into independent rows', () => {
  const profile = {
    model: 'alpha',
    models: ['alpha', 'beta'],
    stream: false,
    max_retries: 5,
    read_timeout: 120,
    connect_timeout: 9,
    reasoning_effort: 'high',
  }

  assert.deepEqual(profileModelConfigs(profile), [
    { model: 'alpha', stream: false, max_retries: 5, read_timeout: 120, connect_timeout: 9, reasoning_effort: 'high' },
    { model: 'beta', stream: false, max_retries: 5, read_timeout: 120, connect_timeout: 9, reasoning_effort: 'high' },
  ])
})

test('profileModelConfigs treats model_configs as the authoritative source', () => {
  const profile = {
    model: 'legacy',
    models: ['legacy'],
    model_configs: [
      { model: 'alpha', reasoning_effort: 'low' },
      { model: 'beta', read_timeout: 60 },
    ],
  }

  assert.deepEqual(profileModelConfigs(profile), profile.model_configs)
})

test('withModelConfigs synchronizes compatibility model indexes without sharing row settings', () => {
  const profile = { var_name: 'native_oai_config1', model: 'old', models: ['old'] }
  const next = withModelConfigs(profile, [
    { model: ' alpha ', reasoning_effort: 'low' },
    { model: 'beta', reasoning_effort: 'high' },
  ])

  assert.equal(next.model, 'alpha')
  assert.deepEqual(next.models, ['alpha', 'beta'])
  assert.deepEqual(next.model_configs, [
    { model: 'alpha', reasoning_effort: 'low' },
    { model: 'beta', reasoning_effort: 'high' },
  ])
})

test('addModelConfigs allows duplicate instances while deduplicating one quick-add batch', () => {
  const profile = withModelConfigs({}, [{ instance_id: 'existing-alpha', model: 'alpha', max_retries: 7 }])
  const next = addModelConfigs(profile, ['alpha', 'alpha', { id: 'beta' }, { name: 'gamma' }, ''])

  assert.deepEqual(next.model_configs.map(config => config.model), ['alpha', 'alpha', 'beta', 'gamma'])
  assert.equal(next.model_configs[0].instance_id, 'existing-alpha')
  assert.equal(next.model_configs[0].max_retries, 7)
  assert.equal(new Set(next.model_configs.map(config => config.instance_id)).size, 4)
  assert.deepEqual(next.models, ['alpha', 'alpha', 'beta', 'gamma'])
})

const optionValues = options => options.map(option => option.value)

test('modelProtocolFields distinguishes native and legacy protocol capabilities', () => {
  assert.deepEqual(modelProtocolFields('native_oai'), { apiMode: true, serviceTier: true, reasoningFamily: 'oai' })
  assert.deepEqual(modelProtocolFields('oai'), { apiMode: true, serviceTier: true, reasoningFamily: 'oai' })
  assert.deepEqual(modelProtocolFields('native_claude'), {
    thinkingType: true,
    reasoningFamily: 'claude',
    userAgent: true,
    fakeClaudeCode: true,
  })
  assert.deepEqual(modelProtocolFields('claude'), { thinkingType: true, reasoningFamily: 'claude' })
  assert.deepEqual(modelProtocolFields('unknown'), modelProtocolFields('native_oai'))
})

test('protocol-specific selects expose only supported values', () => {
  assert.deepEqual(optionValues(API_MODE_OPTIONS), ['chat_completions', 'responses'])
  assert.deepEqual(optionValues(SERVICE_TIER_OPTIONS), ['auto', 'default', 'priority', 'flex'])
  assert.deepEqual(optionValues(THINKING_TYPE_OPTIONS), ['adaptive', 'enabled', 'disabled'])
  assert.deepEqual(optionValues(reasoningEffortOptions('native_oai')), ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(optionValues(reasoningEffortOptions('oai')), ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(optionValues(reasoningEffortOptions('native_claude')), ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(optionValues(reasoningEffortOptions('claude')), ['low', 'medium', 'high', 'xhigh', 'max'])
})

const orderingProfiles = () => ([
  {
    var_name: 'provider_a',
    model_configs: [
      { model: 'a-one', sort_order: 0, stream: true },
      { model: 'a-two', sort_order: 2, stream: false },
    ],
  },
  {
    var_name: 'provider_b',
    model_configs: [
      { model: 'b-one', sort_order: 1, max_retries: 7 },
    ],
  },
])

test('orderedModelRows expands providers into the persisted global model order', () => {
  const rows = orderedModelRows(orderingProfiles())
  assert.deepEqual(rows.map(row => row.model), ['a-one', 'b-one', 'a-two'])
  assert.deepEqual(rows.map(row => row.providerVarName), ['provider_a', 'provider_b', 'provider_a'])
  assert.deepEqual(rows.map(row => row.variableName), ['provider_a', 'provider_b', 'provider_a_2'])
  assert.deepEqual(rows.map(row => row.id), ['0:0', '1:0', '0:1'])
})

test('orderedModelRows keeps legacy provider and model order without metadata', () => {
  const profiles = orderingProfiles().map(profile => ({
    ...profile,
    model_configs: profile.model_configs.map(({ sort_order: _sortOrder, ...config }) => config),
  }))
  assert.deepEqual(orderedModelRows(profiles).map(row => row.model), ['a-one', 'a-two', 'b-one'])
})

test('applyModelAndFailoverOrder writes consecutive metadata without moving provider configs', () => {
  const profiles = orderingProfiles()
  const groups = [{ var_name: 'mixin_config_1', members: [] }]
  const rows = orderedModelAndFailoverRows(profiles, groups)
  assert.deepEqual(rows.map(row => row.type), ['failover', 'model', 'model', 'model'])

  const next = applyModelAndFailoverOrder(profiles, groups, [rows[3], rows[0], rows[1], rows[2]])

  assert.deepEqual(next.profiles.map(profile => profile.model_configs.map(config => config.model)), [
    ['a-one', 'a-two'],
    ['b-one'],
  ])
  assert.deepEqual(next.profiles[0].model_configs.map(config => config.sort_order), [2, 0])
  assert.deepEqual(next.profiles[1].model_configs.map(config => config.sort_order), [3])
  assert.equal(next.failoverGroups[0].sort_order, 1)
  assert.equal(next.profiles[0].model_configs[0].stream, true)
  assert.equal(next.profiles[1].model_configs[0].max_retries, 7)
  assert.notEqual(next.profiles, profiles)
  assert.notEqual(next.profiles[0].model_configs[0], profiles[0].model_configs[0])
})

test('draftChangeSummary counts a reorder once and follows a renamed provider', () => {
  const persisted = [
    { var_name: 'first', apibase: 'https://one.example', model_configs: [{ model: 'a' }] },
    { var_name: 'second', apibase: 'https://two.example', model_configs: [{ model: 'b' }] },
  ]

  assert.equal(draftChangeSummary(persisted, persisted, [], []).total, 0)

  const reordered = [persisted[1], persisted[0]]
  assert.deepEqual(draftChangeSummary(reordered, persisted, [], []), {
    added: 0, edited: 0, removed: 0, reordered: true, failover: false, total: 1,
  })

  const renamed = [{ ...persisted[0], var_name: 'renamed', previous_var_name: 'first' }, persisted[1]]
  assert.deepEqual(draftChangeSummary(renamed, persisted, [], []), {
    added: 0, edited: 1, removed: 0, reordered: false, failover: false, total: 1,
  })

  assert.equal(draftChangeSummary(persisted, persisted, [{ var_name: 'mixin_config_1', members: [] }], []).failover, true)
})

test('moveOrderedItem reorders immutably and ignores invalid moves', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const moved = moveOrderedItem(rows, 0, 2)

  assert.deepEqual(moved.map(row => row.id), ['b', 'c', 'a'])
  assert.notEqual(moved, rows)
  assert.deepEqual(rows.map(row => row.id), ['a', 'b', 'c'])
  assert.equal(moveOrderedItem(rows, 1, 1), rows)
  assert.equal(moveOrderedItem(rows, -1, 1), rows)
  assert.equal(moveOrderedItem(rows, 1, 3), rows)
})


test('normalizes explicit failover groups without losing intentional zero values', () => {
  assert.deepEqual(normalizeFailoverGroups([{
    var_name: '  routing_mixin  ',
    members: [{ provider_var_name: ' provider_a ', model: ' alpha ' }],
    max_retries: 0,
    base_delay: 0,
    spring_back: '',
  }, {
    var_name: 'backup_mixin',
    members: [],
  }]), [{
    var_name: 'routing_mixin',
    members: [{ provider_var_name: 'provider_a', model: 'alpha' }],
    max_retries: 0,
    base_delay: 0,
  }, {
    var_name: 'backup_mixin',
    members: [],
    max_retries: 10,
    base_delay: 0.5,
  }])
})

test('converts failover group names between the fixed prefix and editable suffix', () => {
  assert.equal(FAILOVER_VAR_PREFIX, 'mixin_config_')
  assert.equal(failoverGroupSuffix('mixin_config_primary'), 'primary')
  assert.equal(failoverGroupSuffix('legacy_route'), 'legacy_route')
  assert.equal(failoverGroupVarName('primary_2'), 'mixin_config_primary_2')
})

test('migrates legacy failover group names into the fixed namespace without collisions', () => {
  const groups = [
    { var_name: 'mixin_config_main', marker: 1 },
    { var_name: 'main', marker: 2 },
    { var_name: 'route-prod', marker: 3 },
    { var_name: 'route prod', marker: 4 },
    { var_name: '!!!', marker: 5 },
  ]
  assert.deepEqual(migrateFailoverGroupNames(groups), [
    { var_name: 'mixin_config_main', marker: 1 },
    { var_name: 'mixin_config_main_2', marker: 2 },
    { var_name: 'mixin_config_route_prod', marker: 3 },
    { var_name: 'mixin_config_route_prod_2', marker: 4 },
    { var_name: 'mixin_config_5', marker: 5 },
  ])
})

test('allocates stable unique failover group variable names', () => {
  assert.equal(nextFailoverGroupName([]), 'mixin_config_1')
  assert.equal(nextFailoverGroupName([
    { var_name: 'mixin_config_1' },
    { var_name: 'mixin_config_2' },
    { var_name: 'mixin_config_4' },
  ]), 'mixin_config_3')
})

