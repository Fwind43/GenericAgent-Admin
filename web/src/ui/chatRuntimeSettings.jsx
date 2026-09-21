import React from 'react'
import { FoldVertical } from 'lucide-react'
import { SettingFooter, SettingRow, SettingToggle, SettingsSection } from '../components/settings'
import './generalSettings.css'

function ProjectModeHelp({ model }) {
  const { labels, options } = model
  if (!labels.officialHelp) return null
  return <div style={{ padding: '0 20px 16px', fontSize: 13, lineHeight: 1.65 }}>
    <dl style={{ margin: 0 }}>
      <dt style={{ fontWeight: 600 }}>{options.find(option => option.value === 'official')?.label}</dt>
      <dd style={{ margin: '2px 0 10px', color: 'var(--muted)' }}>{labels.officialHelp}</dd>
      <dt style={{ fontWeight: 600 }}>{options.find(option => option.value === 'admin')?.label}</dt>
      <dd style={{ margin: '2px 0 10px', color: 'var(--muted)' }}>{labels.adminHelp}</dd>
    </dl>
    <p style={{ margin: 0, color: 'var(--muted)' }}>{labels.switchHelp}</p>
  </div>
}

export function DefaultProjectModeSettings({ model, actions }) {
  const { labels } = model
  return <SettingsSection title={labels.title} description={labels.description}>
    <SettingRow label={labels.mode} htmlFor="settings-project-mode">
      <select id="settings-project-mode" value={model.draft} disabled={model.disabled || model.busy} onChange={e => actions.selectMode(e.target.value)}>
        {model.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </SettingRow>
    <ProjectModeHelp model={model}/>
    <SettingFooter>
      <button className="primary" type="button" disabled={model.disabled || model.busy || !model.dirty} onClick={actions.save}>{model.busy ? labels.saving : labels.save}</button>
      <small>{model.dirty ? labels.unsaved : labels.current}</small>
      {model.feedback && <span role="status">{model.feedback}</span>}
    </SettingFooter>
  </SettingsSection>
}

export function StudioProjectModeSettings({ model, actions }) {
  const { labels } = model
  return <section className="studio-general-settings" aria-label={labels.title}>
    <header><span className="studio-general-kicker">PROJECT RUNTIME</span><h2>{labels.title}</h2><p>{labels.description}</p></header>
    <form onSubmit={e => { e.preventDefault(); actions.save() }}>
      <div className="studio-general-field">
        <label htmlFor="studio-project-mode">{labels.mode}</label>
        <select id="studio-project-mode" value={model.draft} disabled={model.disabled || model.busy} onChange={e => actions.selectMode(e.target.value)}>
          {model.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <ProjectModeHelp model={model}/>
      <footer><button className="primary" type="submit" disabled={model.disabled || model.busy || !model.dirty}>{model.busy ? labels.saving : labels.save}</button><small>{model.dirty ? labels.unsaved : labels.current}</small></footer>
    </form>
    {model.feedback && <p role="status">{model.feedback}</p>}
  </section>
}

export function DefaultProcessDisplaySettings({ model, actions }) {
  const { labels } = model
  return <SettingsSection title={labels.title} description={labels.description} icon={<FoldVertical size={17}/>}>
    <SettingToggle id="settings-auto-collapse-process" checked={model.enabled} onChange={actions.setEnabled} label={labels.toggle} onText={labels.on} offText={labels.off}/>
    {model.feedback && <SettingFooter><span role="status">{model.feedback}</span></SettingFooter>}
  </SettingsSection>
}

export function StudioProcessDisplaySettings({ model, actions }) {
  const { labels } = model
  return <section className="studio-general-settings" aria-label={labels.title}>
    <header><span className="studio-general-kicker">DEVICE PREFERENCE</span><h2>{labels.title}</h2><p>{labels.description}</p></header>
    <div className="studio-general-field">
      <label htmlFor="studio-auto-collapse-process">{labels.toggle}</label>
      <input id="studio-auto-collapse-process" type="checkbox" role="switch" checked={model.enabled} onChange={e => actions.setEnabled(e.target.checked)}/>
      <small>{model.enabled ? labels.on : labels.off}</small>
    </div>
    {model.feedback && <p role="status">{model.feedback}</p>}
  </section>
}
