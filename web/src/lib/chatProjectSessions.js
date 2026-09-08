export function groupProjectSessions(projects, sessions, pinnedProjects, manualOrder = []) {
  const sourceProjects = Array.isArray(projects) ? projects : []
  const sourceSessions = Array.isArray(sessions) ? sessions : []
  const pinned = new Set((Array.isArray(pinnedProjects) ? pinnedProjects : [])
    .map(value => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean))
  const seen = new Set()

  const groups = sourceProjects.reduce((acc, value) => {
    const name = typeof value === 'string' ? value.trim() : ''
    if (!name || seen.has(name)) return acc
    seen.add(name)
    acc.push({
      name,
      pinned: pinned.has(name),
      sessions: sourceSessions.filter(session => String(session?.project_mode || '').trim() === name),
    })
    return acc
  }, [])

  // Pinned projects float to the top; everything else keeps the order the server
  // sent, so the list stays stable as sessions come and go.
  const order = new Map((Array.isArray(manualOrder) ? manualOrder : []).map((name, index) => [name, index]))
  const manualRank = group => order.get(group.name) ?? Number.MAX_SAFE_INTEGER
  const rank = (group) => group.pinned ? 0 : 1
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => rank(a.group) - rank(b.group) || manualRank(a.group) - manualRank(b.group) || a.index - b.index)
    .map(entry => entry.group)
}

export function moveProjectOrder(groups, name, direction) {
  const peers = groups.filter(group => group.pinned === groups.find(item => item.name === name)?.pinned)
  const index = peers.findIndex(group => group.name === name)
  const target = index + direction
  if (![1, -1].includes(direction) || index < 0 || target < 0 || target >= peers.length) return groups.map(group => group.name)
  const names = groups.map(group => group.name)
  const a = names.indexOf(name), b = names.indexOf(peers[target].name)
  ;[names[a], names[b]] = [names[b], names[a]]
  return names
}

export function readProjectOrder(instance, storage) {
  try {
    const value = JSON.parse((storage ?? window.localStorage).getItem('ga-chat-project-order:' + instance) || '[]')
    return Array.isArray(value) ? value.filter(name => typeof name === 'string') : []
  } catch { return [] }
}
