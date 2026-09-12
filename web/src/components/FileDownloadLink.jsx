import React, { useRef, useState } from 'react'
import { downloadFile } from '../lib/fileDownload.js'
import { showAppAlert } from '../lib/danger'

export default function FileDownloadLink({ href, download, onClick, children, ...props }) {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const handleClick = async event => {
    onClick?.(event)
    if (event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      await downloadFile(href, download)
    } catch (error) {
      await showAppAlert(`下载失败：${error.message}`, { operation: 'file-download' })
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return <a {...props} href={href} download={download} onClick={handleClick} aria-busy={busy} aria-disabled={busy || undefined}>{children}</a>
}
