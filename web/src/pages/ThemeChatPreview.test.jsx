import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ThemeChatPreview from './ThemeChatPreview'
import { THEMES } from '../themes'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('renders production views without fetching, writing or mounting the chat controller', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const stored = JSON.stringify(localStorage)
  render(<ThemeChatPreview preset={THEMES[0]} variables={{}} zh={false}/> )
  const frame = screen.getByTitle('Production chat preview')
  fireEvent.load(frame)
  await waitFor(() => expect(frame.contentDocument.querySelector('[data-ui-surface="chat.composer"]')).not.toBeNull())
  const doc = frame.contentDocument
  for (const surface of ['chat.sidebar', 'chat.messages', 'chat.composer']) {
    expect(doc.querySelector(`[data-ui-surface="${surface}"]`)).not.toBeNull()
  }
  expect(doc.querySelector('.oa-message.user')).not.toBeNull()
  expect(doc.querySelector('.oa-message.assistant')).not.toBeNull()
  expect(doc.querySelector('.oa-md strong')?.textContent).toBe('Define your goal')
  expect(doc.querySelector('.oa-chat').hasAttribute('inert')).toBe(true)
  expect(doc.querySelector('.oa-chat-version').textContent).toBe('Preview')
  expect(fetch).not.toHaveBeenCalled()
  expect(JSON.stringify(localStorage)).toBe(stored)
})

it('updates isolated theme tokens in place, removes stale tokens and syncs late styles', async () => {
  const parentTheme = document.documentElement.dataset.theme
  const { rerender, unmount } = render(<ThemeChatPreview preset={THEMES[0]} variables={{ '--oa-text': '#123456', '--stale': '1px' }} zh={false}/> )
  const frame = screen.getByTitle('Production chat preview')
  fireEvent.load(frame)
  await waitFor(() => expect(frame.contentDocument.querySelector('.oa-message')).not.toBeNull())
  const doc = frame.contentDocument
  const message = doc.querySelector('.oa-message')
  const dark = THEMES.find(theme => theme.id === 'dark')
  rerender(<ThemeChatPreview preset={dark} variables={{ '--oa-text': '#abcdef', '--oa-message-font-size': '19px' }} zh/> )
  expect(doc.documentElement.dataset.theme).toBe('dark')
  expect(doc.documentElement.dataset.colorScheme).toBe(dark.colorScheme)
  expect(doc.documentElement.style.getPropertyValue('--oa-text')).toBe('#abcdef')
  expect(doc.documentElement.style.getPropertyValue('--stale')).toBe('')
  expect(doc.querySelector('.oa-message')).toBe(message)
  expect(document.documentElement.dataset.theme).toBe(parentTheme)
  const style = document.createElement('style')
  style.dataset.previewTest = 'late'
  try {
    await act(async () => { style.textContent = '.preview-test { color: red }'; document.head.append(style) })
    expect(doc.head.querySelector('[data-preview-test="late"]')?.textContent).toContain('color: red')
    await act(async () => { style.textContent = '.preview-test { color: blue }' })
    expect(doc.head.querySelector('[data-preview-test="late"]')?.textContent).toContain('color: blue')
  } finally { unmount(); style.remove() }
})

it('tracks the preview viewport and removes its breakpoint listener on unmount', async () => {
  const { unmount } = render(<ThemeChatPreview preset={THEMES[0]} variables={{}} zh={false}/> )
  const frame = screen.getByTitle('Production chat preview')
  let listener
  const query = {
    matches: true,
    addEventListener: vi.fn((event, callback) => { listener = callback }),
    removeEventListener: vi.fn(),
  }
  const matchMedia = vi.fn(() => query)
  Object.defineProperty(frame.contentWindow, 'matchMedia', { configurable: true, value: matchMedia })
  fireEvent.load(frame)
  await waitFor(() => expect(frame.contentDocument.querySelector('.oa-chat.is-collapsed')).not.toBeNull())
  expect(matchMedia).toHaveBeenCalledWith('(max-width: 900px)')
  expect(frame.contentDocument.querySelector('.oa-sidebar.collapsed')).not.toBeNull()
  act(() => { query.matches = false; listener() })
  expect(frame.contentDocument.querySelector('.oa-chat.is-collapsed')).toBeNull()
  expect(frame.contentDocument.querySelector('.oa-sidebar.collapsed')).toBeNull()
  act(() => { query.matches = true; listener() })
  expect(frame.contentDocument.querySelector('.oa-chat.is-collapsed')).not.toBeNull()
  unmount()
  expect(query.removeEventListener).toHaveBeenCalledWith('change', listener)
})
