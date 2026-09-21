import React, { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ChatSettingsPage } from '../pages/ChatSettingsPage'
import { setAutoCollapseProcess, AUTO_COLLAPSE_PROCESS_KEY } from '../hooks/useAutoCollapseProcess'
import { I18N, SETTINGS_TEXT } from '../lib/i18n'
import { api } from '../lib/api'
import { UiHost, UiSurface, useUiPackage } from './UiHost'
import { defaults } from './default'
import { views as studioViews } from './studio'
import { manifest } from './contract'

vi.mock('../lib/api', () => ({ api: vi.fn(() => { throw new Error('No API permitted in runtime settings fixture') }) }))
const project = 'admin.settings.chat.project', process = 'admin.settings.chat.process'
let ui, captured, disabled
const saveMode = vi.fn()
const title = { enabled: false, draft: '', saving: false, dirty: false, feedback: '', options: [], setEnabled: vi.fn(), setDraft: vi.fn(), submit: vi.fn() }
const projectSection = () => within(document.getElementById('chat-project-mode'))
const processSection = () => within(document.getElementById('chat-process-display'))
const mode = () => projectSection().getByRole('combobox')
const save = () => projectSection().getByRole('button')
const toggle = () => document.querySelector('#chat-process-display input')
const selectPackage = id => act(async () => { await ui.select(id) })
const pending = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function Harness() {
  ui = useUiPackage()
  const [provider, setProvider] = useState('official')
  return <><ChatSettingsPage t={I18N.en} text={SETTINGS_TEXT.en} titleModel={title} lang="en" projectProvider={provider} projectSettingsDisabled={disabled}
    onSaveProjectProvider={async value => { const saved = await saveMode(value); setProvider(saved); return saved }}/>
    <UiSurface name="admin.overview" fallback={<p>default-neighbor</p>}/></>
}
function mount(overrides = {}) {
  const views = { ...studioViews, 'admin.overview': () => <p>studio-neighbor</p> }
  for (const name of [project, process]) views[name] = props => { captured[name] = props; return React.createElement(studioViews[name], props) }
  Object.assign(views, overrides)
  const registry = { has: id => ['default', 'studio'].includes(id), load: async id => id === 'default' ? defaults : { manifest: manifest('studio'), views } }
  render(<UiHost packageRegistry={registry}><Harness/></UiHost>)
}
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); captured = {}; disabled = false
  setAutoCollapseProcess(true)
  saveMode.mockImplementation(async value => value)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real network') }))
})
afterEach(() => {
  cleanup(); expect(fetch).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled()
  expect(title.submit).not.toHaveBeenCalled(); expect(title.setDraft).not.toHaveBeenCalled(); expect(title.setEnabled).not.toHaveBeenCalled()
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})

it('preserves drafts and immediate preferences across independent package DOM with whitelisted contracts', async () => {
  mount(); await projectSection().findByRole('combobox')
  const originalMode = mode(), originalToggle = toggle()
  fireEvent.change(mode(), { target: { value: 'admin' } }); fireEvent.click(toggle())
  expect(localStorage.getItem(AUTO_COLLAPSE_PROCESS_KEY)).toBe('false')
  await selectPackage('studio')
  expect(mode()).not.toBe(originalMode); expect(toggle()).not.toBe(originalToggle)
  expect(mode().value).toBe('admin'); expect(toggle().checked).toBe(false)
  expect(captured[project].model.dirty).toBe(true)
  expect(Object.keys(captured[project].model).sort()).toEqual(['busy', 'dirty', 'disabled', 'draft', 'feedback', 'labels', 'options'])
  expect(Object.keys(captured[project].actions).sort()).toEqual(['save', 'selectMode'])
  expect(Object.keys(captured[process].model).sort()).toEqual(['enabled', 'feedback', 'labels'])
  expect(Object.keys(captured[process].actions)).toEqual(['setEnabled'])
  act(() => { captured[project].actions.selectMode('invalid'); captured[process].actions.setEnabled('invalid') })
  expect(mode().value).toBe('admin'); expect(toggle().checked).toBe(false)
  await selectPackage('default')
  expect(mode().value).toBe('admin'); expect(toggle().checked).toBe(false); expect(saveMode).not.toHaveBeenCalled()
})

