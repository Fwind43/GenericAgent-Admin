const TERMINAL_WORKER_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])
const ACTIVE_WORKER_STATUSES = new Set(['queued', 'running'])

export const conductorRole = session => String(session?.conductor?.role || '')
export const isConductorParent = session => conductorRole(session) === 'parent'
export const isConductorWorker = session => conductorRole(session) === 'worker'

export const conductorParentID = session => String(
  session?.parent_session_id || session?.conductor?.parent_session_id || '',
)

export const conductorChildren = session => Array.isArray(session?.conductor_children)
  ? session.conductor_children
  : []

export const workerStatus = worker => String(worker?.conductor?.status || worker?.status || '').toLowerCase()
export const isActiveConductorWorker = worker => ACTIVE_WORKER_STATUSES.has(workerStatus(worker))
export const isTerminalConductorWorker = worker => TERMINAL_WORKER_STATUSES.has(workerStatus(worker))
export const canStopConductorWorker = worker => isActiveConductorWorker(worker)

export const conductorStatusCounts = workers => (Array.isArray(workers) ? workers : []).reduce((counts, worker) => {
  const status = workerStatus(worker) || 'queued'
  counts[status] = (counts[status] || 0) + 1
  counts.total += 1
  return counts
}, { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 })

export const conductorPollActions = (session, { streamAttached = false, runAttached = false } = {}) => ({
  refreshMetadata: isConductorParent(session) || isConductorWorker(session),
  attachRunningStream: Boolean(session?.running) && !streamAttached && !runAttached,
})

export const shouldPollConductorSessions = sessions => (Array.isArray(sessions) ? sessions : []).some(session => (
  (isConductorParent(session) && conductorChildren(session).some(isActiveConductorWorker))
  || (isConductorWorker(session) && isActiveConductorWorker(session))
))

export const conductorSessionTree = sessions => {
  const list = Array.isArray(sessions) ? sessions : []
  const byParent = new Map()
  list.forEach(session => {
    if (!isConductorWorker(session)) return
    const parentID = conductorParentID(session)
    if (!parentID) return
    const workers = byParent.get(parentID) || []
    workers.push(session)
    byParent.set(parentID, workers)
  })
  const listedIDs = new Set(list.map(session => String(session?.id || '')))
  return list
    .filter(session => {
      if (!isConductorWorker(session)) return true
      const parentID = conductorParentID(session)
      return !parentID || !listedIDs.has(parentID)
    })
    .map(session => ({ session, workers: byParent.get(String(session?.id || '')) || [] }))
}

// Dispatch history is append-only; retain the latest task for each worker session.
export const conductorWorkers = session => {
  const latest = new Map()
  conductorChildren(session).forEach(worker => {
    const id = String(worker?.session_id || worker?.id || '')
    if (id) latest.set(id, worker)
  })
  return [...latest.values()]
}
