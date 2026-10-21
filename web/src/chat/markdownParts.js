import { parseToolCallBlock, parseToolArgsBlock } from './toolArgs.js'
import { isToolResultText, MARKDOWN_BLOCK_LIMIT } from '../lib/chatTextSafety'
import { parseBlocks, parseInline } from '../lib/markdown.js'

export const normalizeToolParts = (parts = []) => {
  const out = []
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i]
    if (p.type !== 'text') { out.push(p); continue }
    const marker = String(p.text || '').match(/(?:^|\n)🛠️\s*Tool:/)
    if (marker && marker.index > 0) {
      const markerIndex = marker.index + (marker[0].startsWith('\n') ? 1 : 0)
      const prefix = p.text.slice(0, markerIndex)
      if (prefix.trim()) out.push({ type:'text', text:prefix })
      p = { ...p, text:p.text.slice(markerIndex) }
    }
    const tool = parseToolCallBlock(p.text)
    if (!tool) { out.push(p); continue }

    let j = i + 1
    let sawArgs = Boolean(tool.args)
    let pendingArgsFence = /📥\s*args\s*:\s*$/i.test(String(p.text || '').trim())
    let sawResult = false
    while (j < parts.length) {
      const next = parts[j]
      if (next.type === 'text') {
        const args = parseToolArgsBlock(next.text)
        const trimmed = String(next.text || '').trim()
        if (args !== null) {
          tool.args = [tool.args, args].filter(Boolean).join('\n\n')
          sawArgs = true
          pendingArgsFence = false
          j += 1
          continue
        }
        if (isToolResultText(trimmed)) {
          tool.result = [tool.result, trimmed].filter(Boolean).join('\n\n')
          sawResult = true
          j += 1
          continue
        }
        if (!trimmed) { j += 1; continue }
      }
      if (next.type === 'code') {
        if (isToolResultText(next.text) || sawResult) {
          tool.result = [tool.result, next.text].filter(Boolean).join('\n\n')
          sawResult = true
          j += 1
          continue
        }
        if (!sawArgs || pendingArgsFence) {
          tool.args = [tool.args, next.text].filter(Boolean).join('\n\n')
          sawArgs = true
          pendingArgsFence = false
          j += 1
          continue
        }
      }
      break
    }
    out.push({ type:'tool', call:tool })
    i = j - 1
  }
  return out
}

export const isMermaidFence = (lang = '') => String(lang || '').trim().split(/\s+/, 1)[0].toLowerCase() === 'mermaid'

function extractFootnotesFromBlocks(blocks = [], definitions) {
  return blocks.flatMap((block) => {
    if (block.type === 'footnotes') {
      for (const item of block.items || []) {
        const label = String(item.label || '').trim()
        if (label && !definitions.has(label)) definitions.set(label, { ...item, label })
      }
      return []
    }
    if (block.type === 'blockquote') {
      return [{ ...block, blocks: extractFootnotesFromBlocks(block.blocks, definitions) }]
    }
    if (block.type === 'list') {
      return [{
        ...block,
        items: (block.items || []).map(item => ({
          ...item,
          blocks: extractFootnotesFromBlocks(item.blocks, definitions),
        })),
      }]
    }
    return [block]
  })
}

function annotateInlineNodes(nodes = [], state) {
  return nodes.map((node) => {
    if (node.type === 'footnote_ref') {
      const label = String(node.label || '').trim()
      if (!state.definitions.has(label)) return node
      if (!state.numbers.has(label)) state.numbers.set(label, state.numbers.size + 1)
      const number = state.numbers.get(label)
      const occurrence = (state.refCounts.get(label) || 0) + 1
      state.refCounts.set(label, occurrence)
      const refId = `${state.scope}-fnref-${number}-${occurrence}`
      const refIds = state.refIds.get(label) || []
      refIds.push(refId)
      state.refIds.set(label, refIds)
      return {
        ...node,
        footnoteNumber: number,
        footnoteId: `${state.scope}-fn-${number}`,
        refId,
      }
    }
    if (node.children) return { ...node, children: annotateInlineNodes(node.children, state) }
    return node
  })
}

