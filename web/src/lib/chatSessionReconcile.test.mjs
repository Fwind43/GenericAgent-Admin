import test from 'node:test'
import assert from 'node:assert/strict'
import {
  equalSessionSummaryValue,
  reconcileScalarList,
  reconcileSessionSummaries,
} from './chatSessionReconcile.js'

test('equalSessionSummaryValue compares nested JSON-like summaries', () => {
  assert.equal(equalSessionSummaryValue(
    { id:'a', running:false, loop:{ enabled:true, round:2 }, tags:['one'] },
    { id:'a', running:false, loop:{ enabled:true, round:2 }, tags:['one'] },
  ), true)
  assert.equal(equalSessionSummaryValue(
    { id:'a', loop:{ round:2 } },
    { id:'a', loop:{ round:3 } },
  ), false)
})

test('reconcileSessionSummaries reuses the array and rows when a refresh is unchanged', () => {
  const first = { id:'a', title:'Alpha', running:false, loop:{ enabled:false } }
  const second = { id:'b', title:'Beta', pinned:true }
  const previous = [first, second]
  const result = reconcileSessionSummaries(previous, [
    { id:'a', title:'Alpha', running:false, loop:{ enabled:false } },
    { id:'b', title:'Beta', pinned:true },
  ])

  assert.equal(result, previous)
  assert.equal(result[0], first)
  assert.equal(result[1], second)
})

test('reconcileSessionSummaries only replaces changed rows and preserves server order', () => {
  const first = { id:'a', title:'Alpha', running:false }
  const second = { id:'b', title:'Beta', running:false }
  const result = reconcileSessionSummaries([first, second], [
    { id:'b', title:'Beta', running:false },
    { id:'a', title:'Alpha', running:true },
  ])

  assert.notEqual(result, [first, second])
  assert.equal(result[0], second)
  assert.notEqual(result[1], first)
  assert.equal(result[1].running, true)
})

test('reconcileScalarList preserves equal project list references', () => {
  const previous = ['pinned', 'archive']
  assert.equal(reconcileScalarList(previous, ['pinned', 'archive']), previous)
  assert.deepEqual(reconcileScalarList(previous, ['archive', 'pinned']), ['archive', 'pinned'])
})
