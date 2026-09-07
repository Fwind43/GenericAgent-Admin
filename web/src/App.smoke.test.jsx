import { readFileSync } from 'node:fs'
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChannelServiceTable } from './components/common.jsx'
import App from './App.jsx'
import { ChannelsPage } from './pages/ChannelsPage.jsx'
import { I18N } from './lib/i18n.js'
import { ChatMessage, GoalStatusCard, PlanTodoCard, ProviderModelCascade, SessionAutorunBadge, groupRuntimeModels } from './ChatApp.jsx'
import { Models } from './pages/ModelsPage.jsx'
import { draftChangeSummary } from './lib/modelsEditor.js'
import { FilesPage } from './pages/FilesPage.jsx'
import { DEFAULT_THEME_ID, getTheme, THEMES } from './themes'
import { UsagePage } from './pages/UsagePage.jsx'
import { registerDialogAdapter } from './lib/danger.js'

// D2: deterministic GSAP stub — real tweens run on rAF timers and made the
// Models call list assertions flaky in CI (targets mid-animation).
vi.mock('gsap', () => {
  const makeTimeline = () => {
    const tl = {}
    for (const k of ['to', 'from', 'fromTo', 'set', 'add', 'kill', 'play', 'pause', 'clear']) {
      tl[k] = vi.fn(() => tl)
    }
    return tl
  }
  const gsapStub = {
    registerPlugin: vi.fn(),
    context: vi.fn(() => ({ revert: vi.fn(), kill: vi.fn() })),
    timeline: vi.fn(makeTimeline),
    set: vi.fn(),
    from: vi.fn(),
    to: vi.fn(),
    fromTo: vi.fn(),
    killTweensOf: vi.fn(),
    utils: { selector: () => () => [] },
  }
  return { default: gsapStub, gsap: gsapStub }
})
vi.mock('@gsap/react', () => ({ useGSAP: vi.fn() }))

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}))
vi.mock('mermaid', () => ({
  default: {
    initialize: mermaidMocks.initialize,
    render: mermaidMocks.render,
  },
}))

const appStyles = readFileSync('src/style.css', 'utf8')
const adminMobileStyles = readFileSync('src/admin-mobile.css', 'utf8')

globalThis.React = React

const t = {
  ...I18N.en,
  refresh: 'Refresh',
  save: 'Save',
  busy: 'Busy',
  empty: 'Empty',
  start: 'Start',
  stop: 'Stop',
  logs: 'Logs',
  running: 'Running',
  stopped: 'Stopped',
  autostart: 'Autostart',
  desc: { channels: 'Channel services' },
  lists: { frontendServices: 'Frontend services' },
  hints: { savedSecret: 'saved secret' },
  hide: 'Hide',
  show: 'Show',
}


const jsonResponse = (body) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: async () => JSON.stringify(body),
  json: async () => body,
})

const installBrowserPolyfills = () => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

const setupFetch = vi.fn(async (url) => {
  const path = String(url)
  if (path.includes('/api/config')) return jsonResponse({ ga_root: '' })
  if (path.includes('/api/ga/health')) return jsonResponse({ ok: false, error: 'GA root not configured' })
  if (path.includes('/api/autostart/status')) return jsonResponse({ supported: false, enabled: false })
  if (path.includes('/api/version/info')) return jsonResponse({ version: 'test' })
  if (path.includes('/api/version/status')) return jsonResponse({})
  if (path.includes('/api/observability/status')) return jsonResponse({ ok: false })
  if (path.includes('/api/setup/state')) return jsonResponse({ status: 'needs_setup', env: {}, ga_root: '' })
  throw new Error(`unexpected url ${url}`)
})

const reflectService = {
  name: 'agentmain --reflect',
  kind: 'reflect',
  running: false,
  autostart: false,
  command: ['agentmain', '--reflect'],
}


let unregisterDialogAdapter = () => {}
const mockDialog = (result = true) => {
  const adapter = vi.fn(() => result)
  unregisterDialogAdapter()
  unregisterDialogAdapter = registerDialogAdapter(adapter)
  return adapter
}

afterEach(() => {
  unregisterDialogAdapter()
  unregisterDialogAdapter = () => {}
  cleanup()
  mermaidMocks.initialize.mockReset()
  mermaidMocks.render.mockReset()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('chat session badges', () => {
  test('shows Autorun only on the enabled target session', () => {
    const { rerender } = render(<SessionAutorunBadge enabled sessionId="session-a" targetSessionId="session-a" />)

    const badge = screen.getByLabelText(/Autorun/)
    expect(badge.textContent).toBe('Autorun')
    expect(badge.classList.contains('oa-session-autorun-badge')).toBe(true)

    rerender(<SessionAutorunBadge enabled sessionId="session-b" targetSessionId="session-a" />)
    expect(screen.queryByText('Autorun')).toBeNull()

    rerender(<SessionAutorunBadge enabled={false} sessionId="session-a" targetSessionId="session-a" />)
    expect(screen.queryByText('Autorun')).toBeNull()
  })
})

describe('channel frontend gates', () => {
  test('ChannelsPage leaves the page heading to the app shell', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(jsonResponse({ profiles: [] })))

    const { container } = render(
      <ChannelsPage
        frontendSvcs={[]}
        t={t}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onLogs={vi.fn()}
        onAutostart={vi.fn()}
        onReflectStart={vi.fn()}
      />,
    )

    await waitFor(() => expect(container.querySelector('.channels-layout')).toBeTruthy())
    expect(container.querySelector('header, h1, h2')).toBeNull()
    expect(container.querySelector('.channel-tabs [role="tab"]')).toBeTruthy()
  })

  test('ChannelsPage edits one channel at a time and keeps the write target in reach', async () => {
    const profiles = [
      { id: 'feishu', name: 'Feishu', testable: true, fields: [{ name: 'fs_app_id', label: 'App ID', value: 'cli_a' }] },
      { id: 'telegram', name: 'Telegram', testable: true, fields: [{ name: 'tg_bot_token', label: 'Bot Token', secret: true, has_value: false, value: '' }] },
    ]
    globalThis.fetch = vi.fn(() => Promise.resolve(jsonResponse({ path: '/ga/mykey.py', profiles })))

    const { container } = render(
      <ChannelsPage
        frontendSvcs={[]}
        t={t}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onLogs={vi.fn()}
        onAutostart={vi.fn()}
        onReflectStart={vi.fn()}
      />,
    )

    const feishuEntry = await screen.findByRole('button', { name: /Lark/ })
    expect(feishuEntry.getAttribute('aria-current')).toBe('true')
    expect(screen.getByLabelText('App ID')).toBeTruthy()
    expect(screen.queryByLabelText('Bot Token')).toBeNull()
    expect(container.querySelector('.channel-commit-path code').textContent).toBe('/ga/mykey.py')

    fireEvent.click(screen.getByRole('button', { name: /Telegram/ }))
    expect(screen.getByLabelText('Bot Token')).toBeTruthy()
    expect(screen.queryByLabelText('App ID')).toBeNull()

    fireEvent.change(screen.getByLabelText('Bot Token'), { target: { value: 'token-1' } })
    expect((await screen.findByRole('status')).textContent).toMatch(/1 channel with unsaved changes/i)
  })

  test('ChannelsPage switches accessible task tabs with pointer and keyboard', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(jsonResponse({ profiles: [] })))

    const { container } = render(
      <ChannelsPage
        frontendSvcs={[]}
        t={t}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onLogs={vi.fn()}
        onAutostart={vi.fn()}
        onReflectStart={vi.fn()}
      />,
    )

    const configTab = await screen.findByRole('tab', { name: /Channel config/i })
    const servicesTab = screen.getByRole('tab', { name: /Service management/i })
    const configPanel = container.querySelector('#channel-panel-config')
    const servicesPanel = container.querySelector('#channel-panel-services')

    expect(configTab.getAttribute('aria-selected')).toBe('true')
    expect(configTab.tabIndex).toBe(0)
    expect(configPanel.hidden).toBe(false)
    expect(servicesPanel.hidden).toBe(true)

    fireEvent.click(servicesTab)
    expect(servicesTab.getAttribute('aria-selected')).toBe('true')
    expect(servicesTab.tabIndex).toBe(0)
    expect(configPanel.hidden).toBe(true)
    expect(servicesPanel.hidden).toBe(false)

    fireEvent.keyDown(servicesTab, { key: 'ArrowRight' })
    expect(configTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(configTab)

    fireEvent.keyDown(configTab, { key: 'End' })
    expect(servicesTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(servicesTab)

    fireEvent.keyDown(servicesTab, { key: 'Home' })
    expect(configTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(configTab)
  })

  test('ChannelServiceTable routes reflect service start through onReflectStart', () => {
    const onStart = vi.fn()
    const onReflectStart = vi.fn()

    render(
      <ChannelServiceTable
        services={[reflectService]}
        t={t}
        onStart={onStart}
        onStop={vi.fn()}
        onLogs={vi.fn()}
        onAutostart={vi.fn()}
        onReflectStart={onReflectStart}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Start/i }))
    expect(onReflectStart).toHaveBeenCalledWith(reflectService.name)
    expect(onStart).not.toHaveBeenCalled()
  })

  test('keeps unrelated service controls available while one action is pending', () => {
    const services = [
      { ...reflectService, name: 'frontend/alpha', kind: 'frontend', running: false },
      { ...reflectService, name: 'frontend/beta', kind: 'frontend', running: false },
    ]
    render(
      <ChannelServiceTable
        services={services}
        t={{ ...t, ready: 'Ready', error: 'Error', retry: 'Retry' }}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onLogs={vi.fn()}
        onAutostart={vi.fn()}
        actionState={{ name: 'frontend/alpha', action: 'start', status: 'pending', message: 'Start: Busy' }}
      />,
    )

    const startButtons = screen.getAllByRole('button', { name: /Start/i })
    const stopButtons = screen.getAllByRole('button', { name: /Stop/i })
    expect(startButtons[0].disabled).toBe(true)
    expect(stopButtons[0].disabled).toBe(true)
    expect(startButtons[1].disabled).toBe(false)
    expect(screen.getAllByRole('button', { name: /Logs/i }).every(button => !button.disabled)).toBe(true)
    expect(screen.getByRole('status').textContent).toMatch(/Start: Busy/i)
  })

  test('keeps an external shared Hub visible but not stoppable', () => {
    const onStop = vi.fn()
    render(
      <ChannelServiceTable
        services={[{ ...reflectService, name: 'frontends/hub.py', kind: 'frontend', running: true, shared: true, managed: false, pid: 29812 }]}
        t={t}
        onStart={vi.fn()}
        onStop={onStop}
        onLogs={vi.fn()}
        onAutostart={vi.fn()}
      />,
    )

    expect(screen.getByText(t.service.sharedRunning)).toBeTruthy()
    expect(screen.getByText(t.service.sharedHubNotice)).toBeTruthy()
    const stopButton = screen.getByRole('button', { name: /Stop/i })
    expect(stopButton.disabled).toBe(true)
    expect(stopButton.title).toBe(t.service.sharedStopDisabled)
    fireEvent.click(stopButton)
    expect(onStop).not.toHaveBeenCalled()
  })

  test('shows a contextual service failure and retries the same action', () => {
    const onStart = vi.fn()
    render(
      <ChannelServiceTable
        services={[{ ...reflectService, name: 'frontend/alpha', kind: 'frontend', running: false }]}
        t={{ ...t, ready: 'Ready', error: 'Error', retry: 'Retry' }}
        onStart={onStart}
        onStop={vi.fn()}
        onLogs={vi.fn()}
        onAutostart={vi.fn()}
        actionState={{ name: 'frontend/alpha', action: 'start', status: 'error', message: 'Start: Error · port in use' }}
      />,
    )

    expect(screen.getByRole('alert').textContent).toMatch(/port in use/i)
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }))
    expect(onStart).toHaveBeenCalledWith('frontend/alpha')
  })
})

