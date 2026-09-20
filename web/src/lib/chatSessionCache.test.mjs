import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatSessionCache } from './chatSessionCache.js'

const response = (data, etag = '"v1"', status = 200) => new Response(status === 304 ? null : JSON.stringify(data), { status, headers: etag ? { ETag: etag } : {} })
const detail = { id: 'a', messages: [{ id: 'm', content: 'original' }] }

test('validates repeated visits and clones cached snapshots away from stream mutations', async () => {
  const cache = createChatSessionCache()
  let calls = 0
  const fetcher = async (_, options) => {
    calls++
    assert.equal(options.cache, 'no-store')
    assert.equal(options.headers['If-None-Match'], calls === 1 ? undefined : '"v1"')
    return calls === 1 ? response(detail) : response(null, '"v1"', 304)
  }
  const first = await cache.load('/a?ga_instance=x', { fetcher })
  first.messages[0].content = 'stream update'
  const second = await cache.load('/a?ga_instance=x', { fetcher })
  assert.deepEqual(second, detail)
  second.messages.push({ id: 'duplicate' })
  assert.deepEqual(await cache.load('/a?ga_instance=x', { fetcher }), detail)
  assert.equal(calls, 3)
})

test('changed ETag replaces all data including an empty history', async () => {
  const cache = createChatSessionCache()
  await cache.load('/a', { fetcher: async () => response(detail) })
  const empty = { id: 'a', messages: [] }
  assert.deepEqual(await cache.load('/a', { fetcher: async () => response(empty, '"v2"') }), empty)
  assert.deepEqual(await cache.load('/a', { fetcher: async (_, opts) => {
    assert.equal(opts.headers['If-None-Match'], '"v2"')
    return response(null, '"v2"', 304)
  } }), empty)
})

test('instance URLs are isolated and clear removes validators', async () => {
  const cache = createChatSessionCache()
  const cold = async (_, options) => {
    assert.equal(options.headers['If-None-Match'], undefined)
    return response(detail)
  }
  await cache.load('/a?ga_instance=x', { fetcher: cold })
  await cache.load('/a?ga_instance=y', { fetcher: cold })
  cache.clear()
  await cache.load('/a?ga_instance=x', { fetcher: cold })
})

test('LRU entry and byte budgets evict, including oversized uncached snapshots', async () => {
  for (const limits of [{ maxEntries: 1 }, { maxBytes: JSON.stringify(detail).length * 2 }]) {
    const cache = createChatSessionCache(limits)
    await cache.load('/a', { fetcher: async () => response(detail) })
    await cache.load('/b', { fetcher: async () => response(detail) })
    await cache.load('/a', { fetcher: async (_, options) => {
      assert.equal(options.headers['If-None-Match'], undefined)
      return response(detail)
    } })
  }
  const cache = createChatSessionCache({ maxBytes: 1 })
  for (let i = 0; i < 2; i++) await cache.load('/a', { fetcher: async (_, options) => {
    assert.equal(options.headers['If-None-Match'], undefined)
    return response(detail)
  } })
})

test('aborted or cleared pending requests cannot repopulate the cache', async () => {
  for (const action of ['abort', 'clear']) {
    const cache = createChatSessionCache()
    const controller = new AbortController()
    let release
    const pending = cache.load('/a', { signal: controller.signal, fetcher: () => new Promise(resolve => { release = resolve }) })
    if (action === 'abort') controller.abort()
    else cache.clear()
    release(response(detail))
    await assert.rejects(pending, { name: 'AbortError' })
    await cache.load('/a', { fetcher: async (_, options) => {
      assert.equal(options.headers['If-None-Match'], undefined)
      return response(detail)
    } })
  }
})

test('HTTP failures surface normally and old servers without ETag stay compatible', async () => {
  const cache = createChatSessionCache()
  await assert.rejects(cache.load('/a', { fetcher: async () => response({ error: 'denied' }, '', 403) }), /denied/)
  for (let i = 0; i < 2; i++) assert.deepEqual(await cache.load('/a', { fetcher: async (_, options) => {
    assert.deepEqual(options.headers, {})
    return response(detail, '')
  } }), detail)
})

test('cached loads need no structured clone, preserve empty bodies and recover after failures', async () => {
  const original = globalThis.structuredClone
  globalThis.structuredClone = () => { throw new Error('unexpected clone') }
  try {
    const cache = createChatSessionCache()
    const first = await cache.load('/a', { fetcher: async () => response(detail) })
    first.messages[0].content = 'mutated'
    await assert.rejects(cache.load('/a', { fetcher: async () => { throw new Error('offline') } }), /offline/)
    assert.deepEqual(await cache.load('/a', { fetcher: async () => response(null, '"v1"', 304) }), detail)
    assert.equal(await cache.load('/empty', { fetcher: async () => new Response('', { headers: { ETag: '"empty"' } }) }), null)
    assert.equal(await cache.load('/empty', { fetcher: async () => response(null, '"empty"', 304) }), null)
  } finally {
    globalThis.structuredClone = original
  }
})

test('newer same-URL request supersedes delayed headers and body without stale writes', async () => {
  for (const phase of ['headers', 'body', '304']) {
    const cache = createChatSessionCache()
    await cache.load('/a', { fetcher: async () => response(detail) })
    let release
    const gate = new Promise(resolve => { release = resolve })
    const old = cache.load('/a', { fetcher: async () => {
      if (phase !== 'body') await gate
      if (phase === '304') return response(null, '"v1"', 304)
      const res = response(detail)
      if (phase === 'body') res.text = async () => { await gate; return JSON.stringify(detail) }
      return res
    } })
    await Promise.resolve()
    const fresh = { id: 'a', messages: [{ content: 'new', files: [{ name: 'safe' }] }] }
    const view = await cache.load('/a', { fetcher: async () => response(fresh, '"v2"') })
    view.messages[0].files[0].name = 'mutated'
    release()
    await assert.rejects(old, { name: 'AbortError' })
    assert.deepEqual(await cache.load('/a', { fetcher: async (_, options) => {
      assert.equal(options.headers['If-None-Match'], '"v2"')
      return response(null, '"v2"', 304)
    } }), fresh)
  }
})

test('different URLs remain independent and a failed newer request still supersedes old work', async () => {
  const cache = createChatSessionCache()
  let release
  const old = cache.load('/a', { fetcher: () => new Promise(resolve => { release = resolve }) })
  assert.deepEqual(await cache.load('/b', { fetcher: async () => response(detail) }), detail)
  await assert.rejects(cache.load('/a', { fetcher: async () => { throw new Error('offline') } }), /offline/)
  release(response(detail))
  await assert.rejects(old, { name: 'AbortError' })
  await cache.load('/a', { fetcher: async (_, options) => {
    assert.deepEqual(options.headers, {})
    return response(detail)
  } })
})
