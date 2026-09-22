export const NAV_ITEMS = ['overview','settings','theme','chat','models','keychain','instances','channels','tasks','goals','files','usage','logs']
export const ROUTE_TABS = NAV_ITEMS
export const TASK_SUB_TABS = ['services','scheduled','runs','reports']

const TAB_ALIASES = {
  '': 'overview',
  home: 'overview',
  index: 'overview',
  // The standalone memory page was removed; its files live under GA root.
  memory: 'files',
  task: 'tasks',
  tasks: 'tasks',
  config: 'settings',
  general: 'settings',
  about: 'overview',
}

const TASK_ROUTE_ALIASES = {
  '': 'services',
  service: 'services',
  services: 'services',
  schedule: 'scheduled',
  scheduled: 'scheduled',
  runs: 'runs',
  goals: 'runs',
  // The standalone autonomous page merged into tasks/runs.
  autonomous: 'runs',
  reports: 'reports',
}

const baseURL = () => (import.meta.env?.BASE_URL || '/').replace(/\/$/, '')

const routeParts = () => {
  const rawHash = (window.location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean)
  if (rawHash.length) return rawHash
  const base = baseURL()
  let path = window.location.pathname || '/'
  if (base && base !== '/' && path.startsWith(base)) path = path.slice(base.length) || '/'
  const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  // Admin console is mounted under /admin; the prefix itself carries no tab info.
  if (parts[0] === 'admin') parts.shift()
  return parts
}

export const parseRoute = () => {
  const parts = routeParts()
  const rawFirst = parts[0] || ''
  // A real route always wins over a task-section shortcut, so /admin/goals is
  // the Goal Mode page while /admin/tasks/goals is the runs section.
  const directTaskSubTab = ROUTE_TABS.includes(rawFirst) ? undefined : TASK_ROUTE_ALIASES[rawFirst]
  const first = directTaskSubTab && rawFirst !== '' ? 'tasks' : (TAB_ALIASES[rawFirst] || rawFirst)
  const tab = ROUTE_TABS.includes(first) ? first : 'overview'
  const rawSub = tab === 'tasks' ? (parts[1] || (directTaskSubTab ? rawFirst : '')) : ''
  const sub = TASK_ROUTE_ALIASES[rawSub] || rawSub
  const taskSubTab = tab === 'tasks' && TASK_SUB_TABS.includes(sub) ? sub : 'services'
  return { tab, taskSubTab }
}

export const buildRoute = (tab, taskSubTab = 'services') => {
  const safeTab = ROUTE_TABS.includes(tab) ? tab : 'overview'
  const suffix = safeTab === 'tasks' ? `/${TASK_SUB_TABS.includes(taskSubTab) ? taskSubTab : 'services'}` : ''
  const base = baseURL()
  return `${base}/admin/${safeTab}${suffix}`.replace(/\/+/g, '/')
}
