import './chat-settings-workbench.css'
import React from 'react'
import ProjectModeSetting from '../components/ProjectModeSetting'
import { FoldVertical, Save, Sparkles } from 'lucide-react'
import { useAutoCollapseProcess } from '../hooks/useAutoCollapseProcess.js'
import { SettingFooter, SettingRow, SettingToggle, SettingsPage, SettingsSection } from '../components/settings'

export function ChatSettingsPage({ t, text, titleModel, lang, projectProvider, onSaveProjectProvider, projectSettingsDisabled }) {
  const [autoCollapseProcess, setAutoCollapseProcess] = useAutoCollapseProcess()
  const en = lang === 'en'
  return <SettingsPage className="chat-settings-workbench">
    <nav className="chat-settings-nav" aria-label={en ? 'Chat settings sections' : '聊天设置分区'}>
      <a href="#chat-project-mode">{en ? 'Project mode' : '项目模式'}<small>{en ? 'Save separately' : '单独保存'}</small></a>
      <a href="#chat-process-display">{text.chat.processDisplay}<small>{en ? 'This device · immediate' : '此设备 · 即时生效'}</small></a>
      <a href="#chat-auto-title">{text.chat.autoTitle}<small>{en ? 'Save separately' : '单独保存'}</small></a>
    </nav>
    <div className="chat-settings-content">
    <div id="chat-project-mode" tabIndex={-1}>
      <p className="chat-settings-scope">{en ? 'Project mode saves independently of display preferences and automatic titles.' : '项目模式独立保存，不影响显示偏好和自动标题设置。'}</p>
    <ProjectModeSetting value={projectProvider} onSave={onSaveProjectProvider} lang={lang} disabled={projectSettingsDisabled}/>
    </div>
    <div id="chat-process-display" tabIndex={-1}>
    <SettingsSection title={text.chat.processDisplay} description={lang === 'en' ? 'Changes apply immediately on this device; no save required.' : '更改立即在此设备生效，无需保存。'} icon={<FoldVertical size={17}/>}>
      <SettingToggle
        id="settings-auto-collapse-process"
        checked={autoCollapseProcess}
        onChange={setAutoCollapseProcess}
        label={text.chat.autoCollapseProcess}
        onText={text.chat.on}
        offText={text.chat.off}
      />
    </SettingsSection>
    </div>
    <div id="chat-auto-title" tabIndex={-1}>
    <SettingsSection title={text.chat.autoTitle} description={text.chat.autoTitleDesc} icon={<Sparkles size={17}/>}>
      <SettingToggle
        id="settings-auto-title"
        checked={titleModel.enabled}
        disabled={titleModel.saving}
        onChange={titleModel.setEnabled}
        label={text.chat.toggle}
        hint={text.chat.toggleHelp}
        onText={text.chat.on}
        offText={text.chat.off}
      />
      <SettingRow label={t.titleModel} hint={text.chat.modelHelp} htmlFor="settings-auto-title-model">
        <select
          id="settings-auto-title-model"
          value={titleModel.draft}
          disabled={!titleModel.enabled || titleModel.saving}
          onChange={e=>titleModel.setDraft(e.target.value)}
        >
          {titleModel.options.map(option => <option key={option.value || 'follow'} value={option.value}>{option.label}</option>)}
        </select>
      </SettingRow>
      <SettingFooter>
        <p className="set-save-scope">{lang === 'en' ? 'Save applies only to automatic titles, including the switch above.' : '保存仅应用于自动标题设置，包括上方开关。'}</p>
        <button className="primary" type="button" disabled={titleModel.saving} onClick={titleModel.submit}>
          <Save size={15}/>{text.chat.save}
        </button>
      </SettingFooter>
    </SettingsSection>
    </div>
    </div>
  </SettingsPage>
}

export default ChatSettingsPage
