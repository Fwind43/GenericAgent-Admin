import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'

const root = postcss.parse(readFileSync(new URL('../styles/foundation.css', import.meta.url), 'utf8'))
function values(selector, property) {
  return root.nodes.filter(node => node.type === 'rule' && node.selector === selector)
    .flatMap(rule => rule.nodes.filter(node => node.type === 'decl' && node.prop === property).map(node => node.value))
}
test('viewport and color syntax fallbacks stay before modern declarations', () => {
  for (const [selector, property, legacy, modern] of [
    ['.setup-console-shell', 'min-height', /100vh/, /100svh/],
    ['.oa-queue-list', 'max-height', /vh/, /dvh/],
    ['.oa-composer textarea,\n.oa-composer textarea:not(.file-editor)', 'max-height', /^160px$/, /dvh/],
    ['.oa-usage.oa-usage-total', 'border-top', /--oa-border/, /color-mix/],
  ]) {
    const declarations = values(selector, property)
    const first = declarations.findIndex(value => legacy.test(value))
    assert.ok(first >= 0, selector + ': legacy fallback missing')
    assert.ok(declarations.findIndex(value => modern.test(value)) > first, selector + ': modern override must follow fallback')
  }
})
test('goal row has one unconditional alignment declaration', () => {
  assert.deepEqual(values('.goal-row', 'align-items'), ['stretch'])
})
