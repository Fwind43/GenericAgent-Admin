// Markdown parsing for model output.
//
// This is deliberately not a full CommonMark implementation. It targets what
// LLMs actually emit, and it produces a plain AST so the React layer stays a
// dumb renderer and the parsing stays unit-testable.
//
// Fenced code blocks are NOT handled here: splitMarkdownParts() in
// chatTextSafety.js peels them off first so a fence that is still streaming can
// be rendered as a code card before its closing fence arrives.

export const INLINE_DEPTH_LIMIT = 6
export const BLOCK_DEPTH_LIMIT = 6

// Only these schemes may reach an href/src. React renders `javascript:` URLs
// with nothing more than a console warning, and model output is untrusted
// input, so an allowlist is the only safe default here.
const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'file'])

const ASCII_PUNCTUATION_RE = /[!-/:-@[-`{-~]/

// Checks if a path resembles a Windows drive path (e.g. C:\path or D:/path) or UNC (\\server\share)
const isWindowsPath = (str = '') => /^[a-zA-Z]:[\\/]/.test(str) || /^\\\\[^\\]/.test(str)

export const safeUrl = (raw = '') => {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''

  // Windows absolute paths (e.g. D:\dir\file.png or D:/dir/file.png or \\unc\path)
  // must be preserved with internal spaces intact, stripped only of control chars.
  if (isWindowsPath(trimmed)) {
    return trimmed.replace(/[\u0000-\u001f\u007f]+/g, '')
  }

  // Scheme test check for obfuscated payloads such as "java\tscript:alert(1)".
  // We strip internal whitespace & controls for scheme detection.
  const normalized = trimmed.replace(/[\u0000-\u0020\u007f]+/g, '')
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(normalized)
  if (!schemeMatch) {
    // Relative path, anchor "#...", or absolute Unix path "/..."
    // Strip control characters but preserve internal spaces.
    return trimmed.replace(/[\u0000-\u001f\u007f]+/g, '')
  }

  const scheme = schemeMatch[1].toLowerCase()
  if (ALLOWED_URL_SCHEMES.has(scheme)) {
    // Return original stripped of control characters
    return trimmed.replace(/[\u0000-\u001f\u007f]+/g, '')
  }
  return ''
}

/**
 * Extracts a normalized filesystem path if the given target is a local file path
 * (Windows drive path, UNC path, Unix root path, or file:// URL). Returns null otherwise.
 */
export const extractLocalFilePath = (rawPath = '') => {
  const src = String(rawPath || '').trim()
  if (!src) return null

  if (/^file:\/\//i.test(src)) {
    let stripped = src.replace(/^file:\/\//i, '')
    if (/^\/[a-zA-Z]:[\\/]/.test(stripped)) {
      stripped = stripped.slice(1)
    }
    try {
      stripped = decodeURIComponent(stripped)
    } catch {
      // ignore malformed URI
    }
    return stripped
  }

  if (isWindowsPath(src) || (src.startsWith('/') && !src.startsWith('//'))) {
    return src
  }

  return null
}

/**
 * Resolves an image source into a browser-renderable URL.
 * Local absolute paths (Windows drive, Unix absolute, UNC, or file://)
 * are proxied through `/api/files/image?path=...`.
 */
export const resolveMarkdownImageUrl = (rawSrc = '') => {
  const src = String(rawSrc || '').trim()
  if (!src) return ''

  // Already a proxy or web/data URL
  if (/^(?:https?:|\/\/|data:|\/api\/)/i.test(src)) {
    return src
  }

  const localPath = extractLocalFilePath(src)
  if (localPath) {
    return `/api/files/image?path=${encodeURIComponent(localPath)}`
  }

  return src
}

/**
 * Resolves a markdown link target.
 * If it points to a local file/directory path, returns an object:
 * { isLocal: true, href: '/api/files/download?path=...', localPath: '...', downloadName: '...' }
 * Otherwise returns:
 * { isLocal: false, href: src }
 */
export const resolveMarkdownLink = (rawHref = '') => {
  const href = String(rawHref || '').trim()
  if (!href) return { isLocal: false, href: '' }

  const localPath = extractLocalFilePath(href)
  if (localPath) {
    const downloadName = localPath.split(/[\\/]/).filter(Boolean).pop() || 'download'
    return {
      isLocal: true,
      href: `/api/files/download?path=${encodeURIComponent(localPath)}`,
      localPath,
      downloadName,
    }
  }

  return { isLocal: false, href }
}

const isAlphaNumeric = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch)

// Emphasis delimiters must hug their content. Without this, "2 * 3 * 4" and
// "a ** b" would turn into emphasis, which is a common way model output about
// arithmetic or globs gets mangled.
const opensEmphasis = (src, contentStart) => {
  const ch = src[contentStart]
  return !!ch && !/\s/.test(ch)
}

const closesEmphasis = (src, contentEnd) => {
  const ch = src[contentEnd - 1]
  return !!ch && !/\s/.test(ch)
}

// "_" additionally may not fire inside a word, otherwise identifiers like
// snake_case_name and __init__ get eaten.
const underscoreBoundaryOk = (src, openStart, closeEnd) =>
  !isAlphaNumeric(src[openStart - 1]) && !isAlphaNumeric(src[closeEnd])

const findClosingBracket = (src, start, open, close) => {
  let depth = 0
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '\\') { i += 1; continue }
    if (ch === '`') {
      const run = /^`+/.exec(src.slice(i))[0]
      const skipTo = src.indexOf(run, i + run.length)
      if (skipTo !== -1) { i = skipTo + run.length - 1; continue }
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      if (depth === 0) return i
      depth -= 1
    }
  }
  return -1
}

// Finds the next unescaped run of `ch` that is exactly `width` long, skipping
// code spans so a delimiter quoted inside backticks cannot close emphasis.
//
// Matching on exact run length is what lets "*outer **inner** outer*" resolve:
// a single-asterisk opener must skip the "**" runs entirely rather than treat
// their first character as its closer.
const findDelimiterRun = (src, from, ch, width) => {
  for (let i = from; i < src.length; i += 1) {
    const c = src[i]
    if (c === '\\') { i += 1; continue }
    if (c === '`' && ch !== '`') {
      const run = /^`+/.exec(src.slice(i))[0]
      const skipTo = src.indexOf(run, i + run.length)
      if (skipTo !== -1) { i = skipTo + run.length - 1; continue }
    }
    if (c !== ch) continue
    let end = i
    while (end < src.length && src[end] === ch) end += 1
    if (end - i === width) return i
    i = end - 1
  }
  return -1
}

