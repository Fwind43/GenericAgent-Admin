import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import FileDownloadLink from './FileDownloadLink'
import { fileDownloadTarget } from '../lib/fileDownload'
import { parseBlocks, parseInline } from '../lib/markdown'
import { splitMarkdownParts } from '../lib/chatTextSafety'

const copy = {
  close: '\u5173\u95ed',
  download: '\u4e0b\u8f7d',
  loading: '\u6b63\u5728\u52a0\u8f7d\u9884\u89c8\u2026',
  rendered: 'Markdown \u9884\u89c8',
  source: '\u6e90\u7801',
}

export function previewKind(name) {
  const ext = name.split('.').pop().toLowerCase()
  if (['html', 'htm'].includes(ext)) return 'html'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'].includes(ext)) return 'image'
  if (['txt', 'md', 'markdown', 'json', 'csv', 'log', 'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'css', 'xml', 'yaml', 'yml', 'svg'].includes(ext)) return 'text'
  return 'unsupported'
}

const isMarkdownName = (name = '') => /\.(?:md|markdown)$/i.test(name)
const limit = 10 * 1024 * 1024
const isolation = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">'
const emphasisTags = { strong: 'strong', em: 'em', del: 'del' }

function PreviewInline({ text = '', nodes }) {
  const parsed = nodes || parseInline(text)
  return <>{parsed.map((node, index) => {
    if (node.type === 'text') return <span key={index}>{node.value}</span>
    if (node.type === 'code') return <code key={index}>{node.value}</code>
    if (node.type === 'br') return <br key={index} />
    if (node.type === 'math') return <code key={index} className="file-preview-math">{node.value}</code>
    if (node.type === 'image') return <span key={index} className="file-preview-image-placeholder">{`[image: ${node.alt || node.src || ''}]`}</span>
    if (node.type === 'link') {
      if (!node.href) return <PreviewInline key={index} nodes={node.children} />
      const external = /^(?:https?:|mailto:)/i.test(node.href)
      return <a key={index} href={node.href} title={node.title || undefined} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}><PreviewInline nodes={node.children} /></a>
    }
    if (node.type === 'footnote_ref') return <sup key={index}>{`[${node.label}]`}</sup>
    const Tag = emphasisTags[node.type]
    return Tag ? <Tag key={index}><PreviewInline nodes={node.children} /></Tag> : null
  })}</>
}

function PreviewBlocks({ blocks = [] }) {
  return <>{blocks.map((block, index) => {
    if (block.type === 'paragraph') return <p key={index}><PreviewInline text={block.text} /></p>
    if (block.type === 'heading') {
      const Tag = `h${block.depth}`
      return <Tag key={index}><PreviewInline text={block.text} /></Tag>
    }
    if (block.type === 'hr') return <hr key={index} />
    if (block.type === 'math') return <pre key={index} className="file-preview-math-block"><code>{block.value}</code></pre>
    if (block.type === 'blockquote') return <blockquote key={index}><PreviewBlocks blocks={block.blocks} /></blockquote>
    if (block.type === 'table') return <div key={index} className="file-preview-table-wrap"><table><thead><tr>{block.head.map((cell, cellIndex) => <th key={cellIndex} style={{ textAlign: block.aligns[cellIndex] }}><PreviewInline text={cell} /></th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{block.head.map((_, cellIndex) => <td key={cellIndex} style={{ textAlign: block.aligns[cellIndex] }}><PreviewInline text={row[cellIndex] || ''} /></td>)}</tr>)}</tbody></table></div>
    if (block.type === 'list') {
      const Tag = block.ordered ? 'ol' : 'ul'
      return <Tag key={index} start={block.ordered && block.start !== 1 ? block.start : undefined}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item.checked !== null && <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} aria-hidden="true" />}<PreviewBlocks blocks={item.blocks} /></li>)}</Tag>
    }
    if (block.type === 'footnotes') return <section key={index} className="file-preview-footnotes"><hr /><ol>{block.items.map((item, itemIndex) => <li key={itemIndex}><PreviewBlocks blocks={parseBlocks(item.text)} /></li>)}</ol></section>
    return null
  })}</>
}

function MarkdownPreview({ text }) {
  const parts = useMemo(() => splitMarkdownParts(text).map(part => part.type === 'text' ? { ...part, blocks: parseBlocks(part.text) } : part), [text])
  return <article className="file-preview-markdown">{parts.map((part, index) => part.type === 'code'
    ? <div className="file-preview-code" key={index}>{(part.filename || part.lang) && <div className="file-preview-code-label">{part.filename || part.lang}</div>}<pre><code>{part.text}</code></pre></div>
    : <PreviewBlocks key={index} blocks={part.blocks} />)}</article>
}

