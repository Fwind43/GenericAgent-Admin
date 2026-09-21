import React, { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { GeneralPage } from '../pages/GeneralPage'
import { I18N, SETTINGS_TEXT } from '../lib/i18n'
import { UiHost, useUiPackage } from './UiHost'
import { defaults } from './default'
import { views as studioViews } from './studio'
import { manifest } from './contract'
import { generalSettingsModels } from './generalSettings.js'

vi.mock('../lib/api', () => ({ api: vi.fn(async path => {
  if (path === '/api/auth/status') return { passwordSet: false }
  if (path === '/api/health') return { listen: {} }
  throw new Error('Unexpected test API: ' + path)
}) }))

const t = I18N.en
const text = SETTINGS_TEXT.en
const initial = { ga_root: '/fictional/ga', python_path: '', chat_data_dir: '', proxy_mode: 'off', github_mirror: '', backendOnly: { marker: 'DO_NOT_FORWARD' } }
let ui, latest, captured
const registry = (views = studioViews) => ({ load: async id => id === 'default' ? defaults : { manifest: manifest('studio'), views } })
function Harness({ busy = false, supported = true, failSave = false, onSaved = () => {}, onToggle = () => {} }) {
  ui = useUiPackage()
  const [cfg, setCfg] = useState(initial)
  const [root, setRoot] = useState(initial.ga_root)
  const [saved, setSaved] = useState(initial)
  const [error, setError] = useState('')
  latest = { cfg, root, saved }
  const save = () => {
    if (failSave) { setError('Fictional save failed'); return }
    const next = { ...cfg, ga_root: root }; setSaved(next); onSaved(next)
  }
  return <><GeneralPage t={t} text={text} lang="en" cfg={cfg} setCfg={setCfg} root={root} setRoot={setRoot} savedCfg={saved} onSave={save} busy={busy} theme="light" setTheme={()=>{}} onLanguage={()=>{}} autostart={{ supported, enabled: false, path: '/fictional/startup' }} onToggleAutostart={onToggle}/><output>{error}</output></>
}
const mount = (props = {}, views) => render(<UiHost packageRegistry={registry(views)}><Harness {...props}/></UiHost>)
const group = id => fireEvent.click(screen.getByRole('button', { name: text[id].title, exact: true }))
const section = id => within(document.getElementById('general-' + id))
const change = (id, value) => fireEvent.change(document.getElementById(id), { target: { value } })
const select = id => act(async () => { await ui.select(id) })
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); captured = null })

it('projects only display fields and registers all three real settings surfaces', () => {
  const models = generalSettingsModels({ cfg: initial, root: initial.ga_root, text, t, dirty: false, busy: false, autostart: { supported: true } })
  expect(JSON.stringify(models)).not.toContain('backendOnly')
  expect(JSON.stringify(models)).not.toContain('DO_NOT_FORWARD')
  for (const id of ['paths', 'network', 'startup']) {
    expect(defaults.views['admin.settings.' + id]).toBeTypeOf('function')
    expect(studioViews['admin.settings.' + id]).toBeTypeOf('function')
    expect(models[id].canSave).toBe(false)
    for (const field of models[id].fields) expect(field.label).toBeTruthy()
  }
})

it('edits real controller drafts in Studio, preserves them on Default and saves through the controller', async () => {
  const saved = vi.fn(); const toggle = vi.fn()
  mount({ onSaved: saved, onToggle: toggle })
  await select('studio')
  group('paths')
  expect(document.getElementById('general-paths').querySelector('form')).not.toBeNull()
  change('settings-ga-root', '/fictional/new-root')
  change('settings-python-path', '/fictional/python')
  change('settings-chat-data', '/fictional/chat')
  group('network')
  expect(document.getElementById('settings-http-proxy')).toBeNull()
  change('settings-proxy-mode', 'custom')
  for (const [id, value] of [['http-proxy','http://127.0.0.1:7890'],['https-proxy','http://127.0.0.1:7891'],['all-proxy','socks5://127.0.0.1:7890'],['no-proxy','localhost'],['github-mirror','https://mirror.example']]) change('settings-' + id, value)
  expect(latest.cfg.backendOnly).toEqual(initial.backendOnly)
  await select('default')
  expect(document.getElementById('general-network').querySelector('form')).toBeNull()
  expect(document.getElementById('settings-http-proxy').value).toBe('http://127.0.0.1:7890')
  group('paths')
  expect(document.getElementById('settings-ga-root').value).toBe('/fictional/new-root')
  fireEvent.click(section('paths').getByRole('button', { name: text.saveChanges }))
  expect(saved).toHaveBeenCalledTimes(1)
  expect(saved.mock.calls[0][0]).toMatchObject({ ga_root: '/fictional/new-root', python_path: '/fictional/python', chat_data_dir: '/fictional/chat', no_proxy: 'localhost', backendOnly: initial.backendOnly })
  expect(section('paths').getByRole('button', { name: text.saveChanges }).disabled).toBe(true)
  group('startup')
  fireEvent.click(section('startup').getByRole('switch'))
  expect(toggle).toHaveBeenCalledTimes(1)
})

