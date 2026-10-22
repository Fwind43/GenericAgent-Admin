import test from 'node:test'
import assert from 'node:assert/strict'
import { createMarkdownBlockCache } from './markdownRenderCache.js'
import { parseBlocks } from './markdown.js'

test('reuses immutable AST with identical parser output', () => {
  const parse = createMarkdownBlockCache()
  const text = '> quote\n\n- one\n- two\n\n[^a]: note'
  const first = parse(text)
  assert.deepEqual(first, parseBlocks(text))
  assert.equal(parse(text), first)
  assert.throws(() => { first[0].type = 'corrupt' }, TypeError)
  assert.notEqual(parse(text + '!'), first)
})

test('LRU entry eviction and character budget bound retained inputs', () => {
  let calls = 0
  const parse = createMarkdownBlockCache({ maxEntries: 2, maxChars: 5, parse: text => { calls++; return [{ text }] } })
  const a = parse('aa'); parse('bb'); assert.equal(parse('aa'), a)
  parse('cc'); parse('bb'); assert.equal(calls, 4)
  parse('12345'); parse('aa'); assert.equal(calls, 6)
  parse('123456'); parse('123456'); assert.equal(calls, 8)
})