// CommonMark: a code span with one leading and one trailing space has exactly
// one stripped from each end, which is how ``` `` ` `` ``` yields a lone backtick.
const normalizeCodeSpan = (value = '') => {
  if (value.length > 2 && value.startsWith(' ') && value.endsWith(' ') && value.trim()) {
    return value.slice(1, -1)
  }
  return value
}

const trimAutolinkTail = (url = '') => {
  let end = url.length
  while (end > 0) {
    const ch = url[end - 1]
    if ('.,;:!?"\''.includes(ch)) { end -= 1; continue }
    if (ch === ')') {
      const inner = url.slice(0, end)
      const opens = (inner.match(/\(/g) || []).length
      const closes = (inner.match(/\)/g) || []).length
      if (closes > opens) { end -= 1; continue }
    }
    break
  }
  return url.slice(0, end)
}

// Splits a link destination into url + optional title, tolerating <...> wrapping.
const splitLinkTarget = (raw = '') => {
  const target = String(raw || '').trim()
  const titled = target.match(/^([\s\S]*?)\s+["'(]([\s\S]*)["')]$/)
  const url = (titled ? titled[1] : target).trim().replace(/^<([\s\S]*)>$/, '$1')
  return { url, title: titled ? titled[2].trim() : '' }
}

const findInlineMathClose = (src, start) => {
  for (let close = src.indexOf('$', start); close !== -1; close = src.indexOf('$', close + 1)) {
    const inner = src.slice(start, close)
    if (inner.includes('\n') || inner.includes('`')) return -1
    if (src[close - 1] === '\\') continue
    // Inline math cannot contain an unescaped dollar. If this candidate cannot
    // close because it follows whitespace (for example the second price in
    // "$5 and $10"), do not jump across it to a later formula delimiter.
    if (src[close - 1] === '$' || src[close + 1] === '$' || /\s/.test(src[close - 1] || '')) return -1
    return close
  }
  return -1
}

/**
 * Parses inline markup into a recursive node tree.
 *
 * Node shapes: text{value} | code{value} | math{value,display} | br
 *              | strong/em/del{children} | link{href,title,children}
 *              | image{src,alt,title}
 */
export const parseInline = (text = '', options = {}) => {
  const depth = options.depth || 0
  const inLink = !!options.inLink
  const src = String(text ?? '')
  const out = []
  let buffer = ''
  let i = 0

  const flush = () => {
    if (buffer) { out.push({ type: 'text', value: buffer }); buffer = '' }
  }
  const descend = (inner, nextInLink = inLink) => parseInline(inner, { depth: depth + 1, inLink: nextInLink })

  // Past the depth limit everything is emitted verbatim rather than dropped, so
  // pathological nesting degrades to plain text instead of losing content.
  if (depth >= INLINE_DEPTH_LIMIT) return src ? [{ type: 'text', value: src }] : []

  while (i < src.length) {
    const ch = src[i]

    if (ch === '\\' && (src[i + 1] === '(' || src[i + 1] === '[')) {
      const display = src[i + 1] === '['
      const closeToken = display ? '\\]' : '\\)'
      const close = src.indexOf(closeToken, i + 2)
      const value = close === -1 ? '' : src.slice(i + 2, close)
      if (close !== -1 && value.trim() && !value.includes('\n')) {
        flush()
        out.push({ type: 'math', value, display })
        i = close + closeToken.length
        continue
      }
      // A delimiter that has not closed yet is common while a response is
      // streaming. Preserve it exactly instead of treating its backslash as a
      // Markdown escape.
      buffer += ch + src[i + 1]
      i += 2
      continue
    }

    if (ch === '$' && src[i - 1] !== '$' && src[i + 1] !== '$' && !/\s/.test(src[i + 1] || '')) {
      const close = findInlineMathClose(src, i + 1)
      if (close !== -1) {
        flush()
        out.push({ type: 'math', value: src.slice(i + 1, close), display: false })
        i = close + 1
        continue
      }
    }

    if (ch === '\\' && ASCII_PUNCTUATION_RE.test(src[i + 1] || '')) {
      buffer += src[i + 1]
      i += 2
      continue
    }

    if (ch === '`') {
      const run = /^`+/.exec(src.slice(i))[0]
      let searchFrom = i + run.length
      let close = -1
      while (searchFrom <= src.length - run.length) {
        const candidate = src.indexOf(run, searchFrom)
        if (candidate === -1) break
        // Reject a hit that is part of a longer backtick run.
        if (src[candidate + run.length] === '`') {
          searchFrom = candidate + /^`+/.exec(src.slice(candidate))[0].length
          continue
        }
        close = candidate
        break
      }
      if (close > i) {
        flush()
        out.push({ type: 'code', value: normalizeCodeSpan(src.slice(i + run.length, close)) })
        i = close + run.length
        continue
      }
    }

    if (ch === '<') {
      const br = /^<br\s*\/?>/i.exec(src.slice(i))
      if (br) {
        flush()
        out.push({ type: 'br' })
        i += br[0].length
        continue
      }
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(src.slice(i))
      if (auto && !inLink) {
        const href = safeUrl(auto[1])
        if (href) {
          flush()
          out.push({ type: 'link', href, title: '', children: [{ type: 'text', value: auto[1] }] })
          i += auto[0].length
          continue
        }
      }
    }

    // Images before links: "![alt](src)" also matches the link pattern from its
    // second character, which used to render as a stray "!" plus a link.
    if (ch === '!' && src[i + 1] === '[') {
      const labelEnd = findClosingBracket(src, i + 2, '[', ']')
      if (labelEnd !== -1 && src[labelEnd + 1] === '(') {
        const targetEnd = findClosingBracket(src, labelEnd + 2, '(', ')')
        if (targetEnd !== -1) {
          const { url, title } = splitLinkTarget(src.slice(labelEnd + 2, targetEnd))
          const source = safeUrl(url)
          const alt = src.slice(i + 2, labelEnd)
          flush()
          // A blocked source degrades to the alt text; the whole "![...](...)"
          // is consumed either way so a bare "!" cannot leak into the output.
          if (source) out.push({ type: 'image', src: source, alt, title })
          else if (alt) out.push({ type: 'text', value: alt })
          i = targetEnd + 1
          continue
        }
      }
    }

    if (ch === '[') {
      // Footnote reference: [^label]
      if (src[i + 1] === '^') {
        const fnEnd = findClosingBracket(src, i + 2, '[', ']')
        if (fnEnd !== -1) {
          const label = src.slice(i + 2, fnEnd).trim()
          if (label) {
            flush()
            out.push({ type: 'footnote_ref', label })
            i = fnEnd + 1
            continue
          }
        }
      }

      const labelEnd = findClosingBracket(src, i + 1, '[', ']')
      if (labelEnd !== -1 && src[labelEnd + 1] === '(') {
        const targetEnd = findClosingBracket(src, labelEnd + 2, '(', ')')
        if (targetEnd !== -1) {
          const { url, title } = splitLinkTarget(src.slice(labelEnd + 2, targetEnd))
          const href = safeUrl(url)
          const label = src.slice(i + 1, labelEnd)
          flush()
          // A blocked or empty destination degrades to the label text so the
          // content still reads correctly instead of vanishing.
          if (href && !inLink) out.push({ type: 'link', href, title, children: descend(label, true) })
          else out.push(...descend(label))
          i = targetEnd + 1
          continue
        }
      }
    }

    if (ch === '*' || ch === '_' || ch === '~') {
      const run = new RegExp(`^\\${ch}+`).exec(src.slice(i))[0]
      // "~" only means strikethrough when doubled; a single one is literal.
      // Longest run first so ***both*** nests instead of leaking a stray "*".
      const widths = ch === '~' ? [2] : [3, 2, 1]
      let matched = false
      for (const width of widths) {
        if (run.length < width) continue
        const contentStart = i + width
        const close = findDelimiterRun(src, contentStart, ch, width)
        if (close === -1 || close <= contentStart) continue
        if (!opensEmphasis(src, contentStart) || !closesEmphasis(src, close)) continue
        if (ch === '_' && !underscoreBoundaryOk(src, i, close + width)) continue
        const children = descend(src.slice(contentStart, close))
        flush()
        if (width === 3) out.push({ type: 'strong', children: [{ type: 'em', children }] })
        else out.push({ type: ch === '~' ? 'del' : width === 2 ? 'strong' : 'em', children })
        i = close + width
        matched = true
        break
      }
      if (matched) continue
    }

    if (!inLink && 'hHwW'.includes(ch) && (i === 0 || !isAlphaNumeric(src[i - 1]))) {
      const bare = /^(?:https?:\/\/|www\.)[^\s<>[\]()]*(?:\([^\s<>[\]()]*\)[^\s<>[\]()]*)*/i.exec(src.slice(i))
      const matched = bare ? trimAutolinkTail(bare[0]) : ''
      // "www." needs a dot-separated host after it to count as a link.
      if (matched && (/^https?:\/\/\S/i.test(matched) || /^www\.[^\s.]+\.\S/i.test(matched))) {
        const href = safeUrl(/^www\./i.test(matched) ? `https://${matched}` : matched)
        if (href) {
          flush()
          out.push({ type: 'link', href, title: '', children: [{ type: 'text', value: matched }] })
          i += matched.length
          continue
        }
      }
    }

    buffer += ch
    i += 1
  }

  flush()
  return out
}

const BLANK_LINE_RE = /^[\t\f\v ]*$/
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const THEMATIC_BREAK_RE = /^ {0,3}([-*_])(?:[\t ]*\1){2,}[\t ]*$/
const BLOCKQUOTE_RE = /^ {0,3}>[\t ]?(.*)$/
const LIST_ITEM_RE = /^([\t ]*)([-*+]|\d{1,9}[.)])([\t ]+|$)(.*)$/
const TASK_MARKER_RE = /^\[([ xX])\][\t ]+(.*)$/

