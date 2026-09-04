export const MARKDOWN_CHAR_LIMIT = 70000
export const MARKDOWN_LINE_LIMIT = 1200
export const MARKDOWN_BLOCK_LIMIT = 360
export const LIST_ITEM_LIMIT = 240
export const LONG_TEXT_PREVIEW_CHARS = 18000
export const JSON_TREE_CHILD_LIMIT = 160
export const JSON_TREE_STRING_LIMIT = 1400

export const parseCodeFenceInfo = (info = '') => {
  const raw = String(info || '').trim()
  if (!raw) return { lang: '', filename: '' }

  // 1) Explicit filename="..." or title="..." or file="..."
  const explicitMatch = raw.match(/(?:title|filename|file)=["']([^"']+)["']/i)
  let filename = explicitMatch ? explicitMatch[1].trim() : ''
  let rest = explicitMatch ? (raw.slice(0, explicitMatch.index) + ' ' + raw.slice(explicitMatch.index + explicitMatch[0].length)).trim() : raw

  // 2) Colon separator: `lang:filename` e.g. `text:test_render_doc.txt` or `python:src/main.py`
  if (!filename) {
    const colonIdx = rest.indexOf(':')
    if (colonIdx !== -1) {
      const candidateLang = rest.slice(0, colonIdx).trim()
      const candidateName = rest.slice(colonIdx + 1).trim()
      if (candidateName) {
        return { lang: candidateLang, filename: candidateName }
      }
    }
  }

  // 3) Space separator: `lang filename.ext` e.g. `python app.py`
  if (!filename) {
    const tokens = rest.split(/\s+/)
    if (tokens.length >= 2 && tokens[1].includes('.')) {
      filename = tokens[1]
      rest = tokens[0]
    }
  }

  const lang = rest.split(/\s+/)[0] || ''
  return { lang, filename }
}

export const splitMarkdownParts = (text = '') => {
  const src = String(text || '')
  const parts = []
  const closedFenceRe = /(`{3,})([^\n`]*)\n?([\s\S]*?)\1/g
  let last = 0, match
  while ((match = closedFenceRe.exec(src)) !== null) {
    if (match.index > last) parts.push({ type:'text', text:src.slice(last, match.index) })
    const rawInfo = (match[2] || '').trim()
    const { lang, filename } = parseCodeFenceInfo(rawInfo)
    parts.push({ type:'code', fence:match[1], rawInfo, lang, filename, text:match[3] || '', closed:true })
    last = closedFenceRe.lastIndex
  }
  if (last < src.length) {
    const tail = src.slice(last)
    const open = /(^|\n)(`{3,})([^\n`]*)\n?/.exec(tail)
    if (open) {
      const fenceAt = open.index + open[1].length
      if (fenceAt > 0) parts.push({ type:'text', text:tail.slice(0, fenceAt) })
      const rawInfo = (open[3] || '').trim()
      const { lang, filename } = parseCodeFenceInfo(rawInfo)
      parts.push({ type:'code', fence:open[2], rawInfo, lang, filename, text:tail.slice(open.index + open[0].length), closed:false })
    } else {
      parts.push({ type:'text', text:tail })
    }
  }
  if (!parts.length) parts.push({ type:'text', text:src })
  return parts
}

export const isToolResultText = (text = '') => /^\s*\[(Action|Status|Info|Stdout|Stderr|Result|Output)\]/mi.test(String(text || ''))


