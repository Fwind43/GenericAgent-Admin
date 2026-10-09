import React, { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, ChevronRight } from 'lucide-react'

const ProjectMenuOwner = createContext(null)
const belongsToOwner = (target, owner) => target.closest?.('[data-project-menu-owner]')?.getAttribute('data-project-menu-owner') === owner

export default function ProjectActionsMenu({ label, children, renderTrigger, className = '' }) {
  const [pos, setPos] = useState(null)
  const owner = useId()
  const trigger = useRef(null)
  const menu = useRef(null)
  useEffect(() => {
    if (!pos) return
    menu.current?.querySelector('button:not(:disabled)')?.focus()
    const close = e => {
      if (!menu.current?.contains(e.target) && !trigger.current?.contains(e.target) && !belongsToOwner(e.target, owner)) setPos(null)
    }
    const key = e => {
      if (e.key === 'Escape') { setPos(null); trigger.current?.focus() }
    }
    const hide = e => { if (!belongsToOwner(e.target, owner)) setPos(null) }
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
  }, [pos, owner])
  const closeMenu = () => setPos(null)
  const toggleMenu = e => {
    e.stopPropagation()
    trigger.current = e.currentTarget
    const rect = e.currentTarget.getBoundingClientRect()
    setPos(pos ? null : { top:Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 340)), left:Math.max(8, Math.min(rect.right - 190, window.innerWidth - 198)) })
  }
  const triggerProps = { 'aria-expanded':!!pos, 'aria-haspopup':'true', 'data-project-menu-owner':owner, onClick:toggleMenu }
  return <ProjectMenuOwner.Provider value={owner}>
    {renderTrigger ? renderTrigger({ triggerProps, closeMenu }) : <button ref={trigger} type="button" className="oa-project-reorder" aria-label={label} title={label} {...triggerProps} style={{ cursor:'pointer' }}><MoreHorizontal size={16}/></button>}
    {pos && createPortal(<div ref={menu} className={`oa-session-menu ${className}`} aria-label={label} style={{ position:'fixed', ...pos, width:190, zIndex:10000, overflow:'visible' }}
      onClick={e => { e.stopPropagation(); if (e.target.closest('button:not(:disabled):not([aria-haspopup="menu"])')) { setPos(null); trigger.current?.focus() } }}>
      {children}
    </div>, document.body)}
  </ProjectMenuOwner.Provider>
}

export function SidebarPreferenceSubmenu({ label, value, options, onChange, multiple = false }) {
  const [pos, setPos] = useState(null)
  const owner = useContext(ProjectMenuOwner)
  const triggerId = useId()
  const trigger = useRef(null)
  const panel = useRef(null)
  const leaveTimer = useRef(null)
  const isOpen = Boolean(pos)
  const keepOpen = () => clearTimeout(leaveTimer.current)
  const leave = () => { keepOpen(); leaveTimer.current = setTimeout(() => setPos(null), 160) }
  const open = () => {
    keepOpen()
    if (isOpen || !options.length) return
    const rect = trigger.current.getBoundingClientRect()
    setPos({ left: rect.right, top: rect.top - 6 })
  }
  useLayoutEffect(() => {
    if (!isOpen) return
    const rect = trigger.current.getBoundingClientRect()
    const { width, height } = panel.current.getBoundingClientRect()
    const left = rect.right + width + 8 <= window.innerWidth ? rect.right : rect.left - width >= 8 ? rect.left - width : rect.left
    setPos({ left: Math.max(8, Math.min(left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(rect.top - 6, window.innerHeight - height - 8)) })
  }, [isOpen, options.length])
  useEffect(() => {
    if (!isOpen) return
    const outside = e => {
      if (!panel.current?.contains(e.target) && !trigger.current?.contains(e.target)) setPos(null)
    }
    const hide = e => { if (e.type === 'resize' || !panel.current?.contains(e.target)) setPos(null) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', hide)
    window.addEventListener('scroll', hide, true)
    return () => {
      keepOpen()
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', hide)
      window.removeEventListener('scroll', hide, true)
    }
  }, [isOpen])
  return <div onMouseEnter={open} onMouseLeave={leave} onBlur={e=>{ if (!e.currentTarget.contains(e.relatedTarget) && !panel.current?.contains(e.relatedTarget)) setPos(null) }}>
    <button ref={trigger} id={triggerId} type="button" aria-haspopup="menu" aria-expanded={isOpen} disabled={!options.length}
      onClick={e=>{ e.stopPropagation(); open() }}
      onKeyDown={e=>{ if (e.key === 'ArrowRight') { e.preventDefault(); open(); requestAnimationFrame(()=>panel.current?.querySelector('button')?.focus()) } }}>
      <span style={{ flex:1 }}>{label}</span><ChevronRight size={14}/>
    </button>
    {pos && createPortal(<div ref={panel} role="menu" aria-labelledby={triggerId} data-project-menu-owner={owner} className="oa-session-menu oa-sidebar-preference-menu" style={{ ...pos, position:'fixed', zIndex:10001, width:'max-content', minWidth:Math.min(164, window.innerWidth - 16), maxWidth:Math.min(280, window.innerWidth - 16), boxSizing:'border-box' }}
      onMouseEnter={keepOpen} onMouseLeave={leave}
      onKeyDown={e=>{ if (e.key === 'ArrowLeft' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPos(null); trigger.current?.focus() } }}>
      {options.map(option=><button key={option.value} type="button" role={multiple ? "menuitemcheckbox" : "menuitemradio"} aria-checked={multiple ? value.includes(option.value) : value === option.value} onClick={e=>{ if (multiple) e.stopPropagation(); onChange(option.value); if (!multiple) setPos(null) }}>
        <span aria-hidden="true" style={{ width:16, height:16, borderRadius:multiple ? 3 : '50%', border:'2px solid', borderColor:(multiple ? value.includes(option.value) : value === option.value) ? 'var(--accent, #1677ff)' : 'currentColor', display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          {(multiple ? value.includes(option.value) : value === option.value) && <span style={{ width:8, height:8, borderRadius:multiple ? 1 : '50%', background:'var(--accent, #1677ff)' }}/>}
        </span>{option.label}
      </button>)}
    </div>, document.body)}
  </div>
}
