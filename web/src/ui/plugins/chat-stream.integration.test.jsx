import React from 'react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ChatApp from '../../ChatApp'
import { UiHost } from '../UiHost'

// Real controller and UI; transport only is an in-process fixture.
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it.each(['done', 'cancel', 'switch', 'late-state'])('mounted stream %s retains content and isolates sessions', async mode => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  let controller, signal
  const stream = new ReadableStream({ start(c) { controller = c } })
  let persisted = ''
  const emit = event => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'))
  history.replaceState(null, '', '/chat')
  localStorage.clear()
  localStorage.setItem('ga-admin-lang', 'en')
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  Element.prototype.scrollIntoView = () => {}
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const frames = new Set(), listeners = new Set()
  const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    const id = request(time => { frames.delete(id); callback(time) }); frames.add(id); return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); cancel(id) })
  const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document)
  vi.spyOn(document, 'addEventListener').mockImplementation((type, callback, options) => {
    if (type === 'visibilitychange') listeners.add(callback)
    return add(type, callback, options)
  })
  vi.spyOn(document, 'removeEventListener').mockImplementation((type, callback, options) => {
    if (type === 'visibilitychange') listeners.delete(callback)
    return remove(type, callback, options)
  })
  const sources = []
  vi.stubGlobal('EventSource', class {
    constructor(url) { this.url = url; this.closed = false; sources.push(this) }
    addEventListener() {}
    removeEventListener() {}
    close() { this.closed = true }
  })
  const session = { id: 's1', title: 'Fixture conversation', count: 1, updated_at: '2026-09-20T00:00:00Z' }
  let sent = null, created = false, delayState = false, resolveState
  const staleState = new Promise(resolve => { resolveState = resolve })
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
      case 'GET /api/chat/session/s1': data = { ...session, messages: [{ id: 'm1', role: 'user', content: 'Retained fixture message' }, ...(persisted ? [{ id: 'answer', role: 'assistant', content: persisted }] : [])], raw_history: [], settings: {}, queued_messages: [] }; break
      case 'POST /api/chat/s1':
        sent = JSON.parse(init.body)
        signal = init.signal
        signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      case 'POST /api/chat/cancel/s1': data = {}; break
      case 'POST /api/chat/session/new': created = true; data = secondSession; break
      case 'GET /api/chat/session/s2': data = { ...secondSession, messages: [], settings: {}, queued_messages: [] }; break
      case 'GET /api/chat/state/s2':
      case 'GET /api/chat/queue/s2': data = { running: false, models: [], settings: {}, queued_messages: [] }; break
      case 'GET /api/chat/state/s1': if (delayState) return staleState; data = { running: false, models: [], settings: {}, queued_messages: [] }; break
      case 'GET /api/chat/queue/s1': data = { queued_messages: [] }; break
      default: unexpected.push(key); throw new Error('Unexpected fixture request: ' + key)
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const settings = vi.fn()
  const { container } = render(<UiHost><ChatApp onOpenSettings={settings}/></UiHost>)
  await screen.findByText('Retained fixture message', { selector: '.oa-msg-text' })
  const composer = await screen.findByPlaceholderText(/Message GenericAgent/)
  fireEvent.change(composer, { target: { value: 'synthetic prompt' } })
  fireEvent.click(container.querySelector('.oa-send'))
  await waitFor(() => expect(sent?.prompt).toBe('synthetic prompt'))
  await act(async () => { emit({ type: 'sync' }); emit({ type: 'delta', delta: 'First' }) })
  await waitFor(() => expect(container.textContent).toContain('First'))
  persisted = 'First second'
  await act(async () => { emit({ type: 'delta', delta: ' second' }) })
  await waitFor(() => expect(container.textContent).toContain(persisted))
  if (mode === 'done') {
    await act(async () => { emit({ type: 'done', message: { id: 'answer', role: 'assistant', content: persisted } }); controller.close() })
    await waitFor(() => expect(container.querySelector('.oa-stop')).toBeNull())
    expect(container.textContent).toContain(persisted)
  } else if (mode === 'cancel') {
    fireEvent.click(container.querySelector('.oa-stop'))
    await waitFor(() => expect(calls).toContain('POST /api/chat/cancel/s1'))
    await waitFor(() => expect(signal.aborted).toBe(true))
    await waitFor(() => expect(container.querySelector('.oa-stop')).toBeNull())
    expect(container.textContent).toContain(persisted)
  } else {
    if (mode === 'late-state') {
      delayState = true
      const previous = calls.filter(key => key === 'GET /api/chat/state/s1').length
      await act(async () => { emit({ type: 'done' }); controller.close() })
      await waitFor(() => expect(calls.filter(key => key === 'GET /api/chat/state/s1').length).toBeGreaterThan(previous))
    }
    fireEvent.click(container.querySelector('.oa-new-chat'))
    await waitFor(() => expect(calls).toContain('GET /api/chat/state/s2'))
    await waitFor(() => expect(container.textContent).not.toContain(persisted))
    expect(signal.aborted).toBe(true)
    if (mode === 'late-state') {
      await act(async () => { resolveState(new Response(JSON.stringify({ running: true, pending_id: 'stale-pending', pending_content: 'STALE RESPONSE', settings: {}, models: [], queued_messages: [] }), { headers: { 'Content-Type': 'application/json' } })) })
      expect(container.textContent).not.toContain('STALE RESPONSE')
      expect(container.textContent).not.toContain(persisted)
      expect(container.querySelector('.oa-stop')).toBeNull()
    }
  }
  await waitFor(() => expect(stream.locked).toBe(false))
  cleanup()
  expect(sources.every(source => source.closed)).toBe(true)
  expect(frames.size).toBe(0)
  expect(listeners.size).toBe(0)
  expect(unexpected).toEqual([])
}, 20000)
