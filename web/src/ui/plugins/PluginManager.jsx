import React, { useEffect, useState } from 'react'
import { AREAS, LIMITS, readArchive, validateConfig } from './protocol'
import { ExternalView, useExternalUi } from './runtime'
export const FICTION = { title: 'Fictional workspace', status: 'Example only', navigation: [{ id: 'overview', label: 'Example overview' }, { id: 'settings', label: 'Example settings' }], services: [{ label: 'Example assistant', status: 'Running' }], metrics: [{ label: 'Example tasks', value: 3 }] }
export function PluginPreview({ bundle }) {
  const [action, setAction] = useState('No business actions are connected')
  return <section className="gaui-preview" aria-label="Fictional plugin preview"><p>Fictional data only. Preview does not enable or save.</p>{bundle.manifest.surfaces.map(area => <section key={area}><h3>{area}</h3><ExternalView bundle={bundle} area={area} data={FICTION} invoke={n => setAction('Simulated: ' + n.action)}/>{area.startsWith('chat.') && <div data-gaui-density={bundle.config.density || bundle.views[area].layout.density}><p>Host-owned example {area.slice(5)} slot</p>{area === 'chat.composer' && <textarea aria-label="Fictional draft" defaultValue="Example unsent draft"/>}</div>}</section>)}<p role="status">{action}</p></section>
}
export function PluginManager() {
  const ui = useExternalUi(), [installed, setInstalled] = useState([]), [candidate, setCandidate] = useState(null), [draft, setDraft] = useState({}), [preview, setPreview] = useState(false), [message, setMessage] = useState(''), [working, setWorking] = useState(false)
  const unavailable = !ui || working || ui.busy
  async function reload() { setInstalled((await ui.store.list()).map(b => b.manifest)) }
  useEffect(() => { if (ui) reload().catch(e => setMessage(e.message)) }, [ui?.store])
  async function run(action) { if (unavailable) return; setWorking(true); try { await action() } catch (e) { setMessage(e.message) } finally { setWorking(false) } }
  async function install(file) {
    if (!file || !file.name.endsWith('.gaui.zip') || file.size > LIMITS.archive) throw new Error('Choose a .gaui.zip file up to 1 MiB')
    const bundle = readArchive(await file.arrayBuffer())
    await ui.store.install(bundle); await reload(); setCandidate(bundle); setDraft(bundle.config); setPreview(false); setMessage('Installed locally; not enabled')
  }
  return <section id="general-plugins" className="gaui-manager" aria-label="UI plugins"><h2>UI plugins / UI插件</h2><p><a href="/ui-plugins/local-workshop.gaui.zip" download>Download example package</a></p><p>Local declarative packages only: no JS/React, network access or account sync.</p><p>Active: {ui?.bundle?.manifest.name || 'Built-in default'}</p>
    <label>Install .gaui.zip<input aria-label="Install .gaui.zip" type="file" accept=".zip" disabled={unavailable} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; run(() => install(file)) }}/></label>
    <label>Installed plugin<select aria-label="Installed plugin" value={candidate?.manifest.id || ''} disabled={unavailable} onChange={e => run(async () => { const b = await ui.store.load(e.target.value); setCandidate(b); setDraft(b.config); setPreview(false); setMessage('Selected; not enabled') })}><option value="" disabled>Select a plugin</option>{installed.map(m => <option key={m.id} value={m.id}>{m.name} {m.version}</option>)}</select></label>
    {candidate && <><h3>Coverage</h3><p>Provided: {candidate.manifest.surfaces.join(', ')}</p><p>Default fallback: {AREAS.filter(a => !candidate.manifest.surfaces.includes(a)).join(', ') || 'None among these five areas'}. All other admin pages, chat dialogs, message content renderers, sensitive fields and confirmation flows remain host-owned.</p><p>Chat coverage is constrained layout of stable host components, not replacement of business controls.</p>
      <fieldset disabled={unavailable}><legend>Plugin configuration</legend>{Object.entries(candidate.schema).map(([key, spec]) => <label key={key}>{spec.label}{spec.type === 'enum' ? <select aria-label={spec.label} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })}>{spec.options.map(v => <option key={v}>{v}</option>)}</select> : <input aria-label={spec.label} value={draft[key]} maxLength={7} onChange={e => setDraft({ ...draft, [key]: e.target.value })}/>}</label>)}<button type="button" onClick={() => run(async () => { const saved = await ui.store.saveConfig(candidate.manifest.id, validateConfig(candidate.schema, draft)); setCandidate(saved); await ui.refresh(); setMessage('Configuration saved locally') })}>Save plugin configuration</button></fieldset>
      <button type="button" disabled={unavailable} onClick={() => run(async () => { validateConfig(candidate.schema, draft); setPreview(true); setMessage('Preview only; current selection unchanged') })}>Preview</button>
      <button type="button" disabled={unavailable} onClick={() => run(async () => { await ui.activate(candidate.manifest.id); setMessage('Enabled saved configuration') })}>Enable plugin</button>
      {preview && <PluginPreview bundle={{ ...candidate, config: (() => { try { return validateConfig(candidate.schema, draft) } catch { return candidate.config } })() }}/>}</>}
    <button type="button" disabled={unavailable} onClick={() => run(async () => { await ui.activate('default'); setMessage('Default restored; installed packages and configuration retained') })}>Restore default</button> <a href="/admin/overview?ui=safe">Independent recovery</a>
    <p role="status">{message}</p>{ui?.error && <p role="alert">{ui.error}</p>}
  </section>
}
