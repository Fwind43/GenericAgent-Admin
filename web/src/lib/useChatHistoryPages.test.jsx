import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useChatHistoryPages } from './useChatHistoryPages.js'

afterEach(cleanup)
const message = (id, extra = {}) => ({ id, content: id, content_revision: id, ...extra })
const page = (id = 'a') => ({ id, messages: [message('m2')], has_more: true, before: 'cursor', message_index: [{ id: 'm1', revision: 'm1' }, { id: 'm2', revision: 'm2' }] })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function setup(api = vi.fn()) {
  const messagesRef = { current: [] }
  const thread = { scrollTop: 50, scrollHeight: 200 }
  const pauseFollow = vi.fn()
  const onConflict = vi.fn()
  const setMessages = vi.fn(update => {
    const messages = typeof update === 'function' ? update(messagesRef.current) : update
    messagesRef.current = messages
    thread.scrollHeight = 100 + messages.length * 100
  })
  const hook = renderHook(() => useChatHistoryPages({ api, messagesRef, setMessages, threadRef: { current: thread }, pauseFollow, onConflict }))
  act(() => hook.result.current.apply(page(), 'instance:a'))
  return { ...hook, messagesRef, thread, pauseFollow, onConflict }
}

test('prepends without duplicates, preserves live messages and reading anchor', async () => {
  const gate = deferred()
  const api = vi.fn(() => gate.promise)
  const h = setup(api)
  let request
  act(() => { request = h.result.current.loadOlder() })
  await act(async () => { await h.result.current.loadOlder() })
  expect(api).toHaveBeenCalledTimes(1)
  h.messagesRef.current.push(message('live'))
  await act(async () => {
    gate.resolve({ messages: [message('m1'), message('m2')], has_more: false, before: '' })
    await request
  })
  expect(h.messagesRef.current.map(m => m.id)).toEqual(['m1', 'm2', 'live'])
  expect(h.thread.scrollTop).toBe(250)
  expect(h.pauseFollow).toHaveBeenCalledOnce()
  expect(h.result.current.loading).toBe(false)
})

test('switching aborts older requests and ignores late replies', async () => {
  const gate = deferred()
  const api = vi.fn(() => gate.promise)
  const h = setup(api)
  let older
  act(() => { older = h.result.current.loadOlder() })
  act(() => { h.result.current.begin(); h.result.current.apply(page('b'), 'instance:b') })
  expect(api.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true)
  await act(async () => { gate.resolve({ messages: [message('wrong')], id: 'wrong' }); await older })
  expect(h.result.current.page.id).toBe('b')
  expect(h.messagesRef.current.map(m => m.id)).toEqual(['m2'])
  expect(h.result.current.loading).toBe(false)
})

test('complete older pages survive cached session return and clear discards them', async () => {
  const full = message('m1', { content: 'full body', outputs: ['output'] })
  const api = vi.fn(async () => ({ messages: [full], has_more: false, before: '' }))
  const h = setup(api)
  await act(async () => { await h.result.current.loadOlder() })
  act(() => { h.result.current.begin(); h.result.current.apply(page('b'), 'instance:b'); h.result.current.begin(); h.result.current.apply(page(), 'instance:a') })
  expect(h.messagesRef.current[0]).toEqual(full)
  expect(h.result.current.page.has_more).toBe(false)
  act(() => { h.result.current.clear(); h.result.current.apply(page(), 'instance:a') })
  expect(h.messagesRef.current.map(m => m.id)).toEqual(['m2'])
})

test('near-top loading respects threshold, in-flight deduplication and history end', async () => {
  const gate = deferred()
  const api = vi.fn(() => gate.promise)
  const h = setup(api)
  h.thread.scrollTop = 241
  await act(async () => { await h.result.current.loadOlderNearTop() })
  expect(api).not.toHaveBeenCalled()
  h.thread.scrollTop = 240
  let request
  act(() => { request = h.result.current.loadOlderNearTop() })
  await act(async () => { await h.result.current.loadOlderNearTop() })
  expect(api).toHaveBeenCalledOnce()
  expect(api.mock.calls[0][0]).toContain('view=page&before=cursor')
  await act(async () => { gate.resolve({ messages: [message('m1')], has_more: false, before: '' }); await request })
  h.thread.scrollTop = 0
  await act(async () => { await h.result.current.loadOlderNearTop() })
  expect(api).toHaveBeenCalledOnce()
})

test('conflicts trigger refresh and errors permit retry', async () => {
  const api = vi.fn().mockRejectedValueOnce(new Error('history changed; refresh history')).mockResolvedValueOnce({ messages: [message('m1')], has_more: false })
  const h = setup(api)
  await act(async () => { await h.result.current.loadOlder() })
  expect(h.onConflict).toHaveBeenCalledOnce()
  expect(h.result.current.error).toContain('changed')
  await act(async () => { await h.result.current.loadOlder() })
  expect(h.result.current.error).toBe('')
  expect(h.messagesRef.current.map(m => m.id)).toEqual(['m1', 'm2'])
})
