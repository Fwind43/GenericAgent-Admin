// @vitest-environment jsdom
import React, { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import MessageNavigator, { messageNavigationNodes } from './MessageNavigator'

const messages = [
  { id: 'u1', role: 'user', content: 'First question' },
  { id: 'a1', role: 'assistant', content: 'Answer' },
  { id: 'side', role: 'user', kind: 'btw', content: 'Side question' },
  { id: 'u2', role: 'user', content: 'Second question' },
  { id: 'a2', role: 'assistant', content: 'Answer two' },
]
const ct = (zh, en) => en
let resize
function Harness({ items = messages, ...props }) {
  const threadRef = useRef(null)
  return <div><section className="oa-thread" ref={threadRef}>
    {items.filter(m => m.kind !== 'btw').map(m => <article key={m.id} className={`oa-message ${m.role}`} data-id={m.id}>{m.content}</article>)}
  </section><MessageNavigator messages={items} sessionID="s1" threadRef={threadRef} ct={ct} onNavigate={() => {}} {...props}/></div>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 1))
  vi.stubGlobal('cancelAnimationFrame', id => clearTimeout(id))
  vi.stubGlobal('ResizeObserver', class {
    constructor(fn) { resize = fn }
    observe() {}
    disconnect() {}
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () { return this.classList.contains('oa-thread') ? 600 : 100 })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2000)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const thread = this.closest('.oa-thread')
    const top = this.dataset.id === 'u2' ? 900 - thread.scrollTop : this.dataset.id ? -thread.scrollTop : 0
    return { top, bottom: top + 600, left: 0, right: 800, width: 800, height: 600 }
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

const flush = () => act(() => { vi.runOnlyPendingTimers() })

describe('message nodes', () => {
  test('indexes only main user messages, handles attachments and caps long previews', () => {
    const result = messageNavigationNodes([...messages,
      { id: 'file', role: 'user', files: [{ name: 'report.pdf' }] },
      { id: 'empty', role: 'user' },
      { id: 'long', role: 'user', content: 'x'.repeat(500) },
    ], 'Attachment', 'Empty message')
    expect(result.map(n => n.id)).toEqual(['u1', 'u2', 'file', 'empty', 'long'])
    expect(result[2].label).toBe('report.pdf')
    expect(result[3].label).toBe('Empty message')
    expect(result[4].label).toHaveLength(180)
  })
  test('shows hover summaries and clicks the stable message ID', () => {
    const onNavigate = vi.fn()
    render(<Harness onNavigate={onNavigate}/>)
    const first = screen.getByRole('button', { name: '1. First question' })
    fireEvent.mouseEnter(first)
    expect(screen.getByRole('tooltip').textContent).toContain('First question')
    fireEvent.click(first)
    expect(onNavigate).toHaveBeenCalledWith('u1')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
  test('tracks the turn at the reading position and at the bottom', () => {
    const { container } = render(<Harness/>)
    const thread = container.querySelector('.oa-thread')
    expect(screen.getByRole('button', { name: /First question/ }).getAttribute('aria-current')).toBe('location')
    thread.scrollTop = 850
    fireEvent.scroll(thread); flush()
    expect(screen.getByRole('button', { name: /Second question/ }).getAttribute('aria-current')).toBe('location')
    thread.scrollTop = 0
    act(() => resize()); flush()
    expect(screen.getByRole('button', { name: /First question/ }).getAttribute('aria-current')).toBe('location')
    thread.scrollTop = 1400
    fireEvent.scroll(thread); flush()
    expect(screen.getByRole('button', { name: /Second question/ }).getAttribute('aria-current')).toBe('location')
  })
  test('keyboard moves focus without jumping the conversation', () => {
    const onNavigate = vi.fn()
    render(<Harness onNavigate={onNavigate}/>)
    const first = screen.getByRole('button', { name: /First question/ })
    act(() => first.focus())
    fireEvent.keyDown(first, { key: 'End' })
    expect(document.activeElement.getAttribute('aria-label')).toBe('2. Second question')
    expect(onNavigate).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
  })
  test('resets preview and nodes when changing sessions, hides empty/loading views', () => {
    const view = render(<Harness/>)
    fireEvent.mouseEnter(screen.getByRole('button', { name: /First question/ }))
    view.rerender(<Harness items={[{ id: 'other', role: 'user', content: 'Other session' }]} sessionID="s2"/>)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.queryByRole('button', { name: /First question/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Other session/ }).getAttribute('aria-current')).toBe('location')
    view.rerender(<Harness loading/>); expect(screen.queryByRole('navigation')).toBeNull()
    view.rerender(<Harness items={[]}/>); expect(screen.queryByRole('navigation')).toBeNull()
  })
  test('loads earlier nodes through the existing pagination handler and disables duplicates', () => {
    const onLoadOlder = vi.fn()
    const view = render(<Harness hasMore onLoadOlder={onLoadOlder}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier message nodes' }))
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
    view.rerender(<Harness hasMore loadingOlder onLoadOlder={onLoadOlder}/>)
    expect(screen.getByRole('button', { name: 'Load earlier message nodes' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier message nodes' }))
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
    view.rerender(<Harness hasMore={false}/>)
    expect(screen.queryByRole('button', { name: 'Load earlier message nodes' })).toBeNull()
  })
})
