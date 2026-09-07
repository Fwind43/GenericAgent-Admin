import React, { useEffect, useState } from 'react'
import { Image } from 'antd'
import './GlobalImagePreview.css'

// Capture before local attachment handlers so a click opens only one viewer.
export function GlobalImagePreview() {
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    const onActivate = event => {
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return
      if (event.type === 'click' && (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return
      const target = event.target instanceof Element ? event.target : null
      const image = target?.closest('img') || target?.closest('.oa-attach-open')?.querySelector('img')
      if (!image || image.closest('[data-image-preview="off"], .ant-image, .ant-image-preview, .oa-global-image-preview, [contenteditable="true"]')) return
      if (image.closest('button:disabled, [aria-disabled="true"]')) return
      const src = image.currentSrc || image.getAttribute('src')
      if (!src) return
      event.preventDefault()
      event.stopPropagation()
      setPreview({ src, alt: image.alt || image.title || '', trigger: target })
    }
    document.addEventListener('click', onActivate, true)
    document.addEventListener('keydown', onActivate, true)
    return () => {
      document.removeEventListener('click', onActivate, true)
      document.removeEventListener('keydown', onActivate, true)
    }
  }, [])

  return preview && <Image
    src={preview.src}
    alt={preview.alt}
    rootClassName="oa-global-image-preview"
    styles={{ root: { display: 'none' } }}
    preview={{
      open: true,
      zIndex: 10000,
      onOpenChange: open => {
        if (open) return
        preview.trigger?.focus({ preventScroll: true })
        setPreview(null)
      },
    }}
  />
}