const expandIndent = (raw = '') => {
  let width = 0
  for (const ch of raw) width += ch === '\t' ? 4 - (width % 4) : 1
  return width
}

const splitTableRow = (line = '') => {
  let src = String(line || '').trim()
  if (src.startsWith('|')) src = src.slice(1)
  if (src.endsWith('|') && !src.endsWith('\\|')) src = src.slice(0, -1)
  const cells = []
  let cur = ''
  let escaped = false
  for (const ch of src) {
    if (escaped) { cur += ch; escaped = false; continue }
    if (ch === '\\') { escaped = true; cur += ch; continue }
    if (ch === '|') { cells.push(cur.trim().replace(/\\\|/g, '|')); cur = ''; continue }
    cur += ch
  }
  cells.push(cur.trim().replace(/\\\|/g, '|'))
  return cells
}

const parseTableAlign = (cell = '') => {
  const s = String(cell || '').trim()
  if (!/^:?-+:?$/.test(s)) return null
  if (s.startsWith(':') && s.endsWith(':')) return 'center'
  if (s.endsWith(':')) return 'right'
  return 'left'
}

const isTableDelimiterRow = (line = '') => {
  if (!line || !line.includes('-')) return false
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => parseTableAlign(cell) !== null)
}

export const parseTableRows = (lines = []) => {
  if (lines.length < 2) return null
  const head = splitTableRow(lines[0])
  if (!head.length || !isTableDelimiterRow(lines[1])) return null
  const parsed = splitTableRow(lines[1]).map(parseTableAlign)
  // A delimiter row whose cell count disagrees with the header used to reject
  // the whole table and dump raw pipes into a paragraph. Pad instead.
  const aligns = head.map((_, idx) => parsed[idx] || 'left')
  const rows = lines.slice(2).map(splitTableRow).filter((cells) => cells.length > 0)
  return { type: 'table', head, aligns, rows }
}

