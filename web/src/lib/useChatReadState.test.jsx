import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useChatReadState } from './useChatReadState.js'


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
  props = { instance: 'i', sid: 's', snapshot: { id: 's', result: answer }, messages: [{ id: 'a', content_revision: 'v1' }], sessions: [{ id: 's', result: answer, unread: true }], api: vi.fn(async (_, options) => JSON.parse(options.body)), onError: vi.fn(), running: false, loading: false, threadRef: { current: thread } }
})
afterEach(() => {
  cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})
const advance = ms => act(() => { vi.advanceTimersByTime(ms) })
const setup = () => renderHook(p => useChatReadState(p), { initialProps: props })

test('server confirmation clears selected result without local storage', async () => {
  focused = false
  const h = setup()
  expect(h.result.current.currentUnread).toBe(true)
  await act(async () => { await h.result.current.markSessionRead('s') })
  expect(h.result.current.currentUnread).toBe(false)
  expect(props.api).toHaveBeenCalledWith('/api/chat/read', expect.objectContaining({ method: 'POST' }))
  expect(localStorage.length).toBe(0)
  h.rerender({ ...props, sessions: [{ id: 's', result: { ...answer, revision: 'v2' }, unread: true }] })
  expect(h.result.current.currentUnread).toBe(true)
})

test('another browser receives server read state and instance remains isolated', () => {
  focused = false
  const h = setup()
  h.rerender({ ...props, sessions: [{ ...props.sessions[0], unread: false }] })
  expect(h.result.current.hasUnread).toBe(false)
  h.rerender({ ...props, instance: 'other' })
  expect(h.result.current.hasUnread).toBe(true)
})

test('failed request keeps unread and supports retry', async () => {
  focused = false
  props.api.mockRejectedValueOnce(new Error('offline'))
  const h = setup()
  await act(async () => { await h.result.current.markAllRead() })
  expect(h.result.current.hasUnread).toBe(true)
  expect(props.onError).toHaveBeenCalledWith('offline')
  await act(async () => { await h.result.current.markAllRead() })
  expect(h.result.current.hasUnread).toBe(false)
})

test('mark all skips running results and waits for confirmation', async () => {
  focused = false
  props.sessions.push({ id: 'busy', result: answer, unread: true, running: true })
  let resolve
  props.api.mockImplementation(() => new Promise(r => { resolve = r }))
  const h = setup()
  act(() => { void h.result.current.markAllRead() })
  expect(h.result.current.hasUnread).toBe(true)
  expect(JSON.parse(props.api.mock.calls[0][1].body).receipts).toHaveLength(1)
  await act(async () => { resolve({ receipts: [{ sid: 's', result: answer }] }) })
  expect(h.result.current.hasUnread).toBe(false)
})

test('visible final result marks read after dwell, never while covered', async () => {
  covered = true
  const h = setup()
  advance(1500)
  expect(props.api).not.toHaveBeenCalled()
  covered = false
  await act(async () => { vi.advanceTimersByTime(1200) })
  expect(props.api).toHaveBeenCalledTimes(1)
  expect(h.result.current.currentUnread).toBe(false)
})
