import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conductorWorkers } from './chatConductor.js'
test('workers show latest dispatch per session, preserving agent order', () => {
 const old = {session_id:'a', objective:'old', status:'succeeded'}
 const other = {session_id:'b', objective:'other', status:'running'}
 const latest = {session_id:'a', objective:'new', status:'queued'}
 assert.deepEqual(conductorWorkers({conductor_children:[old, other, latest]}), [latest, other])
 assert.deepEqual(conductorWorkers({}), [])
})
