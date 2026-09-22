import React, { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Models } from '../pages/ModelsPage'
import { modelAdvancedView } from '../pages/modelsAdvancedView'
import { useModelsConfig } from '../hooks/useModelsConfig'
import { I18N } from '../lib/i18n'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { UiHost, useUiPackage } from './UiHost'
import { createRegistry, manifest } from './contract'
import { defaults } from './default'
import * as studio from './studio'
vi.mock('../lib/api', () => ({ api: vi.fn(), apiStream: vi.fn(), apiHeaders: vi.fn(), parseApiResponse: vi.fn() }))
vi.mock('../lib/danger', () => ({ confirmDanger: vi.fn() }))
const t = I18N.en
const surface = 'admin.models.editor.advanced'
const secret = 'synthetic-sensitive-text'
const fixture = () => ({ profiles: [{ var_name: 'api_demo', display_name: 'Synthetic provider', type: 'oai', apibase: 'https://example.invalid/v1', apikey: secret, model: 'model-a', models: ['model-a'], model_configs: [{ model: 'model-a', name: 'Alpha', instance_id: 'call-a', sort_order: 0, user_agent: secret, extra: { headers: { Authorization: secret }, body: secret, thinking_budget_tokens: 100 } }] }], failover_groups: [] })
let ui, host, initial, captured, broken, busyState
function Harness() {
  const [message, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  busyState = busy
  ui = useUiPackage()
  host = useModelsConfig({ t, active: true, setBusy, setMsg, lang: 'en' })
  return <><output aria-label="Host message">{message}</output>
    <Models {...host} t={t} addModelProfiles={host.addProfiles} removeModelProfile={host.removeProfile} modelPreview={host.preview} getProfileKey={host.getProfileKey} onRevealKey={host.revealKey} onClearRevealedKey={host.clearRevealedKey} />
  </>
}
const draft = () => host.profiles[0].model_configs[0]
const area = () => within(screen.getByRole('dialog')).getByRole('region', { name: t.models.protocolParams, exact: true })
async function select(id) { await act(async () => { await ui.select(id) }); await waitFor(() => expect(ui.id).toBe(id)) }
async function open(layout) {
  const registry = createRegistry()
  for (const pkg of [defaults, { ...studio, manifest: manifest('studio') }]) {
    const View = pkg.views[surface]
    const views = { ...pkg.views, [surface]: function Capture(props) { captured = props; if (broken && pkg.manifest.id === 'studio') throw new Error('Synthetic advanced failure'); return <View {...props} /> } }
    registry.register(manifest(pkg.manifest.id), async () => ({ ...pkg, views }))
  }
  render(<UiHost packageRegistry={registry}><Harness /></UiHost>)
  await waitFor(() => expect(host.profiles).toHaveLength(1))
  await select(layout)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(t.models.callListTitle) }))
  fireEvent.click(await screen.findByRole('button', { name: `${t.models.configure}: model-a`, exact: true }))
  await waitFor(() => expect(area()).toBeTruthy())
}
function choose(layout, label, value) {
  if (layout === 'default') fireEvent.change(within(area()).getByRole('combobox', { name: label, exact: true }), { target: { value: value === undefined ? '' : String(value) } })
  else {
    const group = within(area()).getByRole('group', { name: label, exact: true })
    const name = value === undefined ? t.models.inherit : typeof value === 'boolean' ? (value ? t.enabled : t.disabled) : value
    fireEvent.click(within(group).getByRole('button', { name, exact: true }))
  }
}
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); initial = fixture(); captured = null; broken = false; busyState = false
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden') }))
  vi.stubGlobal('XMLHttpRequest', class { constructor() { throw new Error('Real XHR forbidden') } })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  confirmDanger.mockResolvedValue(false)
  api.mockImplementation(async path => {
    if (path === '/api/instances/active') return { instance: { id: 'synthetic' } }
    if (path === '/api/models/import-mykey') return structuredClone(initial)
    if (path === '/api/chat/state') return { llms: [] }
    if (path === '/api/models') return { profiles: [], failover_groups: [] }
    if (path === '/api/runtime') return { settings: {} }
    if (path === '/api/risk/catalog') return { items: [] }
    throw new Error(`Unexpected isolated API: ${path}`)
  })
})
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled()
  expect(api.mock.calls.every(([path]) => ['/api/instances/active', '/api/chat/state', '/api/models/import-mykey', '/api/models', '/api/runtime', '/api/risk/catalog'].includes(path))).toBe(true)
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
it.each(['default', 'studio'].flatMap(layout => ['native_oai', 'oai', 'native_claude', 'claude'].map(protocol => [layout, protocol])))('%s / %s edits only supported options and inherits without saving', async (layout, protocol) => {
  initial.profiles[0].type = protocol
  await open(layout)
  const claude = protocol.includes('claude')
  expect(captured.model.controls.map(control => control.key)).toEqual(claude
    ? ['thinking_type', 'reasoning_effort', ...(protocol === 'native_claude' ? ['fake_cc_system_prompt'] : [])]
    : ['api_mode', 'service_tier', 'reasoning_effort'])
  if (claude) {
    const budget = within(screen.getByRole('dialog')).getByRole('spinbutton', { name: 'thinking_budget_tokens', exact: true })
    expect(budget.disabled).toBe(true)
    choose(layout, t.models.thinkingType, 'enabled')
    expect(budget.disabled).toBe(false)
    fireEvent.change(budget, { target: { value: '256' } })
    expect(draft().extra.thinking_budget_tokens).toBe(256)
    if (protocol === 'native_claude') {
      choose(layout, t.models.fakeClaude, false)
      expect(draft().fake_cc_system_prompt).toBe(false)
    } else {
      expect(captured.actions.setFakeClaude).toBeUndefined()
    }
  } else {
    choose(layout, t.models.apiMode, 'responses')
    choose(layout, t.models.serviceTier, 'priority')
    expect(draft()).toMatchObject({ api_mode: 'responses', service_tier: 'priority' })
  }
  choose(layout, t.models.reasoningEffort, 'high')
  expect(draft().reasoning_effort).toBe('high')
  choose(layout, t.models.reasoningEffort, undefined)
  expect(draft().reasoning_effort).toBeUndefined()
  expect(host.changes.total).toBeGreaterThan(0)
  expect(busyState).toBe(false)
  expect(confirmDanger).not.toHaveBeenCalled()
  expect(draft().extra.headers.Authorization).toBe(secret)
})
it('keeps draft across package changes with independently usable layouts', async () => {
  await open('default'); choose('default', t.models.apiMode, 'responses')
  expect(within(area()).getAllByRole('combobox')).toHaveLength(3)
  await select('studio')
  expect(within(area()).queryByRole('combobox')).toBeNull()
  expect(within(area()).getAllByRole('group')).toHaveLength(3)
  expect(within(within(area()).getByRole('group', { name: t.models.apiMode, exact: true })).getByRole('button', { name: 'responses', exact: true }).getAttribute('aria-pressed')).toBe('true')
  choose('studio', t.models.serviceTier, 'flex'); await select('default')
  expect(within(area()).getByRole('combobox', { name: t.models.serviceTier, exact: true }).value).toBe('flex')
  expect(draft().api_mode).toBe('responses')
})
it('does not transmit free text, auth choices, raw extra or general actions', async () => {
  initial.profiles[0].type = 'native_claude'
  await open('studio')
  expect(Object.keys(captured).sort()).toEqual(['actions', 'layout', 'model'])
  expect(Object.keys(captured.model).sort()).toEqual(['controls', 'inherit', 'title'])
  expect(Object.keys(captured.actions).sort()).toEqual(['setFakeClaude', 'setReasoningEffort', 'setThinkingType'])
  expect(JSON.stringify(captured.model)).not.toContain(secret)
  const agent = within(screen.getByRole('dialog')).getByRole('textbox', { name: 'User-Agent', exact: true })
  expect(area().contains(agent)).toBe(false)
  fireEvent.change(agent, { target: { value: 'synthetic-updated-agent' } })
  expect(draft().user_agent).toBe('synthetic-updated-agent')
  expect(within(screen.getByRole('dialog')).getByText('api_key_header')).toBeTruthy()
  expect(within(area()).queryByText('api_key_header')).toBeNull()
  expect(JSON.stringify(captured.model)).not.toContain('synthetic-updated-agent')
  act(() => { captured.actions.setThinkingType(secret); captured.actions.setFakeClaude('false') })
  expect(draft().thinking_type).toBeUndefined(); expect(draft().fake_cc_system_prompt).toBeUndefined()
})
it('leaves unsupported imported enum values in the host without dropping them', async () => {
  initial.profiles[0].model_configs[0].api_mode = secret
  await open('studio')
  expect(captured.model.controls.map(control => control.key)).toEqual(['service_tier', 'reasoning_effort'])
  expect(JSON.stringify(captured.model)).not.toContain(secret)
  expect(captured.actions.setApiMode).toBeUndefined()
  expect(draft().api_mode).toBe(secret)
  const retained = within(screen.getByRole('dialog')).getByText(secret)
  expect(area().contains(retained)).toBe(false)
  choose('studio', t.models.serviceTier, 'default')
  expect(draft().api_mode).toBe(secret)
})
it('falls back only the failed advanced surface and preserves editable host draft', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  broken = true; await open('studio')
  expect(area().dataset.modelAdvanced).toBe('default')
  expect(ui.id).toBe('studio')
  expect(document.querySelector('[data-model-editor-common]').dataset.modelEditorCommon).toBe('studio')
  choose('default', t.models.apiMode, 'responses')
  expect(draft().api_mode).toBe('responses')
})
it('keeps host validation and confirmation in charge, never issues a save request', async () => {
  initial.profiles[0].apibase = ''
  await open('studio'); choose('studio', t.models.apiMode, 'responses')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close', exact: true }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('button', { name: t.models.saveAll, exact: true }).disabled).toBe(true)
  expect(screen.getByText(t.models.pageHasErrors)).toBeTruthy()
  act(() => host.patchProfile(0, { apibase: 'https://example.invalid/v1' }))
  await waitFor(() => expect(screen.getByRole('button', { name: t.models.saveAll, exact: true }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: t.models.saveAll, exact: true }))
  await waitFor(() => expect(confirmDanger).toHaveBeenCalledTimes(1))
  expect(host.changes.total).toBeGreaterThan(0)
})
it('projects exact enum/boolean values and rejects arbitrary writes at host adapter', () => {
  const change = vi.fn()
  const { model, actions, handled } = modelAdvancedView({ thinking_type: { token: secret }, reasoning_effort: secret, fake_cc_system_prompt: false, extra: { secret } }, 'native_claude', t, change)
  expect(handled).toEqual(['fake_cc_system_prompt'])
  expect(model.controls[0].value).toBe(false)
  expect(JSON.stringify(model)).not.toContain(secret)
  actions.setFakeClaude(secret); actions.setFakeClaude({ value: true }); actions.setFakeClaude(0)
  expect(change).not.toHaveBeenCalled()
  actions.setFakeClaude(true); actions.setFakeClaude(undefined)
  expect(change.mock.calls).toEqual([[{ fake_cc_system_prompt: true }], [{ fake_cc_system_prompt: undefined }]])
})
