import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ChatApp from '../ChatApp'
import { UiHost } from './UiHost'

// Real controller and UI; transport only is an in-process fixture.
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('real chat retains draft, message DOM and queue subscription across package switch and restore', async () => {
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
      case 'GET /api/chat/sessions': data = { sessions: [session], projects: [] }; break
      case 'GET /api/chat/session/s1': data = { ...session, messages: [{ id: 'm1', role: 'user', content: 'Retained fixture message' }], raw_history: [], settings: {}, queued_messages: [] }; break
      case 'GET /api/chat/state/s1': data = { running: false, models: [], settings: {}, queued_messages: [] }; break
      case 'GET /api/chat/queue/s1': data = { queued_messages: [] }; break
      default: unexpected.push(key); throw new Error('Unexpected fixture request: ' + key)
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const settings = vi.fn()
  const { container } = render(<UiHost><ChatApp onOpenSettings={settings}/></UiHost>)
  const message = await screen.findByText('Retained fixture message', { selector: '.oa-msg-text' })
  const composer = await screen.findByPlaceholderText(/Message GenericAgent/)
  fireEvent.change(composer, { target: { value: 'unsent draft survives' } })
  await waitFor(() => expect(sources.filter(s => !s.closed)).toHaveLength(1))
  const source = sources.find(s => !s.closed)
  const sourceCount = sources.length
  const detailReads = calls.filter(c => c === 'GET /api/chat/session/s1').length
  const main = container.querySelector('.oa-main')
  const bar = screen.getByRole('region', { name: 'Chat interface package' })
  fireEvent.click(within(bar).getByRole('button', { name: /Enable Studio chat/ }))
  await screen.findByLabelText('Studio chat')
  expect(main.dataset.uiChat).toBe('studio')
  expect(container.querySelector('.oa-main')).toBe(main)
  expect(screen.getByText('Retained fixture message', { selector: '.oa-msg-text' })).toBe(message)
  expect(screen.getByPlaceholderText(/Message GenericAgent/)).toBe(composer)
  expect(composer.value).toBe('unsent draft survives')
  expect(source.closed).toBe(false)
  expect(sources).toHaveLength(sourceCount)
  fireEvent.click(within(screen.getByRole('toolbar', { name: 'Package chat tools' })).getByRole('button', { name: 'Settings' }))
  expect(settings).toHaveBeenCalledTimes(1)
  fireEvent.click(within(bar).getByRole('button', { name: /Restore default chat/ }))
  await screen.findByLabelText('Default chat')
  expect(main.dataset.uiChat).toBe('default')
  expect(screen.getByText('Retained fixture message', { selector: '.oa-msg-text' })).toBe(message)
  expect(screen.getByPlaceholderText(/Message GenericAgent/)).toBe(composer)
  expect(composer.value).toBe('unsent draft survives')
  expect(source.closed).toBe(false)
  expect(sources).toHaveLength(sourceCount)
  expect(calls.filter(c => c === 'GET /api/chat/session/s1')).toHaveLength(detailReads)
  expect(unexpected).toEqual([])
}, 20000)
