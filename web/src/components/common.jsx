import React, { useState } from 'react'
import { Eye, Play, Square } from 'lucide-react'
import { modelLabel } from '../lib/format'

const serviceCommand = (svc) => Array.isArray(svc?.command) ? svc.command.join(' ') : (svc?.command || '-')
const servicePid = (svc) => svc?.pid ?? '-'
const serviceReturnCode = (svc) => svc?.returncode ?? svc?.return_code ?? '-'
const serviceStartedAt = (svc) => svc?.started_at || '-'
const serviceLogPath = (svc) => svc?.log_path || svc?.log || ''

function ServiceMeta({ svc, compact = false, llms = [], onModel, t }) {
  const cmd = serviceCommand(svc)
  const logPath = serviceLogPath(svc)
  const text = t?.service || {}
  const isReflect = svc?.kind === 'reflect' || String(svc?.name || '').startsWith('reflect/')
  const modelMatch = (svc?.model_no === null || svc?.model_no === undefined) ? null : llms.find(m => m.index === svc.model_no)
  const defaultLabel = text.defaultModel || 'Default'
  const modelText = modelMatch ? modelLabel(modelMatch) : (isReflect ? defaultLabel : null)
  const editable = isReflect && !svc?.running && typeof onModel === 'function'
  return <div className={compact ? 'service-meta service-meta-compact' : 'service-meta'}>
    {editable
      ? <span className="model-edit"><em>{text.model}</em><select value={svc.model_no ?? ''} onChange={e => onModel(svc.name, e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">{defaultLabel}</option>
          {llms.map(m => <option key={m.index} value={m.index}>{modelLabel(m)}</option>)}
        </select></span>
      : (modelText !== null && <span><em>{text.model}</em><code title={modelText}>{modelText}</code></span>)}
    <span><em>PID</em><b>{servicePid(svc)}</b></span>
    <span><em>{text.returnCode}</em><b>{serviceReturnCode(svc)}</b></span>
    <span><em>{text.startedAt}</em><code title={serviceStartedAt(svc)}>{serviceStartedAt(svc)}</code></span>
    <span><em>{text.workdir}</em><code title={svc?.workdir}>{svc?.workdir || '-'}</code></span>
    <span><em>{text.command}</em><code title={cmd}>{cmd}</code></span>
    {logPath && <span><em>{text.log}</em><code title={logPath}>{logPath}</code></span>}
  </div>
}

export function Stat({ label, value, icon }) { return <div className="stat"><div>{icon}</div><span>{label}</span><b>{value}</b></div> }
export function Panel({ title, children, className = '' }) { return <div className={`panel ${className}`}><div className="panel-title">{title}</div>{children}</div> }
export function EntryList({ items = [], empty }) { return <div className="entry-list">{items.length ? items.map((e, i) => <div className="entry" key={`${e.path || e.name}-${i}`}><b>{e.name || e.path}</b><span>{e.path}{e.kind ? ` - ${e.kind}` : ''}{e.size ? ` - ${e.size} B` : ''}</span></div>) : <p className="muted">{empty}</p>}</div> }
export function ServiceRow({ svc, onStart, onStop, onLogs, onAutostart, onModel, llms = [], t, actionState = null }) {
  const isReflect = svc?.kind === 'reflect' || String(svc?.name || '').startsWith('reflect/')
  const descKey = String(svc?.name || '').includes('scheduler') ? 'scheduler' : (String(svc?.name || '').includes('autonomous') ? 'autonomous' : null)
  const desc = isReflect && descKey ? t?.serviceDesc?.[descKey] : null
  const isPending = actionState?.status === 'pending'
  const retryAction = actionState?.action === 'stop' ? onStop : onStart
  return <article className={`service-card ${svc.running ? 'is-running' : 'is-stopped'}`} aria-busy={isPending || undefined}>
    <div className="service-card-head">
      <div className="service-title"><b>{svc.name}</b><span>{svc.kind}</span></div>
      <span className={svc.running ? 'status-pill running' : 'status-pill stopped'}>{svc.running ? t.running : t.stopped}</span>
    </div>
    {desc && <p className="service-desc">{desc}</p>}
    <ServiceMeta svc={svc} llms={llms} onModel={onModel} t={t}/>
    <div className="svc-actions service-actions-row">
      <button disabled={isPending || svc.running} onClick={() => onStart(svc.name)}><Play size={14}/>{t.start}</button>
      <button disabled={isPending || !svc.running} onClick={() => onStop(svc.name)}><Square size={14}/>{t.stop}</button>
      <button onClick={() => onLogs?.(svc.name)}><Eye size={14}/>{t.logs}</button>
      <label className="toggle-inline"><input type="checkbox" checked={!!svc.autostart} onChange={e => onAutostart?.(svc.name, e.target.checked)} />{t.autostartService}</label>
    </div>
    {actionState?.message && <div className={`service-action-status ${actionState.status || ''}`} role={actionState.status === 'error' ? 'alert' : 'status'} aria-live="polite">
      <span>{actionState.message}</span>
      {actionState.status === 'error' && <button type="button" onClick={() => retryAction?.(svc.name)}>{t.retry || 'Retry'}</button>}
    </div>}
  </article>
}
export function ChannelServiceTable({ services = [], onStart, onStop, onLogs, onAutostart, onReflectStart, t, actionState = null }) {
  if (!services.length) return <div className="channel-service-empty">{t.hints.noFrontend}</div>
  const isReflectService = (svc) => svc?.kind === 'reflect' || String(svc?.name || '').startsWith('reflect/')
  return <div className="channel-service-list">{services.map(svc => {
    const state = actionState?.name === svc.name ? actionState : actionState?.[svc.name]
    const isPending = state?.status === 'pending'
    const startAction = isReflectService(svc) && onReflectStart ? onReflectStart : onStart
    const retryAction = state?.action === 'stop' ? onStop : startAction
    return <article className={`channel-service-card ${svc.running ? 'is-running' : 'is-stopped'}`} key={svc.name} aria-busy={isPending || undefined}>
    <div className="channel-service-main">
      <div><b>{svc.name}</b><small>{svc.kind}</small></div>
      <span className={svc.running ? 'status-pill running' : 'status-pill stopped'}>{svc.running ? t.running : t.stopped}</span>
    </div>
    <ServiceMeta svc={svc} compact t={t}/>
    <div className="channel-service-actions">
      <label className="toggle-inline"><input type="checkbox" checked={!!svc.autostart} onChange={e => onAutostart?.(svc.name, e.target.checked)} />{svc.autostart ? t.enabled : t.disabled}</label>
      <div className="svc-actions"><button disabled={isPending || svc.running} onClick={() => startAction(svc.name)}><Play size={14}/>{t.start}</button><button disabled={isPending || !svc.running} onClick={() => onStop(svc.name)}><Square size={14}/>{t.stop}</button><button onClick={() => onLogs?.(svc.name)}><Eye size={14}/>{t.logs}</button></div>
    </div>
    {state?.message && <div className={`service-action-status ${state.status || ''}`} role={state.status === 'error' ? 'alert' : 'status'} aria-live="polite">
      <span>{state.message}</span>
      {state.status === 'error' && <button type="button" onClick={() => retryAction?.(svc.name)}>{t.retry || 'Retry'}</button>}
    </div>}
  </article>
  })}</div>
}

const count = (items) => Array.isArray(items) ? items.length : 0

export function DangerRecoveryNotice({
  operation = 'Dangerous operation',
  changes = '',
  recoverable = '',
  backup = '',
  recovery = '',
  children,
}) {
  const items = [
    ['变更内容', changes || '确认后可能写入本地配置、文件或进程状态。'],
    ['What remains recoverable', recoverable || 'Existing confirmation gates stay in place; no request is sent unless the user confirms.'],
    backup && ['Backup hint', backup],
    recovery && ['Recovery hint', recovery],
  ].filter(Boolean)
  return <aside className="danger-recovery-notice" aria-label={`${operation} recovery guidance`}>
    <div className="danger-recovery-head"><b>{operation}</b><span>确认前请先核对恢复信息</span></div>
    <ul>{items.map(([label, value]) => <li key={label}><span>{label}</span><p>{value}</p></li>)}</ul>
    {children && <div className="danger-recovery-extra">{children}</div>}
  </aside>
}

export function ObservabilityCard({ snapshot, error = '', onRefresh, labels = {} }) {
  const text = {
    observability: '只读观测',
    healthChecks: '健康检查',
    coreFiles: '核心文件',
    memorySops: '记忆 SOP',
    riskRules: '风险规则',
    healthy: '健康端点报告正常',
    needsAttention: '健康端点需要关注',
    awaitingSnapshot: '等待只读快照',
    generatedAt: '生成时间',
    missingCore: '核心文件缺失',
    refresh: '刷新',
    ...labels,
  }
  const stats = [
    [text.healthChecks, count(snapshot?.checks)],
    [text.coreFiles, count(snapshot?.coreFiles?.filter?.(item => item?.exists) || [])],
    [text.memorySops, count(snapshot?.memory?.sops)],
    [text.riskRules, count(snapshot?.riskItems)],
  ]
  const missing = snapshot?.missingCore || []
  return <section className="observability-card" aria-label={text.observability}>
    <div className="observability-head">
      <div><b>{text.observability}</b><span>{snapshot?.root || 'GET /api/health + /api/ga/inventory + /api/risk/catalog'}</span></div>
      <button type="button" onClick={onRefresh}>{text.refresh}</button>
    </div>
    {error ? <p className="err-text">{error}</p> : <>
      <div className="observability-stats">{stats.map(([label, value]) => <span key={label}><em>{label}</em><b>{value}</b></span>)}</div>
      <div className="observability-body">
        <p className={snapshot?.ok ? 'ok' : 'warn'}>{snapshot ? (snapshot.ok ? text.healthy : text.needsAttention) : text.awaitingSnapshot}</p>
        {snapshot?.generatedAt && <p className="muted">{text.generatedAt}: {snapshot.generatedAt}</p>}
        {missing.length > 0 && <p className="warn">{text.missingCore}: {missing.map(x => x.path || x.name).join(', ')}</p>}
      </div>
    </>}
  </section>
}

export function SecretInput({ value, onChange, t }) { const [show, setShow] = useState(false); return <div className="secret-row"><input type={show ? 'text' : 'password'} value={value || ''} placeholder={t.hints.savedSecret} onChange={e => onChange(e.target.value)} /><button type="button" onClick={() => setShow(!show)}>{show ? t.hide : t.show}</button></div> }
