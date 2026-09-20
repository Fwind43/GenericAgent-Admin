import React from 'react'
import { FolderCog, Globe2, Power, Save } from 'lucide-react'
import { SettingsSection, SettingRow, SettingToggle, SettingNote, SettingFooter } from '../components/settings'
import './generalSettings.css'

// Both implementations receive the same closed display model and named actions.
// Neither owns drafts, imports API clients, or receives the original config.
export function DefaultGeneralSettings({ model, actions, hidden = false }) {
  const Icon = { paths: FolderCog, network: Globe2, startup: Power }[model.id]
  return <SettingsSection id={`general-${model.id}`} hidden={hidden} title={model.title} description={model.description} icon={<Icon size={17}/>}>
    {model.fields.map(field => <SettingRow key={field.id} label={field.label} hint={field.hint} htmlFor={field.id} stacked>
      {field.type === 'select' ? <select id={field.id} value={field.value} disabled={model.busy} onChange={e => actions[field.action](e.target.value)}>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : <input id={field.id} type={field.type} value={field.value} disabled={model.busy} placeholder={field.placeholder} onChange={e => actions[field.action](e.target.value)}/>}
    </SettingRow>)}
    {model.startup && <>
      <SettingToggle id="settings-autostart" checked={model.startup.enabled} disabled={model.busy || !model.startup.supported} onChange={actions.toggleAutostart} label={model.startup.label} hint={model.startup.hint}/>
      <p className="muted">{model.startup.state}{model.startup.path ? ` · ${model.startup.path}` : ''}</p>
    </>}
    <SettingNote tone="muted">{model.confirmNote}</SettingNote>
    <SettingFooter><span role="status" aria-live="polite" className={`set-dirty ${model.dirty ? 'is-dirty' : ''}`}>{model.status}</span><button className="primary" type="button" disabled={!model.canSave} onClick={actions.save}><Save size={15}/>{model.saveLabel}</button></SettingFooter>
  </SettingsSection>
}

// Independent markup: a form + summary column rather than the default card/row
// renderer. Replacing this component may remount DOM; the controller draft stays.
export function StudioGeneralSettings({ model, actions, hidden = false }) {
  return <section id={`general-${model.id}`} hidden={hidden} className="ui-studio-settings" data-settings-view="studio">
    <header><h3>{model.title}</h3><p>{model.description}</p></header>
    <div className="ui-studio-settings-workspace">
      <form onSubmit={e => { e.preventDefault(); if (model.canSave) actions.save() }}>
        {model.fields.map(field => <div key={field.id} className="ui-studio-settings-field">
          <label htmlFor={field.id}>{field.label}</label>
          {field.type === 'select' ? <select id={field.id} value={field.value} disabled={model.busy} aria-describedby={field.hint ? `${field.id}-help` : undefined} onChange={e => actions[field.action](e.target.value)}>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            : <input id={field.id} type={field.type} value={field.value} placeholder={field.placeholder} disabled={model.busy} aria-describedby={field.hint ? `${field.id}-help` : undefined} onChange={e => actions[field.action](e.target.value)}/>}
          {field.hint && <small id={`${field.id}-help`}>{field.hint}</small>}
        </div>)}
        {model.startup && <div className="ui-studio-settings-field">
          <label htmlFor="settings-autostart">{model.startup.label}</label>
          <input id="settings-autostart" type="checkbox" role="switch" checked={model.startup.enabled} disabled={model.busy || !model.startup.supported} onChange={actions.toggleAutostart}/>
          <small>{model.startup.hint}</small><p>{model.startup.state}</p>{model.startup.path && <code>{model.startup.path}</code>}
        </div>}
        <button className="primary" type="submit" disabled={!model.canSave}>{model.saveLabel}</button>
      </form>
      <aside><p role="status" aria-live="polite">{model.status}</p><p>{model.confirmNote}</p></aside>
    </div>
  </section>
}
