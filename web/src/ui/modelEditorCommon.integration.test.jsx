import React, { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Models } from '../pages/ModelsPage'
import { useModelsConfig } from '../hooks/useModelsConfig'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { I18N } from '../lib/i18n'
import { UiHost, UiSurface, useUiPackage } from './UiHost'
import { createRegistry, manifest } from './contract'
import { defaults } from './default'
import * as studio from './studio'

vi.mock('../lib/api', () => ({ api: vi.fn(), apiStream: vi.fn(), apiHeaders: vi.fn(), parseApiResponse: vi.fn() }))
vi.mock('../lib/danger', () => ({ confirmDanger: vi.fn() }))
const t = I18N.en
const surface = 'admin.models.editor.common'
let ui, host, captured, initial, exportError, broken, releaseExport, deferExport
const fixture = () => ({ profiles: [{ var_name: 'api_demo', display_name: 'Synthetic provider', type: 'oai', apibase: 'https://user:password@example.invalid/v1/private?token=synthetic#secret', apikey: 'synthetic-secret', model: 'model-a', models: ['model-a', 'model-b'], model_configs: [
  { model: 'model-a', name: 'Alpha', instance_id: 'call-a', sort_order: 0, extra: {} },
  { model: 'model-b', name: 'Beta', instance_id: 'call-b', sort_order: 1, extra: {} },
] }], failover_groups: [] })
function Harness() {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  ui = useUiPackage()
  host = useModelsConfig({ t, active: true, setBusy, setMsg, lang: 'en' })
  return <><output data-testid="package">{ui.id}</output><output data-testid="message">{msg}</output><output data-testid="busy">{String(busy)}</output>
    <UiSurface name="admin.overview" viewProps={{}} fallback={<span>default-neighbor</span>}/>
    <Models {...host} t={t} addModelProfiles={host.addProfiles} removeModelProfile={host.removeProfile} modelPreview={host.preview} getProfileKey={host.getProfileKey} onRevealKey={host.revealKey} onClearRevealedKey={host.clearRevealedKey}/>
  </>
}
async function mount(layout = 'default') {
  const registry = createRegistry()
  registry.register(defaults.manifest, async () => defaults)
  const View = studio.views[surface]
  function Capture(props) { captured = props; if (broken) throw new Error('Synthetic directory failure'); return <View {...props}/> }
  registry.register(manifest('studio'), async () => ({ ...studio, views: { ...studio.views, [surface]: Capture, 'admin.overview': () => <span>studio-neighbor</span> } }))
  render(<UiHost packageRegistry={registry}><Harness/></UiHost>)
  await ready(layout)
}
async function select(id) { await act(async () => { await ui.select(id) }); await waitFor(() => expect(screen.getByTestId('package').textContent).toBe(id)) }
const click = label => fireEvent.click(screen.getByRole('button', { name: label, exact: true }))
const directory = () => document.querySelector('[data-model-calls-layout]')
const editor = () => document.querySelector('[data-model-editor-common]')
const edit = (label, value) => fireEvent.change(within(editor()).getByLabelText(label), { target: { value } })
async function open(layout = 'default') { await mount(layout); click(`${t.models.configure}: model-a`); await waitFor(() => expect(editor()).not.toBeNull()) }
async function ready(id = 'default') {
  await waitFor(() => expect(requests('/api/models/import-mykey')).toHaveLength(1))
  if (id !== 'default') await select(id)
  await waitFor(() => expect(directory()).not.toBeNull())
}
const requests = path => api.mock.calls.filter(([url]) => url === path)
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); captured = null; initial = fixture(); exportError = false; broken = false; deferExport = false; releaseExport = null
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden') }))
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  confirmDanger.mockResolvedValue(true)
  api.mockImplementation(async (url, options) => {
    if (url === '/api/models/import-mykey') return structuredClone(initial)
    if (url === '/api/chat/state') return { llms: [] }
    if (url === '/api/models/export') { if (deferExport) await new Promise(resolve => { releaseExport = resolve }); if (exportError) throw new Error('Synthetic export failure'); initial = JSON.parse(options.body); return { ok: true } }
    throw new Error(`Unmocked endpoint ${url}`)
  })
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(requests('/api/models/raw')).toHaveLength(0); cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['default', 'studio'])('%s edits all common fields without requests and retains host conversions', async layout => {
  await open(layout)
  expect(editor().dataset.modelEditorCommon).toBe(layout)
  expect(editor().querySelectorAll('fieldset')).toHaveLength(layout === 'studio' ? 3 : 0)
  for (const [label, value] of [[t.models.displayName, 'Draft name'], ['temperature', '0.7'], ['max_tokens', '400'], ['max_retry_after', '12'], [t.models.maxRetries, '4'], [t.models.readTimeout, '90'], [t.models.connectTimeout, '8']]) edit(label, value)
  for (const label of ['omit_thinking', t.models.stream]) {
    const combobox = within(editor()).getByRole('combobox', { name: label, exact: true })
    // Use this combobox's keyboard path: test-mode Select IDs are not unique.
    // The fixture starts at inherit; production options are inherit/enabled/disabled.
    act(() => combobox.focus())
    const press = (key, code) => {
      fireEvent.keyDown(combobox, { key, code: key === ' ' ? 'Space' : key, keyCode: code, which: code })
      fireEvent.keyUp(combobox, { key, code: key === ' ' ? 'Space' : key, keyCode: code, which: code })
    }
    const observe = step => {
      const state = { layout, label, step, targetName: combobox.getAttribute('aria-label'), focused: document.activeElement === combobox, expanded: combobox.getAttribute('aria-expanded'), activeDescendant: combobox.getAttribute('aria-activedescendant') }
      console.info('common-editor Select keyboard', state)
      return state
    }
    press(' ', 32)
    observe('open')
    await waitFor(() => {
      expect(document.activeElement).toBe(combobox)
      expect(combobox.getAttribute('aria-expanded')).toBe('true')
      expect(combobox.getAttribute('aria-activedescendant')).toBe(`${combobox.getAttribute('aria-controls')}_0`)
    })
    // Observe only the target input's state, never resolve its duplicate ID globally.
    for (const index of [1, 2]) {
      press('ArrowDown', 40)
      observe(`ArrowDown -> ${index}`)
      await waitFor(() => expect(combobox.getAttribute('aria-activedescendant')).toBe(`${combobox.getAttribute('aria-controls')}_${index}`))
    }
    press('Enter', 13)
    const draft = host.profiles[0].model_configs[0]
    const value = label === t.models.stream ? draft.stream : draft.extra.omit_thinking
    console.info('common-editor Select draft', { layout, label, value, valueType: typeof value })
    if (label === t.models.stream) expect(draft.stream).toBe(false)
  }
  expect(host.profiles[0].model_configs[0]).toMatchObject({ name: 'Draft name', max_retries: 4, read_timeout: 90, connect_timeout: 8, stream: false, extra: { temperature: 0.7, max_tokens: 400, max_retry_after: 12, omit_thinking: false } })
  edit('temperature', '')
  expect(host.profiles[0].model_configs[0].extra.temperature).toBeUndefined()
  expect(host.changes.total).toBeGreaterThan(0)
  expect(requests('/api/models/export')).toHaveLength(0)
  expect(confirmDanger).not.toHaveBeenCalled()
})
it.each(['native_oai', 'oai', 'native_claude', 'claude'])('%s keeps protocol fields in the host outside the common surface', async protocol => {
  initial.profiles[0].type = protocol
  await open('studio')
  const dialog = screen.getByRole('dialog')
  const claude = protocol.includes('claude')
  expect(within(dialog).queryByText(t.models.apiMode) !== null).toBe(!claude)
  expect(within(dialog).queryByText(t.models.thinkingType) !== null).toBe(claude)
  expect(within(dialog).queryByText('User-Agent') !== null).toBe(protocol === 'native_claude')
  expect(within(editor()).queryByText(t.models.apiMode)).toBeNull()
  expect(within(editor()).queryByText(t.models.thinkingType)).toBeNull()
  edit(t.models.displayName, 'Protocol draft')
  expect(host.profiles[0].type).toBe(protocol)
  expect(requests('/api/models/export')).toHaveLength(0)
})
it('projects only the scalar whitelist, preserves drafts through switching and local fallback', async () => {
  initial.profiles[0].model_configs[0].extra = { auth: { token: 'fiction-only' }, user_agent: 'private-agent-fixture' }
  await open('studio')
  expect(Object.keys(captured).sort()).toEqual(['actions', 'layout', 'model'])
  expect(Object.keys(captured.model).sort()).toEqual(['help', 'labels', 'modelId', 'title', 'values'])
  expect(Object.keys(captured.model.values).sort()).toEqual(['connectTimeout', 'maxRetries', 'maxRetryAfter', 'maxTokens', 'name', 'omitThinking', 'readTimeout', 'stream', 'temperature'])
  expect(Object.keys(captured.actions).sort()).toEqual(['setConnectTimeout', 'setMaxRetries', 'setMaxRetryAfter', 'setMaxTokens', 'setName', 'setOmitThinking', 'setReadTimeout', 'setStream', 'setTemperature'])
  expect(JSON.stringify(captured)).not.toMatch(/synthetic-secret|password|fiction-only|private-agent|apikey|apibase|auth/)
  edit(t.models.displayName, 'Surviving draft')
  await select('default'); expect(screen.getByDisplayValue('Surviving draft')).toBeTruthy()
  await select('studio')
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  broken = true
  act(() => host.setProfiles(current => [...current]))
  await waitFor(() => expect(editor().dataset.modelEditorCommon).toBe('default'))
  expect(screen.getByDisplayValue('Surviving draft')).toBeTruthy()
  expect(screen.getByText('studio-neighbor')).toBeTruthy()
  expect(directory().dataset.modelCallsLayout).toBe('studio')
  expect(host.profiles[0].model_configs[0].extra.auth.token).toBe('fiction-only')
  expect(requests('/api/models/export')).toHaveLength(0)
  spy.mockRestore()
})
it('host owns cancel, busy, failed save and retry without losing editor drafts', async () => {
  await open('studio'); edit(t.models.displayName, 'Saved draft')
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
  confirmDanger.mockResolvedValueOnce(false)
  click(t.models.saveAll)
  await waitFor(() => expect(confirmDanger).toHaveBeenCalledTimes(1))
  expect(requests('/api/models/export')).toHaveLength(0)
  deferExport = true; exportError = true
  click(t.models.saveAll)
  await waitFor(() => expect(screen.getByTestId('busy').textContent).toBe('true'))
  expect(host.saveState.status).toBe('saving')
  await act(async () => releaseExport())
  await waitFor(() => expect(host.saveState.status).toBe('error'))
  expect(screen.getByTestId('message').textContent).toBe('Synthetic export failure')
  expect(host.profiles[0].model_configs[0].name).toBe('Saved draft')
  expect(host.changes.total).toBeGreaterThan(0)
  deferExport = false; exportError = false
  click(t.models.saveAll)
  await waitFor(() => expect(requests('/api/models/export')).toHaveLength(2))
  await waitFor(() => expect(host.changes.total).toBe(0))
  expect(JSON.parse(requests('/api/models/export')[1][1].body).profiles[0].model_configs[0].name).toBe('Saved draft')
  expect(confirmDanger.mock.calls.every(([kind]) => kind === 'models-save')).toBe(true)
})
it('host validation blocks saving invalid provider data without granting the surface save actions', async () => {
  initial.profiles[0].apibase = ''
  await open('studio'); edit(t.models.displayName, 'Invalid draft')
  expect(screen.getByRole('button', { name: t.models.saveAll, exact: true }).disabled).toBe(true)
  expect(screen.getByText(t.models.pageHasErrors)).toBeTruthy()
  expect(requests('/api/models/export')).toHaveLength(0)
})
