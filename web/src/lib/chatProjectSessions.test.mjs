import test from 'node:test'
import assert from 'node:assert/strict'
import { groupProjectSessions, moveProjectOrder } from './chatProjectSessions.js'

test('qualified ordering isolates names and supports legacy official order', () => {
  const projects = [
    { provider: 'admin', id: 'a', name: 'Alpha' },
    { provider: 'official', id: 'Alpha', name: 'Alpha' },
  ]
  const groups = groupProjectSessions(projects, [], [], ['Alpha'])
  assert.deepEqual(groups.map(g => g.key), ['Alpha', 'a'])
  const order = moveProjectOrder(groups, 'a', -1)
  assert.deepEqual(order, ['a', 'Alpha'])
  assert.deepEqual(groupProjectSessions(projects, [], [], order).map(g => g.key), order)
  assert.deepEqual(moveProjectOrder(groups, 'missing', 1), groups.map(g => g.key))
  assert.deepEqual(moveProjectOrder(groupProjectSessions(projects, [], ['a']), 'a', 1), ['a', 'Alpha'])
  assert.deepEqual(moveProjectOrder(groupProjectSessions(['A', 'B'], []), 'B', -1), ['B', 'A'])
})

test('groupProjectSessions keeps project order and includes projects without sessions', () => {
  const sessions = [
    { id: 'general', project_mode: '' },
    { id: 'beta-1', project_mode: 'Beta' },
    { id: 'alpha-1', project_mode: 'Alpha' },
    { id: 'removed', project_mode: 'Removed' },
    { id: 'alpha-2', project_mode: 'Alpha' },
  ]

  assert.deepEqual(groupProjectSessions(['Beta', 'Empty', 'Alpha'], sessions), [
    { name: 'Beta', pinned: false, sessions: [sessions[1]] },
    { name: 'Empty', pinned: false, sessions: [] },
    { name: 'Alpha', pinned: false, sessions: [sessions[2], sessions[4]] },
  ])
})

test('groupProjectSessions ignores duplicate and blank project names', () => {
  assert.deepEqual(groupProjectSessions(['Alpha', '', 'Alpha', '  ', null], []), [
    { name: 'Alpha', pinned: false, sessions: [] },
  ])
})

test('groupProjectSessions tolerates malformed API collections', () => {
  assert.deepEqual(groupProjectSessions(null, null), [])
  assert.deepEqual(groupProjectSessions(['Alpha'], [], null), [
    { name: 'Alpha', pinned: false, sessions: [] },
  ])
})

test('pinned projects are marked and moved to the top', () => {
  const groups = groupProjectSessions(['Alpha', 'Beta', 'Gamma'], [], ['Gamma', 'Beta'])
  assert.deepEqual(groups.map(g => [g.name, g.pinned]), [
    ['Beta', true],
    ['Gamma', true],
    ['Alpha', false],
  ])
})

test('same-name Admin and official projects keep sessions and pins isolated', () => {
  const projects = [
    { provider: 'admin', id: 'alpha-id', name: 'Alpha' },
    { provider: 'official', id: 'Alpha', name: 'Alpha' },
  ]
  const sessions = [
    { id: 'admin-chat', project_provider: 'admin', project_id: 'alpha-id' },
    { id: 'legacy-chat', project_mode: 'Alpha' },
    { id: 'official-chat', project_provider: 'official', project_id: 'Alpha' },
    { id: 'general' },
  ]
  const groups = groupProjectSessions(projects, sessions, ['Alpha'])
  assert.deepEqual(groups.map(g => [g.key, g.pinned, g.sessions.map(s => s.id)]), [
    ['Alpha', true, ['legacy-chat', 'official-chat']],
    ['alpha-id', false, ['admin-chat']],
  ])
  assert.equal(groupProjectSessions(projects, sessions, ['Alpha']).find(g => g.provider === 'admin').pinned, false)
})

// Within each half the server's order is preserved, so pinning one project does
// not shuffle the rest of the list.
test('pinning preserves the relative order inside the pinned and unpinned halves', () => {
  const groups = groupProjectSessions(['d', 'c', 'b', 'a'], [], ['c', 'a'])
  assert.deepEqual(groups.map(g => g.name), ['c', 'a', 'd', 'b'])
})

test('a pin for a project that no longer exists is ignored', () => {
  const groups = groupProjectSessions(['Alpha'], [], ['Removed'])
  assert.deepEqual(groups, [{ name: 'Alpha', pinned: false, sessions: [] }])
})

test('one project combines both origins and retains legacy pin and order', () => {
 const projects = [{provider:'admin',id:'A',name:'A'},{provider:'official',id:'A',name:'A'},{provider:'official',id:'B',name:'B'}]
 const sessions = [{id:'1',project_provider:'admin',project_id:'A'},{id:'2',project_mode:'A'}]
 const groups = groupProjectSessions(projects,sessions,['official:A'],['admin:A'])
 assert.equal(groups.length,2)
 assert.equal(groups[0].key,'A')
 assert.equal(groups[0].pinned,true)
 assert.deepEqual(groups[0].sessions,sessions)
})
