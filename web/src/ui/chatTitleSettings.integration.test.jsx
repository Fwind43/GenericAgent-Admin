import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ChatSettingsPage } from '../pages/ChatSettingsPage'
import { useTitleModel } from '../hooks/useTitleModel'
import { I18N, SETTINGS_TEXT } from '../lib/i18n'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { UiHost, UiSurface, useUiPackage } from './UiHost'
import { defaults } from './default'
import { views as studioViews } from './studio'
import { manifest } from './contract'

vi.mock('../lib/api', () => ({ api: vi.fn() }))
vi.mock('../lib/danger', () => ({ confirmDanger: vi.fn() }))
const name = 'admin.settings.chat.title'
const text = SETTINGS_TEXT.en
const choice = JSON.stringify(['fixture', 'offline-model'])
let ui, controller, captured
const setMsg = vi.fn()
const pending = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const section = () => within(document.getElementById('chat-auto-title'))
const toggle = () => document.querySelector('#chat-auto-title input')
const modelSelect = () => section().getByRole('combobox')
const save = () => section().getByRole('button', { name: text.chat.save, exact: true })
const selectPackage = id => act(async () => { await ui.select(id) })
const puts = () => api.mock.calls.filter(([, options]) => options?.method === 'PUT')
function Harness() {
  ui = useUiPackage()
  controller = useTitleModel({ t: I18N.en, lang: 'en', setMsg, active: true })
  return <><ChatSettingsPage t={I18N.en} text={text} titleModel={controller} lang="en" projectProvider="official" projectSettingsDisabled/>
    <UiSurface name="admin.overview" fallback={<p>default-neighbor</p>}/></>
}
async function mount(overrides = {}) {
  const registry = { has: id => ['default', 'studio'].includes(id), load: async id => id === 'default' ? defaults : { manifest: manifest('studio'), views: { ...studioViews, 'admin.overview': () => <p>studio-neighbor</p>, ...overrides } } }
  render(<UiHost packageRegistry={registry}><Harness/></UiHost>)
  await waitFor(() => expect(modelSelect().options.length).toBe(2))
}
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real network') }))
  confirmDanger.mockResolvedValue(true)
  api.mockImplementation(async (url, options) => {
    if (url !== '/api/models/title-model') throw new Error('Unexpected fixture endpoint: ' + url)
    if (options?.method === 'PUT') return { model: JSON.parse(options.body).model }
    if (options) throw new Error('Unexpected fixture options')
    return { model: { enable: false, provider_var_name: '', model: '' }, options: [{ provider_var_name: 'fixture', provider_display_name: 'Offline', model: 'offline-model' }] }
  })
})
afterEach(() => { cleanup(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('uses independent form DOM and preserves host drafts across packages with a whitelist contract', async () => {
  await mount({ [name]: props => { captured = props; return React.createElement(studioViews[name], props) } })
  expect(modelSelect().disabled).toBe(true)
  fireEvent.click(toggle()); fireEvent.change(modelSelect(), { target: { value: choice } })
  const original = modelSelect()
  await selectPackage('studio')
  expect(modelSelect()).not.toBe(original)
  expect(modelSelect().value).toBe(choice); expect(toggle().checked).toBe(true)
  expect(controller.dirty).toBe(true)
  expect(Object.keys(captured.model).sort()).toEqual(['busy', 'dirty', 'draft', 'enabled', 'feedback', 'labels', 'options'])
  expect(Object.keys(captured.actions).sort()).toEqual(['save', 'selectModel', 'setEnabled'])
  expect(Object.keys(captured.model.options[1]).sort()).toEqual(['label', 'value'])
  await selectPackage('default')
  expect(modelSelect().value).toBe(choice); expect(controller.dirty).toBe(true)
})

it.each(['default', 'studio'])('saves enabled, follow and disabled settings with feedback in %s', async id => {
  await mount(); if (id === 'studio') await selectPackage(id)
  fireEvent.click(toggle()); fireEvent.change(modelSelect(), { target: { value: choice } }); fireEvent.click(save())
  await waitFor(() => expect(section().getByRole('status').textContent).toBe(I18N.en.titleModelSaved))
  expect(JSON.parse(puts()[0][1].body)).toEqual({ model: { enable: true, provider_var_name: 'fixture', model: 'offline-model', llm_no: 0 } })
  expect(controller.dirty).toBe(false); expect(setMsg).toHaveBeenCalledWith(I18N.en.titleModelSaved)
  fireEvent.change(modelSelect(), { target: { value: '' } }); fireEvent.click(save())
  await waitFor(() => expect(puts()).toHaveLength(2)); await waitFor(() => expect(controller.saving).toBe(false))
  expect(JSON.parse(puts()[1][1].body).model).toMatchObject({ enable: true, model: '' })
  fireEvent.click(toggle()); expect(modelSelect().disabled).toBe(true); fireEvent.click(save())
  await waitFor(() => expect(puts()).toHaveLength(3)); await waitFor(() => expect(controller.saving).toBe(false))
  expect(JSON.parse(puts()[2][1].body).model).toMatchObject({ enable: false, model: '' })
})

it('retains failed drafts and feedback through a package switch and retries', async () => {
  await mount(); fireEvent.click(toggle()); fireEvent.change(modelSelect(), { target: { value: choice } })
  api.mockRejectedValueOnce(new Error('offline-save-failed')); fireEvent.click(save())
  await waitFor(() => expect(section().getByRole('status').textContent).toBe('offline-save-failed'))
  expect(controller.dirty).toBe(true); expect(controller.saving).toBe(false)
  await selectPackage('studio')
  expect(modelSelect().value).toBe(choice); expect(section().getByRole('status').textContent).toBe('offline-save-failed')
  fireEvent.click(save()); await waitFor(() => expect(controller.dirty).toBe(false))
  expect(section().getByRole('status').textContent).toBe(I18N.en.titleModelSaved)
})

it('locks confirmation and save against duplicate actions and edits across packages, then unlocks', async () => {
  await mount(); fireEvent.click(toggle()); fireEvent.change(modelSelect(), { target: { value: choice } })
  const confirmation = pending(), response = pending()
  confirmDanger.mockReturnValueOnce(confirmation.promise); api.mockReturnValueOnce(response.promise)
  let first, duplicate
  act(() => { first = controller.submit(); duplicate = controller.submit(); controller.setDraft(''); controller.setEnabled(false) })
  expect(await duplicate).toBe(false); expect(confirmDanger).toHaveBeenCalledTimes(1)
  expect(toggle().disabled).toBe(true); expect(modelSelect().disabled).toBe(true)
  await selectPackage('studio'); expect(modelSelect().value).toBe(choice); expect(toggle().checked).toBe(true)
  expect(section().getByRole('button').disabled).toBe(true)
  await act(async () => { confirmation.resolve(true) }); expect(puts()).toHaveLength(1)
  await act(async () => { expect(await controller.submit()).toBe(false) })
  await act(async () => { response.resolve({ model: { enable: true, provider_var_name: 'fixture', model: 'offline-model' } }); await first })
  expect(controller.saving).toBe(false); expect(controller.dirty).toBe(false); expect(puts()).toHaveLength(1)
})

it('unlocks canceled and rejected confirmations without PUT and allows retry', async () => {
  await mount(); fireEvent.click(toggle())
  confirmDanger.mockResolvedValueOnce(false)
  await act(async () => { expect(await controller.submit()).toBe(false) })
  expect(controller.saving).toBe(false); expect(controller.dirty).toBe(true); expect(puts()).toHaveLength(0)
  confirmDanger.mockRejectedValueOnce(new Error('confirmation-failed'))
  await act(async () => { expect(await controller.submit()).toBe(false) })
  expect(section().getByRole('status').textContent).toBe('confirmation-failed'); expect(puts()).toHaveLength(0)
  fireEvent.click(save()); await waitFor(() => expect(controller.dirty).toBe(false))
})

it('falls back only the broken title surface and keeps its draft and neighbor package', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await mount({ [name]: () => { throw new Error('fixture surface failure') } })
  fireEvent.click(toggle()); fireEvent.change(modelSelect(), { target: { value: choice } })
  await selectPackage('studio')
  expect(document.getElementById('settings-auto-title-model')).not.toBeNull()
  expect(modelSelect().value).toBe(choice); expect(controller.dirty).toBe(true)
  expect(screen.getByText('studio-neighbor')).toBeTruthy()
  expect(ui.isFailedSurface(name)).toBe(true); expect(ui.isFailedSurface('admin.overview')).toBe(false)
  fireEvent.click(save()); await waitFor(() => expect(controller.dirty).toBe(false))
})
