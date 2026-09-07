// @vitest-environment jsdom
import React, { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import MessageNavigator, { messageNavigationNodes } from './MessageNavigator'
import { readFileSync } from 'node:fs'

const navigatorCSS = readFileSync('src/components/MessageNavigator.css', 'utf8')

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
  test('caps directory height and contains overflow within the list', () => {
    const track = navigatorCSS.match(/\.oa-message-nav-track\s*\{([^}]+)\}/)[1]
    expect(track).toMatch(/max-height:\s*min\(100%, 320px, 50dvh\)/)
    expect(track).toMatch(/overflow-y:\s*auto/)
    expect(track).toMatch(/overscroll-behavior:\s*contain/)
  })
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
  test('opens the full list on hover and keeps it open while browsing', () => {
    const onNavigate = vi.fn()
    render(<Harness onNavigate={onNavigate}/>)
    const nav = screen.getByRole('navigation')
    const first = screen.getByRole('button', { name: '1. First question' })
    const second = screen.getByRole('button', { name: '2. Second question' })
    expect(nav.dataset.expanded).toBe('false')
    fireEvent.pointerEnter(first, { pointerType: 'mouse' })
    expect(nav.dataset.expanded).toBe('true')
    expect(screen.getByRole('list').textContent).toContain('First question')
    expect(screen.getByRole('list').textContent).toContain('Second question')
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(onNavigate).not.toHaveBeenCalled()
    fireEvent.pointerOut(first, { pointerType: 'mouse', relatedTarget: second })
    fireEvent.pointerOver(second, { pointerType: 'mouse', relatedTarget: first })
    fireEvent.scroll(screen.getByRole('list'))
    expect(nav.dataset.expanded).toBe('true')
    fireEvent.click(second)
    expect(onNavigate).toHaveBeenCalledWith('u2')
    fireEvent.pointerLeave(nav, { pointerType: 'mouse' })
    expect(nav.dataset.expanded).toBe('false')
  })
  test('first touch opens without navigating, next touch selects, outside touch dismisses', () => {
    const onNavigate = vi.fn()
    render(<Harness onNavigate={onNavigate}/>)
    const nav = screen.getByRole('navigation')
    const first = screen.getByRole('button', { name: /First question/ })
    fireEvent.pointerEnter(first, { pointerType: 'touch' })
    expect(nav.dataset.expanded).toBe('false')
    fireEvent.pointerDown(first, { pointerType: 'touch' })
    fireEvent.click(first)
    expect(nav.dataset.expanded).toBe('true')
    expect(onNavigate).not.toHaveBeenCalled()
    fireEvent.pointerLeave(nav, { pointerType: 'touch' })
    expect(nav.dataset.expanded).toBe('true')
    fireEvent.pointerDown(first, { pointerType: 'touch' })
    fireEvent.click(first)
    expect(onNavigate).toHaveBeenCalledWith('u1')
    fireEvent.pointerDown(document.body, { pointerType: 'touch' })
    expect(nav.dataset.expanded).toBe('false')
  })
  test('focus opens the list and Escape or focus leaving dismisses it', () => {
    render(<Harness/>)
    const nav = screen.getByRole('navigation')
    const first = screen.getByRole('button', { name: /First question/ })
    act(() => first.focus())
    expect(nav.dataset.expanded).toBe('true')
    fireEvent.keyDown(first, { key: 'Escape' })
    expect(nav.dataset.expanded).toBe('false')
    fireEvent.focus(first)
    expect(nav.dataset.expanded).toBe('true')
    fireEvent.blur(first, { relatedTarget: document.body })
    expect(nav.dataset.expanded).toBe('false')
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
  test('resets expansion and nodes when changing sessions, hides empty/loading views', () => {
    const view = render(<Harness/>)
    fireEvent.pointerEnter(screen.getByRole('button', { name: /First question/ }), { pointerType: 'mouse' })
    view.rerender(<Harness items={[{ id: 'other', role: 'user', content: 'Other session' }]} sessionID="s2"/>)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getByRole('navigation').dataset.expanded).toBe('false')
    expect(screen.queryByRole('button', { name: /First question/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Other session/ }).getAttribute('aria-current')).toBe('location')
    view.rerender(<Harness loading/>); expect(screen.queryByRole('navigation')).toBeNull()
    view.rerender(<Harness items={[]}/>); expect(screen.queryByRole('navigation')).toBeNull()
  })
  test('loads once when scrolling upward to the top and permits the next page after completion', async () => {
    let finish
    const onLoadOlder = vi.fn(() => new Promise(resolve => { finish = resolve }))
    render(<Harness hasMore onLoadOlder={onLoadOlder}/>)
    const nav = screen.getByRole('navigation')
    const track = screen.getByRole('list', { name: 'Message list' })
    fireEvent.pointerEnter(nav, { pointerType: 'mouse' })
    fireEvent.scroll(track, { target: { scrollTop: 100 } })
    fireEvent.scroll(track, { target: { scrollTop: 20 } })
    expect(onLoadOlder).not.toHaveBeenCalled()
    fireEvent.scroll(track, { target: { scrollTop: 5 } })
    fireEvent.scroll(track, { target: { scrollTop: 0 } })
    fireEvent.wheel(track, { deltaY: -50 })
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
    await act(async () => { finish() })
    fireEvent.scroll(track)
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
    fireEvent.scroll(track, { target: { scrollTop: 50 } })
    fireEvent.scroll(track, { target: { scrollTop: 0 } })
    expect(onLoadOlder).toHaveBeenCalledTimes(2)
    await act(async () => { finish() })
  })
  test('ignores collapsed, loading, exhausted and downward scrolling states', () => {
    const onLoadOlder = vi.fn()
    const view = render(<Harness hasMore onLoadOlder={onLoadOlder}/>)
    const track = screen.getByRole('list', { name: 'Message list' })
    const reachTop = () => {
      fireEvent.scroll(track, { target: { scrollTop: 60 } })
      fireEvent.scroll(track, { target: { scrollTop: 0 } })
      fireEvent.wheel(track, { deltaY: -50 })
    }
    reachTop()
    fireEvent.pointerEnter(screen.getByRole('navigation'), { pointerType: 'mouse' })
    fireEvent.scroll(track, { target: { scrollTop: 5 } })
    fireEvent.wheel(track, { deltaY: 50 })
    expect(onLoadOlder).not.toHaveBeenCalled()
    view.rerender(<Harness hasMore loadingOlder onLoadOlder={onLoadOlder}/>)
    reachTop()
    view.rerender(<Harness hasMore={false} onLoadOlder={onLoadOlder}/>)
    reachTop()
    expect(onLoadOlder).not.toHaveBeenCalled()
  })
  test('loads on an upward wheel gesture when the directory is already at the top', async () => {
    const onLoadOlder = vi.fn()
    render(<Harness hasMore onLoadOlder={onLoadOlder}/>)
    fireEvent.pointerEnter(screen.getByRole('navigation'), { pointerType: 'mouse' })
    const track = screen.getByRole('list', { name: 'Message list' })
    await act(async () => { fireEvent.wheel(track, { deltaY: -50 }) })
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })
  test('preserves the old node position after prepending without scrolling the conversation', () => {
    const view = render(<Harness hasMore/>)
    const track = screen.getByRole('list', { name: 'Message list' })
    const first = screen.getByRole('button', { name: /First question/ })
    const thread = document.querySelector('.oa-thread')
    let offset = 30
    Object.defineProperty(first, 'offsetTop', { get: () => offset })
    Object.defineProperty(track, 'scrollHeight', { get: () => 500 + offset })
    fireEvent.pointerEnter(screen.getByRole('navigation'), { pointerType: 'mouse' })
    fireEvent.scroll(track, { target: { scrollTop: 20 } })
    thread.scrollTop = 123
    offset = 120
    view.rerender(<Harness hasMore items={[{ id: 'earlier', role: 'user', content: 'Earlier question' }, ...messages]}/>)
    expect(track.scrollTop).toBe(110)
    expect(first.offsetTop - track.scrollTop).toBe(10)
    expect(thread.scrollTop).toBe(123)
    view.rerender(<Harness hasMore items={[{ id: 'other', role: 'user', content: 'Different session' }]} sessionID="s2"/>)
    expect(screen.getByRole('navigation').dataset.expanded).toBe('false')
  })
  test('does not treat content shrinkage as an upward user scroll', () => {
    const onLoadOlder = vi.fn()
    render(<Harness hasMore onLoadOlder={onLoadOlder}/>)
    const track = screen.getByRole('list', { name: 'Message list' })
    let height = 500
    Object.defineProperty(track, 'scrollHeight', { get: () => height })
    fireEvent.pointerEnter(screen.getByRole('navigation'), { pointerType: 'mouse' })
    fireEvent.scroll(track, { target: { scrollTop: 100 } })
    height = 300
    fireEvent.scroll(track, { target: { scrollTop: 0 } })
    expect(onLoadOlder).not.toHaveBeenCalled()
  })
  test('loads earlier nodes through the existing pagination handler and disables duplicates', () => {
    const onLoadOlder = vi.fn()
    const view = render(<Harness hasMore onLoadOlder={onLoadOlder}/>)
    fireEvent.pointerEnter(screen.getByRole('navigation'), { pointerType: 'mouse' })
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
