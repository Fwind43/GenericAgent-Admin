import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VERSION_RESTART_GRACE_MS,
  beginVersionRestartGrace,
  shouldReportVersionPollError,
  shouldReloadAfterVersionUpdate,
  versionMatchesExpectedRelease,
} from './versionUpdatePolling.js'

test('version restart grace suppresses the expected polling disconnect', () => {
  const startedAt = 1_000
  const graceUntil = beginVersionRestartGrace(startedAt)
  assert.equal(graceUntil, startedAt + VERSION_RESTART_GRACE_MS)
  assert.equal(shouldReportVersionPollError(graceUntil, graceUntil - 1), false)
  assert.equal(shouldReportVersionPollError(graceUntil, graceUntil), true)
})

test('version polling errors are reported when no restart grace is active', () => {
  assert.equal(shouldReportVersionPollError(0, 1_000), true)
  assert.equal(shouldReportVersionPollError(Number.NaN, 1_000), true)
})

test('completed updates reload only after this page observed the update', () => {
  assert.equal(shouldReloadAfterVersionUpdate({ stage: 'done', running: false }, true), true)
  assert.equal(shouldReloadAfterVersionUpdate({ stage: 'done', running: false }, false), false)
  assert.equal(shouldReloadAfterVersionUpdate({ stage: 'error', running: false, error: 'failed' }, true), false)
  assert.equal(shouldReloadAfterVersionUpdate({ stage: 'restarting', running: true }, true), false)
})

test('updated server readiness accepts release tags with or without v prefix', () => {
  assert.equal(versionMatchesExpectedRelease('v0.1.15', 'v0.1.15'), true)
  assert.equal(versionMatchesExpectedRelease('0.1.15', 'v0.1.15'), true)
  assert.equal(versionMatchesExpectedRelease('dev', 'v0.1.15'), false)
  assert.equal(versionMatchesExpectedRelease('dev', ''), true)
})
