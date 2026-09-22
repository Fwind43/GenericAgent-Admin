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
const surface = 'admin.models.calls'
let ui, host, captured, initial, exportError, broken
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
const rowOrder = () => [...directory().querySelectorAll('[data-call-id]')].map(row => row.dataset.callId)
async function ready(id = 'default') {
  await waitFor(() => expect(requests('/api/models/import-mykey')).toHaveLength(1))
  if (id !== 'default') await select(id)
  await waitFor(() => expect(directory()).not.toBeNull())
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.models.callListTitle}\\s*\\d+$`) }))
}
const requests = path => api.mock.calls.filter(([url]) => url === path)
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); captured = null; initial = fixture(); exportError = false; broken = false
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden') }))
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })))
  confirmDanger.mockResolvedValue(true)
  api.mockImplementation(async (url, options) => {
    if (url === '/api/models/import-mykey') return structuredClone(initial)
    if (url === '/api/chat/state') return { llms: [] }
    if (url === '/api/models/export') { if (exportError) throw new Error('Synthetic export failure'); initial = JSON.parse(options.body); return { ok: true } }
    throw new Error(`Unmocked endpoint ${url}`)
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['default', 'studio'])('%s edits and reorders through the host, then saves once', async layout => {
  await mount(layout)
  expect(directory().dataset.modelCallsLayout).toBe(layout)
  expect(rowOrder()).toEqual(['call-a', 'call-b'])
  expect(within(directory()).getByText('Alpha')).toBeTruthy()
  expect(within(directory()).getByRole('button', { name: `${t.models.moveUp} model-a` }).disabled).toBe(true)
  click(`${t.models.configure}: model-a`)
  const dialog = screen.getByRole('dialog')
  fireEvent.change(await within(dialog).findByDisplayValue('Alpha'), { target: { value: 'Edited alpha' } })
  expect(host.profiles[0].model_configs[0].name).toBe('Edited alpha')
  expect(requests('/api/models/export')).toHaveLength(0)
  fireEvent.click(within(dialog).getByRole('button', { name: t.close, exact: true }))
  click(`${t.models.moveDown} model-a`)
  expect(rowOrder()).toEqual(['call-b', 'call-a'])
  expect(host.profiles[0].model_configs.map(c => c.sort_order)).toEqual([1, 0])
  click(t.models.saveAll)
  await waitFor(() => expect(requests('/api/models/export')).toHaveLength(1))
  expect(confirmDanger).toHaveBeenCalledWith('models-save', expect.any(String))
  const [, options] = requests('/api/models/export')[0]
  expect(JSON.parse(options.body)).toMatchObject({ overwrite_active: true, profiles: [{ apikey: 'synthetic-secret', model_configs: [{ name: 'Edited alpha', sort_order: 1 }, { sort_order: 0 }] }] })
  await waitFor(() => expect(host.changes.total).toBe(0))
  expect(requests('/api/models/raw')).toHaveLength(0)
})
it('keeps editor and draft across switches and exposes only display summaries', async () => {
  await mount()
  click(`${t.models.configure}: model-a`)
  fireEvent.change(screen.getByDisplayValue('Alpha'), { target: { value: 'Switch draft' } })
  await act(async () => { await ui.select('studio') })
  expect(screen.getByDisplayValue('Switch draft')).toBeTruthy()
  expect(directory().dataset.modelCallsLayout).toBe('studio')
  const { model, actions } = captured
  expect(Object.keys(captured).sort()).toEqual(['actions', 'layout', 'model'])
  expect(Object.keys(actions).sort()).toEqual(['addGroup', 'addModel', 'addProvider', 'moveDown', 'moveUp', 'openProvider', 'remove', 'reorder', 'toggle'])
  expect(Object.keys(model.rows[0]).sort()).toEqual(['actionName', 'canMoveDown', 'canMoveUp', 'detail', 'expanded', 'group', 'id', 'provider', 'slot', 'title', 'variable'])
  for (const forbidden of ['synthetic-secret', 'apikey', '/private', 'token=synthetic', 'password', 'model_configs', 'profileIndex']) expect(JSON.stringify(model)).not.toContain(forbidden)
  await act(async () => { actions.reorder('call-a', 'call-b') })
  expect(rowOrder()).toEqual(['call-b', 'call-a'])
  await act(async () => { await ui.select('default') })
  expect(rowOrder()).toEqual(['call-b', 'call-a'])
  expect(screen.getByDisplayValue('Switch draft')).toBeTruthy()
  expect(requests('/api/models/export')).toHaveLength(0)
  expect(requests('/api/models/import-mykey')).toHaveLength(1)
})
it.each(['default', 'studio'])('%s keeps deletion behind confirmation and draft-only', async layout => {
  await mount(layout)
  confirmDanger.mockResolvedValue(false)
  click(`${t.delete} model-b`)
  await waitFor(() => expect(confirmDanger).toHaveBeenCalledWith('model-remove', expect.any(String)))
  expect(rowOrder()).toEqual(['call-a', 'call-b'])
  confirmDanger.mockResolvedValue(true)
  click(`${t.delete} model-b`)
  await waitFor(() => expect(rowOrder()).toEqual(['call-a']))
  expect(requests('/api/models/export')).toHaveLength(0)
})
it('retains the host editor and neighboring Studio surface on local failure', async () => {
  await mount('studio')
  click(`${t.models.configure}: model-a`)
  fireEvent.change(screen.getByDisplayValue('Alpha'), { target: { value: 'Fallback draft' } })
  broken = true
  await act(async () => { await ui.select('default'); await ui.select('studio') })
  await waitFor(() => expect(directory().dataset.modelCallsLayout).toBe('default'))
  expect(screen.getByText('studio-neighbor')).toBeTruthy()
  expect(screen.getByDisplayValue('Fallback draft')).toBeTruthy()
  expect(host.profiles[0].model_configs[0].name).toBe('Fallback draft')
  expect(requests('/api/models/export')).toHaveLength(0)
})
it('retains reordered draft after save failure and retries through host confirmation', async () => {
  await mount('studio')
  click(`${t.models.moveDown} model-a`)
  exportError = true
  click(t.models.saveAll)
  await waitFor(() => expect(host.saveState.status).toBe('error'))
  expect(rowOrder()).toEqual(['call-b', 'call-a'])
  expect(host.changes.total).toBeGreaterThan(0)
  exportError = false
  click(t.models.saveAll)
  await waitFor(() => expect(host.changes.total).toBe(0))
  expect(host.saveState.status).toBe('idle')
  expect(rowOrder()).toEqual(['call-b', 'call-a'])
  expect(requests('/api/models/import-mykey')).toHaveLength(2)
  expect(requests('/api/models/export')).toHaveLength(2)
  expect(confirmDanger.mock.calls.filter(([type]) => type === 'models-save')).toHaveLength(2)
})
it.each(['default', 'studio'])('%s handles empty models and host add flow', async layout => {
  initial = { profiles: [], failover_groups: [] }
  await mount(layout)
  expect(directory().querySelectorAll('[data-call-id]')).toHaveLength(0)
  expect(within(directory()).getByText(t.models.noProviders)).toBeTruthy()
  fireEvent.click(within(directory()).getByRole('button', { name: t.models.addProvider, exact: true }))
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(requests('/api/models/export')).toHaveLength(0)
})
it('adds a failover draft and opens the host-owned editor without saving', async () => {
  await mount('studio')
  fireEvent.click(within(directory()).getByRole('button', { name: t.models.addFailoverGroup, exact: true }))
  expect(rowOrder()).toEqual(['call-a', 'call-b', 'failover:0'])
  expect(host.failoverGroups).toHaveLength(1)
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(requests('/api/models/export')).toHaveLength(0)
})
