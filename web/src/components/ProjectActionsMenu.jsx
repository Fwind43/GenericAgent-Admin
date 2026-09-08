import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

export default function ProjectActionsMenu({ label, children }) {
  const [pos, setPos] = useState(null)
  const trigger = useRef(null)
  const menu = useRef(null)
  useEffect(() => {
    if (!pos) return
    menu.current?.querySelector('button:not(:disabled)')?.focus()
    const close = e => {
      if (!menu.current?.contains(e.target) && !trigger.current?.contains(e.target)) setPos(null)
    }
    const key = e => {
      if (e.key === 'Escape') { setPos(null); trigger.current?.focus() }
    }
    const hide = () => setPos(null)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', hide)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', hide)
      window.removeEventListener('scroll', hide, true)
    }
  }, [pos])
  return <>
    <button ref={trigger} type="button" className="oa-project-reorder" aria-label={label} title={label} aria-expanded={!!pos} aria-haspopup="true"
      onClick={e => {
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        setPos(pos ? null : { top:Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 110)), left:Math.max(8, Math.min(rect.right - 190, window.innerWidth - 198)) })
      }} style={{ cursor:'pointer' }}><MoreHorizontal size={16}/></button>
    {pos && createPortal(<div ref={menu} className="oa-session-menu" aria-label={label} style={{ position:'fixed', ...pos, width:190, zIndex:10000 }}
      onClick={e => { e.stopPropagation(); if (e.target.closest('button:not(:disabled)')) { setPos(null); trigger.current?.focus() } }}>
      {children}
    </div>, document.body)}
  </>
}
