import React, { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { GeneralPage } from '../pages/GeneralPage'
import { I18N, SETTINGS_TEXT } from '../lib/i18n'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { persistCustomColors, previewCustomColors } from '../themes'
import { UiHost, useUiPackage } from './UiHost'
import { defaults } from './default'
import { views as studioViews } from './studio'
import { manifest } from './contract'

vi.mock('../lib/api', () => ({ api: vi.fn() }))
vi.mock('../lib/danger', () => ({ confirmDanger: vi.fn() }))
vi.mock('../themes', async importOriginal => ({
  ...await importOriginal(),
  getInitialCustomColors: vi.fn(() => ({ accent: '#123456' })),
  previewCustomColors: vi.fn(),
  persistCustomColors: vi.fn(),
}))
const text = SETTINGS_TEXT.en
const initial = { remote_access: true, remote_allow_anonymous: false, port: 8765, backendOnly: 'PRIVATE_SENTINEL' }
let ui, latest, captured
const select = id => act(async () => { await ui.select(id) })
const group = id => fireEvent.click(screen.getByRole('button', { name: text[id].title, exact: true }))
const section = id => within(document.getElementById('general-' + id))
const change = (id, value) => fireEvent.change(id.startsWith('theme-color-') ? section('appearance').getByLabelText(id.slice(12), { exact: true }) : document.getElementById(id), { target: { value } })
function Harness({ busy = false, onSave = () => {} }) {
  ui = useUiPackage()
  const [cfg, setCfg] = useState(initial)
  const [theme, setTheme] = useState('light')
  const [lang, setLang] = useState('en')
  latest = { cfg, theme, lang }
  return <GeneralPage t={I18N.en} text={text} cfg={cfg} setCfg={setCfg} root="" setRoot={()=>{}} savedCfg={initial} onSave={onSave} busy={busy} theme={theme} setTheme={setTheme} lang={lang} onLanguage={setLang} autostart={{ supported: false }} onToggleAutostart={()=>{}}/>
}
function mount(props = {}, overrides = {}) {
  const views = { ...studioViews, ...overrides }
  const registry = { load: async id => id === 'default' ? defaults : { manifest: manifest('studio'), views } }
  return render(<UiHost packageRegistry={registry}><Harness {...props}/></UiHost>)
}
const capture = name => props => { captured[name] = props; const View = studioViews['admin.settings.' + name]; return <View {...props}/> }
beforeEach(() => {
  captured = {}
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in offline tests') }))
  api.mockImplementation(async path => {
    if (path === '/api/auth/status') return { passwordSet: false, managedByEnvironment: false, username: 'tester', backendOnly: 'AUTH_PRIVATE' }
    if (path === '/api/health') return { listen: { address: '127.0.0.1:8765' }, backendOnly: 'HEALTH_PRIVATE' }
    if (path === '/api/auth/password') return {}
    throw new Error('Unexpected mocked API: ' + path)
  })
  confirmDanger.mockResolvedValue(true)
  persistCustomColors.mockImplementation(async draft => ({ ...draft }))
})
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('registers independent appearance/remote DOM, whitelist models and preserves both drafts across packages', async () => {
  mount({}, { 'admin.settings.appearance': capture('appearance'), 'admin.settings.remote': capture('remote') })
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2))
  await select('studio'); group('appearance')
  expect(section('appearance').queryByRole('button', { name: 'Edit colors' })).toBeNull()
  act(() => captured.appearance.actions.colors.begin())
  act(() => captured.appearance.actions.colors.changeColor('accent', '#abcdef'))
  group('remote')
  change('settings-remote-port', '9123')
  fireEvent.change(section('remote').getByPlaceholderText(text.remote.newPassword), { target: { value: 'draft-password' } })
  await select('studio')
  expect(document.getElementById('general-remote').className).toContain('ui-studio-settings')
  expect(document.getElementById('settings-remote-access').type).toBe('checkbox')
  expect(captured.remote.model.newPassword).toBe('draft-password')
  expect(captured.remote.model.port).toBe(9123)
  expect(JSON.stringify(captured.remote.model)).not.toMatch(/PRIVATE_SENTINEL|AUTH_PRIVATE|HEALTH_PRIVATE/)
  expect(captured.remote.model).not.toHaveProperty('cfg')
  group('appearance')
  // Leaving appearance cancels preview intentionally; switching packages alone does not.
  act(() => captured.appearance.actions.colors.begin())
  act(() => captured.appearance.actions.colors.changeColor('accent', '#fedcba'))
  await select('default')
  expect(section('appearance').queryByRole('button', { name: 'Edit colors' })).toBeNull()
  await select('studio')
  expect(captured.appearance.model.colors.draft.accent).toBe('#fedcba')
  expect(document.querySelectorAll('#settings-language')).toHaveLength(1)
  expect(section('appearance').getByRole('link', { name: text.appearance.fontLicense }).getAttribute('href')).toBe('/fonts/misans/MiSans-License.pdf')
  expect(api).toHaveBeenCalledTimes(2)
  expect(persistCustomColors).not.toHaveBeenCalled()
})

