import React, { useEffect, useRef, useState } from 'react'
import Tooltip from 'antd/es/tooltip'

// A short tap opens the session; a stationary long press only previews its time.
export default function SessionTimeTooltip({ children, title, timeLabel }) {
  const [open, setOpen] = useState(false)
  const press = useRef(null)
  const dismiss = useRef(null)
  const touch = useRef(false)
  const held = useRef(false)
  const origin = useRef(null)
  const clearPress = () => { clearTimeout(press.current); press.current = null }
  useEffect(() => () => { clearTimeout(press.current); clearTimeout(dismiss.current) }, [])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const escape = event => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', close)
    document.addEventListener('scroll', close, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  const child = React.cloneElement(children, {
    onPointerEnter: event => { if (event.pointerType !== 'touch') touch.current = false },
    onPointerDown: event => {
      clearPress()
      clearTimeout(dismiss.current)
      held.current = false
      touch.current = event.pointerType === 'touch'
      if (!touch.current || event.target.closest('[role="button"]')) return
      origin.current = { x: event.clientX, y: event.clientY }
      press.current = setTimeout(() => { held.current = true; setOpen(true) }, 500)
    },
    onPointerMove: event => {
      if (touch.current && origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) {
        clearPress()
        setOpen(false)
      }
    },
    onPointerUp: () => {
      clearPress()
      if (held.current) dismiss.current = setTimeout(() => setOpen(false), 2500)
    },
    onPointerCancel: () => { clearPress(); setOpen(false) },
    onPointerLeave: () => { clearPress(); if (!touch.current) setOpen(false) },
    onContextMenu: event => { if (touch.current) event.preventDefault() },
    onBlur: () => setOpen(false),
    onClick: event => {
      if (held.current) { event.preventDefault(); event.stopPropagation(); held.current = false; return }
      setOpen(false)
      children.props.onClick?.(event)
    },
  })
  return <Tooltip placement="right" arrow={false} destroyOnHidden open={open}
    trigger={['hover', 'focus']} onOpenChange={next => { if (!touch.current) setOpen(next) }}
    title={<><div>{title}</div>{timeLabel && <div>{timeLabel}</div>}</>}>
    {child}
  </Tooltip>
}
