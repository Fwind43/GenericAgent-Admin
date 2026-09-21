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
const open = async () => { fireEvent.click(within(directory()).getByRole('button', { name: /Synthetic provider/ })); return screen.findByRole('dialog') }
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
it('passes a narrow redacted directory contract and keeps drafts/editor through switches', async () => {
  mount(); await ready('studio')
  expect(Object.keys(captured).sort()).toEqual(['actions', 'layout', 'model'])
  expect(Object.keys(captured.actions).sort()).toEqual(['addModel', 'addProvider', 'openProvider', 'removeProvider'])
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
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByDisplayValue('Synthetic provider')).toBeTruthy()
  fireEvent.click(within(dialog.querySelector('.model-drawer-footer')).getByRole('button', { name: t.close, exact: true }))
  confirmDanger.mockResolvedValueOnce(false)
  fireEvent.click(within(actions).getByRole('button', { name: t.delete, exact: true }))
  await waitFor(() => expect(confirmDanger).toHaveBeenCalled())
  expect(host.profiles).toHaveLength(1)
  expect(requests('/api/models/export')).toHaveLength(0)
  expect(within(actions).getByRole('button', { name: t.models.addModel, exact: true })).toBeTruthy()
})
