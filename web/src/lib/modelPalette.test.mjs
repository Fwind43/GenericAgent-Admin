import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('warm model palette reuses semantic theme colors', () => {
  const css = readFileSync(new URL('../styles/models-workbench.css', import.meta.url), 'utf8')
  const warm = css.match(/html\[data-theme="warm"\] \.models-page \{([^}]+)\}/)[1]
  for (const [local, global] of Object.entries({ ink: 'muted', 'ink-strong': 'text', wash: 'surface-muted', 'wash-strong': 'selected', paper: 'surface', panel: 'bg', ok: 'success', warn: 'warning', error: 'error' })) {
    assert.ok(warm.includes(`--model-${local}: var(--${global});`))
  }
  assert.ok(!css.includes('color: #fff;'))
})