const validModelProfile = {
  var_name: 'native_oai_config_demo',
  type: 'native_oai',
  apibase: 'https://api.example.com/v1',
  apikey: 'masked',
  model: 'demo-model',
  models: ['demo-model'],
}

function ModelsHarness({
  initialProfile = validModelProfile,
  discoverModels = vi.fn(async () => ({ models: [] })),
  initialFailoverGroups = [],
  saveState = {},
  saveAll = vi.fn(async () => true),
  discardDraft = vi.fn(),
}) {
  const persisted = React.useRef([{ ...initialProfile, client_id: 'profile-key' }])
  const persistedGroups = React.useRef(initialFailoverGroups)
  const [profiles, setProfiles] = React.useState(persisted.current)
  const [failoverGroups, setFailoverGroups] = React.useState(initialFailoverGroups)
  // Mirrors the hook: the saved name has to survive a rename so that the
  // change count reports one edit rather than an add plus a removal.
  const patchProfile = (idx, patch) => {
    setProfiles(current => current.map((profile, index) => {
      if (index !== idx) return profile
      const next = { ...profile, ...patch }
      if (patch.var_name !== undefined && next.previous_var_name === undefined && profile.var_name) {
        next.previous_var_name = profile.var_name
      }
      return next
    }))
  }

  return (
    <Models
      t={I18N.zh}
      profiles={profiles}
      setProfiles={setProfiles}
      patchProfile={patchProfile}
      addModelProfiles={vi.fn(() => [])}
      removeModelProfile={vi.fn()}
      importModels={vi.fn()}
      previewModels={vi.fn()}
      discoverModels={discoverModels}
      failoverGroups={failoverGroups}
      setFailoverGroups={setFailoverGroups}
      changes={draftChangeSummary(profiles, persisted.current, failoverGroups, persistedGroups.current)}
      saveState={saveState}
      saveAll={saveAll}
      discardDraft={discardDraft}
      riskCatalog={[]}
      getProfileKey={(idx, profile) => profile?.client_id || `profile-${idx}`}
    />
  )
}

// The provider modal renders in a body portal, so its fields are read from
// the document rather than the render container.
const openProviderDrawer = () => fireEvent.click(document.querySelector('.model-connection-card'))
const providerNameInput = () => document.querySelector('.model-field--provider input')
const openAddModel = () => fireEvent.click(screen.getByRole('button', { name: /添加模型$/ }))

describe('Models call list', () => {
  test('lists every model as a call slot numbered by --llm-no', () => {
    installBrowserPolyfills()
    render(<ModelsHarness initialProfile={{
      ...validModelProfile,
      models: ['demo-model', 'demo-model-2'],
      model_configs: [{ model: 'demo-model' }, { model: 'demo-model-2' }],
    }} />)

    const slots = [...document.querySelectorAll('.model-call-slot strong')]
    expect(slots.map(slot => slot.textContent)).toEqual(['0', '1'])
    expect(document.querySelector('.model-call-row .model-call-title strong').textContent).toBe('demo-model')
  })

  test('keeps compact toolbar utilities icon-only with accessible labels', () => {
    installBrowserPolyfills()
    render(<ModelsHarness />)

    for (const label of ['重新读取', '配置预览', '放弃更改']) {
      const button = screen.getByRole('button', { name: label })
      expect(button.textContent).toBe('')
      expect(button.title).toBe(label)
      expect(button.querySelector('.ant-btn-icon')).toBeTruthy()
    }
  })

  test('switches workspaces without unmounting model or provider controls', () => {
    installBrowserPolyfills()
    render(<ModelsHarness />)

    const [modelsTab, providersTab] = document.querySelectorAll('.model-workspace-tabs button')
    const modelsWorkspace = document.querySelector('.model-call-list')
    const providersWorkspace = document.querySelector('.model-connections')

    expect(modelsTab.getAttribute('aria-pressed')).toBe('true')
    expect(modelsWorkspace.classList.contains('is-workspace-hidden')).toBe(false)
    expect(providersWorkspace.classList.contains('is-workspace-hidden')).toBe(true)

    fireEvent.click(providersTab)
    expect(providersTab.getAttribute('aria-pressed')).toBe('true')
    expect(modelsWorkspace.classList.contains('is-workspace-hidden')).toBe(true)
    expect(providersWorkspace.classList.contains('is-workspace-hidden')).toBe(false)
    expect(providersWorkspace.querySelector('.model-connection-card')).toBeTruthy()

    fireEvent.click(modelsTab)
    expect(modelsTab.getAttribute('aria-pressed')).toBe('true')
    expect(modelsWorkspace.classList.contains('is-workspace-hidden')).toBe(false)
  })

  test('opens provider settings as a modal and expands model configuration on demand', () => {
    installBrowserPolyfills()
    render(<ModelsHarness />)

    openProviderDrawer()

    const modal = document.querySelector('.model-provider-modal')
    expect(modal).toBeTruthy()
    expect(document.querySelector('.model-provider-drawer')).toBeNull()
    expect(modal.querySelectorAll('.model-provider-model-card')).toHaveLength(1)
    expect(modal.querySelector('.model-params-grid')).toBeNull()

    const toggle = modal.querySelector('.model-provider-model-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(modal.querySelector('.model-provider-model-summary strong').textContent).toBe('demo-model')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(modal.querySelector('.model-params-grid')).toBeTruthy()

    const modelIdInput = modal.querySelector('.model-provider-model-config input')
    expect(modelIdInput.value).toBe('demo-model')
    fireEvent.change(modelIdInput, { target: { value: 'demo-model-v2' } })

    expect(document.querySelector('.model-call-title strong').textContent).toBe('demo-model-v2')
    expect(modal.querySelector('.model-provider-model-summary strong').textContent).toBe('demo-model-v2')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(modal.querySelector('.model-params-grid')).toBeNull()
  })

  test('shows model display names in the provider list without confusing provider names or IDs', () => {
    installBrowserPolyfills()
    render(<ModelsHarness initialProfile={{
      ...validModelProfile,
      display_name: 'Provider Friendly',
      model_configs: [
        { model: 'demo-model', name: 'Demo Friendly' },
        { model: 'same-model', name: 'same-model' },
      ],
    }} />)

    openProviderDrawer()

    const summaries = document.querySelectorAll('.model-provider-model-summary')
    expect(summaries[0].querySelector('strong').textContent).toBe('Demo Friendly')
    expect(summaries[0].querySelector('em')).toBeNull()
    expect(summaries[1].querySelector('strong').textContent).toBe('same-model')
    expect(summaries[1].querySelector('em')).toBeNull()

    fireEvent.click(summaries[0])
    const expandedConfig = document.querySelector('.model-provider-model-config')
    const modelIdField = expandedConfig.querySelector('.model-field--wide')
    const modelIdInput = modelIdField.querySelector('input')
    expect(modelIdField.querySelector('.model-field-label').textContent).toBe('模型 ID')
    expect(modelIdInput.getAttribute('placeholder')).toContain('gpt-5.2')
    expect(modelIdField.querySelector('small').textContent).toContain('服务商 API')
    expect(modelIdField.querySelector('small').textContent).toContain('不是上方的自定义显示名称')
  })

  test('edits a model display name without changing its model ID', () => {
    installBrowserPolyfills()
    render(<ModelsHarness initialProfile={{
      ...validModelProfile,
      model_configs: [{ model: 'demo-model', name: 'Demo Friendly' }],
    }} />)

    fireEvent.click(screen.getByRole('button', { name: /^配置: / }))
    const displayNameInput = screen.getByLabelText('显示名称')
    expect(displayNameInput.value).toBe('Demo Friendly')

    fireEvent.change(displayNameInput, { target: { value: 'Renamed Friendly' } })

    expect(screen.getByLabelText('显示名称').value).toBe('Renamed Friendly')
    expect(document.querySelector('.model-call-title strong').textContent).toBe('Renamed Friendly')
    expect(document.querySelector('.model-call-sub em').textContent).toBe('demo-model')
  })

  test('keeps focus in the provider name while its controlled value changes', () => {
    installBrowserPolyfills()

    render(<ModelsHarness />)
    openProviderDrawer()
    const nameInput = providerNameInput()
    nameInput.focus()
    expect(document.activeElement).toBe(nameInput)

    fireEvent.change(nameInput, { target: { value: 'renamed' } })

    const updatedNameInput = providerNameInput()
    expect(updatedNameInput.value).toBe('renamed')
    expect(document.activeElement).toBe(updatedNameInput)
  })

  test('shows discovery pending then an empty state that can be retried', async () => {
    installBrowserPolyfills()
    let resolveDiscovery
    const discoverModels = vi.fn(() => new Promise(resolve => { resolveDiscovery = resolve }))
    render(<ModelsHarness discoverModels={discoverModels} />)

    openAddModel()
    fireEvent.click(screen.getByRole('button', { name: '从服务商获取' }))
    expect(await screen.findByText(/正在获取模型/)).toBeTruthy()

    resolveDiscovery({ models: [] })
    expect(await screen.findByText(/没有发现模型/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '从服务商获取' }))
    expect(discoverModels).toHaveBeenCalledTimes(2)
  })

  test('shows discovery failure and retries in place', async () => {
    installBrowserPolyfills()
    const discoverModels = vi.fn()
      .mockRejectedValueOnce(new Error('upstream unavailable'))
      .mockResolvedValueOnce({ models: [] })
    render(<ModelsHarness discoverModels={discoverModels} />)

    openAddModel()
    fireEvent.click(screen.getByRole('button', { name: '从服务商获取' }))
    expect(await screen.findByText('无法获取候选模型')).toBeTruthy()
    expect(screen.getByText('upstream unavailable')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
    await waitFor(() => expect(discoverModels).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/没有发现模型/)).toBeTruthy()
  })

  test('appends a discovered candidate to the end of the call list', async () => {
    installBrowserPolyfills()
    const discoverModels = vi.fn(async () => ({ models: ['new-model'] }))
    render(<ModelsHarness discoverModels={discoverModels} />)

    openAddModel()
    fireEvent.click(screen.getByRole('button', { name: '从服务商获取' }))
    fireEvent.click(await screen.findByRole('button', { name: '再添加一个 new-model 模型实例' }))

    await waitFor(() => {
      const titles = [...document.querySelectorAll('.model-call-title strong')]
      expect(titles.map(title => title.textContent)).toEqual(['demo-model', 'new-model'])
    })
  })

  test('allows adding a discovered model ID that already exists in the provider', async () => {
    installBrowserPolyfills()
    const discoverModels = vi.fn(async () => ({ models: ['demo-model'] }))
    render(<ModelsHarness discoverModels={discoverModels} />)

    openAddModel()
    fireEvent.click(screen.getByRole('button', { name: '从服务商获取' }))
    fireEvent.click(await screen.findByRole('button', { name: '再添加一个 demo-model 模型实例' }))

    await waitFor(() => {
      const titles = [...document.querySelectorAll('.model-call-title strong')]
      expect(titles.map(title => title.textContent)).toEqual(['demo-model', 'demo-model'])
    })
  })

  test('shows invalid provider errors and the API key warning in its drawer', () => {
    installBrowserPolyfills()
    render(<ModelsHarness initialProfile={{ ...validModelProfile, var_name: '', apibase: '', apikey: '' }} />)

    expect(screen.getByText(/有服务商存在阻断项/)).toBeTruthy()
    openProviderDrawer()

    expect(screen.getByText('此服务商暂时不能保存')).toBeTruthy()
    expect(screen.getByText('必须填写变量名')).toBeTruthy()
    expect(screen.getByText('必须填写 API Base')).toBeTruthy()
    expect(screen.getByText('保存前请留意')).toBeTruthy()
    expect(screen.getByText(/API Key 为空/)).toBeTruthy()
  })

  test('collects edits into one draft that only the page-level save writes', () => {
    installBrowserPolyfills()
    const saveAll = vi.fn(async () => true)
    render(<ModelsHarness saveAll={saveAll} />)

    expect(screen.getByText('与 mykey.py 一致')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存到 mykey.py' }).disabled).toBe(true)

    openProviderDrawer()
    fireEvent.change(providerNameInput(), { target: { value: 'renamed' } })

    expect(screen.getByText('1 处未保存改动')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存到 mykey.py' }))
    expect(saveAll).toHaveBeenCalledTimes(1)
  })

  test('reports a failed save at the top of the page and keeps the draft', () => {
    installBrowserPolyfills()
    render(<ModelsHarness saveState={{ status: 'error', error: 'disk is read-only' }} />)

    openProviderDrawer()
    fireEvent.change(providerNameInput(), { target: { value: 'renamed' } })

    expect(screen.getByText('保存失败')).toBeTruthy()
    expect(screen.getByText('disk is read-only')).toBeTruthy()
    expect(screen.getByText('1 处未保存改动')).toBeTruthy()
    expect(providerNameInput().value).toBe('renamed')
  })

  test('keeps failover groups independently collapsed and expands a newly added group', () => {
    installBrowserPolyfills()
    const twoModels = {
      ...validModelProfile,
      models: ['demo-model', 'demo-model-2'],
      model_configs: [{ model: 'demo-model' }, { model: 'demo-model-2' }],
    }
    render(
      <ModelsHarness
        initialProfile={twoModels}
        initialFailoverGroups={[
          {
            var_name: 'mixin_config_primary',
            members: [{ provider_var_name: validModelProfile.var_name, model: validModelProfile.model }],
            max_retries: 10,
            base_delay: 0.5,
          },
          {
            var_name: 'mixin_config_secondary',
            members: [],
            max_retries: 10,
            base_delay: 0.5,
          },
        ]}
      />,
    )

    const readGroups = () => [...document.querySelectorAll('.model-call-row.is-failover')]
    let groups = readGroups()
    let toggles = groups.map(group => group.querySelector('.model-call-toggle'))
    expect(groups).toHaveLength(2)
    expect(toggles.map(toggle => toggle?.getAttribute('aria-expanded'))).toEqual(['false', 'false'])
    expect(groups.every(group => !group.querySelector('.model-row-body'))).toBe(true)

    fireEvent.click(toggles[0])
    groups = readGroups()
    toggles = groups.map(group => group.querySelector('.model-call-toggle'))
    expect(toggles.map(toggle => toggle?.getAttribute('aria-expanded'))).toEqual(['true', 'false'])
    expect(groups[0].querySelector('.model-row-body')).toBeTruthy()
    expect(groups[1].querySelector('.model-row-body')).toBeNull()

    fireEvent.click(toggles[1])
    fireEvent.click(toggles[0])
    groups = readGroups()
    toggles = groups.map(group => group.querySelector('.model-call-toggle'))
    expect(toggles.map(toggle => toggle?.getAttribute('aria-expanded'))).toEqual(['false', 'true'])
    expect(groups[0].querySelector('.model-row-body')).toBeNull()
    expect(groups[1].querySelector('.model-row-body')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '新建故障转移组' }))
    groups = readGroups()
    toggles = groups.map(group => group.querySelector('.model-call-toggle'))
    expect(groups).toHaveLength(3)
    expect(toggles.map(toggle => toggle?.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'true'])
    expect(groups[2].querySelector('.model-row-body')).toBeTruthy()
  })
})


