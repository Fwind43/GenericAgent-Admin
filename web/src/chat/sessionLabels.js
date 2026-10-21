import { ct, dateFromTimestamp, chatLocale } from './chatFormat.js'
import { sessionAge } from '../lib/chatSessionGroups.js'

export const parseBTWDisplay = (value) => {
  const raw = String(value || '')
  const match = raw.match(/^\s*(?:>\s*)?(?:🟡\s*)?\/btw(?:[ \t]+([\s\S]*))?\s*$/i)
  if (!match) return null
  return { prompt: String(match[1] || '').trim() }
}

export const stripBTWEcho = (value) => {
  const lines = String(value || '').split(/\r?\n/)
  const firstContent = lines.findIndex(line => line.trim())
  if (firstContent < 0 || !parseBTWDisplay(lines[firstContent])) return String(value || '')
  lines.splice(firstContent, 1)
  while (firstContent < lines.length && !lines[firstContent].trim()) lines.splice(firstContent, 1)
  return lines.join('\n').trimStart()
}

export const shortTitle = (s) => s?.title || ct('新会话', 'New chat')

export const fmtDate = (ts) => {
  const d = dateFromTimestamp(ts)
  if (!d) return ''
  const today = new Date(); const y = today.getFullYear(), mo = today.getMonth(), dy = today.getDate()
  if (d.getFullYear() === y && d.getMonth() === mo && d.getDate() === dy) return ct('今天', 'Today')
  if (d.getFullYear() === y && d.getMonth() === mo && d.getDate() === dy - 1) return ct('昨天', 'Yesterday')
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export const formatAge = (ts) => {
  const d = dateFromTimestamp(ts)
  if (!d) return ''
  const diff = Date.now() - d.getTime()
  if (diff < 60000) return ct('刚刚', 'Just now')
  if (diff < 3600000) return ct(`${Math.floor(diff/60000)}分钟前`, `${Math.floor(diff/60000)} min ago`)
  if (diff < 86400000) return ct(`${Math.floor(diff/3600000)}小时前`, `${Math.floor(diff/3600000)} hr ago`)
  return d.toLocaleDateString(chatLocale(), { month:'short', day:'numeric' })
}

export const sessionAgeText = (ts) => {
  const age = sessionAge(ts)
  if (!age) return ''
  const { value } = age
  const plural = value === 1 ? '' : 's'
  switch (age.unit) {
    case 'minute': return ct(`${value} 分钟前`, `${value} min ago`)
    case 'hour': return ct(`${value} 小时前`, `${value} hr ago`)
    case 'day': return ct(`${value} 天前`, `${value} day${plural} ago`)
    case 'week': return ct(`${value} 周前`, `${value} week${plural} ago`)
    case 'month': return ct(`${value} 个月前`, `${value} month${plural} ago`)
    case 'year': return ct(`${value} 年前`, `${value} year${plural} ago`)
    default: return ct('刚刚', 'Just now')
  }
}

const modelLabel = (m) => m?.label || [m?.name || m?.var_name || `${ct('模型', 'Model')} ${m?.index || ''}`, m?.model].filter(Boolean).join(' · ')

const modelProvider = (m) => {
  const provider = String(m?.provider || '').trim()
  if (provider) return provider
  const name = String(m?.name || '').trim()
  const model = String(m?.model || '').trim()
  if (name && model && name.endsWith(`/${model}`)) return name.slice(0, -(model.length + 1))
  const split = name.lastIndexOf('/')
  return (split > 0 ? name.slice(0, split) : name) || ct('未分组服务商', 'Ungrouped provider')
}

export const runtimeModelLabel = (m) => {
  const label = String(m?.label || '').trim()
  if (label) return label.includes('/') ? label.split('/').pop() : label
  const model = String(m?.model || '').trim()
  if (model) return model
  return modelLabel(m)
}

export const runtimeModelGroup = (m) => {
  const provider = modelProvider(m)
  return { value:`provider:${provider}`, label:provider }
}

export const groupRuntimeModels = (llms = []) => {
  const groups = new Map()
  const providerOrder = new Map()
  llms.forEach(model => {
    const group = runtimeModelGroup(model)
    if (!groups.has(group.value)) groups.set(group.value, { ...group, models:[] })
    groups.get(group.value).models.push({ value:model.index, label:runtimeModelLabel(model) })
    if (Number.isInteger(model.provider_sort_order) && !providerOrder.has(group.value)) {
      providerOrder.set(group.value, model.provider_sort_order)
    }
  })
  // Reorder only configured-provider slots; keep failover/unknown groups in
  // their existing positions and preserve every official model index.
  const result = Array.from(groups.values())
  const ordered = result.filter(group => providerOrder.has(group.value))
    .sort((a, b) => providerOrder.get(a.value) - providerOrder.get(b.value))
  let next = 0
  return result.map(group => providerOrder.has(group.value) ? ordered[next++] : group)
}
