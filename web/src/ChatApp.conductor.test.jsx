// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import ChatApp, { MessageList } from './ChatApp.jsx'

const session = (id, title, extra = {}) => ({
  id,
  title,
  running: false,
  taskbar_state: 'idle',
  created_at: '2026-09-08T01:00:00Z',
  updated_at: '2026-09-08T01:00:00Z',
  ...extra,
})

const originalScrollTo = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo')

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalScrollTo) Object.defineProperty(Element.prototype, 'scrollTo', originalScrollTo)
  else delete Element.prototype.scrollTo
})

test('real ChatApp renders a Conductor workspace and navigates and stops workers', async () => {
  localStorage.setItem('ga-admin-lang', 'en')
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('EventSource', class {
    addEventListener() {}
    removeEventListener() {}
    close() {}
  })
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0,
  })

  const parent = session('conductor-1', 'Release Conductor', {
    running: true,
    conductor: { role: 'parent', status: 'running' },
    conductor_children: [
      { session_id: 'worker-1', title: 'Run checks', status: 'running' },
      { session_id: 'worker-2', title: 'Review output', status: 'failed', created_at: 1788912000, started_at: 1788912001, finished_at: 1788912010, error: 'Verified worker error' },
    ],
  })
  const workerOne = session('worker-1', 'Run checks', {
    running: true,
    conductor: { role: 'worker', parent_session_id: 'conductor-1', status: 'running' },
  })
  const workerTwo = session('worker-2', 'Review output', {
    conductor: { role: 'worker', parent_session_id: 'conductor-1', status: 'failed' },
  })
  const sessions = [parent, workerOne, workerTwo]
  const paths = []

  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin)
    paths.push(`${String(init.method || 'GET').toUpperCase()} ${url.pathname}`)
    let data = {}
    if (url.pathname === '/api/instances') data = { instances: [] }
    else if (url.pathname === '/api/chat/sessions') data = { sessions, projects: [], pinned_projects: [] }
    else if (url.pathname.startsWith('/api/chat/session/')) {
      const id = url.pathname.split('/').pop()
      data = { ...sessions.find(item => item.id === id), messages: [], queue: [] }
    } else if (url.pathname.startsWith('/api/chat/state')) data = { llms: [], settings: {} }
    else if (url.pathname === '/api/extra-system-prompt-presets') data = { presets: [] }
    return new Response(JSON.stringify({ ok: true, ...data, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }))

  render(<ChatApp />)

  const workspace = await screen.findByRole('region', { name: 'Conductor workers' })
  expect(workspace.parentElement.classList.contains('oa-thread')).toBe(true)
  expect(document.querySelector('.oa-main').firstElementChild.classList.contains('oa-topbar')).toBe(true)
  expect(within(workspace).getByRole('heading', { name: 'Task workspace' })).toBeTruthy()
  expect(document.querySelectorAll('.oa-conductor-inline-event')).toHaveLength(3)
  expect(workspace.querySelector('.oa-conductor-inline-event')).toBeNull()
  expect(screen.getByText('Task dispatched')).toBeTruthy()
  expect(screen.getByText('Worker started')).toBeTruthy()
  expect(screen.getByText('Worker finished · failed')).toBeTruthy()
  expect(screen.getByText('Verified worker error')).toBeTruthy()
  expect(within(workspace).getByText('2 total')).toBeTruthy()
  expect(within(workspace).getByText('1 running')).toBeTruthy()
  expect(within(workspace).getByText('1 failed')).toBeTruthy()
  expect(document.querySelectorAll('.oa-session-row.is-conductor-worker')).toHaveLength(2)

  fireEvent.click(within(workspace).getByRole('button', { name: 'Run checksrunning' }))
  await waitFor(() => expect(paths).toContain('GET /api/chat/session/worker-1'))
  expect(await screen.findByRole('button', { name: /Back to Conductor/ })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /Back to Conductor/ }))
  const restoredWorkspace = await screen.findByRole('region', { name: 'Conductor workers' })
  fireEvent.click(within(restoredWorkspace).getByRole('button', { name: 'Stop' }))
  await waitFor(() => expect(paths).toContain('POST /api/chat/cancel/worker-1'))
})

test('inline completion appears on detail update without becoming a user message', () => {
  const worker = { session_id: 'dynamic-worker', title: 'Live job', created_at: 1788912000 }
  const detail = child => ({ conductor: { role: 'parent' }, conductor_children: [child] })
  const props = { messages: [], isCurrentRunning: true }
  const view = render(<MessageList {...props} conductorDetail={detail(worker)} />)
  expect(screen.queryByText('Live result')).toBeNull()
  view.rerender(<MessageList {...props} conductorDetail={detail({ ...worker, finished_at: 1788912002, status: 'completed', result: 'Live result' })} />)
  expect(screen.getByText('Live result')).toBeTruthy()
  expect(document.querySelectorAll('.oa-conductor-inline-event')).toHaveLength(2)
})
