import test from 'node:test'
import assert from 'node:assert/strict'
import { readSidebarPreferences, sortSidebarSessions } from './chatSidebarPreferences.js'
test('preferences tolerate invalid and unavailable storage', () => {
  for (const raw of ['null', '{}', 'invalid']) assert.deepEqual(readSidebarPreferences({getItem:()=>raw}), {layout:'projects',sort:'updated'})
  assert.deepEqual(readSidebarPreferences({getItem:()=>'{"layout":"list","sort":"priority"}'}), {layout:'list',sort:'priority'})
  assert.deepEqual(readSidebarPreferences({getItem:()=>{throw Error()}}), {layout:'projects',sort:'updated'})
})
test('priority ranks pins, waiting, running, and ordinary sessions without mutation', () => {
  const sessions = [{id:'idle',updated_at:200}, {id:'run',running:true,updated_at:100}, {id:'wait',taskbar_state:'waiting'}, {id:'pin',pinned:true}]
  assert.deepEqual(sortSidebarSessions(sessions,'priority').map(s=>s.id), ['pin','wait','run','idle'])
  assert.equal(sessions[0].id,'idle')
  assert.deepEqual(sortSidebarSessions(sessions,'updated').map(s=>s.id), ['pin','idle','run','wait'])
})
test('timestamps support seconds, milliseconds, ISO dates and stable ties', () => {
  const sessions = [{id:1,updated_at:'bad'},{id:2,updated_at:'2026-01-01T00:00:00Z'},{id:3,updated_at:1800000000},{id:4,updated_at:1800000000000}]
  assert.deepEqual(sortSidebarSessions(sessions,'updated').map(s=>s.id), [3,4,2,1])
})
