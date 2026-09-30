export const emptyProfile = (idx = 0, protocol = 'native_oai') => ({ var_name: `${protocol}_config${idx + 1}`, type: protocol, name: '', model: '', apibase: '', apikey: '', stream: true, max_retries: 3, read_timeout: 300, reasoning_effort: '' })
export const safeJson = (v) => JSON.stringify(v ?? {}, null, 2)
export const group = (items, pred) => (items || []).filter(pred)

export const formatDuration = (seconds) => {
  const n = Math.max(0, Number(seconds) || 0)
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = Math.floor(n % 60)
  return h ? `${h}h ${m}m` : (m ? `${m}m ${s}s` : `${s}s`)
}

export const formatGoalTime = (value) => value ? new Date(value).toLocaleString() : '-'

export const formatBytes = (bytes) => {
  const n = Math.max(0, Number(bytes) || 0)
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MiB`
  if (n >= 1024) return `${(n / 1024).toFixed(n >= 10 * 1024 ? 0 : 1)} KiB`
  return `${n} B`
}

export const outputLineCount = (text) => {
  if (!text) return 0
  const normalized = String(text).replace(/\r?\n$/, '')
  return normalized ? normalized.split(/\r?\n/).length : 0
}

export const copyText = async (text) => {
  const value = text || ''
  if (!value) return
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const el = document.createElement('textarea')
  el.value = value
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  document.body.appendChild(el)
  try {
    el.select()
    if (!document.execCommand('copy')) throw new Error('Clipboard copy failed')
  } finally {
    document.body.removeChild(el)
  }
}

const clampPercent = (value) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))

export const goalTurnPercent = (g) => {
  const serverPct = Number(g?.turn_percent)
  if (Number.isFinite(serverPct)) return clampPercent(serverPct)
  const maxTurns = Number(g?.max_turns || 0)
  if (!maxTurns) return 0
  return clampPercent((Number(g?.turns_used || 0) / maxTurns) * 100)
}

export const goalBudgetPercent = (g) => {
  const serverPct = Number(g?.budget_percent)
  if (Number.isFinite(serverPct)) return clampPercent(serverPct)
  const elapsed = Number(g?.elapsed_seconds || 0)
  const remaining = Number(g?.remaining_seconds || 0)
  const total = elapsed + Math.max(0, remaining)
  if (!total) return 0
  return clampPercent((elapsed / total) * 100)
}


export const modelLabel = (m) => m?.label || [m?.name || m?.var_name || `模型 ${m?.index || ''}`, m?.model].filter(Boolean).join(' · ')

export const fuzzyMatch = (text, filter) => {
  if (!filter) return true
  const lower = text.toLowerCase(), fl = filter.toLowerCase()
  return lower.includes(fl)
}
