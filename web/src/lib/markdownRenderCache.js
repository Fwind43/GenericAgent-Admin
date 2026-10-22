import { parseBlocks } from './markdown.js'

// Cache only immutable, unscoped ASTs. Footnote IDs remain per-render.
export function createMarkdownBlockCache({ maxEntries = 128, maxChars = 512 * 1024, parse = parseBlocks } = {}) {
  const entries = new Map()
  let chars = 0
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze)
      Object.freeze(value)
    }
    return value
  }
  return (text = '') => {
    const key = String(text ?? '')
    if (entries.has(key)) {
      const value = entries.get(key)
      entries.delete(key)
      entries.set(key, value)
      return value
    }
    const value = parse(key)
    if (!key.length || key.length > maxChars || maxEntries < 1) return value
    while (entries.size >= maxEntries || chars + key.length > maxChars) {
      const oldest = entries.keys().next().value
      chars -= oldest.length
      entries.delete(oldest)
    }
    entries.set(key, freeze(value))
    chars += key.length
    return value
  }
}

export const parseMarkdownBlocksCached = createMarkdownBlockCache()
