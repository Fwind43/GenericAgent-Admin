import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers'
import { aggregateChatTaskbarState, shouldRefreshChatTaskbar, chatTaskbarState, hasPendingTaskbarQuestion, publishTaskbarState, waitingChatSessions } from './chatTaskbar.js'

test('taskbar shows only unread results regardless of workflow status', () => {
  const sessions = [
    { id: 'running', running: true, taskbar_state: 'running' },
    { id: 'done1', taskbar_state: 'completed' },
    { id: 'done2', taskbar_state: 'completed' },
    { id: 'error', taskbar_state: 'failed' },
    { id: 'question', taskbar_state: 'waiting' },
  ]
  const aggregate = (ids, extra = {}) => aggregateChatTaskbarState({ sessions, unread: new Set(ids), ...extra })
  for (const session of sessions) {
    assert.equal(aggregate([session.id]), 'unread', session.taskbar_state)
  }
  assert.equal(aggregate(['done1', 'done2']), 'unread')
  assert.equal(aggregate(['done2']), 'unread')
  assert.equal(aggregate([]), 'idle')
  assert.equal(aggregate(['done1'], { sessions: [] }), 'idle')
  assert.equal(aggregate([], { sid: 'new', liveRunning: true, liveState: 'waiting' }), 'idle')
  assert.equal(aggregate([], { sid: 'new', liveRunning: true, liveState: 'running' }), 'idle')
  assert.equal(aggregateChatTaskbarState({}), 'idle')
})

test('waiting navigation stays independent of unread taskbar and project filters', () => {
  const sessions = [
    { id: 'archived', taskbar_state: 'waiting', project_mode: 'Folded project' },
    { id: 'live', taskbar_state: 'waiting' },
    { id: 'done', taskbar_state: 'completed' },
  ]
  const options = { sessions, sid: 'live', liveRunning: true, liveState: 'running' }
  assert.deepEqual(waitingChatSessions(options).map(session => session.id), ['archived'])
  assert.equal(aggregateChatTaskbarState(options), 'idle')
  assert.deepEqual(waitingChatSessions({ sessions, sid: 'archived' }).map(session => session.id), ['archived', 'live'])
  assert.deepEqual(waitingChatSessions({ sessions: [], sid: 'new', liveRunning: true, liveState: 'waiting' }), [{ id: 'new' }])
  assert.deepEqual(waitingChatSessions({ sessions: [sessions[2]] }), [])
})

test('native minimized windows keep polling; ordinary hidden tabs do not', () => {
  assert.equal(shouldRefreshChatTaskbar({ hidden: true }, {}), false)
  assert.equal(shouldRefreshChatTaskbar({ hidden: true }, { __gaTaskbarState() {} }), true)
  assert.equal(shouldRefreshChatTaskbar({ hidden: false }, {}), true)
})

const assistant = (content, extra = {}) => ({ role: 'assistant', content, ...extra })
const user = { role: 'user', id: 'u1', content: 'hello' }
const state = (extra = {}) => chatTaskbarState({ sid: 's1', messages: [user], ...extra })
const ask = (name = 'ask_user') => '\u{1F6E0}\uFE0F Tool: `' + name + '`\n```text\n{"question":"Choose?"}\n```'
const result = (text) => '\n\n`````\n' + text + '\n`````'

test('idle without a session, while loading, or with an empty assistant', () => {
  assert.equal(state(), 'idle')
  assert.equal(state({ sid: '', running: true }), 'idle')
  assert.equal(state({ loading: true, running: true }), 'idle')
  assert.equal(state({ messages: [user, assistant('')] }), 'idle')
})

test('running takes precedence over a previous error or answer', () => {
  assert.equal(state({ running: true, error: 'previous error' }), 'running')
  assert.equal(state({ running: true, messages: [user, assistant('old answer')] }), 'running')
})

test('completed content and files, and explicit errors', () => {
  assert.equal(state({ messages: [assistant('done')] }), 'completed')
  assert.equal(state({ messages: [assistant('', { files: [{ name: 'report.pdf' }] })] }), 'completed')
  assert.equal(state({ messages: [assistant('', { structured_content: [{ type: 'text', text: 'done' }] })] }), 'completed')
  assert.equal(state({ error: 'network failed' }), 'failed')
  assert.equal(state({ messages: [assistant('failed', { error: 'failure' })] }), 'failed')
})

test('stopped runs clear the badge, while a new run resumes it', () => {
  assert.equal(state({ stopped: true, running: true }), 'idle')
  for (const text of ['Stopped.', '\u5df2\u4e2d\u6b62\u3002']) {
    assert.equal(state({ messages: [assistant(text)] }), 'idle')
  }
  assert.equal(state({ stopped: false, running: true }), 'running')
})

test('pending text ask is waiting, but ordinary questions are not', () => {
  const messages = [user, assistant(ask())]
  assert.equal(state({ messages, running: true }), 'waiting')
  assert.equal(state({ messages }), 'waiting')
  assert.equal(state({ messages: [assistant('Would you like a summary?')] }), 'completed')
  assert.equal(state({ messages: [assistant('Example: ask_user')] }), 'completed')
  assert.equal(state({ messages: [...messages, { ...user, id: 'u2' }], running: true }), 'running')
  assert.equal(state({ messages, error: 'failed' }), 'failed')
})

test('text asks support qualified tool names and waiting results', () => {
  assert.equal(hasPendingTaskbarQuestion(assistant(ask('functions.ask_user'))), true)
  assert.equal(hasPendingTaskbarQuestion(assistant(ask() + result('Waiting for user input'))), true)
  assert.equal(hasPendingTaskbarQuestion(assistant(ask() + result('User selected option A'))), false)
  assert.equal(hasPendingTaskbarQuestion(assistant(ask() + '\n\nFinal answer')), false)
})

test('structured asks pair results by tool id and ignore old asks', () => {
  const call = { type: 'tool_use', id: 'q1', name: 'ask_user', input: { question: 'Choose?' } }
  const pending = (blocks) => hasPendingTaskbarQuestion(assistant('', { structured_content: blocks }))
  assert.equal(pending([call]), true)
  assert.equal(pending([{ ...call, name: 'functions.ask_user' }]), true)
  assert.equal(pending([call, { type: 'tool_result', tool_use_id: 'q2', content: 'answered' }]), true)
  assert.equal(pending([call, { type: 'tool_result', tool_use_id: 'q1', content: [{ type: 'text', text: 'Waiting for user reply' }] }]), true)
  assert.equal(pending([call, { type: 'tool_result', tool_use_id: 'q1', content: 'answered' }]), false)
  assert.equal(pending([call, { type: 'text', text: 'Finished' }]), false)
  assert.equal(pending([call, { type: 'tool_use', id: 'q2', name: 'file_read' }]), false)
})

test('native publishing is optional and tolerates sync and async errors', async () => {
  const received = []
  publishTaskbarState('running', { __gaTaskbarState: (value) => received.push(value) })
  assert.deepEqual(received, ['running'])
  assert.doesNotThrow(() => publishTaskbarState('idle', {}))
  assert.doesNotThrow(() => publishTaskbarState('idle', null))
  assert.doesNotThrow(() => publishTaskbarState('idle', { __gaTaskbarState() { throw new Error('closed') } }))
  publishTaskbarState('idle', { __gaTaskbarState: () => Promise.reject(new Error('closed')) })
  await new Promise(resolve => setImmediate(resolve))
})
