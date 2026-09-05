// Reuse only a contiguous, revision-checked suffix. A branch edit invalidates
// earlier pages; the latest page always supplies complete, authoritative messages.
export function reconcileHistoryPage(latest, previous) {
  const index = latest.message_index
  if (!Array.isArray(index)) return latest
  const oldMessages = previous?.messages || []
  const oldById = new Map(oldMessages.map(message => [message.id, message]))
  const latestMessages = latest.messages || []
  const first = index.findIndex(item => item.id === latestMessages[0]?.id)
  const oldStart = index.findIndex(item => item.id === oldMessages[0]?.id)
  if (oldStart < 0 || oldStart >= first) return { ...latest, messages: latestMessages }
  const prefix = index.slice(oldStart, first).map(item => oldById.get(item.id))
  const valid = prefix.every((message, offset) => message && message.content_revision === index[oldStart + offset].revision)
  // The opaque cursor also fingerprints messages before the retained window.
  const oldIndex = previous?.message_index || []
  const samePrefix = oldIndex.length >= first && index.slice(0, first).every((item, offset) => (
    item.id === oldIndex[offset]?.id && item.revision === oldIndex[offset]?.revision
  ))
  return valid && samePrefix
    ? { ...latest, messages: [...prefix, ...latestMessages], before: previous.before, has_more: previous.has_more }
    : { ...latest, messages: latestMessages }
}

export function prependHistoryPage(current, earlier) {
  const ids = new Set(current.map(message => message.id))
  return [...(earlier.messages || []).filter(message => !ids.has(message.id)), ...current]
}

export function historyStatsMessages(stats = [], messages = []) {
  const byId = new Map(stats.map(message => [message.id, message]))
  for (const message of messages) byId.set(message.id, message)
  return [...byId.values()]
}

export function createHistoryPageCache({ maxBytes = 32 * 1024 * 1024, maxEntries = 4 } = {}) {
  const entries = new Map()
  let bytes = 0
  const remove = key => {
    const old = entries.get(key)
    if (old) bytes -= old.bytes
    entries.delete(key)
  }
  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return null
      entries.delete(key)
      entries.set(key, entry)
      return entry.value
    },
    put(key, value) {
      remove(key)
      const size = JSON.stringify(value).length * 2
      if (maxEntries <= 0 || size > maxBytes) return
      while (entries.size && (entries.size >= maxEntries || bytes + size > maxBytes)) remove(entries.keys().next().value)
      entries.set(key, { value, bytes: size })
      bytes += size
    },
    clear() { entries.clear(); bytes = 0 },
  }
}
