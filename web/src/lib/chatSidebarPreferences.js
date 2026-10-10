export const sidebarDisplayCounts = [5, 10, 15, 20, 50, 100]
export const sidebarSectionKeys = ['pinned', 'conductors', 'projects', 'recent']
export const sidebarTabIcons = ['grid', 'folder', 'briefcase', 'star', 'heart', 'code', 'terminal', 'book', 'file', 'message', 'bot', 'pin', 'flag', 'zap', 'globe', 'rocket', 'music', 'camera', 'image', 'coffee', 'palette', 'shield', 'wrench', 'calendar']
export function normalizeSidebarOrder(value) {
  const valid = Array.isArray(value) ? [...new Set(value.filter(key => sidebarSectionKeys.includes(key)))] : []
  return [...valid, ...sidebarSectionKeys.filter(key => !valid.includes(key))]
}

export const recentFilterOptions = ['chat', 'project', 'conductor']

export function normalizeRecentFilter(value) {
  if (Array.isArray(value)) return recentFilterOptions.filter(key => value.includes(key))
  return recentFilterOptions.includes(value) ? [value] : [...recentFilterOptions]
}

export const sidebarPreferenceDefaults = {
  showProjects: true, showConductor: true, sort: 'updated', recentFilter: [...recentFilterOptions],
  historyExpanded: true, pinnedExpanded: true, conductorsExpanded: false, projectsExpanded: true,
  showAllProjects: false, expandedProjectNames: [],
  sectionLayout: normalizeSidebarLayout(),
  showPinned: true, showRecent: true, sectionOrder: [...sidebarSectionKeys],
}

export function readSidebarPreferences(storage) {
  try {
    const value = JSON.parse((storage ?? globalThis.localStorage).getItem('ga-chat-sidebar-preferences') || '{}')
    const next = { ...sidebarPreferenceDefaults }
    for (const key of ['showPinned', 'showRecent', 'showProjects', 'showConductor', 'historyExpanded', 'pinnedExpanded', 'conductorsExpanded', 'projectsExpanded', 'showAllProjects']) {
      if (typeof value?.[key] === 'boolean') next[key] = value[key]
    }
    if (typeof value?.showProjects !== 'boolean') next.showProjects = value?.layout !== 'list'
    if (value?.sort === 'priority') next.sort = 'priority'
    next.sectionLayout = normalizeSidebarLayout(value?.sectionLayout)
    next.sectionOrder = normalizeSidebarOrder(value?.sectionOrder)
    next.recentFilter = normalizeRecentFilter(value?.recentFilter)
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
  const selected = normalizeRecentFilter(filter)
  return (Array.isArray(nodes) ? nodes : []).filter(node => {
    const session = node?.session
    const conductor = ['parent', 'worker'].includes(session?.conductor?.role) || Boolean(node?.workers?.length)
    const project = Boolean(session?.project_id || session?.project_mode || session?.project_name)
    return (selected.includes('project') && project) ||
      (selected.includes('conductor') && conductor) ||
      (selected.includes('chat') && !project && !conductor)
  })
}


export function normalizeSidebarLayout(value) {
  const savedHome = Array.isArray(value?.tabs) ? value.tabs.find(tab => tab?.id === 'home') : null
  const home = { id: 'home', name: typeof savedHome?.name === 'string' && savedHome.name.trim() ? savedHome.name.trim().slice(0, 40) : 'Home' }
  if (sidebarTabIcons.includes(savedHome?.icon)) home.icon = savedHome.icon
  const tabs = [home]
  for (const tab of Array.isArray(value?.tabs) ? value.tabs : []) {
    if (tabs.length >= 12) break
    if (typeof tab?.id !== 'string' || !tab.id || tabs.some(t => t.id === tab.id)) continue
    if (typeof tab.name === 'string' && tab.name.trim()) tabs.push({ id: tab.id, name: tab.name.trim().slice(0, 40), icon: sidebarTabIcons.includes(tab.icon) ? tab.icon : 'grid' })
  }
  const sections = Object.fromEntries(sidebarSectionKeys.map(key => [key, {
    tab: tabs.some(t => t.id === value?.sections?.[key]?.tab) ? value.sections[key].tab : 'home',
    count: sidebarDisplayCounts.includes(value?.sections?.[key]?.count) ? value.sections[key].count : key === 'projects' ? 5 : 10,
  }]))
  const active = tabs.some(t => t.id === value?.active) ? value.active : 'home'
  const savedActive = Array.isArray(value?.tabs) ? value.tabs.find(tab => tab?.id === active) : null
  const showActiveTabName = typeof value?.showActiveTabName === 'boolean' ? value.showActiveTabName : savedActive?.hideName === false
  return { tabs, sections, active, showActiveTabName }
}
