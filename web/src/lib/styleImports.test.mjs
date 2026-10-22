import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readStyleSource } from './readStyleSource.mjs'

test('product CSS imports preserve foundation, model workbench, then override order', () => {
  const entry = new URL('../style.css', import.meta.url)
  const paths = ['./styles/foundation.css', './styles/models-workbench.css', './styles/overrides.css']
  assert.deepEqual([...readFileSync(entry, 'utf8').matchAll(/@import "([^"]+)";/g)].map(m => m[1]), paths)
  const expected = paths.map(path => readFileSync(new URL(path, entry), 'utf8')).join('')
  assert.equal(readStyleSource(entry), expected)
  assert.ok(expected.includes('/* Models v4'))
  assert.ok(expected.includes('/* Usage overview:'))
})
