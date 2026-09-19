import './usage-workbench.css'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, RefreshCw } from 'lucide-react'
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
    heatmap: '每日活跃度', heatmapHint: '过去 52 周 · 按每日 Token 用量着色', less: '少', more: '多',
  },
  en: {
    title: 'Cumulative token usage', intro: 'Calculated from locally persisted chat sessions. Message content is never returned.',
    total: 'Total tokens', input: 'Input tokens', output: 'Output tokens', sessions: 'Sessions with usage', replies: 'Measured replies',
    models: 'By model', model: 'Model', empty: 'No token usage has been recorded yet.',
    loading: 'Aggregating session usage…', failed: 'Unable to load usage overview', retry: 'Retry', refresh: 'Refresh', skipped: 'session files could not be read and were skipped.', unknown: 'Unknown model',
    heatmap: 'Daily activity', heatmapHint: 'Past 52 weeks · colored by daily token usage', less: 'Less', more: 'More',
  },
}

function Metric({ label, value, title, accent }) {
  return <div className={`usage-metric${accent ? ' usage-metric-accent' : ''}`} title={title}><span>{label}</span><strong>{value}</strong></div>
}

function UsageHeatmap({ daily = [], lang, copy, weeks, onWeeksChange }) {
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
  return <section id="usage-activity" className="usage-card usage-heatmap-card" aria-labelledby="usage-heatmap-title">
    <div className="usage-section-head"><div><h2 id="usage-heatmap-title">{copy.heatmap}</h2><p>{hint}</p></div><label className="usage-time-filter">{lang === 'zh' ? '热图时间窗' : 'Heatmap window'}<select value={weeks} onChange={e=>onWeeksChange(Number(e.target.value))}>{[13,26,52].map(w=><option key={w} value={w}>{lang === 'zh' ? `过去 ${w} 周` : `Past ${w} weeks`}</option>)}</select></label><small>{lang === 'zh' ? '仅改变热图；指标和模型表仍为累计用量' : 'Heatmap only; metrics and model totals remain cumulative'}</small></div>
    <div className="usage-heatmap-scroll" tabIndex={0} role="region" aria-label={hint}>
      <div className="usage-heatmap-frame">
        <div className="usage-months" style={{gridTemplateColumns:`repeat(${weeks},11px)`}} aria-hidden="true">{months.map(month => <span key={month.key} style={{ gridColumn: month.column }}>{month.label}</span>)}</div>
        <div className="usage-heatmap-body">
          <div className="usage-weekdays" aria-hidden="true"><span>{weekdays[0]}</span><span>{weekdays[1]}</span><span>{weekdays[2]}</span></div>
          <div className="usage-heatmap" role="img" aria-label={hint}>
            {cells.map(day => { const tokens = Number(day.totals?.total_tokens) || 0; const label = `${dateFormat.format(new Date(`${day.date}T00:00:00`))}: ${formatNumber(tokens, lang)} Token, ${formatNumber(day.assistant_replies, lang)} ${copy.replies}`; return <span key={day.date} className="usage-heat-cell" data-level={level(tokens)} title={label} aria-label={label} /> })}
          </div>
        </div>
        <div className="usage-heat-legend"><span>{copy.less}</span>{[0, 1, 2, 3, 4].map(item => <i key={item} data-level={item} />)}<span>{copy.more}</span></div>
      </div>
    </div>
  </section>
}