describe('chat viewport containment styles', () => {
  test('locks root scrolling only while the dedicated chat workspace is mounted', () => {
    expect(appStyles).toMatch(
      /html:has\(\.oa-chat\),\s*body:has\(\.oa-chat\),\s*#root:has\(> \.oa-chat\)\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*100%;[^}]*overflow:\s*hidden;/,
    )
  })
})


describe('plan todo card disclosure', () => {
  test('starts expanded and toggles the plan body with matching chevrons', () => {
    const { container } = render(
      <PlanTodoCard plan={{
        active: true,
        done: 1,
        total: 2,
        items: [
          { status: 'done', content: 'Inspect the task' },
          { status: 'in_progress', content: 'Implement collapse' },
        ],
        step: 'Editing the plan card',
      }}/>,
    )

    const collapseButton = screen.getByRole('button', { name: '\u6536\u8d77\u6267\u884c\u8ba1\u5212' })
    const body = container.querySelector('.oa-plan-body')
    expect(collapseButton.getAttribute('aria-expanded')).toBe('true')
    expect(collapseButton.getAttribute('aria-controls')).toBe(body?.id)
    expect(body?.hidden).toBe(false)
    expect(collapseButton.querySelector('.lucide-chevron-down')).toBeTruthy()

    fireEvent.click(collapseButton)

    const expandButton = screen.getByRole('button', { name: '\u5c55\u5f00\u6267\u884c\u8ba1\u5212' })
    expect(expandButton.getAttribute('aria-expanded')).toBe('false')
    expect(body?.hidden).toBe(true)
    expect(expandButton.querySelector('.lucide-chevron-left')).toBeTruthy()

    fireEvent.click(expandButton)

    expect(screen.getByRole('button', { name: '\u6536\u8d77\u6267\u884c\u8ba1\u5212' }).getAttribute('aria-expanded')).toBe('true')
    expect(body?.hidden).toBe(false)
  })

  test('keeps UltraPlan message content in the primary mobile grid column', () => {
    expect(appStyles).toMatch(
      /@media \(max-width: 620px\)\s*\{\s*\.oa-message\.assistant:has\(> \.oa-message-ultraplan\)\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) 30px !important;/,
    )
  })

  test('auto-opens the message-owned UltraPlan inspector and supports close, reopen, and Escape', async () => {
    const { container } = render(
      <ChatMessage
        message={{
          id: 'ultraplan-inspector',
          role: 'assistant',
          content: '',
          ultraplan_state: {
            objective: 'Ship the dashboard',
            current: 'Implementing inspector',
            phases: [{ id: 'phase-1', name: 'Implementation', status: 'running' }],
          },
        }}
        pending={true}
        onAskReply={vi.fn()}
      />,
    )

    const entry = container.querySelector('.oa-up-entry')
    expect(entry).toBeTruthy()
    await waitFor(() => expect(entry.getAttribute('aria-expanded')).toBe('true'))

    const inspector = screen.getByRole('region', { name: 'UltraPlan' })
    const drawerLayer = inspector.closest('.oa-up-drawer-layer')
    expect(entry.getAttribute('aria-controls')).toBe(inspector.id)
    expect(drawerLayer?.parentElement).toBe(document.body)
    expect(container.contains(drawerLayer)).toBe(false)
    expect(container.querySelector('.oa-message.assistant .oa-message-ultraplan > .oa-up-entry')).toBe(entry)
    expect(container.querySelector('.oa-session-ultraplan')).toBeNull()
    expect(container.querySelector('.oa-up-drawer-backdrop')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Implementing inspector')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '\u5173\u95ed UltraPlan \u8be6\u60c5' }))
    expect(entry.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: 'UltraPlan' })).toBeNull()

    fireEvent.click(entry)
    expect(entry.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: 'UltraPlan' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(entry.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: 'UltraPlan' })).toBeNull()
  })

  test('resizes the UltraPlan inspector from its left edge with pointer and keyboard controls', async () => {
    const { container } = render(
      <ChatMessage
        message={{
          id: 'ultraplan-resize',
          role: 'assistant',
          content: '',
          ultraplan_state: {
            objective: 'Resize the inspector',
            current: 'Checking width controls',
            phases: [{ id: 'phase-1', name: 'Implementation', status: 'running' }],
          },
        }}
        pending={true}
        onAskReply={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByRole('region', { name: 'UltraPlan' })).toBeTruthy())
    const inspector = screen.getByRole('region', { name: 'UltraPlan' })
    const separator = screen.getByRole('separator', { name: '\u8c03\u6574 UltraPlan \u4fa7\u680f\u5bbd\u5ea6' })

    expect(inspector.style.getPropertyValue('--oa-up-drawer-width')).toBe('440px')
    expect(separator.getAttribute('aria-controls')).toBe(inspector.id)
    expect(separator.getAttribute('aria-orientation')).toBe('vertical')
    expect(separator.getAttribute('aria-valuemin')).toBe('360')
    expect(separator.getAttribute('aria-valuemax')).toBe('960')
    expect(separator.getAttribute('aria-valuenow')).toBe('440')

    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(inspector.style.getPropertyValue('--oa-up-drawer-width')).toBe('472px')
    expect(separator.getAttribute('aria-valuenow')).toBe('472')

    fireEvent.keyDown(separator, { key: 'ArrowRight', shiftKey: true })
    expect(inspector.style.getPropertyValue('--oa-up-drawer-width')).toBe('408px')

    fireEvent.keyDown(separator, { key: 'Home' })
    expect(inspector.style.getPropertyValue('--oa-up-drawer-width')).toBe('360px')

    fireEvent.pointerDown(separator, { button: 0, clientX: 700, pointerId: 7 })
    expect(inspector.classList.contains('is-resizing')).toBe(true)
    fireEvent.pointerMove(separator, { clientX: 500, pointerId: 7 })
    expect(inspector.style.getPropertyValue('--oa-up-drawer-width')).toBe('560px')
    expect(separator.getAttribute('aria-valuenow')).toBe('560')
    fireEvent.pointerUp(separator, { clientX: 500, pointerId: 7 })
    expect(inspector.classList.contains('is-resizing')).toBe(false)

    fireEvent.keyDown(separator, { key: 'End' })
    expect(inspector.style.getPropertyValue('--oa-up-drawer-width')).toBe('960px')
    expect(separator.getAttribute('aria-valuenow')).toBe('960')
  })

  test('follows the latest streamed subagent turn, then collapses turns when the task finishes', async () => {
    const task = (status, output) => ({
      id: 'streamed-subagent',
      desc: 'Run delegated work',
      status,
      output,
    })
    const message = (status, output) => ({
      id: 'ultraplan-turn-stream',
      role: 'assistant',
      content: '',
      ultraplan_state: {
        objective: 'Track delegated work',
        recentTasks: [task(status, output)],
      },
    })
    const turnOne = [
      'LLM Running (Turn 1)',
      '<summary>first turn</summary>',
      'first body',
    ].join('\n')
    const turnOneUpdated = [
      'LLM Running (Turn 1)',
      '<summary>first turn updated</summary>',
      'first body',
      'still first turn',
    ].join('\n')
    const turnTwo = [
      turnOneUpdated,
      'LLM Running (Turn 2)',
      '<summary>second turn</summary>',
      'second body',
    ].join('\n')

    const { container, rerender } = render(
      <ChatMessage message={message('running', turnOne)} pending={true} onAskReply={vi.fn()} />,
    )
    const drawerLayer = document.body.querySelector('.oa-up-drawer-layer')
    const taskRow = drawerLayer?.querySelector('.oa-up-task')
    expect(drawerLayer?.parentElement).toBe(document.body)
    expect(container.contains(drawerLayer)).toBe(false)
    const turnButton = (n) => screen.getByRole('button', { name: new RegExp(`Turn ${n}`) })
    const turnIsOpen = (n) => turnButton(n).closest('.ant-collapse-item')
      ?.classList.contains('ant-collapse-item-active')

    await waitFor(() => expect(turnButton(1).getAttribute('aria-expanded')).toBe('true'))
    expect(turnIsOpen(1)).toBe(true)

    fireEvent.click(turnButton(1))
    expect(turnButton(1).getAttribute('aria-expanded')).toBe('false')
    expect(turnIsOpen(1)).toBe(false)

    rerender(<ChatMessage message={message('running', turnOneUpdated)} pending={true} onAskReply={vi.fn()} />)
    await waitFor(() => expect(turnButton(1).textContent).toContain('first turn updated'))
    expect(turnButton(1).getAttribute('aria-expanded')).toBe('false')
    expect(turnIsOpen(1)).toBe(false)

    rerender(<ChatMessage message={message('running', turnTwo)} pending={true} onAskReply={vi.fn()} />)
    await waitFor(() => expect(turnButton(2).getAttribute('aria-expanded')).toBe('true'))
    expect(turnButton(1).getAttribute('aria-expanded')).toBe('false')
    expect(turnIsOpen(1)).toBe(false)
    expect(turnIsOpen(2)).toBe(true)

    rerender(<ChatMessage message={message('done', turnTwo)} pending={false} onAskReply={vi.fn()} />)
    await waitFor(() => expect(turnButton(2).getAttribute('aria-expanded')).toBe('false'))
    expect(turnIsOpen(1)).toBe(false)
    expect(turnIsOpen(2)).toBe(false)

    fireEvent.click(turnButton(1))
    expect(turnButton(1).getAttribute('aria-expanded')).toBe('true')
    expect(turnIsOpen(1)).toBe(true)
    expect(taskRow).toBeTruthy()
  })

  test('keeps every UltraPlan dashboard in its owning assistant output and preserves final prose', () => {
    const messages = [
      {
        id: 'ultraplan-older-run',
        role: 'assistant',
        content: '[phase] old progress',
        ultraplan_state: {
          objective: 'Older objective',
          phases: [{ id: 'old-phase', name: 'Old phase', status: 'done' }],
        },
      },
      {
        id: 'ultraplan-latest-run',
        role: 'assistant',
        content: [
          '[phase] Research is complete',
          'verified final result',
        ].join('\n'),
        ultraplan_state: {
          objective: 'Find active state-owned jobs',
          complete: true,
          phases: [{ id: 'phase-1', name: 'Research', status: 'done' }],
        },
      },
    ]
    const { container } = render(
      <>
        {messages.map(message => (
          <ChatMessage key={message.id} message={message} pending={false} onAskReply={vi.fn()} />
        ))}
      </>,
    )

    const assistantMessages = [...container.querySelectorAll('.oa-message.assistant')]
    expect(assistantMessages).toHaveLength(2)
    expect(container.querySelector('.oa-session-ultraplan')).toBeNull()
    const olderEntry = assistantMessages[0].querySelector('.oa-message-ultraplan > .oa-up-entry')
    const latestEntry = assistantMessages[1].querySelector('.oa-message-ultraplan > .oa-up-entry')
    expect(olderEntry).toBeTruthy()
    expect(latestEntry).toBeTruthy()
    expect(olderEntry.getAttribute('aria-expanded')).toBe('false')
    expect(latestEntry.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.oa-up-drawer-backdrop')).toBeNull()
    expect(assistantMessages[0].textContent).toContain('Older objective')
    expect(assistantMessages[0].textContent).not.toContain('Find active state-owned jobs')
    expect(assistantMessages[1].textContent).toContain('Find active state-owned jobs')
    expect(assistantMessages[1].textContent).not.toContain('Older objective')
    const finalProse = assistantMessages[1].querySelector('.oa-ultraplan-prose')
    expect(finalProse).toBeTruthy()
    expect(finalProse.closest('.oa-message-ultraplan')).toBeNull()
    expect(finalProse.textContent).toContain('verified final result')
    expect(finalProse.textContent).not.toContain('Research is complete')
    expect(assistantMessages[1].textContent.match(/verified final result/g)).toHaveLength(1)

    fireEvent.click(latestEntry)
    const drawerLayer = document.body.querySelector('.oa-up-drawer-layer')
    const inspector = drawerLayer?.querySelector('.oa-up-drawer')
    expect(drawerLayer).toBeTruthy()
    expect(drawerLayer.parentElement).toBe(document.body)
    expect(assistantMessages[1].contains(drawerLayer)).toBe(false)
    expect(inspector).toBeTruthy()
    expect(inspector.getAttribute('role')).toBe('region')
    expect(inspector.hasAttribute('aria-modal')).toBe(false)
    expect(drawerLayer.querySelector('.oa-up-drawer-backdrop')).toBeNull()
    expect(latestEntry.getAttribute('aria-expanded')).toBe('true')
    expect(inspector.textContent).toContain('Find active state-owned jobs')
    expect(inspector.textContent).not.toContain('Older objective')
    expect(finalProse.closest('[hidden]')).toBeNull()

    fireEvent.click(inspector.querySelector('.oa-up-drawer-close'))
    expect(document.body.querySelector('.oa-up-drawer-layer')).toBeNull()
    expect(latestEntry.getAttribute('aria-expanded')).toBe('false')
    expect(finalProse.textContent).toContain('verified final result')
  })
})


