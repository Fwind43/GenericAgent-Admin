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
const staticCatalog = [
  {
    "path": "/api/models",
    "level": "dangerous",
    "action": "save_model_draft",
    "reason": "writes GA Admin model draft profiles, including provider endpoints and credentials when supplied"
  },
  {
    "path": "/api/models/raw",
    "level": "dangerous",
    "action": "reveal_model_secrets",
    "reason": "returns unmasked model provider credentials after explicit dangerous authorization"
  },
  {
    "path": "/api/models/import-mykey",
    "level": "dangerous",
    "action": "import_mykey_models",
    "reason": "can execute mykey import and reveal or persist provider credentials when explicitly authorized"
  },
  {
    "path": "/api/models/discover",
    "level": "reversible",
    "action": "discover_provider_models",
    "reason": "queries the selected provider models endpoint without saving configuration"
  },
  {
    "path": "/api/models/export",
    "level": "dangerous",
    "action": "export_models",
    "reason": "writes active GA model configuration"
  },
  {
    "path": "/api/models/title-model",
    "level": "reversible",
    "action": "set_chat_title_model",
    "reason": "changes the model used for chat title generation"
  }
]
const t = I18N.en
const riskSurface = 'admin.models.risks'
const rawPreview = 'SYNTHETIC RAW PREVIEW secret-never-in-package'
const fixture = () => ({ profiles: [{ var_name: 'api_demo', display_name: 'Synthetic provider', type: 'oai', apibase: 'https://example.invalid/v1', apikey: 'synthetic-key-not-real', model: 'model-a', models: ['model-a'], model_configs: [{ model: 'model-a', name: 'Alpha', instance_id: 'call-a', sort_order: 0, extra: {} }] }], failover_groups: [] })
let ui, host, captured, initial, broken, unknown, catalogItems, catalogError
function Harness() {
  const [message, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  ui = useUiPackage()
  host = useModelsConfig({ t, active: true, setBusy, setMsg, lang: 'en' })
  return <><output data-testid="package">{ui.id}</output><output data-testid="message">{message}</output><output data-testid="busy">{String(busy)}</output>
    <Models {...host} t={t} addModelProfiles={host.addProfiles} removeModelProfile={host.removeProfile} modelPreview={host.preview} onRevealKey={host.revealKey} onClearRevealedKey={host.clearRevealedKey} riskCatalog={catalogItems} riskCatalogError={catalogError} />
  </>
}
const transfer = () => document.querySelector('[data-model-transfer]')
const risks = () => document.querySelector('[data-model-risks]')
async function openRisks() { fireEvent.click(screen.getByRole('button', { name: `collapsed ${t.models.riskTitle}`, exact: true })); await waitFor(() => expect(risks()).not.toBeNull()) }
const click = label => fireEvent.click(within(transfer()).getByRole('button', { name: label, exact: true }))
const requests = path => api.mock.calls.filter(([url]) => url === path)
async function select(id) { await act(async () => { await ui.select(id) }); await waitFor(() => expect(screen.getByTestId('package').textContent).toBe(id)) }
async function mount(layout) {
  const registry = createRegistry()
  registry.register(defaults.manifest, async () => defaults)
  const views = { ...studio.views }
  for (const name of [riskSurface]) {
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
  localStorage.clear(); vi.clearAllMocks(); captured = {}; initial = fixture(); broken = ''; unknown = []; catalogItems = structuredClone(staticCatalog); catalogError = ''
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden') }))
  vi.stubGlobal('XMLHttpRequest', class { constructor() { throw new Error('Real XHR forbidden') } })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  confirmDanger.mockResolvedValue(false)
  api.mockImplementation(async (url, options) => {
    if (!['/api/models/import-mykey', '/api/chat/state', '/api/models/preview', '/api/models/export'].includes(url)) { unknown.push(url); throw new Error(`Unmocked endpoint ${url}`) }
    if (url === '/api/models/import-mykey') return structuredClone(initial)
    if (url === '/api/chat/state') return { llms: [] }
    if (url === '/api/models/preview') return { python: rawPreview }
    initial = JSON.parse(options.body); return { ok: true }
  })
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(unknown).toEqual([]); cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['default', 'studio'])('%s renders audited risk details without side effects', async layout => {
  await mount(layout); await openRisks()
  expect(risks().dataset.modelRisks).toBe(layout)
  expect(within(risks()).getByText(t.models.riskReady)).toBeTruthy()
  for (const item of staticCatalog) expect(within(risks()).getByText(item.reason)).toBeTruthy()
  expect(risks().querySelectorAll(layout === 'default' ? 'tr' : 'article')).toHaveLength(6)
  expect(confirmDanger).not.toHaveBeenCalled()
  expect(requests('/api/models/export')).toHaveLength(0)
})

it.each(['default', 'studio'])('%s keeps missing gates and unavailable detail visible in host', async layout => {
  catalogItems = []; catalogError = 'SYNTHETIC unsafe catalog error'
  await mount(layout); await openRisks()
  expect(within(risks()).getByText(t.models.riskUnavailable)).toBeTruthy()
  expect(within(risks()).getByRole('alert').textContent).toContain('/api/models/export')
  expect(within(risks()).getByRole('alert').textContent).toContain('/api/models/import-mykey')
  expect(screen.getByText(catalogError, { exact: true })).toBeTruthy()
  expect(risks().textContent).not.toContain(catalogError)
})

it('exposes only audited tuples and scalar projection; retains poisoned fields in host', async () => {
  const poisons = ['route', 'method', 'level', 'action', 'reason']
  catalogItems.push(...poisons.map(field => ({ ...staticCatalog[0], [field]: field === 'route' ? '/api/models/SYNTHETIC-route' : `SYNTHETIC-${field}` })))
  catalogError = 'SYNTHETIC-error'
  await mount('studio'); await openRisks()
  const props = captured[riskSurface]
  expect(Object.keys(props).sort()).toEqual(['layout', 'view'])
  expect(Object.keys(props.view).sort()).toEqual(['errors', 'hostItemCount', 'items', 'labels', 'missingGates', 'total', 'unavailable', 'warnings'])
  expect(props.view.items).toHaveLength(6)
  expect(props.view.hostItemCount).toBe(5)
  expect(Object.values(props.view.labels).every(value => typeof value === 'string')).toBe(true)
  for (const item of props.view.items) expect(Object.keys(item).sort()).toEqual(['action', 'id', 'level', 'method', 'path', 'reason'])
  const encoded = JSON.stringify(props)
  for (const secret of ['SYNTHETIC', 'synthetic-key-not-real', 'api_demo', 'model-a', rawPreview, 'example.invalid']) expect(encoded).not.toContain(secret)
  const retained = document.querySelector('[data-model-risk-host-details]')
  for (const field of poisons) expect(retained.textContent.toLowerCase()).toContain(`synthetic-${field}`)
  expect(retained.textContent).toContain(catalogError)
})

it.each(['default', 'studio'])('%s preserves validation blocking and dirty draft across package switch', async layout => {
  initial.profiles[0].apibase = ''
  await mount(layout); await dirty(); await openRisks()
  expect(within(transfer()).getByRole('button', { name: t.models.saveAll, exact: true }).disabled).toBe(true)
  click(t.models.saveAll)
  expect(confirmDanger).not.toHaveBeenCalled()
  expect(screen.getByText(t.models.pageHasErrors)).toBeTruthy()
  const snapshot = JSON.stringify(host.profiles)
  await select(layout === 'studio' ? 'default' : 'studio')
  expect(JSON.stringify(host.profiles)).toBe(snapshot)
  expect(host.changes.total).toBeGreaterThan(0)
  expect(requests('/api/models/export')).toHaveLength(0)
})

it('falls back only the risk surface while preserving host draft and unsafe details', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  catalogError = 'SYNTHETIC retained on fallback'
  await mount('studio'); await dirty(); broken = riskSurface; await openRisks()
  await waitFor(() => expect(risks().dataset.modelRisks).toBe('default'))
  expect(transfer().dataset.modelTransfer).toBe('studio')
  expect(screen.getByTestId('package').textContent).toBe('studio')
  expect(screen.getByText(catalogError, { exact: true })).toBeTruthy()
  expect(host.changes.total).toBeGreaterThan(0)
  expect(requests('/api/models/export')).toHaveLength(0)
})

it('renders empty catalog without hiding missing write confirmation coverage', async () => {
  catalogItems = []
  await mount('studio'); await openRisks()
  expect(within(risks()).getByText(t.models.riskEmpty)).toBeTruthy()
  expect(within(risks()).getByRole('alert')).toBeTruthy()
  expect(captured[riskSurface].view.items).toEqual([])
})