it.each(['default', 'studio'])('saves only project mode and applies process preferences immediately in %s', async id => {
  mount(); if (id === 'studio') await selectPackage(id)
  fireEvent.click(toggle()); expect(localStorage.getItem(AUTO_COLLAPSE_PROCESS_KEY)).toBe('false')
  expect(saveMode).not.toHaveBeenCalled(); expect(processSection().queryByRole('button')).toBeNull()
  fireEvent.change(mode(), { target: { value: 'admin' } }); fireEvent.click(save())
  await waitFor(() => expect(projectSection().getByRole('status').textContent).toContain('Saved.'))
  expect(saveMode.mock.calls).toEqual([['admin']]); expect(save().disabled).toBe(true)
  expect(localStorage.getItem(AUTO_COLLAPSE_PROCESS_KEY)).toBe('false')
  fireEvent.change(mode(), { target: { value: 'official' } }); fireEvent.click(save())
  await waitFor(() => expect(save().disabled).toBe(true))
  expect(saveMode.mock.calls).toEqual([['admin'], ['official']])
})

it('retains failed save feedback and draft across a switch, releases busy and retries', async () => {
  mount(); saveMode.mockRejectedValueOnce(new Error('fictional-save-failure'))
  fireEvent.change(mode(), { target: { value: 'admin' } }); fireEvent.click(save())
  await waitFor(() => expect(projectSection().getByRole('status').textContent).toBe('fictional-save-failure'))
  await selectPackage('studio')
  expect(mode().value).toBe('admin'); expect(captured[project].model.busy).toBe(false)
  expect(projectSection().getByRole('status').textContent).toBe('fictional-save-failure')
  fireEvent.click(save()); await waitFor(() => expect(captured[project].model.dirty).toBe(false))
  expect(saveMode).toHaveBeenCalledTimes(2)
})

it('blocks synchronous duplicate saves and stale actions while pending across package changes', async () => {
  mount(); await selectPackage('studio')
  fireEvent.change(mode(), { target: { value: 'admin' } })
  const response = pending(); saveMode.mockReturnValueOnce(response.promise)
  const actions = captured[project].actions
  act(() => { void actions.save(); void actions.save(); actions.selectMode('official') })
  expect(saveMode).toHaveBeenCalledTimes(1); expect(mode().disabled).toBe(true); expect(mode().value).toBe('admin')
  await selectPackage('default'); expect(save().disabled).toBe(true)
  act(() => { void actions.save(); actions.selectMode('official') })
  expect(saveMode).toHaveBeenCalledTimes(1); expect(mode().value).toBe('admin')
  await act(async () => { response.resolve('admin'); await response.promise })
  expect(mode().disabled).toBe(false); expect(save().disabled).toBe(true)
})

it('honors host disabled guard even when a custom surface calls actions', async () => {
  disabled = true; mount(); await selectPackage('studio')
  act(() => { captured[project].actions.selectMode('admin'); void captured[project].actions.save() })
  expect(mode().disabled).toBe(true); expect(mode().value).toBe('official'); expect(saveMode).not.toHaveBeenCalled()
})

it('keeps memory preference with feedback after storage failure and persists on retry', async () => {
  mount(); await selectPackage('studio')
  const original = Storage.prototype.setItem
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === AUTO_COLLAPSE_PROCESS_KEY) throw new Error('fictional-storage-failure')
    return original.call(this, key, value)
  })
  fireEvent.click(toggle()); expect(toggle().checked).toBe(false)
  expect(localStorage.getItem(AUTO_COLLAPSE_PROCESS_KEY)).toBe('true')
  expect(processSection().getByRole('status').textContent).toContain('session only')
  await selectPackage('default'); expect(toggle().checked).toBe(false)
  expect(processSection().getByRole('status').textContent).toContain('session only')
  storage.mockRestore(); await selectPackage('studio')
  act(() => captured[process].actions.setEnabled(false))
  expect(localStorage.getItem(AUTO_COLLAPSE_PROCESS_KEY)).toBe('false'); expect(processSection().queryByRole('status')).toBeNull()
  act(() => captured[process].actions.setEnabled(false))
  expect(localStorage.getItem(AUTO_COLLAPSE_PROCESS_KEY)).toBe('false'); expect(saveMode).not.toHaveBeenCalled()
})

it.each([project, process])('falls back only the broken %s surface without losing host state', async broken => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mount({ [broken]: () => { throw new Error('fictional-render-failure') } })
  fireEvent.change(mode(), { target: { value: 'admin' } }); fireEvent.click(toggle())
  await selectPackage('studio')
  expect(ui.id).toBe('studio'); expect(ui.isFailedSurface(broken)).toBe(true)
  expect(ui.isFailedSurface(broken === project ? process : project)).toBe(false)
  expect(screen.getByText('studio-neighbor')).toBeTruthy()
  expect(mode().value).toBe('admin'); expect(toggle().checked).toBe(false)
  expect(document.getElementById(broken === project ? 'settings-project-mode' : 'settings-auto-collapse-process')).toBeTruthy()
  fireEvent.click(save()); await waitFor(() => expect(save().disabled).toBe(true))
  expect(saveMode.mock.calls).toEqual([['admin']])
})
