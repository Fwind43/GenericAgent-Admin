import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, test } from 'vitest'
import { reconcileHistoryPage } from './lib/chatHistoryPages.js'

const source = readFileSync('src/ChatApp.jsx', 'utf8').replace(/\r\n/g, '\n')
const between = (start, end) => {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a)
  if (a < 0 || b <= a) throw new Error(`Missing source boundary: ${start}`)
  return source.slice(a, b)
}
const functions = [
  between('  const runSend = async', '  const selectWorldlineRestoreNode'),
  between('  const refreshCompletedRun = async', '  const refreshActiveSessionSnapshot'),
  between('  const loadChatState = async', '  const openSession = async'),
].join('\n')
const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function harness() {
  const gates = { stream: deferred(), list: deferred(), detail: deferred(), state: deferred() }
  const calls = []
  const noop = () => {}
  const sandbox = {
    Date, AbortController, Array, Promise,
    sid: 'selected', llmNo: 0, reasoningEffort: '', streamingSid: 'selected', contextOpen: true,
    guidingQueueRef: { current: '' }, runSeqRef: { current: 0 }, openSeqRef: { current: 1 },
    streamActivitySeqRef: { current: 0 }, streamAbortRef: { current: null },
    activeRunRef: { current: false }, activeSidRef: { current: 'selected' },
    autorunLastReplyAtRef: { current: 0 }, chatInstanceRef: { current: '' },
    isActiveSession: id => sandbox.activeSidRef.current === id,
    buildChatRunPayload: value => value, chatFetch: async () => ({ ok: true }),
    followChatStream: () => gates.stream.promise,
    loadSessions: () => { calls.push(['list']); return gates.list.promise },
    chatApi: url => { calls.push(['api', url]); return url.includes('/state/') ? gates.state.promise : gates.detail.promise },
    addChatInstanceToURL: url => url, normalizeReasoningEffort: value => value || '',
    applyQueueSnapshot: value => calls.push(['queue', value]),
    shouldPollGeneratedTitle: () => false, loadWorldline: async () => {},
    attachRunningStream: id => calls.push(['attach', id]),
    openSession: () => { throw new Error('Completion must not reopen the session') },
    messages: [{ id: 'history', role: 'assistant', content: 'Earlier answer' }],
  }
  for (const name of new Set(functions.match(/\bset[A-Z]\w+/g))) sandbox[name] = value => calls.push([name, value])
  sandbox.setSessions = noop
  sandbox.setMessages = value => {
    sandbox.messages = typeof value === 'function' ? value(sandbox.messages) : value
    calls.push(['messages', sandbox.messages])
  }
  sandbox.historyPages = { apply: data => sandbox.setMessages(reconcileHistoryPage(data, { messages: sandbox.messages }).messages) }
  vm.createContext(sandbox)
  vm.runInContext(`${functions}\nglobalThis.runSend = runSend; globalThis.loadChatState = loadChatState`, sandbox)
  const snapshot = { id: 'selected', messages: [{ id: 'final', role: 'assistant', content: 'Final answer' }], queued_messages: [], plan: { steps: [] } }
  const finish = async () => {
    gates.stream.resolve(null)
    await tick()
  }
  const resolve = async () => {
    gates.list.resolve([])
    gates.detail.resolve(snapshot)
    gates.state.resolve({ running: false, settings: {}, llms: [] })
    await tick()
  }
  return { sandbox, calls, gates, snapshot, finish, resolve }
}

describe('post-run in-place refresh', () => {
  test('keeps the rendered history and draft intact while reloading authoritative state', async () => {
    const h = harness()
    const sending = h.sandbox.runSend({ text: 'Question' })
    await tick()
    await h.finish()
    expect(h.sandbox.activeRunRef.current).toBe(false)
    expect(h.sandbox.streamAbortRef.current).toBe(null)
    expect(h.sandbox.messages).toHaveLength(3)
    h.calls.length = 0
    h.gates.list.resolve([])
    await tick()
    expect(h.calls.filter(([name]) => name === 'api')).toHaveLength(2)
    expect(h.sandbox.messages).toHaveLength(3)
    await h.resolve()
    await sending
    expect(h.sandbox.messages).toEqual(h.snapshot.messages)
    expect(h.calls.filter(([name]) => /setSessionPrompt|setAutoFollow|setShowFollow|setSid|setSessionLoading/.test(name))).toEqual([])
    expect(h.calls.filter(([name, value]) => name === 'messages' && value.length === 0)).toEqual([])
    expect(h.calls.some(([name]) => name === 'setLlms')).toBe(true)
    expect(h.calls.some(([name]) => name === 'setPlanState')).toBe(true)
  })

  for (const stage of ['list', 'detail']) {
    for (const change of ['next run', 'session switch', 'stream reattach']) {
      test(`discards ${stage} refresh after ${change}`, async () => {
        const h = harness()
        const sending = h.sandbox.runSend({ text: 'Question' })
        await tick()
        await h.finish()
        if (stage === 'detail') { h.gates.list.resolve([]); await tick() }
        if (change === 'next run') { h.sandbox.runSeqRef.current++; h.sandbox.streamActivitySeqRef.current++ }
        if (change === 'session switch') { h.sandbox.openSeqRef.current++; h.sandbox.activeSidRef.current = 'other' }
        if (change === 'stream reattach') h.sandbox.streamActivitySeqRef.current++
        const nextController = new AbortController()
        h.sandbox.streamAbortRef.current = nextController
        const currentMessages = h.sandbox.messages
        h.calls.length = 0
        await h.resolve()
        await sending
        expect(h.sandbox.messages).toBe(currentMessages)
        expect(nextController.signal.aborted).toBe(false)
        expect(h.sandbox.streamAbortRef.current).toBe(nextController)
        expect(h.calls.filter(([name]) => name !== 'api')).toEqual([])
        if (stage === 'list') expect(h.calls).toEqual([])
      })
    }
  }

  test('rechecks run ownership after awaiting prefetched state', async () => {
    const h = harness()
    let current = true
    const loading = h.sandbox.loadChatState('selected', 1, h.gates.state.promise, () => current)
    current = false
    h.gates.state.resolve({ error: new Error('stale error') })
    expect(await loading).toBe(null)
    expect(h.calls).toEqual([])
  })
})
