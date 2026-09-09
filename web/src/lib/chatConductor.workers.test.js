import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conductorWorkers, workerStatus } from './chatConductor.js'
const worker = (id, parent = 'p') => ({id, conductor:{role:'worker', parent_session_id:parent, dispatch_id:'new', objective:'current', status:'succeeded'}})
test('only existing workers belonging to this parent are shown', () => {
 const parent = {id:'p', conductor_children:[{session_id:'deleted', status:'running'}, {session_id:'a', dispatch_id:'old', objective:'old'}, {session_id:'a', dispatch_id:'new', objective:'stale', status:'running'}]}
 const rows = conductorWorkers(parent, [worker('a'), worker('b'), worker('other', 'q'), {id:'normal'}, worker('a')])
 assert.deepEqual(rows.map(x=>x.session_id), ['a','b'])
 assert.equal(rows[0].objective, 'current')
 assert.equal(workerStatus(rows[0]), 'succeeded')
 assert.deepEqual(conductorWorkers(parent, []), [])
 assert.deepEqual(conductorWorkers({}, [worker('a')]), [])
 assert.deepEqual(conductorWorkers(parent, [worker('b')]).map(x=>x.session_id), ['b'])
})
