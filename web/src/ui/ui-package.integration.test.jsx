import React, { useEffect, useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { writeFileSync } from 'node:fs'
import process from 'node:process'

let evidence = null

// Only ChatApp is a boundary double. App, routing, UiHost, surfaces and
// OverviewPage are real. This does not assert real chat streaming behavior.
const probe = vi.hoisted(() => ({ appMounts: 0, appUnmounts: 0, chatMounts: 0, chatUnmounts: 0, root: null }))
vi.mock('../ChatApp.jsx', () => ({ default: function ChatBoundary({ onOpenSettings }) {
  const [draft, setDraft] = useState('chat boundary draft')
  useEffect(() => { probe.chatMounts++; return () => { probe.chatUnmounts++ } }, [])
  return <div data-testid="chat-boundary"><input aria-label="Boundary draft" value={draft} onChange={e => setDraft(e.target.value)}/><button onClick={onOpenSettings}>Open admin boundary</button></div>
} }))
vi.mock('../App.jsx', async importOriginal => {
  const { default: App } = await importOriginal()
  return { default: function ObservedApp(props) {
    useEffect(() => { probe.appMounts++; return () => { probe.appUnmounts++ } }, [])
    return <App {...props}/>
  } }
})
vi.mock('react-dom/client', async importOriginal => {
  const original = await importOriginal()
  return { ...original, createRoot: (...args) => {
    probe.root = original.createRoot(...args)
    return probe.root
  } }
})
vi.mock('@gsap/react', () => ({ useGSAP: () => {} }))

afterEach(async context => {
  if (process.env.UI_PACKAGE_DIAGNOSTICS && evidence) {
    writeFileSync(`${process.env.UI_PACKAGE_DIAGNOSTICS}.${context.task.name.startsWith('real admin:') ? 'admin' : 'settings'}.json`, JSON.stringify({
      test: context.task.name, state: context.task.result?.state,
      route: location.pathname + location.search,
      selection: localStorage.getItem('ga-admin-ui-package-v1'),
      packages: [...document.querySelectorAll('[data-ui-package]')].map(n => n.getAttribute('data-ui-package')),
      dom: document.body.innerHTML.slice(0, 18000),
      textTail: document.body.textContent.slice(-5000), ...evidence,
      mounts: { app: probe.appMounts, appUnmounts: probe.appUnmounts, chat: probe.chatMounts, chatUnmounts: probe.chatUnmounts },
    }, null, 2))
  }
  if (probe.root) await act(async () => probe.root.unmount())
  document.body.innerHTML = ''
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('real admin: no permanent package controls, saved Studio and business navigation remain', async () => {
  history.replaceState(null, '', '/chat')
  localStorage.clear()
  localStorage.setItem('ga-admin-ui-package-v1', JSON.stringify({ version: 1, id: 'studio' }))
  localStorage.setItem('ga-admin-lang-explicit', '1')
  localStorage.setItem('ga-admin-lang', 'en')
  localStorage.setItem('ga-admin-theme', 'light')
  window.__GA_UI_THEME__ = 'light'
  window.__GA_UI_CUSTOM_COLORS__ = {}
  document.body.innerHTML = '<div id="root"></div>'
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const forbiddenTransports = []
  for (const name of ['WebSocket', 'EventSource', 'XMLHttpRequest']) {
    vi.stubGlobal(name, class { constructor() { forbiddenTransports.push(name); throw new Error(`Forbidden transport: ${name}`) } })
  }
  const errors = []
  vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map(String).join(' ')))
  const fixtures = {
    '/api/ui/theme': { theme: 'light', custom: {} },
    '/api/config': { ga_root: '/virtual/ga', github_mirror: '', proxy_mode: 'off', timezone: 'UTC' },
    '/api/auth/status': { passwordSet: false, managedByEnvironment: false },
    '/api/health': { ok: true },
    '/api/ga/health': { ok: true, inventory: {} },
    '/api/ga/inventory': { checks: [] },
    '/api/risk/catalog': { items: [] },
    '/api/services': [],
    '/api/schedule/tasks': { enabled: true, tasks: [] },
    '/api/autostart/status': { supported: false, enabled: false },
    '/api/version/info': { version: 'fixture' },
    '/api/version/status': {},
    '/api/ga/git-status': { available: false },
    '/api/goals/list': { goals: [] },
  }
  const requests = []
  const unexpected = []
  evidence = { errors, unexpected, requests, forbiddenTransports }
  vi.stubGlobal('fetch', vi.fn(async (input, options = {}) => {
    const url = String(input)
    const method = options.method || 'GET'
    requests.push({ url, method })
    if (method !== 'GET' || !Object.hasOwn(fixtures, url)) {
      unexpected.push({ url, method })
      throw new Error(`Unmapped local request: ${method} ${url}`)
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(fixtures[url]) }
  }))
  await act(async () => { await import('../main.jsx') })
  fireEvent.click(await screen.findByText('Open admin boundary'))
  await screen.findByRole('region', { name: 'Studio overview' }, { timeout: 10000 })
  const adminNode = document.querySelector('.main')
  const chatNode = screen.getByTestId('chat-boundary')
  const noControls = () => {
    expect(document.querySelector('.ui-package-controls')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Interface packages' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Enable Studio/ })).toBeNull()
    expect(adminNode.firstElementChild.className).toBe('admin-mobile-bar')
  }
  noControls()
  expect(document.querySelector('.admin-page-header')).not.toBeNull()
  const healthBefore = requests.filter(r => r.url === '/api/health').length
  fireEvent.click(screen.getByRole('button', { name: /Refresh snapshot/ }))
  await waitFor(() => expect(requests.filter(r => r.url === '/api/health').length).toBeGreaterThan(healthBefore))
  expect(screen.getByTestId('chat-boundary')).toBe(chatNode)
  expect([probe.appMounts, probe.appUnmounts, probe.chatMounts, probe.chatUnmounts]).toEqual([1, 0, 1, 0])

  const nav = await screen.findByRole('complementary', { name: 'Studio workspace navigation' })
  fireEvent.click(within(nav).getByRole('button', { name: /Logs/i }))
  await waitFor(() => expect(location.pathname).toBe('/admin/logs'))
  noControls()
  fireEvent.click(within(nav).getByRole('button', { name: /Overview/i }))
  await waitFor(() => expect(location.pathname).toBe('/admin/overview'))
  await screen.findByRole('region', { name: 'Studio overview' })
  // Existing settings and local drafts remain available without package controls.
  const { SETTINGS_TEXT } = await import('../lib/i18n')
  const passwordInput = container => within(container.querySelector('#general-remote')).getByPlaceholderText(SETTINGS_TEXT.en.remote.newPassword)
  fireEvent.click(within(document.querySelector('.studio-sidebar')).getByRole('button', { name: /General/i }))
  await waitFor(() => expect(document.getElementById('settings-ga-root')).not.toBeNull())
  fireEvent.click(document.querySelector('button[aria-controls="general-remote"]'))
  const settingsDraft = await within(document.querySelector('#general-remote')).findByPlaceholderText(SETTINGS_TEXT.en.remote.newPassword)
  expect(settingsDraft).not.toBeNull()
  fireEvent.change(settingsDraft, { target: { value: 'fictional-unsaved-local-draft' } })
  noControls()
  expect(JSON.parse(localStorage.getItem('ga-admin-ui-package-v1')).id).toBe('studio')
  expect(passwordInput(document)).toBe(settingsDraft)
  expect(settingsDraft.value).toBe('fictional-unsaved-local-draft')
  // HEAD already unmounts Admin on departure. Do not confuse this with select.
  fireEvent.click(within(document.querySelector('.studio-sidebar')).getByRole('button', { name: /Back to chat/i }))
  await waitFor(() => expect(location.pathname).toBe('/chat'))
  await waitFor(() => expect(probe.appUnmounts).toBe(1))
  expect(settingsDraft.isConnected).toBe(false)
  expect(screen.getByTestId('chat-boundary')).toBe(chatNode)
  fireEvent.click(screen.getByText('Open admin boundary'))
  await waitFor(() => expect(probe.appMounts).toBe(2))
  expect([probe.chatMounts, probe.chatUnmounts]).toEqual([1, 0])

  expect(unexpected).toEqual([])
  expect(forbiddenTransports).toEqual([])
  expect(errors).toEqual([])
  console.info('UI integration evidence', JSON.stringify({ requests, mounts: { app: probe.appMounts, chatBoundary: probe.chatMounts }, permanentControlsRemoved: true, realChatStreamingTested: false }))
}, 20000)

// Isolated from the separately diagnosed route roundtrip: real component,
// real UiHost selection and local state; no App or Chat boundary involved.
it('real settings host: package roundtrip retains GeneralPage local draft', async () => {
  probe.root = null
  localStorage.clear()
  document.body.innerHTML = ''
  const errors = []
  const unexpected = []
  const forbiddenTransports = []
  const requests = []
  evidence = { errors, unexpected, forbiddenTransports, requests }
  vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map(String).join(' ')))
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  for (const name of ['WebSocket', 'EventSource', 'XMLHttpRequest']) {
    vi.stubGlobal(name, class { constructor() { forbiddenTransports.push(name); throw new Error(`Forbidden transport: ${name}`) } })
  }
  const fixtures = {
    '/api/config': { ga_root: '/virtual/ga', github_mirror: '', proxy_mode: 'off', timezone: 'UTC' },
    '/api/auth/status': { passwordSet: false, managedByEnvironment: false },
    '/api/health': { ok: true, listen: { address: '127.0.0.1:19090', remote: false } },
  }
  vi.stubGlobal('fetch', vi.fn(async (input, options = {}) => {
    const url = String(input)
    const method = options.method || 'GET'
    requests.push({ url, method })
    if (method !== 'GET' || !['/api/auth/status', '/api/health'].includes(url)) {
      unexpected.push({ url, method })
      throw new Error(`Unmapped local request: ${method} ${url}`)
    }
    return { ok: true, status: 200, json: async () => fixtures[url] }
  }))
  const { I18N, SETTINGS_TEXT } = await import('../lib/i18n')
  const passwordInput = container => within(container.querySelector('#general-remote')).getByPlaceholderText(SETTINGS_TEXT.en.remote.newPassword)
  // Test-only selection harness; this is not a production settings entry.
  const { UiHost, useUiPackage } = await import('./UiHost')
  const { GeneralPage } = await import('../pages/GeneralPage.jsx')
  function SettingsHostHarness() {
    const ui = useUiPackage()
    const [cfg, setCfg] = useState(fixtures['/api/config'])
    const [root, setRoot] = useState('/virtual/ga')
    return <><button onClick={() => ui.select(ui.id === 'studio' ? 'default' : 'studio')}>Harness switch</button>
      <output data-testid="harness-package">{ui.id}</output>
      <GeneralPage t={I18N.en} lang="en" text={SETTINGS_TEXT.en} cfg={cfg} setCfg={setCfg}
        root={root} setRoot={setRoot} savedCfg={fixtures['/api/config']} onSave={() => {}}
        busy={false} theme="light" setTheme={() => {}} onLanguage={() => {}}
        autostart={{ supported: false, enabled: false }} onToggleAutostart={() => {}}/>
    </>
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const { createRoot } = await vi.importActual('react-dom/client')
  const settingsRoot = createRoot(container)
  try {
    await act(async () => settingsRoot.render(<UiHost preview><SettingsHostHarness/></UiHost>))
    const scope = within(container)
    await waitFor(() => expect(scope.getByTestId('harness-package').textContent).toBe('studio'))
    fireEvent.click(container.querySelector('button[aria-controls="general-remote"]'))
    const localPassword = await within(container.querySelector('#general-remote')).findByPlaceholderText(SETTINGS_TEXT.en.remote.newPassword)
    expect(localPassword).not.toBeNull()
    fireEvent.change(localPassword, { target: { value: 'host-local-unsaved-draft' } })
    for (const target of ['default', 'studio']) {
      fireEvent.click(scope.getByRole('button', { name: 'Harness switch' }))
      await waitFor(() => expect(scope.getByTestId('harness-package').textContent).toBe(target))
      // Package views may replace DOM nodes; the host-owned draft must survive.
      expect(passwordInput(container).value).toBe('host-local-unsaved-draft')
    }
    evidence.realSettingsHostRoundtrip = true
  } finally {
    await act(async () => settingsRoot.unmount())
    container.remove()
  }
  expect(unexpected).toEqual([])
  expect(forbiddenTransports).toEqual([])
  expect(errors).toEqual([])
}, 10000)