describe('chat response identity and time', () => {
  test('renders the concrete model ID and message time above its assistant response', () => {
    const createdAt = '2026-07-17T08:09:10.000Z'
    const { container } = render(
      <ChatMessage
        message={{ id: 'a1', role: 'assistant', content: 'Finished', model_id: '  vendor/model-v1  ', created_at: createdAt }}
        pending={false}
        onAskReply={vi.fn()}
      />,
    )

    const body = container.querySelector('.oa-msg-body')
    const meta = container.querySelector('.oa-meta')
    const badge = container.querySelector('.oa-model-id')
    const separator = container.querySelector('.oa-meta-separator')
    const time = container.querySelector('.oa-message-time')
    expect(body?.firstElementChild).toBe(meta)
    expect(badge?.textContent).toBe('vendor/model-v1')
    expect(badge?.getAttribute('title')).toBe('Model ID: vendor/model-v1')
    expect(separator?.textContent).toBe('·')
    expect(time?.textContent).toBe(new Date(createdAt).toLocaleString())
    expect(time?.getAttribute('datetime')).toBe(createdAt)
  })

  test('continues live elapsed time from the persisted backend start after refresh', () => {
    const startedAt = Date.parse('2026-07-17T08:00:00.000Z')
    const refreshedAt = startedAt + 60_000
    const { container } = render(
      <ChatMessage
        message={{ id: 'pending', role: 'assistant', content: '', created_at: refreshedAt, run_started_at_ms: startedAt }}
        pending
        clockNow={startedAt + 90_000}
        onAskReply={vi.fn()}
      />,
    )

    expect(container.querySelector('.oa-usage-time')?.textContent).toContain('1m30s')
  })

  test('uses the persisted terminal elapsed duration instead of continuing the live clock', () => {
    const { container } = render(
      <ChatMessage
        message={{ id: 'done', role: 'assistant', content: 'Finished', elapsed_ms: 4_200, run_started_at_ms: 1 }}
        pending={false}
        clockNow={100_000}
        onAskReply={vi.fn()}
      />,
    )

    expect(container.querySelector('.oa-usage-time')?.textContent).toContain('4s')
  })

  test('normalizes goal start seconds and hides an invalid epoch date', () => {
    const startSeconds = Math.floor(Date.parse('2026-07-17T08:09:10.000Z') / 1000)
    const { container, rerender } = render(
      <GoalStatusCard state={{ status: 'done', start_time: startSeconds, elapsed_seconds: 10 }} />,
    )

    expect(container.querySelector('.oa-goalcard-meta')?.textContent)
      .toContain(new Date(startSeconds * 1000).toLocaleString())

    rerender(<GoalStatusCard state={{ status: 'done', start_time: 1777777, elapsed_seconds: 10 }} />)
    expect(container.querySelector('.oa-goalcard-meta')?.textContent).not.toContain('启动')
  })

  test('keeps each goal card at the tail of its owning assistant output', () => {
    const messages = [
      { id: 'goal-old', role: 'assistant', content: 'Old output', goal_state: { status: 'done', objective: 'Old goal' } },
      { id: 'goal-new', role: 'assistant', content: 'New output', goal_state: { status: 'done', objective: 'New goal' } },
    ]
    const { container } = render(<>{messages.map(message => (
      <ChatMessage key={message.id} message={message} pending={false} onAskReply={vi.fn()} />
    ))}</>)

    const assistants = [...container.querySelectorAll('.oa-message.assistant')]
    expect(assistants).toHaveLength(2)
    expect(assistants[0].querySelector('.oa-goalcard')?.textContent).toContain('Old goal')
    expect(assistants[0].textContent).not.toContain('New goal')
    expect(assistants[1].querySelector('.oa-goalcard')?.textContent).toContain('New goal')
    expect(assistants[1].textContent).not.toContain('Old goal')
    expect(assistants[0].querySelector('.oa-msg-body + .oa-goalcard')).toBeTruthy()
    expect(appStyles).toMatch(
      /\.oa-message\.assistant:has\(> \.oa-goalcard\) > \.oa-goalcard\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*2;/,
    )
  })

  test('renders comparison-report markdown without leaking syntax or unsafe HTML', () => {
    const content = [
      '<summary>source differences confirmed</summary>',
      '',
      '## Two legacy CPLD TU comparison report',
      '',
      '### Basic information',
      '| Item | tianchi_101 | server_103 |',
      '|------|-------------|------------|',
      '| **Code size** | 689 lines | 1223 lines |',
      '',
      '---',
      '',
      '#### 1. **Data sources and maintenance**',
      '| Dimension | tianchi_101 | server_103 |',
      '|------|-------------|------------|',
      '| **Data source** | **WebService**<br>dynamic address | **Local Excel**<br/>five xlsx files |',
      '',
      '#### 3. **Update core logic**',
      'Both use `update_cpld_firmware()`; ~~obsolete path~~.',
      '<img src=x onerror="window.__markdownInjected=true">',
    ].join('\n')
    const { container } = render(
      <ChatMessage
        message={{ id: 'markdown-comparison', role: 'assistant', content }}
        pending={false}
        onAskReply={vi.fn()}
      />,
    )

    expect(container.querySelector('.ga-summary-block')?.textContent).toContain('source differences confirmed')
    expect(screen.getByRole('heading', { level: 2, name: 'Two legacy CPLD TU comparison report' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Basic information' })).toBeTruthy()
    const firstDetailHeading = container.querySelector('.oa-md h4')
    expect(firstDetailHeading?.textContent).toBe('1. Data sources and maintenance')
    expect(firstDetailHeading?.querySelector('strong')?.textContent).toBe('Data sources and maintenance')
    expect(container.querySelectorAll('.oa-md-table')).toHaveLength(2)
    expect(container.querySelectorAll('.oa-md-table br')).toHaveLength(2)
    expect(container.querySelector('.oa-md hr')).toBeTruthy()
    expect(container.querySelector('.oa-md code')?.textContent).toBe('update_cpld_firmware()')
    expect(container.querySelector('.oa-md del')?.textContent).toBe('obsolete path')
    expect(container.querySelector('.oa-md img')).toBeNull()
    const markdownText = [...container.querySelectorAll('.oa-md')].map(node => node.textContent).join('\n')
    expect(markdownText).toContain('<img src=x onerror="window.__markdownInjected=true">')
    expect(markdownText).not.toContain('<br>')
  })

  test('renders mermaid fences as safe diagrams and keeps the source copyable', async () => {
    const bindFunctions = vi.fn()
    mermaidMocks.render.mockResolvedValue({
      svg: '<svg viewBox="0 0 120 60"><title>Request flow</title><path d="M0 0L10 10" /></svg>',
      bindFunctions,
    })
    const content = ['```mermaid', 'flowchart LR', '  Request --> Response', '```'].join('\n')
    const { container } = render(
      <ChatMessage
        message={{ id: 'mermaid-success', role: 'assistant', content }}
        pending={false}
        onAskReply={vi.fn()}
      />,
    )

    expect(await screen.findByRole('img', { name: 'Mermaid \u56fe\u8868' })).toBeTruthy()
    expect(container.querySelector('.oa-mermaid-diagram svg title')?.textContent).toBe('Request flow')
    expect(container.querySelector('.oa-code-card')).toBeNull()
    expect(mermaidMocks.initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'neutral',
    }))
    expect(mermaidMocks.render).toHaveBeenCalledWith(expect.stringMatching(/^oa-mermaid-/), expect.stringContaining('Request --> Response'))
    expect(bindFunctions).toHaveBeenCalled()
    expect(appStyles).toMatch(/\.oa-mermaid-diagram\{[^}]*font-weight:450;[^}]*letter-spacing:normal;[^}]*white-space:normal;[^}]*word-break:normal;[^}]*overflow-wrap:normal/)
    expect(appStyles).not.toMatch(/\.oa-mermaid-diagram\{[^}]*will-change:transform/)
    expect(appStyles).toContain('.oa-mermaid-diagram foreignObject p{white-space:inherit}')

    fireEvent.click(screen.getByRole('button', { name: '\u6e90\u7801' }))
    expect(container.querySelector('.oa-mermaid-source code')?.textContent).toContain('Request --> Response')
    expect(container.querySelector('.oa-mermaid-viewport')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '\u56fe\u8868' }))

    const diagram = container.querySelector('.oa-mermaid-diagram')
    fireEvent.click(screen.getByTitle('\u653e\u5927'))
    expect(diagram.style.transform).toContain('scale(1.2)')
    fireEvent.click(screen.getByTitle('\u7f29\u5c0f'))
    expect(diagram.style.transform).toContain('scale(1)')
    fireEvent.click(screen.getByTitle('\u653e\u5927'))
    fireEvent.click(screen.getByTitle('\u590d\u4f4d\u89c6\u56fe'))
    expect(diagram.style.transform).toBe('translate(0px, 0px) scale(1)')

    const viewport = container.querySelector('.oa-mermaid-viewport')
    fireEvent.click(screen.getByTitle('\u5e73\u79fb\u6a21\u5f0f'))
    expect(viewport.classList.contains('is-pan-enabled')).toBe(true)
    fireEvent.pointerDown(viewport, { pointerId: 7, clientX: 10, clientY: 20, button: 0 })
    fireEvent.pointerMove(viewport, { pointerId: 7, clientX: 35, clientY: 50 })
    fireEvent.pointerUp(viewport, { pointerId: 7 })
    expect(diagram.style.transform).toBe('translate(25px, 30px) scale(1)')

    fireEvent.click(screen.getByRole('button', { name: '\u5168\u5c4f\u67e5\u770b' }))
    expect(screen.getByRole('dialog', { name: 'Mermaid \u56fe\u8868\u5168\u5c4f\u67e5\u770b' })).toBeTruthy()
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('img', { name: 'Mermaid \u56fe\u8868' }).style.transform).toBe('translate(25px, 30px) scale(1)')
    expect(appStyles).toContain('.oa-mermaid-fullscreen{position:fixed;inset:0;z-index:10020')
    expect(appStyles).toContain('.oa-code-head.oa-mermaid-head{height:auto}')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Mermaid \u56fe\u8868\u5168\u5c4f\u67e5\u770b' })).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  test('waits for a streamed mermaid fence to close before rendering its final source', async () => {
    mermaidMocks.render.mockResolvedValue({
      svg: '<svg viewBox="0 0 120 60"><title>Final stream</title></svg>',
    })
    const renderMessage = content => <ChatMessage
      message={{ id: 'mermaid-stream', role: 'assistant', content }}
      pending={true}
      onAskReply={vi.fn()}
    />
    const view = render(renderMessage('```mermaid\nflowchart LR\n  A -->'))

    expect(screen.getByRole('status').textContent).toContain('\u6b63\u5728\u63a5\u6536\u56fe\u8868\u5185\u5bb9')
    expect(view.container.querySelector('.oa-mermaid-source code')?.textContent).toContain('A -->')
    expect(mermaidMocks.render).not.toHaveBeenCalled()

    view.rerender(renderMessage('```mermaid\nflowchart LR\n  A --> B'))
    expect(mermaidMocks.render).not.toHaveBeenCalled()

    view.rerender(renderMessage('```mermaid\nflowchart LR\n  A --> B\n```'))
    expect(await screen.findByRole('img', { name: 'Mermaid \u56fe\u8868' })).toBeTruthy()
    expect(mermaidMocks.render).toHaveBeenCalledTimes(1)
    expect(mermaidMocks.render).toHaveBeenCalledWith(expect.stringMatching(/^oa-mermaid-/), expect.stringContaining('A --> B'))
  })

  test('falls back to mermaid source when the diagram syntax is invalid', async () => {
    mermaidMocks.render.mockRejectedValue(new Error('Parse error on line 2'))
    const source = 'flowchart LR\n  A -- broken'
    const { container } = render(
      <ChatMessage
        message={{ id: 'mermaid-invalid', role: 'assistant', content: `\`\`\`MERMAID\n${source}\n\`\`\`` }}
        pending={false}
        onAskReply={vi.fn()}
      />,
    )

    expect((await screen.findByRole('alert')).textContent).toContain('Parse error on line 2')
    expect(container.querySelector('.oa-mermaid-card.is-error pre code')?.textContent).toBe(`${source}\n`)
    expect(container.querySelector('.oa-mermaid-diagram')).toBeNull()
  })

  test('keeps non-image attachments visible before the server upload response', () => {
    const { container } = render(
      <ChatMessage
        message={{
          id: 'user-file-optimistic',
          role: 'user',
          content: 'summarize this',
          files: [{ name:'notes.txt', type:'text/plain', dataURL:'data:text/plain;base64,aGVsbG8=' }],
        }}
        pending
        onAskReply={vi.fn()}
      />,
    )

    expect(screen.getByText('notes.txt')).toBeTruthy()
    expect(container.querySelector('.oa-message-files .oa-pending-file')).toBeTruthy()
    expect(container.querySelector('.oa-msg-text')?.textContent).toBe('summarize this')
  })

  test('keeps saved non-image attachments visible from metadata after reload', () => {
    const savedPath = 'C:\\chat\\uploads\\123_cost]report.pdf'
    const { container } = render(
      <ChatMessage
        message={{
          id: 'user-file-saved',
          role: 'user',
          content: `review this\n[\u9644\u4ef6\u5df2\u4fdd\u5b58]\n- [FILE:${savedPath}]`,
          files: [{ path:savedPath, name:'123_cost]report.pdf', mime:'application/pdf', url:'/api/chat/file/123_cost%5Dreport.pdf' }],
        }}
        pending={false}
        onAskReply={vi.fn()}
      />,
    )

    expect(screen.getByText('123_cost]report.pdf')).toBeTruthy()
    expect(container.querySelector('.oa-message-files .oa-file-card')).toBeTruthy()
    expect(container.querySelector('.oa-file-card')?.getAttribute('title')).toBe(savedPath)
    expect(container.querySelector('.oa-msg-text')?.textContent).toBe('review this')
  })

  test('renders an explicit empty result for a worldline command', () => {
    render(
      <ChatMessage
        message={{ id: 'worldline-empty', role: 'assistant', commandResult: { command:'worldline', action:'list', tree:{ nodes:[] } } }}
        pending={false}
        onAskReply={vi.fn()}
      />,
    )

    expect(screen.getByText('0 个世界线节点')).toBeTruthy()
  })

  test('edits and resends a terminal user message, then closes the editor on success', async () => {
    const onEditResend = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <ChatMessage
        message={{ id: 'user-edit-ok', role: 'user', content: 'original text' }}
        pending={false}
        onAskReply={vi.fn()}
        onEditResend={onEditResend}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '\u7f16\u8f91\u5e76\u91cd\u65b0\u53d1\u9001' }))
    const editor = screen.getByRole('textbox', { name: '\u7f16\u8f91\u5df2\u53d1\u9001\u6d88\u606f' })
    fireEvent.change(editor, { target: { value: '  revised text  ' } })
    fireEvent.click(screen.getByRole('button', { name: '\u53d1\u9001' }))

    await waitFor(() => expect(onEditResend).toHaveBeenCalledWith('user-edit-ok', 'revised text'))
    await waitFor(() => expect(container.querySelector('.oa-message-editor')).toBeNull())
  })

  test('keeps the edited draft and exposes the error when resend fails', async () => {
    const onEditResend = vi.fn().mockRejectedValue(new Error('resend failed'))
    render(
      <ChatMessage
        message={{ id: 'user-edit-fail', role: 'user', content: 'original text' }}
        pending={false}
        onAskReply={vi.fn()}
        onEditResend={onEditResend}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '\u7f16\u8f91\u5e76\u91cd\u65b0\u53d1\u9001' }))
    const editor = screen.getByRole('textbox', { name: '\u7f16\u8f91\u5df2\u53d1\u9001\u6d88\u606f' })
    fireEvent.change(editor, { target: { value: 'draft survives' } })
    fireEvent.click(screen.getByRole('button', { name: '\u53d1\u9001' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('resend failed')
    expect(screen.getByRole('textbox', { name: '\u7f16\u8f91\u5df2\u53d1\u9001\u6d88\u606f' }).value).toBe('draft survives')
  })

  test('disables edit-resend while the current conversation is running', () => {
    render(
      <ChatMessage
        message={{ id: 'user-edit-busy', role: 'user', content: 'cannot edit yet' }}
        pending={false}
        onAskReply={vi.fn()}
        onEditResend={vi.fn()}
        editDisabled
      />,
    )

    const editButton = screen.getByRole('button', { name: '\u7f16\u8f91\u5e76\u91cd\u65b0\u53d1\u9001' })
    expect(editButton.disabled).toBe(true)
    fireEvent.click(editButton)
    expect(screen.queryByRole('textbox', { name: '\u7f16\u8f91\u5df2\u53d1\u9001\u6d88\u606f' })).toBeNull()
  })

  test('renders worldline node IDs so a restore command can reference them', () => {
    render(
      <ChatMessage
        message={{ id: 'worldline-nodes', role: 'assistant', commandResult: { command:'worldline', action:'list', tree:{ nodes:[{ id:'node-42', title:'Checkpoint' }] } } }}
        pending={false}
        onAskReply={vi.fn()}
      />,
    )

    expect(screen.getByText('node-42')).toBeTruthy()
    expect(screen.getByText('Checkpoint')).toBeTruthy()
  })
})

