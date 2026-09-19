import './keychain-workbench.css'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { LockKeyhole, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'

export function KeychainPage({ text, adminWorkspace = false, onDraftState }) {
  const copy = text.keychain
  const zh = copy.name !== 'Name'
  const labels = zh ? { filter: '筛选密钥名称', edit: '替换密钥', fresh: '新增密钥', cancel: '取消编辑', confirm: '放弃当前未保存的密钥输入？', hint: '仅替换值；不会读取已保存的密钥。', draft: '未保存' } : { filter: 'Filter key names', edit: 'Replace key', fresh: 'New key', cancel: 'Cancel editing', confirm: 'Discard the current unsaved key input?', hint: 'Replace only; saved secret values are never loaded.', draft: 'Unsaved' }
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const valueRef = useRef(null)
  const [keys, setKeys] = useState([])
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [status, setStatus] = useState({ kind: 'loading', message: copy.loading })
  const [busy, setBusy] = useState(false)
  const [activePanel, setActivePanel] = useState('inventory')

  useEffect(() => {
    if (adminWorkspace && activePanel === 'editor' && selected) valueRef.current?.focus()
  }, [adminWorkspace, activePanel, selected])

  const dirty = !!value || (!!name && name !== selected)
  useEffect(() => {
    if (!adminWorkspace) return
    onDraftState?.({ dirty, busy })
    return () => onDraftState?.({ dirty: false, busy: false })
  }, [dirty, busy, adminWorkspace, onDraftState])
  const selectKey = async key => {
    if (busy) return
    if (key === selected && (selected || !dirty)) { setActivePanel('editor'); valueRef.current?.focus(); return }
    if (dirty && !await confirmDanger('keychain-discard', labels.confirm)) return
    setSelected(key); setName(key); setValue(''); setStatus(null); setActivePanel('editor')
    valueRef.current?.focus()
  }
  const cancel = async () => {
    if (dirty && !await confirmDanger('keychain-discard', labels.confirm)) return
    setName(selected); setValue(''); setStatus(null); setActivePanel('inventory')
  }
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
      setName(adminWorkspace ? cleanName : '')
      if (adminWorkspace) setSelected(cleanName)
      setValue('')
      setActivePanel('inventory')
      setStatus({ kind: 'success', message: copy.saved })
    } catch (error) {
      setStatus({ kind: 'error', message: error.message })
    } finally { setBusy(false) }
  }

  const remove = async (keyName) => {
    if (adminWorkspace && keyName === selected && dirty && !await confirmDanger('keychain-discard', labels.confirm)) return
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
      if (adminWorkspace && keyName === selected) { setSelected(''); setName(''); setValue('') }
      setStatus({ kind: 'success', message: copy.removed })
    } catch (error) {
      setStatus({ kind: 'error', message: error.message })
    } finally { setBusy(false) }
  }

  const loading = status?.kind === 'loading'
  const feedback = status && !loading ? status : null

  return <div className={`keychain-page${adminWorkspace ? ' keychain-admin' : ''}`}>
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

        {adminWorkspace && <div className="keychain-list-tools"><label>{labels.filter}<input value={query} onChange={e => setQuery(e.target.value)}/></label><button type="button" onClick={() => selectKey('')} disabled={busy}><Plus size={14}/>{labels.fresh}</button></div>}
        <div className="keychain-list-area" tabIndex={adminWorkspace ? 0 : undefined} aria-label={copy.inventory}>
          {loading ? <div className="keychain-state"><RefreshCw className="is-spinning" size={16}/><span>{status.message}</span></div>
            : status?.kind === 'error' && keys.length === 0 ? <div className="keychain-state is-error"><span>{status.message}</span><button type="button" className="ghost" onClick={load}>{copy.retry}</button></div>
            : keys.length === 0 ? <div className="keychain-empty"><LockKeyhole size={20}/><strong>{copy.empty}</strong><span>{copy.emptyHelp}</span></div>
            : <ul className="keychain-list">
              {keys.filter(keyName => !adminWorkspace || keyName.toLowerCase().includes(query.toLowerCase())).map(keyName => <li key={keyName} className={adminWorkspace && selected === keyName ? 'is-selected' : ''}>
                {adminWorkspace ? <button type="button" className="keychain-select" aria-pressed={selected === keyName} onClick={() => selectKey(keyName)} disabled={busy}><code>{keyName}</code></button> : <code>{keyName}</code>}
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
            <h3 id="keychain-editor-title">{adminWorkspace ? (selected ? labels.edit : labels.fresh) : copy.editor}</h3>
            {adminWorkspace && <p className="keychain-selection"><code>{selected || labels.fresh}</code>{dirty && <em>{labels.draft}</em>}</p>}
            <p>{adminWorkspace && selected ? labels.hint : copy.editorDesc}</p>
          </div>
        </div>

        <form className="keychain-form" onSubmit={save}>
          <label className="keychain-field" htmlFor="keychain-name">
            <span>{copy.name}</span>
            <input id="keychain-name" readOnly={adminWorkspace && !!selected} disabled={adminWorkspace && busy} value={name} onChange={event => setName(event.target.value)} autoComplete="off" maxLength={128}/>
          </label>
          <label className="keychain-field" htmlFor="keychain-value">
            <span>{copy.value}</span>
            <input id="keychain-value" ref={valueRef} disabled={adminWorkspace && busy} type="password" value={value} onChange={event => setValue(event.target.value)} autoComplete="new-password"/>
          </label>
          <p className="keychain-form-note"><LockKeyhole size={13}/><span>{copy.valueHelp}</span></p>
          <div className="keychain-form-footer">
            {adminWorkspace && <button type="button" onClick={cancel} disabled={busy}>{labels.cancel}</button>}
            <button type="submit" className="primary keychain-submit" disabled={busy || !name.trim() || !value}><Plus size={15}/>{busy ? copy.saving : copy.add}</button>
          </div>
        </form>

        <div className="keychain-privacy"><ShieldCheck size={14} aria-hidden="true"/><span>{copy.protected}</span></div>
      </section>
    </div>
  </div>
}

export default KeychainPage
