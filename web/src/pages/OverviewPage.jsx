import './overview-workbench.css'
import React, { useEffect, useState } from 'react'
import { Activity, CalendarClock, Download, FileCode2, MessageSquare, Play, Power, RefreshCw, Server, ShieldAlert } from 'lucide-react'
import { navigateToNewChat } from '../lib/chatLaunchIntent'

const countOf = (items) => Array.isArray(items) ? items.length : 0

const CHECK_TONE = {
  ok: 'ok',
  optional_missing: 'warn',
  empty: 'warn',
  missing: 'err',
}

export function sourceAvailability(gitStatus, copy) {
  const sourceAvailable = gitStatus?.available !== false
  const sourceUnavailableReason = sourceAvailable
    ? ''
    : (copy.sourceUnavailableReasons?.[gitStatus?.reason] || copy.sourceUnavailableMessage)
  const sourceState = !sourceAvailable
    ? copy.sourceUnavailable
    : (gitStatus?.error
        ? copy.checkFailed
        : (gitStatus
            ? (gitStatus.upstream_configured === false
                ? copy.upstreamMissing
                : (gitStatus.latest ? copy.current : copy.sourceStatusBehind(gitStatus.behind || 0)))
            : copy.notChecked))
  return { sourceAvailable, sourceUnavailableReason, sourceState }
}

function Stat({ icon, label, value }) {
  return <div className="stat">
    <div aria-hidden="true">{icon}</div>
    <span>{label}</span>
    <b>{value}</b>
  </div>
}

function Panel({ area, title, children }) {
  return <section id={`overview-${area}`} tabIndex={-1} aria-label={title} className={`overview-panel overview-panel-${area}`}>
    <h3 className="panel-title">{title}</h3>
    {children}
  </section>
}

