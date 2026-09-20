import React from 'react'
import { Palette } from 'lucide-react'
import { SettingsSection, SettingRow, SettingFooter, SettingNote } from '../components/settings'
import './generalSettings.css'

function LanguageSelect({ model, actions }) {
  return <select id="settings-language" value={model.lang} disabled={model.disabled} onChange={e => actions.changeLanguage(e.target.value)}>
    <option value="zh">中文</option><option value="en">English</option>
  </select>
}
export function DefaultAppearanceSettings({ model, actions, hidden }) {
  return <SettingsSection id="general-appearance" hidden={hidden} title={model.text.title} description={model.text.desc} icon={<Palette size={17}/>}>
    <SettingRow label={model.text.language} hint={model.text.languageHelp} htmlFor="settings-language"><LanguageSelect model={model} actions={actions}/></SettingRow>
    <SettingRow label={model.text.theme} hint={model.text.themeHelp} stacked>
      <div className="ui-theme-choices">{model.themes.map(theme => <button key={theme.id} type="button" aria-pressed={theme.id === model.theme} disabled={model.disabled} onClick={() => actions.changeTheme(theme.id)}>
        <b>{theme.label}</b><small>{theme.description}</small><span aria-hidden="true">{theme.preview.map((color, i) => <i key={i} style={{ background: color }}/>)}</span>
      </button>)}</div>
    </SettingRow>
    <p>{model.text.fontAttribution} <a href="/fonts/misans/MiSans-License.pdf" target="_blank" rel="noreferrer">{model.text.fontLicense}</a></p>
    <SettingFooter><SettingNote tone="muted">{model.confirmNote}</SettingNote><span role="status">{model.status}</span><button type="button" className="primary" disabled={!model.canSave} onClick={actions.save}>{model.saveLabel}</button></SettingFooter>
  </SettingsSection>
}

export function StudioAppearanceSettings({ model, actions, hidden }) {
  return <section id="general-appearance" hidden={hidden} className="ui-studio-settings">
    <header><small>STUDIO / APPEARANCE</small><h3>{model.text.title}</h3><p>{model.text.desc}</p></header>
    <form onSubmit={e => { e.preventDefault(); actions.save() }}>
      <label htmlFor="settings-language">{model.text.language}</label><LanguageSelect model={model} actions={actions}/><small>{model.text.languageHelp}</small>
      <fieldset disabled={model.disabled}><legend>{model.text.theme}</legend><p>{model.text.themeHelp}</p>
        {model.themes.map(theme => <label key={theme.id}><input type="radio" name="studio-theme" checked={theme.id === model.theme} onChange={() => actions.changeTheme(theme.id)}/><b>{theme.label}</b><small>{theme.description}</small></label>)}
      </fieldset>
      <footer><span role="status">{model.status}</span><small>{model.confirmNote}</small><button className="primary" disabled={!model.canSave}>{model.saveLabel}</button></footer>
    </form>
    <p>{model.text.fontAttribution} <a href="/fonts/misans/MiSans-License.pdf" target="_blank" rel="noreferrer">{model.text.fontLicense}</a></p>

  </section>
}
