import React, { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { I18N } from '../lib/i18n'
import { updateText } from '../lib/versionUpdateView'
import { useVersionUpdates } from '../hooks/useVersionUpdates'
import SystemUpdateModal from './SystemUpdateModal'
import './ChatVersionBadge.css'

const noop = () => {}
const chatLanguage = () => localStorage.getItem('ga-admin-lang') === 'en' ? 'en' : 'zh'

export default function ChatVersionBadge({ version: suppliedVersion } = {}) {
  const [version, setVersion] = useState(null)
  const [open, setOpen] = useState(false)
  const [lang, setLang] = useState(chatLanguage)
  const updates = useVersionUpdates({ t: I18N[lang], lang, setMsg: noop, setBusy: noop, active: open })
  useEffect(() => {
    const syncLanguage = event => setLang(event.detail === 'en' ? 'en' : 'zh')
    window.addEventListener('ga-admin-language-change', syncLanguage)
    return () => window.removeEventListener('ga-admin-language-change', syncLanguage)
  }, [])
  useEffect(() => {
    if (suppliedVersion !== undefined) return
    let active = true
    api('/api/version/info').then(info => {
      if (active) setVersion(info?.version || '?')
    }).catch(() => { if (active) setVersion('?') })
    return () => { active = false }
  }, [suppliedVersion])
  const displayVersion = suppliedVersion ?? updates.info?.version ?? version ?? '…'
  const title = `${updateText(lang).title} · GenericAgent Admin ${displayVersion}`
  const openUpdates = () => {
    if (open) return
    setOpen(true)
    updates.loadUpdateSnapshot()
  }
  return <>
    <button type="button" className="oa-chat-version" title={title} aria-label={title} aria-haspopup="dialog" aria-expanded={open} onClick={openUpdates}>{displayVersion}</button>
    <SystemUpdateModal open={open} onClose={() => setOpen(false)} version={updates} lang={lang}/>
  </>
}
