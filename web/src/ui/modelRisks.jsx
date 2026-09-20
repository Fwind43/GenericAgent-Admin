import React from 'react'
import './modelRisks.css'

export function DefaultModelRisks({ view }) {
  const { labels: t } = view
  return <section data-model-risks="default" className="model-risks-default" aria-label={t.riskTitle}>
    <h3>{t.riskTitle}</h3>
    <p role="status">{view.unavailable ? t.riskUnavailable : view.total ? t.riskReady : t.riskEmpty}</p>
    <p>{t.riskHelp}</p>
    {view.items.length > 0 && <table><tbody>{view.items.map(item => <tr key={item.id}>
      <th scope="row"><code>{item.method} {item.path}</code></th><td>{item.level}</td><td><strong>{item.action}</strong><p>{item.reason}</p></td>
    </tr>)}</tbody></table>}
    {view.missingGates.length > 0 && <div role="alert"><strong>{t.missingGates}</strong><ul>{view.missingGates.map(path => <li key={path}><code>{path}</code></li>)}</ul></div>}
    <div className="model-risks-counts"><span>{t.errors}</span><span>{t.warnings}</span></div>
  </section>
}

export function StudioModelRisks({ view }) {
  const { labels: t } = view
  return <section data-model-risks="studio" className="model-risks-studio" aria-label={t.riskTitle}>
    <header><h3>{t.riskTitle}</h3><p role="status">{view.unavailable ? t.riskUnavailable : view.total ? t.riskReady : t.riskEmpty}</p></header>
    <div className="model-risks-dashboard"><dl><dt>{t.errors}</dt><dd>{view.errors}</dd><dt>{t.warnings}</dt><dd>{view.warnings}</dd></dl>
      <aside><p>{t.riskHelp}</p>{view.missingGates.length > 0 && <section role="alert"><h4>{t.missingGates}</h4>{view.missingGates.map(path => <p key={path}><code>{path}</code></p>)}</section>}
      </aside></div>
    <div className="model-risks-cards">{view.items.map(item => <article key={item.id}><header><code>{item.method} {item.path}</code><b>{item.level}</b></header><h4>{item.action}</h4><p>{item.reason}</p></article>)}</div>
  </section>
}
