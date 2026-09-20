import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import example from './example.json'
import { createPluginStore } from './store'
import { PluginManager } from './PluginManager'
import { ChatReplacement, ExternalUiProvider, useExternalUi, dispatchChatAction } from './runtime'
import { validateBundle } from './protocol'
import { persistCustomColorsLocal, getInitialCustomColors } from '../../themes'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const fresh = () => structuredClone(example)
function State() {
  const ui = useExternalUi()
  return <output data-testid="selection">{ui.bundle ? `${ui.bundle.manifest.id}:${ui.bundle.config.accent}` : 'default'}</output>
}
function ManagerHost({ store }) { return <ExternalUiProvider store={store}><State/><PluginManager/></ExternalUiProvider> }

it('rejects schema edits visibly, persists valid edits on host rebuild and restores without losing config', async () => {
  const db = new IDBFactory(), store = createPluginStore(() => db)
  await store.install(fresh())
  const mounted = render(<ManagerHost store={store}/>)
  await screen.findByRole('option', { name: /Local Workshop/ })
  fireEvent.change(screen.getByLabelText('Installed plugin'), { target: { value: 'local-workshop' } })
  const accent = await screen.findByLabelText('Accent')
  fireEvent.change(accent, { target: { value: 'red' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save plugin configuration' }))
  await screen.findByText('Use a six-digit hex color')
  expect((await store.load('local-workshop')).config.accent).toBe('#557766')
  fireEvent.change(accent, { target: { value: '#123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save plugin configuration' }))
  await screen.findByText('Configuration saved locally')
  fireEvent.click(screen.getByRole('button', { name: 'Enable plugin' }))
  await waitFor(() => expect(screen.getByTestId('selection').textContent).toBe('local-workshop:#123456'))
  mounted.unmount()
  const reloaded = createPluginStore(() => db)
  render(<ManagerHost store={reloaded}/>)
  await waitFor(() => expect(screen.getByTestId('selection').textContent).toBe('local-workshop:#123456'))
  fireEvent.click(screen.getByRole('button', { name: 'Restore default' }))
  await screen.findByText('Default restored; installed packages and configuration retained')
  expect(await reloaded.active()).toBe('default')
  expect((await reloaded.load('local-workshop')).config.accent).toBe('#123456')
  expect(screen.getByRole('link', { name: 'Independent recovery' }).getAttribute('href')).toBe('/admin/overview?ui=safe')
})

it('reports failed saves and activation without changing persisted config or claiming success', async () => {
  const db = new IDBFactory(), store = createPluginStore(() => db)
  await store.install(fresh())
  render(<ManagerHost store={store}/>)
  await screen.findByRole('option', { name: /Local Workshop/ })
  fireEvent.change(screen.getByLabelText('Installed plugin'), { target: { value: 'local-workshop' } })
  fireEvent.change(await screen.findByLabelText('Accent'), { target: { value: '#123456' } })
  vi.spyOn(store, 'saveConfig').mockRejectedValue(new Error('Offline storage quota failure'))
  fireEvent.click(screen.getByRole('button', { name: 'Save plugin configuration' }))
  await screen.findByText('Offline storage quota failure')
  expect(screen.queryByText('Configuration saved locally')).toBeNull()
  expect((await store.load('local-workshop')).config.accent).toBe('#557766')
  vi.spyOn(store, 'activate').mockRejectedValue(new Error('Offline transaction aborted'))
  fireEvent.click(screen.getByRole('button', { name: 'Enable plugin' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert').textContent).toBe('Offline transaction aborted')
  expect(screen.getByTestId('selection').textContent).toBe('default')
  expect(await store.active()).toBe('default')
  expect(screen.queryByText('Enabled saved configuration')).toBeNull()
})

it.each(['missing', 'corrupt'])('falls back only the %s replacement surface and retains its healthy sibling', async mode => {
  const bundle = fresh()
  // Simulate runtime corruption after a valid store read; import still rejects this shape.
  if (mode === 'missing') delete bundle.views['chat.navigation']
  else bundle.views['chat.navigation'].content = { type: 'script', text: 'bad' }
  const store = { active: async () => 'local-workshop', load: async () => bundle }
  render(<ExternalUiProvider store={store}>
    <ChatReplacement area="chat.navigation"><p>Host navigation fallback</p></ChatReplacement>
    <ChatReplacement area="chat.followToolbar"><p>Host toolbar fallback</p></ChatReplacement>
  </ExternalUiProvider>)
  await screen.findByRole('heading', { name: 'Reading controls' })
  expect(screen.getByText('Host navigation fallback')).toBeTruthy()
  expect(screen.queryByText('Host toolbar fallback')).toBeNull()
  expect(screen.queryByText('bad')).toBeNull()
})

it('wires replacement named actions and guards disabled controls plus direct dispatch', async () => {
  const bundle = validateBundle(fresh()), actions = { newChat: vi.fn(), collapseSidebar: vi.fn(), followLatest: vi.fn() }
  const store = { active: async () => 'local-workshop', load: async () => bundle }
  function Slots({ blocked, loading, canFollow }) {
    return <ExternalUiProvider store={store}>
      <ChatReplacement area="chat.navigation" state={{ blocked }} actions={actions}><p>host nav</p></ChatReplacement>
      <ChatReplacement area="chat.followToolbar" state={{ loading, canFollow }} actions={actions}><p>host toolbar</p></ChatReplacement>
    </ExternalUiProvider>
  }
  const host = render(<Slots blocked loading canFollow/>)
  const start = await screen.findByRole('button', { name: 'Start conversation' })
  expect(start.disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Return to latest' }).disabled).toBe(true)
  fireEvent.click(start)
  dispatchChatAction('chat.navigation', { action: 'newChat' }, { blocked: true }, actions)
  dispatchChatAction('chat.followToolbar', { action: 'followLatest' }, { canFollow: true, loading: true }, actions)
  dispatchChatAction('chat.navigation', { action: 'newChat', target: 'arbitrary' }, {}, actions)
  Object.values(actions).forEach(action => expect(action).not.toHaveBeenCalled())
  host.rerender(<Slots blocked={false} loading={false} canFollow/>)
  fireEvent.click(start)
  fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }))
  fireEvent.click(screen.getByRole('button', { name: 'Return to latest' }))
  Object.values(actions).forEach(action => expect(action).toHaveBeenCalledOnce())
  host.rerender(<Slots canFollow={false}/>)
  expect(screen.getByRole('button', { name: 'Return to latest' }).disabled).toBe(true)
  for (const content of [undefined, { type: 'text', bind: 'draft' }, { type: 'button', action: 'send', text: 'send' }, { type: 'button', action: 'followLatest', text: 'wrong area' }]) {
    const invalid = fresh(); invalid.views['chat.navigation'].content = content
    expect(() => validateBundle(invalid)).toThrow()
  }
})

it('projects replacement state coherently and enforces every named-action guard', async () => {
  const bundle = fresh(), actions = Object.fromEntries(['newChat', 'manageSessions', 'openSettings', 'collapseSidebar', 'followLatest'].map(name => [name, vi.fn()]))
  const store = { active: async () => bundle.manifest.id, load: async () => bundle }
  const view = (area, state) => <ExternalUiProvider store={store}><ChatReplacement area={area} state={state} actions={actions}/></ExternalUiProvider>
  const { rerender } = render(view('chat.navigation', { blocked: true, count: -1 }))
  await screen.findByText('Busy')
  expect(screen.getByText('0')).toBeTruthy()
  for (const name of ['Start conversation', 'Browse conversations', 'Workspace settings', 'Collapse navigation']) {
    const button = screen.getByRole('button', { name }); expect(button.disabled).toBe(true); fireEvent.click(button)
  }
  expect(actions.newChat).not.toHaveBeenCalled(); expect(actions.manageSessions).not.toHaveBeenCalled()
  expect(actions.openSettings).not.toHaveBeenCalled(); expect(actions.collapseSidebar).not.toHaveBeenCalled()
  rerender(view('chat.navigation', { managing: true, count: 2 }))
  expect(screen.getByText('Managing sessions')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Browse conversations' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }))
  expect(actions.newChat).toHaveBeenCalledOnce()
  rerender(view('chat.navigation', { count: 2 }))
  fireEvent.click(screen.getByRole('button', { name: 'Workspace settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }))
  expect(actions.openSettings).toHaveBeenCalledOnce(); expect(actions.collapseSidebar).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Browse conversations' }))
  expect(actions.manageSessions).toHaveBeenCalledOnce()
  rerender(view('chat.followToolbar', { canFollow: true, loading: true }))
  expect(screen.getByText('Loading')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Return to latest' }).disabled).toBe(true)
  rerender(view('chat.followToolbar', { canFollow: true }))
  expect(screen.getByText('Latest messages available')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Return to latest' }))
  expect(actions.followLatest).toHaveBeenCalledOnce()
  rerender(view('chat.followToolbar', {}))
  expect(screen.getByText('At latest message')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Return to latest' }).disabled).toBe(true)
})


it('retains historical custom colors while external UI suppresses their selectors and restores them on default', async () => {
  const previousStorage = { ...localStorage }
  const previousInjected = window.__GA_UI_CUSTOM_COLORS__
  delete window.__GA_UI_CUSTOM_COLORS__
  try {
    const colors = { 'oa-bg': '#112233', 'bg': '#445566' }
    persistCustomColorsLocal(colors)
    const stored = { ...localStorage }
    const style = [...document.querySelectorAll('style')].find(el => el.textContent.includes('--oa-bg:#112233'))
    expect(style).toBeTruthy()
    const selector = style.sheet.cssRules[0].selectorText
    expect(document.documentElement.matches(selector)).toBe(true)
    // Keep one factory for persistence across every operation.
    const db = new IDBFactory(), persistent = createPluginStore(() => db)
    await persistent.install(fresh())
    const mounted = render(<ManagerHost store={persistent}/>)
    await screen.findByRole('option', { name: /Local Workshop/ })
    fireEvent.change(screen.getByLabelText('Installed plugin'), { target: { value: 'local-workshop' } })
    await screen.findByLabelText('Accent')
    fireEvent.click(screen.getByRole('button', { name: 'Enable plugin' }))
    await waitFor(() => expect(document.documentElement.dataset.externalUi).toBe('active'))
    expect(document.documentElement.matches(selector)).toBe(false)
    expect(getInitialCustomColors()).toEqual(colors)
    expect({ ...localStorage }).toEqual(stored)
    fireEvent.click(screen.getByRole('button', { name: 'Restore default' }))
    await waitFor(() => expect(document.documentElement.dataset.externalUi).toBeUndefined())
    expect(document.documentElement.matches(selector)).toBe(true)
    expect(getInitialCustomColors()).toEqual(colors)
    expect({ ...localStorage }).toEqual(stored)
    mounted.unmount()
  } finally {
    persistCustomColorsLocal({})
    localStorage.clear()
    Object.entries(previousStorage).forEach(([key, value]) => localStorage.setItem(key, value))
    if (previousInjected !== undefined) window.__GA_UI_CUSTOM_COLORS__ = previousInjected
  }
})

it.each(['chat.navigation', 'chat.followToolbar'])('rejects incomplete required controls in %s', area => {
  const bundle = fresh()
  bundle.views[area].content = { type: 'text', text: 'No controls' }
  expect(() => validateBundle(bundle)).toThrow('Missing required replacement action')
})
