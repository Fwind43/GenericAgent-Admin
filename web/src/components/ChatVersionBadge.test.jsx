import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import ChatVersionBadge from './ChatVersionBadge'
vi.mock('../lib/api', () => ({ api: vi.fn() }))
beforeEach(() => {
  localStorage.setItem('ga-admin-lang', 'en')
  window.matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); localStorage.clear() })
it('shows the running Admin version', async () => {
  api.mockResolvedValue({ version: 'v1.2.3' })
  render(<ChatVersionBadge/>)
  expect(await screen.findByText('v1.2.3')).toBeTruthy()
  expect(api).toHaveBeenCalledWith('/api/version/info')
})
it('does not invent a version on failure', async () => {
  api.mockRejectedValue(new Error('offline'))
  render(<ChatVersionBadge/> )
  const badge = await screen.findByRole('button', { name: /GenericAgent Admin \?/ })
  expect(badge.textContent).toBe('?')
  fireEvent.click(badge)
  expect(await screen.findByText(/^offline/)).toBeTruthy()
})

it('opens with the keyboard, reads only update state, and restores focus on close', async () => {
  const user = userEvent.setup()
  api.mockImplementation(async path => path === '/api/version/info'
    ? { version: 'v1.2.3', update_supported: true }
    : { stage: '', running: false })
  render(<ChatVersionBadge version="v1.2.3"/> )
  const badge = screen.getByRole('button', { name: /System update/ })
  expect(api).not.toHaveBeenCalled()
  expect(badge.getAttribute('aria-haspopup')).toBe('dialog')
  await user.tab()
  expect(document.activeElement).toBe(badge)
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('dialog', { name: 'System update' })).toBeTruthy()
  expect(badge.getAttribute('aria-expanded')).toBe('true')
  await waitFor(() => expect(screen.getAllByText('v1.2.3')).toHaveLength(2))
  expect([...new Set(api.mock.calls.map(([path]) => path))].sort()).toEqual(['/api/version/info', '/api/version/status'])
  await user.click(screen.getAllByRole('button', { name: 'Close', exact: true }).at(-1))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(badge.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(badge)
  expect(api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it('updates the entry and open dialog when chat language changes', async () => {
  api.mockImplementation(async path => path === '/api/version/info' ? { version: 'v1.2.3' } : { running: false })
  render(<ChatVersionBadge version="v1.2.3"/> )
  fireEvent.click(screen.getByRole('button', { name: /System update/ }))
  await screen.findByRole('dialog', { name: 'System update' })
  act(() => window.dispatchEvent(new CustomEvent('ga-admin-language-change', { detail: 'zh' })))
  expect(screen.getByRole('dialog', { name: '\u7cfb\u7edf\u66f4\u65b0' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /\u7cfb\u7edf\u66f4\u65b0.*GenericAgent Admin/ })).toBeTruthy()
})

it('polls once per interval with fresh checks and cancels pending polling on close', async () => {
  vi.useFakeTimers()
  const check = { update: true, latest: { tag_name: 'v1.2.4' } }
  let statusReads = 0
  api.mockImplementation(async path => {
    if (path === '/api/version/info') return { version: 'v1.2.3', update_supported: true }
    statusReads += 1
    return { id: 'op-1', stage: 'ready', running: true, progress: 100,
      check: statusReads <= 4 ? structuredClone(check) : check }
  })
  render(<ChatVersionBadge version="v1.2.3"/> )
  const badge = screen.getByRole('button', { name: /System update/ })
  await act(async () => { fireEvent.click(badge) })
  expect(screen.getByText('op-1')).toBeTruthy()
  const readsBeforeTick = statusReads
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(statusReads - readsBeforeTick).toBe(1)
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: 'Close', exact: true }).at(-1))
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(screen.queryByRole('dialog')).toBeNull()
  const closedCalls = api.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
  expect(api.mock.calls.length).toBe(closedCalls)
  await act(async () => { fireEvent.click(badge) })
  expect(api.mock.calls.length).toBeGreaterThan(closedCalls)
  expect(screen.getByRole('dialog', { name: 'System update' })).toBeTruthy()
})
