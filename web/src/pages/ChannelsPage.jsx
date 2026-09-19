import './channels-workbench.css'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Globe2, RefreshCw, Save, Server } from 'lucide-react'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { ChannelServiceTable, SecretInput } from '../components/common'

const CHANNEL_TONES = { feishu:'#3370ff', lark:'#3370ff', wecom:'#07c160', dingtalk:'#1677ff', discord:'#5865f2', qq:'#12b7f5', telegram:'#229ed9', wechat:'#2aae67' }
const CHANNEL_MARKS = { feishu:'飞', lark:'飞', wecom:'企', dingtalk:'钉', discord:'D', qq:'Q', telegram:'T', wechat:'微' }

const fieldFilled = field => Boolean(field.has_value) || String(field.value || '').trim() !== ''
// Secrets never come back from the API, so a profile's edit state is only the
// values currently in the form; that is enough to flag unsaved channels.
const fingerprint = profiles => Object.fromEntries((profiles || []).map(p => [p.id, (p.fields || []).map(f => String(f.value ?? '')).join('\u001f')]))

export function ChannelsPage({ frontendSvcs, t, actionStates = {}, onStart, onStop, onLogs, onAutostart, onReflectStart, onOpenHub }) {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState('')
  const [msg, setMsg] = useState(null)
  const [activeView, setActiveView] = useState('config')
  const [selectedId, setSelectedId] = useState('')
  const tabRefs = useRef({})
  const baseline = useRef({})
  const text = t.channels
  const selectView = view => {
    setActiveView(view)
    tabRefs.current[view]?.focus()
  }
  const handleTabKeyDown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') return selectView('config')
    if (event.key === 'End') return selectView('services')
    selectView(activeView === 'config' ? 'services' : 'config')
  }
  const profileName = profile => text.profileNames?.[profile.id] || profile.name
  const profileDescription = profile => text.profileDescriptions?.[profile.id] || profile.description
  const fieldLabel = field => text.fieldLabels?.[field.name] || field.label || field.name
  const fieldPlaceholder = field => field.name?.endsWith('_allowed_users') ? text.allowedUsersPlaceholder : (field.placeholder || '')
  const load = async () => {
    setLoading(true)
    try {
      const d = await api('/api/channels')
      baseline.current = fingerprint(d?.profiles)
      setConfig(d)
      return d
    } catch (e) {
      setMsg({ kind: 'error', text: text.loadFailed(e.message) })
      return null
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { setMsg(null) }, [text])
  const patchField = (profileId, fieldName, value) => {
    setConfig(prev => ({
      ...(prev || {}),
      profiles: (prev?.profiles || []).map(p => p.id === profileId ? {
        ...p,
        fields: (p.fields || []).map(f => f.name === fieldName ? { ...f, value } : f)
      } : p)
    }))
  }
  const save = async () => {
    if (!await confirmDanger('channels-save', text.saveConfirm)) return
    setSaving(true); setMsg({ kind: 'pending', text: text.saving })
    try {
      const d = await api('/api/channels', { dangerous:true, method:'PUT', body: JSON.stringify({ profiles: config?.profiles || [] }) })
      baseline.current = fingerprint(d?.profiles)
      setConfig(d)
      setMsg({ kind: 'success', text: text.saved(d.path) })
    } catch (e) { setMsg({ kind: 'error', text: text.saveFailed(e.message) }) } finally { setSaving(false) }
  }
  const testProfile = async (profile) => {
    const name = profileName(profile)
    setTesting(profile.id); setMsg({ kind: 'pending', text: text.testing(name) })
    try {
      const d = await api('/api/channels/test', { method:'POST', body: JSON.stringify({ profile_id: profile.id, fields: profile.fields || [] }) })
      const detail = /[一-龥]/.test(d.message || '') && document.documentElement.lang === 'en' ? '' : (d.message || '')
      setMsg({ kind: d.ok ? 'success' : 'error', text: d.ok ? `${text.testPassed(name)}${detail ? ` · ${detail}` : ''}` : text.testFailed(name, detail) })
    } catch (e) { setMsg({ kind: 'error', text: text.testFailed(name, e.message) }) } finally { setTesting('') }
  }
  const runningCount = frontendSvcs.filter(s => s.running).length
  const profiles = config?.profiles || []
  const configuredCount = profiles.filter(profile => (profile.fields || []).some(fieldFilled)).length
  const dirtyIds = useMemo(() => {
    const current = fingerprint(config?.profiles)
    return new Set(Object.keys(current).filter(id => baseline.current[id] !== current[id]))
  }, [config])
  const selected = profiles.find(p => p.id === selectedId) || profiles[0] || null
  const selectedFields = selected?.fields || []
  const tone = profile => CHANNEL_TONES[profile.id] || 'var(--ch-accent)'
  const mark = profile => CHANNEL_MARKS[profile.id] || profileName(profile).slice(0, 1).toUpperCase()
  return <section className="channels-page">
    <div className="channel-tabs" role="tablist" aria-label={text.channelViews}>
      <button
        ref={node => { tabRefs.current.config = node }}
        id="channel-tab-config"
        role="tab"
        aria-selected={activeView === 'config'}
        aria-controls="channel-panel-config"
        tabIndex={activeView === 'config' ? 0 : -1}
        onClick={() => selectView('config')}
        onKeyDown={handleTabKeyDown}
      >
        <Globe2 size={15} aria-hidden="true"/>{text.configTab}<em>{configuredCount}/{profiles.length || 0}</em>
      </button>
      <button
        ref={node => { tabRefs.current.services = node }}
        id="channel-tab-services"
        role="tab"
        aria-selected={activeView === 'services'}
        aria-controls="channel-panel-services"
        tabIndex={activeView === 'services' ? 0 : -1}
        onClick={() => selectView('services')}
        onKeyDown={handleTabKeyDown}
      >
        <Server size={15} aria-hidden="true"/>{text.servicesTab}<em>{runningCount}/{frontendSvcs.length}</em>
      </button>
    </div>
    <div className="channels-layout">
      <div
        id="channel-panel-config"
        className="channel-config-view"
        role="tabpanel"
        aria-labelledby="channel-tab-config"
        hidden={activeView !== 'config'}
      >
        <div className="channel-workbench">
          <div className="channel-rail" role="group" aria-label={text.channelList}>
            <div className="channel-rail-head"><span>{text.keyConfig}</span><em>{configuredCount}/{profiles.length || 0}</em></div>
            {profiles.map(profile => {
              const done = (profile.fields || []).filter(fieldFilled).length
              const total = (profile.fields || []).length
              const isSet = done > 0 || !total
              return <button
                type="button"
                key={profile.id}
                aria-current={selected?.id === profile.id ? 'true' : undefined}
                onClick={() => setSelectedId(profile.id)}
                style={{ '--channel-tone': tone(profile) }}
              >
                <span className="channel-mark" aria-hidden="true">{mark(profile)}</span>
                <span className="channel-rail-name">{profileName(profile)}</span>
                {dirtyIds.has(profile.id) && <span className="channel-rail-dirty" title={text.unsaved}/>}
                <span className={`channel-rail-count${isSet ? ' is-set' : ''}`} title={isSet ? text.configured : text.unconfigured}>{total ? `${done}/${total}` : '—'}</span>
              </button>
            })}
            {!loading && !profiles.length && <p className="channel-rail-empty">{t.empty}</p>}
          </div>
          <div className="channel-detail">
            {selected ? <>
              <div className="channel-detail-head" style={{ '--channel-tone': tone(selected) }}>
                <span className="channel-mark" aria-hidden="true">{mark(selected)}</span>
                <div><h3>{profileName(selected)}</h3><p>{profileDescription(selected)}</p></div>
                {selected.testable && <button type="button" onClick={()=>testProfile(selected)} disabled={saving || testing === selected.id}>{testing === selected.id ? text.testingButton : text.testConnection}</button>}
              </div>
              {selectedFields.length ? <div className="channel-detail-fields">
                {selectedFields.map(field => <label key={field.name}>
                  <span>{fieldLabel(field)}{field.secret && field.has_value && <em>{text.savedField}</em>}</span>
                  {field.secret
                    ? <SecretInput value={field.value || ''} label={fieldLabel(field)} onChange={v=>patchField(selected.id, field.name, v)} t={t}/>
                    : field.type === 'bool'
                      ? <select aria-label={fieldLabel(field)} value={String(field.value || 'false').toLowerCase()} onChange={e=>patchField(selected.id, field.name, e.target.value)}><option value="false">False</option><option value="true">True</option></select>
                      : <input aria-label={fieldLabel(field)} value={field.value || ''} placeholder={fieldPlaceholder(field)} onChange={e=>patchField(selected.id, field.name, e.target.value)}/>}
                  <small>{field.name}</small>
                </label>)}
              </div> : <p className="channel-detail-note">{text.noFields}</p>}
            </> : <p className="channel-detail-note">{loading ? text.loadingConfig : t.empty}</p>}
          </div>
        </div>
        <p className="channel-save-scope">{text.saveConfirm}</p>
        {dirtyIds.size > 0 && msg && <p className="channel-commit-msg is-dirty" role="status">{text.pendingChanges(dirtyIds.size)}</p>}
        <div className="channel-commit">
          <span className="channel-commit-path">
            <i className={config?.path ? 'is-ready' : ''}/>
            <b>{config?.path ? text.configFile : (loading ? text.loadingConfig : text.noConfigPath)}</b>
            {config?.path && <code title={config.path}>{config.path}</code>}
          </span>
          {msg
            ? <p className={`channel-commit-msg ${msg.kind === 'error' ? 'is-error' : msg.kind === 'success' ? 'is-success' : ''}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>
            : dirtyIds.size > 0 && <p className="channel-commit-msg is-dirty" role="status">{text.pendingChanges(dirtyIds.size)}</p>}
          <span className="channel-commit-actions">
            <button type="button" className="channel-icon-button" onClick={load} disabled={loading || saving} title={t.refresh} aria-label={t.refresh}><RefreshCw size={15} className={loading ? 'spin' : ''}/></button>
            <button type="button" className="primary" onClick={save} disabled={saving || loading || !config}><Save size={15}/>{saving ? t.busy : t.save}</button>
          </span>
        </div>
      </div>
      <div
        id="channel-panel-services"
        className="channel-services-view"
        role="tabpanel"
        aria-labelledby="channel-tab-services"
        hidden={activeView !== 'services'}
      >
        <div className="channel-services-head">
          <h3>{t.lists.frontendServices}</h3>
          <em>{runningCount}/{frontendSvcs.length} {t.running}</em>
        </div>
        <ChannelServiceTable services={frontendSvcs} t={t} actionState={actionStates} onStart={onStart} onStop={onStop} onLogs={onLogs} onAutostart={onAutostart} onReflectStart={onReflectStart} onOpenHub={onOpenHub}/>
      </div>
    </div>
  </section>
}

export default ChannelsPage
