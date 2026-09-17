import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composerManualHeightLimit, composerTextareaLayout, isComposerResizeHandlePointer } from './composerHeight.js'

const here = dirname(fileURLToPath(import.meta.url))

test('auto-grow stays capped at 160px and scrolls long content', () => {
  assert.deepEqual(composerTextareaLayout({ scrollHeight: 420, manualHeight: null, viewportHeight: 900, isNarrow: false }), {
    height: 160, overflowY: 'auto', manual: false,
  })
})

test('manual height survives content changes and clamps to viewport', () => {
  assert.deepEqual(composerTextareaLayout({ scrollHeight: 80, manualHeight: 360, viewportHeight: 900, isNarrow: false }), {
    height: 360, overflowY: 'hidden', manual: true,
  })
  assert.equal(composerManualHeightLimit(500), 280)
  assert.equal(composerTextareaLayout({ scrollHeight: 600, manualHeight: 360, viewportHeight: 500, isNarrow: false }).height, 280)
})

test('narrow layout ignores manual height and handle detection is corner-only', () => {
  assert.equal(composerTextareaLayout({ scrollHeight: 90, manualHeight: 360, viewportHeight: 800, isNarrow: true }).manual, false)
  const rect = { right: 500, bottom: 300 }
  assert.equal(isComposerResizeHandlePointer({ clientX: 495, clientY: 295 }, rect), true)
  assert.equal(isComposerResizeHandlePointer({ clientX: 400, clientY: 295 }, rect), false)
})

test('chat composer wires desktop resize and narrow fallback', () => {
  const chatApp = readFileSync(resolve(here, '../ChatApp.jsx'), 'utf8')
  const style = readFileSync(resolve(here, '../style.css'), 'utf8')
  assert.match(chatApp, /onPointerDown=\{beginComposerResize\}/)
  assert.match(chatApp, /window\.addEventListener\('resize', applyComposerHeight\)/)
  assert.match(chatApp, /root\.style\.setProperty\('--oa-composer-h', `\$\{Math\.ceil\(wrap\.getBoundingClientRect\(\)\.height\)\}px`\)/)
  assert.match(chatApp, /autoFollowRef\.current\) followScheduler\.request\('auto'\)/)
  assert.doesNotMatch(chatApp, /followScheduler\.schedule/)
  assert.match(style, /max-height:max\(34px, calc\(100dvh - 220px\)\).*resize:vertical !important/)
  assert.match(style, /@media \(max-width:680px\)[\s\S]*?max-height:160px !important;resize:none !important/)
})
