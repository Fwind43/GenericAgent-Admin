import { parseInline, resolveMarkdownLink, resolveMarkdownImageUrl } from '../lib/markdown.js'
import { ct } from './chatFormat.js'
import { useState, useMemo } from 'react'
import { fileDownloadTarget } from '../lib/fileDownload.js'
import FilePreviewLink from '../components/FilePreviewLink'
import { confirmDanger, showAppAlert } from '../lib/danger'
import { api } from '../lib/api'
import { ExternalLink, FolderOpen, Download } from 'lucide-react'
import katex from 'katex'

// Raw HTML stays escaped by React; parseInline only recognises <br> and
// <autolink> shapes. Hrefs arrive pre-sanitised by safeUrl().
const INLINE_EMPHASIS_TAGS = { strong: 'strong', em: 'em', del: 'del' }

export function MathFormula({ value = '', display = false, block = false }) {
  const html = useMemo(() => katex.renderToString(value, {
    displayMode: display,
    output: 'htmlAndMathml',
    throwOnError: false,
    strict: 'warn',
    trust: false,
  }), [display, value])
  const Tag = block ? 'div' : 'span'
  return <Tag
    className={`oa-math ${display ? 'oa-math-display' : 'oa-math-inline'}`}
    dangerouslySetInnerHTML={{ __html: html }}
  />
}

function InlineNodes({ nodes = [] }) {
  return <>
    {nodes.map((node, i) => {
      if (node.type === 'text') return <span key={i}>{node.value}</span>
      if (node.type === 'code') return <code key={i}>{node.value}</code>
      if (node.type === 'math') return <MathFormula key={i} value={node.value} display={node.display} />
      if (node.type === 'br') return <br key={i} />
      if (node.type === 'image') {
        return <MarkdownImage key={i} node={node} />
      }
      if (node.type === 'link') {
        return <MarkdownLink key={i} node={node} />
      }
      if (node.type === 'footnote_ref') {
        if (!node.footnoteNumber || !node.footnoteId) {
          return <span key={i}>{`[^${node.label}]`}</span>
        }
        return (
          <sup key={i} className="oa-footnote-ref" id={node.refId}>
            <a href={`#${node.footnoteId}`} title={ct(`脚注 ${node.footnoteNumber}：${node.label}`, `Footnote ${node.footnoteNumber}: ${node.label}`)}>
              [{node.footnoteNumber}]
            </a>
          </sup>
        )
      }
      const Tag = INLINE_EMPHASIS_TAGS[node.type]
      if (!Tag) return null
      return <Tag key={i}><InlineNodes nodes={node.children} /></Tag>
    })}
  </>
}

function MarkdownImage({ node }) {
  const src = resolveMarkdownImageUrl(node.src)
  const resolved = resolveMarkdownLink(node.src)
  const [opening, setOpening] = useState(false)

  const openLocal = async (e, mode = 'file') => {
    e.preventDefault()
    e.stopPropagation()
    if (opening) return
    const targetDesc = mode === 'folder' ? ct('所在文件夹', 'containing folder') : ct('图片文件', 'image file')
    if (!await confirmDanger('chat-file-open', ct(`使用系统桌面打开${targetDesc}：${resolved.localPath}？`, `Open ${targetDesc} in desktop system: ${resolved.localPath}?`))) return
    setOpening(true)
    try {
      await api('/api/files/open', { dangerous: true, method: 'POST', body: JSON.stringify({ path: resolved.localPath, mode }) })
    } catch (err) {
      await showAppAlert(ct(`打开失败：${err?.message || err}`, `Open failed: ${err?.message || err}`), { operation: 'chat-file-open' })
    } finally {
      setOpening(false)
    }
  }

  const downloadHref = resolved.isLocal ? resolved.href : src
  const downloadName = resolved.isLocal ? resolved.downloadName : (String(node.src || '').split(/[\\/]/).filter(Boolean).pop() || 'image')

  return (
    <span className="oa-md-image-wrap">
      <img
        className="oa-md-image"
        tabIndex={0}
        role="button"
        aria-label={ct(`查看大图 ${node.alt || ''}`, `Preview image ${node.alt || ''}`)}
        src={src}
        alt={node.alt}
        title={node.title || undefined}
        loading="lazy"
      />
      <span className="oa-md-image-actions">
        <a
          href={downloadHref}
          download={downloadName}
          className="oa-md-image-action"
          title={ct('下载图片', 'Download image')}
          aria-label={ct('下载图片', 'Download image')}
          target="_blank"
          rel="noreferrer noopener"
        >
          <Download size={13} />
        </a>
        {resolved.isLocal && (
          <>
            <button
              type="button"
              className="oa-md-image-action"
              title={ct('在系统默认程序中打开', 'Open with system default app')}
              aria-label={ct('在系统默认程序中打开', 'Open with system default app')}
              disabled={opening}
              onClick={(e) => openLocal(e, 'file')}
            >
              <ExternalLink size={13} />
            </button>
            <button
              type="button"
              className="oa-md-image-action"
              title={ct('在文件夹中显示', 'Show in folder')}
              aria-label={ct('在文件夹中显示', 'Show in folder')}
              disabled={opening}
              onClick={(e) => openLocal(e, 'folder')}
            >
              <FolderOpen size={13} />
            </button>
          </>
        )}
      </span>
    </span>
  )
}