/**
 * Parses block-level markdown into a flat list of nodes.
 *
 * Node shapes: paragraph{text} | heading{depth,text} | hr | math{value,display}
 *              | table{head,aligns,rows} | blockquote{blocks}
 *              | list{ordered,start,tight,items:[{checked,blocks}]}
 *
 * Inline content is kept as a raw string; the renderer runs it through
 * parseInline so it can also expand app-specific tokens such as [FILE:...].
 */
const FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:\s*(.*)$/

export const parseBlocks = (text = '', depth = 0) => {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  const footnotes = []
  let paragraph = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    const value = paragraph.join('\n').trim()
    if (value) blocks.push({ type: 'paragraph', text: value })
    paragraph = []
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    if (BLANK_LINE_RE.test(line)) { flushParagraph(); continue }

    const trimmed = line.trim()
    const displayDelimiter = trimmed.startsWith('$$')
      ? { open: '$$', close: '$$' }
      : (trimmed.startsWith('\\[') ? { open: '\\[', close: '\\]' } : null)
    if (displayDelimiter) {
      const { open, close } = displayDelimiter
      const mathLines = []
      let cursor = i
      let rest = trimmed.slice(open.length)
      let closed = false
      while (cursor < lines.length) {
        const closeAt = rest.lastIndexOf(close)
        if (closeAt !== -1 && !rest.slice(closeAt + close.length).trim()) {
          mathLines.push(rest.slice(0, closeAt))
          closed = true
          break
        }
        mathLines.push(rest)
        cursor += 1
        rest = lines[cursor] || ''
      }
      const value = mathLines.join('\n').trim()
      if (closed && value) {
        flushParagraph()
        blocks.push({ type: 'math', value, display: true })
        i = cursor
        continue
      }
    }

    const heading = line.match(HEADING_RE)
    if (heading) {
      flushParagraph()
      blocks.push({ type: 'heading', depth: heading[1].length, text: heading[2] })
      continue
    }

    // Checked before lists so that "---" and "***" stay rules instead of
    // becoming empty bullet items.
    if (THEMATIC_BREAK_RE.test(line)) {
      flushParagraph()
      blocks.push({ type: 'hr' })
      continue
    }

    if (line.includes('|') && isTableDelimiterRow(lines[i + 1] || '')) {
      const tableLines = [line, lines[i + 1]]
      let j = i + 2
      while (j < lines.length && lines[j].includes('|') && !BLANK_LINE_RE.test(lines[j])) {
        tableLines.push(lines[j])
        j += 1
      }
      const table = parseTableRows(tableLines)
      if (table) {
        flushParagraph()
        blocks.push(table)
        i = j - 1
        continue
      }
    }

    if (depth < BLOCK_DEPTH_LIMIT && BLOCKQUOTE_RE.test(line)) {
      flushParagraph()
      const quoted = []
      let j = i
      while (j < lines.length) {
        const match = lines[j].match(BLOCKQUOTE_RE)
        if (match) { quoted.push(match[1]); j += 1; continue }
        // Lazy continuation: an unmarked, non-blank line still belongs to the
        // quote as long as it is not starting a new construct.
        if (!BLANK_LINE_RE.test(lines[j]) && quoted.length && !HEADING_RE.test(lines[j])
          && !THEMATIC_BREAK_RE.test(lines[j]) && !LIST_ITEM_RE.test(lines[j])) {
          quoted.push(lines[j])
          j += 1
          continue
        }
        if (BLANK_LINE_RE.test(lines[j]) && (lines[j + 1] || '').match(BLOCKQUOTE_RE)) {
          quoted.push('')
          j += 1
          continue
        }
        break
      }
      blocks.push({ type: 'blockquote', blocks: parseBlocks(quoted.join('\n'), depth + 1) })
      i = j - 1
      continue
    }

    const item = line.match(LIST_ITEM_RE)
    if (item && depth < BLOCK_DEPTH_LIMIT) {
      flushParagraph()
      const consumed = collectList(lines, i, depth)
      blocks.push(consumed.list)
      i = consumed.nextIndex - 1
      continue
    }

    const fnDef = line.match(FOOTNOTE_DEF_RE)
    if (fnDef) {
      flushParagraph()
      const label = fnDef[1].trim()
      const fnLines = [fnDef[2]]
      let j = i + 1
      while (j < lines.length) {
        const nextLine = lines[j]
        if (BLANK_LINE_RE.test(nextLine)) {
          if (j + 1 < lines.length && /^( {2,}|\t)/.test(lines[j + 1])) {
            fnLines.push('')
            j += 1
            continue
          }
          break
        }
        if (/^( {2,}|\t)/.test(nextLine)) {
          fnLines.push(nextLine.replace(/^( {2,}|\t)/, ''))
          j += 1
          continue
        }
        break
      }
      footnotes.push({ label, text: fnLines.join('\n').trim() })
      i = j - 1
      continue
    }

    paragraph.push(line)
  }

  flushParagraph()
  if (footnotes.length > 0) {
    blocks.push({ type: 'footnotes', items: footnotes })
  }
  return blocks
}

