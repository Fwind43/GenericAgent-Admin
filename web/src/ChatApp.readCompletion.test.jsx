// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import ChatApp from './ChatApp.jsx'

const originalScrollTo = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo')
const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalScrollTo) Object.defineProperty(Element.prototype, 'scrollTo', originalScrollTo)
  else delete Element.prototype.scrollTo
  if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest)
  else delete document.elementFromPoint
})

test('resumed stream completion refreshes the final snapshot and automatically reads the visible result', async () => {
  localStorage.setItem('ga-admin-lang', 'en')
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} })
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(900)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 400, left: 0, right: 600, width: 600, height: 400 })
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{ width: 600, height: 400 }])
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.querySelector('.oa-message[data-id="answer"]') })
  let completed = false
  let controller
  let snapshots = 0
  const receipts = []
  const result = { id: 'answer', revision: 'final-v1', visible_revision: 'visible-v1' }
  const summary = () => ({ id: 'read-session', title: 'Read completion', running: !completed, unread: completed, result: completed ? result : null, count: completed ? 2 : 1, updated_at: '2026-09-08T01:00:00Z' })
  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin)
    let payload = {}
    if (url.pathname === '/api/instances') payload = { instances: [] }
    else if (url.pathname === '/api/chat/sessions') payload = { sessions: [summary()], projects: [], pinned_projects: [] }
    else if (url.pathname === '/api/chat/session/read-session') {
      snapshots++
      payload = { ...summary(), messages: completed
        ? [{ id: 'answer', role: 'assistant', content: 'Final saved answer', content_revision: result.revision }]
        : [{ id: 'question', role: 'user', content: 'Waiting for the result' }], queued_messages: [] }
    } else if (url.pathname === '/api/chat/state/read-session') payload = { running: !completed, pending_assistant_id: 'answer', llms: [], settings: {} }
    else if (url.pathname === '/api/chat/stream/read-session') {
      return new Response(new ReadableStream({ start(value) { controller = value } }), { headers: { 'Content-Type': 'application/x-ndjson' } })
    } else if (url.pathname === '/api/chat/read') {
      const batch = JSON.parse(init.body).receipts
      receipts.push(...batch)
      payload = { receipts: batch }
    }
    return new Response(JSON.stringify({ ok: true, ...payload, data: payload }), { headers: { 'Content-Type': 'application/json' } })
  }))
  render(<ChatApp />)
  await waitFor(() => expect(controller).toBeTruthy())
  expect(receipts).toEqual([])
  const initialSnapshots = snapshots
  await act(async () => {
    completed = true
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'done', message: { id: 'answer', role: 'assistant', content: 'Final saved answer' } }) + '\n'))
    controller.close()
  })
  expect(await screen.findByText('Final saved answer')).toBeTruthy()
  await waitFor(() => expect(snapshots).toBeGreaterThan(initialSnapshots))
  await waitFor(() => expect(receipts).toEqual([{ sid: 'read-session', result }]), { timeout: 2500 })
}, 10000)
