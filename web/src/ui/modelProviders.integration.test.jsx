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
const surface = 'admin.models.providers'
let ui, host, captured
const fixture = () => ({ profiles: [{ var_name: 'api_demo', display_name: 'Synthetic provider', type: 'oai', apibase: 'https://user:password@example.invalid/v1/private?token=synthetic#secret', apikey: 'synthetic-secret', model: 'demo-model', models: ['demo-model'] }], failover_groups: [] })
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
function mount({ broken = false } = {}) {
  const registry = createRegistry()
  registry.register(defaults.manifest, async () => defaults)
  const View = studio.views[surface]
  function Capture(props) { captured = props; if (broken) throw new Error('Synthetic directory failure'); return <View {...props}/> }
  registry.register(manifest('studio'), async () => ({ ...studio, views: { ...studio.views, [surface]: Capture, 'admin.overview': () => <span>studio-neighbor</span> } }))
  return render(<UiHost packageRegistry={registry}><Harness/></UiHost>)
}
async function select(id) { await act(async () => { await ui.select(id) }); await waitFor(() => expect(screen.getByTestId('package').textContent).toBe(id)) }
const click = label => fireEvent.click(screen.getByRole('button', { name: label, exact: true }))
const directory = () => document.querySelector('[data-model-providers-layout]')
async function ready(id = 'default') {
  await waitFor(() => expect(host.profiles).toHaveLength(1))
  if (id !== 'default') await select(id)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.models.connections}\\s*\\d+$`) }))
  await waitFor(() => expect(directory()).not.toBeNull())
}
const requests = path => api.mock.calls.filter(([url]) => url === path)
const open = async () => { fireEvent.click(within(directory()).getByRole('button', { name: /^Synthetic provider/ })); return document.querySelector('.model-settings-detail') }
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); captured = null
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden') }))
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })))
  confirmDanger.mockResolvedValue(true)
  api.mockImplementation(async url => {
    if (url === '/api/models/import-mykey') return fixture()
    if (url === '/api/chat/state') return { llms: [] }
    if (url === '/api/models/export') return { ok: true }
    throw new Error(`Unmocked endpoint ${url}`)
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['default', 'studio'])('opens host editor, edits draft and saves only through host in %s', async id => {
  mount(); await ready(id)
  expect(directory().getAttribute('data-model-providers-layout')).toBe(id)
  const dialog = await open()
  fireEvent.change(within(dialog).getByDisplayValue('Synthetic provider'), { target: { value: 'Edited provider' } })
  expect(host.profiles[0].display_name).toBe('Edited provider')
  expect(requests('/api/models/export')).toHaveLength(0)
  fireEvent.click(within(dialog.querySelector('.model-drawer-footer')).getByRole('button', { name: t.close, exact: true }))
  click(t.models.saveAll)
  await waitFor(() => expect(requests('/api/models/export')).toHaveLength(1))
  expect(confirmDanger).toHaveBeenCalledWith('models-save', expect.any(String))
  const options = requests('/api/models/export')[0][1]
  expect(options.dangerous).toBe(true)
  expect(JSON.parse(options.body)).toMatchObject({ overwrite_active: true, profiles: [{ display_name: 'Edited provider', apikey: 'synthetic-secret' }] })
  await waitFor(() => expect(host.changes.total).toBe(0))
  expect(requests('/api/models/raw')).toHaveLength(0)
})
it.each(['default', 'studio'])('reveals the full key without changing the masked draft in %s', async id => {
  const masked = 'sk-****demo'
  let fullKey = 'synthetic-full-key'
  api.mockImplementation(async url => {
    if (url === '/api/models/import-mykey') {
      const data = fixture()
      data.profiles[0].apikey = masked
      return data
    }
    if (url === '/api/chat/state') return { llms: [] }
    if (url === '/api/models/raw') return { profiles: [{ var_name: 'api_demo', apikey: fullKey }] }
    throw new Error(`Unmocked endpoint ${url}`)
  })
  mount(); await ready(id)
  const dialog = await open()
  const input = within(dialog).getByDisplayValue(masked)
  expect(input.type).toBe('password')
  expect(requests('/api/models/raw')).toHaveLength(0)
  fireEvent.click(within(dialog).getByRole('button', { name: t.show, exact: true }))
  await waitFor(() => expect(input.value).toBe(fullKey))
  expect(input.type).toBe('text')
  expect(host.profiles[0].apikey).toBe(masked)
  expect(host.changes.total).toBe(0)
  fullKey = 'synthetic-refreshed-key'
  fireEvent.click(within(dialog).getByRole('button', { name: `${t.models.reread} API Key`, exact: true }))
  await waitFor(() => expect(input.value).toBe(fullKey))
  fireEvent.click(within(dialog).getByRole('button', { name: t.hide, exact: true }))
  await waitFor(() => expect(input.type).toBe('password'))
  expect(input.value).toBe(masked)
  expect(host.profiles[0].apikey).toBe(masked)
  expect(host.changes.total).toBe(0)
  expect(requests('/api/models/raw')).toHaveLength(2)
  expect(requests('/api/models/export')).toHaveLength(0)
})
it('passes a narrow redacted directory contract and keeps drafts/editor through switches', async () => {
  mount(); await ready('studio')
  expect(Object.keys(captured).sort()).toEqual(['actions', 'layout', 'model'])
  expect(Object.keys(captured.actions).sort()).toEqual(['addModel', 'addProvider', 'openProvider', 'removeProvider', 'reorderProviders'])
  expect(Object.keys(captured.model.providers[0]).sort()).toEqual(['endpoint', 'id', 'modelCount', 'name', 'protocol', 'state', 'stateLabel'])
  expect(captured.model.providers[0].endpoint).toBe('https://example.invalid')
  expect(JSON.stringify(captured)).not.toMatch(/synthetic-secret|password|token=|private|apikey|api_demo/)
  const dialog = await open()
  fireEvent.change(within(dialog).getByDisplayValue('Synthetic provider'), { target: { value: 'Retained edit' } })
  const count = api.mock.calls.length
  await select('default')
  expect(screen.getByDisplayValue('Retained edit')).toBeTruthy()
  expect(host.profiles[0].display_name).toBe('Retained edit')
  await select('studio')
  expect(screen.getByDisplayValue('Retained edit')).toBeTruthy()
  expect(api.mock.calls).toHaveLength(count)
  act(() => { captured.actions.openProvider(-1); captured.actions.openProvider('0') })
  expect(screen.getByDisplayValue('Retained edit')).toBeTruthy()
})
it.each(['default', 'studio'])('opens host creation and retains cancel/confirmation boundaries in %s', async id => {
  mount(); await ready(id)
  fireEvent.click(within(directory()).getByRole('button', { name: t.models.addProvider, exact: true }))
  const dialog = await screen.findByRole('dialog')
  expect(host.profiles).toHaveLength(1)
  fireEvent.click(within(dialog).getByRole('button', { name: t.cancel, exact: true }))
  expect(host.profiles).toHaveLength(1)
  const edit = await open()
  fireEvent.change(within(edit).getByDisplayValue('Synthetic provider'), { target: { value: 'Unsaved edit' } })
  fireEvent.click(within(edit.querySelector('.model-drawer-footer')).getByRole('button', { name: t.close, exact: true }))
  confirmDanger.mockResolvedValueOnce(false)
  click(t.models.saveAll)
  await waitFor(() => expect(confirmDanger).toHaveBeenCalled())
  expect(requests('/api/models/export')).toHaveLength(0)
  expect(host.changes.total).toBeGreaterThan(0)
})
it('retains pending import across switching and shows the empty directory after resolution', async () => {
  let resolveImport
  api.mockImplementation(url => url === '/api/models/import-mykey' ? new Promise(resolve => { resolveImport = resolve }) : Promise.resolve({ llms: [] }))
  mount(); await waitFor(() => expect(host.importLoading).toBe(true))
  await select('studio'); fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.models.connections}\\s*\\d+$`) }))
  expect(requests('/api/models/import-mykey')).toHaveLength(1)
  await select('default')
  await act(async () => { resolveImport({ profiles: [], failover_groups: [] }) })
  expect(host.importLoading).toBe(false)
  expect(within(directory()).getByText(t.models.noProvidersHelp)).toBeTruthy()
  await select('studio')
  expect(within(directory()).getByText(t.models.noProvidersHelp)).toBeTruthy()
  expect(requests('/api/models/import-mykey')).toHaveLength(1)
})
it('shows host save failure and retries without losing the draft', async () => {
  mount(); await ready('studio'); const dialog = await open()
  fireEvent.change(within(dialog).getByDisplayValue('Synthetic provider'), { target: { value: 'Retry edit' } })
  fireEvent.click(within(dialog.querySelector('.model-drawer-footer')).getByRole('button', { name: t.close, exact: true }))
  api.mockRejectedValueOnce(new Error('Synthetic save failure'))
  click(t.models.saveAll)
  await waitFor(() => expect(host.saveState.status).toBe('error'))
  expect(screen.getByTestId('message').textContent).toBe('Synthetic save failure')
  await select('default')
  expect(host.profiles[0].display_name).toBe('Retry edit')
  click(t.models.saveAll)
  await waitFor(() => expect(host.changes.total).toBe(0))
  expect(requests('/api/models/export')).toHaveLength(2)
})
it('falls back only the failed directory and preserves the host draft', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mount({ broken: true }); await ready()
  const dialog = await open()
  fireEvent.change(within(dialog).getByDisplayValue('Synthetic provider'), { target: { value: 'Fallback edit' } })
  await select('studio')
  await waitFor(() => expect(directory().getAttribute('data-model-providers-layout')).toBe('default'))
  expect(screen.getByText('studio-neighbor')).toBeTruthy()
  expect(screen.getByDisplayValue('Fallback edit')).toBeTruthy()
  expect(host.profiles[0].display_name).toBe('Fallback edit')
  expect(requests('/api/models/import-mykey')).toHaveLength(1)
  expect(requests('/api/models/export')).toHaveLength(0)
})

