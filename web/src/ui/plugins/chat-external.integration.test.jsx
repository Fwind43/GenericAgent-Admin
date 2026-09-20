import React from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import ChatApp from '../../ChatApp'
import { UiHost } from '../UiHost'
import { PluginManager } from './PluginManager'
import { createPluginStore } from './store'
import { validateBundle } from './protocol'
import { dispatchChatAction } from './runtime'
import example from './example.json'
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('real ChatApp retains roots, message, draft, attachment, scroll and subscriptions through external install, enable and restore', async () => {
  history.replaceState(null, '', '/chat')
  localStorage.clear()
  localStorage.setItem('ga-admin-lang', 'en')
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  Element.prototype.scrollIntoView = () => {}
  const sources = []
  vi.stubGlobal('EventSource', class {
    constructor(url) { this.url = url; this.closed = false; sources.push(this) }
    addEventListener() {}
    removeEventListener() {}
    close() { this.closed = true }
  })
  const session = { id: 's1', title: 'Fixture conversation', count: 1, updated_at: '2026-09-20T00:00:00Z' }
  let created = false
  const secondSession = { id: 's2', title: 'New fixture conversation', count: 0 }
  const calls = [], unexpected = []
  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const u = new URL(String(input), location.origin)
    const key = `${init.method || 'GET'} ${u.pathname}`
    calls.push(key)
    let data
    switch (key) {
      case 'GET /api/config': data = { slash_commands: [] }; break
      case 'GET /api/slash-commands': data = { commands: [] }; break
      case 'PUT /api/ui/theme': data = JSON.parse(init.body); break
      case 'GET /api/instances': data = { default_id: 'local', instances: [{ id: 'local', name: 'Local', mode: 'local' }] }; break
      case 'GET /api/extra-system-prompt-presets': data = { presets: [] }; break
      case 'GET /api/chat/sessions': data = { sessions: created ? [secondSession, session] : [session], projects: [] }; break
      case 'GET /api/chat/session/s1': data = { ...session, messages: [{ id: 'm1', role: 'user', content: 'Retained fixture message' }], raw_history: [], settings: {}, queued_messages: [] }; break
      case 'POST /api/chat/s1':
        throw new Error("Unexpected send")
        return new Response('data: {"type":"done"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      case 'POST /api/chat/session/new': created = true; data = secondSession; break
      case 'GET /api/chat/session/s2': data = { ...secondSession, messages: [], settings: {}, queued_messages: [] }; break
      case 'GET /api/chat/state/s2':
      case 'GET /api/chat/queue/s2': data = { running: false, models: [], settings: {}, queued_messages: [] }; break
      case 'GET /api/chat/state/s1': data = { running: false, models: [], settings: {}, queued_messages: [] }; break
      case 'GET /api/chat/queue/s1': data = { queued_messages: [] }; break
      default: unexpected.push(key); throw new Error('Unexpected fixture request: ' + key)
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const db = new IDBFactory(), store = createPluginStore(() => db), settings = vi.fn()
  vi.stubGlobal('indexedDB', db)
  const { container } = render(<UiHost><PluginManager/><ChatApp onOpenSettings={settings}/></UiHost>)
  const message = await screen.findByText('Retained fixture message', { selector: '.oa-msg-text' })
  const composer = await screen.findByPlaceholderText(/Message GenericAgent/)
  fireEvent.change(composer, { target: { value: 'private unsent draft' } })
  const fileInput = container.querySelector('.oa-composer input[type="file"]')
  fireEvent.change(fileInput, { target: { files: [new File(['private bytes'], 'private-note.txt', { type: 'text/plain' })] } })
  const attachment = await waitFor(() => { const el = container.querySelector('.oa-attach-thumb'); expect(el).toBeTruthy(); return el })
  const areas = ['chat.sidebar', 'chat.messages', 'chat.composer']
  const roots = areas.map(area => container.querySelector(`[data-ui-surface="${area}"]`))
  const sourceCount = sources.length, source = sources.find(s => !s.closed)
  roots[1].scrollTop = 61
  const assertRetained = () => {
    areas.forEach((area, i) => expect(container.querySelector(`[data-ui-surface="${area}"]`)).toBe(roots[i]))
    expect(screen.getByPlaceholderText(/Message GenericAgent/)).toBe(composer)
    expect(composer.value).toBe('private unsent draft')
    expect(container.querySelector('.oa-msg-text')).toBe(message)
    expect(container.querySelector('.oa-attach-thumb')).toBe(attachment)
    expect(roots[1].scrollTop).toBe(61)
    expect(sources.length).toBe(sourceCount)
    expect(source.closed).toBe(false)
  }
  const bytes = readFileSync('public/ui-plugins/local-workshop.gaui.zip')
  const archive = { name: 'local-workshop.gaui.zip', size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
  fireEvent.change(screen.getByLabelText('Install .gaui.zip'), { target: { files: [archive] } })
  await screen.findByText('Installed locally; not enabled')
  expect(container.querySelector('[data-chat-decoration]')).toBeNull()
  assertRetained()
  const mountingCalls = [...calls], mountingSources = sources.length
  fireEvent.click(screen.getByRole('button', { name: 'Preview', exact: true }))
  const preview = await screen.findByRole('region', { name: 'Fictional plugin preview' })
  within(preview).getAllByRole('button').forEach(button => fireEvent.click(button))
  expect(calls).toEqual(mountingCalls)
  expect(sources).toHaveLength(mountingSources)
  expect(await store.active()).toBe('default')
  assertRetained()
  // Hide the fictional preview so all following queries address the real host.
  fireEvent.change(screen.getByLabelText('Installed plugin'), { target: { value: 'local-workshop' } })
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Fictional plugin preview' })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Enable plugin' }))
  await screen.findByRole('heading', { name: 'Workshop writing desk' })
  expect(container.querySelectorAll('[data-chat-decoration]')).toHaveLength(6)
  assertRetained()
  const navigation = container.querySelector('[data-chat-replacement="chat.navigation"]')
  const toolbar = container.querySelector('[data-chat-replacement="chat.followToolbar"]')
  expect(navigation).not.toBeNull()
  expect(toolbar).not.toBeNull()
  expect(container.querySelector('.oa-side-head')).toBeNull()
  expect(container.querySelector('.oa-follow-row')).toBeNull()
  fireEvent.click(within(navigation).getByRole('button', { name: 'Collapse navigation' }))
  expect(roots[0].classList.contains('collapsed')).toBe(true)
  assertRetained()
  fireEvent.click(within(navigation).getByRole('button', { name: 'Workspace settings' }))
  expect(settings).toHaveBeenCalledOnce()
  fireEvent.click(within(navigation).getByRole('button', { name: 'Browse conversations' }))
  expect(within(navigation).getByRole('button', { name: 'Browse conversations' }).disabled).toBe(true)
  assertRetained()
  expect(within(toolbar).getByRole('button', { name: 'Return to latest' }).disabled).toBe(true)
  expect(within(navigation).getByText('Managing sessions')).toBeTruthy()
  expect(within(toolbar).getByText('At latest message')).toBeTruthy()
  // jsdom has no layout: only scroll geometry is fictional; event/state/handler are real.
  Object.defineProperties(roots[1], { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 100 } })
  fireEvent.wheel(roots[1], { deltaY: -120 })
  await waitFor(() => expect(within(toolbar).getByRole('button', { name: 'Return to latest' }).disabled).toBe(false))
  expect(within(toolbar).getByText('Latest messages available')).toBeTruthy()
  const scrollTo = vi.fn()
  Object.defineProperty(roots[1], 'scrollTo', { configurable: true, value: scrollTo })
  fireEvent.click(within(toolbar).getByRole('button', { name: 'Return to latest' }))
  await waitFor(() => expect(scrollTo).toHaveBeenCalled())
  expect(within(toolbar).getByRole('button', { name: 'Return to latest' }).disabled).toBe(true)
  assertRetained()
  container.querySelectorAll('[data-chat-replacement]').forEach(region => {
    expect(region.textContent).not.toContain('private')
    expect(region.textContent).not.toContain('Retained fixture message')
  })
  container.querySelectorAll('[data-chat-decoration]').forEach(region => {
    expect(region.textContent).not.toContain('private')
    expect(region.textContent).not.toContain('Retained fixture message')
  })
  fireEvent.click(screen.getByRole('button', { name: 'Restore default' }))
  await waitFor(() => expect(container.querySelector('[data-chat-decoration]')).toBeNull())
  assertRetained()
  expect(await store.active()).toBe('default')
  expect(await store.list()).toHaveLength(1)
  expect(unexpected).toEqual([])
  expect(calls.some(c => c.startsWith('POST '))).toBe(false)
  // Explicit business action is separate from installation/preview/selection assertions.
  fireEvent.click(screen.getByRole('button', { name: 'Enable plugin' }))
  await waitFor(() => expect(container.querySelector('[data-chat-replacement="chat.navigation"]')).not.toBeNull())
  fireEvent.click(within(container.querySelector('[data-chat-replacement="chat.navigation"]')).getByRole('button', { name: 'Start conversation' }))
  await waitFor(() => expect(calls.filter(c => c === 'POST /api/chat/session/new')).toHaveLength(1))
  await waitFor(() => expect(calls.filter(c => c === 'GET /api/chat/state/s2').length).toBeGreaterThan(0))
  expect(unexpected).toEqual([])
})
it('rejects cross-surface data, sensitive bindings, execution, targets and business actions', () => {
  const nodes = [
    { type: 'text', bind: 'messages' }, { type: 'text', bind: 'draft' },
    { type: 'text', bind: 'services' }, { type: 'text', bind: 'attachments' },
    { type: 'button', text: 'send', action: 'send' },
    { type: 'button', text: 'stop', action: 'stop' },
    { type: 'button', text: 'delete', action: 'deleteSession' },
    { type: 'button', text: 'nav', action: 'openCommands', target: 'https://evil.invalid' },
    { type: 'script', text: 'alert(1)' }, { type: 'text', text: 'x', onClick: 'send()' }
  ]
  nodes.forEach(node => { const b = structuredClone(example); b.views['chat.composer'].before = node; expect(() => validateBundle(b)).toThrow() })
})
it('guards chat actions without granting send, stop or destructive capabilities', () => {
  const actions = { openSettings: vi.fn(), manageSessions: vi.fn(), followLatest: vi.fn(), openCommands: vi.fn(), send: vi.fn() }
  dispatchChatAction('chat.sidebar', { action: 'openSettings' }, { blocked: true }, actions)
  dispatchChatAction('chat.sidebar', { action: 'manageSessions' }, { managing: true }, actions)
  dispatchChatAction('chat.messages', { action: 'followLatest' }, { canFollow: false }, actions)
  dispatchChatAction('chat.composer', { action: 'openCommands' }, { loading: true }, actions)
  dispatchChatAction('chat.composer', { action: 'send' }, {}, actions)
  Object.values(actions).forEach(fn => expect(fn).not.toHaveBeenCalled())
  dispatchChatAction('chat.messages', { action: 'followLatest' }, { canFollow: true }, actions)
  dispatchChatAction('chat.composer', { action: 'openCommands' }, {}, actions)
  expect(actions.followLatest).toHaveBeenCalledOnce()
  expect(actions.openCommands).toHaveBeenCalledOnce()
})
