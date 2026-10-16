import React from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ChatMessage } from './ChatApp.jsx'
import { AUTO_COLLAPSE_PROCESS_KEY, setAutoCollapseProcess } from './hooks/useAutoCollapseProcess.js'

afterEach(() => { cleanup(); localStorage.removeItem(AUTO_COLLAPSE_PROCESS_KEY); vi.restoreAllMocks() })
const final = '<summary>Done</summary>\n\nAnswer with **formatting** and an example:\n```text\nLLM Running (Turn 99)\n```'
const partial = { id: 'lazy-test', role: 'assistant', content: final, content_partial: true, execution_count: 2 }
const full = { ...partial, content: 'LLM Running (Turn 1)\n<summary>Inspect</summary>\nWorking\nLLM Running (Turn 2)\n<summary>Verify</summary>\nDone\n```[Info] Final response to user.```\n' + final, content_partial: false }

test('collapsed lazy process keeps the same final body and loads nothing until expanded', async () => {
  const load = vi.fn().mockResolvedValue(full)
  const view = render(<ChatMessage message={partial} onLoadMessage={load} />)
  const body = view.container.querySelector('.oa-final-answer')
  expect(body.textContent).toContain('Done')
  expect(body.textContent).toContain('LLM Running (Turn 99)')
  expect(view.container.querySelectorAll('.oa-turn-node')).toHaveLength(0)
  expect(load).not.toHaveBeenCalled()
  fireEvent.click(view.container.querySelector('.oa-turn-stack-head'))
  await waitFor(() => expect(load).toHaveBeenCalledOnce())
  const before = body.innerHTML
  view.rerender(<ChatMessage message={full} onLoadMessage={load} />)
  expect(view.container.querySelector('.oa-final-answer').innerHTML).toBe(before)
  expect(view.container.querySelector('.oa-turn-stack-head b').textContent).toBe('2')
  expect(view.container.querySelector('.oa-turn-stack').textContent).toContain('Inspect')
  expect(view.container.querySelector('.oa-turn-stack').textContent).toContain('Verify')
})

test('detail failure does not automatically retry and explicit retry recovers', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(full)
  const view = render(<ChatMessage message={partial} onLoadMessage={load} />)
  fireEvent.click(view.container.querySelector('.oa-turn-stack-head'))
  await view.findByText('offline')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(load).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('button', { name: /Retry|重试/ }))
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
})

test('disabled auto-collapse does not fetch lazy history until explicitly expanded', async () => {
  setAutoCollapseProcess(false)
  const load = vi.fn().mockResolvedValue(full)
  const view = render(<ChatMessage message={partial} onLoadMessage={load} />)
  await act(async () => {})
  expect(load).not.toHaveBeenCalled()
  expect(view.container.querySelector('.oa-turn-stack-head').getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(view.container.querySelector('.oa-turn-stack-head'))
  await waitFor(() => expect(load).toHaveBeenCalledOnce())
  view.rerender(<ChatMessage message={full} onLoadMessage={load} />)
  expect(view.container.querySelector('.oa-turn-stack-head').getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(view.container.querySelector('.oa-turn-stack-head'))
  fireEvent.click(view.container.querySelector('.oa-turn-stack-head'))
  expect(load).toHaveBeenCalledOnce()
  view.unmount()
  render(<ChatMessage message={partial} onLoadMessage={load} />)
  await act(async () => {})
  expect(load).toHaveBeenCalledOnce()
})

test('changing display preference does not download lazy history', async () => {
  const load = vi.fn()
  const view = render(<ChatMessage message={partial} onLoadMessage={load} />)
  act(() => setAutoCollapseProcess(false))
  await act(async () => {})
  expect(load).not.toHaveBeenCalled()
  expect(view.container.querySelector('.oa-turn-stack-head').getAttribute('aria-expanded')).toBe('false')
})

test('already loaded history still honors the expanded preference', () => {
  setAutoCollapseProcess(false)
  const load = vi.fn()
  const view = render(<ChatMessage message={full} onLoadMessage={load} />)
  expect(view.container.querySelector('.oa-turn-stack-head').getAttribute('aria-expanded')).toBe('true')
  expect(load).not.toHaveBeenCalled()
})

test('live lazy response still fetches execution once', async () => {
  const load = vi.fn().mockResolvedValue(full)
  render(<ChatMessage message={partial} pending onLoadMessage={load} />)
  await waitFor(() => expect(load).toHaveBeenCalledOnce())
})