it.each(['default', 'studio'])('offers direct provider actions without saving in %s', async id => {
  mount(); await ready(id)
  const actions = directory().querySelector('.model-provider-direct-actions')
  fireEvent.click(within(actions).getByRole('button', { name: t.models.configure, exact: true }))
  const dialog = document.querySelector('.model-settings-detail')
  expect(within(dialog).getByDisplayValue('Synthetic provider')).toBeTruthy()
  fireEvent.click(within(dialog.querySelector('.model-drawer-footer')).getByRole('button', { name: t.close, exact: true }))
  confirmDanger.mockResolvedValueOnce(false)
  fireEvent.click(within(actions).getByRole('button', { name: t.delete, exact: true }))
  await waitFor(() => expect(confirmDanger).toHaveBeenCalled())
  expect(host.profiles).toHaveLength(1)
  expect(requests('/api/models/export')).toHaveLength(0)
  expect(within(actions).getByRole('button', { name: t.models.addModel, exact: true })).toBeTruthy()
})

it.each(['default', 'studio'])('clears provider models only after confirmation without saving in %s', async id => {
  mount(); await ready(id); const dialog = await open()
  const before = structuredClone(host.profiles[0])
  act(() => host.setFailoverGroups([{ var_name: 'test_group', members: [{ provider_var_name: before.var_name, model: 'demo-model' }, { provider_var_name: 'other', model: 'other-model' }] }]))
  const clear = within(dialog).getByRole('button', { name: t.models.clearProviderModels, exact: true })
  confirmDanger.mockResolvedValueOnce(false)
  fireEvent.click(clear)
  await waitFor(() => expect(confirmDanger).toHaveBeenCalledWith('model-provider-clear', expect.any(String)))
  expect(host.profiles[0]).toEqual(before)
  expect(host.failoverGroups[0].members).toHaveLength(2)
  fireEvent.click(clear)
  await waitFor(() => expect(host.profiles[0].models).toEqual([]))
  expect(host.profiles[0]).toMatchObject({ model: '', model_configs: [], apikey: before.apikey, apibase: before.apibase, display_name: before.display_name })
  expect(host.failoverGroups[0].members).toEqual([{ provider_var_name: 'other', model: 'other-model' }])
  expect(clear.disabled).toBe(true)
  expect(requests('/api/models/export')).toHaveLength(0)
})

