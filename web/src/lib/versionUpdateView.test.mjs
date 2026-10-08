import test from 'node:test'
import assert from 'node:assert/strict'
import { updateOperationLocked, updateText, versionUpdateView } from './versionUpdateView.js'
const base = { info: { update_supported: true }, check: { update: true, asset: {}, checksum: {}, latest: { tag_name: 'v2' } } }
const view = extra => versionUpdateView({ ...base, ...extra }, 'en')
test('idle and up-to-date checks never enable installation', () => {
  assert.equal(view({ check: null }).canPrepare, false)
  assert.equal(view({ check: { update: false } }).canPrepare, false)
  assert.equal(view({}).canPrepare, true)
})
test('missing assets, unsupported runtime, stale status and failed check lock preparation', () => {
  for (const extra of [{ info: { update_supported: false } }, { check: { update: true, asset: {} } }, { checkError: 'offline' }, { statusError: 'offline' }, { busy: true }, { checking: true }]) assert.equal(view(extra).canPrepare, false)
})
test('all actual preparation and handoff stages lock competing actions', () => {
  for (const stage of ['queued', 'checking', 'checked', 'downloading', 'downloading_checksum', 'verifying', 'extracting', 'preparing', 'prepared', 'starting_helper', 'waiting_for_exit', 'applying', 'starting_replacement', 'replacement_ready', 'rolling_back']) {
    const status = { id: 'a', stage, running: false, target_version: 'v2' }
    assert.equal(updateOperationLocked(status), true, stage)
    const v = view({ status })
    assert.equal(v.canPrepare, false, stage)
    assert.equal(v.canRestart, false, stage)
    assert.equal(v.canCheck, false, stage)
    assert.equal(v.pending, 'v2')
  }
})
test('ready is pending rather than installed and requires operation identity', () => {
  const status = { id: 'a', stage: 'ready', running: true, progress: 90, target_version: 'v2' }
  const v = view({ status })
  assert.equal(v.canRestart, true)
  assert.equal(v.canPrepare, false)
  assert.equal(v.canCheck, false)
  assert.equal(v.pending, 'v2')
  assert.match(v.hint, /still runs the old version/)
  for (const extra of [{ id: '' }, { running: false }]) assert.equal(view({ status: { ...status, ...extra } }).canRestart, false)
  assert.equal(view({ status, statusError: 'offline' }).canRestart, false)
  assert.equal(view({ status: { ...status, error: 'helper launch failed' } }).canRestart, true)
})
test('terminal states preserve failure and rollback evidence without pending version', () => {
  for (const stage of ['failed', 'error', 'rolled_back']) {
    const v = view({ status: { stage, running: false, error: 'failure', target_version: 'v2' } })
    assert.equal(v.tone, 'error')
    assert.equal(v.error, 'failure')
    assert.equal(v.pending, '')
  }
  assert.equal(view({ status: { stage: 'done', running: false } }).tone, 'success')
})
test('new check and connectivity feedback outrank historical completed operation', () => {
  const status = { stage: 'done', running: false }
  assert.equal(view({ status, checking: true }).label, updateText('en').checking)
  assert.equal(view({ status, checkError: 'offline' }).label, updateText('en').checkFailed)
  assert.equal(view({ status, statusError: 'offline' }).label, updateText('en').connectionLost)
  assert.equal(view({ status, actionError: 'rejected' }).tone, 'error')
})
test('progress is bounded and bilingual operation-change feedback exists', () => {
  assert.equal(view({ status: { progress: -2 } }).progress, 0)
  assert.equal(view({ status: { progress: 101 } }).progress, 100)
  for (const lang of ['en', 'zh']) assert.ok(updateText(lang).operationChanged)
})
