export function groupProjectSessions(projects, sessions, pinnedProjects, manualOrder = []) {
  const sourceProjects = Array.isArray(projects) ? projects : []
  const sourceSessions = Array.isArray(sessions) ? sessions : []
  const pinned = new Set((Array.isArray(pinnedProjects) ? pinnedProjects : [])
    .map(value => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean))
  const seen = new Set()

  const groups = sourceProjects.reduce((acc, value) => {
    const structured = value && typeof value === 'object'
    const name = String(structured ? value.name || '' : typeof value === 'string' ? value : '').trim()
    const provider = structured ? value.provider : 'official'
    const id = structured ? String(value.id || '').trim() : name
    if (!name || !id || !['admin', 'official'].includes(provider)) return acc
    const key = id
    if (seen.has(key)) return acc
    seen.add(key)
    acc.push({
      name,
      ...(structured ? { key, provider, id } : {}),
      pinned: pinned.has(id) || pinned.has(`official:${id}`) || pinned.has(`admin:${id}`),
      sessions: sourceSessions.filter(session => {
        const sessionID = String(session?.project_id || session?.project_mode || '').trim()
        return sessionID === id
      }),
    })
    return acc
  }, [])

  // Pinned projects float to the top; everything else keeps the order the server
  // sent, so the list stays stable as sessions come and go.
  const order = new Map((Array.isArray(manualOrder) ? manualOrder : []).map((name, index) => [name, index]))
  const manualRank = group => order.get(group.key || group.name)
    ?? order.get(`official:${group.id || group.name}`)
    ?? order.get(`admin:${group.id || group.name}`)
    ?? Number.MAX_SAFE_INTEGER
  const rank = (group) => group.pinned ? 0 : 1
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => rank(a.group) - rank(b.group) || manualRank(a.group) - manualRank(b.group) || a.index - b.index)
    .map(entry => entry.group)
}

// A session belongs to a project when it carries that project's id (new schema)
// or its legacy `project_mode` name. Keep the check in one place so the sidebar
// can hide project sessions from the plain "recent" list without duplicating
// matching rules from groupProjectSessions.
export function projectSessionKeys(projects) {
  const keys = new Set()
  ;(Array.isArray(projects) ? projects : []).forEach(value => {
    const structured = value && typeof value === 'object'
    const name = String(structured ? value.name || '' : typeof value === 'string' ? value : '').trim()
    if (!name) return
    const provider = structured ? value.provider : 'official'
    if (structured && !['admin', 'official'].includes(provider)) return
    // Same id derivation as groupProjectSessions: structured projects match on
    // their id, plain names match on the name itself.
    const id = structured ? String(value.id || '').trim() : name
    if (id) keys.add(id)
    // Older sessions only carry the project name in project_mode, which the
    // grouping code matches against the name, so keep the name as a key too.
    if (name && name !== id) keys.add(name)
  })
  return keys
}

export function isProjectSession(session, projects) {
  const id = String(session?.project_id || '').trim()
  const legacy = String(session?.project_mode || '').trim()
  const keys = projects instanceof Set ? projects : projectSessionKeys(projects)
  if (id && keys.has(id)) return true
  if (legacy && keys.has(legacy)) return true
  return false
}

export function excludeProjectSessions(sessions, projects) {
  const source = Array.isArray(sessions) ? sessions : []
  if (!source.length) return []
  const keys = projectSessionKeys(projects)
  if (!keys.size) return source.slice()
  return source.filter(session => !isProjectSession(session, keys))
}

// With project sections visible the sidebar's plain recent list must not repeat
// the sessions that already live under their project folder; with the sections
// off the caller gets the original list back untouched.
export function filterRecentNodes(nodes, projects, showProjects) {
  const source = Array.isArray(nodes) ? nodes : []
  if (!showProjects) return source
  return source.filter(node => !isProjectSession(node?.session, projects))
}

export function moveProjectOrder(groups, name, direction) {
  const keyOf = group => group.key || group.name
  const peers = groups.filter(group => group.pinned === groups.find(item => keyOf(item) === name)?.pinned)
  const index = peers.findIndex(group => keyOf(group) === name)
  const target = index + direction
  if (![1, -1].includes(direction) || index < 0 || target < 0 || target >= peers.length) return groups.map(keyOf)
  const names = groups.map(keyOf)
  const a = names.indexOf(name), b = names.indexOf(keyOf(peers[target]))
  ;[names[a], names[b]] = [names[b], names[a]]
  return names
}

export function readProjectOrder(instance, storage) {
  try {
    const value = JSON.parse((storage ?? window.localStorage).getItem('ga-chat-project-order:' + instance) || '[]')
    return Array.isArray(value) ? value.filter(name => typeof name === 'string') : []
  } catch { return [] }
}