it('reorders providers without moving model slots, retains the editor, saves and discards', async () => {
  let stored = fixture()
  api.mockImplementation(async (url, options) => {
    if (url === '/api/models/import-mykey') return stored
    if (url === '/api/chat/state') return { llms: [] }
    if (url === '/api/models/export') { stored = JSON.parse(options.body); return { ok: true } }
    throw new Error(`Unmocked endpoint ${url}`)
  })
  mount(); await ready('studio')
  act(() => host.setProfiles([0, 1, 2].map(index => ({ ...host.profiles[0], var_name: `api_demo_${index}`, display_name: `Provider ${index}`, models: [`model-${index}`], model_configs: [{ model: `model-${index}`, sort_order: index }] }))))
  act(() => captured.actions.openProvider(1))
  expect(screen.getByDisplayValue('Provider 1')).toBeTruthy()
  act(() => captured.actions.reorderProviders(0, 2))
  expect(host.profiles.map(p => p.display_name)).toEqual(['Provider 1', 'Provider 2', 'Provider 0'])
  expect(screen.getByDisplayValue('Provider 1')).toBeTruthy()
  expect(host.profiles.map(p => p.model_configs[0].sort_order)).toEqual([1, 2, 0])
  expect(requests('/api/models/export')).toHaveLength(0)
  const draft = host.profiles
  act(() => { captured.actions.reorderProviders(-1, 0); captured.actions.reorderProviders(0, 9); captured.actions.reorderProviders('0', 1) })
  expect(host.profiles).toBe(draft)
  click(t.models.saveAll)
  await waitFor(() => expect(host.changes.total).toBe(0))
  expect(requests('/api/models/export')).toHaveLength(1)
  const saved = JSON.parse(requests('/api/models/export')[0][1].body).profiles
  expect(saved.map(p => p.display_name)).toEqual(['Provider 1', 'Provider 2', 'Provider 0'])
  expect(saved.map(p => p.provider_sort_order)).toEqual([0, 1, 2])
  expect(saved.map(p => p.model_configs[0].sort_order)).toEqual([1, 2, 0])
  await waitFor(() => expect(screen.getByTestId('busy').textContent).toBe('false'))
  act(() => captured.actions.reorderProviders(2, 0))
  expect(host.changes.total).toBeGreaterThan(0)
  act(() => host.discardDraft())
  expect(host.profiles.map(p => p.display_name)).toEqual(['Provider 1', 'Provider 2', 'Provider 0'])
  expect(host.changes.total).toBe(0)
})

it.each(['default', 'studio'])('exposes a dedicated provider drag handle and Chat order help in %s', async id => {
  mount(); await ready(id)
  const first = within(directory()).getByRole('button', { name: `${t.models.reorderProvider}: Synthetic provider` })
  expect(first.disabled).toBe(true)
  act(() => host.setProfiles([0, 1].map(index => ({ ...host.profiles[0], var_name: `api_demo_${index}`, display_name: `Provider ${index}` }))))
  expect(within(directory()).getByText(t.models.providerOrderHelp)).toBeTruthy()
  const handle = within(directory()).getByRole('button', { name: `${t.models.reorderProvider}: Provider 0` })
  expect(handle.disabled).toBe(false)
  expect(handle.getAttribute('aria-roledescription')).toBe('sortable')
  expect(handle.closest('.model-provider-nav-entry').hasAttribute('tabindex')).toBe(false)
  fireEvent.click(within(directory()).getByRole('button', { name: /^Provider 0/ }))
  expect(screen.getByDisplayValue('Provider 0')).toBeTruthy()
  expect(host.profiles.map(p => p.display_name)).toEqual(['Provider 0', 'Provider 1'])
  expect(requests('/api/models/export')).toHaveLength(0)
})
