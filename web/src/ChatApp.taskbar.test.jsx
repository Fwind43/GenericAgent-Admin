import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import ChatApp from './ChatApp.jsx'

const session = (id, title, extra = {}) => ({
  id, title, running: false, taskbar_state: 'idle',
  created_at: '2026-09-06T01:00:00Z', updated_at: '2026-09-06T01:00:00Z',
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

test('real ChatApp keeps background attention across selection and clears only the read result', async () => {
  localStorage.clear()
  localStorage.setItem('ga-admin-lang', 'en')
  sessionStorage.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  const bridge = vi.fn()
  vi.stubGlobal('__gaTaskbarState', bridge)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('EventSource', class {
    addEventListener() {}
    removeEventListener() {}
    close() {}
  })
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 })

  let sessions = [
    session('alpha', 'Taskbar Alpha'),
    session('beta', 'Taskbar Beta'),
    session('background', 'Taskbar Background', { taskbar_state: 'waiting' }),
  ]
  const paths = []
  let releaseHistory
  const backgroundHistory = new Promise(resolve => { releaseHistory = resolve })
  vi.stubGlobal('fetch', vi.fn(async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin)
    paths.push(url.pathname)
    let data = {}
    if (url.pathname === '/api/instances') data = { instances: [] }
    else if (url.pathname === '/api/chat/read') {
      data = JSON.parse(options.body)
      sessions = sessions.map(item => data.receipts.some(receipt => receipt.sid === item.id) ? { ...item, unread: false } : item)
    }
    else if (url.pathname === '/api/chat/sessions') data = { sessions, projects: [], pinned_projects: [] }
    else if (url.pathname === '/api/chat/session/background') return backgroundHistory
    else if (url.pathname.startsWith('/api/chat/session/')) {
      const id = url.pathname.split('/').pop()
      data = { ...sessions.find(item => item.id === id), messages: [], queue: [] }
    } else if (url.pathname.startsWith('/api/chat/state')) data = { llms: [], settings: {} }
    else if (url.pathname === '/api/extra-system-prompt-presets') data = { presets: [] }
    return new Response(JSON.stringify({ ok: true, ...data, data }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }))

  render(<ChatApp />)
  const waitingButton = (await screen.findByText('Taskbar Background')).closest('button')
  await waitFor(() => expect(waitingButton.querySelector('.oa-session-waiting-label')?.textContent).toBe('Waiting'))
  expect(screen.queryByRole('button', { name: /^Waiting for reply/ })).toBeNull()
  expect(document.querySelector('.oa-topbar').classList.contains('has-waiting')).toBe(false)
  await waitFor(() => expect(bridge).toHaveBeenLastCalledWith('idle'))
  fireEvent.click(await screen.findByText('Taskbar Beta'))
  await waitFor(() => expect(paths).toContain('/api/chat/session/beta'))
  await waitFor(() => expect(bridge).toHaveBeenLastCalledWith('idle'))
  expect(paths).not.toContain('/api/chat/session/background')

  const bulkResult = { id: 'background-answer', revision: 'bulk-revision' }
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mark all as read' }).disabled).toBe(true))
  sessions = sessions.map(item => item.id === 'background'
    ? { ...item, taskbar_state: 'completed', unread: true, result: bulkResult }
    : item)
  act(() => { window.dispatchEvent(new Event('online')) })
  await waitFor(() => expect(bridge).toHaveBeenLastCalledWith('unread'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Search sessions' }), { target: { value: 'Alpha' } })
  fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mark all as read' }).disabled).toBe(true))
  await waitFor(() => expect(bridge).toHaveBeenLastCalledWith('idle'))
  expect(paths).not.toContain('/api/chat/session/background')
  fireEvent.change(screen.getByRole('textbox', { name: 'Search sessions' }), { target: { value: '' } })
  expect(screen.getByText('Taskbar Background').closest('button').querySelector('.oa-session-unread-label')).toBeNull()

  const result = { id: 'background-answer', revision: 'revision-2' }
  sessions = sessions.map(item => item.id === 'background'
    ? { ...item, taskbar_state: 'completed', unread: true, result }
    : item)
  act(() => { window.dispatchEvent(new Event('online')) })
  await waitFor(() => expect(bridge).toHaveBeenLastCalledWith('unread'))
  fireEvent.click(screen.getByText('Taskbar Alpha'))
  await waitFor(() => expect(paths).toContain('/api/chat/session/alpha'))
  expect(bridge).toHaveBeenLastCalledWith('unread')

  const backgroundButton = screen.getByText('Taskbar Background').closest('button')
  expect(backgroundButton.querySelector('.oa-session-unread-label')).toBeTruthy()
  fireEvent.click(backgroundButton)
  // Clear only after the server confirms, independent of pending history.
  await waitFor(() => expect(backgroundButton.querySelector('.oa-session-unread-label')).toBeNull())
  expect(paths).toContain('/api/chat/read')
  await waitFor(() => expect(bridge).toHaveBeenLastCalledWith('idle'))
  await act(async () => {
    const data = { ...sessions.find(item => item.id === 'background'), messages: [], queue: [] }
    releaseHistory(new Response(JSON.stringify({ ok: true, ...data, data }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
  })
  expect(paths).toContain('/api/chat/session/background')
  expect(backgroundButton.querySelector('.oa-session-unread-label')).toBeNull()
  await waitFor(() => expect(bridge).toHaveBeenLastCalledWith('idle'))

  sessions = sessions.map(item => item.id === 'background'
    ? { ...item, taskbar_state: 'waiting', running: false }
    : item)
  act(() => { window.dispatchEvent(new Event('online')) })
  await waitFor(() => expect(backgroundButton.querySelector('.oa-session-waiting-label')?.textContent).toBe('Waiting'))
  await waitFor(() => expect(bridge).toHaveBeenLastCalledWith('idle'))
  expect(backgroundButton.querySelector('.oa-session-running-label')).toBeNull()
  const alphaButton = screen.getByText('Taskbar Alpha').closest('.oa-session')
  fireEvent.click(alphaButton)
  await waitFor(() => expect(alphaButton.closest('.oa-session-row').classList.contains('active')).toBe(true))
  fireEvent.change(screen.getByRole('textbox', { name: 'Search sessions' }), { target: { value: 'Alpha' } })
  expect(document.querySelector('.oa-sidebar').textContent).not.toContain('Taskbar Background')
  expect(screen.queryByRole('button', { name: /^Waiting for reply/ })).toBeNull()
  fireEvent.change(screen.getByRole('textbox', { name: 'Search sessions' }), { target: { value: '' } })
  const restoredBackgroundButton = (await screen.findByText('Taskbar Background')).closest('button')
  fireEvent.click(restoredBackgroundButton)
  await waitFor(() => expect(document.querySelector('.oa-title b')?.textContent).toBe('Taskbar Background'))
  await waitFor(() => expect(bridge).toHaveBeenLastCalledWith('idle'))
  expect(restoredBackgroundButton.querySelector('.oa-session-waiting-label')?.textContent).toBe('Waiting')
  expect(screen.queryByRole('button', { name: /^Waiting for reply/ })).toBeNull()

  sessions = sessions.map(item => item.id === 'background'
    ? { ...item, taskbar_state: 'running', running: true }
    : item)
  act(() => { window.dispatchEvent(new Event('online')) })
  await waitFor(() => expect(restoredBackgroundButton.querySelector('.oa-session-running-label')?.getAttribute('aria-label')).toBe('Running'))
  expect(restoredBackgroundButton.querySelector('.oa-session-running-label')?.getAttribute('title')).toBe('Running')
  expect(restoredBackgroundButton.querySelectorAll('.oa-session-running-wave i')).toHaveLength(4)
  expect(restoredBackgroundButton.querySelector('.oa-session-waiting-label')).toBeNull()
  expect(screen.queryByRole('button', { name: /^Waiting for reply/ })).toBeNull()
  expect(document.querySelector('.oa-topbar').classList.contains('has-waiting')).toBe(false)
  await waitFor(() => expect(bridge).toHaveBeenLastCalledWith('running'))
}, 10000)
