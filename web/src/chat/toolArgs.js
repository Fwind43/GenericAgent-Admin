import { ct } from './chatFormat.js'

// Match whole strings, allowing a legacy path's trailing slash before a JSON delimiter.
const preserveWindowsPathsInJson = value => value.replace(
  /"((?:\\[\s\S]|[^"\\])*(?:\\)?)"(?=\s*(?:[:,}\]]|$))/g,
  (token, content) => /^[A-Za-z]:(?:\\+[^"\\]*)+$/.test(content)
    ? `"${content.replace(/\\+/g, run => (run.length % 2 ? `${run}\\` : run))}"`
    : token,
)

const escapeJsonStringControlCharacters = value => {
  let result = ''
  let inString = false
  let escaped = false
  for (const char of value) {
    if (!inString) {
      result += char
      if (char === '"') inString = true
      continue
    }
    if (escaped) {
      // Legacy receipts may contain a literal backslash followed by a raw newline.
      // Preserve both characters rather than leaving an invalid JSON escape.
      result += char.charCodeAt(0) < 0x20
        ? '\\' + JSON.stringify(char).slice(1, -1)
        : char
      escaped = false
      continue
    }
    if (char === '\\') {
      result += char
      escaped = true
      continue
    }
    if (char === '"') {
      result += char
      inString = false
      continue
    }
    const escapedControl = {
      '\b': '\\b',
      '\f': '\\f',
      '\n': '\\n',
      '\r': '\\r',
      '\t': '\\t',
    }[char]
    result += escapedControl || (char.charCodeAt(0) < 0x20
      ? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
      : char)
  }
  return result
}

const parseToolArgumentJsonText = value => {
  const prepared = preserveWindowsPathsInJson(String(value || '').trim())
  try {
    return JSON.parse(prepared)
  } catch {
    try { return JSON.parse(escapeJsonStringControlCharacters(prepared)) } catch { return undefined }
  }
}

export const parseToolReceiptArgs = (body = '') => {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body
  const parsed = parseToolArgumentJsonText(body)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

const parseNestedToolArgumentJson = value => {
  const trimmed = value.trim()
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) return value
  const parsed = parseToolArgumentJsonText(trimmed)
  return parsed === undefined ? value : parsed
}

export const normalizeToolArgumentValue = value => (
  typeof value === 'string' ? parseNestedToolArgumentJson(value) : value
)

const TOOL_RESULT_MARKER_RE = /^\[(Action|Status|Stdout|Stderr)\](?:[ \t]*(.*))?$/i

export const parseToolResultDetails = (body = '') => {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n')
  const sections = []
  let current = null

  for (const line of lines) {
    const marker = line.match(TOOL_RESULT_MARKER_RE)
    if (marker) {
      current = { kind: marker[1].toLowerCase(), content: marker[2] || '' }
      sections.push(current)
      continue
    }
    if (!current) {
      if (line.trim()) return null
      continue
    }
    current.content += `${current.content ? '\n' : ''}${line}`
  }

  if (!sections.length || !sections.some(section => section.kind === 'action' || section.kind === 'status')) return null
  sections.forEach(section => { section.content = section.content.replace(/\n+$/, '') })
  return sections
}

export const toolResultState = sections => {
  const status = sections.find(section => section.kind === 'status')?.content || ''
  const exitCode = status.match(/Exit Code:\s*(-?\d+)/i)?.[1]
  if (exitCode != null) return Number(exitCode) === 0 ? 'success' : 'error'
  if (/[\u2705\u2714]/u.test(status)) return 'success'
  if (/[\u274c\u2716]|\b(?:error|failed|failure)\b/i.test(status)) return 'error'
  return 'neutral'
}

const receiptBaseName = (value = '') => String(value || '').split(/[\\/]/).filter(Boolean).pop() || ''

export const toolReceiptSummary = fold => {
  const rawTool = String(fold?.label || '').trim()
  const tool = rawTool.split('.').filter(Boolean).pop() || rawTool
  const args = parseToolReceiptArgs(fold?.body)
  const complete = Object.prototype.hasOwnProperty.call(fold || {}, 'result') && !fold?.resultLive
  const state = fold?.resultLive ? 'live' : complete ? 'complete' : 'pending'
  const status = state === 'live' ? ct('执行中', 'Running') : ''
  const typeByTool = {
    file_read: [ct('读取', 'Read'), args.path && `${receiptBaseName(args.path)}${args.start ? ` · L${args.start}-${Number(args.start) + Math.max(Number(args.count) || 1, 1) - 1}` : ''}`],
    file_patch: [ct('编辑', 'Edit'), receiptBaseName(args.path)],
    file_write: [ct('写入', 'Write'), receiptBaseName(args.path)],
    code_run: [ct('执行', 'Run'), args.type || args.cwd || ''],
    web_scan: [ct('浏览', 'Browse'), ct('页面内容', 'Page content')],
    web_execute_js: [ct('浏览', 'Browse'), 'JavaScript'],
    ask_user: [ct('询问', 'Ask'), args.question || ct('等待回复', 'Awaiting reply')],
  }
  const [kind, target] = typeByTool[tool] || [ct('工具', 'Tool'), receiptBaseName(args.path || args.file || args.cwd || '')]
  return { kind, tool, status, state, target }
}

export const parseToolCallBlock = (block = '') => {
  const text = String(block || '').trim()
  const tool = text.match(/^🛠️\s*Tool:\s*([\s\S]*)$/i)
  if (!tool) return null
  const rest = (tool[1] || '').trim()
  const argsMarker = rest.match(/📥\s*args\s*:/i)
  const cleanName = (name = '') => String(name || '').trim().replace(/^`+|`+$/g, '')
  if (!argsMarker) return { name: cleanName(rest), args: '' }
  const markerIndex = argsMarker.index || 0
  return {
    name: cleanName(rest.slice(0, markerIndex)),
    args: rest.slice(markerIndex + argsMarker[0].length).trim(),
  }
}

export const parseToolArgsBlock = (block = '') => {
  const m = String(block || '').trim().match(/^📥\s*args:\s*([\s\S]*)$/i)
  return m ? (m[1] || '').trim() : null
}

// Re-escape literal control chars inside JSON strings (backend sometimes pretty-prints with real newlines)
function reescapeControlChars(text) {
  const MAP = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }
  const out = []
  let inStr = false, esc = false
  for (const ch of text) {
    if (!inStr) {
      if (ch === '"') inStr = true
      out.push(ch)
      continue
    }
    if (esc) {
      out.push(MAP[ch] || ch)
      esc = false
      continue
    }
    if (ch === '\\') {
      out.push(ch)
      esc = true
      continue
    }
    if (ch === '"') {
      out.push(ch)
      inStr = false
      continue
    }
    out.push(MAP[ch] || ch)
  }
  return out.join('')
}

