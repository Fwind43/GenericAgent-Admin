import { memo, useMemo, useId, useCallback, useRef, useState, useEffect, useLayoutEffect } from 'react'
import { textRenderStats, splitMarkdownParts, MARKDOWN_BLOCK_LIMIT, LIST_ITEM_LIMIT, previewLongText } from '../lib/chatTextSafety'
import { normalizeToolParts, prepareMarkdownParts, isMermaidFence, segmentMarkdownText } from './markdownParts.js'
import { CopyButton } from './CopyButton.jsx'
import { ct, chatLocale, chatLanguage } from './chatFormat.js'
import { InlineMarkdown, MathFormula } from './InlineMarkdown.jsx'
import { getFileVisual } from './uploadFiles.js'
import { confirmDanger, showAppAlert } from '../lib/danger'
import { api } from '../lib/api'
import FilePreviewLink from '../components/FilePreviewLink'
import FileDownloadLink from '../components/FileDownloadLink'
import { Download, ExternalLink, FolderOpen, Hand, ZoomOut, ZoomIn, Maximize2, X, Maximize } from 'lucide-react'
import { parseBlocks } from '../lib/markdown.js'
import { ToolCallBlock } from './ToolCallBlock.jsx'
import { renderMermaidSvg } from './mermaidRender.js'
import { createPortal } from 'react-dom'

export function LongTextPreview({ text = '', stats }) {
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

export function FileAttachment({ path }) {
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
    if (!await confirmDanger('chat-file-open', ct(`使用系统桌面打开${mode === 'folder' ? '文件所在位置' : '文件'}：${clean}？`, `Open ${mode === 'folder' ? 'the containing folder' : 'this file'} in the desktop system: ${clean}?`))) return
    try {
      await api('/api/files/open', { dangerous:true, method:'POST', body: JSON.stringify({ path: clean, mode }) })
    } catch (e) {
      await showAppAlert(ct(`\u6253\u5f00\u5931\u8d25\uff1a${e?.message || e}`, `Open failed: ${e?.message || e}`), { operation: 'chat-file-open' })
    }
  }
  return <span className={`oa-file-card oa-file-kind-${kind}`} title={clean}>
    <button type="button" className="oa-file-leading" onClick={() => open('file')} aria-label={ct(`打开文件 ${name}`, `Open file ${name}`)}>
      <Icon className="oa-file-fallback-icon" size={19}/>
      {isImage && <img src={imageUrl} alt="" loading="lazy" onError={(e)=>{ e.currentTarget.style.display='none' }} />}
    </button>
    <span className="oa-file-meta">
      <span className="oa-file-name-row"><FilePreviewLink className="oa-file-name-link" href={`/api/files/download?path=${encodeURIComponent(clean)}`} download={name} title={ct(`预览文件 ${name}`, `Preview file ${name}`)}><b>{name}</b></FilePreviewLink></span>
      <span className="oa-file-detail"><small>{extension}</small><em title={directory}>{directory || ct('本地文件', 'Local file')}</em></span>
    </span>
    <span className="oa-file-actions">
      <FileDownloadLink href={`/api/files/download?path=${encodeURIComponent(clean)}`} download={name} title={ct('下载文件', 'Download file')} aria-label={ct(`下载文件 ${name}`, `Download file ${name}`)}><Download size={15}/></FileDownloadLink>
      <button type="button" onClick={() => open('file')} title={ct('打开文件', 'Open file')} aria-label={ct(`打开文件 ${name}`, `Open file ${name}`)}><ExternalLink size={15}/></button>
      <button type="button" onClick={() => open('folder')} title={ct('打开所在位置', 'Open containing folder')} aria-label={ct(`打开 ${name} 所在位置`, `Open containing folder for ${name}`)}><FolderOpen size={15}/></button>
      <CopyButton text={clean} compact label={ct('复制路径', 'Copy path')} copiedLabel={ct('路径已复制', 'Path copied')} />
    </span>
  </span>
}

