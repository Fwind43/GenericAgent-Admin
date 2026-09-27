export const sidebarPreferenceDefaults = {
  showProjects: true, showConductor: true, sort: 'updated', recentFilter: 'all',
  historyExpanded: true, pinnedExpanded: true, conductorsExpanded: false, projectsExpanded: true,
  showAllProjects: false, expandedProjectNames: [],
}

export function readSidebarPreferences(storage) {
  try {
    const value = JSON.parse((storage ?? globalThis.localStorage).getItem('ga-chat-sidebar-preferences') || '{}')
    const next = { ...sidebarPreferenceDefaults }
    for (const key of ['showProjects', 'showConductor', 'historyExpanded', 'pinnedExpanded', 'conductorsExpanded', 'projectsExpanded', 'showAllProjects']) {
      if (typeof value?.[key] === 'boolean') next[key] = value[key]
    }
    if (typeof value?.showProjects !== 'boolean') next.showProjects = value?.layout !== 'list'
    if (value?.sort === 'priority') next.sort = 'priority'
    if (['all', 'chat', 'project', 'conductor'].includes(value?.recentFilter)) next.recentFilter = value.recentFilter
    if (Array.isArray(value?.expandedProjectNames)) next.expandedProjectNames = [...new Set(value.expandedProjectNames.filter(name => typeof name === 'string'))]
    return next
  } catch { return { ...sidebarPreferenceDefaults } }
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

export function filterSidebarRecentNodes(nodes, filter = 'all') {
  return (Array.isArray(nodes) ? nodes : []).filter(node => {
    const session = node?.session
    const conductor = ['parent', 'worker'].includes(session?.conductor?.role) || Boolean(node?.workers?.length)
    const project = Boolean(session?.project_id || session?.project_mode || session?.project_name)
    if (filter === 'project') return project
    if (filter === 'conductor') return conductor
    if (filter === 'chat') return !project && !conductor
    return true
  })
}
