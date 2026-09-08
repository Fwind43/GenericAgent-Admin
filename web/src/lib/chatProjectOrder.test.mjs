import test from 'node:test'
import assert from 'node:assert/strict'
import { groupProjectSessions, moveProjectOrder, readProjectOrder } from './chatProjectSessions.js'

test('manual order respects pins and appends new projects', () => {
  assert.deepEqual(groupProjectSessions(['a','b','c','d'], [], ['c'], ['b','a','c']).map(g => g.name), ['c','b','a','d'])
})
test('move stays inside pin partition and respects boundaries', () => {
  const groups = groupProjectSessions(['a','b','c'], [], ['c'])
  assert.deepEqual(moveProjectOrder(groups, 'b', -1), ['c','b','a'])
  assert.deepEqual(moveProjectOrder(groups, 'a', -1), ['c','a','b'])
  assert.deepEqual(moveProjectOrder(groups, 'c', 1), ['c','a','b'])
  assert.deepEqual(moveProjectOrder(groups, 'missing', 1), ['c','a','b'])
})
test('saved order restores and is instance scoped with safe corrupt fallback', () => {
  const values = new Map([['ga-chat-project-order:one', '["b","a"]']])
  const storage = { getItem: key => values.get(key) }
  assert.deepEqual(readProjectOrder('one', storage), ['b','a'])
  assert.deepEqual(readProjectOrder('two', storage), [])
  values.set('ga-chat-project-order:one', '{')
  assert.deepEqual(readProjectOrder('one', storage), [])
  assert.deepEqual(readProjectOrder('one', { getItem() { throw Error('blocked') } }), [])
})
