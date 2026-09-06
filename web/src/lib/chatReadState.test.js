import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatReadKey, createReadDwell, initializeChatReadBaseline, isChatResultUnread, markChatResultRead, isChatResultVisible } from './chatReadState.js'

const result = { id: 'a', revision: 'v1' }
const session = { id: 's', result }
const memoryStorage = () => {
  const map = new Map()
  return { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value), map }
}

test('read state persists per instance, session and result revision, without stale-tab clobbering', () => {
  const storage = memoryStorage()
  assert.equal(isChatResultUnread(session, 'i', storage), true)
  assert.equal(isChatResultUnread({ ...session, running: true }, 'i', storage), false)
  assert.equal(markChatResultRead('i', 's', result, storage), true)
  const persisted = [...storage.map]
  assert.equal(markChatResultRead('i', 's', result, storage), false)
  assert.deepEqual([...storage.map], persisted)
  assert.equal(isChatResultUnread({ ...session, title: 'rename', pinned: true }, 'i', storage), false)
  assert.equal(isChatResultUnread(session, 'other', storage), true)
  assert.equal(isChatResultUnread({ ...session, id: 'other' }, 'i', storage), true)
  const next = { ...session, result: { ...result, revision: 'v2' } }
  assert.equal(isChatResultUnread(next, 'i', storage), true)
  markChatResultRead('i', 's', next.result, storage)
  markChatResultRead('i', 's', result, storage)
  assert.equal(isChatResultUnread(next, 'i', storage), false)
  assert.equal(chatReadKey('i', '', result), '')
  assert.equal(isChatResultUnread({ id: 's' }, 'i', storage), false)
})

test('first successful list baselines only historical completed replies, once per instance', () => {
  const storage = memoryStorage()
  const active = { id: 'active', result, running: true }
  const next = { ...session, result: { ...result, revision: 'v2' } }
  assert.equal(initializeChatReadBaseline('i', undefined, storage), false)
  assert.equal(initializeChatReadBaseline('i', [session, active, { id: 'empty' }], storage), true)
  assert.equal(isChatResultUnread(session, 'i', storage), false)
  assert.equal(storage.getItem(chatReadKey('i', 's', result)), undefined)
  assert.equal(isChatResultUnread({ ...active, running: false }, 'i', storage), true)
  assert.equal(isChatResultUnread(next, 'i', storage), true)
  assert.equal(isChatResultUnread({ ...session, id: 'new' }, 'i', storage), true)
  const persisted = [...storage.map]
  assert.equal(initializeChatReadBaseline('i', [next], storage), false)
  assert.deepEqual([...storage.map], persisted)
  assert.equal(isChatResultUnread(next, 'i', storage), true)
  assert.equal(isChatResultUnread(session, 'other', storage), true)
  assert.equal(initializeChatReadBaseline('other', [session], storage), true)
  assert.equal(isChatResultUnread(session, 'other', storage), false)
})

test('failure baseline migration preserves unread successes and only consumes historical failures once', () => {
  const storage = memoryStorage()
  storage.setItem('ga.chat.read.baseline.v1:' + JSON.stringify('i'), JSON.stringify([chatReadKey('i', session.id, result)]))
  const success = { ...session, taskbar_state: 'completed', result: { ...result, revision: 'v2' } }
  const failure = { id: 'failed', taskbar_state: 'failed', result }
  const active = { ...failure, id: 'active', running: true }
  assert.equal(initializeChatReadBaseline('i', [success, failure, active], storage), true)
  assert.equal(isChatResultUnread(success, 'i', storage), true)
  assert.equal(isChatResultUnread(failure, 'i', storage), false)
  assert.equal(isChatResultUnread({ ...active, running: false }, 'i', storage), true)
  const nextFailure = { ...failure, result: { ...result, revision: 'v2' } }
  const persisted = [...storage.map]
  assert.equal(initializeChatReadBaseline('i', [success, nextFailure], storage), false)
  assert.deepEqual([...storage.map], persisted)
  assert.equal(isChatResultUnread(nextFailure, 'i', storage), true)
  assert.equal(isChatResultUnread(failure, 'other', storage), true)
  const reloaded = { getItem: storage.getItem, setItem: storage.setItem }
  assert.equal(isChatResultUnread(failure, 'i', reloaded), false)
  assert.equal(isChatResultUnread(nextFailure, 'i', reloaded), true)
})

