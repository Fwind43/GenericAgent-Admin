const prefix = 'ga.chat.read.v1:'
export const chatReadEvent = 'ga-chat-read'

export function chatReadKey(instance, sid, result) {
  if (!sid || !result?.id || !result?.revision) return ''
  return prefix + JSON.stringify([String(instance || ''), String(sid), result.id, result.revision])
}

const baselinePrefix = 'ga.chat.read.baseline.v1:'
const baselineCaches = new WeakMap()
const unavailableStorage = {}

const failureBaselinePrefix = 'ga.chat.read.failures.v1:'

function readBaseline(instance, storage, namespace = baselinePrefix) {
  const owner = storage || unavailableStorage
  if (!baselineCaches.has(owner)) baselineCaches.set(owner, new Map())
  const cache = baselineCaches.get(owner)
  const key = namespace + JSON.stringify(String(instance || ''))
  const cached = cache.get(key)
  let raw
  try { raw = storage?.getItem(key) } catch { return { key, cache, keys: cached?.keys } }
  if (!raw) return { key, cache, keys: cached?.volatile ? cached.keys : undefined }
  if (cached?.raw === raw) return { key, cache, keys: cached.keys }
  try {
    const values = JSON.parse(raw)
    if (Array.isArray(values) && values.every(value => typeof value === 'string')) {
      const keys = new Set(values)
      cache.set(key, { raw, keys })
      return { key, cache, keys }
    }
  } catch { /* An invalid baseline is rebuilt from the next successful list. */ }
  return { key, cache }
}

function initializeResultBaseline(instance, sessions, storage, namespace) {
  const baseline = readBaseline(instance, storage, namespace)
  if (baseline.keys) return false
  // Only the first successful list is history; running replies remain eligible for unread.
  const keys = new Set(sessions.filter(session => !session?.running)
    .map(session => chatReadKey(instance, session?.id, session?.result)).filter(Boolean))
  const raw = JSON.stringify([...keys])
  let volatile = !storage
  try { storage?.setItem(baseline.key, raw) } catch { volatile = true }
  baseline.cache.set(baseline.key, { raw, keys, volatile })
  return true
}

export function initializeChatReadBaseline(instance, sessions, storage, target) {
  if (!Array.isArray(sessions)) return false
  const initialized = initializeResultBaseline(instance, sessions, storage, baselinePrefix)
  const failuresInitialized = initializeResultBaseline(instance,
    sessions.filter(session => session?.taskbar_state === 'failed'), storage, failureBaselinePrefix)
  if (initialized || failuresInitialized) target?.dispatchEvent(new Event(chatReadEvent))
  return initialized || failuresInitialized
}

export function isChatResultUnread(session, instance, storage) {
  const key = chatReadKey(instance, session?.id, session?.result)
  if (!key || session.running || readBaseline(instance, storage).keys?.has(key) ||
    readBaseline(instance, storage, failureBaselinePrefix).keys?.has(key)) return false
  try { return storage?.getItem(key) !== '1' } catch { return true }
}

export function markChatResultRead(instance, sid, result, storage, target) {
  const key = chatReadKey(instance, sid, result)
  if (!key) return false
  try {
    if (storage?.getItem(key) === '1') return false
    storage?.setItem(key, '1')
  } catch { /* A blocked storage must not interrupt the chat. */ }
  target?.dispatchEvent(new Event(chatReadEvent))
  return true
}

export function isChatResultVisible(thread, result, doc = globalThis.document) {
  if (!thread || !result?.id || doc?.visibilityState !== 'visible' || !doc.hasFocus()) return false
  const node = Array.from(thread.querySelectorAll('.oa-message[data-id]')).find(item => item.dataset.id === result.id)
  if (!node || !node.getClientRects().length) return false
  const rect = node.getBoundingClientRect()
  const viewport = thread.getBoundingClientRect()
  const bottom = Math.min(viewport.bottom, doc.documentElement.clientHeight)
  const top = Math.max(viewport.top, 0)
  // Seeing the end of the reply also works for replies taller than the viewport.
  if (rect.bottom > bottom + 1 || rect.bottom < top + Math.min(24, rect.height) || rect.right <= viewport.left || rect.left >= viewport.right) return false
  const x = Math.max(viewport.left + 1, Math.min((rect.left + rect.right) / 2, viewport.right - 1))
  const hit = doc.elementFromPoint(x, Math.min(rect.bottom - 2, bottom - 2))
  return !!hit && node.contains(hit)
}

export function createReadDwell(markRead, delay = 1000) {
  let since = null
  let done = false
  return (visible, now) => {
    if (done) return
    if (!visible) { since = null; return }
    if (since === null) since = now
    if (now - since >= delay) { done = true; markRead() }
  }
}
