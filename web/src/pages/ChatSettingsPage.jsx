import React from 'react'
import { FoldVertical, Save, Sparkles } from 'lucide-react'
import { useAutoCollapseProcess } from '../hooks/useAutoCollapseProcess.js'
import { SettingFooter, SettingRow, SettingToggle, SettingsPage, SettingsSection } from '../components/settings'

export function ChatSettingsPage({ t, text, titleModel }) {
  const [autoCollapseProcess, setAutoCollapseProcess] = useAutoCollapseProcess()
  return <SettingsPage>
    <SettingsSection title={text.chat.processDisplay} icon={<FoldVertical size={17}/>}>
      <SettingToggle
        id="settings-auto-collapse-process"
        checked={autoCollapseProcess}
        onChange={setAutoCollapseProcess}
        label={text.chat.autoCollapseProcess}
        onText={text.chat.on}
        offText={text.chat.off}
      />
    </SettingsSection>
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
        <button className="primary" type="button" disabled={titleModel.saving} onClick={titleModel.submit}>
          <Save size={15}/>{text.chat.save}
        </button>
      </SettingFooter>
    </SettingsSection>
  </SettingsPage>
}

export default ChatSettingsPage
