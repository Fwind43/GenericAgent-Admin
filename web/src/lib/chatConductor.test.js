import assert from 'node:assert/strict'
import {
  canStopConductorWorker,
  conductorPollActions,
  conductorSessionTree,
  conductorStatusCounts,
  shouldPollConductorSessions,
  workerStatus,
} from './chatConductor.js'

const parent = { id:'parent', conductor:{ role:'parent' }, conductor_children:[
  { session_id:'worker-a', status:'running' },
  { session_id:'worker-b', status:'failed' },
] }
const ordinary = { id:'plain' }
const workerA = { id:'worker-a', running:true, conductor:{ role:'worker', status:'running', parent_session_id:'parent' } }
const workerB = { id:'worker-b', parent_session_id:'parent', conductor:{ role:'worker', status:'failed' } }
const childRecord = { session_id:'worker-c', status:'queued' }

assert.equal(workerStatus({ status:'queued' }), 'queued')
assert.equal(workerStatus(workerA), 'running')
assert.equal(workerStatus(childRecord), 'queued')
assert.equal(canStopConductorWorker(workerA), true)
assert.equal(canStopConductorWorker({ status:'running' }), true)
assert.equal(canStopConductorWorker({ status:'failed' }), false)
assert.deepEqual(conductorStatusCounts(parent.conductor_children), {
  total:2, queued:0, running:1, succeeded:0, failed:1, cancelled:0,
})
assert.equal(shouldPollConductorSessions([ordinary, parent]), true)
assert.equal(shouldPollConductorSessions([{ ...parent, conductor_children:[{ status:'succeeded' }] }]), false)
assert.equal(shouldPollConductorSessions([workerA]), true)
const runningParent = { ...parent, running:true }
const terminalWorker = { ...workerB, running:false }
const lifecycleRunningButDetached = { ...workerA, running:false }
const runningOrdinary = { ...ordinary, running:true }
assert.deepEqual(conductorPollActions(runningParent), { refreshMetadata:true, attachRunningStream:true })
assert.deepEqual(conductorPollActions(workerA), { refreshMetadata:true, attachRunningStream:true })
assert.deepEqual(conductorPollActions(workerA, { streamAttached:true }), { refreshMetadata:true, attachRunningStream:false })
assert.deepEqual(conductorPollActions(workerA, { runAttached:true }), { refreshMetadata:true, attachRunningStream:false })
assert.deepEqual(conductorPollActions(terminalWorker), { refreshMetadata:true, attachRunningStream:false })
assert.deepEqual(conductorPollActions(lifecycleRunningButDetached), { refreshMetadata:true, attachRunningStream:false })
assert.deepEqual(conductorPollActions(runningOrdinary), { refreshMetadata:false, attachRunningStream:true })
assert.deepEqual(conductorSessionTree([parent, workerA, ordinary, workerB]), [
  { session:parent, workers:[workerA, workerB] },
  { session:ordinary, workers:[] },
])
assert.deepEqual(conductorSessionTree([workerA]), [
  { session:workerA, workers:[] },
])
console.log('chatConductor tests passed')
