import React, { useEffect, useState } from 'react'
import { api } from '../lib/api'
import './ChatVersionBadge.css'

export default function ChatVersionBadge() {
  const [version, setVersion] = useState(null)
  useEffect(() => {
    let active = true
    api('/api/version/info').then(info => {
      if (active) setVersion(info?.version || '?')
    }).catch(() => { if (active) setVersion('?') })
    return () => { active = false }
  }, [])
  return <span className="oa-chat-version" title={`GenericAgent Admin ${version ?? '…'}`} aria-label={`GenericAgent Admin ${version ?? '…'}`}>{version ?? '…'}</span>
}
