import React from 'react'
import { AlertTriangle, BarChart3, RefreshCw } from 'lucide-react'
import './usage.css'

function Heatmap({ model, actions }) {
  const { labels: copy, weeks, windowOptions, heatmap: { hint, months, weekdays, cells } } = model
  const onWeeksChange = actions.setWeeks
  return <section id="usage-activity" className="usage-card usage-heatmap-card" aria-labelledby="usage-heatmap-title">
    <div className="usage-section-head"><div><h2 id="usage-heatmap-title">{copy.heatmap}</h2><p>{hint}</p></div><label className="usage-time-filter">{copy.window}<select value={weeks} onChange={e=>onWeeksChange(Number(e.target.value))}>{windowOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><small>{copy.heatmapScope}</small></div>
    <div className="usage-heatmap-scroll" tabIndex={0} role="region" aria-label={hint}>
      <div className="usage-heatmap-frame">
        <div className="usage-months" style={{gridTemplateColumns:`repeat(${weeks},11px)`}} aria-hidden="true">{months.map(month => <span key={month.key} style={{ gridColumn: month.column }}>{month.label}</span>)}</div>
        <div className="usage-heatmap-body">
          <div className="usage-weekdays" aria-hidden="true"><span>{weekdays[0]}</span><span>{weekdays[1]}</span><span>{weekdays[2]}</span></div>
          <div className="usage-heatmap" role="img" aria-label={hint}>
            {cells.map(day => <span key={day.date} className="usage-heat-cell" data-level={day.level} title={day.label} aria-label={day.label}/>)}
          </div>
        </div>
        <div className="usage-heat-legend"><span>{copy.less}</span>{[0, 1, 2, 3, 4].map(item => <i key={item} data-level={item} />)}<span>{copy.more}</span></div>
      </div>
    </div>
  </section>
}

function Refresh({ model, actions }) {
  return <button type="button" onClick={actions.refresh} disabled={model.loading}><RefreshCw size={15} className={model.loading ? 'spin' : ''}/>{model.labels.refresh}</button>
}
function Notices({ model, actions }) {
  const c = model.labels
  return <>
    {model.loading && <div className="usage-state" role="status">{c.loading}</div>}
    {model.error && <div className="usage-state usage-error" role="alert"><strong>{c.failed}</strong><span>{model.error}</span><button type="button" onClick={actions.refresh} disabled={model.loading}>{c.retry}</button></div>}
    {!model.error && model.hasData && model.warning && <div className="usage-warning"><AlertTriangle size={16}/><span>{model.warning}</span></div>}
  </>
}
function Navigation({ model }) {
  const c = model.labels
  return <nav className="usage-section-nav" aria-label={c.title}><a href="#usage-totals">{c.total}</a>{!model.empty && <><a href="#usage-activity">{c.heatmap}</a><a href="#usage-models">{c.models}</a></>}</nav>
}
function ModelFilter({ model, actions }) {
  return <label>{model.labels.filter}<input type="search" value={model.modelQuery} onChange={e => actions.setModelQuery(e.target.value)}/></label>
}
function TokenValue({ value }) { return <span title={value.full}>{value.short}</span> }

export function DefaultUsage({ model, actions }) {
  const c = model.labels
  return <section className="usage-page" data-usage-layout="default" aria-busy={model.loading}>
    <div className="usage-intro"><div><span className="usage-eyebrow"><BarChart3 size={15}/>{c.title}</span><p>{c.intro}</p><small>{c.scope}</small></div><Refresh model={model} actions={actions}/></div>
    <Notices model={model} actions={actions}/>
    {!model.error && model.hasData && <>
      <Navigation model={model}/>
      <div id="usage-totals" className="usage-metrics" role="group" aria-label={c.cumulative}>{model.metrics.map((metric, index) => <div key={metric.key} className={`usage-metric${index === 0 ? ' usage-metric-accent' : ''}`} title={metric.full}><span>{metric.label}</span><strong>{metric.short}</strong></div>)}</div>
      {model.empty ? <div className="usage-state">{c.empty}</div> : <>
        <Heatmap model={model} actions={actions}/>
        <section id="usage-models" className="usage-panel">
          <div className="usage-model-head"><div><h3>{c.models}</h3><p>{c.modelScope}</p></div><ModelFilter model={model} actions={actions}/></div>
          <p className="usage-model-count" aria-live="polite">{model.modelCount}</p><p className="usage-scroll-hint">{c.scroll}</p>
          <div className="usage-table-wrap" tabIndex={0} role="region" aria-label={c.models}><table><thead><tr><th>{c.model}</th><th>{c.replies}</th><th>{c.input}</th><th>{c.output}</th><th>{c.total}</th></tr></thead><tbody>
            {model.rows.map(row => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.id}</small></td><td>{row.replies}</td><td><TokenValue value={row.input}/></td><td><TokenValue value={row.output}/></td><td><b><TokenValue value={row.total}/></b></td></tr>)}
            {!model.rows.length && <tr><td colSpan={5}>{c.noMatches}</td></tr>}
          </tbody></table></div>
        </section>
      </>}
    </>}
  </section>
}

export function StudioUsage({ model, actions }) {
  const c = model.labels
  return <section className="usage-page studio-usage" data-usage-layout="studio" aria-busy={model.loading}>
    <header className="studio-usage-header"><div><h2>{c.title}</h2><p>{c.intro}</p><small>{c.scope}</small></div><Refresh model={model} actions={actions}/></header>
    <Notices model={model} actions={actions}/>
    {!model.error && model.hasData && <>
      <Navigation model={model}/>
      <div className="studio-usage-workspace">
        <aside id="usage-totals" className="studio-usage-ledger" aria-label={c.cumulative}><h3>{c.cumulative}</h3><dl>{model.metrics.map(metric => <div key={metric.key}><dt>{metric.label}</dt><dd title={metric.full}>{metric.short}</dd></div>)}</dl></aside>
        <div className="studio-usage-detail">
          {model.empty ? <div className="usage-state">{c.empty}</div> : <>
            <section id="usage-models" className="studio-usage-models">
              <header className="usage-model-head"><div><h3>{c.models}</h3><p>{c.modelScope}</p></div><ModelFilter model={model} actions={actions}/></header>
              <p className="usage-model-count" aria-live="polite">{model.modelCount}</p>
              <ul className="studio-usage-model-list" aria-label={c.models}>{model.rows.map(row => <li key={row.id}>
                <header><div><strong>{row.name}</strong><small>{row.id}</small></div><b><TokenValue value={row.total}/><small>{c.total}</small></b></header>
                <dl><div><dt>{c.replies}</dt><dd>{row.replies}</dd></div><div><dt>{c.input}</dt><dd><TokenValue value={row.input}/></dd></div><div><dt>{c.output}</dt><dd><TokenValue value={row.output}/></dd></div></dl>
              </li>)}</ul>
              {!model.rows.length && <p className="usage-state">{c.noMatches}</p>}
            </section>
            <Heatmap model={model} actions={actions}/>
          </>}
        </div>
      </div>
    </>}
  </section>
}
