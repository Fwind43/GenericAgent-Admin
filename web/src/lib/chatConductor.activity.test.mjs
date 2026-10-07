import test from 'node:test'
import assert from 'node:assert/strict'
import { conductorSidebarActivity, conductorSidebarSections, conductorSessionTree } from './chatConductor.js'

const parent = { id: 'parent', title: 'Leader', conductor: { role: 'parent' } }
const worker = (id, status, extra = {}) => ({ id, title: id, conductor: { role: 'worker', parent_session_id: 'parent', status }, ...extra })

test('sidebar activity counts live and queued workers without mutating their snapshots', () => {
  const workers = [worker('live', 'running'), worker('queued', 'queued'), worker('ok', 'succeeded'), worker('bad', 'failed'), worker('cancel', 'cancelled')]
  const before = JSON.stringify(workers)
  assert.deepEqual(conductorSidebarActivity(workers), { running: 1, queued: 1 })
  assert.equal(JSON.stringify(workers), before)
  assert.deepEqual(conductorSidebarActivity(null), { running: 0, queued: 0 })
})

test('manual reruns take precedence over terminal or queued dispatch metadata', () => {
  assert.deepEqual(conductorSidebarActivity([worker('manual', 'succeeded', { running: true }), worker('starting', 'queued', { running: true })]), { running: 2, queued: 0 })
})

test('interrupted workers awaiting recovery are not reported as running or queued', () => {
  const interrupted = worker('interrupted', 'running')
  interrupted.conductor.recovery = { reason: 'process_lost' }
  assert.deepEqual(conductorSidebarActivity([interrupted]), { running: 0, queued: 0 })
})

test('aggregation is parent-local and never resurrects deleted dispatch history', () => {
  const historicalParent = { ...parent, conductor_children: [{ session_id: 'deleted', status: 'running' }] }
  const secondParent = { id: 'other', conductor: { role: 'parent' } }
  const otherWorker = { ...worker('foreign', 'running'), conductor: { role: 'worker', parent_session_id: 'other', status: 'running' } }
  const trees = conductorSessionTree([historicalParent, worker('done', 'succeeded'), secondParent, otherWorker])
  assert.deepEqual(trees.map(node => conductorSidebarActivity(node.workers)), [{ running: 0, queued: 0 }, { running: 1, queued: 0 }])
})

test('search, pinning and section preferences do not reduce activity counts', () => {
  const sessions = [{ ...parent, pinned: true }, worker('matching', 'running'), worker('hidden', 'running'), worker('queued', 'queued')]
  for (const query of ['', 'matching']) {
    for (const showConductor of [true, false]) {
      const node = conductorSidebarSections(sessions, query, showConductor).pinned[0]
      assert.deepEqual(conductorSidebarActivity(node.workers), { running: 2, queued: 1 })
    }
  }
})

test('completed or removed workers clear the sidebar activity', () => {
  const node = conductorSessionTree([parent, worker('done', 'succeeded')])[0]
  assert.deepEqual(conductorSidebarActivity(node.workers), { running: 0, queued: 0 })
  assert.deepEqual(conductorSidebarActivity(conductorSessionTree([parent])[0].workers), { running: 0, queued: 0 })
})
