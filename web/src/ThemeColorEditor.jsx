import React, { useEffect, useRef, useState } from 'react'
import Button from 'antd/es/button'
import Tag from 'antd/es/tag'
import { CUSTOM_COLOR_TOKENS, getInitialCustomColors, persistCustomColors, previewCustomColors, sanitizeColorValue } from './themes'
import './theme-editor.css'

export const colorGroups = [
  ['Backgrounds / 背景与表面', ['bg', 'bg-soft', 'surface', 'surface-strong', 'surface-muted']],
  ['Text & borders / 文字与边框', ['text', 'muted', 'border', 'border-strong']],
  ['Accent & interaction / 强调与交互', ['accent', 'accent-hover', 'accent-text', 'on-accent', 'hover', 'selected', 'selected-text', 'disabled-bg', 'disabled-text', 'focus']],
  ['Status / 状态', ['success', 'warning', 'error', 'info']],
  ['Scrollbars / 滚动条', ['scrollbar-track', 'scrollbar-thumb', 'scrollbar-hover']],
  ['Chat colors / 聊天颜色', CUSTOM_COLOR_TOKENS.filter(item => item.scope === 'chat').map(item => item.token)],
]

export function useThemeColorController({ theme, lang = 'en', active = true, disabled = false }) {
  const zh = lang === 'zh'
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const pending = useRef(false)
  const session = useRef(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; if (session.current) previewCustomColors(session.current) }
  }, [])
  useEffect(() => {
    if (!active && session.current && !busy) {
      previewCustomColors(session.current)
      session.current = null
      setOpen(false)
    }
  }, [active, busy])
  const invalid = Object.entries(draft).filter(([, value]) => value.trim() && !sanitizeColorValue(value))
  const begin = () => {
    if (disabled || pending.current || open || !active) return
    const initial = getInitialCustomColors()
    session.current = initial
    previewCustomColors(initial) // Also invalidates a late hydration response.
    setDraft(initial); setOpen(true); setMessage(''); setFailed(false)
  }
  const update = next => {
    if (disabled || pending.current || !open || !active) return
    setDraft(next); setMessage(''); setFailed(false)
    previewCustomColors(next)
  }
  const cancel = () => {
    if (disabled || pending.current || !open) return
    previewCustomColors(session.current || {})
    session.current = null
    setOpen(false); setMessage(''); setFailed(false)
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(session.current || {})
  const save = async () => {
    if (disabled || pending.current || !open || !active || invalid.length || !dirty) return
    pending.current = true
    setBusy(true); setMessage(''); setFailed(false)
    try {
      const saved = await persistCustomColors(draft, theme)
      session.current = null
      if (mounted.current) { setDraft(saved); setOpen(false); setMessage(zh ? '颜色已保存。' : 'Colors saved.') }
    } catch {
      if (mounted.current) { setFailed(true); setMessage(zh ? '保存失败，草稿仍在。请重试或取消。' : 'Save failed. Draft retained; retry or cancel.') }
    } finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  return {
    model: { zh, open, draft: { ...draft }, busy: busy || disabled, dirty, message, failed,
      canSave: open && dirty && !invalid.length && !busy && !disabled,
      groups: colorGroups.map(([title, tokens]) => ({ title, tokens: [...tokens] })) },
    actions: { begin, cancel, save, restoreDefaults: () => update({}), changeColor: (token, value) => {
      if (CUSTOM_COLOR_TOKENS.some(item => item.token === token) && typeof value === 'string') update({ ...draft, [token]: value })
    } },
  }
}

export function ThemeColorView({ model, actions, compact = false }) {
  const { zh, open, draft, busy, message, failed, canSave, groups } = model
  const { begin, cancel, save, restoreDefaults, changeColor } = actions
  return <section className={`theme-editor${compact ? " theme-editor-compact" : ""}`} aria-label={zh ? '自定义主题颜色' : 'Custom theme colors'}>
    <header><div><h3>{zh ? '自定义主题颜色' : 'Custom theme colors'}</h3>
      <p>{zh ? '以当前四套预设之一为基础，编辑下列34项颜色。仅覆盖列出的界面与聊天令牌，不改变图片或所有第三方内容。' : 'Based on the selected preset. Edit 34 listed interface and chat colors; images and unlisted third-party content are not recolored.'}</p></div>
      {!open && <button type="button" disabled={busy} onClick={begin}>{zh ? '编辑颜色' : 'Edit colors'}</button>}
    </header>
    {open && <>
      <p className="theme-editor-help">{zh ? '实时预览不会保存。已填写的颜色直接用于对应状态，不作为派生种子。留空继承预设；支持 #RGB / #RGBA / #RRGGBB / #RRGGBBAA、rgb()、rgba()。取消或离开本页恢复已保存颜色。恢复默认仅清空草稿覆盖，仍需保存。' : 'Live preview does not save. Filled colors apply exactly to their named states, not as palette seeds. Blank inherits preset. Accepts hex (3/4/6/8), rgb(), rgba(). Cancel or leave this page to restore saved colors. Restore defaults only clears draft overrides; Save is still required.'}</p>
      <fieldset disabled={busy} className="theme-editor-fields">
        {groups.map(({title, tokens}) => <fieldset key={title}><legend>{title}</legend><div className="theme-color-grid">
          {tokens.map(token => {
            const value = draft[token] || ''
            const bad = !!value.trim() && !sanitizeColorValue(value)
            return <div className="theme-color-field" key={token}>
              <label htmlFor={`theme-color-${token}`}>{token}</label>
              <div className="theme-color-inputs">
                <input type="color" aria-label={`${token} color picker`} value={/^#[\da-f]{6}$/i.test(value) ? value : '#808080'} onChange={e => changeColor(token, e.target.value)}/>
                <input id={`theme-color-${token}`} value={value} maxLength={64} placeholder={zh ? '继承预设' : 'Inherit preset'} aria-invalid={bad} aria-describedby={bad ? `theme-error-${token}` : undefined} onChange={e => changeColor(token, e.target.value)}/>
              </div>
              {bad && <small id={`theme-error-${token}`} role="alert">{zh ? '请输入合法颜色' : 'Enter a valid literal color'}</small>}
            </div>
          })}
        </div></fieldset>)}
      </fieldset>
      <div className="theme-editor-sample" aria-label="Component preview">
        <button type="button" className="primary">{zh ? '主按钮' : 'Primary'}</button>
        <button type="button" aria-pressed="true">{zh ? '已选择' : 'Selected'}</button>
        <button type="button" disabled>{zh ? '不可用' : 'Disabled'}</button>
        <Button type="primary">Ant Design</Button><Button disabled>AntD disabled</Button><Tag color="success">Status</Tag>
      </div>
      <div className="theme-editor-actions">
        <button type="button" disabled={busy} onClick={restoreDefaults}>{zh ? '恢复默认（草稿）' : 'Restore defaults (draft)'}</button>
        <span/>
        <button type="button" disabled={busy} onClick={cancel}>{zh ? '取消预览' : 'Cancel preview'}</button>
        <button type="button" className="primary" disabled={!canSave} onClick={save}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存颜色' : 'Save colors')}</button>
      </div>
    </>}
    {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
  </section>
}

export default function ThemeColorEditor(props) {
  const controller = useThemeColorController(props)
  return <ThemeColorView {...controller}/>
}