describe('chat model cascade', () => {
  const groups = [
    { value: 'alpha', label: 'Alpha', models: [{ value: 'a-1', label: 'Alpha One' }] },
    { value: 'beta', label: 'Beta', models: [{ value: 'b-1', label: 'Beta One' }] },
  ]

  test('keeps the runtime provider and uses the saved label as the model name', () => {
    const grouped = groupRuntimeModels([
      { index: 1, provider: 'MixinSession', failover_group: 'primary', model: 'gpt-5.6-sol', label: 'primary' },
      { index: 2, provider: 'primary', model: 'ordinary-model' },
    ])

    expect(grouped).toEqual([
      { value: 'provider:MixinSession', label: 'MixinSession', models: [{ value: 1, label: 'primary' }] },
      { value: 'provider:primary', label: 'primary', models: [{ value: 2, label: 'ordinary-model' }] },
    ])
  })

  test('shows every provider as a full group, filters by provider or model, resets search on reopen, and returns focus on Escape', () => {
    render(<ProviderModelCascade groups={groups} selectedProvider="alpha" value="a-1" onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: '\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6\uff1aAlpha One \u00b7 \u9ed8\u8ba4' })

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const dialog = screen.getByRole('dialog', { name: '\u670d\u52a1\u5546\u3001\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6' })
    expect(dialog.id).toBe(trigger.getAttribute('aria-controls'))
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Alpha One' })).toBeTruthy()
    expect(screen.getByText('Beta One')).toBeTruthy()

    const search = screen.getByRole('searchbox', { name: '\u641c\u7d22\u670d\u52a1\u5546\u6216\u6a21\u578b' })
    fireEvent.change(search, { target: { value: 'beta' } })
    expect(screen.queryByRole('heading', { name: 'Alpha' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeTruthy()
    expect(screen.getByText('Beta One')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '\u670d\u52a1\u5546\u3001\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6' })).toBeNull()
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    expect(screen.getByRole('searchbox', { name: '\u641c\u7d22\u670d\u52a1\u5546\u6216\u6a21\u578b' }).value).toBe('')
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeTruthy()
  })

  test('toggles a provider once per multi-click gesture and preserves keyboard toggles', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<React.StrictMode><ProviderModelCascade groups={groups} selectedProvider="alpha" value="a-1" onChange={onChange} /></React.StrictMode>)
    await user.click(screen.getByRole('button', { expanded: false }))
    const beta = screen.getByRole('button', { name: 'Beta', exact: true })

    await user.dblClick(beta)
    expect(beta.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Beta One' })).toBeTruthy()
    await user.click(beta)
    expect(beta.getAttribute('aria-expanded')).toBe('false')
    await user.tripleClick(beta)
    expect(beta.getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{Enter}')
    expect(beta.getAttribute('aria-expanded')).toBe('false')
    await user.keyboard(' ')
    expect(beta.getAttribute('aria-expanded')).toBe('true')
    expect(onChange).not.toHaveBeenCalled()
  })

  test('preserves expanded providers when parent model data is refreshed', () => {
    const onChange = vi.fn()
    const picker = data => <React.StrictMode><ProviderModelCascade groups={data} selectedProvider="alpha" value="a-1" onChange={onChange} /></React.StrictMode>
    const { rerender } = render(picker(groups))
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    const beta = screen.getByRole('button', { name: 'Beta', exact: true })
    fireEvent.click(beta)
    rerender(picker(groups.map(group => ({ ...group, models: group.models.map(model => ({ ...model })) }))))
    expect(screen.getByRole('button', { name: 'Beta', exact: true })).toBe(beta)
    expect(beta.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Beta One' })).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  test('opens only the selected provider, resets on reopen, and reveals search matches', () => {
    const onChange = vi.fn()
    render(<ProviderModelCascade groups={groups} selectedProvider="alpha" value="a-1" onChange={onChange} />)
    const trigger = screen.getByRole('button', { expanded: false })
    fireEvent.click(trigger)
    const beta = screen.getByRole('button', { name: 'Beta', exact: true })
    expect(beta.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(beta.getAttribute('aria-controls')).hidden).toBe(true)
    expect(screen.queryByRole('button', { name: 'Beta One' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Alpha One' })).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(beta)
    expect(screen.getByRole('button', { name: 'Beta One' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(trigger)
    expect(screen.getByRole('button', { name: 'Beta', exact: true }).getAttribute('aria-expanded')).toBe('false')
    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'Beta One' } })
    expect(screen.getByRole('button', { name: 'Beta One' })).toBeTruthy()
    fireEvent.change(search, { target: { value: '' } })
    expect(screen.queryByRole('button', { name: 'Beta One' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Beta', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Beta One' }))
    expect(onChange).toHaveBeenCalledWith('b-1')
  })

  test('selects a model directly from another provider group and keeps the combined menu open', () => {
    const onChange = vi.fn()
    render(<ProviderModelCascade groups={groups} selectedProvider="alpha" value="a-1" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: '\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6\uff1aAlpha One \u00b7 \u9ed8\u8ba4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Beta', exact: true }))
    fireEvent.scroll(window)
    expect(screen.getByRole('dialog', { name: '\u670d\u52a1\u5546\u3001\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Beta One' }))

    expect(onChange).toHaveBeenCalledWith('b-1')
    expect(screen.getByRole('dialog', { name: '\u670d\u52a1\u5546\u3001\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6' })).toBeTruthy()
  })

  test('uses a body portal and click-only provider switching on mobile', () => {
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(query => ({
        matches: query === '(max-width: 680px)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    const onChange = vi.fn()

    try {
      render(<ProviderModelCascade groups={groups} selectedProvider="alpha" value="a-1" onChange={onChange} />)
      fireEvent.click(screen.getByRole('button', { name: '\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6\uff1aAlpha One \u00b7 \u9ed8\u8ba4' }))

      const dialog = screen.getByRole('dialog', { name: '\u9009\u62e9\u6a21\u578b' })
      expect(dialog.closest('.oa-model-picker-layer')?.parentElement).toBe(document.body)
      expect(document.documentElement.style.overflow).toBe('hidden')
      fireEvent.pointerDown(screen.getByRole('tab', { name: 'Beta' }))
      expect(screen.queryByText('Beta One')).toBeNull()
      fireEvent.click(screen.getByRole('tab', { name: 'Beta' }))
      fireEvent.click(screen.getByRole('button', { name: 'Beta One' }))

      expect(onChange).toHaveBeenCalledWith('b-1')
      expect(screen.getByRole('dialog', { name: '\u9009\u62e9\u6a21\u578b' })).toBeTruthy()
      expect(document.documentElement.style.overflow).toBe('hidden')

      fireEvent.click(screen.getByRole('button', { name: '\u5173\u95ed\u6a21\u578b\u9009\u62e9\u5668' }))
      expect(screen.queryByRole('dialog', { name: '\u9009\u62e9\u6a21\u578b' })).toBeNull()
      expect(document.documentElement.style.overflow).toBe('')
    } finally {
      cleanup()
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      })
    }
  })

  test('changes reasoning through text options and keeps the menu open', () => {
    const onReasoningChange = vi.fn()
    const reasoningOptions = [
      { value: 'off', label: '\u9ed8\u8ba4' },
      { value: 'max', label: 'Max' },
    ]
    const props = {
      groups,
      selectedProvider: 'alpha',
      value: 'a-1',
      onChange: vi.fn(),
      reasoningOptions,
      onReasoningChange,
    }
    const { rerender } = render(<ProviderModelCascade {...props} reasoningValue="off" />)

    fireEvent.click(screen.getByRole('button', { name: '\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6\uff1aAlpha One \u00b7 \u9ed8\u8ba4' }))
    const defaultEffortButton = screen.getByRole('button', { name: '\u9ed8\u8ba4' })
    const maxEffortButton = screen.getByRole('button', { name: 'Max' })
    expect(defaultEffortButton.getAttribute('aria-pressed')).toBe('true')
    expect(defaultEffortButton.classList.contains('oa-reasoning-default')).toBe(true)
    expect(defaultEffortButton.textContent).toContain('\u8ddf\u968f\u6a21\u578b\u914d\u7f6e')
    expect(maxEffortButton.querySelector('.oa-reasoning-meter').style.getPropertyValue('--oa-reasoning-fill')).toBe('100%')
    fireEvent.click(maxEffortButton)

    expect(onReasoningChange).toHaveBeenCalledWith('max')
    expect(screen.getByRole('dialog', { name: '\u670d\u52a1\u5546\u3001\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6' })).toBeTruthy()
    rerender(<ProviderModelCascade {...props} reasoningValue="max" />)
    expect(screen.getByRole('button', { name: 'Max' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6\uff1aAlpha One \u00b7 Max' })).toBeTruthy()
  })

  test('shows an empty state for unmatched searches and restores the provider catalog when cleared', () => {
    render(<ProviderModelCascade groups={groups} selectedProvider="alpha" value="a-1" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6\uff1aAlpha One \u00b7 \u9ed8\u8ba4' }))

    fireEvent.change(screen.getByRole('searchbox', { name: '\u641c\u7d22\u670d\u52a1\u5546\u6216\u6a21\u578b' }), { target: { value: 'not-a-real-model' } })
    expect(screen.getByText('\u6ca1\u6709\u5339\u914d\u7684\u670d\u52a1\u5546\u6216\u6a21\u578b')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Alpha' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '\u6e05\u9664\u641c\u7d22' }))
    expect(screen.queryByText('\u6ca1\u6709\u5339\u914d\u7684\u6a21\u578b')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeTruthy()
  })
})



describe('file workflow confidence', () => {
  const fileT = {
    ...I18N.en,
    lists: { fileList: 'Files', filePreview: 'Preview' },
    hints: { filePath: 'Path', searchText: 'Search text', tailLines: 'Tail lines' },
    read: 'Read',
    search: 'Search',
    tail: 'Tail',
    download: 'Download',
    delete: 'Delete',
    save: 'Save',
    empty: 'No content',
  }

  const baseProps = () => ({
    t: fileT,
    filePath: '',
    setFilePath: vi.fn(),
    fileList: [],
    fileContent: '',
    loadedFileContent: '',
    loadedFilePath: '',
    setFileContent: vi.fn(),
    fileSearch: '',
    setFileSearch: vi.fn(),
    searchHits: [],
    tailLines: 100,
    setTailLines: vi.fn(),
    loadFiles: vi.fn(),
    readFile: vi.fn(),
    tailFile: vi.fn(),
    saveFile: vi.fn(),
    discardChanges: vi.fn(),
    deleteFile: vi.fn(),
    downloadFile: vi.fn(),
    runSearch: vi.fn(),
    busy: false,
    fileStatus: null,
    dismissFileStatus: vi.fn(),
  })

  test('starts empty and explains why Save is disabled', () => {
    render(<FilesPage {...baseProps()} />)

    const save = screen.getByRole('button', { name: 'Save' })
    expect(save.disabled).toBe(true)
    expect(save.getAttribute('aria-describedby')).toBe('file-save-reason')
    expect(document.getElementById('file-save-reason')?.textContent).toMatch(/Read a file before saving/i)
    expect(screen.getByText(/No file loaded/)).toBeTruthy()
  })

  test('shows dirty and retargeted state, saves explicitly, and can discard', () => {
    const props = baseProps()
    Object.assign(props, {
      filePath: 'C:/ga/renamed.txt',
      loadedFilePath: 'C:/ga/original.txt',
      loadedFileContent: 'before',
      fileContent: 'after',
    })
    render(<FilesPage {...props} />)

    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(screen.getByText('Save target changed')).toBeTruthy()
    expect(document.querySelector('.file-save-review')?.textContent).toMatch(/renamed\.txt/)
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    expect(props.saveFile).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Discard changes/i }))
    expect(props.discardChanges).toHaveBeenCalledTimes(1)
  })

  test('keeps no-match search distinct from the initial search hint', () => {
    const props = baseProps()
    Object.assign(props, {
      filePath: 'C:/ga',
      fileSearch: 'missing-token',
      fileStatus: { kind: 'success', action: 'search', message: 'No matches found for \"missing-token\".' },
    })
    render(<FilesPage {...props} />)

    expect(screen.getByText('No matches found')).toBeTruthy()
    expect(screen.queryByText(/Enter search text, then run search/)).toBeNull()
  })

  test('renders save success and a recoverable save error', () => {
    const successProps = baseProps()
    successProps.fileStatus = { kind: 'success', message: 'Saved C:/ga/a.txt' }
    const { rerender } = render(<FilesPage {...successProps} />)
    expect(screen.getByText('Saved C:/ga/a.txt')).toBeTruthy()

    const errorProps = baseProps()
    const retrySave = vi.fn()
    errorProps.fileStatus = { kind: 'error', message: 'Save failed: disk full', onRetry: retrySave }
    rerender(<FilesPage {...errorProps} />)
    expect(screen.getByRole('alert').textContent).toMatch(/Save failed: disk full/)
    fireEvent.click(screen.getByRole('button', { name: /Retry file action/i }))
    expect(retrySave).toHaveBeenCalledTimes(1)
  })
})

describe('usage overview page', () => {
  const payload = {
    totals: { input_tokens: 1200, output_tokens: 345, total_tokens: 1545 },
    session_count: 2,
    sessions_with_usage: 1,
    assistant_replies: 3,
    skipped_sessions: 0,
    models: [{ id: 'gpt-5', name: 'gpt-5', assistant_replies: 3, totals: { input_tokens: 1200, output_tokens: 345, total_tokens: 1545 } }],
    sessions: [{ id: 'session-1', name: 'Alpha', updated_at: 1700000000000, assistant_replies: 3, totals: { input_tokens: 1200, output_tokens: 345, total_tokens: 1545 } }],
    daily: [{ date: new Date().toISOString().slice(0, 10), assistant_replies: 3, totals: { input_tokens: 1200, output_tokens: 345, total_tokens: 1545 } }],
  }

  test('renders aggregate and breakdown data', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(payload))
    render(<UsagePage lang="en" />)
    expect((await screen.findAllByTitle('1,545')).length).toBeGreaterThan(0)
    expect((screen.getAllByText('gpt-5')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.queryByText('Session details')).toBeNull()
    expect(screen.getByText('Daily activity')).toBeTruthy()
    const heatCells = document.querySelectorAll('.usage-heat-cell')
    expect(heatCells.length).toBeGreaterThanOrEqual(358)
    expect(heatCells.length).toBeLessThanOrEqual(364)
    expect(document.querySelector('.usage-heat-cell:not([data-level="0"])')).toBeTruthy()
  })

  test('renders an explicit empty state', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ ...payload, totals: {}, session_count: 0, sessions_with_usage: 0, assistant_replies: 0, models: [], sessions: [] }))
    render(<UsagePage lang="en" />)
    expect(await screen.findByText('No token usage has been recorded yet.')).toBeTruthy()
  })

  test('recovers from a request error', async () => {
    globalThis.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('network offline'))
      .mockResolvedValueOnce(jsonResponse(payload))
    render(<UsagePage lang="en" />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/network offline/i)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect((await screen.findAllByTitle('1,545')).length).toBeGreaterThan(0)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })
})

