import React from 'react'
import { Eye, Save } from 'lucide-react'
import { SettingFooter, SettingRow, SettingToggle, SettingsSection } from '../components/settings'
import './generalSettings.css'

export function DefaultChatViewImageSettings({ model, actions }) {
  const { labels } = model
  const vision = model.mode === 'vision'
  return <SettingsSection title={labels.title} description={labels.description} icon={<Eye size={17}/>}>
    <SettingToggle id="settings-view-image" checked={model.enabled} disabled={model.busy}
      onChange={actions.setEnabled} label={labels.toggle} hint={labels.toggleHelp} onText={labels.on} offText={labels.off}/>
    <SettingRow label={labels.mode} hint={vision ? labels.modeVisionHelp : labels.modeMainHelp} htmlFor="settings-view-image-mode">
      <select id="settings-view-image-mode" value={model.mode} disabled={!model.enabled || model.busy} onChange={event => actions.setMode(event.target.value)}>
        <option value="main">{labels.modeMain}</option>
        <option value="vision">{labels.modeVision}</option>
      </select>
    </SettingRow>
    {vision && <SettingRow label={labels.model} hint={labels.modelHelp} htmlFor="settings-view-image-model">
      <select id="settings-view-image-model" value={model.draft} disabled={!model.enabled || model.busy} aria-invalid={model.missingModel || undefined} onChange={event => actions.selectModel(event.target.value)}>
        {model.options.map(option => <option key={option.value || 'none'} value={option.value} disabled={!option.value}>{option.label}</option>)}
      </select>
    </SettingRow>}
    <SettingFooter>
      <p className="set-save-scope">{labels.scope}</p>
      <button className="primary" type="button" disabled={model.busy} onClick={actions.save}><Save size={15}/>{model.busy ? labels.saving : labels.save}</button>
      {model.feedback && <span role="status">{model.feedback}</span>}
    </SettingFooter>
  </SettingsSection>
}
