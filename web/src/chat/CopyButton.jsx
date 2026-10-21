import { ct } from './chatFormat.js'
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function CopyButton({ text, compact = false, label = ct('复制', 'Copy'), copiedLabel = ct('已复制', 'Copied') }) {
  const [ok, setOk] = useState(false)
  const copy = async (e) => {
    e?.stopPropagation?.()
    try {
      await navigator.clipboard.writeText(text || '')
      setOk(true)
      setTimeout(() => setOk(false), 1200)
    } catch {}
  }
  const statusLabel = ok ? copiedLabel : label
  return <button type="button" className={compact ? 'oa-mini-copy' : 'oa-copy'} onClick={copy} title={statusLabel} aria-label={statusLabel}>
    {ok ? <Check size={14}/> : <Copy size={14}/>}<span>{statusLabel}</span>
  </button>
}
