import React from 'react'
import { Palette } from 'lucide-react'
import { SettingsSection, SettingRow, SettingFooter, SettingNote } from '../components/settings'
import { ThemeColorView } from '../ThemeColorEditor'
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
    <ThemeColorView model={model.colors} actions={actions.colors}/>
    <SettingFooter><SettingNote tone="muted">{model.confirmNote}</SettingNote><span role="status">{model.status}</span><button type="button" className="primary" disabled={!model.canSave} onClick={actions.save}>{model.saveLabel}</button></SettingFooter>
  </SettingsSection>
}

export function StudioAppearanceSettings({ model, actions, hidden }) {
  const colors = model.colors
  const zh = model.lang === 'zh'
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
    <section aria-label={zh ? '自定义主题颜色' : 'Custom theme colors'}>
      <h4>{zh ? '自定义主题颜色' : 'Custom theme colors'}</h4>
      {!colors.open ? <button type="button" disabled={colors.busy} onClick={actions.colors.begin}>{zh ? '编辑颜色' : 'Edit colors'}</button> : <form onSubmit={e => { e.preventDefault(); actions.colors.save() }}>
        <p>{zh ? '实时预览不会保存。留空继承预设；取消或离开分组恢复原颜色。' : 'Live preview does not save. Blank inherits the preset; cancel or leave this group to restore the original colors.'}</p>
        <fieldset disabled={colors.busy}>{colors.groups.map(group => <fieldset key={group.title}><legend>{group.title}</legend>{group.tokens.map(token => <label key={token}>{token}<input aria-label={token} value={colors.draft[token] || ''} placeholder="inherit" onChange={e => actions.colors.changeColor(token, e.target.value)}/></label>)}</fieldset>)}</fieldset>
        <footer><button type="button" disabled={colors.busy} onClick={actions.colors.restoreDefaults}>{zh ? '恢复默认' : 'Restore defaults'}</button><button type="button" disabled={colors.busy} onClick={actions.colors.cancel}>{zh ? '取消预览' : 'Cancel preview'}</button><button disabled={!colors.canSave}>{colors.busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存颜色' : 'Save colors')}</button></footer>
      </form>}
      {colors.message && <p role={colors.failed ? 'alert' : 'status'}>{colors.message}</p>}
    </section>
  </section>
}
