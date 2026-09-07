import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  forgetSessionScroll,
  rememberSessionScroll,
  sessionScrollRestore,
} from './chatSessionScroll.js'

test('paused session restores its saved offset without sharing state with another session', () => {
  const snapshots = new Map()

  rememberSessionScroll(snapshots, 'alpha', 420, false)
  rememberSessionScroll(snapshots, 'beta', 95, false)

  assert.deepEqual(sessionScrollRestore(snapshots, 'alpha'), { scrollTop: 420, autoFollow: false })
  assert.deepEqual(sessionScrollRestore(snapshots, 'beta'), { scrollTop: 95, autoFollow: false })
})

test('a session that was following reopens at the live end instead of a stale offset', () => {
  const snapshots = new Map()

  assert.deepEqual(rememberSessionScroll(snapshots, 'alpha', 420, true), {
    scrollTop: 420,
    autoFollow: true,
  })
  assert.equal(sessionScrollRestore(snapshots, 'alpha'), null)
})

test('invalid offsets are normalized and deleted sessions are forgotten', () => {
  const snapshots = new Map()

  rememberSessionScroll(snapshots, 'alpha', -20, false)
  rememberSessionScroll(snapshots, 'beta', Number.NaN, false)
  assert.equal(sessionScrollRestore(snapshots, 'alpha').scrollTop, 0)
  assert.equal(sessionScrollRestore(snapshots, 'beta').scrollTop, 0)

  forgetSessionScroll(snapshots, ['alpha', 'beta'])
  assert.equal(snapshots.size, 0)
})

test('ChatApp saves rendered ownership and restores a matching paused session after DOM commit', () => {
  const source = readFileSync(new URL('../ChatApp.jsx', import.meta.url), 'utf8')
  const openStart = source.indexOf('const openSession = async')
  const createStart = source.indexOf('const createSession = async')
  const scrollRestoreStart = source.indexOf('const scrollRestore = pendingSessionScrollRestoreRef.current', createStart)
  const scrollEffect = source.lastIndexOf('useLayoutEffect(() => {', scrollRestoreStart)

  assert.ok(openStart >= 0)
  assert.ok(createStart > openStart)
  assert.ok(scrollRestoreStart > createStart)
  assert.ok(scrollEffect > createStart)
  assert.match(source.slice(openStart, createStart), /rememberRenderedSessionScroll\(\)/)
  assert.match(source.slice(openStart, createStart), /sessionScrollRestore\(sessionScrollSnapshotsRef\.current, d\.id\)/)
  assert.match(source.slice(openStart, createStart), /pendingSessionScrollRestoreRef\.current = scrollRestore/)
  assert.match(source.slice(scrollEffect), /if \(sid && pendingRenderedSessionRef\.current === sid\)[\s\S]*renderedSessionRef\.current = sid/)
  assert.match(source.slice(scrollEffect), /if \(scrollRestore\?\.sessionID === sid\)[\s\S]*thread\.scrollTop = scrollRestore\.scrollTop[\s\S]*markProgrammaticScroll\(thread, FOLLOW_SETTLE_MS\)/)
  assert.match(source.slice(scrollEffect), /\}, \[messages, busy, autoFollow, sid\]\)/)
})

test('ChatApp forgets deleted sessions and clears snapshots when switching instances', () => {
  const source = readFileSync(new URL('../ChatApp.jsx', import.meta.url), 'utf8')
  const switchStart = source.indexOf('const switchChatInstance =')
  const scrollStart = source.indexOf('const markProgrammaticScroll =', switchStart)

  assert.match(source, /forgetSessionScroll\(sessionScrollSnapshotsRef\.current, id\)/)
  assert.match(source, /forgetSessionScroll\(sessionScrollSnapshotsRef\.current, result\.deletedIds\)/)
  assert.ok(switchStart >= 0)
  assert.ok(scrollStart > switchStart)
  assert.match(source.slice(switchStart, scrollStart), /sessionScrollSnapshotsRef\.current\.clear\(\)/)
  assert.match(source.slice(switchStart, scrollStart), /pendingSessionScrollRestoreRef\.current = null/)
  assert.match(source.slice(switchStart, scrollStart), /renderedSessionRef\.current = ''/)
})

test('chat keeps resume-follow control without the previous-message icon', () => {
  const source = readFileSync(new URL('../ChatApp.jsx', import.meta.url), 'utf8')
  const rowStart = source.indexOf('{showFollow && <div className="oa-follow-row">')
  const rowEnd = source.indexOf('</div>}', rowStart)
  const row = source.slice(rowStart, rowEnd)

  assert.ok(rowStart >= 0)
  assert.ok(rowEnd > rowStart)
  assert.match(row, /onClick=\{resumeFollow\}/)
  assert.match(row, /<ChevronDown size=\{16\}/)
  assert.doesNotMatch(row, /ChevronUp/)
  assert.doesNotMatch(source, /showJumpSent|jumpToPreviousSent|previousSentCard|syncJumpSent/)
  assert.match(source, /if \(autoFollowRef\.current\) scrollToThreadEnd\('auto'\)/)
})