it('routes theme/language and color validation, failure, retry, cancel and reset through the host', async () => {
  mount({}, { 'admin.settings.appearance': capture('appearance') })
  await select('studio'); group('appearance')
  change('settings-language', 'zh')
  expect(latest.lang).toBe('zh')
  change('settings-language', 'en')
  fireEvent.click(section('appearance').getByRole('radio', { name: /Dark/ }))
  expect(latest.theme).toBe('dark')
  act(() => captured.appearance.actions.colors.begin())
  act(() => captured.appearance.actions.colors.changeColor('accent', 'not-a-color'))
  expect(captured.appearance.model.colors.canSave).toBe(false)
  await act(async () => { await captured.appearance.actions.colors.save() })
  expect(persistCustomColors).not.toHaveBeenCalled()
  act(() => captured.appearance.actions.colors.changeColor('accent', '#abcdef'))
  persistCustomColors.mockRejectedValueOnce(new Error('fictional failure'))
  await act(async () => { await captured.appearance.actions.colors.save() })
  await waitFor(() => expect(captured.appearance.model.colors.message).toContain('Draft retained'))
  expect(captured.appearance.model.colors.failed).toBe(true)
  expect(captured.appearance.model.colors.draft.accent).toBe('#abcdef')
  await act(async () => { await captured.appearance.actions.colors.save() })
  await waitFor(() => expect(captured.appearance.model.colors.message).toBe('Colors saved.'))
  expect(persistCustomColors).toHaveBeenLastCalledWith({ accent: '#abcdef' }, 'dark')
  act(() => captured.appearance.actions.colors.begin())
  act(() => captured.appearance.actions.colors.restoreDefaults())
  expect(captured.appearance.model.colors.draft).toEqual({})
  act(() => captured.appearance.actions.colors.cancel())
  expect(previewCustomColors).toHaveBeenLastCalledWith({ accent: '#123456' })
  expect(persistCustomColors).toHaveBeenCalledTimes(2)
})

it('retains color save pending state and rejects duplicate actions across a package switch', async () => {
  let resolve
  persistCustomColors.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  mount({}, { 'admin.settings.appearance': capture('appearance') })
  await select('studio'); group('appearance')
  act(() => captured.appearance.actions.colors.begin())
  act(() => captured.appearance.actions.colors.changeColor('accent', '#abcdef'))
  let pending
  act(() => { pending = captured.appearance.actions.colors.save(); void captured.appearance.actions.colors.save() })
  expect(persistCustomColors).toHaveBeenCalledTimes(1)
  await select('default')
  await select('studio')
  expect(captured.appearance.model.colors.busy).toBe(true)
  await act(async () => { resolve({ accent: '#abcdef' }); await pending })
  expect(captured.appearance.model.colors.message).toBe('Colors saved.')
})

