import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileHistoryPage, createHistoryPageCache, historyStatsMessages } from './chatHistoryPages.js'

const message = id => ({ id, content_revision: id, content: id })
const index = ids => ids.map(id => ({ id, revision: id }))

test('reuses only a contiguous revision-checked history suffix', () => {
  const previous = { messages: ['b', 'c', 'd'].map(message), message_index: index(['a', 'b', 'c', 'd']), before: 'old', has_more: true }
  const latest = { messages: ['d', 'e'].map(message), message_index: index(['a', 'b', 'c', 'd', 'e']), before: 'new', has_more: true }
  const merged = reconcileHistoryPage(latest, previous)
  assert.deepEqual(merged.messages.map(m => m.id), ['b', 'c', 'd', 'e'])
  assert.equal(merged.before, 'old')
  for (const changed of ['a', 'b']) {
    const updated = { ...latest, message_index: latest.message_index.map(m => m.id === changed ? { ...m, revision: 'changed' } : m) }
    assert.deepEqual(reconcileHistoryPage(updated, previous).messages, latest.messages)
  }
  assert.deepEqual(reconcileHistoryPage(latest, { ...previous, messages: [message('b'), message('d')] }).messages, latest.messages)
})

test('latest complete messages are authoritative and empty history clears cached bodies', () => {
  const full = { ...message('a'), content: 'full', outputs: ['output'] }
  const latest = { messages: [full], message_index: index(['a']) }
  assert.equal(reconcileHistoryPage(latest, { messages: [{ ...full, content: 'cached' }] }).messages[0], full)
  assert.equal(reconcileHistoryPage(latest, { messages: [{ ...full, content_revision: 'old' }] }).messages[0], full)
  assert.deepEqual(reconcileHistoryPage({ messages: [] }, { messages: [full] }), { messages: [] })
})

test('snapshot refresh preserves only the mounted render key, not stale message data', () => {
  const previous = { messages: [{ ...message('a'), render_key: 'pending-a', content: 'streamed', usage: 123 }] }
  for (const paged of [false, true]) {
    const latest = { messages: [{ ...message('a'), content: 'authoritative' }, message('b')] }
    if (paged) latest.message_index = index(['a', 'b'])
    const merged = reconcileHistoryPage(latest, previous)
    assert.deepEqual(merged.messages[0], { ...latest.messages[0], render_key: 'pending-a' })
    assert.equal(merged.messages[1], latest.messages[1])
    assert.equal(latest.messages[0].render_key, undefined)
    assert.deepEqual(reconcileHistoryPage(latest, merged), merged)
  }
})

test('page cache enforces LRU entry and byte budgets with instance isolation', () => {
  const cache = createHistoryPageCache({ maxEntries: 2, maxBytes: 200 })
  cache.put('one:a', { value: 1 }); cache.put('two:a', { value: 2 })
  assert.equal(cache.get('one:a').value, 1)
  cache.put('one:b', { value: 3 })
  assert.equal(cache.get('two:a'), null)
  cache.put('large', { value: 'x'.repeat(200) })
  assert.equal(cache.get('large'), null)
  cache.put('one:a', { value: 'x'.repeat(70) })
  cache.put('one:c', { value: 'x'.repeat(30) })
  assert.equal(cache.get('one:a'), null)
  cache.clear()
  assert.equal(cache.get('one:c'), null)
})

test('full-history statistics include older turns while live values override', () => {
  const combined = historyStatsMessages([{ id: 'a', usage: 1 }, { id: 'b', usage: 2 }], [{ id: 'b', usage: 3 }, { id: 'c', usage: 4 }])
  assert.deepEqual(combined.map(m => m.usage), [1, 3, 4])
})
