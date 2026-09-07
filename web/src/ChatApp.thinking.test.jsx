import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ChatMessage } from './ChatApp.jsx'

afterEach(() => cleanup())

const frame = (content, pending = false) => <ChatMessage
  message={{ id: 'thinking-test', role: 'assistant', content, files: [], created_at: 0 }}
  pending={pending} onAskReply={vi.fn()}
/>

describe('thinking disclosure in the assistant pipeline', () => {
  test('shows a compact plain-text preview and renders Markdown in its body', () => {
    const { container } = render(frame('<thinking>**Checking** `code` and [docs](https://example.com)\n\n- First\n- Second\n</thinking>Visible answer'))
    const fold = container.querySelector('.fold-thinking')
    expect(fold).toBeTruthy()
    expect(fold.open).toBe(false)
    expect(fold.querySelector('.ga-thinking-label').textContent).toBe('思考过程')
    expect(fold.querySelector('.ga-thinking-preview').textContent).toBe('Checking code and docs')
    expect(fold.querySelector('summary a')).toBeNull()
    expect(fold.querySelector('.ga-thinking-body strong').textContent).toBe('Checking')
    expect(fold.querySelectorAll('.ga-thinking-body li')).toHaveLength(2)
    expect(container.querySelector('.ga-execution-log').nextElementSibling.textContent).toBe('Visible answer')
  })

  test('keeps the native disclosure and user selection through stream updates and completion', () => {
    const { container, rerender } = render(frame('<thinking>Checking', true))
    const fold = container.querySelector('.fold-thinking')
    expect(fold.dataset.live).toBe('true')
    fireEvent.click(fold.querySelector('summary'))
    expect(fold.open).toBe(true)
    rerender(frame('<thinking>Checking **more**</think', true))
    expect(container.querySelector('.fold-thinking')).toBe(fold)
    expect(fold.open).toBe(true)
    expect(fold.querySelector('.ga-thinking-body').textContent).toBe('Checking more')
    rerender(frame('<thinking>Checking **more**</thinking>Done'))
    expect(container.querySelector('.fold-thinking')).toBe(fold)
    expect(fold.open).toBe(true)
    expect(fold.hasAttribute('data-live')).toBe(false)
    fireEvent.click(fold.querySelector('summary'))
    expect(fold.open).toBe(false)
  })

  test('preserves nested thinking when a turn enters history and its parents reopen', () => {
    const first = 'LLM Running (Turn 1) ...\n<thinking>Inspecting styles</thinking>\n<summary>Checking the fold layout</summary>\nBody paragraph'
    const second = '\n\nLLM Running (Turn 2) ...\n<summary>Second step</summary>\nMore content'
    const { container, rerender } = render(frame(first, true))
    const turn = container.querySelector('[data-turn="1"]')
    const fold = turn.querySelector('.fold-thinking')
    fireEvent.click(fold.querySelector('summary'))
    expect(fold.open).toBe(true)

    rerender(frame(first + second, true))
    expect(container.querySelector('[data-turn="1"]')).toBe(turn)
    expect(turn.classList.contains('oa-turn-card')).toBe(true)
    expect(turn.querySelector('.fold-thinking')).toBe(fold)
    expect(fold.open).toBe(true)
    expect(turn.querySelector('.ga-summary-body').textContent).toBe('Checking the fold layout')

    const toggle = turn.querySelector('.oa-turn-toggle')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(fold.querySelector('summary'))
      expect(fold.open).toBe(false)
      fireEvent.click(fold.querySelector('summary'))
      expect(fold.open).toBe(true)
      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      const stackToggle = container.querySelector('.oa-turn-stack-head')
      fireEvent.click(stackToggle)
      fireEvent.click(stackToggle)
      expect(turn.querySelector('.fold-thinking')).toBe(fold)
      expect(fold.open).toBe(true)
    }
  })

  test('empty thinking leaves no disclosure and code examples remain code', () => {
    const { container, rerender } = render(frame('<thinking> </thinking>Answer'))
    expect(container.querySelector('.fold-thinking')).toBeNull()
    expect(container.textContent).toContain('Answer')
    rerender(frame('```xml\n<thinking>Example</thinking>\n```'))
    expect(container.querySelector('.fold-thinking')).toBeNull()
    expect(container.querySelector('code').textContent).toContain('<thinking>Example</thinking>')
  })
})
