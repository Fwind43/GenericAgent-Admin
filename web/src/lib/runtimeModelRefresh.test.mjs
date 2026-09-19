import assert from 'node:assert/strict'
import { test } from 'node:test'
import { refreshRuntimeModels, runtimeStateUrl, selectRuntimeLlms } from './runtimeModelRefresh.js'

test('selectRuntimeLlms keeps the current pick while it still exists', () => {
  const picked = selectRuntimeLlms([{ index: 0 }, { index: 3 }], 3)
  assert.equal(picked.index, 3)
})

test('selectRuntimeLlms falls back to the first model when the saved one vanished', () => {
  assert.equal(selectRuntimeLlms([{ index: 5 }, { index: 7 }], 3).index, 5)
  assert.equal(selectRuntimeLlms([{ index: 5 }], 0).index, 5)
})

test('selectRuntimeLlms returns null for an empty or malformed runtime list', () => {
  assert.equal(selectRuntimeLlms([], 2), null)
  assert.equal(selectRuntimeLlms(null, 2), null)
})

test('refreshRuntimeModels fetches the active session state and pushes it into the composer', async () => {
  const seen = []
  const llms = [{ index: 0, model: 'claude' }, { index: 1, model: 'gpt' }]
  const result = await refreshRuntimeModels({
    sid: 'abc',
    fetchState: async url => { seen.push(url); return { llms } },
    setLlms: value => seen.push(['setLlms', value.length]),
    setLlmNo: updater => seen.push(['setLlmNo', updater(0)]),
  })
  assert.equal(result.length, 2)
  assert.deepEqual(seen, ['/api/chat/state/abc', ['setLlms', 2], ['setLlmNo', 0]])
})

test('refreshRuntimeModels leaves the composer alone when the runtime list is empty or the fetch fails', async () => {
  const seen = []
  const empty = await refreshRuntimeModels({ sid: '', fetchState: async () => ({ llms: [] }), setLlms: v => seen.push(v), setLlmNo: v => seen.push(v) })
  assert.equal(empty, null)
  const failed = await refreshRuntimeModels({ sid: '', fetchState: async () => { throw new Error('offline') }, setLlms: v => seen.push(v), setLlmNo: v => seen.push(v) })
  assert.equal(failed, null)
  assert.deepEqual(seen, [])
})

test('runtimeStateUrl targets the active session and falls back to the shared state', () => {
  assert.equal(runtimeStateUrl('abc'), '/api/chat/state/abc')
  assert.equal(runtimeStateUrl(''), '/api/chat/state')
  assert.equal(runtimeStateUrl(undefined), '/api/chat/state')
})

test('refreshRuntimeModels requests the shared state URL when no session is open', async () => {
  const seen = []
  await refreshRuntimeModels({
    sid: '',
    fetchState: async url => { seen.push(url); return { llms: [{ index: 1 }] } },
    setLlms: () => {},
    setLlmNo: updater => updater(0),
  })
  assert.deepEqual(seen, ['/api/chat/state'])
})
