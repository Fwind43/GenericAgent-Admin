import './usage-workbench.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { UiSurface } from '../ui/UiHost'
import { DefaultUsage } from '../ui/usage'
import { api } from '../lib/api'

const formatNumber = (value, lang) => new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US').format(Number(value) || 0)

const formatTokens = (value, lang) => {
  const n = Number(value) || 0
  const full = formatNumber(n, lang)
  let short
  if (lang === 'zh') {
    if (n >= 1e8)     short = `${+(n / 1e8).toFixed(2)}亿`
    else if (n >= 1e4) short = `${+(n / 1e4).toFixed(2)}万`
    else               short = full
  } else {
    if (n >= 1e9)     short = `${+(n / 1e9).toFixed(2)}B`
    else if (n >= 1e6) short = `${+(n / 1e6).toFixed(2)}M`
    else if (n >= 1e3) short = `${+(n / 1e3).toFixed(2)}K`
    else               short = full
  }
  return { short, full }
}

const COPY = {
  zh: {
    title: '累计 Token 用量', intro: '统计本机已持久化聊天会话中的模型用量，不包含聊天正文。',
    total: '总 Token', input: '输入 Token', output: '输出 Token', sessions: '有用量会话', replies: '有用量回复',
    models: '按模型', model: '模型', empty: '尚未记录到 Token 用量。',
    loading: '正在汇总会话用量…', failed: '无法加载用量总览', retry: '重试', refresh: '刷新', skipped: '个会话文件无法读取，已跳过。', unknown: '未知模型',
    heatmap: '每日活跃度', heatmapHint: '过去 26 周 · 按每日 Token 用量着色', less: '少', more: '多',
  },
  en: {
    title: 'Cumulative token usage', intro: 'Calculated from locally persisted chat sessions. Message content is never returned.',
    total: 'Total tokens', input: 'Input tokens', output: 'Output tokens', sessions: 'Sessions with usage', replies: 'Measured replies',
    models: 'By model', model: 'Model', empty: 'No token usage has been recorded yet.',
    loading: 'Aggregating session usage…', failed: 'Unable to load usage overview', retry: 'Retry', refresh: 'Refresh', skipped: 'session files could not be read and were skipped.', unknown: 'Unknown model',
    heatmap: 'Daily activity', heatmapHint: 'Past 26 weeks · colored by daily token usage', less: 'Less', more: 'More',
  },
}

