import React, { useEffect, useState } from 'react'
import { api } from '../lib/api'
import './ChatVersionBadge.css'

export default function ChatVersionBadge({ version: suppliedVersion } = {}) {
  const [version, setVersion] = useState(null)
  useEffect(() => {
    if (suppliedVersion !== undefined) return
    let active = true
    api('/api/version/info').then(info => {
      if (active) setVersion(info?.version || '?')
    }).catch(() => { if (active) setVersion('?') })
    return () => { active = false }
  }, [suppliedVersion])
  const displayVersion = suppliedVersion ?? version ?? '…'
  return <span className="oa-chat-version" title={`GenericAgent Admin ${displayVersion}`} aria-label={`GenericAgent Admin ${displayVersion}`}>{displayVersion}</span>
}
