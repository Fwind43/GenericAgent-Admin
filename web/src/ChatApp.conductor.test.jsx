// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import ChatApp, { ConductorEvents, ComposerActions } from './ChatApp.jsx'

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

  fireEvent.click(await screen.findByRole('button', { name: 'Subagents' }))
  const workspace = await screen.findByRole('complementary', { name: 'Subagents' })
  const badge = screen.getByLabelText('Conductor session')
  expect(badge.closest('.oa-session-row')).toBeTruthy()
  expect(badge.nextElementSibling.tagName).toBe('B')
  expect(workspace.classList.contains('oa-conductor-agents')).toBe(true)
  expect(document.querySelector('.oa-main').firstElementChild.classList.contains('oa-topbar')).toBe(true)
  expect(within(workspace).getByRole('heading', { name: 'Run checks' })).toBeTruthy()
  expect(within(workspace).getByRole('heading', { name: 'Review output' })).toBeTruthy()
  const eventsToggle = screen.getByRole('button', { name: 'Task events' })
  fireEvent.click(eventsToggle)
  expect(document.querySelectorAll('.oa-conductor-event')).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: 'Close task events' }))
  expect(document.querySelector('.oa-conductor-events')).toBeNull()
  fireEvent.click(eventsToggle)
  expect(workspace.querySelector('.oa-conductor-inline-event')).toBeNull()
  expect(screen.getByText('Task dispatched')).toBeTruthy()
  expect(screen.getByText('Worker started')).toBeTruthy()
  expect(screen.getByText('Worker finished · failed')).toBeTruthy()
  expect(screen.getByText('Verified worker error')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Subagents' }))
  const reopened = screen.getByRole('complementary', { name: 'Subagents' })
  expect(reopened.querySelectorAll('.oa-conductor-agent')).toHaveLength(2)
  expect(within(reopened).getByText('running')).toBeTruthy()
  expect(within(reopened).getByText('failed')).toBeTruthy()
  fireEvent.click(within(reopened).getByRole('button', { name: 'Subagent 1' }))
  await waitFor(() => expect(paths).toContain('GET /api/chat/session/worker-1'))
  expect(await screen.findByRole('button', { name: /Back to Conductor/ })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /Back to Conductor/ }))
  const restoredWorkspace = await screen.findByRole('complementary', { name: 'Subagents' })
  fireEvent.click(within(restoredWorkspace).getByRole('button', { name: 'Stop task' }))
  await waitFor(() => expect(paths).toContain('POST /api/chat/cancel/worker-1'))
})

test('inline completion appears on detail update without becoming a user message', () => {
  const worker = { session_id: 'dynamic-worker', title: 'Live job', created_at: 1788912000 }
  const detail = child => ({ conductor: { role: 'parent' }, conductor_children: [child] })
  const props = { messages: [], isCurrentRunning: true }
  const view = render(<ConductorEvents {...props} conductorDetail={detail(worker)} />)
  expect(screen.queryByText('Live result')).toBeNull()
  view.rerender(<ConductorEvents {...props} conductorDetail={detail({ ...worker, finished_at: 1788912002, status: 'completed', result: 'Live result' })} />)
  expect(screen.getByText('Live result')).toBeTruthy()
  expect(document.querySelectorAll('.oa-conductor-event')).toHaveLength(2)
})

 test('composer plus menu exposes upgrade only for eligible sessions and respects busy state', () => {
  localStorage.setItem('ga-admin-lang', 'en')
  const upgrade = vi.fn()
  const view = render(<ComposerActions onConductor={upgrade} conductorDisabled />)
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  const action = screen.getByRole('menuitem', { name: 'Upgrade to Conductor' })
  expect(action.disabled).toBe(true)
  fireEvent.click(action)
  expect(upgrade).not.toHaveBeenCalled()
  view.rerender(<ComposerActions onConductor={upgrade} />)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Upgrade to Conductor' }))
  expect(upgrade).toHaveBeenCalledTimes(1)
  view.rerender(<ComposerActions />)
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  expect(screen.queryByRole('menuitem', { name: 'Upgrade to Conductor' })).toBeNull()
 })

 test.each(['light', 'dark', 'warm'])('ordinary session upgrades in place (%s)', async theme => {
  document.documentElement.dataset.theme = theme
  localStorage.setItem('ga-admin-lang', 'en')
  localStorage.setItem('ga-chat-last-session', 'plain')
  const json = data => new Response(JSON.stringify({ ok: true, ...data, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} })
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  let upgraded = false
  const fetcher = vi.fn(async (input, init = {}) => {
    const url = new URL(String(input), 'http://localhost')
    const current = session('plain', 'Existing conversation', upgraded ? { conductor: { role: 'parent' } } : {})
    if (url.pathname === '/api/chat/conductor/plain/enable') {
      expect(init.method).toBe('POST')
      upgraded = true
      return json({ id: 'plain', conductor: { role: 'parent' } })
    }
    if (url.pathname === '/api/chat/sessions') return json({ sessions: [current] })
    if (url.pathname === '/api/chat/session/plain') return json(current)
    if (url.pathname === '/api/chat/ping') return json({ cwd: '/workspace', app_root: '/app', default_workspace: '/workspace' })
    if (url.pathname === '/api/chat/models') return json({ models: ['test-model'], default: 'test-model', provider_groups: [] })
    if (url.pathname === '/api/chat/settings') return json({ settings: {}, resolved: {} })
    if (url.pathname === '/api/chat/projects') return json({ projects: [], default_workspace: '/workspace' })
    if (url.pathname === '/api/chat/system_prompts') return json({ presets: [] })
    if (url.pathname === '/api/chat/conductor/plain/children') return json({ children: [] })
    return json({})
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ChatApp />)
  await screen.findAllByText('Existing conversation')
  fireEvent.click(document.querySelector('.oa-session-title'))
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  const action = screen.getByRole('menuitem', { name: 'Upgrade to Conductor' })
  await waitFor(() => expect(action.disabled).toBe(false))
  fireEvent.click(action)
  await waitFor(() => expect(upgraded).toBe(true))
  fireEvent.click((await screen.findAllByRole('button', { name: 'Subagents' }))[0])
  await screen.findByRole('complementary', { name: 'Subagents' })
  expect(localStorage.getItem('ga-chat-last-session')).toBe('plain')
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/chat/new'))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  expect(screen.queryByRole('menuitem', { name: 'Upgrade to Conductor' })).toBeNull()
  delete document.documentElement.dataset.theme
 })
