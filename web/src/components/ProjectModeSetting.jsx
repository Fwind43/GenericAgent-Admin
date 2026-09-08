import React, { useEffect, useState } from 'react'
import { SettingFooter, SettingRow, SettingsSection } from './settings'

export default function ProjectModeSetting({ value = 'official', onSave, lang = 'zh', disabled = false }) {
  const [draft, setDraft] = useState(value || 'official')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const tr = (zh, en) => lang === 'en' ? en : zh
  useEffect(() => { setDraft(value || 'official') }, [value])
  const save = async () => {
    setSaving(true)
    setMessage('')
    try {
      await onSave(draft)
      setMessage(tr('已保存，所有项目从下一轮起使用所选模式。', 'Saved. All projects use this mode from the next turn.'))
    } catch (error) {
      setMessage(error.message || String(error))
    } finally { setSaving(false) }
  }
  return <SettingsSection title={tr('项目模式', 'Project mode')} description={tr('选择所有项目的运行模式，已有项目和新项目均从下一轮起生效；正在执行的轮次保持不变，两套记忆分别保留。', 'Choose the runtime mode for all existing and new projects. Applies from the next turn; active turns stay unchanged and both memory stores are preserved.')}>
    <SettingRow label={tr('全局运行模式', 'Global runtime mode')} htmlFor="settings-project-mode">
      <select id="settings-project-mode" value={draft} disabled={disabled || saving} onChange={e => { setDraft(e.target.value); setMessage('') }}>
        <option value="official">{tr('官方项目模式', 'Official project mode')}</option>
        <option value="admin">{tr('Admin 项目模式（L1–L3）', 'Admin project mode (L1–L3)')}</option>
      </select>
    </SettingRow>
    <SettingFooter>
      <button className="primary" type="button" disabled={disabled || saving || !onSave || draft === (value || 'official')} onClick={save}>{saving ? tr('保存中…', 'Saving…') : tr('保存', 'Save')}</button>
      {message && <span role="status">{message}</span>}
    </SettingFooter>
  </SettingsSection>
}
