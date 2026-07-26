import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createStreamDeltaBatcher, isBTWCommand, mergeFinalStreamMessage, shouldFinishStreamFollow } from './lib/chatStream.js'
import { Collapse, Tag } from 'antd'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { Bot, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Copy, Download, Edit3, ExternalLink, FileArchive, FileCode2, FileImage, FileOutput, FileSpreadsheet, FileText, FolderOpen, Lock, Paperclip, Menu, MessageSquarePlus, MoreHorizontal, PanelRightOpen, Plus, RefreshCw, Search, Send, Sparkles, Square, Trash2, X } from 'lucide-react'
import { api, apiStream } from './lib/api'
import { confirmDanger } from './lib/danger'
import { fuzzyMatch } from './lib/format'
import { JSON_TREE_CHILD_LIMIT, JSON_TREE_STRING_LIMIT, LIST_ITEM_LIMIT, LONG_TEXT_PREVIEW_CHARS, MARKDOWN_BLOCK_LIMIT, MARKDOWN_CHAR_LIMIT, MARKDOWN_LINE_LIMIT, isToolResultText, parseAssistantContent, previewLongText, splitMarkdownParts, textRenderStats } from './lib/chatTextSafety'
import { getAskUserPayload } from './lib/askUserPayload'
import { preferredUltraPlanOutputFile, reconcileUltraPlanTasks } from './lib/ultraPlanTasks'
import { REASONING_EFFORT_LEVELS, REASONING_EFFORT_OPTIONS, normalizeReasoningEffort } from './lib/reasoningEffort'
import { deleteChatSessions, normalizeSessionIds } from './lib/chatSessionManagement'
import { createPromptPreset, normalizePromptPresets, promptPresetPatch, selectedPromptPresetView } from './lib/promptPresets'
import { commandResultSummary, reduceCommandResult } from './lib/chatCommands'
import { buildChatRunPayload, buildEditResendItem } from './lib/worldlineEdit'

gsap.registerPlugin(useGSAP)

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const isNarrowChatViewport = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches
const isMobileViewport = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 560px)').matches
const chatLanguage = () => typeof localStorage !== 'undefined' && localStorage.getItem('ga-admin-lang') === 'en' ? 'en' : 'zh'
const ct = (zh, en) => chatLanguage() === 'en' ? en : zh
const chatLocale = () => chatLanguage() === 'en' ? 'en-US' : 'zh-CN'

const timestampMs = (v) => {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return Number.isFinite(v) ? (Math.abs(v) < 1e12 ? v * 1000 : v) : NaN
  if (typeof v === 'string') {
    const raw = v.trim()
    if (!raw) return NaN
    const numeric = Number(raw)
    if (Number.isFinite(numeric)) return Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric
  }
  return new Date(v).getTime()
}
const dateFromTimestamp = (v) => {
  const ms = timestampMs(v)
  return Number.isFinite(ms) ? new Date(ms) : null
}
const fmtTime = (v) => dateFromTimestamp(v)?.toLocaleString(chatLocale()) || ''
const fmtTimelineDate = (v) => {
  if (!v) return ct('今天', 'Today')
  const d = dateFromTimestamp(v)
  if (!d) return ''
  const now = new Date()
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diff = Math.round((today - day) / 86400000)
  if (diff === 0) return ct('今天', 'Today')
  if (diff === 1) return ct('昨天', 'Yesterday')
  return d.toLocaleDateString(chatLocale(), { year:'numeric', month:'long', day:'numeric' })
}
const timelineKey = (v) => {
  if (!v) return 'today'
  const d = dateFromTimestamp(v)
  return d ? `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}` : 'unknown'
}
const isNearBottom = (el, gap = 96) => !el || (el.scrollHeight - el.scrollTop - el.clientHeight) <= gap
const parseBTWDisplay = (value) => {
  const raw = String(value || '')
  const match = raw.match(/^\s*(?:>\s*)?(?:🟡\s*)?\/btw(?:[ \t]+([\s\S]*))?\s*$/i)
  if (!match) return null
  return { prompt: String(match[1] || '').trim() }
}
const stripBTWEcho = (value) => {
  const lines = String(value || '').split(/\r?\n/)
  const firstContent = lines.findIndex(line => line.trim())
  if (firstContent < 0 || !parseBTWDisplay(lines[firstContent])) return String(value || '')
  lines.splice(firstContent, 1)
  while (firstContent < lines.length && !lines[firstContent].trim()) lines.splice(firstContent, 1)
  return lines.join('\n').trimStart()
}
const shortTitle = (s) => s?.title || ct('新会话', 'New chat')
const fmtDate = (ts) => {
  const d = dateFromTimestamp(ts)
  if (!d) return ''
  const today = new Date(); const y = today.getFullYear(), mo = today.getMonth(), dy = today.getDate()
  if (d.getFullYear() === y && d.getMonth() === mo && d.getDate() === dy) return ct('今天', 'Today')
  if (d.getFullYear() === y && d.getMonth() === mo && d.getDate() === dy - 1) return ct('昨天', 'Yesterday')
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
const formatAge = (ts) => {
  const d = dateFromTimestamp(ts)
  if (!d) return ''
  const diff = Date.now() - d.getTime()
  if (diff < 60000) return ct('刚刚', 'Just now')
  if (diff < 3600000) return ct(`${Math.floor(diff/60000)}分钟前`, `${Math.floor(diff/60000)} min ago`)
  if (diff < 86400000) return ct(`${Math.floor(diff/3600000)}小时前`, `${Math.floor(diff/3600000)} hr ago`)
  return d.toLocaleDateString(chatLocale(), { month:'short', day:'numeric' })
}
const modelLabel = (m) => m?.label || [m?.name || m?.var_name || `${ct('模型', 'Model')} ${m?.index || ''}`, m?.model].filter(Boolean).join(' · ')
const modelProvider = (m) => {
  const provider = String(m?.provider || '').trim()
  if (provider) return provider
  const name = String(m?.name || '').trim()
  const model = String(m?.model || '').trim()
  if (name && model && name.endsWith(`/${model}`)) return name.slice(0, -(model.length + 1))
  const split = name.lastIndexOf('/')
  return (split > 0 ? name.slice(0, split) : name) || ct('未分组服务商', 'Ungrouped provider')
}
const runtimeModelLabel = (m) => {
  const model = String(m?.model || '').trim()
  if (model) return model
  const label = modelLabel(m)
  return label.includes('/') ? label.split('/').pop() : label
}

const BUILTIN_SLASH_COMMANDS = [
  { cmd: '/project', key: '/project', insert: '/project', desc: ct('列出项目并查看或切换 Project Mode', 'List projects and view or switch Project Mode'), builtIn: true },
  { cmd: '/continue', key: '/continue', insert: '/continue', desc: ct('列出可恢复的官方 GA 会话', 'List resumable official GA sessions'), builtIn: true },
  { cmd: '/continue <number>', key: '/continue', insert: '/continue ', desc: ct('恢复第 N 个官方 GA 会话，可继续对话', 'Resume official GA session N'), builtIn: true },
  { cmd: '/review <request>', key: '/review', insert: '/review ', desc: ct('审阅当前改动；可继续输入范围或关注点', 'Review current changes with an optional scope or focus'), builtIn: true },
  { cmd: '/review help', key: '/review help', insert: '/review help', desc: ct('显示 /review 帮助，不启动审阅', 'Show /review help without starting a review'), builtIn: true },
  { cmd: '/ultraplan <goal>', key: '/ultraplan', insert: '/ultraplan ', desc: ct('显式进入 UltraPlan 规划模式，并生成本地 run 目录', 'Enter UltraPlan explicitly and create a local run directory'), builtIn: true },
  { cmd: '/improve', key: '/improve', insert: '/improve', desc: ct('发送记忆提炼请求（L3 skill + L1 索引）', 'Request memory distillation (L3 skill + L1 index)'), builtIn: true },
  { cmd: '/effort', key: '/effort', insert: '/effort', desc: ct('查看当前 reasoning effort', 'Show the current reasoning effort'), builtIn: true },
  ...REASONING_EFFORT_LEVELS.map(level => ({
    cmd: `/effort ${level}`,
    key: `/effort ${level}`,
    insert: `/effort ${level}`,
    desc: level === 'off' ? ct('清除 reasoning effort', 'Clear reasoning effort') : ct(`设置 reasoning effort 为 ${level}`, `Set reasoning effort to ${level}`),
    builtIn: true,
  })),
  { cmd: '/workspace <path>', key: '/workspace', insert: '/workspace ', desc: ct('为当前会话绑定项目目录', 'Bind a project directory to the current session'), builtIn: true },
  { cmd: '/workspace off', key: '/workspace off', insert: '/workspace off', desc: ct('关闭当前会话 workspace', 'Disable the current session workspace'), builtIn: true },
]
const builtinSlashKey = (cmd = '') => String(cmd || '').trim().toLowerCase()
const builtinSlashCommandKey = (c) => builtinSlashKey(c?.key || c?.cmd)
const slashCommandInsertText = (c, current = '') => {
  if (!c) return current || ''
  const text = String(current || '')
  const cmd = String(c.cmd || '')
  const root = cmd.split(/\s+/, 1)[0]
  const isArgumentFallback = cmd === root || /\s<[^>]+>$/.test(cmd)
  if (isArgumentFallback && new RegExp(`^\\s*${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`).test(text)) {
    return text
  }
  return c?.insert ?? `${c?.cmd || ''} `
}
const slashCommandProgressiveFilter = (c, nextText = '') => {
  if (c?.cmd === '/review <request>') return 'review '
  if (c?.cmd === '/continue') return 'continue '
  if (c?.cmd === '/improve') return 'improve '
  if (c?.cmd === '/effort') return 'effort '
  if (c?.cmd === '/workspace <path>') return 'workspace '
  if (c?.cmd === '/ultraplan <goal>') return 'ultraplan '
  const text = String(nextText || '').trimStart()
  if (text === '/review') return 'review '
  if (text === '/continue') return 'continue '
  if (text === '/improve') return 'improve '
  if (text === '/effort') return 'effort '
  if (text === '/workspace') return 'workspace '
  if (text === '/ultraplan') return 'ultraplan '
  return ''
}
const slashCommandNextDrawer = (c, nextText = '') => {
  const filter = slashCommandProgressiveFilter(c, nextText)
  return filter ? { open:true, filter, selectedIdx:0 } : { open:false, filter:'', selectedIdx:0 }
}


const tokenizeInlineMarkdown = (text = '') => {
  const src = String(text || '')
  const tokens = []
  const re = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g
  let last = 0, m
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) tokens.push({ type:'text', text:src.slice(last, m.index) })
    if (m[2]) tokens.push({ type:'code', text:m[2] })
    else if (m[4]) tokens.push({ type:'strong', text:m[4] })
    else if (m[6]) tokens.push({ type:'em', text:m[6] })
    else if (m[8] && m[9]) tokens.push({ type:'link', text:m[8], href:m[9] })
    last = re.lastIndex
  }
  if (last < src.length) tokens.push({ type:'text', text:src.slice(last) })
  return tokens
}

function InlineMarkdown({ text = '' }) {
  return <>
    {tokenizeInlineMarkdown(text).map((t, i) => {
      if (t.type === 'code') return <code key={i}>{t.text}</code>
      if (t.type === 'strong') return <strong key={i}>{t.text}</strong>
      if (t.type === 'em') return <em key={i}>{t.text}</em>
      if (t.type === 'link') return <a key={i} href={t.href} target="_blank" rel="noreferrer">{t.text}</a>
      return <span key={i}>{t.text}</span>
    })}
  </>
}

function CopyButton({ text, compact = false }) {
  const [ok, setOk] = useState(false)
  const copy = async (e) => {
    e?.stopPropagation?.()
    try {
      await navigator.clipboard.writeText(text || '')
      setOk(true)
      setTimeout(() => setOk(false), 1200)
    } catch {}
  }
  return <button className={compact ? 'oa-mini-copy' : 'oa-copy'} onClick={copy} title={ct('复制', 'Copy')}>
    {ok ? <Check size={14}/> : <Copy size={14}/>}<span>{ok ? ct('已复制', 'Copied') : ct('复制', 'Copy')}</span>
  </button>
}

function LongTextPreview({ text = '', stats }) {
  const s = stats || textRenderStats(text)
  const preview = useMemo(() => previewLongText(text), [text])
  return <div className="oa-long-text-preview">
    <div className="oa-long-text-head">
      <b>{ct('内容过大，已切换安全预览', 'Content is large; showing a safe preview')}</b>
      <span>{s.chars.toLocaleString(chatLocale())} {ct('字符', 'characters')} · {s.linesLabel} {ct('行', 'lines')}</span>
      <CopyButton text={text} compact />
    </div>
    <pre>{preview}</pre>
  </div>
}

function JsonTree({ data, name = 'root', depth = 0 }) {
  const [open, setOpen] = useState(depth < 2)
  const isArray = Array.isArray(data)
  const isObject = data && typeof data === 'object' && !isArray
  if (!isArray && !isObject) {
    const cls = data === null ? 'is-null' : typeof data === 'string' ? 'is-string' : typeof data === 'number' ? 'is-number' : typeof data === 'boolean' ? 'is-bool' : ''
    const raw = typeof data === 'string' ? data : JSON.stringify(data)
    const long = typeof raw === 'string' && raw.length > JSON_TREE_STRING_LIMIT
    const shown = long ? `${raw.slice(0, JSON_TREE_STRING_LIMIT)}… (${raw.length.toLocaleString()} chars)` : raw
    return <div className="oa-json-line" style={{ '--depth': depth }}><span className="oa-json-key">{name}:</span> <span className={`oa-json-value ${cls}`}>{typeof data === 'string' ? JSON.stringify(shown) : shown}</span></div>
  }
  const entries = isArray ? data.map((v, i) => [i, v]) : Object.entries(data)
  const shownEntries = entries.slice(0, JSON_TREE_CHILD_LIMIT)
  const hidden = entries.length - shownEntries.length
  const label = isArray ? `Array(${data.length})` : `Object(${entries.length})`
  return <div className="oa-json-node">
    <button type="button" className="oa-json-toggle" style={{ '--depth': depth }} onClick={()=>setOpen(v=>!v)}>
      <span className="oa-json-caret">{open ? '▾' : '▸'}</span><span className="oa-json-key">{name}</span><span className="oa-json-type">{label}</span>
    </button>
    {open && <div>
      {shownEntries.map(([k, v]) => <JsonTree key={String(k)} name={String(k)} data={v} depth={depth + 1} />)}
      {hidden > 0 && <div className="oa-json-line oa-json-more" style={{ '--depth': depth + 1 }}>{ct(`… 已隐藏 ${hidden.toLocaleString(chatLocale())} 项，复制原始 JSON 查看全部`, `… ${hidden.toLocaleString(chatLocale())} items hidden; copy the raw JSON to view all`)}</div>}
    </div>}
  </div>
}

const MAX_CHAT_UPLOAD_FILES = 8
const MAX_CHAT_UPLOAD_BYTES_PER_FILE = 20 * 1024 * 1024
const MAX_CHAT_UPLOAD_BYTES_TOTAL = 40 * 1024 * 1024

const uploadFileName = (f) => String(f?.name || f?.Name || 'attachment')
const uploadFileSource = (f) => String(f?.dataURL || f?.DataURL || f?.url || f?.URL || '')

