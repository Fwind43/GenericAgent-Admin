import React, { useEffect, useRef, useState } from 'react'
import { UiSurface } from '../ui/UiHost'
import { DefaultProjectModeSettings } from '../ui/chatRuntimeSettings'

export default function ProjectModeSetting({ value = 'official', onSave, lang = 'zh', disabled = false }) {
  const [draft, setDraft] = useState(value || 'official')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const pending = useRef(false)
  const tr = (zh, en) => lang === 'en' ? en : zh
  useEffect(() => { setDraft(value || 'official') }, [value])
  const dirty = draft !== (value || 'official')
  const selectMode = next => {
    if (disabled || pending.current || !['official', 'admin'].includes(next)) return
    setDraft(next)
    setMessage('')
  }
  const save = async () => {
    if (disabled || pending.current || !onSave || !dirty) return false
    pending.current = true
    setSaving(true)
    setMessage('')
    try {
      await onSave(draft)
      setMessage(tr('已保存，所有项目从下一轮起使用所选模式。', 'Saved. All projects use this mode from the next turn.'))
      return true
    } catch (error) {
      setMessage(error.message || String(error))
      return false
    } finally { pending.current = false; setSaving(false) }
  }
  const view = {
    model: {
      draft, busy: saving, dirty, disabled: disabled || !onSave, feedback: message,
      options: [
        { value: 'official', label: tr('官方项目模式', 'Official project mode') },
        { value: 'admin', label: tr('Admin 项目模式（L1–L3）', 'Admin project mode (L1–L3)') },
      ],
      labels: {
        title: tr('项目模式', 'Project mode'),
        description: tr('选择所有项目的运行模式，已有项目和新项目均从下一轮起生效；正在执行的轮次保持不变，两套记忆分别保留。', 'Choose the runtime mode for all existing and new projects. Applies from the next turn; active turns stay unchanged and both memory stores are preserved.'),
        mode: tr('全局运行模式', 'Global runtime mode'), save: tr('保存', 'Save'), saving: tr('保存中…', 'Saving…'),
        unsaved: tr('有未保存的更改', 'Unsaved changes'), current: tr('与已保存设置一致', 'Matches saved settings'),
      },
    },
    actions: { selectMode, save },
  }
  return <UiSurface name="admin.settings.chat.project" viewProps={view} fallback={<DefaultProjectModeSettings {...view}/>}/>
}