it('keeps remote validation, confirmation cancellation, failure, success and removal in host actions', async () => {
  mount({}, { 'admin.settings.remote': capture('remote') })
  await select('studio'); group('remote')
  await waitFor(() => expect(captured.remote.model.authLoaded).toBe(true))
  const fill = (a, b = a) => act(() => { captured.remote.actions.changeNewPassword(a); captured.remote.actions.changeConfirmPassword(b) })
  fill('abcdefgh', 'mismatch')
  await act(async () => { await captured.remote.actions.submitPassword() })
  expect(captured.remote.model.note.message).toBe(text.remote.passwordMismatch)
  fill('short')
  await act(async () => { await captured.remote.actions.submitPassword() })
  expect(captured.remote.model.note.message).toBe(text.remote.passwordTooShort)
  expect(confirmDanger).not.toHaveBeenCalled()
  fill('abcdefgh')
  confirmDanger.mockResolvedValueOnce(false)
  await act(async () => { await captured.remote.actions.submitPassword() })
  expect(api).not.toHaveBeenCalledWith('/api/auth/password', expect.anything())
  api.mockRejectedValueOnce(new Error('fictional password failure'))
  await act(async () => { await captured.remote.actions.submitPassword() })
  expect(captured.remote.model.note.message).toBe('fictional password failure')
  expect(captured.remote.model.newPassword).toBe('abcdefgh')
  await act(async () => { await captured.remote.actions.submitPassword() })
  expect(api).toHaveBeenLastCalledWith('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: '', newPassword: 'abcdefgh', confirmPassword: 'abcdefgh' }) })
  expect(captured.remote.model.passwordSet).toBe(true)
  expect(captured.remote.model.newPassword).toBe('')
  await act(async () => { await captured.remote.actions.removePassword() })
  expect(api).toHaveBeenLastCalledWith('/api/auth/password', { method: 'DELETE' })
  expect(captured.remote.model.passwordSet).toBe(false)
})

it('enforces remote pending/busy guards and saves the config draft without leaking backend fields', async () => {
  const save = vi.fn()
  let resolve
  confirmDanger.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const app = mount({ onSave: save }, { 'admin.settings.remote': capture('remote') })
  await select('studio'); group('remote')
  await waitFor(() => expect(captured.remote.model.authLoaded).toBe(true))
  change('settings-remote-port', '9010')
  fireEvent.click(section('remote').getByRole('button', { name: text.saveChanges }))
  expect(save).toHaveBeenCalledTimes(1)
  act(() => { captured.remote.actions.changeNewPassword('abcdefgh'); captured.remote.actions.changeConfirmPassword('abcdefgh') })
  let pending
  act(() => { pending = captured.remote.actions.submitPassword(); void captured.remote.actions.submitPassword(); captured.remote.actions.changePort('9100') })
  expect(confirmDanger).toHaveBeenCalledTimes(1)
  expect(latest.cfg.port).toBe(9010)
  await select('default')
  expect(section('remote').getByRole('button', { name: text.remote.setPassword }).disabled).toBe(true)
  await act(async () => { resolve(false); await pending })
  await select('studio')
  expect(captured.remote.model.newPassword).toBe('abcdefgh')
  app.unmount()
  mount({ busy: true, onSave: save }, { 'admin.settings.remote': capture('remote'), 'admin.settings.appearance': capture('appearance') })
  await select('studio')
  act(() => { captured.remote.actions.changePort('9999'); captured.remote.actions.changeNewPassword('blocked'); captured.remote.actions.save(); captured.appearance.actions.changeTheme('dark') })
  expect(latest.cfg.port).toBe(8765)
  expect(latest.theme).toBe('light')
  expect(captured.remote.model.newPassword).toBe('')
  expect(save).toHaveBeenCalledTimes(1)
})

it('disables environment-managed password operations and recovers a throwing surface without losing draft', async () => {
  api.mockImplementation(async path => path === '/api/auth/status' ? { passwordSet: true, managedByEnvironment: true } : { listen: {} })
  let broken = false
  const Remote = props => { captured.remote = props; if (broken) throw new Error('fictional render failure'); const View = studioViews['admin.settings.remote']; return <View {...props}/> }
  mount({}, { 'admin.settings.remote': Remote })
  await select('studio'); group('remote')
  await waitFor(() => expect(captured.remote.model.managed).toBe(true))
  expect(section('remote').queryByPlaceholderText(text.remote.newPassword)).toBeNull()
  await act(async () => { await captured.remote.actions.submitPassword(); await captured.remote.actions.removePassword() })
  expect(confirmDanger).not.toHaveBeenCalled()
  change('settings-remote-port', '9001')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  broken = true
  act(() => { captured.remote.actions.changePort('9002') })
  await waitFor(() => expect(ui.isFailedSurface('admin.settings.remote')).toBe(true))
  expect(document.getElementById('settings-remote-port').value).toBe('9002')
  expect(document.getElementById('general-remote').className).not.toContain('ui-studio-settings')
  expect(log).toHaveBeenCalled()
  expect(api).toHaveBeenCalledTimes(2)
})
