import React from 'react'
import { Save, Sparkles } from 'lucide-react'
import { SettingFooter, SettingRow, SettingToggle, SettingsSection } from '../components/settings'
import './generalSettings.css'

export function DefaultChatTitleSettings({ model, actions }) {
  const { labels } = model
  return <SettingsSection title={labels.title} description={labels.description} icon={<Sparkles size={17}/>}>
    <SettingToggle id="settings-auto-title" checked={model.enabled} disabled={model.busy}
      onChange={actions.setEnabled} label={labels.toggle} hint={labels.toggleHelp} onText={labels.on} offText={labels.off}/>
    <SettingRow label={labels.model} hint={labels.modelHelp} htmlFor="settings-auto-title-model">
      <select id="settings-auto-title-model" value={model.draft} disabled={!model.enabled || model.busy} onChange={event => actions.selectModel(event.target.value)}>
        {model.options.map(option => <option key={option.value || 'follow'} value={option.value}>{option.label}</option>)}
      </select>
    </SettingRow>
    <SettingFooter>
      <p className="set-save-scope">{labels.scope}</p>
      <button className="primary" type="button" disabled={model.busy} onClick={actions.save}><Save size={15}/>{model.busy ? labels.saving : labels.save}</button>
      {model.feedback && <span role="status">{model.feedback}</span>}
    </SettingFooter>
  </SettingsSection>
}

export function StudioChatTitleSettings({ model, actions }) {
  const { labels } = model
  return <section className="ui-studio-settings ui-studio-chat-title" aria-label={labels.title}>
    <header><h3>{labels.title}</h3><p>{labels.description}</p></header>
    <div className="ui-studio-settings-workspace">
      <form onSubmit={event => { event.preventDefault(); void actions.save() }} aria-label={labels.title}>
        <div className="ui-studio-settings-field">
          <label htmlFor="studio-auto-title">{labels.toggle}</label>
          <input id="studio-auto-title" type="checkbox" checked={model.enabled} disabled={model.busy} onChange={event => actions.setEnabled(event.target.checked)} aria-describedby="studio-auto-title-help"/>
          <small id="studio-auto-title-help">{labels.toggleHelp}</small>
        </div>
        <div className="ui-studio-settings-field">
          <label htmlFor="studio-auto-title-model">{labels.model}</label>
          <select id="studio-auto-title-model" value={model.draft} disabled={!model.enabled || model.busy} onChange={event => actions.selectModel(event.target.value)} aria-describedby="studio-auto-title-model-help">
            {model.options.map(option => <option key={option.value || 'follow'} value={option.value}>{option.label}</option>)}
          </select>
          <small id="studio-auto-title-model-help">{labels.modelHelp}</small>
        </div>
        <footer><button className="primary" type="submit" disabled={model.busy}>{model.busy ? labels.saving : labels.save}</button>
          {model.feedback && <span role="status">{model.feedback}</span>}
        </footer>
      </form>
      <aside><p>{labels.scope}</p><p>{model.dirty ? labels.unsaved : labels.current}</p></aside>
    </div>
  </section>
}
