import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../style.css'), 'utf8')

const ruleBodies = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  assert.ok(matches.length > 0, `missing CSS rule for ${selector}`)
  return matches.map(match => match[1])
}

test('log-view keeps a readable foreground over its forced dark background', () => {
  const sharedPanelRules = ruleBodies('.log-panel pre, .preview pre, .artifact-view, .json-editor, .file-editor')
  assert.ok(
    sharedPanelRules.some(rule => /color\s*:\s*var\(--text\)\s*!important/i.test(rule)),
    'expected a shared panel rule that can force dark text with !important',
  )

  const logViewRule = ruleBodies('.log-panel pre.log-view')
    .find(rule => /background\s*:\s*#0f1115\s*!important/i.test(rule))
  assert.ok(logViewRule, 'missing forced dark log-view background rule')
  assert.match(logViewRule, /color\s*:\s*#d7e1ea\s*!important/i)
})

test('shared status feedback stays keyboard-visible and readable at narrow widths', () => {
  const focusRule = ruleBodies('.ga-status-actions button:focus-visible').join('\n')
  assert.match(focusRule, /outline\s*:\s*2px\s+solid/i)
  assert.match(focusRule, /outline-offset\s*:\s*2px/i)

  assert.match(
    css,
    /@media\s*\(max-width:\s*620px\)[\s\S]*?\.ga-status-notice\s*\{[^}]*max-width\s*:\s*100%[^}]*\}/i,
  )
  assert.match(
    css,
    /@media\s*\(max-width:\s*620px\)[\s\S]*?\.ga-status-message\s*\{[^}]*white-space\s*:\s*normal[^}]*overflow-wrap\s*:\s*anywhere[^}]*\}/i,
  )
})

test('language controls reserve stable space for translated labels', () => {
  assert.match(css, /\.sidebar \.lang-switch\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto 30px/s)
  assert.match(css, /\.sidebar \.lang-switch-label\s*\{[^}]*white-space:\s*nowrap/s)
  assert.match(css, /\.sidebar \.theme-toggle\s*\{[^}]*width:\s*30px[^}]*height:\s*30px/s)
  assert.match(
    css,
    /html\[data-theme="dark"\] \.app:not\(\.app-tab-chat\) \.sidebar nav button\.active,[\s\S]*?\{[^}]*background:\s*var\(--surface-muted\)\s*!important[^}]*color:\s*var\(--text\)\s*!important/s,
  )
})

test('sent-message editor exposes keyboard focus and a narrow action layout', () => {
  const focusRule = ruleBodies('.oa-message-editor-actions button:focus-visible').join('\n')
  assert.match(focusRule, /outline\s*:\s*2px\s+solid/i)
  assert.match(focusRule, /outline-offset\s*:\s*2px/i)

  assert.match(
    css,
    /@media\s*\(max-width:\s*520px\)[^{]*\{[\s\S]*?\.oa-message-editor-hint\s*\{[^}]*white-space\s*:\s*normal[^}]*\}/i,
  )
})

test('model discovery keeps focus, responsive controls, and reduced-motion meaning', () => {
  const focusRule = ruleBodies('.model-discover-modal .model-candidate-item:focus-visible').join('\n')
  assert.match(focusRule, /outline\s*:\s*2px\s+solid/i)

  assert.match(
    css,
    /@media\s*\(max-width:\s*620px\)[\s\S]*?\.models-page \.model-discover-row\s*\{[^}]*flex-direction\s*:\s*column[^}]*\}/i,
  )
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.model-discover-modal \.is-spinning\s*\{[^}]*animation\s*:\s*none[^}]*\}/i,
  )
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.ga-status-pending \.ga-status-mark\s*\{[^}]*animation\s*:\s*none[^}]*\}/i,
  )
})
