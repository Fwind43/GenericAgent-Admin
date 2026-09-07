import React from 'react'
import { afterEach, expect, test } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { ChatMessage } from './ChatApp.jsx'
import { ChatSettingsPage } from './pages/ChatSettingsPage.jsx'
import { SETTINGS_TEXT } from './lib/i18n.js'
import { AUTO_COLLAPSE_PROCESS_KEY as key, setAutoCollapseProcess } from './hooks/useAutoCollapseProcess.js'

afterEach(() => { cleanup(); localStorage.removeItem(key) })
const content = 'LLM Running (Turn 1)\n<summary>Inspect source</summary>\nWorking'
const message = pending => <ChatMessage message={{ id: 'collapse-test', role: 'assistant', content }} pending={pending} />
const expanded = view => view.container.querySelector('.oa-turn-stack-head').getAttribute('aria-expanded')

test('defaults to enabled and collapses on completion', () => {
  const view = render(message(true))
  expect(expanded(view)).toBe('true')
  view.rerender(message(false))
  expect(expanded(view)).toBe('false')
})

test('disabled preference survives remount and keeps completed process open', () => {
  setAutoCollapseProcess(false)
  setAutoCollapseProcess(false)
  expect(localStorage.getItem(key)).toBe('false')
  const view = render(message(true))
  view.rerender(message(false))
  expect(expanded(view)).toBe('true')
  view.unmount()
  const restored = render(message(false))
  expect(expanded(restored)).toBe('true')
  fireEvent.click(restored.container.querySelector('.oa-turn-stack-head'))
  expect(expanded(restored)).toBe('false')
  restored.rerender(message(false))
  expect(expanded(restored)).toBe('false')
})

test('responds to same-tab and cross-tab preference changes', () => {
  const view = render(message(false))
  act(() => setAutoCollapseProcess(false))
  expect(expanded(view)).toBe('true')
  act(() => {
    localStorage.removeItem(key)
    window.dispatchEvent(new StorageEvent('storage', { key }))
  })
  expect(expanded(view)).toBe('false')
})

test('settings toggle is enabled by default and saves immediately', () => {
  const props = { t: {}, text: SETTINGS_TEXT.en, titleModel: { enabled: false, options: [], draft: '' } }
  const view = render(<ChatSettingsPage {...props} />)
  const toggle = view.container.querySelector('#settings-auto-collapse-process')
  expect(toggle.checked).toBe(true)
  fireEvent.click(toggle)
  expect(toggle.checked).toBe(false)
  expect(localStorage.getItem(key)).toBe('false')
  view.unmount()
  const restored = render(<ChatSettingsPage {...props} />)
  expect(restored.container.querySelector('#settings-auto-collapse-process').checked).toBe(false)
})