const listMarkerKind = (marker = '') => (/^\d/.test(marker) ? 'ordered' : 'bullet')

// Gathers one list, splitting items by marker and letting indented content fall
// through to a recursive parseBlocks call — that is what makes nested lists,
// multi-line items and nested quotes work without special cases here.
const collectList = (lines, start, depth) => {
  const first = lines[start].match(LIST_ITEM_RE)
  const baseIndent = expandIndent(first[1])
  const ordered = listMarkerKind(first[2]) === 'ordered'
  const start1 = ordered ? Number(first[2].replace(/[^\d]/g, '')) || 1 : 1
  const items = []
  let loose = false
  let current = null
  let pendingBlank = false
  let i = start

  const closeItem = () => {
    if (current) items.push(current)
    current = null
  }

  while (i < lines.length) {
    const line = lines[i]

    if (BLANK_LINE_RE.test(line)) {
      // A blank line only ends the list if the next line is not more list
      // content; otherwise it marks the list as loose.
      const next = lines[i + 1]
      if (next === undefined) break
      const nextIsItem = LIST_ITEM_RE.test(next) && !THEMATIC_BREAK_RE.test(next)
      const nextIsIndented = !BLANK_LINE_RE.test(next) && expandIndent(/^[\t ]*/.exec(next)[0]) > baseIndent
      if (!nextIsItem && !nextIsIndented) break
      pendingBlank = true
      i += 1
      continue
    }

    if (THEMATIC_BREAK_RE.test(line)) break

    const match = line.match(LIST_ITEM_RE)
    const indent = expandIndent(/^[\t ]*/.exec(line)[0])

    if (match && indent <= baseIndent) {
      if (listMarkerKind(match[2]) !== (ordered ? 'ordered' : 'bullet')) break
      if (pendingBlank && current) loose = true
      pendingBlank = false
      closeItem()
      const task = match[4].match(TASK_MARKER_RE)
      current = {
        checked: task ? task[1].toLowerCase() === 'x' : null,
        contentIndent: indent + match[2].length + Math.max(1, expandIndent(match[3])),
        lines: [task ? task[2] : match[4]],
      }
      i += 1
      continue
    }

    if (!current) break

    // Continuation: indented content belongs to the open item, and an unindented
    // plain line is a lazy continuation of its paragraph.
    if (indent > baseIndent || (!match && !pendingBlank)) {
      if (pendingBlank) { current.lines.push(''); loose = true }
      pendingBlank = false
      const strip = Math.min(indent, current.contentIndent)
      current.lines.push(line.slice(countRawIndentChars(line, strip)))
      i += 1
      continue
    }

    break
  }

  closeItem()
  return {
    nextIndex: i,
    list: {
      type: 'list',
      ordered,
      start: start1,
      tight: !loose,
      items: items.map((entry) => ({
        checked: entry.checked,
        blocks: parseBlocks(entry.lines.join('\n'), depth + 1),
      })),
    },
  }
}

// Maps a tab-expanded indent width back to a raw character count so slicing a
// line does not cut into content when tabs are involved.
const countRawIndentChars = (line = '', targetWidth = 0) => {
  let width = 0
  for (let i = 0; i < line.length; i += 1) {
    if (width >= targetWidth) return i
    const ch = line[i]
    if (ch === '\t') width += 4 - (width % 4)
    else if (ch === ' ') width += 1
    else return i
  }
  return line.length
}
