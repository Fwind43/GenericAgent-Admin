import test from 'node:test'
import assert from 'node:assert/strict'
import { createStreamDeltaBatcher } from './chatStream.js'

const createClock = (options = {}) => {
  let time = 0
  let id = 0
  const frames = new Map()
  const chunks = []
  const batcher = createStreamDeltaBatcher({
    onFlush: chunk => chunks.push(chunk),
    now: () => time,
    schedule: callback => { frames.set(++id, callback); return id },
    cancel: handle => frames.delete(handle),
    ...options,
  })
  return {
    batcher, chunks, frames,
    tick(ms = 16) {
      time += ms
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback(time))
    },
  }
}

test('first small delta is visible on the next frame without a buffering delay', () => {
  const { batcher, chunks, tick, frames } = createClock()
  batcher.push('Hello')
  assert.equal(frames.size, 1)
  tick()
  assert.deepEqual(chunks, ['Hello'])
  assert.equal(frames.size, 0)
})

test('large bursts catch up in elapsed time regardless of refresh rate', async () => {
  const content = 'a'.repeat(20000)
  for (const hz of [30, 60, 120, 144]) {
    const { batcher, chunks, tick, frames } = createClock()
    batcher.push(content)
    const drained = batcher.drain()
    tick(1000 / hz)
    assert.ok(chunks[0].length > 0 && chunks[0].length < content.length)
    for (let elapsed = 1000 / hz; elapsed < 200; elapsed += 1000 / hz) tick(1000 / hz)
    assert.equal(chunks.join(''), content, `${hz}Hz`)
    assert.equal(frames.size, 0, `${hz}Hz`)
    await drained
  }
})

test('the same elapsed time reveals the same amount at different refresh rates', () => {
  const revealed = []
  for (const step of [8, 16, 32]) {
    const { batcher, chunks, tick } = createClock()
    batcher.push('a'.repeat(10000))
    for (let elapsed = 0; elapsed < 96; elapsed += step) tick(step)
    revealed.push(chunks.join('').length)
    batcher.flushNow()
  }
  assert.ok(Math.max(...revealed) - Math.min(...revealed) <= 12, revealed.join(', '))
})

test('steady arrivals keep moving and leave no long animation tail at EOF', async () => {
  const { batcher, chunks, tick, frames } = createClock()
  let expected = ''
  for (let i = 0; i < 100; i += 1) {
    const delta = `${i}:` + 'x'.repeat(300)
    expected += delta
    batcher.push(delta)
    const before = chunks.join('').length
    tick(16)
    assert.ok(chunks.join('').length > before)
  }
  const drained = batcher.drain()
  for (let i = 0; i < 10; i += 1) tick(16)
  await drained
  assert.equal(chunks.join(''), expected)
  assert.equal(frames.size, 0)
})

test('a delayed frame catches up instead of starting a new slow animation', async () => {
  const { batcher, chunks, tick, frames } = createClock()
  const content = 'late'.repeat(1000)
  batcher.push(content)
  const drained = batcher.drain()
  tick(1000)
  await drained
  assert.deepEqual(chunks, [content])
  assert.equal(frames.size, 0)
})

test('background and reduced-motion modes flush without scheduling an animation', async () => {
  const { batcher, chunks, frames } = createClock({ shouldAnimate: () => false })
  batcher.push('a'.repeat(10000))
  await batcher.drain()
  assert.equal(chunks.join('').length, 10000)
  assert.equal(frames.size, 0)
})

test('hiding with a frame queued resolves all drains even if rAF never fires', async () => {
  let visible = true
  const { batcher, chunks, frames } = createClock({ shouldAnimate: () => visible })
  batcher.push('a'.repeat(10000))
  const first = batcher.drain()
  visible = false
  const second = batcher.drain()
  await Promise.all([first, second])
  assert.equal(chunks.join('').length, 10000)
  assert.equal(frames.size, 0)
  batcher.flushNow()
  assert.equal(chunks.length, 1)
})

test('frame boundaries preserve complete emoji and combining character clusters', () => {
  const { batcher, chunks, tick, frames } = createClock()
  const cluster = '\u{1f469}\u200d\u{1f4bb}e\u0301\u{1f1e8}\u{1f1f3}'
  const content = cluster.repeat(100)
  const boundaries = new Set([0, ...Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(content), x => x.index + x.segment.length)])
  batcher.push(content)
  let length = 0
  while (frames.size) {
    tick(16)
    length = chunks.join('').length
    assert.ok(boundaries.has(length), `split at ${length}`)
  }
  assert.equal(chunks.join(''), content)
})

test('replayed content is immediate, and only subsequent live content is paced', () => {
  const { batcher, chunks, frames, tick } = createClock({ live: false })
  const backlog = 'history'.repeat(10000)
  batcher.push(backlog)
  assert.equal(frames.size, 0)
  batcher.beginLive()
  batcher.beginLive()
  assert.deepEqual(chunks, [backlog])
  batcher.push('live'.repeat(1000))
  tick()
  assert.ok(chunks[1].length < 4000)
  batcher.flushNow()
  assert.equal(chunks.join(''), backlog + 'live'.repeat(1000))
  assert.equal(frames.size, 0)
})