export const FINAL_MARKER_RE = /^```+\s*\n?\[Info\]\s*Final response to user\.\s*\n?```+\s*$/i
export const TURN_HEADER_RE = /^\s*(?:\*\*)?\s*LLM Running\s*\(Turn\s+(\d+)\)\s*(?:\.\.\.)?\s*(?:\*\*)?\s*$/i
const FENCE_LINE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const FINAL_INFO_LINE_RE = /^\s*\[Info\]\s*Final response to user\.\s*$/i
const FINAL_OPEN_FENCE_RE = /^\s*```+\s*$/
const FINAL_INLINE_RE = /^\s*```+\s*\[Info\]\s*Final response to user\.\s*```+\s*$/i

export const cleanAssistantRunBody = (s = '') => String(s || '')
  .replace(/<summary>[\s\S]*?<\/summary>/gi, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

// A summary at the very start is transport metadata even when a lightweight
// response (for example /btw) has no "LLM Running" marker. Keep later tags so
// genuine Markdown/HTML examples in the answer are not silently removed.
const parseAssistantFinalBody = (s = '') => {
  const normalized = String(s || '').replace(/\n{3,}/g, '\n\n')
  const match = normalized.match(/^\s*<summary>([\s\S]*?)<\/summary>\s*/i)
  return {
    summary: match?.[1]?.trim() || '',
    body: (match ? normalized.slice(match[0].length) : normalized).trim(),
  }
}

export const cleanAssistantFinalBody = (s = '') => parseAssistantFinalBody(s).body

const findTopLevelAssistantMarkers = (full = '') => {
  const markers = []
  const lines = String(full || '').split('\n')
  const offsets = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }

  let fence = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const lineStart = offsets[i]
    const lineEnd = lineStart + line.length

    if (!fence) {
      const turnMatch = line.match(TURN_HEADER_RE)
      if (turnMatch) {
        markers.push({ type: 'turn', turn: Number(turnMatch[1]) || markers.length + 1, index: lineStart, end: lineEnd })
        continue
      }
      if (line.match(FINAL_INLINE_RE)) {
        markers.push({ type: 'final', index: lineStart, end: lineEnd })
        continue
      }
      if (line.match(FINAL_OPEN_FENCE_RE) && i + 2 < lines.length && lines[i + 1].match(FINAL_INFO_LINE_RE) && lines[i + 2].match(FINAL_OPEN_FENCE_RE)) {
        markers.push({ type: 'final', index: lineStart, end: offsets[i + 2] + lines[i + 2].length })
        i += 2
        continue
      }
    }

    const fenceMatch = line.match(FENCE_LINE_RE)
    if (fenceMatch) {
      const ticks = fenceMatch[2]
      const rest = fenceMatch[3]
      if (!fence) {
        fence = { char: ticks[0], length: ticks.length }
      } else if (ticks[0] === fence.char && ticks.length >= fence.length && !rest.trim()) {
        fence = null
      }
    }
  }
  return markers
}

const TURN_TITLE_LIMIT = 88

const compactTurnTitle = (value = '') => {
  const text = String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+] |\d+[.)] )\s*/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= TURN_TITLE_LIMIT) return text
  return `${text.slice(0, TURN_TITLE_LIMIT - 1).trimEnd()}…`
}

export const assistantTurnFallbackTitle = (chunk = '', turn = '') => {
  const source = String(chunk || '')
  const toolNames = []
  const addTool = (name = '') => {
    const clean = String(name || '').trim().replace(/^`+|`+$/g, '')
    if (clean && !toolNames.includes(clean)) toolNames.push(clean)
  }
  for (const line of source.split('\n')) {
    let match = line.trim().match(/^🛠️?\s*Tool:\s*`?([^`\s📥(]+)`?/i)
    if (!match) match = line.trim().match(/^🛠️?\s+([\w.-]+)\s*\(/i)
    if (match) addTool(match[1])
  }
  if (toolNames.length) {
    const visible = toolNames.slice(0, 3).join(' · ')
    return toolNames.length > 3 ? `${visible} +${toolNames.length - 3}` : visible
  }

  let fenced = false
  for (const rawLine of cleanAssistantRunBody(source).split('\n')) {
    const line = rawLine.trim()
    if (/^(?:```|~~~)/.test(line)) { fenced = !fenced; continue }
    if (fenced || !line) continue
    if (/^(?:🛠️?|📥|📤|\[Info\]|\[Result\]|\[ROUND END\]|\{\s*$|\}\s*$)/i.test(line)) continue
    const title = compactTurnTitle(line)
    if (title) return title
  }
  return turn === '' ? '' : `Turn ${turn}`
}

export const parseAssistantContent = (raw = '') => {
  const full = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const markers = findTopLevelAssistantMarkers(full)
  const finalMarker = markers.find((m) => m.type === 'final')
  const turnMarkers = markers.filter((m) => m.type === 'turn' && (!finalMarker || m.index < finalMarker.index))
  const processEnd = finalMarker ? finalMarker.index : full.length
  const finalText = finalMarker ? full.slice(finalMarker.end) : ''
  const runs = []

  if (turnMarkers.length) {
    turnMarkers.forEach((m, i) => {
      const start = m.end
      const end = i + 1 < turnMarkers.length ? turnMarkers[i + 1].index : processEnd
      const chunk = full.slice(start, end).trim()
      const summary = chunk.match(/<summary>([\s\S]*?)<\/summary>/i)
      const title = summary?.[1]?.trim() || assistantTurnFallbackTitle(chunk, m.turn)
      runs.push({ turn: m.turn, title, body: cleanAssistantRunBody(chunk) })
    })
    const final = parseAssistantFinalBody(finalText || '')
    return { runs, ...final }
  }

  const final = parseAssistantFinalBody(full.replace(/^```+\s*\n?\[Info\]\s*Final response to user\.\s*\n?```+\s*$/gim, ''))
  return { runs: [], ...final }
}

const isBlankLine = (line = '') => /^[\t\f\v ]*$/.test(line)

export const textRenderStats = (text = '') => {
  const src = String(text || '')
  const normalized = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const parts = normalized.length ? normalized.split('\n') : []
  let standaloneNewlineLines = 0
  for (const line of parts) {
    if (isBlankLine(line)) standaloneNewlineLines += 1
  }
  const lines = parts.length
  const lineGuard = lines > MARKDOWN_LINE_LIMIT && standaloneNewlineLines > MARKDOWN_LINE_LIMIT
  return {
    chars: src.length,
    lines,
    linesLabel: String(lines),
    standaloneNewlineLines,
    tooLarge: src.length > MARKDOWN_CHAR_LIMIT || lineGuard,
  }
}

export const previewLongText = (text = '', limit = LONG_TEXT_PREVIEW_CHARS) => {
  const src = String(text || '')
  let head = src.slice(0, limit).replace(/\r\n/g, '\n').replace(/\n{8,}/g, '\n\n… 连续空行已折叠 …\n\n')
  if (src.length > limit) head += `\n\n… 已截断预览，完整内容 ${src.length.toLocaleString()} 字符，可复制全文。`
  return head
}
