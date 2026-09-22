import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composerManualHeightLimit, composerTextareaLayout, composerDragHeight } from './composerHeight.js'

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

test('top handle grows upwards, shrinks downwards and clamps', () => {
  assert.equal(composerDragHeight(100, 500, 400, 900), 200)
  assert.equal(composerDragHeight(200, 400, 460, 900), 140)
  assert.equal(composerDragHeight(100, 500, 900, 900), 34)
  assert.equal(composerDragHeight(100, 500, -900, 900), 680)
  assert.equal(composerTextareaLayout({ scrollHeight: 90, manualHeight: 360, viewportHeight: 800, isNarrow: true }).manual, false)
})

test('chat composer wires desktop resize and narrow fallback', () => {
  const chatApp = (readFileSync(resolve(here, '../ChatApp.jsx'), 'utf8') + '\n' + readFileSync(resolve(here, '../ui/chatBody.jsx'), 'utf8'))
  const style = readFileSync(resolve(here, '../style.css'), 'utf8')
  assert.match(chatApp, /onPointerDown=\{beginComposerResize\}/)
  assert.match(chatApp, /window\.addEventListener\('resize', applyComposerHeight\)/)
  assert.match(chatApp, /root\.style\.setProperty\('--oa-composer-h', `\$\{Math\.ceil\(wrap\.getBoundingClientRect\(\)\.height\)\}px`\)/)
  assert.match(chatApp, /autoFollowRef\.current\) followScheduler\.request\('auto'\)/)
  assert.doesNotMatch(chatApp, /followScheduler\.schedule/)
  assert.match(style, /max-height:max\(34px, calc\(100dvh - 220px\)\).*resize:none !important/)
  assert.match(style, /@media \(max-width:680px\)[\s\S]*?max-height:160px !important;resize:none !important/)
})
