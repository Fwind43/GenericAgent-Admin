/**
 * Agent protocol text parser (aligned with GA official Tauri desktop app.js)
 * 
 * Protocol format:
 * - Tool call: 🛠️ Tool: `name` + ```text fence + body + close fence
 * - Tool result: ````` (5+ backticks) + body + close fence
 * - Thinking: <thinking>...</thinking>
 * - Function calls (legacy): <function_calls>...</function_calls>
 * - Function results (legacy): <function_results>...</function_results>
 */

/**
 * Parse agent fence line (```{n}text or ```{n})
 * @param {string} line
 * @returns {{ticks: number, tag: string} | null}
 */
function parseAgentFenceLine(line) {
  const m = /^[ \t]*(`{3,})([^\n`]*)[ \t]*$/.exec(line ?? '')
  if (!m) return null
  return { ticks: m[1].length, tag: m[2].trim() }
}

/**
 * Check if line is agent structure boundary
 * @param {string} line
 * @param {{forToolResult?: boolean}} opts
 * @returns {boolean}
 */
function isAgentStructureBoundaryLine(line, opts) {
  if (/^🛠️ Tool:/.test(line)) return true
  // Inside tool result zone: 5-tick fences are open/close, not boundaries
  if (!opts || !opts.forToolResult) {
    const f = parseAgentFenceLine(line)
    if (f && f.ticks >= 5 && f.tag === '') return true
  }
  if (/^\*\*LLM Running \(Turn \d+\)/.test(line)) return true
  if (/^<thinking>/i.test(line)) return true
  return false
}

/**
 * Find next agent structure line index
 * @param {string[]} lines
 * @param {number} from
 * @param {{forToolResult?: boolean}} opts
 * @returns {number}
 */
function indexOfNextAgentStructureLine(lines, from, opts) {
  for (let i = from; i < lines.length; i++) {
    if (isAgentStructureBoundaryLine(lines[i], opts)) return i
  }
  return lines.length
}

/**
 * Find last fence close line index in zone
 * @param {string[]} lines
 * @param {number} from
 * @param {number} toExclusive
 * @param {number} tickCount
 * @returns {number}
 */
function lastFenceCloseLineIndex(lines, from, toExclusive, tickCount) {
  let last = -1
  for (let i = from; i < toExclusive; i++) {
    const f = parseAgentFenceLine(lines[i])
    if (f && f.ticks === tickCount && f.tag === '') last = i
  }
  return last
}

/**
 * Parse tool call block
 * @param {string[]} lines
 * @param {number} i
 * @returns {{name: string, body: string, nextLine: number} | null}
 */
function parseToolCallBlock(lines, i) {
  const m = /^🛠️ Tool: `([^`]+)`/.exec(lines[i] || '')
  if (!m) return null
  const open = parseAgentFenceLine(lines[i + 1])
  if (!open || open.tag !== 'text') return null
  const bodyStart = i + 2
  const zoneEnd = indexOfNextAgentStructureLine(lines, bodyStart)
  const closeIdx = lastFenceCloseLineIndex(lines, bodyStart, zoneEnd, open.ticks)
  if (closeIdx < 0) return null
  return {
    name: m[1],
    body: lines.slice(bodyStart, closeIdx).join('\n'),
    nextLine: closeIdx + 1,
  }
}

/**
 * Parse tool result block
 * @param {string[]} lines
 * @param {number} i
 * @returns {{body: string, nextLine: number} | null}
 */
function parseToolResultBlock(lines, i) {
  const open = parseAgentFenceLine(lines[i])
  if (!open || open.ticks < 5 || open.tag !== '') return null
  const bodyStart = i + 1
  const zoneEnd = indexOfNextToolResultZoneEnd(lines, bodyStart)
  const closeIdx = lastFenceCloseLineIndex(lines, bodyStart, zoneEnd, open.ticks)
  if (closeIdx < 0) return null
  return {
    body: lines.slice(bodyStart, closeIdx).join('\n'),
    nextLine: closeIdx + 1,
  }
}

/**
 * Tool result zone end (5-tick fences not treated as boundaries)
 * @param {string[]} lines
 * @param {number} from
 * @returns {number}
 */
function indexOfNextToolResultZoneEnd(lines, from) {
  return indexOfNextAgentStructureLine(lines, from, { forToolResult: true })
}

/**
 * Parse in-flight (unclosed) tool call
 * @param {string[]} lines
 * @param {number} i
 * @returns {{name: string, body: string, nextLine: number} | null}
 */
function parseInFlightToolCall(lines, i) {
  if (parseToolCallBlock(lines, i)) return null
  const m = /^🛠️ Tool: `([^`]+)`/.exec(lines[i] || '')
  if (!m) return null
  const open = parseAgentFenceLine(lines[i + 1])
  let bodyStart, zoneEnd
  if (open && open.tag === 'text') {
    bodyStart = i + 2
    zoneEnd = indexOfNextAgentStructureLine(lines, bodyStart)
    if (lastFenceCloseLineIndex(lines, bodyStart, zoneEnd, open.ticks) >= 0) return null
  } else {
    bodyStart = i + 1
    zoneEnd = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      if (isAgentStructureBoundaryLine(lines[j])) { zoneEnd = j; break }
    }
  }
  return {
    name: m[1],
    body: lines.slice(bodyStart, zoneEnd).join('\n'),
    nextLine: zoneEnd,
  }
}

