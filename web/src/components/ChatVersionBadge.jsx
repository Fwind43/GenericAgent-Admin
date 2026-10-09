import React, { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Download } from 'lucide-react'
import { api } from '../lib/api'
import { I18N } from '../lib/i18n'
import { useVersionUpdates } from '../hooks/useVersionUpdates'
import SystemUpdateModal from './SystemUpdateModal'
import './ChatVersionBadge.css'

const noop = () => {}
const chatLanguage = () => localStorage.getItem('ga-admin-lang') === 'en' ? 'en' : 'zh'

export default function ChatVersionBadge({ version: suppliedVersion, children } = {}) {
  const [updateOpen, setUpdateOpen] = useState(false)
  const [lang, setLang] = useState(chatLanguage)
  const updates = useVersionUpdates({ t: I18N[lang], lang, setMsg: noop, setBusy: noop, active: updateOpen })
  useEffect(() => {
    const sync = event => setLang(event.detail === 'en' ? 'en' : 'zh')
    window.addEventListener('ga-admin-language-change', sync)
    return () => window.removeEventListener('ga-admin-language-change', sync)
  }, [])
  const [version, setVersion] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const contentID = useId()
  const trigger = useRef(null)
  const panel = useRef(null)
  const [position, setPosition] = useState(null)
  useEffect(() => {
    if (!expanded) return
    const doc = trigger.current.ownerDocument
    const win = doc.defaultView
    panel.current?.querySelector('select:not(:disabled), button:not(:disabled)')?.focus()
    const outside = event => {
      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setExpanded(false)
    }
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); setExpanded(false); trigger.current?.focus() }
    }
    const hide = event => { if (!panel.current?.contains(event.target)) setExpanded(false) }
    doc.addEventListener('pointerdown', outside)
    doc.addEventListener('focusin', outside)
    doc.addEventListener('keydown', key)
    win.addEventListener('resize', hide)
    win.addEventListener('scroll', hide, true)
    return () => {
      doc.removeEventListener('pointerdown', outside)
      doc.removeEventListener('focusin', outside)
      doc.removeEventListener('keydown', key)
      win.removeEventListener('resize', hide)
      win.removeEventListener('scroll', hide, true)
    }
  }, [expanded])
  const toggle = () => {
    const rect = trigger.current.getBoundingClientRect()
    const win = trigger.current.ownerDocument.defaultView
    const width = Math.min(Math.max(rect.width, 220), win.innerWidth - 16)
    setPosition({ width, left: Math.max(8, Math.min(rect.left, win.innerWidth - width - 8)), bottom: win.innerHeight - rect.top + 6, maxHeight: Math.max(40, rect.top - 14) })
    setExpanded(value => !value)
  }
  useEffect(() => {
    if (suppliedVersion !== undefined) return
    let active = true
    api('/api/version/info').then(info => {
      if (active) setVersion(info?.version || '?')
    }).catch(() => { if (active) setVersion('?') })
    return () => { active = false }
  }, [suppliedVersion])
  const displayVersion = suppliedVersion ?? version ?? '\u2026'
  const title = `GenericAgent Admin ${displayVersion}`
  return <div className="oa-sidebar-admin">
    <button ref={trigger} type="button" aria-haspopup="dialog" className="oa-sidebar-admin-toggle" title={title} aria-label={title} aria-controls={contentID} aria-expanded={expanded} onClick={toggle}>
      <span className="oa-sidebar-admin-label"><span>GenericAgent Admin</span><span className="oa-chat-version">{displayVersion}</span></span>
      <ChevronDown size={14} aria-hidden="true"/>
    </button>
    {expanded && createPortal(<div ref={panel} id={contentID} role="dialog" aria-label={title} className="oa-sidebar-admin-content" style={position}
      onClick={event => { if (event.target.closest('button:not(:disabled)')) setExpanded(false) }}>{children}
      <button type="button" className="oa-sidebar-settings" onClick={() => { setUpdateOpen(true); updates.loadUpdateSnapshot() }}><Download size={15}/>{lang === 'en' ? 'Version updates' : '版本更新'}</button>
    </div>, trigger.current.ownerDocument.body)}
    <SystemUpdateModal open={updateOpen} onClose={() => setUpdateOpen(false)} version={updates} lang={lang}/>
  </div>
}