function Preview({ href, name, close }) {
  const dialog = useRef(null)
  const [state, setState] = useState({ loading: true })
  const [markdownMode, setMarkdownMode] = useState('rendered')
  const kind = previewKind(name)
  const markdown = isMarkdownName(name)
  useEffect(() => {
    if (dialog.current.showModal) dialog.current.showModal()
    else dialog.current.setAttribute('open', '')
    const controller = new AbortController()
    let objectUrl
    const load = async () => {
      if (kind === 'unsupported') { setState({ message: '\u6b64\u683c\u5f0f\u6682\u4e0d\u652f\u6301\u7f51\u9875\u9884\u89c8\uff0c\u8bf7\u4e0b\u8f7d\u540e\u6253\u5f00\u3002' }); return }
      try {
        const target = fileDownloadTarget(href)
        if (!target) throw new Error('\u65e0\u6548\u7684\u6587\u4ef6\u94fe\u63a5')
        const response = await fetch(target.href, { credentials: 'same-origin', redirect: 'error', signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (Number(response.headers.get('Content-Length')) > limit) { controller.abort(); throw new Error('\u6587\u4ef6\u8d85\u8fc710MB\u9884\u89c8\u9650\u5236\uff0c\u8bf7\u4e0b\u8f7d\u67e5\u770b') }
        const reader = response.body.getReader()
        const parts = []
        let size = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > limit) { await reader.cancel(); throw new Error('\u6587\u4ef6\u8d85\u8fc710MB\u9884\u89c8\u9650\u5236\uff0c\u8bf7\u4e0b\u8f7d\u67e5\u770b') }
          parts.push(value)
        }
        const blob = new Blob(parts, { type: kind === 'image' ? response.headers.get('Content-Type') || 'application/octet-stream' : 'text/plain' })
        if (kind === 'image') {
          objectUrl = URL.createObjectURL(blob)
          if (!controller.signal.aborted) setState({ url: objectUrl })
        } else {
          const text = await blob.text()
          if (!controller.signal.aborted) setState({ text })
        }
      } catch (error) {
        if (error.name !== 'AbortError') setState({ message: `\u65e0\u6cd5\u9884\u89c8\uff1a${error.message}` })
      }
    }
    load()
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [href, kind])
  return createPortal(<dialog ref={dialog} className="file-preview-dialog" onCancel={close} aria-label={`\u6587\u4ef6\u9884\u89c8 ${name}`}>
    <header className="file-preview-header">
      <strong title={name}>{name}</strong>
      <div className="file-preview-actions">
        <FileDownloadLink href={href} download={name}>{copy.download}</FileDownloadLink>
        <button type="button" onClick={close}>{copy.close}</button>
      </div>
    </header>
    {markdown && state.text !== undefined && <nav className="file-preview-modes" aria-label="Markdown view mode">
      <button type="button" className={markdownMode === 'rendered' ? 'is-active' : ''} aria-pressed={markdownMode === 'rendered'} onClick={() => setMarkdownMode('rendered')}>{copy.rendered}</button>
      <button type="button" className={markdownMode === 'source' ? 'is-active' : ''} aria-pressed={markdownMode === 'source'} onClick={() => setMarkdownMode('source')}>{copy.source}</button>
    </nav>}
    <div className="file-preview-body">
      {state.loading && <p role="status">{copy.loading}</p>}
      {state.message && <p role="status">{state.message}</p>}
      {kind === 'html' && state.text !== undefined && <div className="file-preview-html"><p>\u9694\u79bb\u9884\u89c8\uff1a\u5141\u8bb8\u5185\u8054\u811a\u672c\uff0c\u5916\u90e8\u8d44\u6e90\u548c\u7f51\u7edc\u8bf7\u6c42\u5df2\u7981\u7528\u3002</p><iframe title={name} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={isolation + state.text} /></div>}
      {kind === 'text' && state.text !== undefined && (markdown && markdownMode === 'rendered' ? <MarkdownPreview text={state.text} /> : <pre className="file-preview-source">{state.text}</pre>)}
      {kind === 'image' && state.url && <img className="file-preview-image" src={state.url} alt={name} onError={() => setState({ message: '\u56fe\u7247\u683c\u5f0f\u65e0\u6cd5\u9884\u89c8\uff0c\u8bf7\u4e0b\u8f7d\u67e5\u770b\u3002' })} />}
    </div>
  </dialog>, document.body)
}

export default function FilePreviewLink({ href, download, children, onClick, ...props }) {
  const [open, setOpen] = useState(false)
  const name = download || fileDownloadTarget(href)?.name || '\u6587\u4ef6'
  return <><a {...props} href={href} download={name} onClick={event => { onClick?.(event); if (event.defaultPrevented) return; event.preventDefault(); event.stopPropagation(); setOpen(true) }}>{children}</a>{open && <Preview href={href} name={name} close={() => setOpen(false)} />}</>
}