function InlineRichText({ text = '', runs }) {
  if (runs) {
    return <>{runs.map((run, i) => run.type === 'file'
      ? <FileAttachment key={i} path={run.path} />
      : <InlineMarkdown key={i} nodes={run.nodes} />)}</>
  }
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

function MermaidDiagram({ source = '' }) {
  const cardRef = useRef(null)
  const hostRef = useRef(null)
  const dragRef = useRef(null)
  const fullscreenTriggerRef = useRef(null)
  const bindFunctionsRef = useRef(null)
  const [colorScheme, setColorScheme] = useState(() => globalThis.document?.documentElement?.dataset?.colorScheme || 'light')
  const [state, setState] = useState({ status: 'loading', svg: '', error: '' })
  const [mode, setMode] = useState('diagram')
  const [panEnabled, setPanEnabled] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fullscreenPlaceholderHeight, setFullscreenPlaceholderHeight] = useState(0)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })

  const resetView = useCallback(() => {
    dragRef.current = null
    setDragging(false)
    setView({ scale: 1, x: 0, y: 0 })
  }, [])

  const changeZoom = useCallback((step) => {
    setView(current => ({
      ...current,
      scale: Math.min(3, Math.max(.5, Number((current.scale + step).toFixed(2)))),
    }))
  }, [])

  useEffect(() => {
    const root = globalThis.document?.documentElement
    if (!root || typeof globalThis.MutationObserver !== 'function') return undefined
    const observer = new globalThis.MutationObserver(() => {
      setColorScheme(root.dataset.colorScheme || 'light')
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-color-scheme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let active = true
    bindFunctionsRef.current = null
    resetView()
    setState({ status: 'loading', svg: '', error: '' })
    renderMermaidSvg(source, colorScheme).then(({ svg, bindFunctions }) => {
      if (!active) return
      bindFunctionsRef.current = bindFunctions || null
      setState({ status: 'ready', svg, error: '' })
    }).catch(error => {
      if (!active) return
      setState({ status: 'error', svg: '', error: String(error?.message || error || ct('未知错误', 'Unknown error')) })
    })
    return () => { active = false }
  }, [source, colorScheme, resetView])

  const showingSource = mode === 'source' || state.status === 'error'

  useLayoutEffect(() => {
    if (!showingSource && state.status === 'ready' && hostRef.current && bindFunctionsRef.current) {
      bindFunctionsRef.current(hostRef.current)
    }
  }, [showingSource, state.status, state.svg, isFullscreen])

  const closeFullscreen = useCallback(() => {
    setIsFullscreen(false)
    globalThis.requestAnimationFrame?.(() => fullscreenTriggerRef.current?.focus())
  }, [])

  const openFullscreen = useCallback(() => {
    setFullscreenPlaceholderHeight(cardRef.current?.getBoundingClientRect?.().height || 0)
    setIsFullscreen(true)
  }, [])

  useEffect(() => {
    if (!isFullscreen) return undefined
    globalThis.requestAnimationFrame?.(() => fullscreenTriggerRef.current?.focus())
    const previousOverflow = globalThis.document?.body?.style?.overflow || ''
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeFullscreen()
    }
    globalThis.document?.addEventListener('keydown', closeOnEscape)
    if (globalThis.document?.body) globalThis.document.body.style.overflow = 'hidden'
    return () => {
      globalThis.document?.removeEventListener('keydown', closeOnEscape)
      if (globalThis.document?.body) globalThis.document.body.style.overflow = previousOverflow
    }
  }, [closeFullscreen, isFullscreen])

  const finishDrag = useCallback((event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  const handlePointerDown = useCallback((event) => {
    if (!panEnabled || state.status !== 'ready' || event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y }
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }, [panEnabled, state.status, view.x, view.y])

  const handlePointerMove = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setView(current => ({
      ...current,
      x: drag.x + event.clientX - drag.clientX,
      y: drag.y + event.clientY - drag.clientY,
    }))
    event.preventDefault()
  }, [])

  const controlsDisabled = state.status !== 'ready' || showingSource

  const card = <div ref={cardRef} className={`oa-mermaid-card ${state.status === 'error' ? 'is-error' : ''} ${isFullscreen ? 'is-fullscreen' : ''}`}>
    <div className="oa-code-head oa-mermaid-head">
      <div className="oa-mermaid-modes" role="group" aria-label={ct('Mermaid 显示模式', 'Mermaid display mode')}>
        <button type="button" className={showingSource ? '' : 'is-active'} aria-pressed={!showingSource} onClick={() => setMode('diagram')} disabled={state.status === 'error'}>{ct('图表', 'Diagram')}</button>
        <button type="button" className={showingSource ? 'is-active' : ''} aria-pressed={showingSource} onClick={() => setMode('source')}>{ct('源码', 'Source')}</button>
      </div>
      <div className="oa-mermaid-tools">
        <button type="button" className={`oa-mermaid-tool ${panEnabled ? 'is-active' : ''}`} aria-label={ct('平移模式', 'Pan mode')} aria-pressed={panEnabled} title={ct('平移模式', 'Pan mode')} disabled={controlsDisabled} onClick={() => setPanEnabled(value => !value)}><Hand size={14} /></button>
        <button type="button" className="oa-mermaid-tool" aria-label={ct('缩小', 'Zoom out')} title={ct('缩小', 'Zoom out')} disabled={controlsDisabled || view.scale <= .5} onClick={() => changeZoom(-.2)}><ZoomOut size={14} /></button>
        <span className="oa-mermaid-scale" aria-label={ct('当前缩放比例', 'Current zoom')}>{Math.round(view.scale * 100)}%</span>
        <button type="button" className="oa-mermaid-tool" aria-label={ct('放大', 'Zoom in')} title={ct('放大', 'Zoom in')} disabled={controlsDisabled || view.scale >= 3} onClick={() => changeZoom(.2)}><ZoomIn size={14} /></button>
        <button type="button" className="oa-mermaid-tool" aria-label={ct('复位视图', 'Reset view')} title={ct('复位视图', 'Reset view')} disabled={controlsDisabled} onClick={resetView}><Maximize2 size={14} /></button>
        <button ref={fullscreenTriggerRef} type="button" className="oa-mermaid-tool" aria-label={isFullscreen ? ct('退出全屏', 'Exit fullscreen') : ct('全屏查看', 'View fullscreen')} title={isFullscreen ? ct('退出全屏', 'Exit fullscreen') : ct('全屏查看', 'View fullscreen')} disabled={state.status !== 'ready'} onClick={isFullscreen ? closeFullscreen : openFullscreen}>{isFullscreen ? <X size={14} /> : <Maximize size={14} />}</button>
        <CopyButton text={source} compact />
      </div>
    </div>
    {!showingSource && state.status === 'loading' && <div className="oa-mermaid-status" role="status">{ct('正在绘制图表…', 'Rendering diagram…')}</div>}
    {!showingSource && state.status === 'ready' && <div
      className={`oa-mermaid-viewport ${panEnabled ? 'is-pan-enabled' : ''} ${dragging ? 'is-dragging' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={() => { dragRef.current = null; setDragging(false) }}
    >
      <div
        ref={hostRef}
        className="oa-mermaid-diagram"
        role="img"
        aria-label={ct('Mermaid 图表', 'Mermaid diagram')}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    </div>}
    {state.status === 'error' && <div className="oa-mermaid-error" role="alert">{ct('图表语法无效，已显示源码：', 'Invalid diagram syntax; showing source:')} {state.error}</div>}
    {showingSource && <pre className="oa-mermaid-source"><code>{source}</code></pre>}
  </div>

  if (!isFullscreen) return card
  return <>
    <div className="oa-mermaid-fullscreen-placeholder" aria-hidden="true" style={{ height: fullscreenPlaceholderHeight }} />
    {createPortal(<div className="oa-mermaid-fullscreen" role="dialog" aria-modal="true" aria-label={ct('Mermaid 图表全屏查看', 'Mermaid diagram fullscreen view')}>
      {card}
    </div>, globalThis.document.body)}
  </>
}

function CodeBlockCard({ lang = '', filename = '', text = '' }) {
  const { Icon, kind } = getFileVisual(filename || (lang ? `file.${lang}` : 'file'))
  const onDownload = useCallback((e) => {
    e?.stopPropagation?.()
    if (!text) return
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || `snippet.${lang || 'txt'}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [text, filename, lang])

  return <div className="oa-code-card">
    <div className="oa-code-head">
      <div className="oa-code-head-meta">
        {filename ? <>
          <span className={`oa-code-file-icon oa-file-kind-${kind}`}>
            <Icon size={14} />
          </span>
          <span className="oa-code-filename" title={filename}>{filename}</span>
          {lang && <span className="oa-code-lang-badge">{lang}</span>}
        </> : <span>{lang || ct('代码', 'Code')}</span>}
      </div>
      <div className="oa-code-actions">
        {filename && <button type="button" className="oa-code-action-btn" onClick={onDownload} title={ct(`下载为 ${filename}`, `Download as ${filename}`)}>
          <Download size={13} />
          <span>{ct('下载', 'Download')}</span>
        </button>}
        <CopyButton text={text} compact />
      </div>
    </div>
    <pre><code>{text}</code></pre>
  </div>
}

export const MarkdownBlock = memo(function MarkdownBlock({ text = '', onAskReply }) {
  const stats = useMemo(() => textRenderStats(text), [text])
  const parts = useMemo(() => stats.tooLarge ? [] : normalizeToolParts(splitMarkdownParts(text)).slice(0, MARKDOWN_BLOCK_LIMIT), [text, stats.tooLarge])
  const footnoteScope = `oa${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const prepared = useMemo(() => prepareMarkdownParts(parts, footnoteScope), [parts, footnoteScope])
  if (stats.tooLarge) return <div className="oa-md"><LongTextPreview text={text} stats={stats} /></div>
  return <div className="oa-md">
    {prepared.parts.map((p, idx) => p.type === 'code'
      ? isMermaidFence(p.lang)
        ? p.closed
          ? <MermaidDiagram key={idx} source={p.text} />
          : <div className="oa-mermaid-card" key={idx}>
            <div className="oa-code-head"><span>Mermaid</span><CopyButton text={p.text} compact /></div>
            <div className="oa-mermaid-status oa-mermaid-stream-note" role="status">{ct('正在接收图表内容，完成后将自动渲染', 'Receiving diagram source; it will render when complete')}</div>
            <pre className="oa-mermaid-source"><code>{p.text}</code></pre>
          </div>
        : <CodeBlockCard key={idx} lang={p.lang} filename={p.filename} text={p.text} />
      : p.type === 'tool'
        ? null  // Skip tool parts - rendered via parsed.tools in AssistantContent
        : <TextMarkdown key={idx} text={p.text} prepared={p.prepared} onAskReply={onAskReply}/>) }
    {parts.length >= MARKDOWN_BLOCK_LIMIT && <div className="oa-md-truncated">{ct(`内容块过多，仅渲染前 ${MARKDOWN_BLOCK_LIMIT} 块，可复制消息查看完整内容。`, `Too many content blocks. Only the first ${MARKDOWN_BLOCK_LIMIT} are rendered; copy the message to view everything.`)}</div>}
    <FootnotesSection items={prepared.footnotes} />
  </div>
})

function MarkdownTable({ table }) {
  return <div className="oa-table-wrap">
    <table className="oa-md-table">
      <thead><tr>{table.head.map((cell, i) => <th key={i} style={{ textAlign: table.aligns[i] || 'left' }}><InlineRichText text={cell} runs={table.headRuns?.[i]} /></th>)}</tr></thead>
      <tbody>{table.rows.map((row, r) => <tr key={r}>{table.head.map((_, c) => <td key={c} style={{ textAlign: table.aligns[c] || 'left' }}><InlineRichText text={row[c] || ''} runs={table.rowRuns?.[r]?.[c]} /></td>)}</tr>)}</tbody>
    </table>
  </div>
}

// A tight item renders its first paragraph inline so single-line bullets do not
// gain paragraph margins; anything richer falls back to full block rendering.
function ListItemBody({ item, tight }) {
  const blocks = item.blocks || []
  if (!blocks.length) return null
  if (tight && blocks[0].type === 'paragraph') {
    return <>
      <InlineRichText text={blocks[0].text} runs={blocks[0].runs} />
      {blocks.length > 1 && <MarkdownNodes blocks={blocks.slice(1)} />}
    </>
  }
  return <MarkdownNodes blocks={blocks} />
}

function MarkdownList({ list }) {
  const Tag = list.ordered ? 'ol' : 'ul'
  const items = list.items.slice(0, LIST_ITEM_LIMIT)
  const hidden = Math.max(0, list.items.length - items.length)
  const isTaskList = items.some(item => item.checked !== null)
  const className = [
    'oa-list',
    list.ordered ? 'oa-list-ordered' : 'oa-list-unordered',
    list.tight ? 'oa-list-tight' : 'oa-list-loose',
    isTaskList ? 'oa-list-task' : '',
  ].filter(Boolean).join(' ')
  return <Tag className={className} start={list.ordered && list.start !== 1 ? list.start : undefined}>
    {items.map((item, i) => <li key={i} className={item.checked === null ? undefined : `oa-task-item${item.checked ? ' is-done' : ''}`}>
      {item.checked !== null && <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} aria-hidden="true" />}
      <ListItemBody item={item} tight={list.tight} />
    </li>)}
    {hidden > 0 && <li className="oa-md-truncated">{ct(`… 已隐藏 ${hidden.toLocaleString(chatLocale())} 个列表项`, `… ${hidden.toLocaleString(chatLocale())} list items hidden`)}</li>}
  </Tag>
}

const MarkdownNode = memo(function MarkdownNode({ block }) {
  if (block.type === 'paragraph') return <p><InlineRichText text={block.text} runs={block.runs} /></p>
  if (block.type === 'heading') {
    const Tag = `h${block.depth}`
    return <Tag><InlineRichText text={block.text} runs={block.runs} /></Tag>
  }
  if (block.type === 'hr') return <hr />
  if (block.type === 'math') return <MathFormula value={block.value} display block />
  if (block.type === 'table') return <MarkdownTable table={block} />
  if (block.type === 'list') return <MarkdownList list={block} />
  if (block.type === 'blockquote') return <blockquote className="oa-md-quote"><MarkdownNodes blocks={block.blocks} /></blockquote>
  if (block.type === 'footnotes') return <FootnotesSection items={block.items} />
  return null
}, (prev, next) => prev.language === next.language && prev.signature === next.signature)

function MarkdownNodes({ blocks = [] }) {
  const language = chatLanguage()
  // Parsing still sees the whole document: late footnotes can change earlier runs.
  // Compare the complete plain AST, not just source text, to reuse stable blocks.
  return <>{blocks.map((block, i) => <MarkdownNode key={i} block={block} language={language} signature={JSON.stringify(block)} />)}</>
}

function FootnotesSection({ items = [] }) {
  if (!items || !items.length) return null
  return (
    <div className="oa-md-footnotes">
      <hr className="oa-md-footnotes-sep" />
      <ol className="oa-md-footnotes-list">
        {items.map((item) => (
          <li key={item.footnoteId} id={item.footnoteId} className="oa-md-footnote-item">
            <span className="oa-md-footnote-body">
              <InlineRichText text={item.text} runs={item.runs} />
            </span>
            {item.refIds.map((refId, idx) => (
              <a key={refId} href={`#${refId}`} className="oa-md-footnote-backref" title={ct(`返回引用 ${idx + 1}`, `Back to reference ${idx + 1}`)} aria-label={ct(`返回引用 ${idx + 1}`, `Back to reference ${idx + 1}`)}>
                &#x21a9;&#xfe0e;{item.refIds.length > 1 ? idx + 1 : ''}
              </a>
            ))}
          </li>
        ))}
      </ol>
    </div>
  )
}

function TextMarkdown({ text = '', prepared, onAskReply }) {
  const parsedText = useMemo(() => {
    if (prepared) return prepared
    const parsed = segmentMarkdownText(text)
    return {
      ...parsed,
      segments: parsed.segments.map(seg => seg.type === 'prose' ? { ...seg, blocks: parseBlocks(seg.text) } : seg),
    }
  }, [text, prepared])
  const { segments, hidden } = parsedText
  return <>
    {segments.map((seg, i) => seg.type === 'tool'
      ? <ToolCallBlock key={i} call={seg.call} onAskReply={onAskReply} />
      : <MarkdownNodes key={i} blocks={seg.blocks} />)}
    {hidden > 0 && <div className="oa-md-truncated">{ct(`… 已隐藏 ${hidden.toLocaleString(chatLocale())} 个内容块，可复制消息查看完整内容。`, `… ${hidden.toLocaleString(chatLocale())} content blocks hidden; copy the message to view all.`)}</div>}
  </>
}
