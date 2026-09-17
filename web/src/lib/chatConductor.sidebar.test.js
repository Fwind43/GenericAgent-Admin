import test from 'node:test'
import assert from 'node:assert/strict'
import { conductorSidebarSections } from './chatConductor.js'
const parent = { id: 'p', title: 'Leader', conductor: { role: 'parent' } }
const worker = { id: 'w', title: 'Research', parent_session_id: 'p', conductor: { role: 'worker' } }
const ordinary = { id: 'o', title: 'Chat' }
test('dedicated section excludes conductors and workers from recent', () => {
  const result = conductorSidebarSections([parent, worker, ordinary])
  assert.deepEqual(result.conductors.map(n => n.session.id), ['p'])
  assert.deepEqual(result.conductors[0].workers, [worker])
  assert.deepEqual(result.recent.map(n => n.session.id), ['o'])
})
test('pinned conductor and children appear only in pinned', () => {
  const result = conductorSidebarSections([{ ...parent, pinned: true }, { ...worker, pinned: true }])
  assert.equal(result.pinned.length, 1)
  assert.equal(result.pinned[0].workers.length, 1)
  assert.equal(result.conductors.length, 0)
  assert.equal(result.recent.length, 0)
})
test('worker search preserves parent context and orphan workers remain accessible', () => {
  const result = conductorSidebarSections([parent, worker, ordinary], 'research')
  assert.equal(result.conductors[0].session.id, 'p')
  assert.equal(result.recent.length, 0)
  assert.equal(conductorSidebarSections([worker]).conductors[0].session.id, 'w')
  assert.equal(conductorSidebarSections([ordinary]).conductors.length, 0)
})