// Parse file_write/file_patch tool arguments
// GA occasionally streams a JSON array/object where `content` should be a
// string, and the poisoned payload is already persisted inside session files.
// Rendering must therefore never assume a string: normalise to text while
// keeping every meaningful piece, instead of crashing on `.split`.
export function normalizeFileToolText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(item => {
      if (item == null) return ''
      if (typeof item === 'string') return item
      if (typeof item === 'object') {
        try { return JSON.stringify(item) } catch { return String(item) }
      }
      return String(item)
    }).join('\n')
  }
  if (typeof value === 'object') {
    try { return JSON.stringify(value, null, 2) } catch { return String(value) }
  }
  return String(value)
}

export function parseFileToolArgs(toolName, argsText) {
  const isFileWrite = /file_write$/i.test(toolName)
  const isFilePatch = /file_patch$/i.test(toolName)
  if (!isFileWrite && !isFilePatch) return null
  
  let parsed = null
  try {
    parsed = JSON.parse(argsText || '{}')
  } catch (e) {
    // Retry with control-char escaping for malformed pretty-printed JSON
    try {
      parsed = JSON.parse(reescapeControlChars(argsText || '{}'))
    } catch (e2) {
      // Final fallback: XML-style parameter tags
      const pathMatch = argsText?.match(/<parameter name="path">([^<]+)<\/antml:parameter>/i)
      const contentMatch = argsText?.match(/<parameter name="content">([^]*?)<\/antml:parameter>/i)
      const oldMatch = argsText?.match(/<parameter name="old_content">([^]*?)<\/antml:parameter>/i)
      const newMatch = argsText?.match(/<parameter name="new_content">([^]*?)<\/antml:parameter>/i)
      const modeMatch = argsText?.match(/<parameter name="mode">([^<]+)<\/antml:parameter>/i)
      
      if (isFileWrite && pathMatch) {
        return {
          type: 'file_write',
          path: pathMatch[1],
          content: contentMatch?.[1] || '',
          mode: modeMatch?.[1] || 'overwrite'
        }
      }
      if (isFilePatch && pathMatch) {
        return {
          type: 'file_patch',
          path: pathMatch[1],
          old_content: oldMatch?.[1] || '',
          new_content: newMatch?.[1] || ''
        }
      }
      return null
    }
  }
  
  if (isFileWrite && parsed?.path) {
    return {
      type: 'file_write',
      path: normalizeFileToolText(parsed.path),
      content: normalizeFileToolText(parsed.content),
      mode: normalizeFileToolText(parsed.mode) || 'overwrite'
    }
  }
  if (isFilePatch && parsed?.path) {
    return {
      type: 'file_patch',
      path: normalizeFileToolText(parsed.path),
      old_content: normalizeFileToolText(parsed.old_content),
      new_content: normalizeFileToolText(parsed.new_content)
    }
  }
  return null
}
