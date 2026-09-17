import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, ChevronRight } from 'lucide-react'

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
    {pos && createPortal(<div ref={menu} className="oa-session-menu" aria-label={label} style={{ position:'fixed', ...pos, width:190, zIndex:10000, overflow:'visible' }}
      onClick={e => { e.stopPropagation(); if (e.target.closest('button:not(:disabled)')) { setPos(null); trigger.current?.focus() } }}>
      {children}
    </div>, document.body)}
  </>
}

export function SidebarPreferenceSubmenu({ label, value, options, onChange, multiple = false }) {
  const [pos, setPos] = useState(null)
  const trigger = useRef(null)
  const panel = useRef(null)
  const open = () => {
    const rect = trigger.current.getBoundingClientRect()
    const width = Math.min(160, window.innerWidth - 16)
    setPos({ left: Math.max(8, rect.right + width + 8 <= window.innerWidth ? rect.right : rect.left - width), top: Math.max(8, Math.min(rect.top - 6, window.innerHeight - options.length * 36 - 22)), width })
  }
  return <div onMouseEnter={open} onMouseLeave={()=>setPos(null)} onBlur={e=>{ if (!e.currentTarget.contains(e.relatedTarget)) setPos(null) }}>
    <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={!!pos}
      onClick={e=>{ e.stopPropagation(); if (pos) setPos(null); else open() }}
      onKeyDown={e=>{ if (e.key === 'ArrowRight') { e.preventDefault(); open(); requestAnimationFrame(()=>panel.current?.querySelector('button')?.focus()) } }}>
      <span style={{ flex:1 }}>{label}</span><ChevronRight size={14}/>
    </button>
    {pos && <div ref={panel} role="menu" aria-label={label} className="oa-session-menu" style={{ ...pos, position:'fixed', zIndex:10001 }}
      onKeyDown={e=>{ if (e.key === 'ArrowLeft' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPos(null); trigger.current?.focus() } }}>
      {options.map(option=><button key={option.value} type="button" role={multiple ? "menuitemcheckbox" : "menuitemradio"} aria-checked={multiple ? value.includes(option.value) : value === option.value} onClick={e=>{ if (multiple) e.stopPropagation(); onChange(option.value) }}>
        <span aria-hidden="true" style={{ width:16, height:16, borderRadius:multiple ? 3 : '50%', border:'2px solid', borderColor:(multiple ? value.includes(option.value) : value === option.value) ? 'var(--accent, #1677ff)' : 'currentColor', display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          {(multiple ? value.includes(option.value) : value === option.value) && <span style={{ width:8, height:8, borderRadius:multiple ? 1 : '50%', background:'var(--accent, #1677ff)' }}/>}
        </span>{option.label}
      </button>)}
    </div>}
  </div>
}
