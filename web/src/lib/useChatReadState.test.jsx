import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useChatReadState } from './useChatReadState.js'
import { chatReadKey, initializeChatReadBaseline, markChatResultRead } from './chatReadState.js'

const answer = { id: 'a', revision: 'v1' }
let focused, covered, bottom, props
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  focused = true; covered = false; bottom = 300
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(600)
  const thread = document.createElement('div')
  const node = document.createElement('article')
  node.className = 'oa-message'; node.dataset.id = 'a'
  thread.append(node); document.body.append(thread)
  node.getClientRects = () => [{}]
  node.getBoundingClientRect = () => ({ top: 0, bottom, height: bottom, left: 0, right: 500 })
  thread.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 500 })
  vi.stubGlobal('document', document)
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => covered ? thread : node })
  props = { instance: 'i', sid: 's', snapshot: { id: 's', result: answer }, messages: [{ id: 'a', content_revision: 'v1' }], sessions: [{ id: 's', result: answer }], running: false, loading: false, threadRef: { current: thread } }
})
afterEach(() => {
  cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})
const advance = ms => act(() => { vi.advanceTimersByTime(ms) })
const setup = () => renderHook(p => useChatReadState(p), { initialProps: props })

test('history baseline clears existing labels, but later completions stay unread across remount', () => {
  focused = false
  const h = setup()
  act(() => { initializeChatReadBaseline('i', props.sessions, localStorage, window) })
  expect(h.result.current.currentUnread).toBe(false)
  expect(h.result.current.unread(props.sessions[0])).toBe(false)
  const result = { ...answer, revision: 'v2' }
  props = { ...props, snapshot: { id: 's', result }, messages: [{ id: 'a', content_revision: 'v2' }], sessions: [{ id: 's', result }] }
  h.rerender(props)
  expect(h.result.current.currentUnread).toBe(true)
  const persisted = Object.entries(localStorage)
  act(() => { initializeChatReadBaseline('i', props.sessions, localStorage, window) })
  expect(Object.entries(localStorage)).toEqual(persisted)
  expect(h.result.current.unread(props.sessions[0])).toBe(true)
  h.unmount()
  expect(setup().result.current.currentUnread).toBe(true)
})

test('foreground dwell clears the list and current completion state and survives remount', () => {
  const h = setup()
  expect(h.result.current.currentUnread).toBe(true)
  advance(999)
  expect(h.result.current.unread(props.sessions[0])).toBe(true)
  advance(101)
  expect(h.result.current.currentUnread).toBe(false)
  expect(h.result.current.unread(props.sessions[0])).toBe(false)
  expect(localStorage.getItem(chatReadKey('i', 's', answer))).toBe('1')
  h.unmount()
  expect(setup().result.current.currentUnread).toBe(false)
})

test('background, covering layers and reply end outside viewport do not mark read', () => {
  focused = false
  const h = setup()
  advance(2000)
  focused = true; covered = true
  advance(2000)
  covered = false; bottom = 700
  advance(2000)
  expect(h.result.current.currentUnread).toBe(true)
  bottom = 300
  advance(600)
  act(() => { window.dispatchEvent(new Event('blur')) })
  advance(600)
  expect(h.result.current.currentUnread).toBe(true)
  advance(600)
  expect(h.result.current.currentUnread).toBe(false)
})

test.each([
  { loading: true }, { running: true },
  { snapshot: { id: 'other', result: answer } },
  { messages: [{ id: 'a', content_revision: 'old' }] },
  { sessions: [{ id: 's', result: answer, running: true }] },
  { sessions: [{ id: 's', result: { ...answer, revision: 'new' } }] },
])('stale, loading or running snapshots cannot mark read: %j', patch => {
  props = { ...props, ...patch }
  setup(); advance(2000)
  expect(localStorage.length).toBe(0)
})

test('switching session cancels old dwell and new revisions become unread', () => {
  const h = setup()
  advance(600)
  h.rerender({ ...props, sid: 'other' })
  advance(1500)
  expect(localStorage.length).toBe(0)
  h.rerender(props); advance(1100)
  expect(h.result.current.currentUnread).toBe(false)
  const result = { ...answer, revision: 'v2' }
  h.rerender({ ...props, snapshot: { id: 's', result }, messages: [{ id: 'a', content_revision: 'v2' }], sessions: [{ id: 's', result }] })
  expect(h.result.current.currentUnread).toBe(true)
  advance(1100)
  expect(h.result.current.currentUnread).toBe(false)
})

test('cross-tab storage and same-window events immediately synchronize lists', () => {
  focused = false
  const h = setup()
  localStorage.setItem(chatReadKey('i', 's', answer), '1')
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: chatReadKey('i', 's', answer) })) })
  expect(h.result.current.currentUnread).toBe(false)
  h.rerender({ ...props, instance: 'other' })
  expect(h.result.current.currentUnread).toBe(true)
  act(() => { markChatResultRead('other', 's', answer, localStorage, window) })
  expect(h.result.current.currentUnread).toBe(false)
})
