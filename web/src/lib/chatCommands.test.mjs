import test from 'node:test'
import assert from 'node:assert/strict'
import { commandResultSummary, parseImmediateChatCommand, isDangerousChatCommand, reduceCommandResult, requiresDangerousChatCommandConfirmation } from './chatCommands.js'

test('parses immediate commands including worldline without capturing resume', () => {
  assert.equal(parseImmediateChatCommand('/status')?.name, '/status')
  assert.equal(parseImmediateChatCommand('/scheduler')?.mode, 'list')
  assert.equal(parseImmediateChatCommand('/scheduler run api')?.mode, 'start')
  assert.equal(parseImmediateChatCommand('/resume'), null)
  assert.deepEqual(parseImmediateChatCommand('/worldline restore node-1 code before')?.fields, ['/worldline', 'restore', 'node-1', 'code', 'before'])
  assert.equal(parseImmediateChatCommand('/btw question'), null)
})

test('classifies only destructive/process mutations as dangerous', () => {
  for (const value of ['/rewind', '/rewind 2', '/clear', '/scheduler start api', '/scheduler run api']) assert.equal(isDangerousChatCommand(value), true, value)
  for (const value of ['/scheduler', '/scheduler list', '/export all', '/help', '/status', '/verbose']) assert.equal(isDangerousChatCommand(value), false, value)
})

test('binds dangerous approval to the exact normalized message text', () => {
  assert.equal(requiresDangerousChatCommandConfirmation('/clear'), true)
  assert.equal(requiresDangerousChatCommandConfirmation('  /clear  ', '/clear'), false)
  assert.equal(requiresDangerousChatCommandConfirmation('/rewind 2', '/rewind'), true)
  assert.equal(requiresDangerousChatCommandConfirmation('/status', ''), false)
})

test('reduces real backend command results without a leading slash', () => {
  assert.deepEqual(reduceCommandResult({ result:{ command:'rewind', prefill:'redo', session:{ id:'s' } } }), { commandResult:{ command:'rewind', prefill:'redo', session:{ id:'s' } }, prefill:'redo', session:{ id:'s' } })
  assert.equal(reduceCommandResult({ result:{ command:'clear', cleared:false } }).cleared, undefined)
  assert.deepEqual(reduceCommandResult({ result:{ command:'clear', cleared:true, session:{ id:'empty' } } }).session, { id:'empty' })
  assert.deepEqual(reduceCommandResult({ result:{ command:'export', content:'x', filename:'a.md', mime_type:'text/markdown' } }).download, { content:'x', filename:'a.md', mime:'text/markdown' })
  assert.deepEqual(reduceCommandResult({ result:{ command:'worldline', action:'restore', session:{ id:'restored' } } }).session, { id:'restored' })
})

test('localizes command result summaries without changing the Chinese default', () => {
  assert.equal(commandResultSummary({ command:'worldline', tree:{ nodes:[{}] } }), '1 个世界线节点')
  assert.equal(commandResultSummary({ command:'worldline', tree:{ nodes:[{}] } }, 'en'), '1 worldline node')
  assert.equal(commandResultSummary({ command:'clear', cleared:true }, 'en'), 'Current session cleared')
})
