import React from 'react'
import Modal from 'antd/es/modal'
import { AlertCircle, CheckCircle2, Download, ExternalLink, RefreshCw, RotateCw } from 'lucide-react'
import { updateText, versionUpdateView } from '../lib/versionUpdateView'
import './system-update-modal.css'

const dateLabel = (value, lang, fallback) => {
  const date = new Date(value)
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN') : fallback
}

export default function SystemUpdateModal({ open, onClose, version, lang = 'zh' }) {
  const text = updateText(lang)
  const { info, check, status, checking, checkError, statusError, actionError } = version
  const view = versionUpdateView(version, lang)
  const release = check?.latest
  const icon = view.tone === 'error' ? <AlertCircle size={18}/> : view.tone === 'success' ? <CheckCircle2 size={18}/> : <Download size={18}/>
  return <Modal open={open} onCancel={onClose} footer={null} width={860} className="system-update-modal" title={text.title} mask={{ closable: false }}>
    <div className="system-update-body">
      <p className="system-update-subtitle">{text.subtitle}</p>
      <div className="system-update-versions">
        <div><span>{text.current}</span><strong>{info?.version || text.unknown}</strong><small>{[info?.goos, info?.goarch].filter(Boolean).join(' / ') || text.unknown}</small></div>
        <div><span>{text.latest}</span><strong>{release?.tag_name || text.notChecked}</strong><small>{check?.checked_at ? `${text.checkedAt} ${dateLabel(check.checked_at, lang, text.unknown)}` : text.notesUnchecked}</small></div>
        <div className={view.pending ? 'has-pending' : ''}><span>{text.pending}</span><strong>{view.pending || '—'}</strong><small>{view.pending ? view.label : text.noPending}</small></div>
      </div>
      <dl className="system-update-build"><dt>{text.build}</dt><dd>{info?.commit || text.unknown} · {info?.date || text.unknown} · {info?.runtime || text.unknown}</dd></dl>
      <section className={`system-update-state is-${view.tone}`} aria-label={text.stage} aria-live="polite">
        <div className="system-update-state-heading">{icon}<strong>{view.label}</strong>{status?.stage && <span>{view.progress}%</span>}</div>
        {status?.stage && <div className="system-update-progress" role="progressbar" aria-label={text.stage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.progress}><i style={{ width: `${view.progress}%` }}/></div>}
        {view.hint && <p>{view.hint}</p>}
        {status?.message && <p className="system-update-detail">{status.message}</p>}
        {view.error && <p className="system-update-error" role="alert">{view.error}</p>}
        {checkError && <p className="system-update-error" role="alert">{text.checkFailed}: {checkError}</p>}
        {statusError && <p className="system-update-error" role="alert">{statusError} · {text.stale}</p>}
        {actionError && actionError !== view.error && <p className="system-update-error" role="alert">{actionError}</p>}
        {status?.id && <dl className="system-update-transaction"><dt>{text.operation}</dt><dd><code>{status.id}</code></dd>{status.target_version && <><dt>{text.target}</dt><dd>{status.target_version}</dd></>}{status.confirmed_version && <><dt>{text.confirmed}</dt><dd>{status.confirmed_version}</dd></>}{status.rollback_result && <><dt>{text.rollback}</dt><dd>{status.rollback_result}</dd></>}</dl>}
      </section>
      {info && !info.update_supported && <p className="system-update-warning" role="note">{text.unsupported}: {info.update_unsupported_reason || text.manual}</p>}
      {check?.update && (!check.asset || !check.checksum) && <p className="system-update-warning" role="note">{text.assetsMissing}</p>}
      <div className="system-update-content">
        <section className="system-update-notes"><header><h3>{text.notes}</h3>{release?.html_url && <a href={release.html_url} target="_blank" rel="noreferrer">{text.release}<ExternalLink size={13}/></a>}</header>
          {release?.published_at && <small>{text.published} {dateLabel(release.published_at, lang, text.unknown)}</small>}
          {release?.body ? <div className="system-update-release-text">{release.body}</div> : <p className="system-update-empty">{release ? text.noNotes : text.notesUnchecked}</p>}
        </section>
        <section className="system-update-log"><header><h3>{text.log}</h3><button type="button" onClick={() => version.refreshStatus().catch(() => {})} disabled={version.busy}><RefreshCw size={13}/>{text.refresh}</button></header>
          {status?.log ? <pre tabIndex={0} aria-label={text.log}>{status.log}</pre> : <p className="system-update-empty">{text.noLog}</p>}
        </section>
      </div>
    </div>
    <div className="system-update-footer"><p>{text.footer}</p><div className="system-update-actions">
      <button type="button" onClick={onClose}>{text.close}</button>
      <button type="button" onClick={version.checkVersion} disabled={!view.canCheck}><RefreshCw size={14} className={checking ? 'is-spinning' : ''}/>{checking ? text.checking : text.check}</button>
      {view.showPrepare && <button type="button" className="is-primary" onClick={version.updateVersion} disabled={!view.canPrepare}><Download size={14}/>{text.prepare}</button>}
      {view.showRestart && <button type="button" className="is-primary" onClick={version.restartVersion} disabled={!view.canRestart}><RotateCw size={14}/>{text.restart}</button>}
    </div></div>
  </Modal>
}
