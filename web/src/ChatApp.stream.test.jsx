import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { TextDecoder, TextEncoder } from 'node:util'
import { describe, expect, test } from 'vitest'
import * as stream from './lib/chatStream.js'

// Execute the production open/load/attach/follow/read/event functions with controlled
// network snapshots. This is not a mounted React or real HTTP integration test.
const source = readFileSync('src/ChatApp.jsx', 'utf8').replace(/\r\n/g, '\n')
const between = (start, end) => {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a)
  if (a < 0 || b <= a) throw new Error(`Missing source boundary: ${start}`)
  return source.slice(a, b)
}
const functions = [
  between('  const openSession = async', '  const refreshActiveSessionSnapshot'),
  between('  const loadChatState = async', '  const openSession = async'),
  between('  const attachRunningStream = async', '\n  useEffect(() => {\n    if (!sid || !isLoopFollowActive'),
  between('  const applyStreamEvent =', '  const waitForStreamRetry ='),
  between('  const followChatStream =', '  const startLoop ='),
].join('\n')
const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

async function replayRace({ type = 'done', mirror = true, stateFirst = true } = {}) {
  const detailGate = deferred()
  const stateGate = deferred()
  const refreshGate = deferred()
  const errors = []
  const requests = []
  const finalMessage = {
    id: 'assistant-final', role: 'assistant', content: 'Completed answer',
    usage: { output_tokens: 9 }, elapsed_ms: 300, ctx_chars: 100,
  }
  const nextUser = { id: 'next-user', role: 'user', content: 'Next question' }
  const detail = {
    id: 'selected-session', settings: {},
    messages: [{ id: 'user-1', role: 'user', content: 'Question' }, finalMessage, nextUser],
  }
  let messages = []
  let stateCalls = 0
  let streamCalls = 0
  let refreshStarted = false
  const noop = () => {}
  const sandbox = {
    ...stream, console: { log: noop }, Date, AbortController, TextDecoder,
    window: { setTimeout, clearTimeout },
    openSeqRef: { current: 0 }, activeSidRef: { current: '' },
    pendingSessionScrollRestoreRef: { current: null }, pendingRenderedSessionRef: { current: '' },
    guidingQueueRef: { current: '' }, streamAbortRef: { current: null },
    sessionLoadAbortRef: { current: null }, renderedSessionRef: { current: '' },
    loadSessionDetail: id => sandbox.chatApi(`/api/chat/session/${id}`),
    streamActivitySeqRef: { current: 0 }, scrollModeRef: { current: 'auto' },
    chatInstanceRef: { current: '' }, sessionScrollSnapshotsRef: { current: {} },
    autoFollowRef: { current: true }, messagesRef: { current: [] },
    worldlineOpen: false, streamingSid: '',
    rememberRenderedSessionScroll: noop, applyQueueSnapshot: noop,
    historyPages: { begin: noop, apply: data => sandbox.setMessages(data.messages || []) },
    addChatInstanceToURL: url => url,
    loadChatSessionDraft: () => '', sessionScrollRestore: () => null,
    persistSelectedChatSessionID: noop,
    normalizeReasoningEffort: value => value || '', updateSessionLoop: xs => xs,
    isActiveSession: id => !id || sandbox.activeSidRef.current === id,
    mergeUltraPlanStates: (previous, next) => next || previous,
    getElapsedMs: message => message.elapsed_ms || 0,
    waitForStreamRetry: async () => { throw new Error('Unexpected retry') },
    chatApi: async url => {
      requests.push(url)
      if (url.includes('/state/')) {
        if (++stateCalls === 1) {
          await stateGate.promise
          return { running: true, pending_assistant_id: finalMessage.id, settings: {}, llms: [] }
        }
        return { running: false, loop: null }
      }
      if (url.includes('/session/')) {
        await detailGate.promise
        return detail
      }
      throw new Error(`Unexpected API: ${url}`)
    },
    chatFetch: async () => {
      streamCalls++
      let sent = false
      const events = [
        { type: 'user', message: detail.messages[0] },
        { type: 'delta', delta: finalMessage.content },
        { type, message: finalMessage },
      ]
      return {
        status: 200, ok: true,
        body: { getReader: () => ({
          read: async () => {
            if (sent) return { done: true }
            sent = true
            return { done: false, value: new TextEncoder().encode(events.map(e => JSON.stringify(e)).join('\n') + '\n') }
          },
          releaseLock: noop,
        }) },
      }
    },
    shouldPollGeneratedTitle: () => false,
    refreshActiveSessionSnapshot: async () => {
      refreshStarted = true
      await refreshGate.promise
      sandbox.setMessages(detail.messages)
    },
    loadSessions: async () => [],
  }
  for (const name of new Set(functions.match(/\bset[A-Z]\w+/g))) sandbox[name] = noop
  sandbox.setErr = value => { if (value) errors.push(value) }
  sandbox.setMessages = value => {
    messages = typeof value === 'function' ? value(messages) : value
    if (mirror) sandbox.messagesRef.current = messages
  }
  vm.createContext(sandbox)
  vm.runInContext(`${functions}\nglobalThis.openSession = openSession; globalThis.applyStreamEvent = applyStreamEvent;`, sandbox)
  try {
    const opening = sandbox.openSession(detail.id)
    expect(requests).toEqual(['/api/chat/state/selected-session', '/api/chat/session/selected-session'])
    if (stateFirst) stateGate.resolve()
    else detailGate.resolve()
    await tick()
    expect(streamCalls).toBe(0)
    detailGate.resolve()
    stateGate.resolve()
    await opening
    await tick()
    expect(errors).toEqual([])
    expect(sandbox.streamAbortRef.current).toBeNull()
    expect(refreshStarted).toBe(false)
    expect(streamCalls).toBe(1)
    expect(messages.map(m => m.id)).toEqual(detail.messages.map(m => m.id))
    expect(messages[1]).toMatchObject(finalMessage)
    expect(messages[2]).toBe(nextUser)

    const once = JSON.parse(JSON.stringify(messages))
    sandbox.applyStreamEvent({ type, message: finalMessage }, 'removed-resume-placeholder', '', detail.id)
    expect(messages).toEqual(once)
    sandbox.activeSidRef.current = 'another-session'
    sandbox.applyStreamEvent({ type, message: { ...finalMessage, content: 'Late event' } }, finalMessage.id, '', detail.id)
    expect(messages).toEqual(once)
  } finally {
    refreshGate.resolve()
    await tick()
  }
}

describe('concurrent session snapshots and completed stream replay', () => {
  test.each(['done', 'error'])('%s replay merges into history before any detail refresh', type => replayRace({ type }))
  test('does not depend on a fresh messagesRef', () => replayRace({ mirror: false }))
  test('also merges when detail resolves before the older running state', () => replayRace({ stateFirst: false }))
})
