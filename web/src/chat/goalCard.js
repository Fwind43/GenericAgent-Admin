import { dateFromTimestamp } from './chatFormat.js'

export const GOAL_CARD_TERMINAL = new Set(['achieved', 'stopped', 'failed', 'timeout', 'expired', 'error', 'given_up', 'gave_up', 'done', 'removed'])

export const goalCardPathKey = (p) => String(p || '').replace(/\\/g, '/').toLowerCase()

export const normalizeGoalCardState = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const g = { ...raw }
  const nowSec = Date.now() / 1000
  const start = Number(g.start_time || 0)
  if (!(Number(g.elapsed_seconds) > 0) && start > 0) {
    const end = Number(g.end_time || 0) > 0 ? Number(g.end_time) : nowSec
    g.elapsed_seconds = Math.max(0, end - start)
  }
  const budget = Number(g.budget_seconds || 0)
  if (!(Number(g.remaining_seconds) >= 0) && budget > 0) {
    g.remaining_seconds = Math.max(0, budget - Number(g.elapsed_seconds || 0))
  }
  return g
}

export const formatGoalCardTime = (value) => {
  const d = dateFromTimestamp(value)
  if (!d || d.getFullYear() < 2000 || d.getTime() > Date.now() + 86400000) return ''
  return d.toLocaleString()
}

export const goalCardStatusInfo = (status, removed) => {
  const s = String(status || '').toLowerCase()
  if (removed) return { text: '已结束', cls: 'is-done' }
  if (s === 'achieved' || s === 'success' || s === 'done') return { text: '已达成', cls: 'is-done' }
  if (s === 'failed' || s === 'error') return { text: '失败', cls: 'is-error' }
  if (s === 'stopped' || s === 'given_up' || s === 'gave_up') return { text: '已停止', cls: 'is-error' }
  if (s === 'timeout' || s === 'expired') return { text: '超时', cls: 'is-error' }
  if (!s || s === 'running' || s === 'active' || s === 'pending') return { text: '进行中', cls: 'is-running' }
  return { text: s, cls: 'is-running' }
}
