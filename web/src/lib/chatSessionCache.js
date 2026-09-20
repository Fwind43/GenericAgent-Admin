import { parseApiResponse } from './api.js'

// Bound retained snapshots by serialized UTF-16 size, not total JS heap usage.
export function createChatSessionCache({ maxBytes = 64 * 1024 * 1024, maxEntries = 8 } = {}) {
  const entries = new Map()
  let bytes = 0
  let generation = 0
  const remove = key => {
    const entry = entries.get(key)
    if (entry) bytes -= entry.bytes
    entries.delete(key)
  }
  const clear = () => { generation++; entries.clear(); bytes = 0 }
  const load = async (url, { fetcher = fetch, signal } = {}) => {
    const epoch = generation
    const entry = entries.get(url)
    const response = await fetcher(url, {
      signal, cache: 'no-store',
      headers: entry ? { 'If-None-Match': entry.etag } : {},
    })
    const checkCurrent = () => {
      if (signal?.aborted || epoch !== generation) throw new DOMException('Session request superseded', 'AbortError')
    }
    checkCurrent()
    if (response.status === 304) {
      if (!entry) throw new Error('Session cache validation returned 304 without a snapshot')
      if (entries.get(url) === entry) {
        entries.delete(url)
        entries.set(url, entry)
      }
      return entry.text ? JSON.parse(entry.text) : null
    }
    const text = await response.text()
    const data = await parseApiResponse({
      ok: response.ok, status: response.status, statusText: response.statusText,
      text: async () => text,
    }, url)
    checkCurrent()
    const etag = response.headers.get('ETag')
    const size = text.length * 2
    remove(url)
    if (etag && maxEntries > 0 && size <= maxBytes) {
      while (entries.size && (entries.size >= maxEntries || bytes + size > maxBytes)) remove(entries.keys().next().value)
      // Retain immutable wire text, not the mutable object handed to callers.
      // A 200 already parsed a fresh view; cloning it again is redundant.
      entries.set(url, { etag, text, bytes: size })
      bytes += size
      return data
    }
    return data
  }
  return { load, clear }
}
