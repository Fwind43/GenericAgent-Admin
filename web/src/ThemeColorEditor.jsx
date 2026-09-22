import React, { useEffect, useRef, useState } from 'react'
import Button from 'antd/es/button'
import Tag from 'antd/es/tag'
import ConfigProvider from 'antd/es/config-provider'
import { CUSTOM_COLORS_STYLE_ID, customColorsToAntd, CUSTOM_COLOR_TOKENS, getInitialCustomColors, persistCustomColors, previewCustomColors, sanitizeColorValue } from './themes'
import './theme-editor.css'

export const colorGroups = [
  ['Backgrounds / 背景与表面', ['bg', 'bg-soft', 'surface', 'surface-strong', 'surface-muted']],
  ['Text & borders / 文字与边框', ['text', 'muted', 'border', 'border-strong']],
  ['Accent & interaction / 强调与交互', ['accent', 'accent-hover', 'accent-text', 'on-accent', 'hover', 'selected', 'selected-text', 'disabled-bg', 'disabled-text', 'focus']],
  ['Status / 状态', ['success', 'warning', 'error', 'info']],
  ['Scrollbars / 滚动条', ['scrollbar-track', 'scrollbar-thumb', 'scrollbar-hover']],
  ['Chat colors / 聊天颜色', CUSTOM_COLOR_TOKENS.filter(item => item.scope === 'chat').map(item => item.token)],
]

export function useThemeColorController({ theme, lang = 'en', active = true, disabled = false, isolated = false }) {
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
    return () => { mounted.current = false; if (session.current && !isolated) previewCustomColors(session.current) }
  }, [])
  useEffect(() => {
    if (!active && session.current && !busy) {
      if (!isolated) previewCustomColors(session.current)
      session.current = null
      setOpen(false)
    }
  }, [active, busy])
  const invalid = Object.entries(draft).filter(([, value]) => value.trim() && !sanitizeColorValue(value))
  const begin = () => {
    if (disabled || pending.current || open || !active) return
    const initial = getInitialCustomColors()
    session.current = initial
    if (!isolated) previewCustomColors(initial) // Also invalidates a late hydration response.
    setDraft(initial); setOpen(true); setMessage(''); setFailed(false)
  }
  const update = next => {
    if (disabled || pending.current || !open || !active) return
    setDraft(next); setMessage(''); setFailed(false)
    if (!isolated) previewCustomColors(next)
  }
  const cancel = () => {
    if (disabled || pending.current || !open) return
    if (!isolated) previewCustomColors(session.current || {})
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
    model: { zh, open, isolated, draft: { ...draft }, busy: busy || disabled, dirty, message, failed,
      canSave: open && dirty && !invalid.length && !busy && !disabled,
      groups: colorGroups.map(([title, tokens]) => ({ title, tokens: [...tokens] })) },
    actions: { begin, cancel, save, restoreDefaults: () => update({}), changeColor: (token, value) => {
      if (CUSTOM_COLOR_TOKENS.some(item => item.token === token) && typeof value === 'string') update({ ...draft, [token]: value })
    } },
  }
}

// Read the active base palette without temporarily mutating the application.
function basePreviewVariables() {
  const values = {}
  const visit = rules => {
    for (const rule of rules) {
      if (rule.selectorText && rule.style && document.documentElement.matches(rule.selectorText)) {
        for (const property of Array.from(rule.style)) {
          if (property.startsWith('--')) values[property] = rule.style.getPropertyValue(property).trim()
        }
      } else if (rule.cssRules && (!rule.conditionText || (rule.media ? matchMedia(rule.conditionText).matches : CSS.supports(rule.conditionText)))) visit(rule.cssRules)
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.ownerNode?.id === CUSTOM_COLORS_STYLE_ID) continue
    try { visit(sheet.cssRules) } catch { /* Cross-origin sheets are not palette sources. */ }
  }
  return values
}

