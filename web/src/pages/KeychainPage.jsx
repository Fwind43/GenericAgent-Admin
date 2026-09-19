import './keychain-workbench.css'
import React, { useCallback, useEffect, useState } from 'react'
import { LockKeyhole, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'

export function KeychainPage({ text }) {
  const copy = text.keychain
  const [keys, setKeys] = useState([])
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [status, setStatus] = useState({ kind: 'loading', message: copy.loading })
  const [busy, setBusy] = useState(false)
  const [activePanel, setActivePanel] = useState('inventory')

  const load = useCallback(async () => {
    setStatus({ kind: 'loading', message: copy.loading })
    try {
      const data = await api('/api/keychain')
      const nextKeys = Array.isArray(data?.keys) ? data.keys : []
      setKeys(nextKeys)
      if (nextKeys.length === 0) setActivePanel('editor')
      setStatus(null)
    } catch (error) {
      setStatus({ kind: 'error', message: `${copy.loadFailed} ${error.message}` })
    }
  }, [copy.loadFailed, copy.loading])

  useEffect(() => { load() }, [load])

  const save = async (event) => {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName || !value) {
      setStatus({ kind: 'error', message: copy.invalid })
      return
    }
    if (!await confirmDanger('keychain-write', copy.confirmAdd(cleanName))) return
    setBusy(true)
    setStatus(null)
    try {
      const data = await api('/api/keychain', {
        method: 'PUT', dangerous: true, body: JSON.stringify({ name: cleanName, value }),
      })
      const nextKeys = Array.isArray(data?.keys) ? data.keys : []
      setKeys(nextKeys)
      setName('')
      setValue('')
      setActivePanel('inventory')
      setStatus({ kind: 'success', message: copy.saved })
    } catch (error) {
      setStatus({ kind: 'error', message: error.message })
    } finally { setBusy(false) }
  }

  const remove = async (keyName) => {
    if (!await confirmDanger('keychain-delete', copy.confirmRemove(keyName))) return
    setBusy(true)
    setStatus(null)
    try {
      const data = await api('/api/keychain', {
        method: 'DELETE', dangerous: true, body: JSON.stringify({ name: keyName }),
      })
      const nextKeys = Array.isArray(data?.keys) ? data.keys : []
      setKeys(nextKeys)
      if (nextKeys.length === 0) setActivePanel('editor')
      setStatus({ kind: 'success', message: copy.removed })
    } catch (error) {
      setStatus({ kind: 'error', message: error.message })
    } finally { setBusy(false) }
  }

  const loading = status?.kind === 'loading'
  const feedback = status && !loading ? status : null

  return <div className="keychain-page">
    <div className={`keychain-feedback keychain-page-feedback${feedback ? ` is-${feedback.kind}` : ''}`} role="status" aria-live="polite">{feedback?.message || ''}</div>
    <div className="keychain-workspace" data-active-panel={activePanel}>
      <div className="keychain-view-switch" role="group" aria-label={copy.title}>
        <button type="button" className={activePanel === 'inventory' ? 'is-active' : ''}
          aria-pressed={activePanel === 'inventory'} onClick={() => setActivePanel('inventory')}>
          <span>{copy.inventory}</span><span className="keychain-view-count" data-count={keys.length} aria-hidden="true"/>
        </button>
        <button type="button" className={activePanel === 'editor' ? 'is-active' : ''}
          aria-pressed={activePanel === 'editor'} onClick={() => setActivePanel('editor')}>
          <Plus size={14} aria-hidden="true"/><span>{copy.editor}</span>
        </button>
      </div>
      <section className="keychain-inventory" aria-labelledby="keychain-inventory-title">
        <div className="keychain-section-head">
          <div>
            <div className="keychain-heading-line">
              <h3 id="keychain-inventory-title">{copy.inventory}</h3>
              <span className="keychain-total"><span>{keys.length}</span> {copy.keysLabel}</span>
            </div>
            <p>{copy.inventoryDesc}</p>
          </div>
          <button type="button" className={`keychain-refresh${loading ? ' is-loading' : ''}`} onClick={load} disabled={loading || busy} aria-label={copy.refresh} title={copy.refresh}>
            <RefreshCw size={15} aria-hidden="true"/>
          </button>
        </div>

        <div className="keychain-list-area">
          {loading ? <div className="keychain-state"><RefreshCw className="is-spinning" size={16}/><span>{status.message}</span></div>
            : status?.kind === 'error' && keys.length === 0 ? <div className="keychain-state is-error"><span>{status.message}</span><button type="button" className="ghost" onClick={load}>{copy.retry}</button></div>
            : keys.length === 0 ? <div className="keychain-empty"><LockKeyhole size={20}/><strong>{copy.empty}</strong><span>{copy.emptyHelp}</span></div>
            : <ul className="keychain-list">
              {keys.map(keyName => <li key={keyName}>
                <code>{keyName}</code>
                <button type="button" className="keychain-delete" onClick={() => remove(keyName)} disabled={busy} aria-label={`${copy.remove} ${keyName}`} title={copy.remove}><Trash2 size={14}/><span>{copy.remove}</span></button>
              </li>)}
            </ul>}
        </div>

        <div className="keychain-storage">
          <span>{copy.pathLabel}</span>
          <code>~/ga_keychain.enc</code>
        </div>
      </section>

      <section className="keychain-editor" aria-labelledby="keychain-editor-title">
        <div className="keychain-section-head">
          <div>
            <h3 id="keychain-editor-title">{copy.editor}</h3>
            <p>{copy.editorDesc}</p>
          </div>
        </div>

        <form className="keychain-form" onSubmit={save}>
          <label className="keychain-field" htmlFor="keychain-name">
            <span>{copy.name}</span>
            <input id="keychain-name" value={name} onChange={event => setName(event.target.value)} autoComplete="off" maxLength={128}/>
          </label>
          <label className="keychain-field" htmlFor="keychain-value">
            <span>{copy.value}</span>
            <input id="keychain-value" type="password" value={value} onChange={event => setValue(event.target.value)} autoComplete="new-password"/>
          </label>
          <p className="keychain-form-note"><LockKeyhole size={13}/><span>{copy.valueHelp}</span></p>
          <div className="keychain-form-footer">
            <button type="submit" className="primary keychain-submit" disabled={busy || !name.trim() || !value}><Plus size={15}/>{busy ? copy.saving : copy.add}</button>
          </div>
        </form>

        <div className="keychain-privacy"><ShieldCheck size={14} aria-hidden="true"/><span>{copy.protected}</span></div>
      </section>
    </div>
  </div>
}

export default KeychainPage
