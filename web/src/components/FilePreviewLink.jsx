import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import FileDownloadLink from './FileDownloadLink'
import { fileDownloadTarget } from '../lib/fileDownload'

export function previewKind(name) {
  const ext = name.split('.').pop().toLowerCase()
  if (['html', 'htm'].includes(ext)) return 'html'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'].includes(ext)) return 'image'
  if (['txt', 'md', 'json', 'csv', 'log', 'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'css', 'xml', 'yaml', 'yml', 'svg'].includes(ext)) return 'text'
  return 'unsupported'
}
const limit = 10 * 1024 * 1024
const isolation = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">'

function Preview({ href, name, close }) {
  const dialog = useRef(null)
  const [state, setState] = useState({ loading: true })
  const kind = previewKind(name)
  useEffect(() => {
    if (dialog.current.showModal) dialog.current.showModal()
    else dialog.current.setAttribute('open', '')
    const controller = new AbortController()
    let objectUrl
    const load = async () => {
      if (kind === 'unsupported') { setState({ message: '此格式暂不支持网页预览，请下载后打开。' }); return }
      try {
        const target = fileDownloadTarget(href)
        if (!target) throw new Error('无效的文件链接')
        const response = await fetch(target.href, { credentials: 'same-origin', redirect: 'error', signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (Number(response.headers.get('Content-Length')) > limit) { controller.abort(); throw new Error('文件超过10MB预览限制，请下载查看') }
        const reader = response.body.getReader()
        const parts = []
        let size = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > limit) { await reader.cancel(); throw new Error('文件超过10MB预览限制，请下载查看') }
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
        if (error.name !== 'AbortError') setState({ message: `无法预览：${error.message}` })
      }
    }
    load()
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [href, kind])
  return createPortal(<dialog ref={dialog} onCancel={close} aria-label={`文件预览 ${name}`} style={{ width: 'min(960px, 94vw)', maxWidth: '94vw', height: '85dvh', padding: 16, borderRadius: 12, border: '1px solid GrayText', background: 'Canvas', color: 'CanvasText', colorScheme: 'light dark' }}>
    <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
      <strong style={{ flex: 1, overflowWrap: 'anywhere' }}>{name}</strong>
      <FileDownloadLink href={href} download={name}>下载</FileDownloadLink>
      <button type="button" onClick={close}>关闭</button>
    </header>
    {state.loading && <p role="status">正在加载预览…</p>}
    {state.message && <p role="status">{state.message}</p>}
    {kind === 'html' && state.text !== undefined && <><p>隔离预览：允许内联脚本，外部资源和网络请求已禁用。</p><iframe title={name} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={isolation + state.text} style={{ width: '100%', height: 'calc(100% - 110px)', border: 0, background: 'white' }} /></>}
    {kind === 'text' && state.text !== undefined && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{state.text}</pre>}
    {kind === 'image' && state.url && <img src={state.url} alt={name} style={{ maxWidth: '100%', maxHeight: 'calc(100% - 60px)', objectFit: 'contain' }} onError={() => setState({ message: '图片格式无法预览，请下载查看。' })} />}
  </dialog>, document.body)
}

export default function FilePreviewLink({ href, download, children, onClick, ...props }) {
  const [open, setOpen] = useState(false)
  const name = download || fileDownloadTarget(href)?.name || '文件'
  return <><a {...props} href={href} download={name} onClick={event => { onClick?.(event); if (event.defaultPrevented) return; event.preventDefault(); event.stopPropagation(); setOpen(true) }}>{children}</a>{open && <Preview href={href} name={name} close={() => setOpen(false)} />}</>
}
