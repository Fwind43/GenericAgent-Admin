const STORAGE_KEY = 'ga-admin-chat-session-drafts-v1'

function availableStorage(storage) {
  if (storage) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const instanceKey = value => String(value || '').trim()

function normalizeDraftEntry(value) {
  if (typeof value === 'string') {
    return value ? { text: value, updated_at: 0, instance_id: '' } : null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const text = typeof value.text === 'string' ? value.text : ''
  const attachments = Array.isArray(value.attachments) ? value.attachments.filter(file => file && typeof file.dataURL === 'string' && file.dataURL.startsWith('data:')) : []
  if (!text && !attachments.length && !value.attachment_key) return null
  const updatedAt = Number(value.updated_at)
  return {
    text,
    attachments,
    attachment_key: value.attachment_key || '',
    updated_at: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0,
    instance_id: instanceKey(value.instance_id),
  }
}

function readDraftMap(storage) {
  const target = availableStorage(storage)
  if (!target) return {}
  try {
    const parsed = JSON.parse(target.getItem(STORAGE_KEY) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).flatMap(([id, value]) => {
      const draft = id ? normalizeDraftEntry(value) : null
      return draft ? [[id, draft]] : []
    }))
  } catch {
    return {}
  }
}

function writeDraftMap(drafts, storage) {
  const target = availableStorage(storage)
  if (!target) return false
  try {
    if (Object.keys(drafts).length) target.setItem(STORAGE_KEY, JSON.stringify(drafts))
    else target.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export function listChatSessionDraftIds(storage, instanceId) {
  const requestedInstance = instanceId === undefined ? null : instanceKey(instanceId)
  return Object.entries(readDraftMap(storage))
    .filter(([, draft]) => requestedInstance === null || !draft.instance_id || draft.instance_id === requestedInstance)
    .map(([id]) => id)
}

export function loadChatSessionDraft(sessionId, storage, instanceId) {
  const id = String(sessionId || '').trim()
  if (!id) return ''
  const draft = readDraftMap(storage)[id]
  if (!draft) return ''
  const requestedInstance = instanceId === undefined ? null : instanceKey(instanceId)
  if (requestedInstance !== null && draft.instance_id && draft.instance_id !== requestedInstance) return ''
  return draft.text
}

export function loadChatSessionDraftAttachments(sessionId, storage, instanceId) {
  const draft = readDraftMap(storage)[String(sessionId || '').trim()]
  if (!draft || (instanceId !== undefined && draft.instance_id && draft.instance_id !== instanceKey(instanceId))) return []
  return draft.attachments || []
}

export function saveChatSessionDraft(sessionId, value, storage, instanceId = '', attachments = []) {
  const id = String(sessionId || '').trim()
  if (!id) return
  const drafts = readDraftMap(storage)
  const text = typeof value === 'string' ? value : String(value || '')
  if (text || attachments.length) {
    const previous = drafts[id]
    drafts[id] = {
      text,
      attachments,
      updated_at: previous?.text === text && JSON.stringify(previous.attachments || []) === JSON.stringify(attachments) && previous.updated_at > 0 ? previous.updated_at : Date.now(),
      instance_id: instanceKey(instanceId),
    }
  } else delete drafts[id]
  return writeDraftMap(drafts, storage)
}

export function mergeChatSessionDraftSessions(sessions, instanceId, storage) {
  const sourceSessions = Array.isArray(sessions) ? sessions : []
  const serverSessions = sourceSessions.filter(session => !session?.local_draft)
  const serverIDs = new Set(serverSessions.map(session => String(session?.id || '').trim()).filter(Boolean))
  const requestedInstance = instanceKey(instanceId)
  const draftSessions = Object.entries(readDraftMap(storage))
    .filter(([id, draft]) => id && !serverIDs.has(id) && (!draft.instance_id || draft.instance_id === requestedInstance))
    .sort((a, b) => b[1].updated_at - a[1].updated_at)
    .map(([id, draft]) => ({
      id,
      title: '',
      count: 0,
      updated_at: draft.updated_at > 0 ? new Date(draft.updated_at).toISOString() : '',
      local_draft: true,
    }))
  return draftSessions.concat(serverSessions)
}

export function clearChatSessionDrafts(sessionIds, storage) {
  const ids = Array.isArray(sessionIds) ? sessionIds : [sessionIds]
  const drafts = readDraftMap(storage)
  let changed = false
  for (const value of ids) {
    const id = String(value || '').trim()
    if (id && Object.prototype.hasOwnProperty.call(drafts, id)) {
      delete drafts[id]
      changed = true
    }
  }
  if (changed) writeDraftMap(drafts, storage)
}

export { STORAGE_KEY as CHAT_SESSION_DRAFTS_STORAGE_KEY }

// Large attachment payloads must never consume the small localStorage quota.
let databasePromise
let draftWrites = Promise.resolve()
const attachmentCache = new Map()
function cacheAttachments(key, files) {
  attachmentCache.clear()
  attachmentCache.set(key, files)
}
function attachmentDatabase() {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('ga-admin-chat-draft-attachments-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('attachments')
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); databasePromise = undefined }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Draft database is blocked'))
  }).catch(error => { databasePromise = undefined; throw error })
  return databasePromise
}
async function attachmentOperation(mode, operation) {
  const db = await attachmentDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attachments', mode)
    const request = operation(tx.objectStore('attachments'))
    tx.oncomplete = () => resolve(request?.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Draft transaction aborted'))
  })
}
function enqueueDraftWrite(operation) {
  const result = draftWrites.then(operation)
  draftWrites = result.catch(() => {})
  return result
}
export function saveChatSessionDraftAsync(sessionId, text, storage, instanceId = '', attachments = []) {
  return enqueueDraftWrite(async () => {
    const id = String(sessionId || '').trim()
    if (!id) return true
    const drafts = readDraftMap(storage)
    const previous = drafts[id]
    let key = ''
    try {
      if (attachments.length) {
        if (previous?.attachment_key && attachmentCache.get(previous.attachment_key) === attachments) {
          key = previous.attachment_key
        } else {
          key = JSON.stringify([instanceId, id, Date.now(), Math.random()])
          await attachmentOperation('readwrite', store => store.put(attachments, key))
        }
      }
      if (text || attachments.length) drafts[id] = {
        text, attachments: [], attachment_key: key, updated_at: Date.now(), instance_id: instanceKey(instanceId),
      }
      else delete drafts[id]
      if (!writeDraftMap(drafts, storage)) throw new Error('Draft index write failed')
      if (key) cacheAttachments(key, attachments)
      if (previous?.attachment_key && previous.attachment_key !== key) {
        attachmentCache.delete(previous.attachment_key)
        await attachmentOperation('readwrite', store => store.delete(previous.attachment_key)).catch(() => {})
      }
      return true
    } catch {
      if (key && key !== previous?.attachment_key) await attachmentOperation('readwrite', store => store.delete(key)).catch(() => {})
      return false
    }
  })
}
export async function loadChatSessionDraftAttachmentsAsync(sessionId, storage, instanceId) {
  await draftWrites
  const draft = readDraftMap(storage)[String(sessionId || '').trim()]
  if (!draft || (instanceId !== undefined && draft.instance_id && draft.instance_id !== instanceKey(instanceId))) return []
  if (!draft.attachment_key) return draft.attachments || []
  const files = await attachmentOperation('readonly', store => store.get(draft.attachment_key))
  if (!Array.isArray(files)) throw new Error('Draft attachments are unavailable')
  cacheAttachments(draft.attachment_key, files)
  return files
}
export function clearChatSessionDraftsAsync(sessionIds, storage) {
  return enqueueDraftWrite(async () => {
    const ids = Array.isArray(sessionIds) ? sessionIds : [sessionIds]
    const drafts = readDraftMap(storage)
    const keys = ids.map(id => drafts[id]?.attachment_key).filter(Boolean)
    for (const id of ids) delete drafts[id]
    if (!writeDraftMap(drafts, storage)) return false
    for (const key of keys) {
      attachmentCache.delete(key)
      await attachmentOperation('readwrite', store => store.delete(key)).catch(() => {})
    }
    return true
  })
}