test('empty successful list completes initialization; later replies stay unread after reload', () => {
  const storage = memoryStorage()
  initializeChatReadBaseline('i', [], storage)
  const reloaded = { getItem: storage.getItem, setItem: storage.setItem }
  const persisted = [...storage.map]
  assert.equal(initializeChatReadBaseline('i', [session], reloaded), false)
  assert.deepEqual([...storage.map], persisted)
  assert.equal(isChatResultUnread(session, 'i', reloaded), true)
})

test('baseline survives reload and synchronizes across storage wrappers without clobbering read records', () => {
  const storage = memoryStorage()
  const otherTab = { getItem: storage.getItem, setItem: storage.setItem }
  assert.equal(isChatResultUnread(session, 'i', otherTab), true)
  markChatResultRead('i', 'another', result, storage)
  initializeChatReadBaseline('i', [session], storage)
  assert.equal(isChatResultUnread(session, 'i', otherTab), false)
  assert.equal(isChatResultUnread({ ...session, id: 'another' }, 'i', otherTab), false)
  const persisted = [...storage.map]
  assert.equal(initializeChatReadBaseline('i', [], otherTab), false)
  assert.deepEqual([...storage.map], persisted)
})

test('blocked baseline storage falls back for this page without swallowing subsequent replies', () => {
  const storage = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } }
  assert.equal(initializeChatReadBaseline('i', [session], storage), true)
  assert.equal(isChatResultUnread(session, 'i', storage), false)
  const next = { ...session, result: { ...result, revision: 'v2' } }
  assert.equal(initializeChatReadBaseline('i', [next], storage), false)
  assert.equal(isChatResultUnread(next, 'i', storage), true)
})

test('blocked storage degrades without breaking chat', () => {
  const storage = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } }
  assert.equal(isChatResultUnread(session, 'i', storage), true)
  assert.doesNotThrow(() => markChatResultRead('i', 's', result, storage))
})

test('reading needs one uninterrupted second and marks only once', () => {
  let calls = 0
  const tick = createReadDwell(() => calls++)
  tick(true, 0); tick(true, 999)
  assert.equal(calls, 0)
  tick(false, 999); tick(true, 1500); tick(true, 2499)
  assert.equal(calls, 0)
  tick(true, 2500); tick(true, 3500)
  assert.equal(calls, 1)
})

test('visibility requires focus, latest reply end in viewport and no covering layer', () => {
  let rect = { top: -500, bottom: 300, height: 800, left: 0, right: 500 }
  const node = { dataset: { id: 'a' }, getClientRects: () => [rect], getBoundingClientRect: () => rect, contains: hit => hit === node }
  const thread = { querySelectorAll: () => [node], getBoundingClientRect: () => ({ top: 0, bottom: 400, left: 0, right: 500 }) }
  const doc = { visibilityState: 'visible', hasFocus: () => true, documentElement: { clientHeight: 500 }, elementFromPoint: () => node }
  assert.equal(isChatResultVisible(thread, result, doc), true)
  assert.equal(isChatResultVisible(thread, { id: 'new' }, doc), false)
  assert.equal(isChatResultVisible(thread, result, { ...doc, hasFocus: () => false }), false)
  assert.equal(isChatResultVisible(thread, result, { ...doc, visibilityState: 'hidden' }), false)
  assert.equal(isChatResultVisible(thread, result, { ...doc, elementFromPoint: () => ({}) }), false)
  rect = { ...rect, bottom: 700 }
  assert.equal(isChatResultVisible(thread, result, doc), false)
  rect = { ...rect, bottom: -1 }
  assert.equal(isChatResultVisible(thread, result, doc), false)
})
