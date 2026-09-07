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

  test('empty thinking leaves no disclosure and code examples remain code', () => {
    const { container, rerender } = render(frame('<thinking> </thinking>Answer'))
    expect(container.querySelector('.fold-thinking')).toBeNull()
    expect(container.textContent).toContain('Answer')
    rerender(frame('```xml\n<thinking>Example</thinking>\n```'))
    expect(container.querySelector('.fold-thinking')).toBeNull()
    expect(container.querySelector('code').textContent).toContain('<thinking>Example</thinking>')
  })
})
