import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ChatApp from '../ChatApp'
import { UiHost, useUiPackage } from './UiHost'

// Exercise the real host without restoring the retired permanent chat selector.
function PackageProbe() {
  const ui = useUiPackage()
  return <div data-testid="package-probe"><button onClick={() => ui.select('studio')}>Test Studio</button><button onClick={() => ui.restore()}>Test default</button><output>{ui.id}</output></div>
}

// Real controller and UI; transport only is an in-process fixture.
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('body layouts retain roots, draft, scroll and queue subscription across switch and restore', async () => {
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
  let sent = null, created = false
  const secondSession = { id: 's2', title: 'New fixture conversation', count: 0 }
  const calls = [], unexpected = []
  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const u = new URL(String(input), location.origin)
    const key = `${init.method || 'GET'} ${u.pathname}`
    calls.push(key)
    let data
    switch (key) {
      case 'GET /api/version/info': data = { version: 'v0.3.12' }; break
      case 'GET /api/config': data = { slash_commands: [] }; break
      case 'GET /api/slash-commands': data = { commands: [] }; break
      case 'PUT /api/ui/theme': data = JSON.parse(init.body); break
      case 'GET /api/instances': data = { default_id: 'local', instances: [{ id: 'local', name: 'Local', mode: 'local' }] }; break
      case 'GET /api/extra-system-prompt-presets': data = { presets: [] }; break
      case 'GET /api/chat/sessions': data = { sessions: created ? [secondSession, session] : [session], projects: [] }; break
      case 'GET /api/chat/session/s1': data = { ...session, messages: [{ id: 'm1', role: 'user', content: 'Retained fixture message' }], raw_history: [], settings: {}, queued_messages: [] }; break
      case 'POST /api/chat/s1':
        sent = JSON.parse(init.body)
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
  const settings = vi.fn()
  const { container } = render(<UiHost><PackageProbe/><ChatApp onOpenSettings={settings}/></UiHost>)
  const message = await screen.findByText('Retained fixture message', { selector: '.oa-msg-text' })
  const composer = await screen.findByPlaceholderText(/Message GenericAgent/)
  fireEvent.change(composer, { target: { value: 'unsent draft survives' } })
  await waitFor(() => expect(sources.filter(s => !s.closed)).toHaveLength(1))
  const source = sources.find(s => !s.closed)
  const sourceCount = sources.length
  const detailReads = calls.filter(c => c === 'GET /api/chat/session/s1').length
  const roots = ['chat.sidebar', 'chat.messages', 'chat.composer'].map(name => container.querySelector(`[data-ui-surface="${name}"]`))
  expect(roots.every(Boolean)).toBe(true)
  const thread = roots[1]
  thread.scrollTop = 147
  const main = container.querySelector('.oa-main')
  const bar = screen.getByTestId('package-probe')
  fireEvent.click(within(bar).getByRole('button', { name: 'Test Studio' }))
  await waitFor(() => expect(main.dataset.uiChat).toBe('studio'))
  expect(main.dataset.uiChat).toBe('studio')
  roots.forEach(node => {
    expect(node.dataset.uiLayout).toBe('studio')
    expect(container.querySelector(`[data-ui-surface="${node.dataset.uiSurface}"]`)).toBe(node)
  })
  expect(thread.scrollTop).toBe(147)
  expect(container.querySelector('.oa-main')).toBe(main)
  expect(screen.getByText('Retained fixture message', { selector: '.oa-msg-text' })).toBe(message)
  expect(screen.getByPlaceholderText(/Message GenericAgent/)).toBe(composer)
  expect(composer.value).toBe('unsent draft survives')
  expect(source.closed).toBe(false)
  expect(sources).toHaveLength(sourceCount)
  fireEvent.click(within(roots[0]).getByRole('button', { name: 'Settings', exact: true }))
  expect(settings).toHaveBeenCalledTimes(1)
  fireEvent.click(within(bar).getByRole('button', { name: 'Test default' }))
  await waitFor(() => expect(main.dataset.uiChat).toBe('default'))
  expect(main.dataset.uiChat).toBe('default')
  expect(screen.getByText('Retained fixture message', { selector: '.oa-msg-text' })).toBe(message)
  expect(screen.getByPlaceholderText(/Message GenericAgent/)).toBe(composer)
  expect(composer.value).toBe('unsent draft survives')
  expect(source.closed).toBe(false)
  expect(sources).toHaveLength(sourceCount)
  expect(calls.filter(c => c === 'GET /api/chat/session/s1')).toHaveLength(detailReads)
  roots.forEach(node => expect(node.dataset.uiLayout).toBe('default'))
  expect(thread.scrollTop).toBe(147)
  fireEvent.click(within(bar).getByRole('button', { name: 'Test Studio' }))
  await waitFor(() => expect(main.dataset.uiChat).toBe('studio'))
  fireEvent.click(container.querySelector('.oa-send'))
  await waitFor(() => expect(sent).not.toBeNull())
  expect(sent.prompt).toBe('unsent draft survives')
  await waitFor(() => expect(composer.value).toBe(''))
  await waitFor(() => expect(container.querySelector('.oa-stop')).toBeNull())
  fireEvent.click(container.querySelector('.oa-new-chat'))
  await waitFor(() => expect(created).toBe(true))
  await waitFor(() => expect(calls).toContain('GET /api/chat/state/s2'))
  expect(screen.getByPlaceholderText(/Message GenericAgent/)).toBe(composer)
  expect(composer.value).toBe('')
  expect(calls.filter(c => c === 'POST /api/chat/s1')).toHaveLength(1)
  expect(calls.filter(c => c === 'POST /api/chat/session/new')).toHaveLength(1)
  expect(unexpected).toEqual([])
}, 20000)