function MarkdownLink({ node }) {
  const resolved = resolveMarkdownLink(node.href)
  const [opening, setOpening] = useState(false)

  if (!resolved.isLocal) {
    const target = fileDownloadTarget(node.href)
    if (target) return <FilePreviewLink href={target.href} download={target.name} title={node.title || undefined}><InlineNodes nodes={node.children} /></FilePreviewLink>
    return (
      <a href={node.href} title={node.title || undefined} target="_blank" rel="noreferrer noopener">
        <InlineNodes nodes={node.children} />
      </a>
    )
  }

  const openLocal = async (e, mode = 'file') => {
    e.preventDefault()
    e.stopPropagation()
    if (opening) return
    const targetDesc = mode === 'folder' ? ct('所在文件夹', 'containing folder') : ct('文件', 'file')
    if (!await confirmDanger('chat-file-open', ct(`使用系统桌面打开${targetDesc}：${resolved.localPath}？`, `Open ${targetDesc} in desktop system: ${resolved.localPath}?`))) return
    setOpening(true)
    try {
      await api('/api/files/open', { dangerous: true, method: 'POST', body: JSON.stringify({ path: resolved.localPath, mode }) })
    } catch (err) {
      await showAppAlert(ct(`打开失败：${err?.message || err}`, `Open failed: ${err?.message || err}`), { operation: 'chat-file-open' })
    } finally {
      setOpening(false)
    }
  }

  const titleText = node.title || resolved.localPath

  return (
    <span className="oa-md-file-link-wrap">
      <FilePreviewLink
        href={resolved.href}
        download={resolved.downloadName}
        className="oa-md-file-link"
        title={ct(`点击下载：${titleText} (Ctrl/Cmd+点击在文件夹中显示)`, `Click to download: ${titleText} (Ctrl/Cmd+click to reveal in folder)`)}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey) {
            openLocal(e, 'folder')
          }
        }}
      >
        <InlineNodes nodes={node.children} />
      </FilePreviewLink>
      <button
        type="button"
        className="oa-md-file-link-action"
        title={ct('在系统默认程序中打开', 'Open with system default app')}
        disabled={opening}
        onClick={(e) => openLocal(e, 'file')}
      >
        <ExternalLink size={12} />
      </button>
      <button
        type="button"
        className="oa-md-file-link-action"
        title={ct('在文件夹中显示', 'Show in folder')}
        disabled={opening}
        onClick={(e) => openLocal(e, 'folder')}
      >
        <FolderOpen size={12} />
      </button>
    </span>
  )
}

export function InlineMarkdown({ text = '', nodes }) {
  return <InlineNodes nodes={nodes || parseInline(text)} />
}
