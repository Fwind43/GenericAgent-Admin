import React, { useEffect, useId, useRef, useState } from 'react'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'

const COPY = {
  zh: {
    title: 'GitHub 镜像地址', placeholder: '例如 https://mirror.example',
    help: '仅用于更新包和校验文件，格式为镜像前缀/https://github.com/...。留空直连 GitHub，保存后立即生效，无需重启。',
    save: '保存镜像', saving: '正在保存', loading: '正在读取镜像配置…', retry: '重新读取',
    saved: '镜像配置已保存', loadFailed: '读取镜像配置失败：', saveFailed: '保存失败：',
    confirm: '保存 GitHub 镜像地址？仅修改更新下载镜像配置，留空将恢复直连 GitHub。',
  },
  en: {
    title: 'GitHub mirror URL', placeholder: 'For example, https://mirror.example',
    help: 'For update packages and checksum files only, using mirror-prefix/https://github.com/.... Leave blank for direct GitHub access. Saving takes effect immediately; no restart needed.',
    save: 'Save mirror', saving: 'Saving', loading: 'Loading mirror settings…', retry: 'Retry loading',
    saved: 'Mirror settings saved.', loadFailed: 'Could not load mirror settings: ', saveFailed: 'Save failed: ',
    confirm: 'Save the GitHub mirror URL? Only the update download mirror is changed. Leave blank to restore direct GitHub access.',
  },
}

export default function GitHubMirrorSetting({ lang = 'zh', disabled = false }) {
  const text = COPY[lang] || COPY.zh
  const id = useId()
  const mounted = useRef(false)
  const pending = useRef(false)
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const [draft, setDraft] = useState('')
  const [baseline, setBaseline] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError('')
    api('/api/config').then(config => {
      if (!active) return
      const value = config.github_mirror || ''
      setDraft(value)
      setBaseline(value)
    }).catch(error => {
      if (active) setLoadError(error.message)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [loadAttempt])

  const dirty = draft.trim() !== baseline
  const blocked = disabled || loading || Boolean(loadError) || saving
  const save = async event => {
    event.preventDefault()
    if (blocked || !dirty || pending.current) return
    pending.current = true
    setSaving(true)
    setNotice(null)
    try {
      if (!await confirmDanger('config-save', text.confirm) || !mounted.current || disabledRef.current) return
      const savedConfig = await api('/api/config')
      if (!mounted.current || disabledRef.current) return
      const config = await api('/api/config', {
        dangerous: true,
        method: 'PUT',
        body: JSON.stringify({ ...savedConfig, github_mirror: draft.trim() }),
      })
      if (!mounted.current) return
      const value = config.github_mirror || ''
      setDraft(value)
      setBaseline(value)
      setNotice({ kind: 'success', message: text.saved })
    } catch (error) {
      if (mounted.current) setNotice({ kind: 'error', message: text.saveFailed + error.message })
    } finally {
      pending.current = false
      if (mounted.current) setSaving(false)
    }
  }

  return <section className="system-update-mirror" aria-labelledby={`${id}-label`}>
    <form onSubmit={save}>
      <label id={`${id}-label`} htmlFor={id}>{text.title}</label>
      <div className="system-update-mirror-controls">
        <input id={id} type="url" value={draft} placeholder={text.placeholder}
          aria-describedby={`${id}-help`} disabled={blocked}
          onChange={event => { setDraft(event.target.value); setNotice(null) }}/>
        <button type="submit" disabled={blocked || !dirty}>{saving ? text.saving : text.save}</button>
      </div>
      <p id={`${id}-help`}>{text.help}</p>
      {loading && <p role="status">{text.loading}</p>}
      {loadError && <div className="system-update-mirror-error" role="alert">{text.loadFailed}{loadError}<button type="button" disabled={disabled} onClick={() => setLoadAttempt(value => value + 1)}>{text.retry}</button></div>}
      {notice && <p className={`system-update-mirror-notice is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</p>}
    </form>
  </section>
}
