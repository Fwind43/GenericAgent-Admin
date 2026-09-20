import React, { StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { UsagePage } from '../pages/UsagePage'
import { api } from '../lib/api'
import { UiHost, UiSurface, useUiPackage } from './UiHost'
import { createRegistry, manifest } from './contract'
import { defaults } from './default'
import * as studio from './studio'
vi.mock('../lib/api', () => ({ api: vi.fn() }))

const surface = 'admin.usage'
let ui, captured
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const fixture = () => ({
  totals: { input_tokens: 2200, output_tokens: 1800, total_tokens: 4000 },
  session_count: 4, sessions_with_usage: 3, assistant_replies: 5, skipped_sessions: 1,
  daily: [{ date: '2026-09-01', assistant_replies: 2, totals: { total_tokens: 30 } }],
  models: [
    { id: 'fake-alpha', name: 'Alpha', assistant_replies: 2, totals: { input_tokens: 1200, output_tokens: 800, total_tokens: 2000 }, private_config: 'NEVER_EXPOSE' },
    { id: 'fake-beta', name: 'Beta', assistant_replies: 3, totals: { input_tokens: 1000, output_tokens: 1000, total_tokens: 2000 } },
  ],
  auth: { token: 'NEVER_EXPOSE' }, config: { endpoint: 'NEVER_EXPOSE' },
})
function Controls() { ui = useUiPackage(); return <output data-testid="package">{ui.id}</output> }
function capture(View) { return function Probe(props) { captured = props; return <View {...props}/> } }
function mount({ broken = false, strict = false, lang = 'en' } = {}) {
  const packageRegistry = createRegistry()
  packageRegistry.register(defaults.manifest, async () => ({ ...defaults, views: { ...defaults.views, [surface]: capture(defaults.views[surface]) } }))
  const Broken = () => { throw new Error('synthetic usage view failure') }
  packageRegistry.register(manifest('studio'), async () => ({ ...studio, views: { ...studio.views, [surface]: broken ? Broken : capture(studio.views[surface]), 'admin.overview': () => <span>studio-neighbor</span> } }))
  const app = <UiHost packageRegistry={packageRegistry}><Controls/><UsagePage lang={lang}/><UiSurface name="admin.overview" viewProps={{}} fallback={<span>default-neighbor</span>}/></UiHost>
  return render(strict ? <StrictMode>{app}</StrictMode> : app)
}
async function select(id) { await act(async () => { await ui.select(id) }); await waitFor(() => expect(screen.getByTestId('package').textContent).toBe(id)) }
const search = () => screen.getByRole('searchbox', { name: 'Filter models' })
const windowSelect = () => screen.getByRole('combobox', { name: 'Heatmap window' })
const refresh = () => screen.getByRole('button', { name: 'Refresh' })
const totals = () => document.getElementById('usage-totals')
beforeEach(() => {
  localStorage.clear(); window.history.replaceState(null, '', '/admin/usage'); captured = null
  api.mockImplementation(path => {
    if (path !== '/api/usage/overview') throw new Error('Unexpected API: ' + path)
    return Promise.resolve(fixture())
  })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden') }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals() })

it.each(['default', 'studio'])('wires filtering, window and refresh without changing cumulative scope in %s', async id => {
  mount(); await screen.findByText('Alpha'); await select(id)
  expect(document.querySelector('[data-usage-layout]').dataset.usageLayout).toBe(id)
  expect(totals().textContent).toContain('4K')
  expect(within(totals()).getByTitle('4,000')).toBeTruthy()
  expect(screen.getByText('1 session files could not be read and were skipped.')).toBeTruthy()
  expect(document.querySelectorAll('.usage-heat-cell')).toHaveLength(51 * 7 + new Date().getDay() + 1)
  fireEvent.change(windowSelect(), { target: { value: '13' } })
  expect(document.querySelectorAll('.usage-heat-cell')).toHaveLength(12 * 7 + new Date().getDay() + 1)
  expect(totals().textContent).toContain('4K')
  fireEvent.change(search(), { target: { value: ' FAKE-BETA ' } })
  expect(screen.queryByText('Alpha')).toBeNull(); expect(screen.getByText('Beta')).toBeTruthy()
  expect(screen.getByText('1 / 2 By model')).toBeTruthy()
  expect(api.mock.calls).toEqual([['/api/usage/overview']])
  fireEvent.change(search(), { target: { value: 'missing' } }); expect(screen.getByText('No matching models')).toBeTruthy()
  const next = fixture(); next.models[1].name = 'Beta refreshed'
  api.mockResolvedValueOnce(next)
  fireEvent.change(search(), { target: { value: 'beta' } }); fireEvent.click(refresh())
  await screen.findByText('Beta refreshed')
  expect(windowSelect().value).toBe('13'); expect(search().value).toBe('beta')
  expect(api.mock.calls).toEqual([['/api/usage/overview'], ['/api/usage/overview']])
  for (const link of document.querySelectorAll('.usage-section-nav a')) expect(document.querySelector(link.getAttribute('href'))).toBeTruthy()
  expect(fetch).not.toHaveBeenCalled()
})

it('preserves host state and only exposes whitelisted formatted data across independent package DOM', async () => {
  mount(); await screen.findByText('Alpha')
  const original = search()
  fireEvent.change(search(), { target: { value: 'beta' } }); fireEvent.change(windowSelect(), { target: { value: '26' } })
  await select('studio')
  expect(search()).not.toBe(original); expect(search().value).toBe('beta'); expect(windowSelect().value).toBe('26')
  expect(document.querySelector('.studio-usage-model-list')).toBeTruthy(); expect(document.querySelector('table')).toBeNull()
  expect(Object.keys(captured.model).sort()).toEqual(['empty', 'error', 'hasData', 'heatmap', 'labels', 'loading', 'metrics', 'modelCount', 'modelQuery', 'rows', 'warning', 'weeks', 'windowOptions'])
  expect(Object.keys(captured.actions).sort()).toEqual(['refresh', 'setModelQuery', 'setWeeks'])
  expect(Object.keys(captured.model.rows[0]).sort()).toEqual(['id', 'input', 'name', 'output', 'replies', 'total'])
  expect(Object.keys(captured.model.heatmap.cells[0]).sort()).toEqual(['date', 'label', 'level'])
  expect(JSON.stringify(captured.model)).not.toContain('NEVER_EXPOSE')
  act(() => { captured.actions.setWeeks(1); captured.actions.setModelQuery({ bad: true }) })
  expect(windowSelect().value).toBe('26'); expect(search().value).toBe('beta')
  await select('default')
  expect(document.querySelector('table')).toBeTruthy(); expect(search().value).toBe('beta'); expect(windowSelect().value).toBe('26')
  expect(api).toHaveBeenCalledTimes(1)
})

it.each(['default', 'studio'])('renders loading, retry and empty states in %s', async id => {
  const pending = deferred(); api.mockReturnValueOnce(pending.promise)
  mount(); await select(id)
  expect(screen.getByText('Aggregating session usage…').getAttribute('role')).toBe('status'); expect(refresh().disabled).toBe(true)
  await act(async () => pending.reject(new Error('synthetic offline failure')))
  expect(screen.getByRole('alert').textContent).toContain('synthetic offline failure')
  expect(totals()).toBeNull()
  api.mockResolvedValueOnce({ ...fixture(), assistant_replies: 0, models: [], daily: [], skipped_sessions: 0 })
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('No token usage has been recorded yet.')
  expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByRole('searchbox')).toBeNull()
  expect(totals()).toBeTruthy(); expect(document.getElementById('usage-activity')).toBeNull()
  expect(api).toHaveBeenCalledTimes(2)
})

it('keeps stale data and filters on refresh failure, then retries', async () => {
  mount(); await screen.findByText('Alpha'); await select('studio')
  fireEvent.change(search(), { target: { value: 'beta' } })
  api.mockRejectedValueOnce(new Error('synthetic refresh failed'))
  fireEvent.click(refresh()); await screen.findByRole('alert')
  await select('default')
  expect(screen.getByRole('alert').textContent).toContain('synthetic refresh failed')
  expect(screen.queryByRole('searchbox')).toBeNull(); expect(totals()).toBeNull()
  expect(captured.model.modelQuery).toBe('beta'); expect(captured.model.hasData).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(api).toHaveBeenCalledTimes(3)
})

it('blocks duplicate actions and keeps in-flight loading across package switches', async () => {
  mount(); await screen.findByText('Alpha'); await select('studio')
  const pending = deferred(); api.mockReturnValueOnce(pending.promise)
  const action = captured.actions.refresh
  act(() => { void action(); void action() })
  expect(api).toHaveBeenCalledTimes(2); expect(refresh().disabled).toBe(true)
  await select('default'); expect(refresh().disabled).toBe(true)
  act(() => { void action() }); expect(api).toHaveBeenCalledTimes(2)
  await act(async () => pending.resolve(fixture()))
  expect(refresh().disabled).toBe(false)
})

it('ignores StrictMode stale completion and releases only the active request', async () => {
  const old = deferred(), active = deferred()
  api.mockReturnValueOnce(old.promise).mockReturnValueOnce(active.promise)
  mount({ strict: true }); expect(api).toHaveBeenCalledTimes(2)
  await act(async () => old.reject(new Error('obsolete failure')))
  expect(screen.queryByRole('alert')).toBeNull(); expect(refresh().disabled).toBe(true)
  await act(async () => active.resolve(fixture()))
  await screen.findByText('Alpha'); expect(refresh().disabled).toBe(false)
})

it('invalidates retained refresh actions and pending completions on unmount', async () => {
  const rendered = mount(); await screen.findByText('Alpha'); await select('studio')
  const action = captured.actions.refresh, pending = deferred()
  api.mockReturnValueOnce(pending.promise)
  act(() => { void action() }); rendered.unmount()
  await act(async () => pending.resolve(fixture()))
  await act(async () => { await action() })
  expect(api).toHaveBeenCalledTimes(2); expect(screen.queryByText('Alpha')).toBeNull()
})

it('falls back only usage while retaining host filters and neighboring Studio surface', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  mount({ broken: true }); await screen.findByText('Alpha')
  fireEvent.change(search(), { target: { value: 'beta' } }); fireEvent.change(windowSelect(), { target: { value: '13' } })
  await select('studio')
  expect(ui.isFailedSurface(surface)).toBe(true)
  expect(document.querySelector('[data-usage-layout]').dataset.usageLayout).toBe('default')
  expect(search().value).toBe('beta'); expect(windowSelect().value).toBe('13')
  expect(screen.getByText('studio-neighbor')).toBeTruthy(); expect(api).toHaveBeenCalledTimes(1)
  expect(errors).toHaveBeenCalled()
})