function isImageFile(f) {
  if (!f) return false
  const mime = String(f.type || f.Type || f.mime || f.Mime || '')
  if (mime.startsWith('image/')) return true
  const ref = String(f.name || f.Name || f.url || f.URL || f.path || f.Path || f.dataURL || f.DataURL || '').split(/[?#]/)[0]
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(ref)
}

const FILE_KIND_RULES = [
  { kind:'image', re:/\.(png|jpe?g|gif|webp|bmp|svg)$/i, Icon:FileImage },
  { kind:'archive', re:/\.(zip|rar|7z|tar|gz|bz2|xz)$/i, Icon:FileArchive },
  { kind:'sheet', re:/\.(csv|xls|xlsx|ods)$/i, Icon:FileSpreadsheet },
  { kind:'code', re:/\.(c|cc|cpp|cs|css|go|h|hpp|html?|java|js|jsx|json|kt|kts|md|php|py|rb|rs|sh|sql|swift|toml|ts|tsx|vue|xml|ya?ml)$/i, Icon:FileCode2 },
  { kind:'pdf', re:/\.pdf$/i, Icon:FileOutput },
]

const getFileVisual = (value) => FILE_KIND_RULES.find((rule) => rule.re.test(String(value || '').split(/[?#]/)[0])) || { kind:'file', Icon:FileText }

function FileAttachment({ path }) {
  const clean = String(path || '').trim()
  const name = clean.split(/[\\/]/).filter(Boolean).pop() || clean || ct('文件', 'File')
  const extMatch = name.match(/\.([^.]+)$/)
  const extension = extMatch ? extMatch[1].slice(0, 6).toUpperCase() : 'FILE'
  const splitAt = Math.max(clean.lastIndexOf('\\'), clean.lastIndexOf('/'))
  const directory = splitAt >= 0 ? clean.slice(0, splitAt) : ct('本地文件', 'Local file')
  const visual = getFileVisual(name)
  const { kind, Icon } = visual
  const isImage = kind === 'image'
  const imageUrl = `/api/files/image?path=${encodeURIComponent(clean)}`
  const open = async (mode) => {
    if (!confirmDanger('chat-file-open', ct(`使用系统桌面打开${mode === 'folder' ? '文件所在位置' : '文件'}：${clean}？`, `Open ${mode === 'folder' ? 'the containing folder' : 'this file'} in the desktop system: ${clean}?`))) return
    try {
      await api('/api/files/open', { dangerous:true, method:'POST', body: JSON.stringify({ path: clean, mode }) })
    } catch (e) {
      alert(ct(`打开失败：${e?.message || e}`, `Open failed: ${e?.message || e}`))
    }
  }
  return <span className={`oa-file-card oa-file-kind-${kind}`} title={clean}>
    <button type="button" className="oa-file-leading" onClick={() => open('file')} aria-label={ct(`打开文件 ${name}`, `Open file ${name}`)}>
      <Icon className="oa-file-fallback-icon" size={19}/>
      {isImage && <img src={imageUrl} alt="" loading="lazy" onError={(e)=>{ e.currentTarget.style.display='none' }} />}
    </button>
    <span className="oa-file-meta">
      <span className="oa-file-name-row"><b>{name}</b><small>{extension}</small></span>
      <em>{directory || ct('本地文件', 'Local file')}</em>
    </span>
    <span className="oa-file-actions">
      <a href={`/api/files/download?path=${encodeURIComponent(clean)}`} download={name} title={ct('下载文件', 'Download file')} aria-label={ct(`下载文件 ${name}`, `Download file ${name}`)}><Download size={15}/></a>
      <button type="button" onClick={() => open('file')} title={ct('打开文件', 'Open file')} aria-label={ct(`打开文件 ${name}`, `Open file ${name}`)}><ExternalLink size={15}/></button>
      <button type="button" onClick={() => open('folder')} title={ct('打开所在位置', 'Open containing folder')} aria-label={ct(`打开 ${name} 所在位置`, `Open folder containing ${name}`)}><FolderOpen size={15}/></button>
      <CopyButton text={clean} compact />
    </span>
  </span>
}

function InlineRichText({ text = '' }) {
  const src = String(text || '')
  const re = /\[FILE:([^\]]+)\]/g
  const nodes = []
  let last = 0, m, n = 0
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) nodes.push(<InlineMarkdown key={`t${n++}`} text={src.slice(last, m.index)} />)
    nodes.push(<FileAttachment key={`f${n++}`} path={m[1]} />)
    last = re.lastIndex
  }
  if (last < src.length) nodes.push(<InlineMarkdown key={`t${n++}`} text={src.slice(last)} />)
  return <>{nodes}</>
}

const normalizeToolParts = (parts = []) => {
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

const MarkdownBlock = memo(function MarkdownBlock({ text = '', onAskReply }) {
  const stats = useMemo(() => textRenderStats(text), [text])
  const parts = useMemo(() => stats.tooLarge ? [] : normalizeToolParts(splitMarkdownParts(text)).slice(0, MARKDOWN_BLOCK_LIMIT), [text, stats.tooLarge])
  if (stats.tooLarge) return <div className="oa-md"><LongTextPreview text={text} stats={stats} /></div>
  return <div className="oa-md">
    {parts.map((p, idx) => p.type === 'code'
      ? <div className="oa-code-card" key={idx}>
          <div className="oa-code-head"><span>{p.lang || ct('代码', 'Code')}</span><CopyButton text={p.text} compact /></div>
          <pre><code>{p.text}</code></pre>
        </div>
      : p.type === 'tool'
        ? <ToolCallBlock key={idx} call={p.call} onAskReply={onAskReply} />
        : <TextMarkdown key={idx} text={p.text} onAskReply={onAskReply}/>) }
    {parts.length >= MARKDOWN_BLOCK_LIMIT && <div className="oa-md-truncated">{ct(`内容块过多，仅渲染前 ${MARKDOWN_BLOCK_LIMIT} 块，可复制消息查看完整内容。`, `Too many content blocks. Only the first ${MARKDOWN_BLOCK_LIMIT} are rendered; copy the message to view everything.`)}</div>}
  </div>
})

const parseUltraPlanResult = (text = '') => {
  const src = String(text || '').trim()
  if (!src.includes('UltraPlan invoked by explicit `/ultraplan` opt-in.')) return null
  const pick = (re) => {
    const m = src.match(re)
    return m ? String(m[1] || '').trim() : ''
  }
  const fence = (label) => {
    const safeLabel = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(safeLabel + ':\\s*\\n```\\n([\\s\\S]*?)\\n```', 'i')
    const m = src.match(re)
    return m ? String(m[1] || '').trim() : ''
  }
  const exitCodeText = pick(/^Exit code:\s*([^\n]+)/m)
  const exitCode = Number(exitCodeText)
  return {
    objective: pick(/^Objective:\s*([^\n]+)/m),
    script: pick(/^Script:\s*`?([^`\n]+)`?/m),
    runDir: pick(/^Run dir:\s*`?([^`\n]+)`?/m),
    exitCodeText,
    ok: Number.isFinite(exitCode) ? exitCode === 0 : true,
    stdout: fence('stdout'),
    stderr: fence('stderr'),
  }
}

// Parse raw ultraplan log text (streamed as plain content) into ultraplan_state shape
function parseUltraPlanText(text = '') {
  if (!text.includes('[ultraplan]') && !text.includes('[phase]')) return null
  const lines = text.split('\n')
  let objective = ''
  const phases = []
  const events = []       // {tag, body} - all raw log entries preserved in order
  const resultFiles = []  // {desc, file} - dedup by file path
  let current = ''        // last activity label
  let currentPhase = null

  const pushEvent = (tag, body) => events.push({ tag, body })

  for (const raw of lines) {
    const t = raw.trim()
    if (!t) continue
    const tagM = t.match(/^\[([a-z][a-z_-]*)\]\s*(.*)$/i)
    if (tagM) pushEvent(tagM[1].toLowerCase(), tagM[2])
    // [ultraplan] objective: xxx
    const objM = t.match(/^\[ultraplan\]\s+objective:\s*(.+)$/)
    if (objM) { objective = objM[1].trim(); current = `objective: ${objective}`; continue }
    // [phase] name - description
    const phM = t.match(/^\[phase\]\s+(\S+)\s+-\s+(.+)$/)
    if (phM) {
      currentPhase = { name: phM[1], desc: phM[2].trim(), status: 'running', tasks: [] }
      phases.push(currentPhase)
      current = `phase: ${currentPhase.name}`
      continue
    }
    // [subagent] desc -> filepath
    const saM = t.match(/^\[subagent\]\s+(.+?)\s+->\s+(.+)$/)
    if (saM && currentPhase) {
      currentPhase.tasks.push({ desc: saM[1].trim(), file: saM[2].trim(), status: 'running' })
      current = `task: ${saM[1].trim()}`
      continue
    }
    // [result] desc -> filepath  (marks last running subagent task done)
    const resM = t.match(/^\[result\]\s+(.+?)\s+->\s+(.+)$/)
    if (resM && currentPhase) {
      const desc = resM[1].trim(); const file = resM[2].trim()
      const lastRunning = [...currentPhase.tasks].reverse().find(tk => tk.status === 'running')
      if (lastRunning) { lastRunning.status = 'done'; lastRunning.file = file }
      if (!resultFiles.some(r => r.file === file)) resultFiles.push({ desc, file })
      continue
    }
    // [done] name (elapsed)
    const doneM = t.match(/^\[done\]\s+(\S+)\s+\((.+?)\)$/)
    if (doneM && currentPhase) {
      currentPhase.status = 'done'
      currentPhase.elapsed = doneM[2]
      currentPhase.tasks.forEach(tk => { if (tk.status === 'running') tk.status = 'done' })
      current = `done: ${doneM[1]}`
      continue
    }
    // [summary] key: value
    const sumM = t.match(/^\[summary\]\s+(.+)$/)
    if (sumM && currentPhase) {
      currentPhase.tasks.push({ desc: sumM[1].trim(), status: 'done' })
      continue
    }
  }

  if (!objective && phases.length === 0) return null
  const complete = phases.length > 0 && phases.every(ph => ph.status === 'done')
  return { objective, phases, complete, events, resultFiles, current }
}

const taskOutputToText = (value) => {
  if (!value) return ''
  if (Array.isArray(value)) return value.filter(v => v !== undefined && v !== null).join('\n')
  return String(value)
}

const ultraPlanTaskKeys = (task = {}) => {
  const keys = []
  const add = (v) => {
    const s = String(v || '').trim()
    if (s && !keys.includes(s)) keys.push(s)
  }
  add(task.id)
  add(task.task_id)
  add(task.key)
  add(task.file)
  add(task.path)
  add(task.outputFile)
  add(task.output_file)
  add(task.outFile)
  add(task.out_file)
  const file = task.outputFile || task.output_file || task.outFile || task.out_file || task.file || task.path || ''
  if (file) {
    const name = String(file).split(/[\\/]/).pop()
    add(name)
    if (name.endsWith('.out.txt')) add(name.slice(0, -8))
    if (name.endsWith('.txt')) add(name.slice(0, -4))
  }
  return keys
}

const normalizeUltraPlanTask = (task = {}, taskOutputs = {}) => {
  const statusRaw = String(task.status || task.state || '').toLowerCase()
  const status = statusRaw === 'run' ? 'running' : (statusRaw || 'running')
  const taskKeys = ultraPlanTaskKeys(task)
  const liveOutput = taskKeys.map(k => taskOutputToText(taskOutputs[k])).find(Boolean) || ''
  const output = liveOutput || task.output || task.out || task.result || task.summary || ''
  const outputFile = preferredUltraPlanOutputFile(task)
  return {
    ...task,
    status,
    desc: task.desc || task.name || task.title || task.msg || '',
    file: outputFile,
    output,
    outputFile,
  }
}

const normalizeUltraPlanPhase = (phase = {}, taskOutputs = {}) => {
  const statusRaw = String(phase.status || phase.state || '').toLowerCase()
  const status = statusRaw === 'run' ? 'running' : (statusRaw || 'running')
  const children = Array.isArray(phase.children) ? phase.children.map(ch => normalizeUltraPlanPhase(ch, taskOutputs)) : []
  let rawTasks = Array.isArray(phase.tasks) ? phase.tasks : []
  // If parent phase is done, any child task still marked "running" is a stale streaming artifact — fix to done
  if (status === 'done') {
    rawTasks = rawTasks.map(t => String(t.status || '').toLowerCase() === 'running' ? { ...t, status: 'done' } : t)
  }
  return {
    ...phase,
    status,
    tasks: rawTasks.map(t => normalizeUltraPlanTask(t, taskOutputs)),
    children,
  }
}

const isUltraPlanPhaseDone = (phase = {}) => {
  const children = Array.isArray(phase.children) ? phase.children : []
  return phase.status && !['run', 'running'].includes(String(phase.status).toLowerCase()) && children.every(isUltraPlanPhaseDone)
}

const normalizeUltraPlanEvent = (event = {}) => {
  if (typeof event === 'string') return { tag: 'event', body: event }
  const tag = event.tag || event.type || 'event'
  const body = event.body || event.msg || event.message || event.desc || ''
  const elapsed = event.elapsed ?? event.time  // preserve as separate display field
  // Remove time/elapsed from spread to prevent repeated normalization accumulating prefix
  const { time, elapsed: _e, body: _b, msg: _m, message: _msg, desc: _d, tag: _t, type: _ty, ...rest } = event
  return { ...rest, tag, body, ...(elapsed !== undefined ? { elapsed } : {}) }
}

const normalizeUltraPlanState = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const taskOutputs = raw.taskOutputs || raw.task_outputs || {}

  // Pre-process: fix backend streaming bug that leaks ALL rich tasks (with id) into the last phase.
  // A "simple" task has no id — it's the phase's declared intent (desc + status only).
  // A "rich" task has id + output_file — it's the actual executed result injected by the backend.
  //
  // Two categories of rich tasks:
  //   leaked  = rich task whose desc matches a simple task in ANY phase → belongs to that phase, not here
  //   native  = rich task whose desc has NO matching simple task anywhere → truly belongs to this phase
  //
  // For each phase:
  //   1. Keep native rich tasks (e.g. verify's "completeness check" which only appears as rich, never simple)
  //   2. Enrich simple tasks with data from matching rich task (output_file, id, etc.)
  //   3. Drop leaked rich tasks (they've been redistributed to their owner phases via step 2)
  const allSimpleDescs = new Set()
  const richByDesc = {}
  if (Array.isArray(raw.phases)) {
    for (const ph of raw.phases) {
      for (const t of (ph.tasks || [])) {
        if (!t.id && t.desc) allSimpleDescs.add(t.desc)
        if (t.id && t.desc) richByDesc[t.desc] = t
      }
    }
  }
  const phasesRaw = Array.isArray(raw.phases) ? raw.phases.map(ph => {
    const simpleTasks = (ph.tasks || []).filter(t => !t.id)
    // Native rich tasks: have id but desc not declared as a simple task in any phase
    const nativeRich = (ph.tasks || []).filter(t => t.id && t.desc && !allSimpleDescs.has(t.desc))
    // Enrich simple tasks with matching rich task data (output_file, id)
    const enrichedSimple = simpleTasks.map(t => {
      const rich = richByDesc[t.desc]
      if (!rich) return t
      return { ...rich, desc: t.desc, status: t.status }
    })
    return { ...ph, tasks: [...enrichedSimple, ...nativeRich] }
  }) : []

  const normalizedPhases = phasesRaw.map(ph => normalizeUltraPlanPhase(ph, taskOutputs))
  const recentTasksRaw = Array.isArray(raw.recentTasks) ? raw.recentTasks : (Array.isArray(raw.recent_tasks) ? raw.recent_tasks : (Array.isArray(raw.tasks) ? raw.tasks : []))
  const normalizedRecentTasks = recentTasksRaw.map(t => normalizeUltraPlanTask(t, taskOutputs))
  // A rich task may arrive both under a phase and in the live/recent stream.
  // Merge its output/status into the phase row, then render only genuinely unmatched recent work.
  const { phases, recentTasks } = reconcileUltraPlanTasks(normalizedPhases, normalizedRecentTasks)
  const resultFiles = Array.isArray(raw.resultFiles) ? raw.resultFiles : (Array.isArray(raw.result_files) ? raw.result_files : [])
  const complete = Boolean(raw.complete || raw.done || (phases.length > 0 && phases.every(isUltraPlanPhaseDone)))
  return {
    ...raw,
    taskOutputs,
    task_outputs: taskOutputs,
    phases,
    recentTasks,
    resultFiles,
    events: Array.isArray(raw.events) ? raw.events.map(normalizeUltraPlanEvent) : [],
    complete,
  }
}

const mergeUltraPlanStates = (...states) => {
  const normalized = states.map(normalizeUltraPlanState).filter(Boolean)
  if (!normalized.length) return null
  const merged = {}
  const eventSeen = new Set()
  const fileSeen = new Set()
  const mergedEvents = []
  const mergedFiles = []
  const mergedTaskOutputs = {}

  for (const st of normalized) {
    const {
      phases,
      recentTasks,
      recent_tasks,
      tasks,
      events,
      resultFiles,
      result_files,
      taskOutputs,
      task_outputs,
      ...rest
    } = st
    Object.assign(merged, rest)
    if (taskOutputs && typeof taskOutputs === 'object') Object.assign(mergedTaskOutputs, taskOutputs)
    if (task_outputs && typeof task_outputs === 'object') Object.assign(mergedTaskOutputs, task_outputs)
    if (Array.isArray(phases) && phases.length > 0) merged.phases = phases
    if (Array.isArray(recentTasks) && recentTasks.length > 0) merged.recentTasks = recentTasks
    const eventList = Array.isArray(events) ? events : []
    for (const ev of eventList) {
      const key = `${ev.tag || ''}|${ev.body || ''}`
      if (!eventSeen.has(key)) { eventSeen.add(key); mergedEvents.push(ev) }
    }
    const fileList = Array.isArray(resultFiles) ? resultFiles : []
    for (const rf of fileList) {
      const key = rf.file || `${rf.desc || ''}|${JSON.stringify(rf)}`
      if (!fileSeen.has(key)) { fileSeen.add(key); mergedFiles.push(rf) }
    }
  }

  merged.taskOutputs = mergedTaskOutputs
  merged.task_outputs = mergedTaskOutputs
  merged.events = mergedEvents
  merged.resultFiles = mergedFiles
  merged.complete = normalized.some(st => st.complete || st.done)
    || (Array.isArray(merged.phases) && merged.phases.length > 0 && merged.phases.every(isUltraPlanPhaseDone))
  return normalizeUltraPlanState(merged)
}

function UltraPlanResultCard({ text = '' }) {
  const result = parseUltraPlanResult(text)
  if (!result) return null
  return <div className={`oa-ultraplan-result ${result.ok ? 'is-ok' : 'is-error'}`}>
    <div className="oa-ultraplan-head">
      <span className="oa-ultraplan-orb"><Sparkles size={16}/></span>
      <div><b>UltraPlan</b><small>{ct('显式 /ultraplan 调用结果', 'Explicit /ultraplan result')}</small></div>
      <em>{result.ok ? ct('完成', 'Completed') : ct('异常', 'Error')} · Exit {result.exitCodeText || '0'}</em>
    </div>
    {result.objective && <div className="oa-ultraplan-objective">{result.objective}</div>}
    <div className="oa-ultraplan-meta">
      {result.runDir && <span><b>Run dir</b><code>{result.runDir}</code></span>}
      {result.script && <span><b>Script</b><code>{result.script}</code></span>}
    </div>
    {(result.stdout || result.stderr) && <div className="oa-ultraplan-logs">
      {result.stdout && <details open><summary>stdout</summary><pre>{result.stdout}</pre></details>}
      {result.stderr && <details open={!result.ok}><summary>stderr</summary><pre>{result.stderr}</pre></details>}
    </div>}
  </div>
}

export const stripUltraPlanProgressText = (text = '') => String(text || '')
  .split(/\r?\n/)
  .filter(line => !/^\s*\[(?:ultraplan|phase|subagent|result|done|next|summary)\]\s*/i.test(line))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const hasUltraPlanDashboardState = (state) => !!(state && (
  state.objective
  || state.phases?.length > 0
  || state.recentTasks?.length > 0
  || state.resultFiles?.length > 0
  || state.complete
))

const renderAssistantBody = (text = '', onAskReply, ultraplan_state) => {
  const parsedState = parseUltraPlanText(text)
  const upState = mergeUltraPlanStates(ultraplan_state, parsedState)
  const cleanText = stripUltraPlanProgressText(text)
  if (hasUltraPlanDashboardState(upState)) {
    return cleanText ? (
      <div className="oa-ultraplan-prose">
        <MarkdownBlock text={cleanText} onAskReply={onAskReply} />
      </div>
    ) : null
  }
  const result = parseUltraPlanResult(text)
  if (result) return <UltraPlanResultCard text={text} />
  return cleanText ? <MarkdownBlock text={cleanText} onAskReply={onAskReply} /> : null
}

const taskFileName = (fp = '') => String(fp || '').split(/[\\/]/).filter(Boolean).pop() || ''

/*─── SubagentOutputBlock: structured rendering of subagent turn logs ───*/
// Returns { prefix: seg[], turns: [{n, children: seg[]}] }
// prefix = segs before first Turn; each turn groups its own segs
function parseSubagentOutput(raw) {
  const lines = (raw || '').split('\n')
  const prefix = []
  const turns = []
  let cur = null   // current turn group (children array)
  let buf = []
  let i = 0

  const flush = (target) => {
    const t = buf.join('\n').trim()
    if (t) target.push({ type: 'text', text: t })
    buf = []
  }
  const target = () => cur ? cur.children : prefix

  while (i < lines.length) {
    const ln = lines[i], tr = ln.trim()
    const mT = tr.match(/^LLM Running \(Turn (\d+)\)/)
    if (mT) {
      flush(target())
      cur = { n: +mT[1], children: [] }
      turns.push(cur)
      i++; continue
    }
    const mS = tr.match(/^<summary>([\s\S]*?)<\/summary>$/)
    if (mS) { flush(target()); target().push({ type: 'summary', text: mS[1] }); i++; continue }
    if (/🛠/.test(tr)) {
      flush(target())
      const mTool = tr.match(/[🛠]️?\s+(\w+)\(([\s\S]+)\)\s*$/)
      if (mTool) {
        let args = {}
        try { args = JSON.parse(mTool[2]) } catch (_) {}
        target().push({ type: 'tool', name: mTool[1], args, rawArgs: mTool[2] })
      } else {
        target().push({ type: 'tool', name: tr, args: {}, rawArgs: '' })
      }
      i++; continue
    }
    if (tr.startsWith('Executed subtask')) { flush(target()); target().push({ type: 'exec', text: tr }); i++; continue }
    if (tr.startsWith('Result:')) { flush(target()); target().push({ type: 'result', text: tr.slice(7).trim() }); i++; continue }
    if (tr === 'Artifact:') {
      flush(target()); i++
      while (i < lines.length && !lines[i].trim()) i++
      if (i < lines.length) { target().push({ type: 'artifact', path: lines[i].trim() }); i++ }
      continue
    }
    if (tr === '[ROUND END]') { flush(target()); target().push({ type: 'roundend' }); i++; continue }
    buf.push(ln); i++
  }
  flush(target())
  return { prefix, turns }
}

function ToolCallCollapse({ name, args }) {
  const keys = Object.keys(args)
  const preview = keys.slice(0, 3).join(' · ') + (keys.length > 3 ? ` +${keys.length - 3}` : '')
  const label = (
    <span className="sa-tool-collapse-label">
      <Tag color="blue" style={{ fontFamily: 'var(--mono,ui-monospace,monospace)', fontSize: 11, marginRight: 6 }}>{name}</Tag>
      {keys.length > 0 && <span className="sa-tool-preview">{preview}</span>}
    </span>
  )
  if (keys.length === 0) return (
    <div className="sa-tool-empty">
      <Tag color="blue" style={{ fontFamily: 'var(--mono,ui-monospace,monospace)', fontSize: 11 }}>{name}</Tag>
    </div>
  )
  return (
    <Collapse ghost size="small" className="sa-tool-collapse" items={[{
      key: '1',
      label,
      children: <pre className="sa-tool-json">{JSON.stringify(args, null, 2)}</pre>
    }]} />
  )
}

function SubagentOutputBlock({ text, onAskReply, isRunning }) {
  const { prefix, turns } = useMemo(() => parseSubagentOutput(text), [text])
  const latestKey = turns.length > 0 ? String(turns[turns.length - 1].n) : ''
  const [activeKeys, setActiveKeys] = useState(() => isRunning && latestKey ? [latestKey] : [])
  const previousLatestKeyRef = useRef(latestKey)
  const previousRunningRef = useRef(isRunning)

  // Follow a newly streamed turn while work is running, collapsing older turns.
  // A running -> terminal transition collapses everything once; subsequent
  // terminal renders preserve any turn the user manually reopens.
  useEffect(() => {
    const wasRunning = previousRunningRef.current
    const previousLatestKey = previousLatestKeyRef.current
    if (wasRunning && !isRunning) {
      setActiveKeys([])
    } else if (isRunning && latestKey && (!wasRunning || latestKey !== previousLatestKey)) {
      setActiveKeys([latestKey])
    }
    previousRunningRef.current = isRunning
    previousLatestKeyRef.current = latestKey
  }, [isRunning, latestKey])

  const renderSeg = (seg, i) => {
    if (seg.type === 'summary') return (
      <div key={i} className="sa-out-summary">{seg.text}</div>
    )
    if (seg.type === 'tool') return (
      <ToolCallCollapse key={i} name={seg.name} args={seg.args} />
    )
    if (seg.type === 'exec') return (
      <div key={i} className="sa-out-exec">{seg.text}</div>
    )
    if (seg.type === 'result') return (
      <div key={i} className="sa-out-result-block">
        <span className="sa-out-result-label">Result</span>
        <span className="sa-out-result-text">{seg.text}</span>
      </div>
    )
    if (seg.type === 'artifact') {
      const fname = seg.path.replace(/\\/g, '/').split('/').pop()
      return (
        <div key={i} className="sa-out-artifact">
          <span className="sa-out-artifact-label">Artifact</span>
          <span className="sa-out-artifact-path" title={seg.path}>{fname}</span>
        </div>
      )
    }
    if (seg.type === 'roundend') return (
      <div key={i} className="sa-out-roundend">&#x2014; Round End &#x2014;</div>
    )
    if (seg.type === 'text' && seg.text) return (
      <MarkdownBlock key={i} text={seg.text} onAskReply={onAskReply} />
    )
    return null
  }

  const turnItems = turns.map(t => {
    const summaryText = t.children.find(s => s.type === 'summary')?.text || ''
    const toolCount = t.children.filter(s => s.type === 'tool').length
    const preview = summaryText
      ? summaryText.slice(0, 52) + (summaryText.length > 52 ? '…' : '')
      : toolCount > 0 ? `${toolCount} tool call${toolCount > 1 ? 's' : ''}` : ''
    const label = (
      <span className="sa-turn-label">
        <Tag color="purple" style={{ fontSize: 10, padding: '0 5px', lineHeight: '18px', marginRight: 6 }}>
          Turn {t.n}
        </Tag>
        {preview && <span className="sa-turn-preview">{preview}</span>}
      </span>
    )
    return {
      key: String(t.n),
      label,
      children: <div className="sa-turn-body">{t.children.map(renderSeg)}</div>
    }
  })

  return (
    <div className="sa-out">
      {prefix.map(renderSeg)}
      {turnItems.length > 0 && (
        <Collapse
          size="small"
          className="sa-turn-collapse"
          activeKey={activeKeys}
          onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys : (keys ? [keys] : []))}
          items={turnItems}
        />
      )}
    </div>
  )
}

function UltraPlanTaskRow({ task, onAskReply }) {
  const linesJoined = Array.isArray(task.output_lines) ? task.output_lines.join('\n') : ''
  const initialContent = task.output || linesJoined || ''
  const outputFile = preferredUltraPlanOutputFile(task)
  const status = task.status || 'running'
  const isRunning = status === 'running'
  const isFailed = status === 'fail' || status === 'failed'
  const [open, setOpen] = useState(() => isRunning)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [content, setContent] = useState(initialContent)
  // running tasks are always expandable (live stream), done tasks are always expandable
  const hasOutput = isRunning || status === 'done' || Boolean(task.output || linesJoined || outputFile)

  // When a task enters running state, open it by default. After it becomes done,
  // keep the current open state so the user can collapse it manually.
  useEffect(() => {
    if (isRunning) setOpen(true)
  }, [isRunning])

  // Sync content from SSE-pushed task.output / task.output_lines
  useEffect(() => {
    const next = task.output || (Array.isArray(task.output_lines) ? task.output_lines.join('\n') : '')
    if (next && next !== content) setContent(next)
  }, [task.output, task.output_lines])

  // Poll output file while running; do a final fetch when done (covers running→done transition)
  useEffect(() => {
    if (!open || !outputFile) return
    let cancelled = false
    const fetchFile = async () => {
      try {
        const d = await api(`/api/files/read?path=${encodeURIComponent(outputFile)}`)
        if (!cancelled && d?.content) setContent(d.content)
      } catch (_) {}
    }
    if (isRunning) {
      fetchFile() // immediate first fetch on open
      const timer = setInterval(fetchFile, 500)
      return () => { cancelled = true; clearInterval(timer) }
    } else {
      // Done: one-time fetch (handles: open after done, OR running→done while panel was open)
      fetchFile()
      return () => { cancelled = true }
    }
  }, [open, isRunning, outputFile])

  const toggle = async () => {
    if (!hasOutput) return
    const nextOpen = !open
    setOpen(nextOpen)
    // running tasks are handled by the polling useEffect above
    if (!nextOpen || isRunning || content || !outputFile) return
    setLoading(true)
    setError('')
    try {
      const d = await api(`/api/files/read?path=${encodeURIComponent(outputFile)}`)
      setContent(d?.content || '')
      if (!d?.content) setError('Output file is empty.')
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`oa-up-task-wrap ${status}${open ? ' is-open' : ''}`}>
      <div
        className={`oa-up-task ${status}${hasOutput ? ' has-output' : ''}`}
        onClick={hasOutput ? toggle : undefined}
        role={hasOutput ? 'button' : undefined}
        tabIndex={hasOutput ? 0 : undefined}
        aria-expanded={hasOutput ? open : undefined}
        onKeyDown={hasOutput ? (e) => (e.key === 'Enter' || e.key === ' ') && toggle() : undefined}
        title={outputFile || task.desc || ''}
      >
        <span className={`oa-up-task-dot oa-up-task-dot-${status}`} aria-hidden="true">
          {status === 'done' ? <Check size={12} /> : isFailed ? <X size={12} /> : <Clock3 size={12} />}
        </span>
        <span className="oa-up-task-desc">{task.desc}</span>
        {outputFile && <span className="oa-up-task-file">{taskFileName(outputFile)}</span>}
        {hasOutput && (
          <span className="oa-up-task-chevron-wrap">
            <ChevronRight size={13} className="oa-up-task-chevron" />
          </span>
        )}
      </div>
      {open && hasOutput && (
        <div className="oa-up-task-output">
          {loading && <div className="oa-up-task-output-meta">Loading output…</div>}
          {error && <div className="oa-up-task-output-error">{error}</div>}
          {!loading && !error && content && <SubagentOutputBlock text={content} onAskReply={onAskReply} isRunning={isRunning} />}
          {!loading && !error && !content && status === 'running' && (
            <div className="oa-up-task-output-waiting">
              <span className="oa-up-task-output-waiting-dot" /><span className="oa-up-task-output-waiting-dot" /><span className="oa-up-task-output-waiting-dot" />
              <span>{ct('等待输出…', 'Waiting for output…')}</span>
            </div>
          )}
          {!loading && !error && !content && status === 'done' && (
            <div className="oa-up-task-output-meta" style={{color:'var(--muted-2)',fontStyle:'italic'}}>{ct('暂无输出内容', 'No output yet')}</div>
          )}
        </div>
      )}
    </div>
  )
}

function UltraPlanDashboard({ state, onAskReply }) {
  const [expanded, setExpanded] = useState(true)
  const panelId = React.useId()
  const { objective, phases = [], recentTasks = [], complete, events = [], resultFiles = [], current, taskOutputs = {}, task_outputs = {} } = state
  const outputsMap = (taskOutputs && Object.keys(taskOutputs).length) ? taskOutputs : (task_outputs || {})
  const phaseTasks = phases.flatMap((phase) => Array.isArray(phase.tasks) ? phase.tasks : [])
  const trackedItems = phases.length ? phases : recentTasks
  const completedItems = complete ? trackedItems.length : trackedItems.filter((item) => item?.status === 'done').length
  const progressPercent = complete ? 100 : (trackedItems.length ? Math.round((completedItems / trackedItems.length) * 100) : 0)
  const taskCount = phaseTasks.length || recentTasks.length
  const hasFailure = [...phases, ...phaseTasks, ...recentTasks].some((item) => item?.status === 'fail' || item?.status === 'failed')
  const hasWork = Boolean(current || phases.length || recentTasks.length)
  const statusTone = complete ? 'done' : hasFailure ? 'failed' : hasWork ? 'run' : 'pending'
  const statusLabel = complete
    ? ct('\u5df2\u5b8c\u6210', 'Completed')
    : hasFailure
      ? ct('\u9700\u5173\u6ce8', 'Needs attention')
      : hasWork
        ? ct('\u6267\u884c\u4e2d', 'Running')
        : ct('\u51c6\u5907\u4e2d', 'Preparing')
  const progressLabel = phases.length
    ? ct(`${completedItems} / ${phases.length} \u9636\u6bb5\u5b8c\u6210`, `${completedItems} / ${phases.length} phases completed`)
    : recentTasks.length
      ? ct(`${completedItems} / ${recentTasks.length} \u4efb\u52a1\u5b8c\u6210`, `${completedItems} / ${recentTasks.length} tasks completed`)
      : complete ? ct('\u6267\u884c\u5df2\u5b8c\u6210', 'Execution completed') : ct('\u7b49\u5f85\u6267\u884c\u6b65\u9aa4', 'Waiting for execution steps')
  const isEmpty = !current && phases.length === 0 && recentTasks.length === 0 && resultFiles.length === 0
  const openFile = (fp) => {
    if (!fp) return
    const u = `/api/files/read?path=${encodeURIComponent(fp)}`
    window.open(u, '_blank', 'noopener')
  }
  return (
    <div className={`oa-up-dash oa-up-${statusTone}${expanded ? '' : ' is-collapsed'}`}>
      <button type="button" className="oa-up-head" onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded} aria-controls={panelId}
        aria-label={expanded ? ct('\u6536\u8d77 UltraPlan \u6267\u884c\u9762\u677f', 'Collapse UltraPlan execution panel') : ct('\u5c55\u5f00 UltraPlan \u6267\u884c\u9762\u677f', 'Expand UltraPlan execution panel')}>
        <span className="oa-up-icon oa-up-mark" aria-hidden="true"><Sparkles size={15} strokeWidth={2.1} /></span>
        <span className="oa-up-heading">
          <span className="oa-up-title-row">
            <span className="oa-up-title">UltraPlan</span>
            <span className="oa-up-kicker">{ct('\u4efb\u52a1\u7f16\u6392', 'Task orchestration')}</span>
          </span>
          <span className="oa-up-obj">{objective || ct('\u7b49\u5f85\u4efb\u52a1\u76ee\u6807', 'Waiting for task objective')}</span>
        </span>
        <span className={`oa-up-badge oa-up-${statusTone}`}>{statusLabel}</span>
        <span className="oa-up-chevron" aria-hidden="true">
          {expanded ? <ChevronDown size={15} /> : <ChevronLeft size={15} />}
        </span>
      </button>
      <div id={panelId} className="oa-up-body" hidden={!expanded}>
        <section className="oa-up-overview" aria-label={ct('UltraPlan \u6267\u884c\u6458\u8981', 'UltraPlan execution summary')}>
          <div className="oa-up-progress-head">
            <div>
              <span className="oa-up-section-label">{ct('\u6267\u884c\u8fdb\u5ea6', 'Execution progress')}</span>
              <strong className="oa-up-progress-copy">{progressLabel}</strong>
            </div>
            <span className="oa-up-progress-value">{progressPercent}<small>%</small></span>
          </div>
          <div className="oa-up-progress-track" role="progressbar" aria-label={ct('UltraPlan \u6267\u884c\u8fdb\u5ea6', 'UltraPlan execution progress')}
            aria-valuemin="0" aria-valuemax="100" aria-valuenow={progressPercent}>
            <span style={{ '--oa-up-progress': progressPercent / 100 }} />
          </div>
          <div className="oa-up-stats" aria-label={ct('\u6267\u884c\u7edf\u8ba1', 'Execution statistics')}>
            <span><strong>{phases.length}</strong>{ct(' \u9636\u6bb5', ' phases')}</span>
            <span><strong>{taskCount}</strong>{ct(' \u4efb\u52a1', ' tasks')}</span>
            <span><strong>{resultFiles.length}</strong>{ct(' \u4ea7\u7269', ' outputs')}</span>
          </div>
          {!complete && current && (
            <div className="oa-up-current">
              <span className="oa-up-current-dot" aria-hidden="true" />
              <span className="oa-up-current-label">{ct('\u5f53\u524d', 'Current')}</span>
              <span>{current}</span>
            </div>
          )}
        </section>

        {isEmpty && (
          <div className="oa-up-empty">
            <Clock3 size={16} aria-hidden="true" />
            <div><strong>{ct('\u7b49\u5f85 UltraPlan \u53d1\u5e03\u6b65\u9aa4', 'Waiting for UltraPlan steps')}</strong><span>{ct('\u8ba1\u5212\u5f00\u59cb\u540e\uff0c\u9636\u6bb5\u548c\u4efb\u52a1\u4f1a\u5728\u8fd9\u91cc\u5b9e\u65f6\u66f4\u65b0\u3002', 'Phases and tasks will update here in real time after the plan starts.')}</span></div>
          </div>
        )}

        {recentTasks.length > 0 && phases.length === 0 && (
          <section className="oa-up-section oa-up-recent">
            <div className="oa-up-section-head">
              <span className="oa-up-section-label">{ct('\u6267\u884c\u4efb\u52a1', 'Execution tasks')}</span>
              <span>{recentTasks.length}</span>
            </div>
            <div className="oa-up-tasks">
              {recentTasks.map((task, i) => {
                const lines = (task && task.id && outputsMap && outputsMap[task.id]) ? outputsMap[task.id] : null
                const injected = lines && lines.length ? { ...task, output_lines: lines } : task
                return <UltraPlanTaskRow key={task?.id || i} task={injected} onAskReply={onAskReply} />
              })}
            </div>
          </section>
        )}

        {phases.length > 0 && (
          <section className="oa-up-section oa-up-phase-section">
            <div className="oa-up-section-head">
              <span className="oa-up-section-label">{ct('\u6267\u884c\u9636\u6bb5', 'Execution phases')}</span>
              <span>{completedItems}/{phases.length}</span>
            </div>
            <div className="oa-up-phases">
              {phases.map((ph, i) => {
                const phaseFailed = ph.status === 'fail' || ph.status === 'failed'
                return (
                  <div key={ph.id || ph.name || i} className={`oa-up-phase ${ph.status || 'running'}`}>
                    <span className="oa-up-phase-icon" aria-hidden="true">
                      {ph.status === 'done' ? <Check size={13} /> : phaseFailed ? <X size={13} /> : <Clock3 size={13} />}
                    </span>
                    <div className="oa-up-phase-body">
                      <div className="oa-up-phase-info">
                        <span className="oa-up-phase-name">{ph.name}</span>
                        {ph.desc && <span className="oa-up-phase-desc">{ph.desc}</span>}
                        {ph.elapsed && <span className="oa-up-phase-time">{ph.elapsed}</span>}
                      </div>
                      {ph.tasks && ph.tasks.length > 0 && (
                        <div className="oa-up-tasks">
                          {ph.tasks.map((task, j) => {
                            const lines = (task && task.id && outputsMap && outputsMap[task.id]) ? outputsMap[task.id] : null
                            const injected = lines && lines.length ? { ...task, output_lines: lines } : task
                            return <UltraPlanTaskRow key={task?.id || j} task={injected} onAskReply={onAskReply} />
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {resultFiles.length > 0 && (
          <section className="oa-up-files">
            <div className="oa-up-files-head">
              <span className="oa-up-section-label">{ct('\u4ea7\u51fa\u6587\u4ef6', 'Output files')}</span>
              <span>{resultFiles.length}</span>
            </div>
            <div className="oa-up-files-list">
              {resultFiles.map((result, i) => (
                <button type="button" key={result.file || i} className="oa-up-file-item" onClick={() => openFile(result.file)} title={result.file}>
                  <span className="oa-up-file-icon" aria-hidden="true"><FileOutput size={15} /></span>
                  <span className="oa-up-file-body">
                    <span className="oa-up-file-desc">{result.desc || taskFileName(result.file)}</span>
                    <span className="oa-up-file-path">{result.file}</span>
                  </span>
                  <ExternalLink size={13} className="oa-up-file-open" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        )}

        {events.length > 0 && (
          <details className="oa-up-events">
            <summary><span>{ct('\u8fd0\u884c\u65e5\u5fd7', 'Run log')}</span><span className="oa-up-events-count">{events.length}</span></summary>
            <div className="oa-up-events-body">
              {events.map((event, i) => (
                <div key={i} className={`oa-up-event oa-up-event-${event.tag}`}>
                  <span className="oa-up-event-tag">[{event.tag}]</span>
                  <span className="oa-up-event-body">{event.body}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

const parseToolCallBlock = (block = '') => {
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

const parseToolArgsBlock = (block = '') => {
  const m = String(block || '').trim().match(/^📥\s*args:\s*([\s\S]*)$/i)
  return m ? (m[1] || '').trim() : null
}

function AskUserPanel({ call, onReply }) {
  const ask = getAskUserPayload(call)
  const hasStructured = Boolean(ask.question || ask.candidates.length)
  return <div className="oa-ask-panel">
    <div className="oa-ask-banner">
      <span className="oa-ask-avatar">?</span>
      <div><b>{ct('需要用户确认', 'User confirmation required')}</b><p>{ct('智能体正在等待你的选择或补充信息', 'The agent is waiting for your choice or additional information')}</p></div>
    </div>
    {hasStructured ? <div className="oa-ask-body">
      {ask.question && <div className="oa-ask-question"><span>{ct('问题', 'Question')}</span><p>{ask.question}</p></div>}
      {ask.candidates.length > 0 && <div className="oa-ask-options"><span>{ct('快捷回复', 'Quick replies')}</span><div>{ask.candidates.map((x,i)=><button type="button" key={`${x}-${i}`} onClick={(e)=>{e.stopPropagation(); onReply?.(x)}} title={ct('点击填入输入框', 'Insert into the input')}>{x}</button>)}</div></div>}
    </div> : call.args && <div className="oa-tool-args"><span>{'💬 question'}</span><pre>{call.args}</pre></div>}
    {call.result && <div className="oa-tool-result oa-ask-result"><span>{'📤 result'}</span><pre>{call.result}</pre></div>}
  </div>
}

function ToolCallBlock({ call, onAskReply }) {
  const toolName = String(call.name || 'unknown').trim()
  const isAskUser = /(?:^|[._-])ask_user$/i.test(toolName)
  const [open, setOpen] = useState(isAskUser)
  const resultStatus = String(call.result || '').match(/\[Status\]\s*([^\n]+)/i)?.[1]?.trim()
  const askPayload = isAskUser ? getAskUserPayload(call) : null
  const askSummary = askPayload?.question || ct('等待用户确认', 'Waiting for confirmation')
  return <div className={`oa-tool-call ${isAskUser ? 'oa-tool-ask-user' : ''} ${open ? 'open' : 'collapsed'}`}>
    <button className="oa-tool-head" type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}>
      <span className="oa-tool-icon">{isAskUser ? '❓' : '🛠️'}</span><span>{isAskUser ? 'Ask user' : 'Tool'}</span><b>{toolName}</b>
      {isAskUser && <strong className="oa-ask-headline">{askSummary}</strong>}
      {resultStatus && <em>{resultStatus}</em>}
      {isAskUser && !resultStatus && <em>{askPayload?.candidates?.length ? ct(`${askPayload.candidates.length} 个选项`, `${askPayload.candidates.length} options`) : ct('等待回复', 'Waiting for reply')}</em>}
      <ChevronDown size={15} className="oa-tool-chevron" />
    </button>
    {open && (isAskUser ? <AskUserPanel call={call} onReply={onAskReply} /> : <>
      {call.args && <div className="oa-tool-args"><span>{'📥 args'}</span><pre>{call.args}</pre></div>}
      {call.result && <div className="oa-tool-result"><span>{'📤 result'}</span><pre>{call.result}</pre></div>}
    </>)}
  </div>
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
  if (!/^:?-{3,}:?$/.test(s)) return null
  if (s.startsWith(':') && s.endsWith(':')) return 'center'
  if (s.endsWith(':')) return 'right'
  return 'left'
}

const parseMarkdownTable = (block = '') => {
  const lines = String(block || '').split('\n').filter(x => x.trim())
  if (lines.length < 2 || !lines[0].includes('|') || !lines[1].includes('|')) return null
  const head = splitTableRow(lines[0])
  const aligns = splitTableRow(lines[1]).map(parseTableAlign)
  if (!head.length || aligns.some(x => x === null) || aligns.length < head.length) return null
  const rows = lines.slice(2).map(splitTableRow).filter(cells => cells.length > 0)
  return { head, aligns, rows }
}

function renderMarkdownTable(table, key) {
  return <div key={key} className="oa-table-wrap">
    <table className="oa-md-table">
      <thead><tr>{table.head.map((cell, i) => <th key={i} style={{ textAlign: table.aligns[i] || 'left' }}><InlineRichText text={cell} /></th>)}</tr></thead>
      <tbody>{table.rows.map((row, r) => <tr key={r}>{table.head.map((_, c) => <td key={c} style={{ textAlign: table.aligns[c] || 'left' }}><InlineRichText text={row[c] || ''} /></td>)}</tr>)}</tbody>
    </table>
  </div>
}

function renderListBlock(lines, i, ordered) {
  const itemRe = ordered ? /^\s*(\d+)[.)]\s+/ : /^\s*[-*+]\s+/
  const Tag = ordered ? 'ol' : 'ul'
  const shownLines = lines.slice(0, LIST_ITEM_LIMIT)
  const hidden = Math.max(0, lines.length - shownLines.length)
  const firstNumber = ordered ? Number(String(lines[0] || '').match(itemRe)?.[1] || 1) : undefined
  const props = ordered ? { start: firstNumber } : {}
  return <Tag key={i} className={`oa-list ${ordered ? 'oa-list-ordered' : 'oa-list-unordered'}`} {...props}>
    {shownLines.map((x,j)=>{
      const itemNumber = ordered ? Number(String(x || '').match(itemRe)?.[1] || firstNumber + j) : undefined
      const liProps = ordered ? { value: itemNumber } : {}
      return <li key={j} {...liProps}><InlineRichText text={x.replace(itemRe, '')} /></li>
    })}
    {hidden > 0 && <li className="oa-md-truncated">{ct(`… 已隐藏 ${hidden.toLocaleString(chatLocale())} 个列表项`, `… ${hidden.toLocaleString(chatLocale())} list items hidden`)}</li>}
  </Tag>
}

function renderPlainTextBlock(b, key) {
  const trimmed = String(b || '').trim()
  if (!trimmed) return null
  const lines = trimmed.split('\n')
  const orderedOnly = lines.every(x => /^\s*\d+[.)]\s+/.test(x))
  const unorderedOnly = lines.every(x => /^\s*[-*+]\s+/.test(x))
  if (orderedOnly) return renderListBlock(lines, key, true)
  if (unorderedOnly) return renderListBlock(lines, key, false)
  if (/^#{1,3}\s+/.test(trimmed)) {
    const level = Math.min(3, trimmed.match(/^#+/)[0].length)
    const body = trimmed.replace(/^#{1,3}\s+/, '')
    const Tag = `h${level + 2}`
    return <Tag key={key}><InlineRichText text={body} /></Tag>
  }
  return <p key={key}><InlineRichText text={trimmed} /></p>
}

function renderTextBlock(b, i) {
  const table = parseMarkdownTable(b)
  if (table) return renderMarkdownTable(table, i)

  const lines = String(b || '').split('\n')
  const nodes = []
  let paragraph = []
  let list = []
  let listOrdered = null
  let seq = 0
  const flushParagraph = () => {
    if (!paragraph.length) return
    const node = renderPlainTextBlock(paragraph.join('\n'), `${i}-p-${seq++}`)
    if (node) nodes.push(node)
    paragraph = []
  }
  const flushList = () => {
    if (!list.length) return
    nodes.push(renderListBlock(list, `${i}-l-${seq++}`, listOrdered === true))
    list = []
    listOrdered = null
  }

  for (const line of lines) {
    const isOrdered = /^\s*\d+[.)]\s+/.test(line)
    const isUnordered = /^\s*[-*+]\s+/.test(line)
    if (isOrdered || isUnordered) {
      flushParagraph()
      const ordered = isOrdered
      if (list.length && listOrdered !== ordered) flushList()
      listOrdered = ordered
      list.push(line)
    } else {
      flushList()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()
  if (nodes.length === 1) return nodes[0]
  if (nodes.length > 1) return <div key={i} className="oa-md-fragment">{nodes}</div>
  return null
}

function TextMarkdown({ text = '', onAskReply }) {
  const allBlocks = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/)
  const blocks = allBlocks.slice(0, MARKDOWN_BLOCK_LIMIT)
  const hiddenBlocks = Math.max(0, allBlocks.length - blocks.length)
  const nodes = []
  for (let i = 0; i < blocks.length; i++) {
    const toolCall = parseToolCallBlock(blocks[i])
    if (toolCall) {
      let j = i + 1
      while (j < blocks.length) {
        const args = parseToolArgsBlock(blocks[j])
        if (args === null) break
        toolCall.args = [toolCall.args, args].filter(Boolean).join('\n\n')
        j += 1
      }
      nodes.push(<ToolCallBlock key={i} call={toolCall} onAskReply={onAskReply} />)
      i = j - 1
      continue
    }
    const standaloneArgs = parseToolArgsBlock(blocks[i])
    if (standaloneArgs !== null) {
      nodes.push(<ToolCallBlock key={i} call={{ name: 'unknown', args: standaloneArgs }} onAskReply={onAskReply} />)
      continue
    }
    nodes.push(renderTextBlock(blocks[i], i))
  }
  if (hiddenBlocks > 0) nodes.push(<div key="__hidden_blocks" className="oa-md-truncated">{ct(`… 已隐藏 ${hiddenBlocks.toLocaleString(chatLocale())} 个内容块，可复制消息查看完整内容。`, `… ${hiddenBlocks.toLocaleString(chatLocale())} content blocks hidden; copy the message to view all.`)}</div>)
  return <>{nodes}</>
}

const ULTRAPLAN_DRAWER_DEFAULT_WIDTH = 440
const ULTRAPLAN_DRAWER_MIN_WIDTH = 360
const ULTRAPLAN_DRAWER_MAX_WIDTH = 960
const ULTRAPLAN_DRAWER_VIEWPORT_GUTTER = 24

function getUltraPlanDrawerMaxWidth() {
  if (typeof window === 'undefined') return ULTRAPLAN_DRAWER_MAX_WIDTH
  return Math.max(
    ULTRAPLAN_DRAWER_MIN_WIDTH,
    Math.min(ULTRAPLAN_DRAWER_MAX_WIDTH, Math.floor(window.innerWidth - ULTRAPLAN_DRAWER_VIEWPORT_GUTTER)),
  )
}

function clampUltraPlanDrawerWidth(width, maxWidth = getUltraPlanDrawerMaxWidth()) {
  return Math.min(maxWidth, Math.max(ULTRAPLAN_DRAWER_MIN_WIDTH, Math.round(Number(width) || ULTRAPLAN_DRAWER_DEFAULT_WIDTH)))
}

function UltraPlanMessageDrawer({ content = '', state, pending = false, onAskReply }) {
  const mergedState = useMemo(
    () => mergeUltraPlanStates(state, parseUltraPlanText(content)),
    [state, content],
  )
  const available = hasUltraPlanDashboardState(mergedState)
  const [open, setOpen] = useState(false)
  const [drawerWidth, setDrawerWidth] = useState(() => clampUltraPlanDrawerWidth(ULTRAPLAN_DRAWER_DEFAULT_WIDTH))
  const [drawerMaxWidth, setDrawerMaxWidth] = useState(() => getUltraPlanDrawerMaxWidth())
  const [resizing, setResizing] = useState(false)
  const entryRef = useRef(null)
  const drawerWidthRef = useRef(drawerWidth)
  const resizeSessionRef = useRef(null)
  const autoOpenedRef = useRef(false)
  const userDismissedRef = useRef(false)
  const drawerId = React.useId()
  const titleId = `${drawerId}-title`

  const applyDrawerWidth = useCallback((nextWidth) => {
    const maxWidth = getUltraPlanDrawerMaxWidth()
    const width = clampUltraPlanDrawerWidth(nextWidth, maxWidth)
    drawerWidthRef.current = width
    setDrawerMaxWidth(maxWidth)
    setDrawerWidth(width)
  }, [])

  const beginDrawerResize = useCallback((event) => {
    if (event.button != null && event.button !== 0) return
    const startX = Number.isFinite(event.clientX) ? event.clientX : 0
    resizeSessionRef.current = {
      pointerId: event.pointerId,
      startX,
      startWidth: drawerWidthRef.current,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setResizing(true)
    event.preventDefault()
  }, [])

  const moveDrawerResize = useCallback((event) => {
    const session = resizeSessionRef.current
    if (!session || (session.pointerId != null && event.pointerId !== session.pointerId)) return
    const clientX = Number.isFinite(event.clientX) ? event.clientX : session.startX
    applyDrawerWidth(session.startWidth + session.startX - clientX)
    event.preventDefault()
  }, [applyDrawerWidth])

  const finishDrawerResize = useCallback((event) => {
    const session = resizeSessionRef.current
    if (!session || (session.pointerId != null && event.pointerId !== session.pointerId)) return
    resizeSessionRef.current = null
    setResizing(false)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const resizeDrawerFromKeyboard = useCallback((event) => {
    const step = event.shiftKey ? 64 : 32
    let nextWidth = null
    if (event.key === 'ArrowLeft') nextWidth = drawerWidthRef.current + step
    else if (event.key === 'ArrowRight') nextWidth = drawerWidthRef.current - step
    else if (event.key === 'Home') nextWidth = ULTRAPLAN_DRAWER_MIN_WIDTH
    else if (event.key === 'End') nextWidth = getUltraPlanDrawerMaxWidth()
    if (nextWidth == null) return
    event.preventDefault()
    applyDrawerWidth(nextWidth)
  }, [applyDrawerWidth])

  const closeDrawer = useCallback(() => {
    userDismissedRef.current = true
    setOpen(false)
    const restoreFocus = () => entryRef.current?.focus()
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restoreFocus)
    else setTimeout(restoreFocus, 0)
  }, [])

  useEffect(() => {
    const syncWidthToViewport = () => applyDrawerWidth(drawerWidthRef.current)
    syncWidthToViewport()
    window.addEventListener('resize', syncWidthToViewport)
    return () => window.removeEventListener('resize', syncWidthToViewport)
  }, [applyDrawerWidth])

  useEffect(() => {
    if (!available || !pending || mergedState?.complete || autoOpenedRef.current || userDismissedRef.current) return
    autoOpenedRef.current = true
    setOpen(true)
  }, [available, pending, mergedState?.complete])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeDrawer()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, closeDrawer])

  if (!available) return null

  const phases = Array.isArray(mergedState.phases) ? mergedState.phases : []
  const recentTasks = Array.isArray(mergedState.recentTasks) ? mergedState.recentTasks : []
  const phaseTasks = phases.flatMap(phase => Array.isArray(phase.tasks) ? phase.tasks : [])
  const total = phaseTasks.length || recentTasks.length || phases.length
  const done = mergedState.complete
    ? total
    : (phaseTasks.length ? phaseTasks : (recentTasks.length ? recentTasks : phases))
      .filter(item => String(item?.status || '').toLowerCase() === 'done').length
  const statusText = mergedState.complete
    ? '\u5df2\u5b8c\u6210'
    : (pending ? '\u6267\u884c\u4e2d' : '\u53ef\u67e5\u770b')
  const objective = String(mergedState.objective || mergedState.current || '\u67e5\u770b\u8ba1\u5212\u4e0e\u5b50\u4efb\u52a1\u8fdb\u5c55')

  return (
    <div className="oa-message-ultraplan">
      <button
        ref={entryRef}
        type="button"
        className="oa-up-entry"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpen(true)}
      >
        <span className="oa-up-entry-mark" aria-hidden="true"><Sparkles size={15} /></span>
        <span className="oa-up-entry-copy">
          <b>UltraPlan</b>
          <small>{objective}</small>
        </span>
        <span className={`oa-up-entry-status ${mergedState.complete ? 'is-done' : 'is-running'}`}>
          {statusText}{total > 0 ? ` \u00b7 ${done}/${total}` : ''}
        </span>
        <PanelRightOpen size={16} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div className="oa-message-ultraplan oa-up-drawer-layer" data-ultraplan-drawer-owner="message">
          <aside
            id={drawerId}
            className={`oa-up-drawer ${resizing ? 'is-resizing' : ''}`}
            role="region"
            aria-labelledby={titleId}
            style={{ '--oa-up-drawer-width': `${drawerWidth}px` }}
          >
            <div
              className="oa-up-drawer-resize"
              role="separator"
              aria-label={'\u8c03\u6574 UltraPlan \u4fa7\u680f\u5bbd\u5ea6'}
              aria-orientation="vertical"
              aria-controls={drawerId}
              aria-valuemin={ULTRAPLAN_DRAWER_MIN_WIDTH}
              aria-valuemax={drawerMaxWidth}
              aria-valuenow={drawerWidth}
              aria-valuetext={`${drawerWidth} px`}
              tabIndex={0}
              onPointerDown={beginDrawerResize}
              onPointerMove={moveDrawerResize}
              onPointerUp={finishDrawerResize}
              onPointerCancel={finishDrawerResize}
              onKeyDown={resizeDrawerFromKeyboard}
            />
            <header className="oa-up-drawer-head">
              <span className="oa-up-drawer-kicker">MESSAGE-LINKED PLAN</span>
              <div>
                <h2 id={titleId}>UltraPlan</h2>
                <p>{objective}</p>
              </div>
              <button type="button" className="oa-up-drawer-close" aria-label={'\u5173\u95ed UltraPlan \u8be6\u60c5'} onClick={closeDrawer}>
                <X size={18} />
              </button>
            </header>
            <div className="oa-up-drawer-scroll">
              <UltraPlanDashboard state={mergedState} onAskReply={onAskReply} />
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </div>
  )
}

const AssistantContent = memo(function AssistantContent({ content, pending, onAskReply, turnUsages, ultraplan_state }) {
  const [openTurns, setOpenTurns] = useState({})
  const [stackOpen, setStackOpen] = useState(pending)
  // 生成中自动展开过程；完成后自动折叠，只留最终回复。手动切换在 pending 不变时保留
  useEffect(() => { setStackOpen(pending) }, [pending])
  const liveUltraPlanState = useMemo(() => normalizeUltraPlanState(ultraplan_state), [ultraplan_state])
  const stats = useMemo(() => textRenderStats(content), [content])
  const parsed = useMemo(() => parseAssistantContent(content), [content])
  const hasTurnSplit = parsed.runs.length > 0
  const hasLiveUltraPlan = !!(liveUltraPlanState && (liveUltraPlanState.phases?.length > 0 || liveUltraPlanState.recentTasks?.length > 0 || liveUltraPlanState.objective))
  if (!content && pending && !hasLiveUltraPlan) return <div className="oa-content oa-thinking">{ct('正在思考…', 'Thinking…')}</div>
  if (content && stats.tooLarge && !hasTurnSplit) return <div className="oa-content"><LongTextPreview text={content} stats={stats} /></div>
  const boxedRuns = parsed.runs.slice(0, -1)
  const lastRun = parsed.runs[parsed.runs.length - 1]
  // A persisted UltraPlan state belongs to the final user-visible branch. When a
  // response has turn markers but no explicit final marker, that branch is the
  // latest run rather than parsed.body.
  const ultraPlanStateForLastRun = !parsed.body && hasLiveUltraPlan
    ? (liveUltraPlanState || ultraplan_state)
    : undefined
  const isTurnOpen = (r, i) => openTurns[`${r.turn}-${i}`] === true
  const toggleTurn = (r, i) => setOpenTurns(xs => ({ ...xs, [`${r.turn}-${i}`]: !isTurnOpen(r, i) }))
  return <div className={`oa-content ${parsed.runs.length ? 'oa-agent-output' : ''}`}>
    {parsed.runs.length > 0 && <div className={`oa-turn-stack ${stackOpen ? 'open' : 'collapsed'}`}>
      <button className="oa-turn-stack-head" type="button" onClick={() => setStackOpen(v => !v)} aria-expanded={stackOpen} title={stackOpen ? ct('折叠执行过程', 'Collapse execution') : ct('展开执行过程', 'Expand execution')}>
        <span className="oa-run-dot"/>
        <span>{ct('执行过程', 'Execution')}</span>
        <b>{parsed.runs.length}</b>
        <em>{pending ? ct('正在生成', 'Generating') : ct('已完成', 'Completed')}</em>
        <ChevronDown className="oa-stack-chevron" size={15}/>
      </button>
      {stackOpen && boxedRuns.map((r, i) => {
        const open = isTurnOpen(r, i)
        const tu = turnUsages && turnUsages[i]
        return <div className="oa-turn-node" key={`${r.turn}-${i}`}>
          <section className={`oa-turn-card ${open ? 'open' : 'collapsed'}`}>
            <button className="oa-turn-toggle" type="button" onClick={() => toggleTurn(r, i)} aria-expanded={open} title={r.title || ct('执行步骤', 'Execution step')}>
              <span className="oa-turn-index">{ct('步骤', 'Step')} {r.turn}</span>
              <b>{r.title || ct('执行步骤', 'Execution step')}</b>
              <UsageRow u={tu} className="oa-usage-inline" />
              <ChevronDown size={15} className="oa-turn-chevron"/>
            </button>
            {open && (r.body ? renderAssistantBody(r.body, onAskReply) : <p className="oa-turn-empty">{ct('该轮暂无详细输出', 'No detailed output for this turn')}</p>)}
          </section>
        </div>
      })}
      {lastRun && <section className="oa-turn-current" key={`last-${lastRun.turn}`}>
        <div className="oa-turn-current-head"><span className="oa-turn-index oa-turn-index-current">{ct('步骤', 'Step')} {lastRun.turn}</span><b>{lastRun.title || ct('正在执行', 'Running')}</b><UsageRow u={turnUsages && turnUsages[boxedRuns.length]} className="oa-usage-inline" /><em>{pending ? ct('实时输出中', 'Live output') : ct('最新一轮', 'Latest turn')}</em></div>
        {lastRun.body || ultraPlanStateForLastRun
          ? renderAssistantBody(lastRun.body || '', onAskReply, ultraPlanStateForLastRun)
          : <p className="oa-turn-empty">{ct('正在等待该轮输出…', 'Waiting for this turn’s output…')}</p>}
      </section>}
    </div>}
    {(parsed.summary || parsed.body || !parsed.runs.length) && <div className={parsed.runs.length ? 'oa-final-answer' : ''}>
      {parsed.runs.length > 0 && <div className="oa-final-label">{ct('返回给用户', 'Response to user')}</div>}
      {parsed.summary && <div className="oa-response-summary" aria-label={ct('响应摘要', 'Response summary')}><span>{ct('摘要', 'Summary')}</span><b>{parsed.summary}</b></div>}
      {renderAssistantBody(parsed.body || (!parsed.summary ? content : '') || '', onAskReply, liveUltraPlanState || ultraplan_state)}
    </div>}
  </div>
})

// User messages append a generated attachment block. Cards render it separately, so hide the raw suffix.
const stripUserAttachmentBlock = (content = '') => {
  const src = String(content || '')
  const markers = ['\n[附件]', '\n[图片附件]', '\n[附件已保存]', '[附件]', '[图片附件]', '[附件已保存]']
  let cut = -1
  for (const marker of markers) {
    const i = src.lastIndexOf(marker)
    if (i >= 0 && (cut < 0 || i < cut)) cut = i
  }
  return cut >= 0 ? src.slice(0, cut).trimEnd() : src
}

const extractSavedFilePaths = (content = '') => Array.from(
  String(content || '').matchAll(/\[FILE:([^\]]+)\]/g),
  (match) => match[1].trim(),
).filter(Boolean)

const usageHasTokens = (u) => !!u && ((u.input_tokens || 0) > 0 || (u.output_tokens || 0) > 0 || (u.cached_tokens || 0) > 0)
const formatElapsedMs = (ms = 0) => {
  const safe = Math.max(0, Number(ms) || 0)
  if (safe < 1000) return `${Math.max(0.1, safe / 1000).toFixed(1)}s`
  const totalSeconds = Math.floor(safe / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) return `${seconds}s`
  const hours = Math.floor(minutes / 60)
  const mm = minutes % 60
  if (hours > 0) return `${hours}h ${mm}m ${seconds}s`
  return `${minutes}m ${seconds}s`
}
const getElapsedMs = (m, now = Date.now()) => {
  if (!m || m.role !== 'assistant') return 0
  if (m.elapsed_ms > 0) return m.elapsed_ms
  if (m.run_started_at_ms > 0) return Math.max(0, now - m.run_started_at_ms)
  return 0
}

const UsageRow = ({ u, label, className, elapsedMs = 0, live = false }) => {
  const hasTokens = usageHasTokens(u)
  const hasElapsed = elapsedMs > 0
  if (!hasTokens && !hasElapsed) return null
  return <div className={`oa-usage ${className || ''}`}>
    {label && <span className="oa-usage-label">{label}</span>}
    {hasElapsed && <span className={live ? 'oa-usage-time is-live' : 'oa-usage-time'} title={live ? ct('实时耗时', 'Live elapsed time') : ct('耗时', 'Elapsed time')}><svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 1.5A4.5 4.5 0 1 1 8 11a4.5 4.5 0 0 1 0-7.5z"/><path d="M7.5 4.5h1v3.65l2.2 1.3-.5.9L7.5 9V4.5z"/></svg>{ct('耗时', 'Time')} <b>{formatElapsedMs(elapsedMs)}</b></span>}
    {u?.input_tokens > 0 && <span className="oa-usage-in" title={ct('输入 tokens', 'Input tokens')}><svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M8 11.5 3.5 7l1.1-1.1L8 9.3l3.4-3.4L12.5 7 8 11.5Z"/></svg>{ct('输入', 'Input')} <b>{u.input_tokens.toLocaleString(chatLocale())}</b></span>}
    {u?.cached_tokens > 0 && <span className="oa-usage-cache" title={ct('缓存 tokens', 'Cached tokens')}><svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M8.5 1 2 9h4.2l-1 6L13 7H8.5l1-6Z"/></svg>{ct('缓存', 'Cached')} <b>{u.cached_tokens.toLocaleString(chatLocale())}</b></span>}
    {u?.output_tokens > 0 && <span className="oa-usage-out" title={ct('输出 tokens', 'Output tokens')}><svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M8 4.5 12.5 9l-1.1 1.1L8 6.7l-3.4 3.4L3.5 9 8 4.5Z"/></svg>{ct('输出', 'Output')} <b>{u.output_tokens.toLocaleString(chatLocale())}</b></span>}
  </div>
}

// 各内部 turn 用量累加得到整条回复总计
const sumUsages = (usages) => {
  if (!Array.isArray(usages) || !usages.length) return null
  return usages.reduce((acc, u) => ({
    input_tokens: acc.input_tokens + (u?.input_tokens || 0),
    cached_tokens: acc.cached_tokens + (u?.cached_tokens || 0),
    output_tokens: acc.output_tokens + (u?.output_tokens || 0),
  }), { input_tokens: 0, cached_tokens: 0, output_tokens: 0 })
}

export const CommandResultCard = memo(function CommandResultCard({ result = {} }) {
  const command = `/${String(result.command || '').replace(/^\//, '')}`
  const summary = commandResultSummary(result)
  const treeNodes = Array.isArray(result.tree?.nodes) ? result.tree.nodes : []
  const services = Array.isArray(result.services) ? result.services : []
  const commands = Array.isArray(result.commands) ? result.commands : []
  const records = Array.isArray(result.records) ? result.records : []
  const status = result.session && typeof result.session === 'object' ? result.session : null

  return (
    <section className="oa-command-result" aria-label={`${command} \u547d\u4ee4\u7ed3\u679c`}>
      <header><Check size={17}/><div><b>{summary}</b><span>{command}</span></div></header>
      {command === '/worldline' && result.action !== 'restore' && (
        treeNodes.length > 0
          ? <div className="oa-command-list" aria-label="\u4e16\u754c\u7ebf\u8282\u70b9">
              {treeNodes.map((node, index) => {
                const id = String(node?.id || node?.node_id || node?.key || '')
                const title = String(node?.title || node?.label || node?.summary || node?.content_preview || '')
                return <div key={id || index}><code>{id || `#${index + 1}`}</code><span>{title || '\u672a\u547d\u540d\u8282\u70b9'}</span></div>
              })}
            </div>
          : <div className="oa-command-empty">{'\u6682\u65e0\u4e16\u754c\u7ebf\u8282\u70b9'}</div>
      )}
      {services.length > 0 && <div className="oa-command-services">
        {services.map((service, index) => <div key={service?.name || index}>
          <i className={`oa-command-dot ${service?.running ? 'is-running' : ''}`}/>
          <b>{service?.name || `service-${index + 1}`}</b>
          <span>{service?.running ? '\u8fd0\u884c\u4e2d' : '\u672a\u8fd0\u884c'}</span>
          <em>{service?.status || service?.message || ''}</em>
        </div>)}
      </div>}
      {commands.length > 0 && <div className="oa-command-list">
        {commands.map((item, index) => {
          const name = typeof item === 'string' ? item : (item?.command || item?.name || '')
          const description = typeof item === 'string' ? '' : (item?.description || item?.usage || '')
          return <div key={name || index}><code>{name || `#${index + 1}`}</code><span>{description}</span></div>
        })}
      </div>}
      {status && command === '/status' && <dl className="oa-command-kv">
        <div><dt>Session</dt><dd>{status.id || '-'}</dd></div>
        <div><dt>Messages</dt><dd>{Number(status.message_count || 0)}</dd></div>
      </dl>}
      {records.length > 0 && <details className="oa-command-records"><summary>{records.length} \u6761\u5de5\u5177\u5ba1\u8ba1\u8bb0\u5f55</summary><pre>{JSON.stringify(records, null, 2)}</pre></details>}
      {command === '/export' && result.filename && <div className="oa-command-download"><FileOutput size={15}/><span>{result.filename}</span><b>{'\u5df2\u4e0b\u8f7d'}</b></div>}
    </section>
  )
})

export const worldlineRestoreCommand = (nodeID, mode = 'both', target = 'at') => {
  const id = String(nodeID || '').trim()
  const restoreMode = ['both', 'conversation', 'code'].includes(mode) ? mode : 'both'
  const restoreTarget = ['at', 'before'].includes(target) ? target : 'at'
  return id ? `/worldline restore ${id} ${restoreMode} ${restoreTarget}` : ''
}

export const isWorldlinePickerResult = (result) => {
  const commandName = String(result?.command || '').replace(/^\//, '').toLowerCase()
  const nodes = result?.tree?.nodes
  return commandName === 'worldline' && result?.action !== 'restore' && Array.isArray(nodes) && nodes.length > 0
}

export const WorldlineRestoreDialog = memo(function WorldlineRestoreDialog({ nodes = [], onClose, onSelect }) {
  const [selectedNodeID, setSelectedNodeID] = useState('')
  const [restoreMode, setRestoreMode] = useState('both')
  const [restoreTarget, setRestoreTarget] = useState('at')

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="oa-worldline-backdrop" onMouseDown={(event)=>{ if (event.target === event.currentTarget) onClose?.() }}>
      <section className="oa-worldline-dialog" role="dialog" aria-modal="true" aria-labelledby="oa-worldline-title">
        <header className="oa-worldline-dialog-head">
          <div>
            <small>WORLDLINE</small>
            <h2 id="oa-worldline-title">{ct('选择回退点', 'Choose a rollback point')}</h2>
            <p>{ct('配置恢复范围与位置后填入命令，由你确认后发送。', 'Choose the restore scope and position, then insert the command for review before sending.')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={ct('关闭回退点选择', 'Close rollback-point picker')}><X size={17}/></button>
        </header>
        <div className="oa-worldline-node-list">
          {nodes.map((node, index) => {
            const nodeID = String(node?.id || '').trim()
            const ordinal = node?.ordinal ?? index + 1
            const title = node?.title || node?.summary || node?.name || `${ct('回退点', 'Rollback point')} ${ordinal}`
            const selected = !!nodeID && nodeID === selectedNodeID
            return <button key={nodeID || index} className={`oa-worldline-node${selected ? ' is-selected' : ''}`} type="button" disabled={!nodeID} aria-pressed={selected} onClick={()=>setSelectedNodeID(nodeID)}>
              <span className="oa-worldline-node-no">{ordinal}</span>
              <span className="oa-worldline-node-copy"><b>{title}</b><code>{nodeID || ct('缺少节点 ID', 'Missing node ID')}</code></span>
              <span className="oa-worldline-node-action">{selected ? ct('已选择', 'Selected') : ct('选择', 'Select')}</span>
            </button>
          })}
        </div>
        <div className="oa-worldline-options">
          <fieldset>
            <legend>{ct('恢复范围', 'Restore scope')}</legend>
            <div>
              {[['both', ct('对话与代码', 'Conversation and code')], ['conversation', ct('仅对话', 'Conversation only')], ['code', ct('仅代码', 'Code only')]].map(([value, label]) =>
                <button key={value} type="button" className={restoreMode === value ? 'is-selected' : ''} aria-pressed={restoreMode === value} onClick={()=>setRestoreMode(value)}>{label}</button>)}
            </div>
          </fieldset>
          <fieldset>
            <legend>{ct('恢复位置', 'Restore position')}</legend>
            <div>
              {[['at', ct('定位到节点', 'At the node')], ['before', ct('节点之前', 'Before the node')]].map(([value, label]) =>
                <button key={value} type="button" className={restoreTarget === value ? 'is-selected' : ''} aria-pressed={restoreTarget === value} onClick={()=>setRestoreTarget(value)}>{label}</button>)}
            </div>
          </fieldset>
        </div>
        <footer>
          <span>{ct(`${nodes.length} 个可用回退点`, `${nodes.length} rollback points available`)}</span><kbd>Esc</kbd><span>{ct('关闭', 'Close')}</span>
          <button className="oa-worldline-confirm" type="button" disabled={!selectedNodeID} onClick={()=>onSelect?.(selectedNodeID, restoreMode, restoreTarget)}>{ct('确认并填入命令', 'Confirm and insert command')}</button>
        </footer>
      </section>
    </div>
  )
})

export const ChatMessage = memo(function ChatMessage({
  message: m, pending, onAskReply, onEditResend, onRetryBTW,
  editDisabled = false, clockNow = 0,
}) {
  const userText = m.role === 'user' ? stripUserAttachmentBlock(m.content) : m.content
  const messageFiles = Array.isArray(m.files) ? m.files : []
  const imageFiles   = messageFiles.filter(isImageFile)
  const savedFilePaths = m.role === 'user' ? extractSavedFilePaths(m.content) : []
  const pendingFiles   = savedFilePaths.length > 0 ? [] : messageFiles.filter(f => !isImageFile(f))
  const [copied,  setCopied]  = useState(false)
  const [copyErr, setCopyErr] = useState('')
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState(userText || '')
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState('')
  const editRef = useRef(null)
  const ageText = m.role === 'user' ? formatAge(m.created_at) : ''
  const assistantModelId = m.role === 'assistant' ? String(m.model_id || '').trim() : ''
  const assistantCreatedAt = m.role === 'assistant' ? dateFromTimestamp(m.created_at) : null
  const assistantTime = assistantCreatedAt?.toLocaleString() || ''
  const turnUsages = Array.isArray(m.usages) && m.usages.length ? m.usages : (m.usage ? [m.usage] : [])
  const hasUsage = turnUsages.some(u => u && (u.input_tokens > 0 || u.cached_tokens > 0 || u.output_tokens > 0))
  const usageTotal = hasUsage ? sumUsages(turnUsages) : null
  const elapsedMs = getElapsedMs(m, clockNow)
  const showUsageRow = m.role === 'assistant' && (hasUsage || elapsedMs > 0)
  const isBTW = m.kind === 'btw'
  const btwDisplay = m.role === 'user' ? parseBTWDisplay(userText) : null

  const copyContent = () => {
    const txt = m.role === 'user' ? userText : (m.content || '')
    navigator.clipboard.writeText(txt)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      .catch(e => setCopyErr(String(e)))
  }
  const startMessageEdit = () => {
    setEditDraft(userText || '')
    setEditError('')
    setEditing(true)
    requestAnimationFrame(() => editRef.current?.focus())
  }
  const cancelMessageEdit = () => {
    if (editSubmitting) return
    setEditing(false)
    setEditError('')
    setEditDraft(userText || '')
  }
  const submitMessageEdit = async () => {
    const nextText = editDraft.trim()
    if (!nextText || editSubmitting || !onEditResend) return
    setEditSubmitting(true)
    setEditError('')
    try {
      await onEditResend(m.id, nextText)
      setEditing(false)
    } catch (e) {
      setEditError(e?.message || String(e))
    } finally {
      setEditSubmitting(false)
    }
  }

  return (
    <article className={`oa-message ${m.role} ${pending ? 'pending' : ''} ${editing ? 'oa-message-editing' : ''} ${isBTW ? 'oa-message-btw' : ''}`} data-id={m.id}>
      <div className="oa-msg-body">
        {m.role === 'assistant'
          ? (<>
              {(assistantModelId || assistantTime) && (
                <div className="oa-meta" aria-label={ct('回复信息', 'Response information')}>
                  {assistantModelId && (
                    <span className="oa-model-id" title={`Model ID: ${assistantModelId}`}>{assistantModelId}</span>
                  )}
                  {assistantModelId && assistantTime && <span className="oa-meta-separator" aria-hidden="true">{'·'}</span>}
                  {assistantTime && (
                    <time className="oa-message-time" dateTime={assistantCreatedAt.toISOString()} title={assistantTime}>{assistantTime}</time>
                  )}
                </div>
              )}
              {isBTW && <div className="oa-btw-head">
                <span className="oa-btw-mark" aria-hidden="true" />
                <div><span>侧问</span><strong>{m.side_question || '未记录问题'}</strong></div>
                {m.btw_status !== 'done' && <em>{m.btw_status === 'pending' ? '思考中…' : '未完成'}</em>}
              </div>}
              {m.commandResult
                ? <CommandResultCard result={m.commandResult} />
                : m.btw_status === 'error'
                  ? <div className="oa-btw-error" role="alert"><span>{m.content || '侧问失败，请重试'}</span><button type="button" onClick={() => onRetryBTW?.(m)}>重试</button></div>
                  : <AssistantContent content={isBTW ? stripBTWEcho(m.content) : m.content} pending={m.btw_status === 'pending' || pending} onAskReply={onAskReply} turnUsages={turnUsages} ultraplan_state={m.ultraplan_state} />}
            </>)
          : (<>
              {imageFiles.length > 0 && (
                <div className="oa-msg-images">
                  {imageFiles.map((f, i) => {
                    const src = f.url || f.data_url
                    return (
                      <a key={i} className="oa-msg-image-link" href={src} target="_blank" rel="noreferrer" title={ct('打开原图', 'Open original image')}>
                        <img src={src} alt={f.name || ct('图片', 'Image')} className="oa-msg-image" />
                      </a>
                    )
                  })}
                </div>
              )}
              {editing
                ? (<div className="oa-message-editor">
                    <textarea ref={editRef} value={editDraft}
                      onChange={e => setEditDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Escape') cancelMessageEdit()
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitMessageEdit() }
                      }}
                      disabled={editSubmitting} aria-label={ct('编辑已发送消息', 'Edit sent message')} />
                    {editError && <div className="oa-message-editor-error" role="alert">{editError}</div>}
                    <div className="oa-message-editor-actions">
                      <span className="oa-message-editor-hint">{ct('重发会从此消息继续，且不携带原附件', 'Resending continues from this message without its original attachments')}</span>
                      <button type="button" className="oa-message-editor-cancel" onClick={cancelMessageEdit} disabled={editSubmitting}>{ct('取消', 'Cancel')}</button>
                      <button type="button" className="oa-message-editor-submit" onClick={submitMessageEdit}
                        disabled={editSubmitting || !editDraft.trim()}>{editSubmitting ? ct('发送中…', 'Sending…') : ct('发送', 'Send')}</button>
                    </div>
                  </div>)
                : (<div className={`oa-msg-text${btwDisplay ? ' oa-user-btw' : ''}`}>
                    {btwDisplay
                      ? <><span className="oa-user-btw-command"><i aria-hidden="true"/>/btw</span><span className="oa-user-btw-prompt">{btwDisplay.prompt || '侧问'}</span></>
                      : userText}
                    {savedFilePaths.length > 0 && (
                      <div className="oa-msg-saved-paths">
                        {savedFilePaths.map((p, i) => (
                          <span key={i} className="oa-msg-saved-path" title={p}>{p.split(/[/\\]/).pop()}</span>
                        ))}
                      </div>
                    )}
                    {pendingFiles.length > 0 && (
                      <div className="oa-msg-files">
                        {pendingFiles.map((f, i) => <span key={i} className="oa-msg-file">{f.name}</span>)}
                      </div>
                    )}
                  </div>)}
            </>)
        }
        {showUsageRow && <UsageRow u={usageTotal} elapsedMs={elapsedMs} live={pending} label={ct('总计', 'Total')} className="oa-usage-total" />}
      </div>

      {m.role === 'assistant' && (
        <UltraPlanMessageDrawer content={m.content || ''} state={m.ultraplan_state} pending={pending} onAskReply={onAskReply} />
      )}

      <div className="oa-msg-meta">
        {ageText && <span className="oa-msg-age" title={ageText}><Clock3 size={11}/>{ageText}</span>}
        {copyErr  && <span className="oa-copy-err">{copyErr}</span>}
        <button type="button" className="oa-icon-btn oa-copy-btn"
          onClick={copyContent} title={ct('复制', 'Copy')} aria-label={ct('复制消息', 'Copy message')}>
          {copied ? <Check size={13}/> : <Copy size={13}/>}
        </button>
        {m.role === 'user' && !pending && onEditResend && (
          <button type="button" className="oa-icon-btn oa-message-edit-trigger"
            onClick={startMessageEdit} disabled={editDisabled}
            title={editDisabled ? ct('对话运行中，请等待完成后再编辑', 'Wait for the running conversation to finish before editing') : ct('编辑并重新发送', 'Edit and resend')} aria-label={ct('编辑并重新发送', 'Edit and resend')}>
            <Edit3 size={13}/>
          </button>
        )}
        {m.role === 'user' && !pending && onAskReply && (
          <button type="button" className="oa-icon-btn oa-ask-reply-btn"
            onClick={() => onAskReply(m.content)}
            title={ct('以此为上下文继续提问', 'Continue from this context')} aria-label={ct('以此继续', 'Continue from here')}>
            <MessageSquarePlus size={13}/>
          </button>
        )}
      </div>
    </article>
  )
})

const MessageList = memo(function MessageList({
  messages, isCurrentRunning, onAskReply, onEditResend, onRetryBTW, clockNow,
}) {
  const threadMessages = messages.filter(message => message.kind !== 'btw')
  const lastMessageId = threadMessages.at(-1)?.id
  return (
    <>
      {threadMessages.flatMap((m, i) => {
        const dateKey  = fmtDate(m.created_at)
        const prevDate = i > 0 ? fmtDate(threadMessages[i - 1]?.created_at) : ''
        const nodes = []
        if (i === 0 || dateKey !== prevDate) {
          nodes.push(
            <div key={`tl-${dateKey}-${i}`} className="oa-timeline">
              <span>{fmtDate(m.created_at)}</span>
            </div>
          )
        }
        nodes.push(
          <ChatMessage
            key={m.id}
            message={m}
            pending={!m.kind && isCurrentRunning && m.id === lastMessageId}
            onAskReply={onAskReply}
            onEditResend={onEditResend}
            onRetryBTW={onRetryBTW}
            editDisabled={isCurrentRunning}
            clockNow={clockNow}
          />
        )
        return nodes
      })}
    </>
  )
})


export function ProviderModelCascade({ groups, selectedProvider, value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const [previewProvider, setPreviewProvider] = useState(selectedProvider || groups[0]?.value || '')
  const ref = useRef()
  const triggerRef = useRef(null)
  const modelListRef = useRef(null)
  const menuId = React.useId()
  const resetPreview = () => {
    if (selectedProvider && groups.some(group => group.value === selectedProvider)) setPreviewProvider(selectedProvider)
    else setPreviewProvider(groups[0]?.value || '')
  }
  const toggleMenu = () => {
    if (!open) resetPreview()
    setOpen(value => !value)
  }
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const h = e => { if (!ref.current?.contains(e.target)) close() }
    const onScroll = e => { if (!ref.current?.contains(e.target)) close() }
    const onKeyDown = e => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close()
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])
  useEffect(() => {
    if (selectedProvider && groups.some(group => group.value === selectedProvider)) setPreviewProvider(selectedProvider)
    else if (groups[0]) setPreviewProvider(groups[0].value)
    else setPreviewProvider('')
  }, [selectedProvider, groups])

  const activeGroup = groups.find(group => group.value === selectedProvider)
  const previewGroup = groups.find(group => group.value === previewProvider) || activeGroup || groups[0]
  const activeModel = activeGroup?.models.find(model => String(model.value) === String(value))
  const displayModel = activeModel?.label || ct('未发现模型', 'No models found')
  useLayoutEffect(() => {
    if (!open || previewGroup?.value !== selectedProvider) return
    const list = modelListRef.current
    const current = list?.querySelector('[aria-current="true"]')
    if (!list || !current) return
    const listRect = list.getBoundingClientRect()
    const currentRect = current.getBoundingClientRect()
    if (currentRect.top < listRect.top) list.scrollTop -= listRect.top - currentRect.top + 2
    else if (currentRect.bottom > listRect.bottom) list.scrollTop += currentRect.bottom - listRect.bottom + 2
  }, [open, previewGroup?.value, selectedProvider, value])

  return (
    <div className="oa-model-select oa-composer-cascade" ref={ref}>
      <span>{ct('模型', 'Model')}</span>
      <button ref={triggerRef} type="button" disabled={disabled} title={displayModel}
        aria-label={ct(`模型：${displayModel}`, `Model: ${displayModel}`)} aria-haspopup="dialog" aria-expanded={open} aria-controls={menuId}
        onClick={toggleMenu}>
        <span className="oa-cascade-current-model">{displayModel}</span>
        <ChevronDown size={13} />
      </button>
      {open && <div className="oa-cascade-menu" role="dialog" aria-label={ct('服务商和模型', 'Providers and models')}>
        <div className="oa-cascade-providers" aria-label={ct('服务商', 'Providers')}>
          {groups.map(group => (
            <button key={group.value} type="button"
              className={group.value === previewGroup?.value ? 'active' : ''}
              aria-pressed={group.value === previewGroup?.value}
              aria-current={group.value === selectedProvider ? 'true' : undefined}
              onMouseEnter={() => setPreviewProvider(group.value)}
              onFocus={() => setPreviewProvider(group.value)}
              onClick={() => setPreviewProvider(group.value)}>
              <span>{group.label}</span><ChevronRight size={13} />
            </button>
          ))}
        </div>
        <div className="oa-cascade-models" ref={modelListRef} aria-label={previewGroup ? ct(`${previewGroup.label} 模型`, `${previewGroup.label} models`) : ct('模型', 'Models')}>
          <div className="oa-cascade-heading">{previewGroup?.label || ct('模型', 'Model')}</div>
          {previewGroup?.models.length ? previewGroup.models.map(model => {
            const isCurrent = previewGroup.value === selectedProvider && String(model.value) === String(value)
            return <button key={model.value} type="button"
              className={isCurrent ? 'active' : ''}
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => { onChange(model.value); setOpen(false) }}>
              {isCurrent && <Check size={12} />}
              <span>{model.label}</span>
            </button>
          }) : <div className="oa-cascade-empty">{ct('未发现模型', 'No models found')}</div>}
        </div>
      </div>}
    </div>
  )
}

export function PlanTodoCard({ plan }) {
  const listRef = useRef(null)
  const [expanded, setExpanded] = useState(true)
  const panelId = React.useId()
  const active = Boolean(plan?.active)
  const items = Array.isArray(plan?.items) ? plan.items : []
  const done = Number.isFinite(Number(plan?.done)) ? Number(plan.done) : items.filter(item => item?.status === 'done').length
  const total = Number.isFinite(Number(plan?.total)) ? Number(plan.total) : items.length
  const currentIndex = items.findIndex(item => item?.status !== 'done')
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0
  const complete = Boolean(plan?.complete)
  const placeholder = Boolean(plan?.placeholder)
  useLayoutEffect(() => {
    if (!active || !expanded || placeholder || currentIndex < 0) return
    const list = listRef.current
    const current = list?.querySelector('[aria-current="step"]')
    if (!list || !current) return
    const revealCurrent = () => {
      const listRect = list.getBoundingClientRect()
      const currentRect = current.getBoundingClientRect()
      if (currentRect.top < listRect.top) list.scrollTop -= listRect.top - currentRect.top + 6
      else if (currentRect.bottom > listRect.bottom) list.scrollTop += currentRect.bottom - listRect.bottom + 6
    }
    revealCurrent()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(revealCurrent)
    resizeObserver?.observe(list)
    resizeObserver?.observe(current)
    window.addEventListener('resize', revealCurrent)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', revealCurrent)
    }
  }, [active, currentIndex, expanded, placeholder, total])
  if (!active) return null
  const stateLabel = complete ? ct('已完成', 'Completed') : placeholder ? ct('规划中', 'Planning') : total > 0 ? ct('执行中', 'Running') : ct('准备中', 'Preparing')
  const detailLabel = complete
    ? ct('所有步骤均已完成', 'All steps completed')
    : placeholder
      ? ct('正在生成可执行步骤', 'Generating executable steps')
      : currentIndex >= 0 && total > 0
        ? ct(`正在处理第 ${currentIndex + 1} 步`, `Processing step ${currentIndex + 1}`)
        : ct('等待任务步骤', 'Waiting for task steps')
  return (
    <section className={`oa-plan-card${complete ? ' is-complete' : ''}`} aria-label={ct('任务执行计划', 'Task execution plan')}>
      <button type="button" className="oa-plan-head" onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded} aria-controls={panelId}
        aria-label={expanded ? '\u6536\u8d77\u6267\u884c\u8ba1\u5212' : '\u5c55\u5f00\u6267\u884c\u8ba1\u5212'}>
        <span className="oa-plan-identity">
          <span className="oa-plan-mark" aria-hidden="true">{complete ? <Check size={15}/> : <Clock3 size={14}/>}</span>
          <span className="oa-plan-heading">
            <span className="oa-plan-title">{ct('执行计划', 'Execution plan')}</span>
            <span className="oa-plan-detail">{detailLabel}</span>
          </span>
        </span>
        <span className="oa-plan-summary">
          <span className="oa-plan-state"><i aria-hidden="true"/>{stateLabel}</span>
          <span className="oa-plan-count" aria-label={ct(`已完成 ${done} 项，共 ${total} 项`, `${done} of ${total} complete`)}><strong>{done}</strong><span>/ {total}</span></span>
          <span className="oa-plan-chevron" aria-hidden="true">{expanded ? <ChevronDown size={15}/> : <ChevronLeft size={15}/>}</span>
        </span>
      </button>
      <div id={panelId} className="oa-plan-body" hidden={!expanded}>
        <div className="oa-plan-progress" role="progressbar" aria-label={ct('任务完成进度', 'Task completion progress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }}/>
        </div>
        {placeholder ? <div className="oa-plan-placeholder"><span aria-hidden="true"/><span>{ct('正在整理步骤', 'Organizing steps')}</span><code title={plan.pathHint || 'plan.md'}>{plan.pathHint || 'plan.md'}</code></div> : (
          <ol ref={listRef} className="oa-plan-list">
            {items.map((item, index) => {
              const itemComplete = item?.status === 'done'
              const current = !itemComplete && index === currentIndex
              return <li key={`${index}-${item?.content || ''}`} className={`${itemComplete ? 'is-done' : 'is-open'}${current ? ' is-current' : ''}`} aria-current={current ? 'step' : undefined}>
                <span className="oa-plan-status" aria-hidden="true">{itemComplete ? <Check size={11}/> : current ? <Clock3 size={10}/> : <span>{index + 1}</span>}</span>
                <span className="oa-plan-copy">{item?.content || `${ct('步骤', 'Step')} ${index + 1}`}</span>
                {current && <span className="oa-plan-now">{ct('当前', 'Current')}</span>}
              </li>
            })}
          </ol>
        )}
        {plan.step && <div className="oa-plan-step"><span>{ct('当前动作', 'Current action')}</span><p>{plan.step}</p></div>}
      </div>
    </section>
  )
}

function CustomSelect({ value, onChange, options, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const h = e => { if (!ref.current?.contains(e.target)) close() }
    const onScroll = e => { if (!ref.current?.contains(e.target)) close() }
    document.addEventListener('mousedown', h)
    window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('scroll', onScroll, true) }
  }, [open])
  const label = options.find(o => String(o.value) === String(value))?.label ?? String(value)
  const displayLabel = label.includes('/') ? label.split('/').pop() : label
  return (
    <div className="oa-cselect" ref={ref}>
      <button type="button" disabled={disabled} title={label} onClick={() => setOpen(o => !o)}>
        <span>{displayLabel}</span><ChevronDown size={13}/>
      </button>
      {open && <ul role="listbox">
        {options.map(o => (
          <li key={o.value} role="option" aria-selected={String(o.value)===String(value)}
            className={String(o.value)===String(value)?'active':''}
            onMouseDown={() => { onChange(o.value); setOpen(false) }}>
            {String(o.value)===String(value) && <Check size={11}/>}{o.label}
          </li>
        ))}
      </ul>}
    </div>
  )
}

export default function ChatApp() {
  // Theme state: sync with localStorage and system preference
  const [theme, setTheme] = useState(() => localStorage.getItem('ga-admin-theme') || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('ga-admin-theme', theme) }, [theme])

  useEffect(() => {
    document.documentElement.lang = chatLanguage() === 'en' ? 'en' : 'zh-CN'
    api('/api/config').then(cfg => {
      setCfg(cfg)
    }).catch(() => {})
    api('/api/slash-commands').then(res => {
      const items = Array.isArray(res?.commands) ? res.commands : []
      const normalized = items
        .filter(c => c && typeof c.cmd === 'string' && c.cmd.trim().startsWith('/'))
        .map(c => ({
          ...c,
          cmd: c.cmd.trim(),
          key: c.key || c.cmd.trim(),
          insert: c.insert || c.cmd.trim(),
          builtIn: c.builtIn !== false,
        }))
      if (normalized.length) {
        const serverKeys = new Set(normalized.map(c => builtinSlashKey(c.cmd)))
        const missing = BUILTIN_SLASH_COMMANDS.filter(c => !serverKeys.has(builtinSlashKey(c.cmd)))
        setSlashCommands(missing.length ? [...normalized, ...missing] : normalized)
      }
    }).catch(() => {})
  }, [])
  const [sessions, setSessions] = useState([])
  const [sid, setSid] = useState('')
  const [messages, setMessages] = useState([])
  const [rawHistory, setRawHistory] = useState([])
  const [historyInfo, setHistoryInfo] = useState([])
  const [workingState, setWorkingState] = useState(null)
  const [planState, setPlanState] = useState(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [btwRailOpen, setBtwRailOpen] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [streamingSid, setStreamingSid] = useState('')
  const [err, setErr] = useState('')
  const [collapsed, setCollapsed] = useState(() => isNarrowChatViewport())
  const [notice, setNotice] = useState('')
  const [llms, setLlms] = useState([])
  const [llmNo, setLlmNo] = useState(0)
  const [reasoningEffort, setReasoningEffort] = useState('off')
  const [extraSysPrompts, setExtraSysPrompts] = useState([])
  const [extraSysPromptPresetID, setExtraSysPromptPresetID] = useState('')
  const [promptPresets, setPromptPresets] = useState([])
  const [extraPromptOpen, setExtraPromptOpen] = useState(false)
  const [extraPromptSelection, setExtraPromptSelection] = useState('')
  const [extraPromptTargetSid, setExtraPromptTargetSid] = useState('')
  const [promptPresetManagerOpen, setPromptPresetManagerOpen] = useState(false)
  const [extraPromptDraft, setExtraPromptDraft] = useState([])
  const [extraPromptSaving, setExtraPromptSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState('')
  const [menuPos, setMenuPos] = useState(null)
  const [editing, setEditing] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [sessionManagerOpen, setSessionManagerOpen] = useState(false)
  const [selectedSessionIds, setSelectedSessionIds] = useState([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [queuedMessages, setQueuedMessages] = useState([])
  const [queueEditingId, setQueueEditingId] = useState('')
  const [queueDraft, setQueueDraft] = useState('')
  const [guidingQueueId, setGuidingQueueId] = useState('')
  const [dragging, setDragging] = useState(false)
  const [autoFollow, setAutoFollow] = useState(true)
  const [showFollow, setShowFollow] = useState(false)
  const [cmdDrawer, setCmdDrawer] = useState({ open: false, filter: '', selectedIdx: 0 })
  const [cmdManagerOpen, setCmdManagerOpen] = useState(false)
  const [worldlineRestorePicker, setWorldlineRestorePicker] = useState(null)
  const [slashCommands, setSlashCommands] = useState(BUILTIN_SLASH_COMMANDS)
  const [cfg, setCfg] = useState(null)
  const [cmdEditIdx, setCmdEditIdx] = useState(-1)
  const [cmdEditCmd, setCmdEditCmd] = useState('')
  const [cmdEditDesc, setCmdEditDesc] = useState('')
  const [cmdEditContent, setCmdEditContent] = useState('')
  const [isMobile, setIsMobile] = useState(() => isMobileViewport())
  const [streamClock, setStreamClock] = useState(() => Date.now())
  const threadRef = useRef(null)
  const endRef = useRef(null)
  const fileRef = useRef(null)
  const promptRef = useRef(null)
  const cmdDrawerRef = useRef(null)
  const selectedCmdRef = useRef(null)
  const streamAbortRef = useRef(null)
  const runSeqRef = useRef(0)
  const activeRunRef = useRef(false)
  const guidingQueueRef = useRef('')
  const openSeqRef = useRef(0)
  const activeSidRef = useRef('')
  const extraPromptSelectionSeqRef = useRef(0)
  const messagesRef = useRef([])
  const scrollModeRef = useRef('auto')
  const queuedRef = useRef([])
  const chatScope = useRef(null)
  // Auto-grow composer textarea to fit content (clamped), reset to single row when cleared.
  const COMPOSER_MAX_H = 160

  useEffect(() => {
    if (!busy && !streamingSid) return undefined
    const tick = () => setStreamClock(Date.now())
    tick()
    const timer = window.setInterval(tick, 500)
    return () => window.clearInterval(timer)
  }, [busy, streamingSid])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(max-width: 900px)')
    const syncCollapsed = () => setCollapsed(mq.matches)
    syncCollapsed()
    mq.addEventListener?.('change', syncCollapsed)
    mq.addListener?.(syncCollapsed)
    return () => {
      mq.removeEventListener?.('change', syncCollapsed)
      mq.removeListener?.(syncCollapsed)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(max-width: 560px)')
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener?.('change', sync)
    mq.addListener?.(sync)
    return () => {
      mq.removeEventListener?.('change', sync)
      mq.removeListener?.(sync)
    }
  }, [])

  useLayoutEffect(() => {
    const el = promptRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, COMPOSER_MAX_H)
    el.style.height = next + 'px'
    el.style.overflowY = el.scrollHeight > COMPOSER_MAX_H ? 'auto' : 'hidden'
  }, [prompt])
  const current = useMemo(() => sessions.find(s => s.id === sid), [sessions, sid])
  const isUltraPlanPrompt = /^\s*\/ultraplan(?:\s|$)/.test(prompt)
  const effectiveSlashCommands = slashCommands.length ? slashCommands : BUILTIN_SLASH_COMMANDS
  const officialSlashKeys = useMemo(() => new Set(effectiveSlashCommands.map(c => builtinSlashCommandKey(c))), [effectiveSlashCommands])
  const isProtectedSlashCommand = useCallback((cmd = '') => officialSlashKeys.has(builtinSlashKey(cmd)), [officialSlashKeys])
  const allSlashCommands = useMemo(() => {
    const custom = (cfg?.slash_commands || []).filter(c => !officialSlashKeys.has(builtinSlashKey(c.cmd)))
    return [...effectiveSlashCommands, ...custom]
  }, [cfg?.slash_commands, effectiveSlashCommands, officialSlashKeys])
  const filteredCmds = useMemo(() => {
    if (!cmdDrawer.open) return []
    const rawFilter = String(cmdDrawer.filter || '').trimStart()
    const slashFilter = rawFilter.startsWith('/') ? rawFilter : `/${rawFilter}`
    const childAllowed = (base) => {
      const childRoot = `${base} `
      if (slashFilter === childRoot) return true
      if (!slashFilter.startsWith(childRoot)) return false
      const rest = slashFilter.slice(childRoot.length).trimStart()
      return rest.length > 0 && 'help'.startsWith(rest)
    }
    const inProjectScope = slashFilter === '/project' || slashFilter.startsWith('/project ')
    const inContinueScope = slashFilter === '/continue' || slashFilter.startsWith('/continue ')
    const inReviewScope = slashFilter === '/review' || slashFilter.startsWith('/review ')
    const inImproveScope = slashFilter === '/improve' || slashFilter.startsWith('/improve ')
    const inUltraPlanScope = slashFilter === '/ultraplan' || slashFilter.startsWith('/ultraplan ')
    const isReviewNaturalLanguage = /^\/review\s+\S/.test(slashFilter) && !childAllowed('/review')
    const isContinueNumber = /^\/continue\s+\d+$/.test(slashFilter)
    const isUltraPlanObjective = /^\/ultraplan\s+\S/.test(slashFilter)
    const exactRootCandidates = slashFilter.includes(' ')
      ? []
      : allSlashCommands.filter(c => {
          const cmd = String(c.cmd || '')
          const root = cmd.split(/\s+/, 1)[0]
          return root === slashFilter
        })
    const exactRootPrimary = exactRootCandidates.find(c => String(c.cmd || '') === slashFilter) || exactRootCandidates[0]
    const argumentRoot = slashFilter.includes(' ') ? slashFilter.split(/\s+/, 1)[0] : ''
    const argumentRootCandidates = argumentRoot
      ? allSlashCommands.filter(c => String(c.cmd || '').split(/\s+/, 1)[0] === argumentRoot)
      : []
    const argumentFallback = argumentRootCandidates.find(c => /\s<[^>]+>$/.test(String(c.cmd || '')))
      || argumentRootCandidates.find(c => String(c.cmd || '') === argumentRoot)
      || argumentRootCandidates[0]
    return allSlashCommands.filter(c => {
      const cmd = String(c.cmd || '')
      if (exactRootPrimary) return c === exactRootPrimary
      if (argumentFallback && c === argumentFallback) return true
      if (cmd === '/review help') return childAllowed('/review') && fuzzyMatch(cmd, slashFilter)
      if (cmd === '/review <request>') {
        if (isReviewNaturalLanguage) return true
        if (slashFilter === '/review' || fuzzyMatch('/review', rawFilter) || fuzzyMatch('/review', slashFilter)) return true
        if (slashFilter.startsWith('/review ')) return false
      }
      if (cmd === '/continue <number>') {
        if (slashFilter === '/continue ') return true
        if (isContinueNumber) return true
        if (slashFilter.startsWith('/continue ')) return false
      }
      if (cmd === '/ultraplan <goal>') {
        if (slashFilter === '/ultraplan ') return true
        if (isUltraPlanObjective) return true
        if (slashFilter === '/ultraplan' || fuzzyMatch('/ultraplan', rawFilter) || fuzzyMatch('/ultraplan', slashFilter)) return true
        if (slashFilter.startsWith('/ultraplan ')) return false
      }
      if (cmd === '/project' && slashFilter.startsWith('/project ')) return true
      if (inProjectScope && !cmd.startsWith('/project')) return false
      if (inContinueScope && cmd !== '/continue <number>') return false
      if (inReviewScope && cmd !== '/review <request>') return false
      if (inImproveScope && cmd !== '/improve') return false
      if (inUltraPlanScope && cmd !== '/ultraplan <goal>') return false
      return fuzzyMatch(cmd, rawFilter) || fuzzyMatch(cmd, slashFilter) || fuzzyMatch(c.desc || '', rawFilter)
    })
  }, [cmdDrawer.open, cmdDrawer.filter, allSlashCommands])
  useLayoutEffect(() => {
    if (!cmdDrawer.open) return
    selectedCmdRef.current?.scrollIntoView({ block: 'nearest' })
  }, [cmdDrawer.open, cmdDrawer.selectedIdx, filteredCmds.length])
  useEffect(() => {
    if (cmdDrawer.open) setCmdEditIdx(-1)
  }, [cmdDrawer.open, cmdDrawer.filter])
  useEffect(() => {
    if (!cmdManagerOpen) setCmdEditIdx(-1)
  }, [cmdManagerOpen])
  const saveSlashCmds = async (newCmds) => {
    if (!confirmDanger('chat-slash-commands-save', ct('保存斜杠命令配置？会写入 GA Admin 配置文件。', 'Save slash-command configuration? This writes the GA Admin configuration file.'))) return
    try {
      const safeCmds = (newCmds || [])
        .filter(c => !isProtectedSlashCommand(c?.cmd))
        .map(c => ({ cmd: String(c?.cmd || '').trim(), desc: String(c?.desc || '').trim(), content: String(c?.content || c?.prompt || '').trim() }))
        .filter(c => c.cmd)
      const c = await api('/api/config', { method:'PUT', dangerous: true, body: JSON.stringify({...cfg, slash_commands: safeCmds}) })
      if (c?.slash_commands) { setCfg(c) }
      setCmdEditIdx(-1)
    } catch(e) { setNotice(ct('保存命令失败: ', 'Failed to save command: ') + e.message); setCmdEditIdx(-1) }
  }
  const startEdit = (idx, cmd, desc, content = '') => {
    if (idx < 0 && idx !== -2) return
    setCmdEditIdx(idx); setCmdEditCmd(cmd); setCmdEditDesc(desc); setCmdEditContent(content)
  }
  const saveEdit = () => {
    const normalized = cmdEditCmd.trim()
    if (!normalized) return
    if (isProtectedSlashCommand(normalized)) {
      setNotice(ct('这是 GA Admin 内置命令，不能覆盖或修改', 'This built-in GA Admin command cannot be overridden or edited'))
      setCmdEditIdx(-1)
      return
    }
    const cmds = cfg?.slash_commands || []
    const nextItem = { cmd: normalized, desc: cmdEditDesc.trim() || '', content: cmdEditContent.trim() || cmdEditDesc.trim() || '' }
    if (!nextItem.content) {
      setNotice(ct('请填写这个命令要展开成的指令内容', 'Enter the instruction content this command should expand into'))
      return
    }
    if (cmdEditIdx === -2) {
      saveSlashCmds([...cmds, nextItem])
    } else if (cmdEditIdx >= 0) {
      const newCmds = [...cmds]
      newCmds[cmdEditIdx] = nextItem
      saveSlashCmds(newCmds)
    }
  }
  const deleteCmd = (idx) => {
    if (idx < 0) { setNotice(ct('这是 GA Admin 内置命令，不能删除', 'This built-in GA Admin command cannot be deleted')); return }
    const cmds = cfg?.slash_commands || []; saveSlashCmds(cmds.filter((_, i) => i !== idx))
  }
  const moveUpCmd = (cmd) => {
    if (cmd?.builtIn) return
    const cmds = cfg?.slash_commands || []
    const idx = cmds.findIndex(c => c.cmd === cmd.cmd && c.desc === cmd.desc)
    if (idx <= 0) return
    const newCmds = [...cmds]
    ;[newCmds[idx-1], newCmds[idx]] = [newCmds[idx], newCmds[idx-1]]
    saveSlashCmds(newCmds)
  }
  useEffect(() => { activeSidRef.current = sid }, [sid])

  const isActiveSession = (sessionId) => !sessionId || activeSidRef.current === sessionId

  const applyStreamEvent = (ev, pendingId, clientUserID = '', sessionId = '') => {
    if (!isActiveSession(sessionId)) return
    if (Object.prototype.hasOwnProperty.call(ev, 'raw_history')) {
      setRawHistory(Array.isArray(ev.raw_history) ? ev.raw_history : [])
    }
    if (Object.prototype.hasOwnProperty.call(ev, 'history_info')) {
      setHistoryInfo(Array.isArray(ev.history_info) ? ev.history_info : [])
    }
    if (Object.prototype.hasOwnProperty.call(ev, 'working')) {
      setWorkingState(ev.working && typeof ev.working === 'object' ? ev.working : null)
    }
    if (Object.prototype.hasOwnProperty.call(ev, 'plan')) setPlanState(ev.plan || null)
    if (Object.prototype.hasOwnProperty.call(ev, 'workspace') || Object.prototype.hasOwnProperty.call(ev, 'project_mode')) {
      setSessions(xs => xs.map(x => x.id === sessionId ? {
        ...x,
        ...(Object.prototype.hasOwnProperty.call(ev, 'workspace') ? { workspace: ev.workspace || '' } : {}),
        ...(Object.prototype.hasOwnProperty.call(ev, 'project_mode') ? { project_mode: ev.project_mode || '' } : {}),
      } : x))
    }
    if (ev.type === 'user' && ev.message) {
      setMessages(xs => {
        if (!isActiveSession(sessionId)) return xs
        return clientUserID
          ? xs.map(m => m.id === clientUserID ? ev.message : m)
          : (xs.some(m => m.id === ev.message.id) ? xs : [...xs, ev.message])
      })
    }
    if (ev.type === 'start' && ev.run_started_at_ms > 0) {
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m =>
        m.id === pendingId ? { ...m, run_started_at_ms: ev.run_started_at_ms } : m
      ) : xs)
    }
    if (ev.type === 'model' && typeof ev.model_id === 'string' && ev.model_id.trim()) {
      const modelID = ev.model_id.trim()
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m =>
        m.id === pendingId ? { ...m, model_id: modelID } : m
      ) : xs)
    }
    if (ev.type === 'turn_usage' && ev.usage && typeof ev.index === 'number') {
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m => {
        if (m.id !== pendingId) return m
        const usages = Array.isArray(m.usages) ? m.usages.slice() : []
        usages[ev.index] = ev.usage
        return { ...m, usages }
      }) : xs)
    }
    if (ev.message && (ev.type === 'done' || ev.type === 'error')) {
      if (typeof ev.reasoning_effort === 'string') setReasoningEffort(normalizeReasoningEffort(ev.reasoning_effort))
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m => {
        if (m.id !== pendingId) return m
        const elapsedMs = getElapsedMs(m)
        const finalMsg = mergeFinalStreamMessage(m, ev.message)
        if (elapsedMs > 0 && !(finalMsg.elapsed_ms > 0)) finalMsg.elapsed_ms = elapsedMs
        finalMsg.ultraplan_state = mergeUltraPlanStates(m.ultraplan_state, finalMsg.ultraplan_state) || finalMsg.ultraplan_state || m.ultraplan_state
        return finalMsg
      }) : xs)
    }
    if (ev.type === 'ultraplan_event' && ev.state) {
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m => {
        if (m.id !== pendingId) return m
        const nextState = mergeUltraPlanStates(m.ultraplan_state, ev.state) || ev.state
        return { ...m, ultraplan_state: nextState }
      }) : xs)
    }
    if (ev.type === 'ultraplan_output' && ev.task_id && Array.isArray(ev.lines)) {
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m => {
        if (m.id !== pendingId) return m
        const prevState = m.ultraplan_state || {}
        const prevOutputs = prevState.taskOutputs || prevState.task_outputs || {}
        const prevLines = Array.isArray(prevOutputs[ev.task_id]) ? prevOutputs[ev.task_id] : []
        const taskOutputs = { ...prevOutputs, [ev.task_id]: [...prevLines, ...ev.lines] }
        const nextState = mergeUltraPlanStates(prevState, { taskOutputs, task_outputs: taskOutputs }) || { ...prevState, taskOutputs, task_outputs: taskOutputs }
        return { ...m, ultraplan_state: nextState }
      }) : xs)
    }
  }

  const createStreamBatcher = (pendingId, sessionId = '') => createStreamDeltaBatcher({
    onFlush: chunk => setMessages(xs => isActiveSession(sessionId) ? xs.map(m => (
      m.id === pendingId ? { ...m, content: (m.content || '') + chunk } : m
    )) : xs),
    schedule: callback => window.requestAnimationFrame ? window.requestAnimationFrame(callback) : window.setTimeout(callback, 16),
    cancel: handle => window.cancelAnimationFrame ? window.cancelAnimationFrame(handle) : window.clearTimeout(handle),
  })

  const readStream = async (res, pendingId, clientUserID = '', sessionId = '') => {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
    const batcher = createStreamBatcher(pendingId, sessionId)
    let commandPatch = null
    let eventCount = 0
    let terminal = false
    let terminalEvent = null
    const applyEvent = (ev) => {
      if (ev?.type === 'command_result') commandPatch = reduceCommandResult(ev)
      applyStreamEvent(ev, pendingId, clientUserID, sessionId)
    }
    const consumeEvent = (ev) => {
      if (ev.type === 'delta' && typeof ev.delta === 'string') {
        batcher.push(ev.delta)
      } else if (ev.type === 'done' || ev.type === 'error') {
        terminal = true
        terminalEvent = ev
      } else {
        applyEvent(ev)
      }
      eventCount += 1
    }
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream:true })
        const lines = buf.split('\n'); buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          if (!isActiveSession(sessionId)) return { commandPatch, eventCount, terminal }
          consumeEvent(JSON.parse(line))
        }
      }
      buf += dec.decode()
      if (buf.trim() && isActiveSession(sessionId)) consumeEvent(JSON.parse(buf))
      await batcher.drain()
      if (terminalEvent && isActiveSession(sessionId)) applyEvent(terminalEvent)
    } catch (error) {
      batcher.flushNow()
      error.chatStreamOutcome = { commandPatch, eventCount, terminal }
      throw error
    }
    return { commandPatch, eventCount, terminal }
  }

  const waitForStreamRetry = (signal, delay = 250) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('aborted'); err.name = 'AbortError'; reject(err); return
    }
    const done = () => { signal?.removeEventListener('abort', aborted); resolve() }
    const aborted = () => {
      clearTimeout(timer)
      const err = new Error('aborted'); err.name = 'AbortError'; reject(err)
    }
    const timer = setTimeout(done, delay)
    signal?.addEventListener('abort', aborted, { once:true })
  })

  const followChatStream = async (initialRes, pendingId, clientUserID, sessionId, signal) => {
    let res = initialRes
    let cursor = 0
    let replay = false
    let commandPatch = null
    while (isActiveSession(sessionId)) {
      let completed = false
      let eventCount = 0
      try {
        const outcome = await readStream(res, pendingId, clientUserID, sessionId)
        eventCount = outcome.eventCount
        cursor += eventCount
        if (outcome.commandPatch) commandPatch = outcome.commandPatch
        completed = true
        if (outcome.terminal) return commandPatch
      } catch (e) {
        const partial = e?.chatStreamOutcome
        if (partial) {
          eventCount = partial.eventCount
          cursor += eventCount
          if (partial.commandPatch) commandPatch = partial.commandPatch
          if (partial.terminal) return commandPatch
        }
        if (e?.name === 'AbortError' || signal?.aborted) throw e
      }
      if (!isActiveSession(sessionId)) return commandPatch

      let state = null
      while (!state && isActiveSession(sessionId)) {
        try {
          state = await api(`/api/chat/state/${sessionId}`, { signal })
        } catch (e) {
          if (e?.name === 'AbortError' || signal?.aborted) throw e
          await waitForStreamRetry(signal)
        }
      }
      if (!state || !isActiveSession(sessionId)) return commandPatch
      if (shouldFinishStreamFollow({ running:state.running, replay, completed, eventCount })) return commandPatch
      if (state.running) await waitForStreamRetry(signal, 120)

      while (isActiveSession(sessionId)) {
        try {
          res = await fetch(`/api/chat/stream/${sessionId}?from=${cursor}`, { signal })
          if (res.status === 204) return commandPatch
          if (!res.ok) throw new Error(await res.text())
          replay = true
          break
        } catch (e) {
          if (e?.name === 'AbortError' || signal?.aborted) throw e
          await waitForStreamRetry(signal)
        }
      }
    }
    return commandPatch
  }

  const cancelRun = async (id = sid) => {
    if (!id) return
    try {
      streamAbortRef.current?.abort?.()
      await api(`/api/chat/cancel/${id}`, { method:'POST', body:'{}' })
      setMessages(xs => xs.map(m => (m.role === 'assistant' && !m.content) ? { ...m, content:ct('已中止。', 'Stopped.'), error:true } : m))
      setSessions(xs => xs.map(s => s.id === id ? { ...s, running:false } : s))
      setNotice(ct('已中止当前执行', 'Current run stopped'))
    } catch (e) { setErr(e.message || String(e)) }
    finally { setBusy(false); setStreamingSid(''); if (id) loadSessions(id).catch(()=>{}) }
  }

  const attachRunningStream = async (id) => {
    if (!id) return
    streamAbortRef.current?.abort?.()
    const ctrl = new AbortController()
    streamAbortRef.current = ctrl
    let pendingId = `resume-${Date.now()}`
    setBusy(true); setStreamingSid(id); setAutoFollow(true); setShowFollow(false)
    setMessages(xs => {
      const existing = xs.find(m => m.role === 'assistant' && !m.content)
      if (existing?.id) {
        pendingId = existing.id
        return xs
      }
      return [...xs, { id:pendingId, role:'assistant', content:'', created_at:Math.floor(Date.now()/1000), run_started_at_ms:Date.now() }]
    })
    try {
      const res = await fetch(`/api/chat/stream/${id}`, { signal: ctrl.signal })
      if (res.status === 204) return
      if (!res.ok) throw new Error(await res.text())
      await followChatStream(res, pendingId, '', id, ctrl.signal)
      if (isActiveSession(id)) await loadSessions(id)
    } catch (e) {
      if (e.name !== 'AbortError' && isActiveSession(id)) setErr(e.message || String(e))
    } finally {
      if (streamAbortRef.current === ctrl) {
        streamAbortRef.current = null
        if (isActiveSession(id)) { setBusy(false); setStreamingSid('') }
      }
    }
  }

  const loadChatState = async (id = '', openToken = openSeqRef.current) => {
    const st = await api(id ? `/api/chat/state/${id}` : '/api/chat/state')
    if (openToken !== openSeqRef.current || !isActiveSession(id)) return null
    const nextLlms = st.llms || []
    const nextNo = st.settings?.llm_no ?? st.llm_no ?? nextLlms[0]?.index ?? 0
    const nextReasoningEffort = normalizeReasoningEffort(st.settings?.reasoning_effort)
    const nextExtraSysPrompts = Array.isArray(st.extra_sys_prompts) ? st.extra_sys_prompts.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : []
    const nextExtraSysPromptPresetID = String(st.extra_sys_prompt_preset_id || '').trim()
    setLlms(nextLlms)
    setLlmNo(nextLlms.some(m => m.index === nextNo) ? nextNo : (nextLlms[0]?.index ?? 0))
    setReasoningEffort(nextReasoningEffort)
    setExtraSysPrompts(nextExtraSysPrompts)
    setExtraSysPromptPresetID(nextExtraSysPromptPresetID)
    if (id && st.running) {
      attachRunningStream(id)
    } else if (id && streamingSid && streamingSid !== id) {
      streamAbortRef.current?.abort?.()
      streamAbortRef.current = null
      setBusy(false)
      setStreamingSid('')
    }
    return { extraSysPromptPresetID: nextExtraSysPromptPresetID, extraSysPrompts: nextExtraSysPrompts }
  }

  const openSession = async (id, refreshList = true) => {
    setWorldlineRestorePicker(null)
    const openToken = ++openSeqRef.current
    activeSidRef.current = id
    streamAbortRef.current?.abort?.()
    streamAbortRef.current = null
    scrollModeRef.current = 'auto'
    setSid(id)
    setBusy(false)
    setStreamingSid('')
    setAutoFollow(true)
    setShowFollow(false)
    const d = await api(`/api/chat/session/${id}`)
    if (openToken !== openSeqRef.current || activeSidRef.current !== id) return
    activeSidRef.current = d.id
    scrollModeRef.current = 'auto'
    setSid(d.id)
    setMessages(d.messages || [])
    setRawHistory(Array.isArray(d.raw_history) ? d.raw_history : [])
    setHistoryInfo(Array.isArray(d.history_info) ? d.history_info : [])
    setWorkingState(d.working || null)
    setPlanState(d.plan || null)
    setLlmNo(d.settings?.llm_no || 0)
    setErr('')
    setNotice('')
    setMenuOpen('')
    setMenuPos(null)
    setSessions(xs => xs.map(x => x.id === d.id ? { ...x, title: d.title, workspace: d.workspace || '', project_mode: d.project_mode || '', count: d.messages?.length || x.count, updated_at: d.updated_at || x.updated_at } : x))
    await loadChatState(d.id, openToken)
  }

  const loadSessions = async (prefer = sid, options = {}) => {
    const { open = false } = options
    const d = await api('/api/chat/sessions')
    const list = d.sessions || []
    setSessions(list)
    if (open) {
      const next = prefer || list[0]?.id || ''
      if (next) await openSession(next, false)
      else await loadChatState('', openSeqRef.current)
    } else if (!prefer && !sid) {
      await loadChatState('', openSeqRef.current)
    }
    return list
  }

  const newSession = async () => {
    setWorldlineRestorePicker(null)
    setSessionManagerOpen(false)
    setSelectedSessionIds([])
    const openToken = ++openSeqRef.current
    activeRunRef.current = false
    streamAbortRef.current?.abort?.()
    streamAbortRef.current = null
    const d = await api('/api/chat/session/new', { method:'POST', body:'{}' })
    if (openToken !== openSeqRef.current) return
    activeSidRef.current = d.id
    scrollModeRef.current = 'auto'
    setSid(d.id); setMessages([]); setRawHistory([]); setHistoryInfo([]); setWorkingState(null); setPlanState(null); setContextOpen(false); setPrompt(''); setErr(''); setNotice(ct('已创建新对话', 'New chat created')); setBusy(false); setStreamingSid(''); setAutoFollow(false); setShowFollow(false); setLlmNo(d.settings?.llm_no || 0)
    await loadChatState(d.id, openToken)
  }

  const deleteSession = async (id) => {
    if (!id || !confirmDanger('chat-session-delete', ct('删除此会话？此操作不可恢复。', 'Delete this session? This cannot be undone.'))) return
    await api(`/api/chat/session/${id}`, { method:'DELETE' })
    setSessions(xs => xs.filter(x => x.id !== id))
    setMenuOpen('')
    setMenuPos(null)
    if (id === sid) {
      ++openSeqRef.current
      activeSidRef.current = ''
      streamAbortRef.current?.abort?.()
      streamAbortRef.current = null
      scrollModeRef.current = 'auto'
      setSid(''); setMessages([]); setBusy(false); setStreamingSid(''); setAutoFollow(true); setShowFollow(false); setNotice(ct('会话已删除', 'Session deleted'))
    }
    setTimeout(() => loadSessions('', { open:true }).catch(()=>{}), 0)
  }

  const openSessionManager = () => {
    setSessionManagerOpen(true)
    setSelectedSessionIds([])
    setEditing('')
    setDraftTitle('')
    setMenuOpen('')
    setMenuPos(null)
  }

  const closeSessionManager = () => {
    if (batchDeleting) return
    setSessionManagerOpen(false)
    setSelectedSessionIds([])
  }

  const toggleSessionSelection = (id) => {
    if (!id || batchDeleting) return
    setSelectedSessionIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])
  }

  const toggleAllSessions = () => {
    if (batchDeleting) return
    setSelectedSessionIds(ids => {
      const selected = new Set(ids)
      return sessions.length > 0 && sessions.every(session => selected.has(session.id))
        ? []
        : sessions.map(session => session.id)
    })
  }

  const deleteSelectedSessions = async () => {
    if (batchDeleting) return
    const available = new Set(sessions.map(session => session.id))
    const ids = normalizeSessionIds(selectedSessionIds).filter(id => available.has(id))
    if (!ids.length || !confirmDanger('chat-session-batch-delete', ct(`永久删除已选的 ${ids.length} 个会话？此操作不可恢复。`, `Permanently delete ${ids.length} selected sessions? This cannot be undone.`))) return

    setBatchDeleting(true)
    setErr('')
    setNotice('')
    try {
      const result = await deleteChatSessions(ids, id => api(`/api/chat/session/${id}`, { method:'DELETE' }))
      const deleted = new Set(result.deletedIds)
      const activeDeleted = deleted.has(sid)
      if (deleted.size) setSessions(xs => xs.filter(session => !deleted.has(session.id)))

      if (activeDeleted) {
        ++openSeqRef.current
        activeSidRef.current = ''
        streamAbortRef.current?.abort?.()
        streamAbortRef.current = null
        scrollModeRef.current = 'auto'
        setSid('')
        setMessages([])
        setRawHistory([])
        setHistoryInfo([])
        setWorkingState(null)
        setPlanState(null)
        setContextOpen(false)
        setBusy(false)
        setStreamingSid('')
        setAutoFollow(true)
        setShowFollow(false)
      }

      let refreshError = ''
      if (deleted.size) {
        try {
          await loadSessions(activeDeleted ? '' : sid, { open: activeDeleted })
        } catch (e) {
          refreshError = e?.message || String(e)
        }
      }

      if (result.failedIds.length) {
        setSelectedSessionIds(result.failedIds)
        const detail = result.failures[0]?.error?.message || ''
        setErr(ct(`${result.failedIds.length} 个会话删除失败${detail ? `：${detail}` : ''}${refreshError ? `；刷新失败：${refreshError}` : ''}`, `${result.failedIds.length} sessions could not be deleted${detail ? `: ${detail}` : ''}${refreshError ? `; refresh failed: ${refreshError}` : ''}`))
      } else {
        setSelectedSessionIds([])
        setSessionManagerOpen(false)
        if (refreshError) setErr(ct(`已删除 ${result.deletedIds.length} 个会话，但刷新列表失败：${refreshError}`, `${result.deletedIds.length} sessions deleted, but list refresh failed: ${refreshError}`))
        else setNotice(ct(`已删除 ${result.deletedIds.length} 个会话`, `${result.deletedIds.length} sessions deleted`))
      }
    } finally {
      setBatchDeleting(false)
    }
  }

  const startRename = (s) => { setEditing(s.id); setDraftTitle(shortTitle(s)); setMenuOpen(''); setMenuPos(null) }
  const saveRename = async (id) => {
    const title = draftTitle.trim()
    if (!title) return
    const d = await api(`/api/chat/session/${id}`, { method:'PATCH', body: JSON.stringify({ title }) })
    setSessions(xs => xs.map(x => x.id === id ? { ...x, title:d.title, updated_at:d.updated_at } : x))
    setEditing(''); setDraftTitle(''); setNotice(ct('会话已更名', 'Session renamed'))
  }

  const saveModel = async (next) => {
    setLlmNo(next)
    if (!sid) return
    await api(`/api/chat/settings/${sid}`, { method:'POST', body: JSON.stringify({ llm_no: next, reasoning_effort: reasoningEffort }) })
    setNotice(ct('模型已切换', 'Model changed'))
  }

  const saveReasoningEffort = async (value) => {
    const next = normalizeReasoningEffort(value)
    const prev = reasoningEffort
    setReasoningEffort(next)
    if (!sid) return
    try {
      await api(`/api/chat/settings/${sid}`, { method:'POST', body: JSON.stringify({ llm_no: llmNo, reasoning_effort: next }) })
      setNotice(next === 'off' ? ct('推理强度已设为默认', 'Reasoning effort reset to default') : ct(`推理强度已设为 ${next}`, `Reasoning effort set to ${next}`))
    } catch (e) {
      setReasoningEffort(prev)
      setErr(e.message || String(e))
    }
  }

  const loadPromptPresets = async () => {
    const d = await api('/api/extra-system-prompt-presets')
    const next = normalizePromptPresets(d?.presets)
    setPromptPresets(next)
    return next
  }
  const selectExtraPromptPreset = (value) => {
    extraPromptSelectionSeqRef.current += 1
    setExtraPromptSelection(value)
  }
  const openExtraPromptEditor = () => {
    const targetSid = activeSidRef.current
    const targetOpenToken = openSeqRef.current
    const initialSelectionSeq = extraPromptSelectionSeqRef.current
    setPromptPresetManagerOpen(false)
    setExtraPromptTargetSid(targetSid)
    setExtraPromptSelection(extraSysPromptPresetID)
    setExtraPromptOpen(true)

    Promise.all([
      loadChatState(targetSid, targetOpenToken),
      loadPromptPresets(),
    ]).then(([freshState]) => {
      if (!freshState || targetOpenToken !== openSeqRef.current || activeSidRef.current !== targetSid) return
      if (extraPromptSelectionSeqRef.current === initialSelectionSeq) {
        setExtraPromptSelection(freshState.extraSysPromptPresetID)
      }
    }).catch(e => {
      if (targetOpenToken === openSeqRef.current && activeSidRef.current === targetSid) {
        setErr(e.message || String(e))
      }
    })
  }
  const openPromptPresetManager = () => {
    setExtraPromptDraft(promptPresets.map(item => ({ ...item })))
    setPromptPresetManagerOpen(true)
  }
  const updateExtraPromptDraft = (id, field, value) => {
    setExtraPromptDraft(items => items.map(item => item.id === id ? { ...item, [field]: value } : item))
  }
  const saveExtraPromptSelection = async () => {
    const targetSid = extraPromptTargetSid
    if (!targetSid) {
      setErr(ct('请先创建或打开会话', 'Create or open a session first'))
      return
    }
    if (activeSidRef.current !== targetSid) {
      setExtraPromptOpen(false)
      setErr(ct('会话已切换，请重新选择系统提示预设', 'The session changed; choose the system-prompt preset again'))
      return
    }
    const targetOpenToken = openSeqRef.current
    setExtraPromptSaving(true)
    try {
      const d = await api(`/api/chat/settings/${targetSid}`, {
        method:'POST',
        body: JSON.stringify({ llm_no: llmNo, reasoning_effort: reasoningEffort, ...promptPresetPatch(extraPromptSelection) }),
      })
      if (targetOpenToken !== openSeqRef.current || activeSidRef.current !== targetSid) {
        setExtraPromptOpen(false)
        return
      }
      const savedID = String(d.extra_sys_prompt_preset_id || '').trim()
      const savedPrompts = Array.isArray(d.extra_sys_prompts) ? d.extra_sys_prompts.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : []
      setExtraSysPromptPresetID(savedID)
      setExtraSysPrompts(savedPrompts)
      setExtraPromptSelection(savedID)
      setExtraPromptOpen(false)
      setNotice(savedID ? ct(`已为当前会话启用「${selectedPromptPresetView({ presets: promptPresets, selectedID: savedID, snapshot: savedPrompts }).name}」`, `Enabled “${selectedPromptPresetView({ presets: promptPresets, selectedID: savedID, snapshot: savedPrompts }).name}” for this session`) : ct('当前会话已停用额外系统提示', 'Extra system prompt disabled for this session'))
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setExtraPromptSaving(false)
    }
  }
  const savePromptPresets = async () => {
    const next = normalizePromptPresets(extraPromptDraft)
    if (next.some(item => !item.name || !item.content)) {
      setErr(ct('每个预设都需要名称和提示内容', 'Every preset needs a name and prompt content'))
      return
    }
    if (!confirmDanger('chat-extra-system-prompt-presets-save', ct(`保存 ${next.length} 个全局系统提示预设？这会写入 GA Admin 配置文件。`, `Save ${next.length} global system-prompt presets? This writes the GA Admin configuration file.`))) return
    setExtraPromptSaving(true)
    try {
      const d = await api('/api/extra-system-prompt-presets', {
        dangerous:true,
        method:'PUT',
        body: JSON.stringify({ presets: next }),
      })
      const saved = normalizePromptPresets(d?.presets)
      setPromptPresets(saved)
      setExtraPromptDraft(saved.map(item => ({ ...item })))
      setPromptPresetManagerOpen(false)
      setNotice(ct(`已保存 ${saved.length} 个系统提示预设`, `${saved.length} system-prompt presets saved`))
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setExtraPromptSaving(false)
    }
  }


  const addAttachmentFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean)
    if (!files.length) return
    if (attachments.length + files.length > MAX_CHAT_UPLOAD_FILES) {
      setErr(ct(`附件最多上传 ${MAX_CHAT_UPLOAD_FILES} 个`, `You can upload up to ${MAX_CHAT_UPLOAD_FILES} attachments`))
      return
    }
    const tooLarge = files.find((file) => (Number(file.size) || 0) > MAX_CHAT_UPLOAD_BYTES_PER_FILE)
    if (tooLarge) {
      setErr(ct(`附件过大：${tooLarge.name || 'attachment'}，单个限制 20MB`, `Attachment too large: ${tooLarge.name || 'attachment'}; limit 20 MB per file`))
      return
    }
    const totalBytes = attachments.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
      + files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
    if (totalBytes > MAX_CHAT_UPLOAD_BYTES_TOTAL) {
      setErr(ct('附件总大小限制 40MB', 'Total attachment size is limited to 40 MB'))
      return
    }
    const readOne = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve({
        id:`file-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name:file.name || `attachment-${Date.now()}`,
        type:file.type || 'application/octet-stream',
        size:Number(file.size) || 0,
        dataURL:String(reader.result || ''),
      })
      reader.onerror = () => reject(reader.error || new Error(ct('读取附件失败', 'Failed to read attachment')))
      reader.readAsDataURL(file)
    })
    try {
      const next = await Promise.all(files.map(readOne))
      setAttachments((current) => [...current, ...next].slice(0, MAX_CHAT_UPLOAD_FILES))
      setErr('')
    } catch (e) { setErr(e.message || String(e)) }
  }

  const removeAttachment = (id) => setAttachments(xs => xs.filter(x => x.id !== id))
  const syncQueue = (next) => { queuedRef.current = next; setQueuedMessages(next) }
  const popQueued = () => {
    const [first, ...rest] = queuedRef.current
    syncQueue(rest)
    return first
  }
  const enqueueMessage = (item) => {
    const next = [...queuedRef.current, { ...item, id:`q-${Date.now()}-${Math.random().toString(16).slice(2)}`, queuedAt:Date.now() }]
    syncQueue(next)
    setNotice(ct(`已加入队列（${next.length} 条）。点击“引导”可中止当前回复并立即发送。`, `Added to queue (${next.length}). Use Guide to stop the current response and send immediately.`))
  }
  const removeQueued = (id) => {
    syncQueue(queuedRef.current.filter(x => x.id !== id))
    if (queueEditingId === id) { setQueueEditingId(''); setQueueDraft('') }
  }
  const editQueued = (id) => {
    const item = queuedRef.current.find(x => x.id === id)
    if (!item) return
    setQueueEditingId(id)
    setQueueDraft(item.text || '')
    setNotice(ct('正在编辑队列消息', 'Editing queued message'))
  }
  const cancelQueueEdit = () => {
    setQueueEditingId('')
    setQueueDraft('')
    setNotice('')
  }
  const saveQueueEdit = (id) => {
    const text = queueDraft.trim()
    const item = queuedRef.current.find(x => x.id === id)
    if (!item) return
    if (!text && !(item.files || []).length) { setErr(ct('队列消息不能为空', 'Queued message cannot be empty')); return }
    syncQueue(queuedRef.current.map(x => x.id === id ? { ...x, text } : x))
    setQueueEditingId('')
    setQueueDraft('')
    setErr('')
    setNotice(ct('队列消息已更新', 'Queued message updated'))
  }
  const guideQueuedItem = (id) => {
    if (guidingQueueRef.current) return
    const item = queuedRef.current.find(x => x.id === id)
    if (!item) return
    guidingQueueRef.current = id
    setGuidingQueueId(id)
    guideQueued(item)
  }
  const onPaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []).filter(Boolean)
    if (files.length) {
      e.preventDefault()
      addAttachmentFiles(files)
    }
  }
  const onDropFiles = (e) => {
    e.preventDefault(); setDragging(false)
    addAttachmentFiles(e.dataTransfer?.files)
  }


  const fillAskReply = useCallback((text) => {
    const value = String(text || '')
    setPrompt(value)
    setNotice(ct('已填入快捷回复，确认后可发送', 'Quick reply inserted; review and send when ready'))
    const focusPrompt = () => {
      const el = promptRef.current
      if (!el) return
      el.focus()
      const len = value.length
      el.setSelectionRange?.(len, len)
    }
    requestAnimationFrame(focusPrompt)
    setTimeout(focusPrompt, 0)
  }, [])

  const editAndResend = async (messageId, text) => {
    const item = buildEditResendItem({
      sessionId: activeSidRef.current,
      messageId,
      text,
      busy,
      streamingSid,
    })
    await runSend(item)
  }

  const sendBTW = async (text, sessionId = activeSidRef.current || sid, retryId = '') => {
    if (!sessionId) {
      setNotice(ct('请先打开一个对话再使用 /btw', 'Open a conversation before using /btw'))
      return
    }
    const prompt = String(text || '').trim()
    const question = prompt.replace(/^\/btw(?:\s+|$)/i, '').trim()
    if (!question) {
      setNotice(ct('请在 /btw 后输入问题', 'Enter a question after /btw'))
      return
    }
    const placeholderId = retryId || `btw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const placeholder = {
      id: placeholderId,
      role: 'assistant',
      kind: 'btw',
      side_question: question,
      btw_status: 'pending',
      content: '',
      created_at: Math.floor(Date.now() / 1000),
    }
    setErr(''); setNotice('')
    if (isActiveSession(sessionId)) setMessages(xs => retryId
      ? xs.map(m => m.id === retryId ? placeholder : m)
      : [...xs, placeholder])
    try {
      const data = await api(`/api/chat/btw/${sessionId}`, { method:'POST', body:JSON.stringify({ prompt:`/btw ${question}` }) })
      if (!isActiveSession(sessionId)) return
      if (data?.message) setMessages(xs => xs.map(m => m.id === placeholderId ? { ...data.message, btw_status:'done' } : m))
      await loadSessions(sessionId)
    } catch (e) {
      if (!isActiveSession(sessionId)) return
      const detail = e?.message || String(e)
      setMessages(xs => xs.map(m => m.id === placeholderId
        ? { ...m, btw_status:'error', content:detail }
        : m))
    }
  }

  const runSend = async (item = {}) => {
    const guidedQueueId = guidingQueueRef.current
    if (guidedQueueId) {
      syncQueue(queuedRef.current.filter(x => x.id !== guidedQueueId))
      guidingQueueRef.current = ''
      setGuidingQueueId('')
    }
    const text = String(item.text || '').trim()
    const files = (item.files || []).map(({ name, type, dataURL }) => ({ name, type, dataURL }))
    if (!text && !files.length) return
    const runToken = ++runSeqRef.current
    const openToken = openSeqRef.current
    const ctrl = new AbortController()
    activeRunRef.current = true
    streamAbortRef.current?.abort?.()
    streamAbortRef.current = ctrl
    const targetSessionID = item.sessionId || sid
    setBusy(true); setStreamingSid(targetSessionID || 'new'); setErr(''); setNotice('')
    let id = targetSessionID
    let commandPatch = null
    let optimistic = null
    let pending = null
    try {
      if (!id) {
        const d = await api('/api/chat/session/new', { method:'POST', body:'{}' })
        if (runToken !== runSeqRef.current || openToken !== openSeqRef.current) return
        id = d.id
        activeSidRef.current = id
        scrollModeRef.current = 'auto'
        setSid(id); setStreamingSid(id)
      } else if (!isActiveSession(id)) {
        return
      }
      const clientUserID = `u-${Date.now()}`
      setStreamingSid(id)
      setSessions(xs => xs.map(s => s.id === id ? { ...s, running:true } : s))
      setAutoFollow(true); setShowFollow(false)
      const fileNote = files.length ? `\n\n[附件]\n${files.map((file) => `- ${uploadFileName(file)}`).join('\n')}` : ''
      const attachmentPrompt = text || ct('请处理这些附件', 'Please process these attachments')
      optimistic = { id:clientUserID, role:'user', content:attachmentPrompt + fileNote, files, created_at:Math.floor(Date.now()/1000) }
      pending = { id:`a-${Date.now()}`, role:'assistant', content:'', created_at:Math.floor(Date.now()/1000), run_started_at_ms:Date.now() }
      const sourceMessageID = String(item.sourceUserMessageId || '').trim()
      setRawHistory([]); setHistoryInfo([]); setWorkingState(null); setPlanState(null)
      if (!isActiveSession(id)) return
      activeSidRef.current = id
      if (!sourceMessageID) setMessages(xs => isActiveSession(id) ? [...xs, optimistic, pending] : xs)
      const payload = buildChatRunPayload({
        prompt: attachmentPrompt,
        files,
        settings: { llm_no:item.llmNo ?? llmNo, reasoning_effort:item.reasoningEffort || reasoningEffort },
        clientUserID,
        sourceUserMessageId: sourceMessageID,
      })
      const res = await fetch(`/api/chat/${id}`, { method:'POST', headers:{'Content-Type':'application/json'}, signal: ctrl.signal, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error(await res.text())
      if (sourceMessageID) setMessages(xs => {
        if (!isActiveSession(id)) return xs
        const cutIdx = xs.findIndex(message => String(message.id) === sourceMessageID)
        if (cutIdx < 0) return xs
        return [...xs.slice(0, cutIdx), optimistic, pending]
      })
      commandPatch = await followChatStream(res, pending.id, clientUserID, id, ctrl.signal)
    } catch (e) {
      if (runToken === runSeqRef.current && openToken === openSeqRef.current && e?.name !== 'AbortError' && isActiveSession(id)) setErr(e.message || String(e))
      if (item.propagateError) throw e
    } finally {
      if (runToken !== runSeqRef.current) return
      if (openToken !== openSeqRef.current || !isActiveSession(id)) {
        activeRunRef.current = false
        return
      }
      if (id) {
        await loadSessions(id).catch(()=>{})
        await openSession(id, false).catch(()=>{})
        if (commandPatch?.commandResult && optimistic && pending && isActiveSession(id)) {
          const showWorldlinePicker = isWorldlinePickerResult(commandPatch.commandResult)
          const resultMessage = {
            ...pending,
            content: commandResultSummary(commandPatch.commandResult),
            commandResult: commandPatch.commandResult,
            run_started_at_ms: undefined,
          }
          setMessages(xs => {
            if (!isActiveSession(id)) return xs
            const baseMessages = showWorldlinePicker ? xs.filter(m => m.id !== pending.id) : xs
            const hasUser = baseMessages.some(m => m.id === optimistic.id)
            return [...baseMessages, ...(hasUser ? [] : [optimistic]), ...(showWorldlinePicker ? [] : [resultMessage])]
          })
          if (Object.prototype.hasOwnProperty.call(commandPatch, 'prefill')) setPrompt(commandPatch.prefill)
          if (showWorldlinePicker) {
            setWorldlineRestorePicker({ nodes:commandPatch.commandResult.tree.nodes, sessionID:id })
          }
          if (commandPatch.download) {
            const blob = new Blob([commandPatch.download.content], { type:commandPatch.download.mime })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url; link.download = commandPatch.download.filename
            document.body.appendChild(link); link.click(); link.remove()
            URL.revokeObjectURL(url)
          }
        }
      }
      const next = popQueued()
      if (next) {
        setNotice(ct(`继续发送队列消息（剩余 ${Math.max(queuedRef.current.length, 0)} 条）`, `Continuing queued messages (${Math.max(queuedRef.current.length, 0)} remaining)`))
        setTimeout(() => runSend(next), 0)
      } else {
        activeRunRef.current = false
        setBusy(false)
        setStreamingSid('')
      }
    }
  }

  const selectWorldlineRestoreNode = useCallback((nodeID, mode, target) => {
    const command = worldlineRestoreCommand(nodeID, mode, target)
    if (!command) return
    setPrompt(command)
    setWorldlineRestorePicker(null)
    setNotice(ct('已填入恢复命令，确认后发送', 'Restore command inserted; review before sending'))
    window.setTimeout(() => {
      const input = promptRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange?.(command.length, command.length)
    }, 0)
  }, [])

  const expandCustomSlashCommand = useCallback((value) => {
    const raw = String(value || '').trim()
    if (!raw.startsWith('/')) return raw
    const custom = (cfg?.slash_commands || [])
      .filter(c => c?.cmd && !isProtectedSlashCommand(c.cmd))
      .map(c => ({ ...c, cmd: String(c.cmd || '').trim() }))
      .sort((a, b) => b.cmd.length - a.cmd.length)
    const hit = custom.find(c => raw === c.cmd || raw.startsWith(`${c.cmd} `) || raw.startsWith(`${c.cmd}\n`))
    if (!hit) return raw
    const args = raw.slice(hit.cmd.length).trim()
    let body = String(hit.content || hit.prompt || hit.desc || '').trim()
    if (!body) return raw
    if (body.includes('{{args}}') || body.includes('{args}')) {
      body = body.replaceAll('{{args}}', args).replaceAll('{args}', args)
    } else if (args) {
      body = `${body}\n\n${args}`
    }
    return body
  }, [cfg?.slash_commands, isProtectedSlashCommand])

  const send = async (textOverride = null) => {
    const hasStringOverride = typeof textOverride === 'string'
    const sourceText = hasStringOverride ? textOverride : prompt
    const text = expandCustomSlashCommand(String(sourceText || '').trim())
    const files = attachments.map(({ name, type, dataURL }) => ({ name, type, dataURL }))
    if (text === '/new' && !files.length) {
      setPrompt('')
      if (busy || activeRunRef.current) {
        setNotice(ct('当前正在执行，完成后可使用 /new 创建新对话', 'A run is in progress. Use /new after it completes.'))
        return
      }
      await newSession()
      return
    }
    if (!text && !files.length) return
    const item = { text, files, llmNo, reasoningEffort }
    setPrompt(''); setAttachments([])
    setCmdDrawer({ open:false, filter:'', selectedIdx:0 })
    setCmdEditIdx(-1)
    if (isBTWCommand(text) && !files.length) {
      await sendBTW(text)
      return
    }
    if (busy || activeRunRef.current) {
      enqueueMessage(item)
      return
    }
    await runSend(item)
  }

  const applySlashCommand = (cmd, currentValue = prompt) => {
    if (!cmd) return
    const next = slashCommandInsertText(cmd, currentValue)
    setPrompt(next)
    setCmdDrawer(slashCommandNextDrawer(cmd, next))
    setCmdEditIdx(-1)
    setTimeout(() => promptRef.current?.focus(), 0)
  }

  const handlePromptChange = (e) => {
    const v = e.target.value
    setPrompt(v)
    if (v.startsWith('/')) {
      setCmdDrawer({ open:true, filter:v.slice(1), selectedIdx:0 })
      setCmdEditIdx(-1)
    } else if (cmdDrawer.open) {
      setCmdDrawer({ open:false, filter:'', selectedIdx:0 })
      setCmdEditIdx(-1)
    }
  }

  const handlePromptKeyDown = (e) => {
    const currentValue = e.currentTarget.value
    if (cmdDrawer.open && cmdEditIdx === -1) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCmdDrawer(prev => ({ ...prev, selectedIdx: Math.min(prev.selectedIdx + 1, Math.max(filteredCmds.length - 1, 0)) }))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCmdDrawer(prev => ({ ...prev, selectedIdx: Math.max(prev.selectedIdx - 1, 0) }))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const cmd = filteredCmds[cmdDrawer.selectedIdx]
        const selectingNaturalReview = cmd?.cmd === '/review <request>' && /^\s*\/review\s+\S/.test(currentValue)
        const selectingBareContinue = e.key === 'Enter' && /^\s*\/continue\s*$/.test(currentValue)
        const selectingBareEffort = e.key === 'Enter' && /^\s*\/effort\s*$/.test(currentValue)
        const selectingBareImprove = e.key === 'Enter' && /^\s*\/improve\s*$/.test(currentValue)
        const selectingContinueNumber = cmd?.cmd === '/continue <number>' && /^\s*\/continue\s+\d+\s*$/.test(currentValue)
        const selectingUltraPlanObjective = cmd?.cmd === '/ultraplan <goal>' && /^\s*\/ultraplan\s+\S/.test(currentValue)
        if (selectingNaturalReview || selectingBareContinue || selectingBareEffort || selectingBareImprove || selectingContinueNumber || selectingUltraPlanObjective) {
          e.preventDefault()
          setCmdDrawer({ open:false, filter:'', selectedIdx:0 })
          setCmdEditIdx(-1)
          if (e.key === 'Enter') send(currentValue)
          return
        }
        if (cmd) {
          e.preventDefault()
          applySlashCommand(cmd, currentValue)
          return
        }
        e.preventDefault()
        setCmdDrawer({ open:false, filter:'', selectedIdx:0 })
        setCmdEditIdx(-1)
        if (e.key === 'Enter') send(currentValue)
        return
      }
      if (e.key === 'Escape') {
        setCmdDrawer({ open:false, filter:'', selectedIdx:0 })
        setCmdEditIdx(-1)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(currentValue)
    }
  }


  const guideQueued = async (item = null) => {
    const next = item || popQueued()
    if (!next) {
      guidingQueueRef.current = ''
      setGuidingQueueId('')
      return
    }
    const id = sid
    const wasRunning = busy && streamingSid === sid
    ++runSeqRef.current
    try {
      if (wasRunning) {
        streamAbortRef.current?.abort?.()
        if (id) await api(`/api/chat/cancel/${id}`, { method:'POST', body:'{}' })
        setMessages(xs => xs.map((m, idx) => (idx === xs.length - 1 && m.role === 'assistant' && !m.content) ? { ...m, content:ct('已中止，改为执行引导消息。', 'Stopped and switched to the guided message.'), error:true } : m))
      }
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setBusy(false)
      setStreamingSid('')
      setNotice(ct('已引导：中止当前回复并发送队列消息', 'Guided: stopped the current response and sent the queued message'))
      setTimeout(() => runSend(next), 0)
    }
  }

  useEffect(() => {
    loadSessions('', { open:true }).catch(e=>setErr(e.message))
    loadPromptPresets().catch(e=>setErr(e.message))
    return () => streamAbortRef.current?.abort?.()
  }, [])

  useEffect(() => {
    let stopped = false
    let inFlight = false
    const refreshList = async () => {
      if (stopped || inFlight || document.hidden) return
      inFlight = true
      try {
        const d = await api('/api/chat/sessions')
        if (!stopped) setSessions(d.sessions || [])
      } catch {
        // Background refresh is best-effort; keep manual refresh errors visible only.
      } finally {
        inFlight = false
      }
    }
    const timer = window.setInterval(refreshList, 3000)
    const onVisible = () => { if (!document.hidden) refreshList() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    if (!sessionManagerOpen) return
    const previousOverflow = document.body.style.overflow
    const onKey = (e) => {
      if (e.key !== 'Escape' || batchDeleting) return
      setSessionManagerOpen(false)
      setSelectedSessionIds([])
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [sessionManagerOpen, batchDeleting])

  const scrollToThreadEnd = (behavior = 'auto') => endRef.current?.scrollIntoView({ behavior, block:'end' })
  const resumeFollow = () => {
    setAutoFollow(true)
    setShowFollow(false)
    scrollToThreadEnd('auto')
  }
  const updateFollowFromScroll = () => {
    const near = isNearBottom(threadRef.current)
    setAutoFollow(near)
    setShowFollow(!near)
  }
  const breakFollow = () => {
    if (autoFollow && !isNearBottom(threadRef.current, 12)) {
      setAutoFollow(false)
      setShowFollow(true)
    }
  }

  useEffect(() => {
    if (autoFollow) {
      const behavior = scrollModeRef.current || 'auto'
      scrollModeRef.current = 'auto'
      scrollToThreadEnd(behavior)
    } else if (!isNearBottom(threadRef.current)) {
      setShowFollow(true)
    }
  }, [messages, busy, autoFollow])

  useGSAP(() => {
    if (prefersReducedMotion()) return
    const q = gsap.utils.selector(chatScope)
    gsap.from(q('.oa-sidebar'), { x: -24, autoAlpha: 0, duration: 0.52, ease: 'power3.out', clearProps: 'transform,opacity,visibility' })
    gsap.from(q('.oa-topbar, .oa-thread, .oa-composer-wrap'), { y: 18, autoAlpha: 0, duration: 0.5, stagger: 0.08, ease: 'power3.out', clearProps: 'transform,opacity,visibility' })
  }, { scope: chatScope })

  useGSAP(() => {
    if (prefersReducedMotion() || !messages.length) return
    const lastMessage = chatScope.current?.querySelector('.oa-message:last-of-type, .oa-turn:last-of-type')
    if (lastMessage) gsap.from(lastMessage, { y: 14, autoAlpha: 0, duration: 0.32, ease: 'power2.out' })
  }, { scope: chatScope, dependencies: [messages.length] })

  const selectedSessionIdSet = useMemo(() => new Set(selectedSessionIds), [selectedSessionIds])
  const selectedSessionCount = sessions.reduce((count, session) => count + (selectedSessionIdSet.has(session.id) ? 1 : 0), 0)
  const allSessionsSelected = sessions.length > 0 && selectedSessionCount === sessions.length
  const activeModel = llms.find(x => x.index === llmNo) || llms[0]
  const selectedModelNo = activeModel?.index ?? llmNo
  const providerGroups = useMemo(() => {
    const groups = new Map()
    llms.forEach(model => {
      const provider = modelProvider(model)
      if (!groups.has(provider)) groups.set(provider, [])
      groups.get(provider).push({ value: model.index, label: runtimeModelLabel(model) })
    })
    return Array.from(groups, ([provider, models]) => ({ value: provider, label: provider, models }))
  }, [llms])
  const selectedProvider = activeModel ? modelProvider(activeModel) : (providerGroups[0]?.value || '')
  const isCurrentRunning = busy && streamingSid === sid
  const activePromptPreset = selectedPromptPresetView({ presets: promptPresets, selectedID: extraSysPromptPresetID, snapshot: extraSysPrompts })
  const contextJson = useMemo(() => JSON.stringify({ raw_history: rawHistory || [], history_info: historyInfo || [], working: workingState || {} }, null, 2), [rawHistory, historyInfo, workingState])
  const btwMessages = useMemo(() => messages.filter(message => message.kind === 'btw'), [messages])
  const copyContext = async () => {
    try {
      await navigator.clipboard.writeText(contextJson)
      setNotice(ct('模型上下文 JSON 已复制', 'Model context JSON copied'))
    } catch {
      setErr(ct('复制失败，请手动选择 JSON', 'Copy failed; select the JSON manually'))
    }
  }

  return <div ref={chatScope} className={`oa-chat ${collapsed ? 'is-collapsed' : ''}`}>
    <aside className={`oa-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="oa-side-head">
        <div className="oa-logo"><Bot size={18}/><span>GenericAgent</span></div>
        <button className="oa-icon-btn" onClick={()=>setCollapsed(true)} title={ct('折叠', 'Collapse')}><Menu size={18}/></button>
      </div>
      <button className="oa-new-chat" onClick={newSession} disabled={batchDeleting}><MessageSquarePlus size={16}/><span>{ct('新对话', 'New chat')}</span></button>
      <div className="oa-session-manager-head">
        <span className="oa-session-manager-title">{ct('历史会话', 'History')} <small>{sessions.length}</small></span>
        <button className="oa-session-manage-open" type="button" onClick={openSessionManager} disabled={!sessions.length}>{ct('管理', 'Manage')}</button>
      </div>
      <div className="oa-session-list">
        {sessions.map(s => <div key={s.id} className={`oa-session-row ${s.id===sid?'active':''} ${s.running?'is-running':''}`}>
          {editing === s.id ? <div className="oa-rename">
            <input value={draftTitle} autoFocus onChange={e=>setDraftTitle(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') saveRename(s.id); if(e.key==='Escape') setEditing('') }}/>
            <button onClick={()=>saveRename(s.id)}><Check size={14}/></button><button onClick={()=>setEditing('')}><X size={14}/></button>
          </div> : <button className="oa-session" onClick={()=>openSession(s.id)} title={shortTitle(s)}>
            <span className="oa-session-title" title={shortTitle(s)}>{s.running && <i className="oa-session-running-dot" aria-hidden="true"/>}<b>{shortTitle(s)}</b></span>
            <small><Clock3 size={11}/>{fmtTime(s.updated_at) || ct('刚刚', 'Just now')} · {ct(`${s.count || 0} 条`, `${s.count || 0} messages`)}{s.running && <em className="oa-session-running-label">{ct('运行中', 'Running')}</em>}</small>
          </button>}
          {editing !== s.id && <button className={`oa-session-more ${menuOpen === s.id ? 'is-open' : ''}`} onClick={(e)=>{
            e.stopPropagation()
            if (menuOpen === s.id) { setMenuOpen(''); setMenuPos(null); return }
            const r = e.currentTarget.getBoundingClientRect()
            setMenuPos({ top: Math.max(8, r.top - 78), left: Math.max(8, r.right - 136) })
            setMenuOpen(s.id)
          }} aria-label={ct('会话操作', 'Session actions')}><MoreHorizontal size={16}/></button>}
        </div>)}
        {!sessions.length && <div className="oa-empty-list">{ct('暂无历史会话', 'No session history')}</div>}
      </div>
      {!sessionManagerOpen && menuOpen && menuPos && (() => {
        const s = sessions.find(x => x.id === menuOpen)
        if (!s) return null
        return <div className="oa-session-menu" style={{ top: menuPos.top, left: menuPos.left }} onClick={e=>e.stopPropagation()}>
          <button onClick={()=>startRename(s)}><Edit3 size={14}/>{ct('重命名', 'Rename')}</button>
          <button className="danger" onClick={()=>deleteSession(s.id)}><Trash2 size={14}/>{ct('删除', 'Delete')}</button>
        </div>
      })()}
      <div className="oa-sidebar-foot">
        <button onClick={()=>loadSessions().catch(e=>setErr(e.message))}><RefreshCw size={15}/>{ct('刷新会话', 'Refresh sessions')}</button>
        <button onClick={()=>window.location.href='/'}><ChevronLeft size={15}/>{ct('返回管理台', 'Back to admin')}</button>
      </div>
    </aside>

    <main className="oa-main">
      <header className="oa-topbar">
        {collapsed && <div className="oa-collapsed-actions">
          <button className="oa-icon-btn oa-sidebar-toggle" onClick={()=>setCollapsed(false)} title={ct('展开侧栏', 'Expand sidebar')} aria-label={ct('展开侧栏', 'Expand sidebar')}><Menu size={18}/></button>
          <button className="oa-icon-btn oa-collapsed-new" onClick={newSession} title={ct('新对话', 'New chat')} aria-label={ct('新对话', 'New chat')}><MessageSquarePlus size={18}/></button>
        </div>}
        <div className="oa-title"><b>{current ? shortTitle(current) : ct('新对话', 'New chat')}</b><span>ChatGPT-style workspace for GenericAgent</span>{current?.project_mode && <span className="oa-project-badge" title={`Project Mode: ${current.project_mode}`}>Project: {current.project_mode}</span>}{current?.workspace && <span className="oa-workspace-badge" title={current.workspace}>Workspace: {current.workspace}</span>}</div>
        <button className={`oa-context-btn ${contextOpen ? 'is-open' : ''}`} type="button" onClick={()=>setContextOpen(v=>!v)} disabled={!sid} title={ct('查看发给模型的 raw_history', 'View raw_history sent to the model')}>
          <PanelRightOpen size={16}/>{ct('上下文', 'Context')}<span>{rawHistory?.length || 0}</span>
        </button>
      </header>

      {contextOpen && <aside className="oa-context-drawer" aria-label={ct('模型上下文', 'Model context')}>
        <div className="oa-context-head">
          <div><b>{ct('模型上下文', 'Model context')}</b><span>{ct('agent.llmclient.backend.history 完成后的快照', 'Snapshot after agent.llmclient.backend.history completes')}</span></div>
          <div className="oa-context-actions"><button type="button" onClick={copyContext}>{ct('复制 JSON', 'Copy JSON')}</button><button type="button" onClick={()=>setContextOpen(false)} aria-label={ct('关闭上下文', 'Close context')}><X size={15}/></button></div>
        </div>
        <div className="oa-context-json-tree"><JsonTree data={{ raw_history: rawHistory || [], history_info: historyInfo || [], working: workingState || {} }} /></div>
        <details className="oa-context-raw"><summary>{ct('原始 JSON', 'Raw JSON')}</summary><pre className="oa-context-raw-json">{contextJson}</pre></details>
      </aside>}
      <div className={`oa-workspace ${btwMessages.length && btwRailOpen ? 'has-btw' : ''}`}>
        <section className="oa-thread" ref={threadRef} onScroll={updateFollowFromScroll} onWheel={e=>{ if (e.deltaY < 0) breakFollow() }} onTouchMove={breakFollow}>
          {messages.length === 0 && <div className="oa-empty">
            <h1>{ct('今天想让 GenericAgent 做什么？', 'What should GenericAgent do today?')}</h1>
            <p>{ct('支持 Markdown、代码块复制、图片输入、模型切换、会话重命名与删除。', 'Supports Markdown, code copying, image input, model switching, and session management.')}</p>
          </div>}
          <MessageList
            messages={messages}
            isCurrentRunning={isCurrentRunning}
            onAskReply={fillAskReply}
            onEditResend={editAndResend}
            onRetryBTW={(message)=>sendBTW(`/btw ${message.side_question}`, activeSidRef.current, message.id)}
            clockNow={streamClock}
          />
          {showFollow && <div className="oa-follow-row"><button className="oa-follow-btn" type="button" onClick={resumeFollow}><ChevronDown size={16}/>{ct('继续跟随', 'Resume following')}</button></div>}
          <div ref={endRef}/>
        </section>
        {btwMessages.length > 0 && btwRailOpen && <aside className="oa-btw-rail" aria-label={ct('侧问', 'Side questions')}>
          <header>
            <div className="oa-btw-title"><span>BTW</span><b>{ct('侧问', 'Side questions')}</b><em>{btwMessages.length}</em></div>
            <button type="button" className="oa-btw-toggle" onClick={()=>setBtwRailOpen(false)} aria-expanded="true" aria-controls="oa-btw-rail-list" title={ct('收起侧问栏', 'Collapse side question panel')}><ChevronRight size={15}/><span>{ct('收起', 'Collapse')}</span></button>
          </header>
          <div className="oa-btw-rail-list" id="oa-btw-rail-list">
            {btwMessages.map(message => <ChatMessage
              key={message.id}
              message={message}
              pending={false}
              onRetryBTW={()=>sendBTW(`/btw ${message.side_question}`, activeSidRef.current, message.id)}
              clockNow={streamClock}
            />)}
          </div>
        </aside>}
        {btwMessages.length > 0 && !btwRailOpen && <button type="button" className="oa-btw-collapsed" onClick={()=>setBtwRailOpen(true)} aria-expanded="false" aria-controls="oa-btw-rail-list" title={ct('展开侧问栏', 'Expand side question panel')}><ChevronLeft size={15}/><span>BTW</span><b>{btwMessages.length}</b></button>}
      </div>

      <footer className="oa-composer-wrap">
        <PlanTodoCard plan={planState}/>
        {queuedMessages.length > 0 && <div className={`oa-queue-dock ${isCurrentRunning ? 'is-running' : 'is-idle'}`} aria-label={ct('待发送队列', 'Send queue')}>
          <div className="oa-queue-guide-hint">
            <Sparkles className="oa-queue-guide-icon" size={14} aria-hidden="true"/>
            <span className="oa-queue-guide-copy"><b>{ct('待发送', 'Queued')}</b><small>{isCurrentRunning ? ct('回复进行中，可接管任意一条立即发送', 'A response is in progress. Take over with any queued message.') : ct('回复结束后将按顺序发送', 'Messages will be sent in order after the response.')}</small></span>
            <span className="oa-queue-count" aria-label={ct(`${queuedMessages.length} 条待发送消息`, `${queuedMessages.length} queued messages`)}>{ct(`${queuedMessages.length} 条`, `${queuedMessages.length}`)}</span>
          </div>
          {queuedMessages.map((q, i) => {
            const isEditingQueue = queueEditingId === q.id
            const isGuidingQueue = guidingQueueId === q.id
            return <div key={q.id} className={`oa-queued-item ${isEditingQueue ? 'is-editing' : ''} ${isGuidingQueue ? 'is-guiding' : ''}`}>
              <span className="oa-queue-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <div className="oa-queue-content" title={isEditingQueue ? '' : (q.text || ct('请处理这些附件', 'Please process these attachments'))}>
                {isEditingQueue ? <textarea className="oa-queue-edit-input" value={queueDraft} autoFocus rows={2} onChange={e=>setQueueDraft(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter' && (e.ctrlKey || e.metaKey)) saveQueueEdit(q.id); if(e.key==='Escape') cancelQueueEdit() }} /> : <>
                  <b>{q.text || ct('请处理这些附件', 'Please process these attachments')}</b>
                  {q.files?.length ? <em>{ct(`${q.files.length} 个附件`, `${q.files.length} attachments`)}</em> : null}
                </>}
              </div>
              <div className="oa-queue-actions">
                {isEditingQueue ? <>
                  <button className="oa-queue-action is-confirm" type="button" onClick={()=>saveQueueEdit(q.id)} title={ct('保存队列消息', 'Save queued message')} aria-label={ct('保存队列消息', 'Save queued message')}><Check size={14}/></button>
                  <button className="oa-queue-action" type="button" onClick={cancelQueueEdit} title={ct('取消编辑', 'Cancel editing')} aria-label={ct('取消编辑', 'Cancel editing')}><X size={14}/></button>
                </> : <>
                  <button className="oa-guide-btn" type="button" onClick={()=>guideQueuedItem(q.id)} disabled={!isCurrentRunning || Boolean(guidingQueueId)} title={isGuidingQueue ? ct('正在中止当前回复并发送这条消息', 'Stopping the current response and sending this message') : (isCurrentRunning ? ct(`暂停当前输出，立即发送消息${i + 1}`, `Pause the current output and send message ${i + 1}`) : ct('回复结束后会自动发送', 'This message will be sent after the response.'))}><Sparkles size={14}/>{isGuidingQueue ? ct('接管中…', 'Taking over…') : ct('引导发送', 'Send now')}</button>
                  <button className="oa-queue-action is-danger" type="button" onClick={()=>removeQueued(q.id)} title={ct('删除这条队列消息', 'Delete this queued message')} aria-label={ct('删除这条队列消息', 'Delete this queued message')}><Trash2 size={14}/></button>
                  <button className="oa-queue-action" type="button" onClick={()=>editQueued(q.id)} title={ct('编辑这条队列消息', 'Edit this queued message')} aria-label={ct('编辑这条队列消息', 'Edit this queued message')}><Edit3 size={14}/></button>
                </>}
              </div>
            </div>
          })}
        </div>}
        {cmdDrawer.open && <div className="oa-cmd-drawer" ref={cmdDrawerRef}>
          {filteredCmds.length === 0 && <div className="oa-cmd-item" style={{color:'var(--text-secondary)',justifyContent:'center',cursor:'default',padding:'12px 14px'}}>{ct('无匹配命令', 'No matching commands')}</div>}
          {filteredCmds.map((c,i)=>{
            return (
              <div key={c.cmd+i} ref={i===cmdDrawer.selectedIdx ? selectedCmdRef : null} className={`oa-cmd-item${i===cmdDrawer.selectedIdx?' selected':''}`} onMouseEnter={() => setCmdDrawer(d => ({ ...d, selectedIdx: i }))} onMouseDown={e=>{e.preventDefault();applySlashCommand(c,promptRef.current?.value ?? prompt)}}>
                <span className="oa-cmd-name">{c.cmd}</span>
                <span className="oa-cmd-desc">{c.desc}</span>
              </div>
            )
          })}
        </div>}
        {cmdManagerOpen && <div className="oa-cmd-manager-backdrop" onMouseDown={()=>setCmdManagerOpen(false)}>
          <div className="oa-cmd-manager" role="dialog" aria-modal="true" aria-label={ct('自定义斜杠命令', 'Custom slash commands')} onMouseDown={e=>e.stopPropagation()}>
            <div className="oa-cmd-manager-head">
              <div><h3>{ct('自定义斜杠命令', 'Custom slash commands')}</h3><p>{ct('官方命令只读锁定；用户命令可新增、编辑、删除。', 'Official commands are read-only; custom commands can be added, edited, and deleted.')}</p></div>
              <button className="oa-icon-btn" type="button" onClick={()=>setCmdManagerOpen(false)} title={ct('关闭', 'Close')}><X size={16}/></button>
            </div>
            <div className="oa-cmd-manager-actions">
              <button className="oa-guide-btn" type="button" onClick={()=>startEdit(-2, '/', '', '')}><Plus size={14}/>{ct('新增自定义命令', 'Add custom command')}</button>
              <span>{ct(`${(cfg?.slash_commands || []).filter(c => !isProtectedSlashCommand(c?.cmd)).length} 个自定义 · ${effectiveSlashCommands.length} 个官方`, `${(cfg?.slash_commands || []).filter(c => !isProtectedSlashCommand(c?.cmd)).length} custom · ${effectiveSlashCommands.length} official`)}</span>
            </div>
            {cmdEditIdx !== -1 && <div className="oa-cmd-edit-card">
              <input value={cmdEditCmd} onChange={e=>setCmdEditCmd(e.target.value)} placeholder={ct('命令，例如 /hello', 'Command, for example /hello')} autoFocus />
              <input value={cmdEditDesc} onChange={e=>setCmdEditDesc(e.target.value)} placeholder={ct('描述，例如 代码审查模板', 'Description, for example Code review template')} />
              <textarea value={cmdEditContent} onChange={e=>setCmdEditContent(e.target.value)} placeholder={ct('发送时展开成的指令内容。可用 {args} 插入 /命令 后面的参数。', 'Instruction content expanded on send. Use {args} for arguments after /command.')} rows={4}/>
              <button type="button" onClick={saveEdit}>{ct('保存', 'Save')}</button>
              <button type="button" onClick={()=>setCmdEditIdx(-1)}>{ct('取消', 'Cancel')}</button>
            </div>}
            <div className="oa-cmd-manager-list">
              <div className="oa-cmd-section-title">{ct('用户自定义', 'Custom')}</div>
              {(cfg?.slash_commands || []).filter(c => !isProtectedSlashCommand(c?.cmd)).length === 0 && <div className="oa-cmd-empty">{ct('暂无自定义命令，点击上方新增。', 'No custom commands. Use the button above to add one.')}</div>}
              {(cfg?.slash_commands || []).map((c, i) => {
                if (isProtectedSlashCommand(c?.cmd)) return null
                return <div className="oa-cmd-manage-row" key={`${c.cmd}-${i}`}>
                  <div><b>{c.cmd}</b><small>{c.desc || ct('无描述', 'No description')}</small>{(c.content || c.prompt) && <em>{c.content || c.prompt}</em>}</div>
                  <button type="button" onClick={()=>startEdit(i, c.cmd || '/', c.desc || '', c.content || c.prompt || '')}><Edit3 size={14}/>{ct('编辑', 'Edit')}</button>
                  <button type="button" onClick={()=>deleteCmd(i)}><Trash2 size={14}/>{ct('删除', 'Delete')}</button>
                </div>
              })}
              <div className="oa-cmd-section-title">{ct('官方命令', 'Official commands')}</div>
              {effectiveSlashCommands.map((c, i) => <div className="oa-cmd-manage-row is-locked" key={`${c.cmd}-${i}`}>
                <div><b>{c.cmd}</b><small>{c.desc || ct('官方命令', 'Official command')}</small></div>
                <span><Lock size={13}/>{ct('只读', 'Read-only')}</span>
              </div>)}
            </div>
          </div>
        </div>}
        {extraPromptOpen && <div className="oa-cmd-manager-backdrop" onMouseDown={()=>setExtraPromptOpen(false)}>
          <div className={`oa-cmd-manager oa-prompt-preset-dialog ${promptPresetManagerOpen ? 'is-managing' : 'is-picking'}`} role="dialog" aria-modal="true" aria-label={ct('系统提示预设', 'System-prompt presets')} onMouseDown={e=>e.stopPropagation()}>
            <div className="oa-cmd-manager-head">
              <div>
                <h3>{promptPresetManagerOpen ? ct('管理系统提示预设', 'Manage system-prompt presets') : ct('选择系统提示预设', 'Choose a system-prompt preset')}</h3>
                <p>{promptPresetManagerOpen ? ct('预设全局可用；已绑定会话会保留选择时的内容快照。', 'Presets are global; bound sessions keep a snapshot of the selected content.') : ct('每个会话可启用一个预设，运行 Agent 时动态追加。', 'Each session can enable one preset that is appended when the agent runs.')}</p>
              </div>
              <button className="oa-icon-btn" type="button" onClick={()=>setExtraPromptOpen(false)} title={ct('关闭', 'Close')}><X size={16}/></button>
            </div>
            {promptPresetManagerOpen ? <>
              <div className="oa-cmd-manager-actions">
                <button className="oa-guide-btn" type="button" onClick={()=>setExtraPromptDraft(items => [...items, createPromptPreset(items)])}><Plus size={14}/>{ct('新增预设', 'Add preset')}</button>
                <span>{ct(`${extraPromptDraft.length} 个预设`, `${extraPromptDraft.length} presets`)}</span>
              </div>
              <div className="oa-cmd-manager-list oa-prompt-preset-editor-list">
                {extraPromptDraft.length === 0 && <div className="oa-cmd-empty">{ct('暂无预设。新增后填写名称和提示内容。', 'No presets yet. Add one, then enter its name and prompt content.')}</div>}
                {extraPromptDraft.map((item, index) => <div className="oa-cmd-edit-card oa-prompt-preset-edit-card" key={item.id}>
                  <div className="oa-prompt-preset-edit-head">
                    <input value={item.name} onChange={e=>updateExtraPromptDraft(item.id, 'name', e.target.value)} placeholder={`${ct('预设名称', 'Preset name')} ${index + 1}`} aria-label={`${ct('预设名称', 'Preset name')} ${index + 1}`}/>
                    <code title={ct('稳定预设 ID', 'Stable preset ID')}>{item.id}</code>
                  </div>
                  <textarea value={item.content} onChange={e=>updateExtraPromptDraft(item.id, 'content', e.target.value)} placeholder={ct('输入追加到 Agent 系统提示中的内容', 'Enter content to append to the agent system prompt')} rows={5}/>
                  <button type="button" onClick={()=>setExtraPromptDraft(items => items.filter(preset => preset.id !== item.id))}><Trash2 size={14}/>{ct('删除', 'Delete')}</button>
                </div>)}
              </div>
              <div className="oa-cmd-manager-actions oa-prompt-preset-footer">
                <button className="oa-guide-btn" type="button" onClick={savePromptPresets} disabled={extraPromptSaving}>{extraPromptSaving ? ct('保存中…', 'Saving…') : ct('保存全局预设', 'Save global presets')}</button>
                <button type="button" onClick={()=>setPromptPresetManagerOpen(false)} disabled={extraPromptSaving}><ChevronLeft size={14}/>{ct('返回选择', 'Back to selection')}</button>
              </div>
            </> : <>
              <div className="oa-cmd-manager-actions">
                <span>{ct(`${promptPresets.length} 个可用预设`, `${promptPresets.length} presets available`)}</span>
                <button type="button" onClick={openPromptPresetManager}><Edit3 size={14}/>{ct('管理预设', 'Manage presets')}</button>
              </div>
              <div className="oa-cmd-manager-list oa-prompt-preset-picker" role="radiogroup" aria-label={ct('当前会话系统提示预设', 'Current session system-prompt preset')}>
                <label className={`oa-prompt-preset-option ${extraPromptSelection === '' ? 'is-selected' : ''}`}>
                  <input type="radio" name="extra-system-prompt-preset" value="" checked={extraPromptSelection === ''} onChange={()=>selectExtraPromptPreset('')}/>
                  <span className="oa-prompt-preset-radio"><Check size={13}/></span>
                  <span className="oa-prompt-preset-copy"><b>{ct('不使用预设', 'Do not use a preset')}</b><small>{ct('仅使用 Agent 默认系统提示', 'Use only the default agent system prompt')}</small></span>
                </label>
                {activePromptPreset.orphaned && <label className={`oa-prompt-preset-option is-orphaned ${extraPromptSelection === activePromptPreset.id ? 'is-selected' : ''}`}>
                  <input type="radio" name="extra-system-prompt-preset" value={activePromptPreset.id} checked={extraPromptSelection === activePromptPreset.id} onChange={()=>selectExtraPromptPreset(activePromptPreset.id)}/>
                  <span className="oa-prompt-preset-radio"><Check size={13}/></span>
                  <span className="oa-prompt-preset-copy"><b>{ct('已删除的预设', 'Deleted preset')}</b><small>{activePromptPreset.content || ct('当前会话仍保留原内容快照', 'This session still retains the original content snapshot')}</small></span>
                  <em>{ct('快照', 'Snapshot')}</em>
                </label>}
                {promptPresets.map(item => <label className={`oa-prompt-preset-option ${extraPromptSelection === item.id ? 'is-selected' : ''}`} key={item.id}>
                  <input type="radio" name="extra-system-prompt-preset" value={item.id} checked={extraPromptSelection === item.id} onChange={()=>selectExtraPromptPreset(item.id)}/>
                  <span className="oa-prompt-preset-radio"><Check size={13}/></span>
                  <span className="oa-prompt-preset-copy"><b>{item.name}</b><small>{item.content}</small></span>
                </label>)}
                {promptPresets.length === 0 && !activePromptPreset.orphaned && <div className="oa-cmd-empty">{ct('还没有预设。先进入“管理预设”新建一个。', 'No presets yet. Open Manage presets to create one.')}</div>}
              </div>
              <div className="oa-cmd-manager-actions oa-prompt-preset-footer">
                <button className="oa-guide-btn" type="button" onClick={saveExtraPromptSelection} disabled={extraPromptSaving}>{extraPromptSaving ? ct('应用中…', 'Applying…') : ct('应用到当前会话', 'Apply to current session')}</button>
                <button type="button" onClick={()=>setExtraPromptOpen(false)} disabled={extraPromptSaving}>{ct('取消', 'Cancel')}</button>
              </div>
            </>}
          </div>
        </div>}
        <div className={`oa-composer ${dragging ? 'is-dragging' : ''}`} onDragOver={e=>{e.preventDefault(); setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={onDropFiles}>
          <input ref={fileRef} type="file" multiple hidden onChange={e=>{ addAttachmentFiles(e.target.files); e.target.value='' }} />
          {attachments.length > 0 && <div className="oa-attach-preview">
            {attachments.map((attachment) => {
              const name = uploadFileName(attachment)
              const image = isImageFile(attachment)
              const visual = getFileVisual(name)
              const Icon = visual.Icon
              const extension = (name.match(/\.([^.]+)$/)?.[1] || 'FILE').slice(0, 6).toUpperCase()
              return <div className={`oa-attach-thumb ${image ? 'is-image' : `is-file oa-file-kind-${visual.kind}`}`} key={attachment.id} title={name}>
                {image ? <img src={uploadFileSource(attachment)} alt={name}/> : <div className="oa-attach-file-icon"><Icon size={25}/><small>{extension}</small></div>}
                <span>{image ? <FileImage size={12}/> : <Icon size={12}/>} {name}</span>
                <button type="button" onClick={()=>removeAttachment(attachment.id)} title={ct('移除附件', 'Remove attachment')} aria-label={ct(`移除附件 ${name}`, `Remove attachment ${name}`)}><X size={12}/></button>
              </div>
            })}
          </div>}
          {isUltraPlanPrompt && <div className="oa-ultraplan-mode" aria-live="polite"><span><Sparkles size={14}/>UltraPlan</span><b>{ct('将以规划模式执行，并在完成后展示 run 目录与日志摘要', 'Runs in planning mode and shows the run directory and log summary when complete')}</b></div>}
          <textarea ref={promptRef} value={prompt} onPaste={onPaste} onChange={handlePromptChange} onKeyDown={handlePromptKeyDown} placeholder={ct('向 GenericAgent 发送消息，可选择/粘贴/拖拽任意文件…', 'Message GenericAgent; select, paste, or drag any file…')} rows={1}/>
          <div className="oa-composer-bar">
            <button className="oa-attach-btn" type="button" onClick={()=>fileRef.current?.click()} title={ct('添加附件', 'Add attachment')}><Paperclip size={17}/><span>{ct('附件', 'Attachments')}</span></button>
            <button className={`oa-attach-btn ${cmdManagerOpen ? 'is-open' : ''}`} type="button" onClick={()=>setCmdManagerOpen(true)} title={ct('管理自定义斜杠命令', 'Manage custom slash commands')}><Sparkles size={16}/><span>{ct('命令', 'Commands')}</span></button>
            <button className={`oa-attach-btn ${extraPromptOpen || extraSysPromptPresetID ? 'is-open' : ''}`} type="button" onClick={openExtraPromptEditor} title={extraSysPromptPresetID ? ct(`当前预设：${activePromptPreset.name}`, `Current preset: ${activePromptPreset.name}`) : ct('选择本会话的系统提示预设', 'Choose a system-prompt preset for this session')}><Bot size={16}/><span>{ct('系统提示', 'System prompt')}{extraSysPromptPresetID ? ` · ${activePromptPreset.name}` : ''}</span></button>
            <ProviderModelCascade groups={providerGroups} selectedProvider={selectedProvider}
              value={selectedModelNo} disabled={!providerGroups.length}
              onChange={v=>saveModel(Number(v))} />
            <div className="oa-model-select oa-effort-select"><span>{ct('推理', 'Reasoning')}</span>
              <CustomSelect value={reasoningEffort} onChange={v=>saveReasoningEffort(v)}
                options={REASONING_EFFORT_OPTIONS.map(option => option.value === 'off' ? { ...option, label: ct('默认', 'Default') } : option)} />
            </div>
            <button className="oa-send" type="button" disabled={!prompt.trim() && !attachments.length} onClick={() => send()} title={isCurrentRunning ? ct('加入发送队列', 'Add to send queue') : ct('发送', 'Send')} aria-label={isCurrentRunning ? ct('加入发送队列', 'Add to send queue') : ct('发送', 'Send')}><Send size={17}/></button>
            {isCurrentRunning && <button className="oa-stop" type="button" onClick={()=>cancelRun(sid)} title={ct('停止生成', 'Stop generating')} aria-label={ct('停止生成', 'Stop generating')}><Square size={14}/></button>}
          </div>
        </div>
        <p>{ct('Enter 发送 · Shift + Enter 换行 · 回复中发送会排队', 'Enter to send · Shift + Enter for a new line · Messages queue while responding')}</p>
      </footer>
    </main>

    {worldlineRestorePicker && worldlineRestorePicker.sessionID === sid && <WorldlineRestoreDialog nodes={worldlineRestorePicker.nodes} onClose={()=>setWorldlineRestorePicker(null)} onSelect={selectWorldlineRestoreNode}/>}
    {sessionManagerOpen && <div className="oa-session-manager-backdrop" onMouseDown={e=>{ if (e.target === e.currentTarget) closeSessionManager() }}>
      <section className="oa-session-manager-modal" role="dialog" aria-modal="true" aria-labelledby="oa-session-manager-dialog-title" onMouseDown={e=>e.stopPropagation()}>
        <header className="oa-session-manager-dialog-head">
          <div>
            <h2 id="oa-session-manager-dialog-title">{ct('管理历史会话', 'Manage session history')}</h2>
            <p>{ct('选择不再需要的会话并批量删除', 'Select sessions you no longer need and delete them in a batch')}</p>
          </div>
          <button className="oa-icon-btn" type="button" onClick={closeSessionManager} disabled={batchDeleting} aria-label={ct('关闭会话管理', 'Close session manager')} autoFocus><X size={17}/></button>
        </header>
        <div className="oa-session-manager-toolbar">
          <button className="oa-session-dialog-select-all" type="button" role="checkbox" aria-checked={allSessionsSelected ? true : (selectedSessionCount ? 'mixed' : false)} onClick={toggleAllSessions} disabled={!sessions.length || batchDeleting}>
            <span className={`oa-session-check ${allSessionsSelected ? 'is-checked' : ''} ${!allSessionsSelected && selectedSessionCount ? 'is-partial' : ''}`}>{allSessionsSelected && <Check size={12}/>}</span>
            <span>{allSessionsSelected ? ct('取消全选', 'Clear selection') : ct('全选', 'Select all')}</span>
          </button>
          <span className="oa-session-dialog-count">{ct(`已选 ${selectedSessionCount} / ${sessions.length}`, `${selectedSessionCount} / ${sessions.length} selected`)}</span>
        </div>
        <div className="oa-session-manager-dialog-list">
          {sessions.map(s => {
            const selected = selectedSessionIdSet.has(s.id)
            return <button key={s.id} className={`oa-session-manager-dialog-row ${selected ? 'is-selected' : ''}`} type="button" role="checkbox" aria-checked={selected} onClick={()=>toggleSessionSelection(s.id)} disabled={batchDeleting}>
              <span className={`oa-session-check ${selected ? 'is-checked' : ''}`}>{selected && <Check size={12}/>}</span>
              <span className="oa-session-dialog-copy">
                <span className="oa-session-dialog-title">{s.running && <i className="oa-session-running-dot" aria-hidden="true"/>}<b>{shortTitle(s)}</b>{s.id === sid && <em>{ct('当前', 'Current')}</em>}</span>
                <small><Clock3 size={12}/>{fmtTime(s.updated_at) || ct('刚刚', 'Just now')} · {ct(`${s.count || 0} 条`, `${s.count || 0} messages`)}{s.running && <span>{ct('运行中', 'Running')}</span>}</small>
              </span>
            </button>
          })}
          {!sessions.length && <div className="oa-session-manager-dialog-empty">{ct('暂无历史会话', 'No session history')}</div>}
        </div>
        <footer className="oa-session-manager-dialog-foot">
          <small>{ct('删除后无法恢复', 'Deleted sessions cannot be recovered')}</small>
          <div>
            <button className="oa-session-dialog-cancel" type="button" onClick={closeSessionManager} disabled={batchDeleting}>{ct('取消', 'Cancel')}</button>
            <button className="oa-session-dialog-delete" type="button" onClick={deleteSelectedSessions} disabled={!selectedSessionCount || batchDeleting}>
              <Trash2 size={15}/><span>{batchDeleting ? ct('正在删除…', 'Deleting…') : ct(`删除所选${selectedSessionCount ? ` (${selectedSessionCount})` : ''}`, `Delete selected${selectedSessionCount ? ` (${selectedSessionCount})` : ''}`)}</span>
            </button>
          </div>
        </footer>
      </section>
    </div>}
  </div>
}
