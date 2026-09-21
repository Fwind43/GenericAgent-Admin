import './chat-settings-workbench.css'
import React, { useState } from 'react'
import { UiSurface } from '../ui/UiHost'
import { DefaultChatTitleSettings } from '../ui/chatTitleSettings'
import ProjectModeSetting from '../components/ProjectModeSetting'
import { DefaultProcessDisplaySettings } from '../ui/chatRuntimeSettings'
import { useAutoCollapseProcess } from '../hooks/useAutoCollapseProcess.js'
import { SettingsPage } from '../components/settings'

export function ChatSettingsPage({ t, text, titleModel, lang, projectProvider, onSaveProjectProvider, projectSettingsDisabled }) {
  const [autoCollapseProcess, setAutoCollapseProcess] = useAutoCollapseProcess()
  const [processFeedback, setProcessFeedback] = useState('')
  const en = lang === 'en'
  const titleView = {
    model: {
      enabled: titleModel.enabled, draft: titleModel.draft, busy: titleModel.saving,
      dirty: titleModel.dirty, feedback: titleModel.feedback,
      options: titleModel.options.map(({ value, label }) => ({ value, label })),
      labels: {
        title: text.chat.autoTitle, description: text.chat.autoTitleDesc,
        toggle: text.chat.toggle, toggleHelp: text.chat.toggleHelp,
        on: text.chat.on, off: text.chat.off, model: t.titleModel,
        modelHelp: text.chat.modelHelp, save: text.chat.save,
        saving: en ? 'Saving…' : '保存中…',
        scope: en ? 'Save applies only to automatic titles, including the switch above.' : '保存仅应用于自动标题设置，包括上方开关。',
        unsaved: en ? 'Unsaved changes' : '有未保存的更改',
        current: en ? 'Matches saved settings' : '与已保存设置一致',
      },
    },
    actions: { setEnabled: titleModel.setEnabled, selectModel: titleModel.setDraft, save: titleModel.submit },
  }
  const processView = {
    model: {
      enabled: autoCollapseProcess, feedback: processFeedback,
      labels: {
        title: text.chat.processDisplay,
        description: en ? 'Changes apply immediately on this device; no save required.' : '更改立即在此设备生效，无需保存。',
        toggle: text.chat.autoCollapseProcess, on: text.chat.on, off: text.chat.off,
      },
    },
    actions: { setEnabled: enabled => {
      if (typeof enabled !== 'boolean') return
      const persisted = setAutoCollapseProcess(enabled)
      setProcessFeedback(persisted ? '' : (en ? 'Applied for this session only. Device storage is unavailable; retry to persist.' : '已在本次会话生效，但设备存储不可用；请重试以持久保存。'))
    } },
  }
  return <SettingsPage className="chat-settings-workbench">
    <nav className="chat-settings-nav" aria-label={en ? 'Chat settings sections' : '聊天设置分区'}>
      <a href="#chat-project-mode">{en ? 'Project mode' : '项目模式'}</a>
      <a href="#chat-process-display">{text.chat.processDisplay}</a>
      <a href="#chat-auto-title">{text.chat.autoTitle}</a>
    </nav>
    <div className="chat-settings-content">
    <div id="chat-project-mode" tabIndex={-1}>
    <ProjectModeSetting value={projectProvider} onSave={onSaveProjectProvider} lang={lang} disabled={projectSettingsDisabled}/>
    </div>
    <div id="chat-process-display" tabIndex={-1}>
    <UiSurface name="admin.settings.chat.process" viewProps={processView} fallback={<DefaultProcessDisplaySettings {...processView}/>}/>
    </div>
    <div id="chat-auto-title" tabIndex={-1}>
    <UiSurface name="admin.settings.chat.title" viewProps={titleView} fallback={<DefaultChatTitleSettings {...titleView}/>}/>
    </div>
    </div>
  </SettingsPage>
}

export default ChatSettingsPage