describe('operator shell feedback', () => {
  const shellPayload = (url) => {
    const path = new URL(url, 'http://localhost').pathname
    const payloads = {
      '/api/config': { host: '127.0.0.1', port: 8900, ga_root: 'C:/ga' },
      '/api/ga/health': { ok: true },
      '/api/autostart/status': { supported: true, enabled: false },
      '/api/version/info': { version: 'dev' },
      '/api/version/status': {},
      '/api/observability/health': { ok: true },
      '/api/observability/inventory': {},
      '/api/observability/risks': {},
      '/api/services': { services: [] },
      '/api/ga/git-status': { ok: true, available: true, branch: 'main', commit: 'abc1234', upstream: 'origin/main', upstream_configured: true, latest: true },
    }
    return jsonResponse(payloads[path] ?? {})
  }

  test('keeps the mobile sidebar above its scrim', () => {
    expect(adminMobileStyles).toMatch(/\.app > \.sidebar\s*\{[^}]*z-index:\s*1001\s*!important;/s)
    expect(adminMobileStyles).toMatch(/\.admin-sidebar-scrim\s*\{[^}]*z-index:\s*1000;/s)
  })

  test('navigation exposes the selected route with native keyboard semantics', async () => {
    installBrowserPolyfills()
    globalThis.fetch = vi.fn(async (url) => shellPayload(url))
    render(<App />)
    const files = await screen.findByRole('button', { name: /文件|Files/i })
    const usage = screen.getByRole('button', { name: /用量总览|Usage/i })
    const overview = screen.getByRole('button', { name: /^(总览|Overview)$/i })
    const pageHeader = document.querySelector('.admin-page-header')
    expect(document.querySelectorAll('.admin-page-header')).toHaveLength(1)
    // The header is a label line only: the service status belongs to the shell,
    // which renders one copy for the sidebar and one for the collapsed bar.
    expect(pageHeader?.querySelector('.admin-service-status')).toBeNull()
    const statuses = document.querySelectorAll('.admin-service-status')
    expect(statuses).toHaveLength(2)
    expect(document.querySelector('#admin-sidebar > .admin-service-status')).toBeTruthy()
    expect(document.querySelector('.admin-mobile-bar > .admin-service-status')).toBeTruthy()
    statuses.forEach(status => {
      expect(status.getAttribute('aria-label')).toMatch(/服务状态|Service status/i)
      expect(status.querySelector('.admin-service-health')?.getAttribute('role')).toBe('status')
    })
    expect(pageHeader?.querySelector('h2')?.textContent).toMatch(/总览|Overview/i)
    expect(overview.getAttribute('aria-current')).toBe('page')
    expect(usage.tagName).toBe('BUTTON')
    expect(usage.disabled).toBe(false)
    files.focus()
    expect(document.activeElement).toBe(files)
    expect(files.tagName).toBe('BUTTON')
    fireEvent.click(files)
    expect(files.getAttribute('aria-current')).toBe('page')
    expect(files.disabled).toBe(false)
    expect(document.querySelectorAll('.admin-page-header')).toHaveLength(1)
    expect(document.querySelector('.admin-page-header h2')?.textContent).toMatch(/文件|Files/i)
  })

  test('mobile admin navigation opens and closes without trapping off-screen controls', async () => {
    installBrowserPolyfills()
    globalThis.fetch = vi.fn(async (url) => shellPayload(url))
    render(<App />)

    const files = await screen.findByRole('button', { name: /文件|Files/i })
    const shell = document.querySelector('.app')
    const open = screen.getByRole('button', { name: /展开管理导航|Open admin navigation/i })
    expect(shell?.classList.contains('admin-sidebar-open')).toBe(false)
    expect(open.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(open)
    expect(shell?.classList.contains('admin-sidebar-open')).toBe(true)
    expect(open.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: /收起管理导航|Collapse admin navigation/i }))
    expect(shell?.classList.contains('admin-sidebar-open')).toBe(false)

    fireEvent.click(open)
    fireEvent.click(files)
    expect(shell?.classList.contains('admin-sidebar-open')).toBe(false)
  })

  test('explicitly selects each theme from the picker and recovers from an invalid stored id', async () => {
    installBrowserPolyfills()
    window.localStorage.setItem('ga-admin-theme', 'removed-theme')
    globalThis.fetch = vi.fn(async (url) => shellPayload(url))
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: /文件|Files/i })

    // Appearance lives on the General settings page, not in the shell chrome.
    fireEvent.click(screen.getByRole('button', { name: /^(常规|General)$/i }))
    const trigger = await screen.findByRole('button', { name: /外观|Appearance/i })
    expect(trigger).toBeTruthy()
    
    await user.click(trigger)
    
    // Wait for panel to appear in DOM
    const panel = await waitFor(() => {
      const p = document.querySelector('.theme-picker-panel')
      expect(p).toBeTruthy()
      return p
    }, { timeout: 3000 })
    
    expect(panel).toBeTruthy()
    expect(panel.querySelectorAll('.theme-picker-option').length).toBe(THEMES.length)
  })

  test('switches the complete overview shell to English without stale Chinese labels', async () => {
    installBrowserPolyfills()
    globalThis.fetch = vi.fn(async (url) => shellPayload(url))
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '常规' }))
    fireEvent.click(await screen.findByRole('button', { name: 'English' }))
    expect(screen.getByRole('button', { name: /Appearance/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Overview$/i }))

    expect(await screen.findByText('Version management')).toBeTruthy()
    expect(screen.getByText('Read-only observability')).toBeTruthy()
    expect(screen.getByText('GA source')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Run \/update in chat/i })).toBeTruthy()
    expect(screen.queryByText('只读观测')).toBeNull()
    expect(screen.queryByText('版本管理')).toBeNull()
    expect(screen.queryByText('GA 源代码')).toBeNull()
    expect(document.documentElement.lang).toBe('en')
    expect(window.localStorage.getItem('ga-admin-lang')).toBe('en')
  })

  // A GA root without git still has a path worth showing and /update to point at,
  // so only the rows that need git disappear.
  test('keeps the GA source card without git but drops the branch row and check button', async () => {
    installBrowserPolyfills()
    globalThis.fetch = vi.fn(async (url) => {
      const path = new URL(url, 'http://localhost').pathname
      if (path === '/api/ga/git-status') return jsonResponse({ ok: true, available: false, reason: 'git_missing' })
      return shellPayload(url)
    })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /^(总览|Overview)$/i }))

    expect(await screen.findByText('版本管理')).toBeTruthy()
    expect(screen.getByText('GA 源代码')).toBeTruthy()
    expect(screen.getByText('未检测到 git 命令，无法读取分支与更新状态。')).toBeTruthy()
    expect(screen.getByRole('button', { name: /去对话执行 \/update/i })).toBeTruthy()
    expect(screen.queryByText('分支')).toBeNull()
    expect(screen.queryByRole('button', { name: /检查是否最新/i })).toBeNull()
  })

  test('shows the branch row and check button once git can answer', async () => {
    installBrowserPolyfills()
    globalThis.fetch = vi.fn(async (url) => {
      const path = new URL(url, 'http://localhost').pathname
      if (path === '/api/ga/git-status') {
        return jsonResponse({ ok: true, available: true, root: '/ga', branch: 'main', commit: 'abc1234', upstream_configured: true, latest: true })
      }
      return shellPayload(url)
    })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /^(总览|Overview)$/i }))

    expect(await screen.findByText('GA 源代码')).toBeTruthy()
    expect(screen.getByText('分支')).toBeTruthy()
    expect(screen.getByText(/main · abc1234/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /检查是否最新/i })).toBeTruthy()
  })

  test('refresh shows pending, success, and a recoverable error', async () => {
    installBrowserPolyfills()
    let configCalls = 0
    let releaseRefresh
    globalThis.fetch = vi.fn((url) => {
      const path = new URL(url, 'http://localhost').pathname
      if (path === '/api/config') {
        configCalls += 1
        if (configCalls === 2) return new Promise(resolve => { releaseRefresh = () => resolve(shellPayload(url)) })
        if (configCalls === 3) return Promise.reject(new Error('network offline'))
      }
      return Promise.resolve(shellPayload(url))
    })
    render(<App />)
    await screen.findByText(/运行状态已刷新/)
    const refresh = document.querySelector('button.refresh')
    expect(refresh).toBeTruthy()

    fireEvent.click(refresh)
    expect(await screen.findByText(/正在刷新运行状态/)).toBeTruthy()
    expect(refresh.disabled).toBe(true)
    releaseRefresh()
    expect(await screen.findByText(/运行状态已刷新/)).toBeTruthy()
    await waitFor(() => expect(refresh.disabled).toBe(false))

    fireEvent.click(refresh)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/刷新失败.*network offline/i)
    expect(screen.getByRole('button', { name: /重试|Retry/ }).disabled).toBe(false)
  })

  test('service actions stay local to one card and expose failure recovery', async () => {
    installBrowserPolyfills()
    window.history.replaceState({}, '', '/channels')
    mockDialog()
    const services = [
      { name: 'alpha-ui', kind: 'frontend', running: false, autostart: false },
      { name: 'beta-ui', kind: 'frontend', running: false, autostart: false },
    ]
    let actionAttempts = 0
    let rejectAction
    globalThis.fetch = vi.fn((url, options = {}) => {
      const path = new URL(url, 'http://localhost').pathname
      if (path === '/api/services/start' && options.method === 'POST') {
        actionAttempts += 1
        if (actionAttempts === 1) return new Promise((resolve, reject) => { rejectAction = reject })
        return Promise.resolve(jsonResponse({ ok: true }))
      }
      if (path === '/api/services') return Promise.resolve(jsonResponse({ services }))
      return Promise.resolve(shellPayload(url))
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('tab', { name: /服务管理|Service management/i }))
    const alphaLabel = await screen.findByText('alpha-ui')
    const betaLabel = screen.getByText('beta-ui')
    const alphaCard = alphaLabel.closest('article')
    const betaCard = betaLabel.closest('article')
    const alphaStart = alphaCard.querySelectorAll('button')[0]
    const betaStart = betaCard.querySelectorAll('button')[0]

    fireEvent.click(alphaStart)
    await waitFor(() => expect(alphaCard.getAttribute('aria-busy')).toBe('true'))
    expect(alphaStart.disabled).toBe(true)
    expect(betaStart.disabled).toBe(false)
    fireEvent.click(alphaStart)
    expect(actionAttempts).toBe(1)

    rejectAction(new Error('backend offline'))
    const actionAlert = await screen.findByRole('alert')
    expect(actionAlert.textContent).toContain('backend offline')
    expect(betaStart.disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /Retry|\u91cd\u8bd5/i }))
    await waitFor(() => expect(actionAttempts).toBe(2))
    await waitFor(() => expect(alphaCard.querySelector('.service-action-status.success')).toBeTruthy())
  })

  test('log streaming distinguishes selection, connection, empty, failure, retry, pause, and resume', async () => {
    installBrowserPolyfills()
    window.history.replaceState({}, '', '/logs')
    const services = [{ name: 'alpha-worker', kind: 'task', running: true, pid: 42, command: ['agentmain', '--worker'] }]
    globalThis.fetch = vi.fn((url) => {
      const path = new URL(url, 'http://localhost').pathname
      if (path === '/api/services') return Promise.resolve(jsonResponse({ services }))
      return Promise.resolve(shellPayload(url))
    })

    const streams = []
    class FakeEventSource {
      constructor(url) { this.url = url; this.listeners = {}; this.close = vi.fn(); streams.push(this) }
      addEventListener(name, handler) { this.listeners[name] = handler }
      emit(name, payload) { this.listeners[name]?.({ data: JSON.stringify(payload) }) }
    }
    vi.stubGlobal('EventSource', FakeEventSource)

    render(<App />)
    await screen.findByText('alpha-worker')
    expect(document.querySelector('.log-selection-empty')).toBeTruthy()

    fireEvent.click(screen.getByText('alpha-worker').closest('button'))
    await waitFor(() => expect(streams).toHaveLength(1))
    expect(streams[0].url).toBe('/api/logs/alpha-worker/stream?lines=200')
    expect(document.querySelector('.stream-state.connecting')).toBeTruthy()

    streams[0].onopen()
    streams[0].emit('snapshot', { lines: [] })
    await waitFor(() => expect(document.querySelector('.log-output-empty')).toBeTruthy())

    streams[0].onerror()
    const streamAlert = await screen.findByRole('alert')
    expect(streamAlert.textContent).toMatch(/log|\u65e5\u5fd7/i)
    fireEvent.click(screen.getByRole('button', { name: /Retry|\u91cd\u8bd5/i }))
    await waitFor(() => expect(streams).toHaveLength(2))
    expect(streams[0].close).toHaveBeenCalled()

    streams[1].onopen()
    streams[1].emit('log', { line: 'ready' })
    expect(await screen.findByText('ready')).toBeTruthy()
    const logView = document.querySelector('.log-view')
    Object.defineProperties(logView, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    fireEvent.scroll(logView)
    const follow = screen.getByRole('button', { name: /Follow|\u8ddf\u968f/i })
    expect(follow.getAttribute('aria-pressed')).toBe('false')
    // Scrolling away from the tail offers a way back instead of a status line.
    expect(document.querySelector('.log-jump')).toBeTruthy()
    fireEvent.click(follow)
    expect(follow.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.log-jump')).toBeFalsy()
  })

  test('log filtering hides non-matching lines but keeps their tail position', async () => {
    installBrowserPolyfills()
    window.history.replaceState({}, '', '/logs')
    const services = [{ name: 'alpha-worker', kind: 'task', running: true, pid: 42, command: ['agentmain'] }]
    globalThis.fetch = vi.fn((url) => {
      const path = new URL(url, 'http://localhost').pathname
      if (path === '/api/services') return Promise.resolve(jsonResponse({ services }))
      return Promise.resolve(shellPayload(url))
    })

    const streams = []
    class FakeEventSource {
      constructor(url) { this.url = url; this.listeners = {}; this.close = vi.fn(); streams.push(this) }
      addEventListener(name, handler) { this.listeners[name] = handler }
      emit(name, payload) { this.listeners[name]?.({ data: JSON.stringify(payload) }) }
    }
    vi.stubGlobal('EventSource', FakeEventSource)

    render(<App />)
    fireEvent.click((await screen.findByText('alpha-worker')).closest('button'))
    await waitFor(() => expect(streams).toHaveLength(1))
    streams[0].onopen()
    streams[0].emit('snapshot', { lines: ['boot ok', 'ERROR disk full', 'still going'] })

    await waitFor(() => expect(document.querySelectorAll('.log-line')).toHaveLength(3))
    expect(document.querySelector('.log-line.is-error')).toBeTruthy()

    const filter = screen.getByRole('searchbox')
    fireEvent.change(filter, { target: { value: 'disk' } })
    await waitFor(() => expect(document.querySelectorAll('.log-line')).toHaveLength(1))
    expect(document.querySelector('.log-line-no').textContent).toBe('2')
    expect(document.querySelector('.log-view mark').textContent).toBe('disk')

    fireEvent.change(filter, { target: { value: 'nothing-matches' } })
    await waitFor(() => expect(document.querySelector('.log-output-empty')).toBeTruthy())
  })
})

describe('first-run setup shell', () => {
  test('App renders SetupWizard when GA root is not configured', async () => {
    installBrowserPolyfills()
    globalThis.fetch = setupFetch
    render(<App />)
    await waitFor(() => expect(screen.getByText(/首次启动配置|First/i)).toBeTruthy())
    expect(screen.getByText(/GA Admin Bootstrap/i)).toBeTruthy()
  })
})