export function OverviewPage({
  t, text, services, schedule, observability, observabilityError, onRefreshObservability, version, root,
  githubMirror = '', onSaveGitHubMirror,
}) {
  const copy = t.overview
  const [mirrorDraft, setMirrorDraft] = useState(githubMirror)
  const [mirrorBaseline, setMirrorBaseline] = useState(githubMirror)
  const [mirrorSaving, setMirrorSaving] = useState(false)
  const [mirrorNotice, setMirrorNotice] = useState(null)
  useEffect(() => {
    const nextMirror = githubMirror || ''
    setMirrorDraft(nextMirror)
    setMirrorBaseline(nextMirror)
  }, [githubMirror])
  const mirrorDirty = mirrorDraft !== mirrorBaseline
  const saveGitHubMirror = async () => {
    if (!mirrorDirty || typeof onSaveGitHubMirror !== 'function') return
    setMirrorSaving(true)
    setMirrorNotice(null)
    try {
      const savedMirror = await onSaveGitHubMirror(mirrorDraft)
      setMirrorDraft(savedMirror || '')
      setMirrorBaseline(savedMirror || '')
      setMirrorNotice({ kind: 'success', message: copy.githubMirrorSaved })
    } catch (error) {
      setMirrorNotice({ kind: 'error', message: copy.githubMirrorSaveFailed(error.message) })
    } finally {
      setMirrorSaving(false)
    }
  }
  const { info, check, status, busy, gitBusy, gitStatus, autostart } = version
  const updateMessage = status?.error || (status?.stage === 'queued' ? copy.updateQueued : (status?.message || status?.stage))
  const missingCore = observability?.missingCore || []
  const { sourceAvailable, sourceUnavailableReason, sourceState } = sourceAvailability(gitStatus, copy)
  const running = (services || []).filter(service => service.running)
  const checks = observability?.checks || []
  const failedChecks = checks.filter(item => item.state && item.state !== 'ok' && item.state !== 'optional_missing')
  const advisoryChecks = checks.filter(item => item.state === 'optional_missing' || item.state === 'empty')
  const errors = observability?.errors || []
  const warnings = observability?.warnings || []
  const healthTone = observabilityError ? 'err' : (observability ? (observability.ok ? 'ok' : 'err') : 'wait')
  const healthLabel = observabilityError
    ? observabilityError
    : (observability ? (observability.ok ? copy.healthy : copy.needsAttention) : copy.awaitingSnapshot)
  const checkLabel = (state) => copy.checkStates?.[state] || state
  const displayedRoot = root || observability?.root || ''

  const english = t.refresh === 'Refresh'
  const labels = english
    ? { status: 'Runtime status', maintenance: 'Maintenance', network: 'Download network', scope: 'Saves only the GitHub mirror. Updates and startup are controlled separately.' }
    : { status: '运行状态', maintenance: '维护与更新', network: '下载网络', scope: '仅保存 GitHub 镜像，更新和开机启动需分别操作。' }
  return <div className="overview-page">
    <nav className="overview-nav" aria-label={english ? 'Overview sections' : '总览分区'}>
      <a href="#overview-status">{labels.status}</a>
      <a href="#overview-updates">{labels.maintenance}</a>
      <a href="#overview-network">{labels.network}</a>
    </nav>
    <div className="overview-stats">
      <Stat icon={<Server size={16}/>} label={t.cards.processes} value={countOf(services)}/>
      <Stat icon={<Play size={16}/>} label={t.cards.running} value={running.length}/>
      <Stat icon={<CalendarClock size={16}/>} label={t.cards.schedule} value={schedule.task_count || 0}/>
      <Stat icon={<Activity size={16}/>} label={copy.healthChecks} value={countOf(observability?.checks)}/>
      <Stat icon={<FileCode2 size={16}/>} label={copy.coreFiles} value={countOf(observability?.coreFiles?.filter?.(item => item?.exists) || [])}/>
      <Stat icon={<ShieldAlert size={16}/>} label={copy.riskRules} value={countOf(observability?.riskItems)}/>
    </div>

    <section id="overview-status" tabIndex={-1} className="overview-health" aria-label={copy.observability}>
      <div className="overview-health-head">
        <div>
          <b>{copy.observability}</b>
          <span>{displayedRoot || text.about.statusDesc}</span>
        </div>
        <span className={`overview-health-state is-${healthTone}`}>{healthLabel}</span>
        <button type="button" onClick={onRefreshObservability}><RefreshCw size={14}/>{t.refresh}</button>
      </div>

      {observabilityError
        ? <p className="err-text" role="alert">{observabilityError}</p>
        : !observability ? <p className="muted" role="status">{copy.awaitingSnapshot}</p>
        : <>
          <div className="overview-health-meta">
            {displayedRoot && <code>{displayedRoot}</code>}
            {observability?.generatedAt && <small>{copy.generatedAt}: {observability.generatedAt}</small>}
          </div>

          <div className="overview-health-grid">
            <div>
              <h4>{failedChecks.length || errors.length ? copy.failedChecks : copy.allClear}</h4>
              {errors.length > 0 && <ul className="overview-list is-err">{errors.map(item => <li key={item}>{item}</li>)}</ul>}
              {failedChecks.length > 0 && <ul className="overview-checks">
                {failedChecks.map(item => <li key={item.name} className={`is-${CHECK_TONE[item.state] || 'err'}`}>
                  <code>{item.name}</code>
                  <span>{checkLabel(item.state)}</span>
                </li>)}
              </ul>}
              {!errors.length && !failedChecks.length && <p className="muted">{copy.allClear}</p>}
              {(advisoryChecks.length > 0 || warnings.length > 0) && <>
                <h4>{copy.advisory}</h4>
                {warnings.length > 0 && <ul className="overview-list is-warn">{warnings.map(item => <li key={item}>{item}</li>)}</ul>}
                {advisoryChecks.length > 0 && <ul className="overview-checks">
                  {advisoryChecks.map(item => <li key={item.name} className="is-warn">
                    <code>{item.name}</code>
                    <span>{checkLabel(item.state)}</span>
                  </li>)}
                </ul>}
              </>}
              {missingCore.length > 0 && <p className="warn">{copy.missingCore}: {missingCore.map(x => x.path || x.name).join(', ')}</p>}
            </div>
            <div>
              <h4>{copy.runningServices}</h4>
              {running.length
                ? <ul className="overview-list">{running.map(service => <li key={service.name}>{service.name}{service.pid ? ` · PID ${service.pid}` : ''}</li>)}</ul>
                : <p className="muted">{copy.noRunning}</p>}
            </div>
          </div>
          <p className="overview-backup"><ShieldAlert size={14} aria-hidden="true"/>{text.about.backupNote}</p>
        </>}
    </section>

    <div className="overview-operations">
      <Panel area="updates" title={t.cards.version}>
        <div className="version-card">
          <div className="version-head">
            <Download size={16} aria-hidden="true"/>
            <strong>GA Admin {info?.version || 'dev'}</strong>
            <span className={check?.update ? 'warn' : ''}>
              {check ? (check.update ? copy.updateAvailable : copy.current) : (info?.goos ? `${info.goos}/${info.goarch}` : t.empty)}
            </span>
          </div>
          <p className="muted">{copy.commit} {info?.commit || copy.unknown} · {info?.date || copy.unknown} · {copy.runtime} {info?.runtime || '-'}</p>
          {info && !info.update_supported && <p className="warn">{copy.updateUnavailable}: {info.update_unsupported_reason || copy.platformUnsupported}</p>}
          {check?.latest && <p>{copy.latestVersion}: <a href={check.latest.html_url} target="_blank" rel="noreferrer">{check.latest.tag_name}</a></p>}
          {status?.stage && <div className="update-progress">
            <div className="update-progress-head">
              <span>{status.running ? copy.updateRunning : (status.error ? copy.updateFailed : copy.updateStatus)}</span>
              <b>{status.progress || 0}%</b>
            </div>
            <div className="progress-bar"><span style={{ width: `${Math.max(0, Math.min(100, status.progress || 0))}%` }}/></div>
            <p className={status.error ? 'err' : 'muted'}>{updateMessage}</p>
            <code>{status.stage}</code>
          </div>}
          <div className="overview-panel-actions">
            <button type="button" onClick={version.checkVersion} disabled={busy || status?.running}>{busy ? t.busy : copy.checkUpdate}</button>
            <button className="primary" type="button" onClick={version.updateVersion} disabled={busy || status?.running || !check?.update}>
              <Download size={14} aria-hidden="true"/>{status?.running ? `${copy.updateRunning}…` : copy.oneClickUpdate}
            </button>
            {status?.stage === 'ready' && <button className="danger" type="button" onClick={version.restartVersion} disabled={busy}>
              <Power size={14} aria-hidden="true"/>{copy.restartToApply}
            </button>}
          </div>
        </div>
      </Panel>

      <Panel area="autostart" title={copy.autostartTitle}>
        <div className="autostart-card">
          <div className="autostart-head">
            <Power size={16} aria-hidden="true"/>
            <strong>{t.autostart}</strong>
            <span className={autostart?.enabled ? 'ok' : ''}>{autostart?.enabled ? t.enabled : (autostart?.supported ? t.disabled : t.unsupported)}</span>
          </div>
          <p className="muted">{autostart?.enabled ? copy.autostartOn : (autostart?.supported === false ? t.hints.autostartUnsupported : copy.autostartOff)}</p>
          {autostart?.path && <code>{autostart.path}</code>}
          <div className="overview-panel-actions">
            <button
              className={autostart?.enabled ? '' : 'primary'}
              type="button"
              onClick={version.toggleAutostart}
              disabled={busy || !autostart?.supported}
            >{autostart?.enabled ? t.disableAutostart : t.enableAutostart}</button>
          </div>
        </div>
      </Panel>

      <Panel area="source" title={copy.sourceTitle}>
        <p className="muted">{copy.sourceDescription}</p>
        <div className="overview-kv">
          <span>{copy.gitUpdate}</span>
          <em className={(gitStatus?.error || !sourceAvailable) ? 'is-off' : (gitStatus?.latest ? 'is-on' : '')}>{sourceState}</em>
        </div>
        {sourceAvailable && <div className="overview-kv">
          <span>{copy.branch}</span>
          <code>{gitStatus?.branch || '-'} · {gitStatus?.commit || '-'}</code>
        </div>}
        {sourceAvailable && gitStatus?.upstream && <p className="muted">{copy.upstream}: {gitStatus.upstream} · {copy.ahead} {gitStatus.ahead || 0} / {copy.behind} {gitStatus.behind || 0}</p>}
        {!sourceAvailable && <p className="warn">{sourceUnavailableReason}</p>}
        {sourceAvailable && gitStatus?.upstream_configured === false && <p className="warn">{copy.upstreamHelp}</p>}
        {gitStatus?.dirty && <p className="warn">{copy.dirty}</p>}
        {gitStatus?.error && <p className="err">{gitStatus.error}</p>}
        {gitStatus?.fetch_error && <pre className="mini-log">{gitStatus.fetch_error}</pre>}
        <p className="overview-update-hint">
          <MessageSquare size={14} aria-hidden="true"/>
          <span>{copy.sourceSelfUpdateBefore}<code>/update</code>{copy.sourceSelfUpdateAfter}</span>
        </p>
        <div className="overview-panel-actions">
          {sourceAvailable && <button type="button" onClick={version.checkSource} disabled={gitBusy}>{gitBusy ? t.busy : copy.checkLatest}</button>}
          <button className="primary" type="button" onClick={() => navigateToNewChat('/update')}>
            <MessageSquare size={14} aria-hidden="true"/>{copy.sourceSelfUpdateCta}
          </button>
        </div>
      </Panel>
      <Panel area="network" title={labels.network}>
          <p className="overview-save-scope">{labels.scope}</p>
          <form className="overview-mirror" onSubmit={(event) => { event.preventDefault(); saveGitHubMirror() }}>
            <label htmlFor="overview-github-mirror">{text.network.githubMirror}</label>
            <p id="overview-github-mirror-help" className="muted">{text.network.githubMirrorHelp}</p>
            <div className="overview-mirror-control">
              <input
                id="overview-github-mirror"
                type="url"
                value={mirrorDraft}
                onChange={(event) => { setMirrorDraft(event.target.value); setMirrorNotice(null) }}
                placeholder={text.network.githubMirrorPlaceholder}
                aria-describedby="overview-github-mirror-help"
              />
              <button className="primary" type="submit" disabled={mirrorSaving || !mirrorDirty || typeof onSaveGitHubMirror !== 'function'}>
                {mirrorSaving ? t.busy : copy.saveGitHubMirror}
              </button>
            </div>
            {mirrorNotice && <p className={`overview-mirror-notice ${mirrorNotice.kind}`} role="status">{mirrorNotice.message}</p>}
          </form>
      </Panel>
    </div>
  </div>
}

export default OverviewPage