it('isolates a throwing paths view, preserving drafts and the healthy network and startup views', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(()=>{})
  const views = { ...studioViews, 'admin.settings.paths': () => { throw new Error('fictional paths crash') } }
  mount({}, views)
  group('paths'); change('settings-ga-root', '/fictional/kept')
  await select('studio')
  await waitFor(() => expect(ui.isFailedSurface('admin.settings.paths')).toBe(true))
  expect(document.getElementById('settings-ga-root').value).toBe('/fictional/kept')
  expect(document.getElementById('general-paths').querySelector('form')).toBeNull()
  expect(document.getElementById('general-network').dataset.settingsView).toBe('studio')
  expect(document.getElementById('general-startup').dataset.settingsView).toBe('studio')
  expect(ui.id).toBe('studio')
  expect(error).toHaveBeenCalled()
})

it('guards named actions even if a candidate calls them while busy or unsupported', async () => {
  const views = { ...studioViews }
  // Render a benign candidate while retaining its exact capability object.
  views['admin.settings.paths'] = props => { captured = props; return <div hidden={props.hidden}/> }
  const saved = vi.fn(); const toggle = vi.fn()
  mount({ busy: true, supported: false, onSaved: saved, onToggle: toggle }, views)
  await select('studio')
  expect(Object.keys(captured).sort()).toEqual(['actions', 'hidden', 'layout', 'model'])
  expect(Object.keys(captured.actions).sort()).toEqual(['changeChatData', 'changePython', 'changeRoot', 'save'])
  act(() => { captured.actions.changeRoot('/forbidden'); captured.actions.changePython('/forbidden'); captured.actions.save() })
  expect(latest.root).toBe(initial.ga_root)
  expect(latest.cfg.python_path).toBe('')
  expect(saved).not.toHaveBeenCalled()
  group('startup'); expect(section('startup').getByRole('switch').disabled).toBe(true)
  fireEvent.click(section('startup').getByRole('switch'))
  expect(toggle).not.toHaveBeenCalled()
})

it('keeps the draft after save failure and hides inactive groups without duplicate controls', async () => {
  mount({ failSave: true })
  await select('studio')
  group('paths'); change('settings-ga-root', '/fictional/retry')
  fireEvent.click(section('paths').getByRole('button', { name: text.saveChanges }))
  expect(screen.getByText('Fictional save failed')).not.toBeNull()
  expect(latest.saved.ga_root).toBe(initial.ga_root)
  expect(latest.root).toBe('/fictional/retry')
  expect(section('paths').getByRole('button', { name: text.saveChanges }).disabled).toBe(false)
  expect(document.getElementById('general-network').hidden).toBe(true)
  expect(document.querySelectorAll('#settings-ga-root')).toHaveLength(1)
  group('network'); change('settings-proxy-mode', 'system')
  expect(document.getElementById('settings-http-proxy')).toBeNull()
  expect(document.getElementById('general-paths').hidden).toBe(true)
})

it('does not expose external UI plugin settings', () => {
  mount()
  expect(screen.queryByRole('button', { name: /UI plugins/i })).toBeNull()
  expect(screen.getByRole('button', { name: text.appearance.title, exact: true })).not.toBeNull()
  expect(document.querySelector('input[type=file][accept*=zip]')).toBeNull()
})