export function UsagePage({ lang = 'zh' }) {
  const c = COPY[lang] || COPY.zh
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [weeks, setWeeks] = useState(52)
  const [modelQuery, setModelQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await api('/api/usage/overview')) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  const filteredModels = (data?.models || []).filter(item => `${item.name || ''} ${item.id || ''}`.toLocaleLowerCase().includes(modelQuery.trim().toLocaleLowerCase()))
  const n = value => formatNumber(value, lang)
  const tok = value => formatTokens(value, lang)

  return <section className="usage-page" aria-busy={loading}>
    <div className="usage-intro">
      <div><span className="usage-eyebrow"><BarChart3 size={15}/>{c.title}</span><p>{c.intro}</p><small>{lang === 'zh' ? `累计全部已记录用量 · 热图仅展示过去 ${weeks} 周` : `All recorded usage · heatmap shows the past ${weeks} weeks only`}</small></div>
      <button type="button" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''}/>{c.refresh}</button>
    </div>

    {loading && <div className="usage-state" role="status">{c.loading}</div>}
    {error && <div className="usage-state usage-error" role="alert"><strong>{c.failed}</strong><span>{error}</span><button type="button" onClick={load} disabled={loading}>{c.retry}</button></div>}
    {!error && data && <>
      {data.skipped_sessions > 0 && <div className="usage-warning"><AlertTriangle size={16}/><span>{n(data.skipped_sessions)} {c.skipped}</span></div>}
      <nav className="usage-section-nav" aria-label={c.title}><a href="#usage-totals">{c.total}</a>{data.assistant_replies !== 0 && <><a href="#usage-activity">{c.heatmap}</a><a href="#usage-models">{c.models}</a></>}</nav>
      <div id="usage-totals" className="usage-metrics" role="group" aria-label={lang === 'zh' ? '累计用量' : 'Cumulative usage'}>
        <Metric label={c.total} value={tok(data.totals?.total_tokens).short} title={tok(data.totals?.total_tokens).full} accent/>
        <Metric label={c.input} value={tok(data.totals?.input_tokens).short} title={tok(data.totals?.input_tokens).full}/>
        <Metric label={c.output} value={tok(data.totals?.output_tokens).short} title={tok(data.totals?.output_tokens).full}/>
        <Metric label={c.sessions} value={`${n(data.sessions_with_usage)} / ${n(data.session_count)}`}/>
        <Metric label={c.replies} value={n(data.assistant_replies)}/>
      </div>
      {data.assistant_replies === 0 ? <div className="usage-state">{c.empty}</div> : <>
        <UsageHeatmap daily={data.daily} lang={lang} copy={c} weeks={weeks} onWeeksChange={setWeeks}/>
        <section id="usage-models" className="usage-panel"><div className="usage-model-head"><div><h3>{c.models}</h3><p>{lang === 'zh' ? '累计用量 · 与上方指标同一口径' : 'All recorded usage · same scope as the metrics above'}</p></div><label>{lang === 'zh' ? '筛选模型' : 'Filter models'}<input type="search" value={modelQuery} onChange={e=>setModelQuery(e.target.value)}/></label></div><p className="usage-model-count" aria-live="polite">{filteredModels.length} / {(data.models || []).length} {c.models}</p><p className="usage-scroll-hint">{lang === 'zh' ? '横向滚动查看全部列 · Token 缩写可悬停查看精确值' : 'Scroll horizontally for all columns · hover token values for exact counts'}</p><div className="usage-table-wrap" tabIndex={0} role="region" aria-label={c.models}><table><thead><tr><th>{c.model}</th><th>{c.replies}</th><th>{c.input}</th><th>{c.output}</th><th>{c.total}</th></tr></thead><tbody>{filteredModels.map(item => <tr key={item.id}><td><strong>{item.name || c.unknown}</strong><small>{item.id}</small></td><td>{n(item.assistant_replies)}</td><td title={tok(item.totals?.input_tokens).full}>{tok(item.totals?.input_tokens).short}</td><td title={tok(item.totals?.output_tokens).full}>{tok(item.totals?.output_tokens).short}</td><td title={tok(item.totals?.total_tokens).full}><b>{tok(item.totals?.total_tokens).short}</b></td></tr>)}{filteredModels.length === 0 && <tr><td colSpan={5}>{lang === 'zh' ? '无匹配模型' : 'No matching models'}</td></tr>}</tbody></table></div></section></>}
    </>}
  </section>
}