function prepareInlineRuns(text = '', state) {
  const src = String(text || '')
  const fileRe = /\[FILE:([^\]]+)\]/g
  const runs = []
  let last = 0
  let match
  while ((match = fileRe.exec(src)) !== null) {
    if (match.index > last) {
      runs.push({ type: 'inline', nodes: annotateInlineNodes(parseInline(src.slice(last, match.index)), state) })
    }
    runs.push({ type: 'file', path: match[1] })
    last = fileRe.lastIndex
  }
  if (last < src.length) {
    runs.push({ type: 'inline', nodes: annotateInlineNodes(parseInline(src.slice(last)), state) })
  }
  return runs
}

function annotateMarkdownBlocks(blocks = [], state) {
  return blocks.map((block) => {
    if (block.type === 'paragraph' || block.type === 'heading') {
      return { ...block, runs: prepareInlineRuns(block.text, state) }
    }
    if (block.type === 'table') {
      return {
        ...block,
        headRuns: (block.head || []).map(cell => prepareInlineRuns(cell, state)),
        rowRuns: (block.rows || []).map(row => row.map(cell => prepareInlineRuns(cell, state))),
      }
    }
    if (block.type === 'blockquote') {
      return { ...block, blocks: annotateMarkdownBlocks(block.blocks, state) }
    }
    if (block.type === 'list') {
      return {
        ...block,
        items: (block.items || []).map(item => ({
          ...item,
          blocks: annotateMarkdownBlocks(item.blocks, state),
        })),
      }
    }
    return block
  })
}

export function prepareMarkdownParts(parts = [], scope = 'oa') {
  const definitions = new Map()
  const parsedParts = parts.map((part) => {
    if (part.type !== 'text') return part
    const parsed = segmentMarkdownText(part.text)
    return {
      ...part,
      prepared: {
        ...parsed,
        segments: parsed.segments.map(seg => seg.type === 'prose'
          ? { ...seg, blocks: extractFootnotesFromBlocks(parseBlocks(seg.text), definitions) }
          : seg),
      },
    }
  })
  const state = {
    scope,
    definitions,
    numbers: new Map(),
    refCounts: new Map(),
    refIds: new Map(),
  }
  for (const part of parsedParts) {
    if (!part.prepared) continue
    part.prepared = {
      ...part.prepared,
      segments: part.prepared.segments.map(seg => seg.type === 'prose'
        ? { ...seg, blocks: annotateMarkdownBlocks(seg.blocks, state) }
        : seg),
    }
  }
  for (const label of definitions.keys()) {
    if (!state.numbers.has(label)) state.numbers.set(label, state.numbers.size + 1)
  }
  const ordered = [...definitions.values()].sort((a, b) => state.numbers.get(a.label) - state.numbers.get(b.label))
  const preparedDefinitions = ordered.map(item => ({
    ...item,
    number: state.numbers.get(item.label),
    footnoteId: `${scope}-fn-${state.numbers.get(item.label)}`,
    runs: prepareInlineRuns(item.text, state),
  }))
  for (const item of preparedDefinitions) item.refIds = state.refIds.get(item.label) || []
  return { parts: parsedParts, footnotes: preparedDefinitions }
}

// Splits the message into tool segments and prose segments. Tool detection still
// works on blank-line-separated chunks, but consecutive prose chunks are rejoined
// so the block parser keeps the blank lines it needs for loose lists, blockquotes
// and multi-paragraph list items.
export const segmentMarkdownText = (text = '') => {
  const chunks = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/)
  const visible = chunks.slice(0, MARKDOWN_BLOCK_LIMIT)
  const hidden = Math.max(0, chunks.length - visible.length)
  const segments = []
  const pushProse = (value) => {
    if (!String(value || '').trim()) return
    const last = segments[segments.length - 1]
    if (last?.type === 'prose') last.text += `\n\n${value}`
    else segments.push({ type: 'prose', text: value })
  }
  for (let i = 0; i < visible.length; i += 1) {
    const toolCall = parseToolCallBlock(visible[i])
    if (toolCall) {
      let j = i + 1
      while (j < visible.length) {
        const args = parseToolArgsBlock(visible[j])
        if (args === null) break
        toolCall.args = [toolCall.args, args].filter(Boolean).join('\n\n')
        j += 1
      }
      segments.push({ type: 'tool', call: toolCall })
      i = j - 1
      continue
    }
    const standaloneArgs = parseToolArgsBlock(visible[i])
    if (standaloneArgs !== null) {
      segments.push({ type: 'tool', call: { name: 'unknown', args: standaloneArgs } })
      continue
    }
    pushProse(visible[i])
  }
  return { segments, hidden }
}