/**
 * Parse in-flight (unclosed) tool result
 * @param {string[]} lines
 * @param {number} i
 * @returns {{body: string, nextLine: number} | null}
 */
function parseInFlightToolResult(lines, i) {
  if (parseToolResultBlock(lines, i)) return null
  const open = parseAgentFenceLine(lines[i])
  if (!open || open.ticks < 5 || open.tag !== '') return null
  const bodyStart = i + 1
  const zoneEnd = indexOfNextToolResultZoneEnd(lines, bodyStart)
  return {
    body: lines.slice(bodyStart, zoneEnd).join('\n'),
    nextLine: zoneEnd,
  }
}

function markdownFenceEnd(lines, start, insideThinking = false) {
  const fence = /^ {0,3}(`{3,}|~{3,})/.exec(lines[start])
  if (!fence) return null
  // Bare five-backtick fences belong to the tool-result protocol, even live.
  if (!insideThinking && /^`{5,}\s*$/.test(lines[start])) return null
  const close = new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}\\s*$')
  for (let end = start + 1; end < lines.length; end++) {
    if (close.test(lines[end])) return end + 1
  }
  return lines.length
}

function thinkingTagIndex(line, closing = false) {
  const tokens = /\\.|`+|<\/?thinking>/gi
  const tag = closing ? '</thinking>' : '<thinking>'
  let token
  while ((token = tokens.exec(line))) {
    if (token[0][0] === '`') {
      const ticks = /`+/g
      ticks.lastIndex = tokens.lastIndex
      let end
      while ((end = ticks.exec(line))) {
        if (end[0].length === token[0].length) {
          tokens.lastIndex = ticks.lastIndex
          break
        }
      }
    } else if (token[0].toLowerCase() === tag) return token.index
  }
  return -1
}

// Each caller owns its line array. Keep any same-line suffix for the next pass.
function parseThinkingBlock(lines, start) {
  if (/^(?: {4}|\t)/.test(lines[start])) return null
  const opening = thinkingTagIndex(lines[start])
  if (opening < 0) return null
  const prefix = lines[start].slice(0, opening)
  const body = []
  for (let end = start; end < lines.length; end++) {
    const line = end === start ? lines[end].slice(opening + '<thinking>'.length) : lines[end]
    const fenceEnd = end > start ? markdownFenceEnd(lines, end, true) : null
    if (fenceEnd !== null) {
      body.push(...lines.slice(end, fenceEnd))
      end = fenceEnd - 1
      continue
    }
    const close = thinkingTagIndex(line, true)
    if (close >= 0) {
      body.push(line.slice(0, close))
      const suffix = line.slice(close + '</thinking>'.length)
      lines[end] = suffix
      return { prefix, body: body.join('\n').trim(), live: false, nextLine: suffix.trim() ? end : end + 1 }
    }
    body.push(line)
  }
  // A closing tag may arrive across several stream deltas.
  const text = body.join('\n')
  const tagStart = text.lastIndexOf('<')
  const partialClose = tagStart >= 0 && '</thinking>'.startsWith(text.slice(tagStart).toLowerCase())
  return { prefix, body: (partialClose ? text.slice(0, tagStart) : text).trim(), live: true, nextLine: lines.length }
}

const thinkingFold = ({ body, live }) => ({
  type: 'thinking', label: '思考过程', body, live, open: false, cls: 'fold-thinking',
})

/** Return a flat fold list for callers that do not need prose interleaving. */
export function foldAgentProtocolBlocks(text) {
  const lines = String(text || '').split('\n')
  const folds = []
  const pendingToolFolds = []
  let i = 0

  const appendToolResult = (result, live = false) => {
    const target = pendingToolFolds.shift()
    if (target) {
      target.result = result.body
      target.resultLive = live
      if (live) {
        target.open = true
        target.cls += ' fold-tool-live'
      }
      return
    }

    folds.push({
      type: live ? 'tool-result-live' : 'tool-result',
      label: live ? '\u5de5\u5177\u7ed3\u679c\u2026' : '\u5de5\u5177\u7ed3\u679c',
      body: result.body,
      open: live,
      cls: live ? 'fold-result fold-result-live' : 'fold-result',
    })
  }

  while (i < lines.length) {
    const line = lines[i]

    // Tool call
    const tool = parseToolCallBlock(lines, i)
    if (tool) {
      const fold = {
        type: 'tool-call',
        label: tool.name,
        body: tool.body,
        open: false,
        cls: 'fold-tool',
      }
      folds.push(fold)
      pendingToolFolds.push(fold)
      i = tool.nextLine
      continue
    }

    // Tool results follow calls in protocol order. Keep each result in the
    // same fold as its call; only genuinely orphaned results get their own fold.
    const result = parseToolResultBlock(lines, i)
    if (result) {
      appendToolResult(result)
      i = result.nextLine
      continue
    }

    const fenceEnd = markdownFenceEnd(lines, i)
    if (fenceEnd !== null) { i = fenceEnd; continue }
    const thinking = parseThinkingBlock(lines, i)
    if (thinking) {
      if (thinking.body) folds.push(thinkingFold(thinking))
      i = thinking.nextLine
      continue
    }

    // Legacy function_calls
    if (/^<function_calls>/i.test(line)) {
      const closeIdx = lines.findIndex((l, idx) => idx > i && /<\/function_calls>/i.test(l))
      if (closeIdx >= 0) {
        const body = lines.slice(i + 1, closeIdx).join('\n')
        folds.push({
          type: 'function-calls',
          label: '函数调用',
          body,
          open: false,
          cls: 'fold-function-calls',
        })
        i = closeIdx + 1
        continue
      }
    }

    // Legacy function_results
    if (/^<function_results>/i.test(line)) {
      const closeIdx = lines.findIndex((l, idx) => idx > i && /<\/function_results>/i.test(l))
      if (closeIdx >= 0) {
        const body = lines.slice(i + 1, closeIdx).join('\n')
        folds.push({
          type: 'function-results',
          label: '函数结果',
          body,
          open: false,
          cls: 'fold-function-results',
        })
        i = closeIdx + 1
        continue
      }
    }

    // In-flight tool call (streaming, unclosed)
    const inFlightTool = parseInFlightToolCall(lines, i)
    if (inFlightTool) {
      const fold = {
        type: 'tool-call-live',
        label: `${inFlightTool.name}…`,
        body: inFlightTool.body,
        open: true,
        cls: 'fold-tool fold-tool-live',
      }
      folds.push(fold)
      pendingToolFolds.push(fold)
      i = inFlightTool.nextLine
      continue
    }

    // In-flight tool result
    const inFlightResult = parseInFlightToolResult(lines, i)
    if (inFlightResult) {
      appendToolResult(inFlightResult, true)
      i = inFlightResult.nextLine
      continue
    }

    i++
  }

  return folds
}

/**
 * Segment text into ordered prose / fold-group segments, preserving the original
 * interleaving of narration and tool activity. Consecutive folds (only blank
 * lines between them) stay in one group so they render as a single execution
 * log; genuine prose between folds breaks the group and is emitted in place.
 * `foldAgentProtocolBlocks` above keeps returning a flat fold list for callers
 * that don't care about position.
 * @param {string} text
 * @returns {Array<{kind:'prose',text:string}|{kind:'folds',folds:object[]}>}
 */
export function segmentAgentProtocolBlocks(text) {
  const lines = String(text || '').split('\n')
  const segments = []
  let proseBuf = []
  let currentFolds = null
  let pendingToolFolds = []

  // Flush buffered prose. Whitespace-only gaps do NOT emit prose and do NOT
  // break the current fold group, so adjacent tools stay grouped.
  const flushProse = () => {
    const proseText = proseBuf.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    proseBuf = []
    if (!proseText) return
    segments.push({ kind: 'prose', text: proseText })
    currentFolds = null
    pendingToolFolds = []
  }

  // Lazily open a fold group at the current position.
  const foldGroup = () => {
    if (!currentFolds) {
      currentFolds = []
      pendingToolFolds = []
      segments.push({ kind: 'folds', folds: currentFolds })
    }
    return currentFolds
  }

  const appendToolResult = (result, live = false) => {
    const target = pendingToolFolds.shift()
    if (target) {
      target.result = result.body
      target.resultLive = live
      if (live) {
        target.open = true
        target.cls += ' fold-tool-live'
      }
      return
    }
    foldGroup().push({
      type: live ? 'tool-result-live' : 'tool-result',
      label: live ? '\u5de5\u5177\u7ed3\u679c\u2026' : '\u5de5\u5177\u7ed3\u679c',
      body: result.body,
      open: live,
      cls: live ? 'fold-result fold-result-live' : 'fold-result',
    })
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    const tool = parseToolCallBlock(lines, i)
    if (tool) {
      flushProse()
      const fold = { type: 'tool-call', label: tool.name, body: tool.body, open: false, cls: 'fold-tool' }
      foldGroup().push(fold)
      pendingToolFolds.push(fold)
      i = tool.nextLine
      continue
    }

    const result = parseToolResultBlock(lines, i)
    if (result) {
      flushProse()
      appendToolResult(result)
      i = result.nextLine
      continue
    }

    const fenceEnd = markdownFenceEnd(lines, i)
    if (fenceEnd !== null) {
      proseBuf.push(...lines.slice(i, fenceEnd))
      i = fenceEnd
      continue
    }
    const thinking = parseThinkingBlock(lines, i)
    if (thinking) {
      if (thinking.prefix.trim()) proseBuf.push(thinking.prefix)
      if (thinking.body) {
        flushProse()
        foldGroup().push(thinkingFold(thinking))
      }
      i = thinking.nextLine
      continue
    }

    if (/^<function_calls>/i.test(line)) {
      const closeIdx = lines.findIndex((l, idx) => idx > i && /<\/function_calls>/i.test(l))
      if (closeIdx >= 0) {
        flushProse()
        foldGroup().push({
          type: 'function-calls',
          label: '\u51fd\u6570\u8c03\u7528',
          body: lines.slice(i + 1, closeIdx).join('\n'),
          open: false,
          cls: 'fold-function-calls',
        })
        i = closeIdx + 1
        continue
      }
    }

    if (/^<function_results>/i.test(line)) {
      const closeIdx = lines.findIndex((l, idx) => idx > i && /<\/function_results>/i.test(l))
      if (closeIdx >= 0) {
        flushProse()
        foldGroup().push({
          type: 'function-results',
          label: '\u51fd\u6570\u7ed3\u679c',
          body: lines.slice(i + 1, closeIdx).join('\n'),
          open: false,
          cls: 'fold-function-results',
        })
        i = closeIdx + 1
        continue
      }
    }

    const inFlightTool = parseInFlightToolCall(lines, i)
    if (inFlightTool) {
      flushProse()
      const fold = {
        type: 'tool-call-live',
        label: `${inFlightTool.name}\u2026`,
        body: inFlightTool.body,
        open: true,
        cls: 'fold-tool fold-tool-live',
      }
      foldGroup().push(fold)
      pendingToolFolds.push(fold)
      i = inFlightTool.nextLine
      continue
    }

    const inFlightResult = parseInFlightToolResult(lines, i)
    if (inFlightResult) {
      flushProse()
      appendToolResult(inFlightResult, true)
      i = inFlightResult.nextLine
      continue
    }

    proseBuf.push(line)
    i++
  }

  flushProse()
  return segments
}

/**
 * Remove agent protocol blocks from text, return clean text
 * @param {string} text
 * @returns {string}
 */
export function stripAgentProtocolBlocks(text) {
  const lines = String(text || '').split('\n')
  const kept = []
  let i = 0

  while (i < lines.length) {
    const tool = parseToolCallBlock(lines, i)
    if (tool) {
      i = tool.nextLine
      continue
    }

    const result = parseToolResultBlock(lines, i)
    if (result) {
      i = result.nextLine
      continue
    }

    const line = lines[i]
    const fenceEnd = markdownFenceEnd(lines, i)
    if (fenceEnd !== null) {
      kept.push(...lines.slice(i, fenceEnd))
      i = fenceEnd
      continue
    }
    const thinking = parseThinkingBlock(lines, i)
    if (thinking) {
      if (thinking.prefix.trim()) kept.push(thinking.prefix)
      i = thinking.nextLine
      continue
    }

    if (/^<function_calls>/i.test(line)) {
      const closeIdx = lines.findIndex((l, idx) => idx > i && /<\/function_calls>/i.test(l))
      if (closeIdx >= 0) {
        i = closeIdx + 1
        continue
      }
    }

    if (/^<function_results>/i.test(line)) {
      const closeIdx = lines.findIndex((l, idx) => idx > i && /<\/function_results>/i.test(l))
      if (closeIdx >= 0) {
        i = closeIdx + 1
        continue
      }
    }

    const inFlightTool = parseInFlightToolCall(lines, i)
    if (inFlightTool) {
      i = inFlightTool.nextLine
      continue
    }

    const inFlightResult = parseInFlightToolResult(lines, i)
    if (inFlightResult) {
      i = inFlightResult.nextLine
      continue
    }

    kept.push(line)
    i++
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
