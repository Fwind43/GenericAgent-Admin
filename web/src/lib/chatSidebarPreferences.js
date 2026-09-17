export function readSidebarPreferences(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem('ga-chat-sidebar-preferences') || '{}')
    return { showProjects: typeof value?.showProjects === 'boolean' ? value.showProjects : value?.layout !== 'list', showConductor: value?.showConductor !== false, sort: value?.sort === 'priority' ? 'priority' : 'updated' }
  } catch { return { showProjects: true, showConductor: true, sort: 'updated' } }
}
export function sortSidebarSessions(sessions, mode) {
  const time = value => {
    if (value == null || value === '') return 0
    const n = Number(value)
    return Number.isFinite(n) ? (Math.abs(n) < 1e12 ? n * 1000 : n) : Date.parse(value) || 0
  }
  const rank = s => s.pinned ? 0 : s.taskbar_state === 'waiting' ? 1 : s.running || s.taskbar_state === 'running' ? 2 : 3
  return [...sessions].sort((a, b) => (mode === 'priority' ? rank(a) - rank(b) : Number(!!b.pinned) - Number(!!a.pinned)) || time(b.updated_at) - time(a.updated_at))
}