export function ThemeColorView({ model, actions, compact = false }) {
  const { zh, open, draft, busy, message, failed, canSave, groups } = model
  const { begin, cancel, save, restoreDefaults, changeColor } = actions
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [onlyOverrides, setOnlyOverrides] = useState(false)
  const visibleGroups = groups.map(group => ({ ...group, tokens: group.tokens.filter(token =>
    (category === 'all' || category === group.title) &&
    token.toLowerCase().includes(query.trim().toLowerCase()) &&
    (!onlyOverrides || !!draft[token]?.trim())) })).filter(group => group.tokens.length)
  const overrideCount = Object.values(draft).filter(value => value.trim()).length
  const groupLabel = title => title.split(' / ')[zh ? 1 : 0] || title
  return <section className={`theme-editor${compact ? " theme-editor-compact" : ""}`} aria-label={zh ? '自定义主题颜色' : 'Custom theme colors'}>
    <header><div><h3>{zh ? '自定义主题颜色' : 'Custom theme colors'}</h3>
      <p>{zh ? '以当前选中的预设为基础，编辑下列34项颜色。仅覆盖列出的界面与聊天令牌，不改变图片或所有第三方内容。' : 'Based on the selected preset. Edit 34 listed interface and chat colors; images and unlisted third-party content are not recolored.'}</p></div>
      {!open && <button type="button" disabled={busy} onClick={begin}>{zh ? '编辑颜色' : 'Edit colors'}</button>}
    </header>
    {open && <>
      <p className="theme-editor-help">{zh ? '实时预览不会保存。已填写的颜色直接用于对应状态，不作为派生种子。留空继承预设；支持 #RGB / #RGBA / #RRGGBB / #RRGGBBAA、rgb()、rgba()。取消或离开本页恢复已保存颜色。恢复默认仅清空草稿覆盖，仍需保存。' : 'Live preview does not save. Filled colors apply exactly to their named states, not as palette seeds. Blank inherits preset. Accepts hex (3/4/6/8), rgb(), rgba(). Cancel or leave this page to restore saved colors. Restore defaults only clears draft overrides; Save is still required.'}</p>
      <div className="theme-workbench-toolbar">
        <input type="search" aria-label={zh ? '搜索颜色变量' : 'Search color tokens'} placeholder={zh ? '搜索颜色变量…' : 'Search color tokens…'} value={query} onChange={e => setQuery(e.target.value)}/>
        <label><input type="checkbox" checked={onlyOverrides} onChange={e => setOnlyOverrides(e.target.checked)}/>{zh ? '仅看已覆盖' : 'Overrides only'}</label>
        <span>{zh ? `已覆盖 ${overrideCount} 项` : `${overrideCount} overrides`}</span>
      </div>
      <nav className="theme-workbench-categories" aria-label={zh ? '颜色分类' : 'Color categories'}>
        <button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>{zh ? '全部' : 'All'}</button>
        {groups.map(group => <button type="button" key={group.title} aria-pressed={category === group.title} onClick={() => setCategory(group.title)}>{groupLabel(group.title)}</button>)}
      </nav>
      <div className="theme-workbench-layout">
      <fieldset disabled={busy} className="theme-editor-fields">
        {!visibleGroups.length && <p className="theme-workbench-empty">{zh ? '没有匹配的颜色变量，请调整筛选条件。' : 'No matching color tokens. Adjust your filters.'}</p>}
        {visibleGroups.map(({title, tokens}) => <fieldset key={title}><legend>{groupLabel(title)}</legend><div className="theme-color-grid">
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
      <aside style={model.isolated ? ({ ...basePreviewVariables(), ...Object.fromEntries(Object.entries(draft).filter(([, value]) => sanitizeColorValue(value)).map(([token, value]) => [`--${token}`, value])) }) : undefined} className="theme-workbench-preview" aria-label={zh ? '实时预览' : 'Live preview'}>
      <h4>{zh ? '实时预览' : 'Live preview'}</h4>
      <p>{zh ? '检查按钮、状态与文字层次。草稿尚未保存。' : 'Inspect controls, status and text hierarchy. Changes are not saved yet.'}</p>
      <div className="theme-preview-document"><small>GenericAgent Admin</small><h4>{zh ? '专注于下一步' : 'Focus on what comes next'}</h4><p>{zh ? '清晰的文字、安静的背景，让重要操作自然浮现。' : 'Clear text and calm surfaces keep important actions in focus.'}</p><a href="#theme-preview" onClick={e => e.preventDefault()}>{zh ? '链接预览' : 'Link preview'}</a></div>
      <div className="theme-editor-sample" aria-label="Component preview">
        <button type="button" className="primary">{zh ? '主按钮' : 'Primary'}</button>
        <button type="button" aria-pressed="true">{zh ? '已选择' : 'Selected'}</button>
        <button type="button" disabled>{zh ? '不可用' : 'Disabled'}</button>
        <ConfigProvider theme={{ token: customColorsToAntd(draft) }}><Button type="primary">Ant Design</Button><Button disabled>AntD disabled</Button><Tag color="success">Status</Tag></ConfigProvider>
      </div>
      </aside>
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
