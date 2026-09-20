import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { orderedModelRows } from '../lib/modelsEditor'
import { providerDisplayName } from '../lib/modelsProvider'

const titleModelKey = (value) => value
  ? JSON.stringify([String(value.provider_var_name || ''), String(value.model || '')])
  : ''

// The chat title model is stored independently of the conversation model, so the
// settings page reads its own option list instead of loading the models editor.
export function useTitleModel({ t, lang, setMsg, active, fallbackProfiles = [] }) {
  const [model, setModel] = useState(null)
  const [choices, setChoices] = useState([])
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [draft, updateDraft] = useState('')
  const [feedback, setFeedback] = useState('')
  const pending = useRef(false)
  const setDraft = value => { if (!pending.current) { updateDraft(value); setFeedback('') } }
  const changeEnabled = value => { if (!pending.current) { setEnabled(Boolean(value)); setFeedback('') } }
  const savedDraft = model?.enable === true && (model.provider_var_name || model.model) ? titleModelKey(model) : ''
  const dirty = enabled !== (model?.enable === true) || (enabled && draft !== savedDraft)

  const reload = async () => {
    const data = await api('/api/models/title-model')
    setModel(data?.model || null)
    setChoices(Array.isArray(data?.options) ? data.options : [])
    return data
  }

  useEffect(() => {
    if (!active || choices.length) return
    reload().catch(() => {})
  }, [active])

  const rows = useMemo(() => {
    if (choices.length) {
      return choices.map(option => ({
        providerVarName: String(option?.provider_var_name || ''),
        providerName: String(option?.provider_display_name || '').trim(),
        model: String(option?.model || ''),
      }))
    }
    return orderedModelRows(fallbackProfiles).map(row => ({
      ...row,
      providerName: String(fallbackProfiles[row.profileIndex]?.display_name || '').trim(),
    }))
  }, [choices, fallbackProfiles])

  const options = useMemo(() => [
    { value: '', label: t.titleModelFollowConversation },
    ...rows.map((row, llmNo) => ({
      value: titleModelKey({ provider_var_name: row.providerVarName, model: row.model }),
      label: `${row.model} · ${row.providerName || providerDisplayName(row.providerVarName) || row.providerVarName} · #${llmNo}`,
    })),
  ], [rows, t.titleModelFollowConversation])

  useEffect(() => {
    const on = model?.enable === true
    setEnabled(on)
    updateDraft(!on || (!model.provider_var_name && !model.model) ? '' : titleModelKey(model))
  }, [model?.enable, model?.provider_var_name, model?.model])

  const submit = async () => {
    // Lock before confirmation: React state alone cannot reject same-tick calls.
    if (pending.current) return false
    pending.current = true
    setSaving(true)
    setFeedback('')
    try {
      let selected
      if (!enabled) {
        selected = { enable: false, provider_var_name: '', model: '', llm_no: 0 }
      } else if (draft === '') {
        selected = { enable: true, provider_var_name: '', model: '', llm_no: 0 }
      } else {
        const rowIndex = rows.findIndex(row => titleModelKey({ provider_var_name: row.providerVarName, model: row.model }) === draft)
        selected = rowIndex < 0
          ? { enable: true, provider_var_name: '', model: '', llm_no: 0 }
          : { enable: true, provider_var_name: rows[rowIndex].providerVarName, model: rows[rowIndex].model, llm_no: rowIndex }
      }
      if (!await confirmDanger('models-title-model', lang === 'zh' ? '保存独立的对话标题模型设置？' : 'Save the independent chat title model setting?')) return false
      const data = await api('/api/models/title-model', { dangerous: true, method: 'PUT', body: JSON.stringify({ model: selected }) })
      setModel(data?.model || null)
      setFeedback(t.titleModelSaved)
      setMsg(t.titleModelSaved)
      return true
    } catch (error) {
      setFeedback(error.message)
      setMsg(error.message)
      return false
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return { model, options, enabled, setEnabled: changeEnabled, draft, setDraft, saving, dirty, feedback, submit, reload }
}
