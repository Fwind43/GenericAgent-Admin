import React from 'react'
import gsap from 'gsap'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ChatApp from '../ChatApp'
import { UiHost } from './UiHost'

// Hoisted observation only: every business method comes from the actual module.
const observation = vi.hoisted(() => ({ instances: [], scope: null }))
vi.mock('../lib/chatStream.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, createStreamDeltaBatcher: options => {
    const instance = { pending: new Set(), executed: new Set(), cancelled: new Set(), scheduled: [] }
    observation.instances.push(instance)
    return actual.createStreamDeltaBatcher({ ...options,
      schedule: callback => {
        const previous = observation.scope
        observation.scope = instance
        try {
          const id = options.schedule(time => {
            instance.pending.delete(id); instance.executed.add(id)
            callback(time)
          })
          instance.pending.add(id); instance.scheduled.push(id)
          return id
        } finally { observation.scope = previous }
      },
      cancel: id => {
        instance.pending.delete(id); instance.cancelled.add(id)
        return options.cancel(id)
      },
    })
  } }
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  observation.instances = []; observation.scope = null
})
it.each(['done', 'cancel', 'switch', 'late-state'])('mounted stream %s retains content and isolates sessions', async mode => {
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
  const frames = new Set(), listeners = new Set(), heldFrames = new Map()
  let captureTail = false, heldId = -1, target
  const phase = value => console.info(`[stream-lifecycle:${mode}] ${value}`)
  phase('mount')
  const tailSchedules = []
  const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    // The real ChatApp schedule calls RAF synchronously inside this scope.
    if (captureTail && observation.scope === target) {
      const id = heldId--
      tailSchedules.push({ id, instance: observation.scope }); heldFrames.set(id, callback); frames.add(id)
      return id
    }
    const id = request(time => { frames.delete(id); callback(time) }); frames.add(id)
    return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); heldFrames.delete(id); cancel(id) })
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
  let cancelReleased = false, reloadReleased = false, reloadResponses = 0
  let releaseCancel
  const cancelGate = new Promise(resolve => { releaseCancel = resolve })
  let releaseReload
  const reloadGate = new Promise(resolve => { releaseReload = resolve })
  const calls = [], unexpected = []
  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const u = new URL(String(input), location.origin)
    const key = `${init.method || 'GET'} ${u.pathname}`
    calls.push(key)
    let data
    switch (key) {
      case 'GET /api/version/info': data = { version: '0.3.12' }; break
      case 'GET /api/config': data = { slash_commands: [] }; break
      case 'GET /api/slash-commands': data = { commands: [] }; break
      case 'PUT /api/ui/theme': data = JSON.parse(init.body); break
      case 'GET /api/instances': data = { default_id: 'local', instances: [{ id: 'local', name: 'Local', mode: 'local' }] }; break
      case 'GET /api/extra-system-prompt-presets': data = { presets: [] }; break
      case 'GET /api/chat/sessions': data = { sessions: created ? [secondSession, session] : [session], projects: [] }; break
      case 'GET /api/chat/session/s1': if (sent && (mode === 'done' || mode === 'cancel')) { await reloadGate; reloadResponses++ } data = { ...session, messages: [{ id: 'm1', role: 'user', content: 'Retained fixture message' }, ...(persisted ? [{ id: 'answer', role: 'assistant', content: persisted }] : [])], raw_history: [], settings: {}, queued_messages: [] }; break
      case 'POST /api/chat/s1':
        sent = JSON.parse(init.body)
        signal = init.signal
        // In switch mode the transport deliberately ignores abort: the pending read
        // must settle with stale bytes before the controller can release its lock.
        if (mode !== 'switch') signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      case 'POST /api/chat/cancel/s1': await cancelGate; data = {}; break
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
  const beforeSend = new Set(observation.instances)
  fireEvent.click(container.querySelector('.oa-send'))
  await waitFor(() => expect(sent?.prompt).toBe('synthetic prompt'))
  const beforeFirst = new Map(observation.instances.map(instance => [instance, instance.scheduled.length]))
  await act(async () => { emit({ type: 'sync' }); emit({ type: 'delta', delta: 'First' }) })
  await waitFor(() => expect(container.textContent).toContain('First'))
  const candidates = observation.instances.filter(instance => !beforeSend.has(instance) && instance.scheduled.length > (beforeFirst.get(instance) || 0))
  expect(candidates).toHaveLength(1) // only the real send reader receives First
  target = candidates[0]
  expect(target.executed.size).toBeGreaterThan(0)
  expect(target.pending.size).toBe(0)
  phase('first-rendered-owner-established')
  const activeListeners = listeners.size
  expect(activeListeners).toBeGreaterThan(0)
  expect(stream.locked).toBe(true)
  expect(tailSchedules).toEqual([])
  expect(heldFrames.size).toBe(0)
  captureTail = mode !== 'late-state'
  persisted = 'First second'
  await act(async () => { emit({ type: 'delta', delta: ' second' }) })
  if (captureTail) await waitFor(() => expect(tailSchedules).toHaveLength(1))
  const tailFrame = tailSchedules[0]?.id
  const { executed, cancelled } = target
  if (captureTail) {
    expect(tailSchedules).toHaveLength(1)
    expect(tailSchedules[0].instance).toBe(target)
    expect(target.pending.has(tailFrame)).toBe(true)
    expect(stream.locked).toBe(true)
    expect(heldFrames.size).toBe(1) // delta consumed and scheduled, not merely enqueued
    expect(container.textContent).not.toContain(persisted)
  } else await waitFor(() => expect(container.textContent).toContain(persisted))
  phase('tail-consumed')
  captureTail = false
  if (mode === 'done') {
    await act(async () => { emit({ type: 'done' }); controller.close() })
    // EOF does not bypass visible-tab pacing. Until the held frame runs,
    // reader and visibility subscription must remain alive for drain().
    expect(stream.locked).toBe(true)
    expect(listeners.size).toBe(activeListeners)
    expect(container.textContent).not.toContain(persisted)
    expect(container.querySelector('.oa-stop')).not.toBeNull()
    await act(async () => {
      const callback = heldFrames.get(tailFrame)
      heldFrames.delete(tailFrame); frames.delete(tailFrame)
      callback(performance.now())
    })
    await waitFor(() => expect(stream.locked).toBe(false))
    expect(cancelReleased).toBe(false)
    expect(reloadReleased).toBe(false)
    expect(reloadResponses).toBe(0)
    expect(container.textContent).toContain(persisted) // reload still blocked: only stream flush can supply tail
    expect(heldFrames.has(tailFrame)).toBe(false)
    expect(executed.has(tailFrame)).toBe(mode === 'done')
    expect(cancelled.has(tailFrame)).toBe(mode === 'cancel')
    expect(listeners.size).toBe(activeListeners - 1)
    await act(async () => { reloadReleased = true; releaseReload() })
    await waitFor(() => expect(reloadResponses).toBeGreaterThan(0))
    await waitFor(() => expect(container.querySelector('.oa-stop')).toBeNull())
    await waitFor(() => expect(container.textContent).not.toContain('Loading conversation'))
    expect(container.textContent).toContain(persisted)
  } else if (mode === 'cancel') {
    phase('cancel-click')
    fireEvent.click(container.querySelector('.oa-stop'))
    await waitFor(() => expect(calls).toContain('POST /api/chat/cancel/s1'))
    await waitFor(() => expect(signal.aborted).toBe(true))
    await waitFor(() => expect(stream.locked).toBe(false))
    expect(cancelReleased).toBe(false)
    expect(reloadReleased).toBe(false)
    expect(reloadResponses).toBe(0)
    expect(container.textContent).toContain(persisted) // reload still blocked: only stream flush can supply tail
    expect(heldFrames.has(tailFrame)).toBe(false)
    expect(executed.has(tailFrame)).toBe(mode === 'done')
    expect(cancelled.has(tailFrame)).toBe(mode === 'cancel')
    expect(listeners.size).toBe(activeListeners - 1)
    await act(async () => { cancelReleased = true; releaseCancel(); reloadReleased = true; releaseReload() })
    await waitFor(() => expect(reloadResponses).toBeGreaterThan(0))
    await waitFor(() => expect(container.querySelector('.oa-stop')).toBeNull())
    await waitFor(() => expect(container.textContent).not.toContain('Loading conversation'))
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
    if (mode === 'switch') {
      expect(stream.locked).toBe(true)
      expect(listeners.size).toBe(activeListeners)
      expect(heldFrames.size).toBe(1)
      // These bytes arrive only AFTER switching/abort; unlike the buffered tail,
      // they must never become part of the new conversation.
      await act(async () => {
        emit({ type: 'delta', delta: 'LATE OLD CHUNK' })
        emit({ type: 'done' })
        controller.close()
      })
      expect(executed.has(tailFrame)).toBe(false)
      expect(cancelled.has(tailFrame)).toBe(true)
      expect(container.textContent).not.toContain('LATE OLD CHUNK')
      expect(container.textContent).not.toContain('First')
      expect(container.querySelector('.oa-stop')).toBeNull()
    }
    if (mode === 'late-state') {
      await act(async () => { resolveState(new Response(JSON.stringify({ running: true, pending_id: 'stale-pending', pending_content: 'STALE RESPONSE', settings: {}, models: [], queued_messages: [] }), { headers: { 'Content-Type': 'application/json' } })) })
      expect(container.textContent).not.toContain('STALE RESPONSE')
      expect(container.textContent).not.toContain(persisted)
      expect(container.querySelector('.oa-stop')).toBeNull()
    }
  }
  await waitFor(() => expect(stream.locked).toBe(false))
  expect(heldFrames.size).toBe(0)
  expect(listeners.size).toBe(activeListeners - 1) // stream subscription removed before unmount
  expect(sources.some(source => !source.closed)).toBe(true) // app subscription still owned by mount
  phase('stream-cleaned')
  cleanup()
  expect(sources.every(source => source.closed)).toBe(true)
  expect(gsap.globalTimeline.getChildren()).toHaveLength(0)
  // GSAP's shared ticker auto-sleeps periodically after scoped animations revert.
  await waitFor(() => expect(frames.size).toBe(0), { timeout: 4000 })
  expect(listeners.size).toBe(0)
  expect(unexpected).toEqual([])
  phase('unmount-cleaned')
}, 20000)
