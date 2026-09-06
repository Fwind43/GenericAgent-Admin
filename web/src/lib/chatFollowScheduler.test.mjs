import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createThreadFollowScheduler } from './chatFollowScheduler.js'

function fixture() {
  const frames = new Map()
  const calls = []
  let id = 0
  let following = true
  let thread = {
    scrollHeight: 1000, clientHeight: 400, scrollTop: 200,
    scrollTo(options) { calls.push(options); this.scrollTop = options.top - this.clientHeight },
  }
  const scheduler = createThreadFollowScheduler({
    getThread: () => thread,
    isFollowing: () => following,
    onScroll: () => calls.push('marked'),
    schedule: cb => { frames.set(++id, cb); return id },
    cancel: key => frames.delete(key),
  })
  return {
    scheduler, frames, calls,
    get thread() { return thread },
    set following(value) { following = value },
    replaceThread() { thread = { ...thread } },
    flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb()) },
  }
}

test('commit and resize requests coalesce and read the latest height', () => {
  const f = fixture()
  f.scheduler.request()
  f.scheduler.request()
  assert.equal(f.frames.size, 1)
  f.thread.scrollHeight = 1400
  f.flush()
  assert.deepEqual(f.calls, [{ top: 1400, behavior: 'auto' }, 'marked'])
  f.scheduler.request()
  f.flush()
  assert.equal(f.calls.length, 2, 'an already aligned thread is not scrolled again')
})

test('a reader gesture after scheduling prevents the queued scroll', () => {
  const f = fixture()
  f.scheduler.request()
  f.following = false
  f.flush()
  assert.deepEqual(f.calls, [])
  f.scheduler.request()
  assert.equal(f.frames.size, 0)
})

test('cancel drops requests on session changes and unmount', () => {
  const f = fixture()
  f.scheduler.request('smooth')
  f.scheduler.cancel()
  f.flush()
  assert.deepEqual(f.calls, [])
  f.scheduler.request()
  f.flush()
  assert.equal(f.calls[0].behavior, 'auto')
})

test('a replaced thread never receives an old request', () => {
  const f = fixture()
  f.scheduler.request()
  f.replaceThread()
  f.flush()
  assert.deepEqual(f.calls, [])
})

test('smooth intent survives an automatic resize request in the same frame', () => {
  const f = fixture()
  f.scheduler.request('smooth')
  f.scheduler.request()
  f.flush()
  assert.equal(f.calls[0].behavior, 'smooth')
})