function heatmapModel(daily = [], lang, copy, weeks) {
  const hint = lang === 'zh' ? `过去 ${weeks} 周 · 按每日 Token 用量着色` : `Past ${weeks} weeks · colored by daily token usage`
  const values = new Map(daily.map(day => [day.date, day]))
  const end = new Date(); end.setHours(0, 0, 0, 0)
  const start = new Date(end); start.setDate(end.getDate() - ((weeks - 1) * 7 + end.getDay()))
  const cells = []
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    const day = values.get(date) || { date, assistant_replies: 0, totals: { total_tokens: 0 } }
    cells.push(day)
  }
  const active = cells.map(day => Number(day.totals?.total_tokens) || 0).filter(Boolean).sort((a, b) => a - b)
  const level = value => {
    if (!value || !active.length) return 0
    const rank = active.findIndex(item => item >= value)
    return Math.max(1, Math.min(4, Math.ceil(((rank + 1) / active.length) * 4)))
  }
  const dateFormat = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium' })
  const monthFormat = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short' })
  const months = []
  const seenMonths = new Set()
  cells.forEach((day, index) => {
    const date = new Date(`${day.date}T00:00:00`)
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`
    if (date.getDate() <= 7 && !seenMonths.has(monthKey)) {
      seenMonths.add(monthKey)
      months.push({ key: monthKey, column: Math.floor(index / 7) + 1, label: monthFormat.format(date) })
    }
  })
  const weekdays = lang === 'zh' ? ['一', '三', '五'] : ['Mon', 'Wed', 'Fri']
  return { hint, months, weekdays, cells: cells.map(day => {
    const tokens = Number(day.totals?.total_tokens) || 0
    return { date: day.date, level: level(tokens), label: `${dateFormat.format(new Date(`${day.date}T00:00:00`))}: ${formatNumber(tokens, lang)} Token, ${formatNumber(day.assistant_replies, lang)} ${copy.replies}` }
  }) }
}

export function UsagePage({ lang = 'zh' }) {
  const c = COPY[lang] || COPY.zh
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [weeks, setWeeks] = useState(26)
  const [modelQuery, setModelQuery] = useState('')

  const lifecycle = useRef({ mounted: false, ticket: 0, pending: false })
  const load = useCallback(async () => {
    const state = lifecycle.current
    if (!state.mounted || state.pending) return
    const ticket = ++state.ticket
    state.pending = true
    setLoading(true); setError('')
    try {
      const result = await api('/api/usage/overview')
      if (state.mounted && ticket === state.ticket) setData(result)
    } catch (err) {
      if (state.mounted && ticket === state.ticket) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (state.mounted && ticket === state.ticket) { state.pending = false; setLoading(false) }
    }
  }, [])
  useEffect(() => {
    const state = lifecycle.current
    state.mounted = true
    void load()
    return () => { state.mounted = false; state.pending = false; state.ticket++ }
  }, [load])
  const filteredModels = (data?.models || []).filter(item => `${item.name || ''} ${item.id || ''}`.toLocaleLowerCase().includes(modelQuery.trim().toLocaleLowerCase()))
  const n = value => formatNumber(value, lang)
  const tok = value => formatTokens(value, lang)

  const labels = {
    ...c,
    cacheRead: lang === 'zh' ? '缓存读取 Token' : 'Cache read tokens',
    cacheWrite: lang === 'zh' ? '缓存写入 Token' : 'Cache write tokens',
    scope: lang === 'zh' ? `累计全部已记录用量 · 热图仅展示过去 ${weeks} 周` : `All recorded usage · heatmap shows the past ${weeks} weeks only`,
    cumulative: lang === 'zh' ? '累计用量' : 'Cumulative usage',
    window: lang === 'zh' ? '热图时间窗' : 'Heatmap window',
    heatmapScope: lang === 'zh' ? '仅改变热图；指标和模型表仍为累计用量' : 'Heatmap only; metrics and model totals remain cumulative',
    modelScope: lang === 'zh' ? '累计用量 · 与上方指标同一口径' : 'All recorded usage · same scope as the metrics above',
    filter: lang === 'zh' ? '筛选模型' : 'Filter models',
    noMatches: lang === 'zh' ? '无匹配模型' : 'No matching models',
    scroll: lang === 'zh' ? '横向滚动查看全部列 · Token 缩写可悬停查看精确值' : 'Scroll horizontally for all columns · hover token values for exact counts',
  }
  const cache = totals => ({ read: totals?.other?.cache_read_tokens || totals?.other?.cached_tokens || 0, write: totals?.other?.cache_creation_tokens || 0 })
  const tokenMetric = (key, label) => ({ key, label, ...tok(data?.totals?.[key]) })
  const model = {
    labels, loading, error, hasData: !!data, empty: data?.assistant_replies === 0,
    warning: data?.skipped_sessions > 0 ? `${n(data.skipped_sessions)} ${c.skipped}` : '',
    metrics: [tokenMetric('total_tokens', c.total), tokenMetric('input_tokens', c.input), tokenMetric('output_tokens', c.output),
      { key: 'cacheRead', label: labels.cacheRead, ...tok(cache(data?.totals).read) },
      { key: 'cacheWrite', label: labels.cacheWrite, ...tok(cache(data?.totals).write) },
      { key: 'sessions', label: c.sessions, short: `${n(data?.sessions_with_usage)} / ${n(data?.session_count)}` },
      { key: 'replies', label: c.replies, short: n(data?.assistant_replies) }],
    weeks, windowOptions: [13, 26, 52].map(value => ({ value, label: lang === 'zh' ? `过去 ${value} 周` : `Past ${value} weeks` })),
    heatmap: heatmapModel(data?.daily, lang, c, weeks),
    modelQuery, modelCount: `${filteredModels.length} / ${(data?.models || []).length} ${c.models}`,
    rows: filteredModels.map(item => ({ id: item.id, name: item.name || c.unknown, replies: n(item.assistant_replies),
      cacheRead: tok(cache(item.totals).read), cacheWrite: tok(cache(item.totals).write), input: tok(item.totals?.input_tokens), output: tok(item.totals?.output_tokens), total: tok(item.totals?.total_tokens) })),
  }
  const actions = {
    refresh: load,
    setWeeks: value => { if ([13, 26, 52].includes(value)) setWeeks(value) },
    setModelQuery: value => { if (typeof value === 'string') setModelQuery(value) },
  }
  return <UiSurface name="admin.usage" viewProps={{ model, actions }} fallback={<DefaultUsage model={model} actions={actions}/>}/>
}
