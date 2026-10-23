import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { providerDisplayName } from '../lib/modelsProvider'

const modelKey = (value) => value
  ? JSON.stringify([String(value.provider_var_name || ''), String(value.model || '')])
  : ''

export function useViewImageModel({ lang, setMsg, active }) {
  const zh = lang === 'zh'
  const [config, setConfig] = useState(null)
  const [choices, setChoices] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabledState] = useState(false)
  const [mode, setModeState] = useState('main')
  const [draft, updateDraft] = useState('')
  const [feedback, setFeedback] = useState('')
  const pending = useRef(false)
  const guard = fn => value => { if (!pending.current) { fn(value); setFeedback('') } }

  const reload = async () => {
    const data = await api('/api/models/view-image-model')
    setConfig(data?.config || null)
    setChoices(Array.isArray(data?.options) ? data.options : [])
    setLoaded(true)
    return data
  }

  useEffect(() => {
    if (!active || loaded) return
    reload().catch(error => setFeedback(error.message))
  }, [active])

  useEffect(() => {
    setEnabledState(config?.enable === true)
    setModeState(config?.mode === 'vision' ? 'vision' : 'main')
    updateDraft(config?.mode === 'vision' ? modelKey(config) : '')
  }, [config?.enable, config?.mode, config?.provider_var_name, config?.model])

  const options = useMemo(() => [
    { value: '', label: zh ? '请选择视觉模型' : 'Select a vision model' },
    ...choices.map((option, llmNo) => ({
      value: modelKey(option),
      label: `${option.model} · ${String(option.provider_display_name || '').trim() || providerDisplayName(option.provider_var_name) || option.provider_var_name} · #${llmNo}`,
    })),
  ], [choices, zh])

  const savedEnabled = config?.enable === true
  const savedMode = config?.mode === 'vision' ? 'vision' : 'main'
  const savedDraft = savedMode === 'vision' ? modelKey(config) : ''
  const dirty = enabled !== savedEnabled || (enabled && (mode !== savedMode || (mode === 'vision' && draft !== savedDraft)))
  const missingModel = enabled && mode === 'vision' && draft === ''

  const submit = async () => {
    if (pending.current) return false
    if (missingModel) {
      setFeedback(zh ? '视觉模式需要先选择一个视觉模型' : 'Vision mode requires a vision model')
      return false
    }
    pending.current = true
    setSaving(true)
    setFeedback('')
    try {
      let selected = { enable: enabled, mode, provider_var_name: '', model: '', llm_no: 0 }
      if (enabled && mode === 'vision') {
        const llmNo = choices.findIndex(option => modelKey(option) === draft)
        if (llmNo >= 0) selected = { ...selected, provider_var_name: choices[llmNo].provider_var_name, model: choices[llmNo].model, llm_no: llmNo }
      }
      if (!await confirmDanger('models-view-image', zh ? '保存看图工具设置？' : 'Save the image viewing tool setting?')) return false
      const data = await api('/api/models/view-image-model', { dangerous: true, method: 'PUT', body: JSON.stringify({ config: selected }) })
      setConfig(data?.config || null)
      const done = zh ? '看图工具设置已保存，新的运行生效' : 'Image viewing setting saved; applies to new runs'
      setFeedback(done)
      setMsg(done)
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

  return {
    enabled, setEnabled: guard(v => setEnabledState(Boolean(v))),
    mode, setMode: guard(v => setModeState(v === 'vision' ? 'vision' : 'main')),
    draft, setDraft: guard(updateDraft),
    options, saving, dirty, feedback, missingModel, submit, reload,
  }
}
