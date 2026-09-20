import React, { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Models } from '../pages/ModelsPage'
import { useModelsConfig } from '../hooks/useModelsConfig'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { I18N } from '../lib/i18n'
import { UiHost, useUiPackage } from './UiHost'
import { createRegistry, manifest } from './contract'
import { defaults } from './default'
import * as studio from './studio'

vi.mock('../lib/api', () => ({ api: vi.fn(), apiStream: vi.fn(), apiHeaders: vi.fn(), parseApiResponse: vi.fn() }))
vi.mock('../lib/danger', () => ({ confirmDanger: vi.fn() }))
const t = I18N.en
const transferSurface = 'admin.models.transfer'
const previewSurface = 'admin.models.preview.controls'
const rawPreview = 'SYNTHETIC RAW PREVIEW secret-never-in-package'
const fixture = () => ({ profiles: [{ var_name: 'api_demo', display_name: 'Synthetic provider', type: 'oai', apibase: 'https://example.invalid/v1', apikey: 'synthetic-key-not-real', model: 'model-a', models: ['model-a'], model_configs: [{ model: 'model-a', name: 'Alpha', instance_id: 'call-a', sort_order: 0, extra: {} }] }], failover_groups: [] })
let ui, host, captured, initial, fail, hold, release, broken, unknown
function Harness() {
  const [message, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  ui = useUiPackage()
  host = useModelsConfig({ t, active: true, setBusy, setMsg, lang: 'en' })
  return <><output data-testid="package">{ui.id}</output><output data-testid="message">{message}</output><output data-testid="busy">{String(busy)}</output>
    <Models {...host} t={t} addModelProfiles={host.addProfiles} removeModelProfile={host.removeProfile} modelPreview={host.preview} onRevealKey={host.revealKey} onClearRevealedKey={host.clearRevealedKey} riskCatalogError="Synthetic catalog unavailable" />
  </>
}
const transfer = () => document.querySelector('[data-model-transfer]')
const controls = () => document.querySelector('[data-model-preview-controls]')
const click = label => fireEvent.click(within(transfer()).getByRole('button', { name: label, exact: true }))
const requests = path => api.mock.calls.filter(([url]) => url === path)
async function select(id) { await act(async () => { await ui.select(id) }); await waitFor(() => expect(screen.getByTestId('package').textContent).toBe(id)) }
async function mount(layout) {
  const registry = createRegistry()
  registry.register(defaults.manifest, async () => defaults)
  const views = { ...studio.views }
  for (const name of [transferSurface, previewSurface]) {
    const View = views[name]
    views[name] = function Capture(props) { captured[name] = props; if (broken === name) throw new Error('Synthetic surface failure'); return <View {...props} /> }
  }
  registry.register(manifest('studio'), async () => ({ ...studio, views }))
  render(<UiHost packageRegistry={registry}><Harness /></UiHost>)
  await waitFor(() => expect(host.profiles).toHaveLength(1))
  if (layout === 'studio') await select(layout)
  expect(transfer().dataset.modelTransfer).toBe(layout)
}
async function dirty() {
  fireEvent.click(screen.getByRole('button', { name: `${t.models.configure}: model-a`, exact: true }))
  const editor = await waitFor(() => { const node = document.querySelector('[data-model-editor-common]'); expect(node).not.toBeNull(); return node })
  fireEvent.change(within(editor).getByLabelText(t.models.displayName), { target: { value: 'Synthetic draft' } })
  await waitFor(() => expect(host.changes.total).toBeGreaterThan(0))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close', exact: true }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); captured = {}; initial = fixture(); fail = ''; hold = ''; release = null; broken = ''; unknown = []
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden') }))
  vi.stubGlobal('XMLHttpRequest', class { constructor() { throw new Error('Real XHR forbidden') } })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  confirmDanger.mockResolvedValue(false)
  api.mockImplementation(async (url, options) => {
    if (!['/api/models/import-mykey', '/api/chat/state', '/api/models/preview', '/api/models/export'].includes(url)) { unknown.push(url); throw new Error(`Unmocked endpoint ${url}`) }
    if (hold === url) await new Promise(resolve => { release = resolve })
    if (fail === url) throw new Error('Synthetic request failed')
    if (url === '/api/models/import-mykey') return structuredClone(initial)
    if (url === '/api/chat/state') return { llms: [] }
    if (url === '/api/models/preview') return { python: rawPreview }
    initial = JSON.parse(options.body); return { ok: true }
  })
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(unknown).toEqual([]); cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['default', 'studio'])('%s rereads without saving and keeps preview content in host', async layout => {
  await mount(layout)
  click(t.models.rereadConfig)
  await waitFor(() => expect(requests('/api/models/import-mykey')).toHaveLength(2))
  expect(JSON.parse(requests('/api/models/import-mykey')[1][1].body)).toEqual({ reveal: false, save: false })
  click(t.models.configPreview)
  await waitFor(() => expect(document.querySelector('.model-preview-pre').textContent).toBe(rawPreview))
  expect(controls().dataset.modelPreviewControls).toBe(layout)
  expect(within(controls()).getByText(t.models.previewSecret)).toBeTruthy()
  expect(controls().textContent).not.toContain(rawPreview)
  fireEvent.click(within(controls()).getByRole('button', { name: t.models.refreshPreview, exact: true }))
  await waitFor(() => expect(requests('/api/models/preview')).toHaveLength(2))
  expect(JSON.parse(requests('/api/models/preview')[1][1].body).profiles[0].apikey).toBe('synthetic-key-not-real')
  expect(requests('/api/models/export')).toHaveLength(0)
  expect(confirmDanger).not.toHaveBeenCalled()
})

it.each(['default', 'studio'])('%s preserves save confirmation cancellation, busy state, failure and retry', async layout => {
  await mount(layout)
  expect(within(transfer()).getByRole('button', { name: t.models.saveAll, exact: true }).disabled).toBe(true)
  await dirty()
  click(t.models.saveAll)
  await waitFor(() => expect(confirmDanger).toHaveBeenCalledTimes(1))
  expect(confirmDanger).toHaveBeenLastCalledWith('models-save', expect.stringContaining('mykey.py'))
  expect(requests('/api/models/export')).toHaveLength(0)
  confirmDanger.mockResolvedValue(true); fail = hold = '/api/models/export'
  click(t.models.saveAll)
  await waitFor(() => expect(release).toBeTypeOf('function'))
  expect(screen.getByTestId('busy').textContent).toBe('true')
  expect(within(transfer()).getByRole('button', { name: t.models.discard, exact: true }).disabled).toBe(true)
  await act(async () => { release() })
  await waitFor(() => expect(host.saveState.status).toBe('error'))
  expect(screen.getByText('Synthetic request failed', { selector: '.ant-alert-description' })).toBeTruthy()
  expect(host.changes.total).toBeGreaterThan(0)
  fail = hold = ''; click(t.models.saveAll)
  await waitFor(() => expect(host.changes.total).toBe(0))
  expect(requests('/api/models/export')).toHaveLength(2)
  expect(requests('/api/models/export')[1][1].dangerous).toBe(true)
  expect(JSON.parse(requests('/api/models/export')[1][1].body).overwrite_active).toBe(true)
})

it.each(['default', 'studio'])('%s keeps host discard confirmation and cancellation', async layout => {
  await mount(layout); await dirty(); click(t.models.discard)
  await waitFor(() => expect(confirmDanger).toHaveBeenCalledTimes(1))
  expect(confirmDanger).toHaveBeenLastCalledWith('models-discard', t.models.discardConfirm)
  expect(host.changes.total).toBeGreaterThan(0)
  confirmDanger.mockResolvedValue(true)
  click(t.models.discard)
  await waitFor(() => expect(host.changes.total).toBe(0))
  expect(confirmDanger).toHaveBeenCalledTimes(2)
  expect(requests('/api/models/export')).toHaveLength(0)
})

it('passes exact non-sensitive whitelists, preserving risk errors and blocked save', async () => {
  initial.profiles[0].apibase = ''
  await mount('studio'); await dirty()
  expect(within(transfer()).getByRole('button', { name: t.models.saveAll, exact: true }).disabled).toBe(true)
  click(t.models.saveAll)
  expect(confirmDanger).not.toHaveBeenCalled()
  click(t.models.configPreview)
  await waitFor(() => expect(captured[previewSurface]).toBeTruthy())
  expect(Object.keys(captured[transferSurface]).sort()).toEqual(['actions', 'layout', 'transfer'])
  expect(Object.keys(captured[transferSurface].actions).sort()).toEqual(['discard', 'openPreview', 'reread', 'save'])
  expect(Object.keys(captured[transferSurface].transfer).sort()).toEqual(['dirty', 'discardDisabled', 'draftLabel', 'importing', 'labels', 'saveDisabled', 'saveTitle', 'saving'])
  expect(Object.keys(captured[previewSurface]).sort()).toEqual(['actions', 'layout', 'preview'])
  expect(Object.keys(captured[previewSurface].preview).sort()).toEqual(['notice', 'refreshLabel'])
  expect(Object.keys(captured[previewSurface].actions)).toEqual(['refresh'])
  const encoded = JSON.stringify(captured)
  for (const secret of ['synthetic-key-not-real', rawPreview, 'Synthetic catalog unavailable', 'api_demo', 'model-a']) expect(encoded).not.toContain(secret)
  expect(screen.getByText(t.models.pageHasErrors)).toBeTruthy()
  expect(requests('/api/models/export')).toHaveLength(0)
})

it.each([transferSurface, previewSurface])('falls back only failed %s while preserving host draft', async surface => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await mount('studio'); await dirty(); broken = surface
  click(t.models.configPreview)
  await waitFor(() => expect((surface === transferSurface ? transfer() : controls()).dataset[surface === transferSurface ? 'modelTransfer' : 'modelPreviewControls']).toBe('default'))
  expect((surface === transferSurface ? controls() : transfer()).dataset[surface === transferSurface ? 'modelPreviewControls' : 'modelTransfer']).toBe('studio')
  expect(screen.getByTestId('package').textContent).toBe('studio')
  expect(host.changes.total).toBeGreaterThan(0)
  expect(requests('/api/models/export')).toHaveLength(0)
})
