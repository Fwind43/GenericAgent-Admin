import { SIZE_FIELDS, getSizes, normalizeSizes, sizeVariables } from '../themeSizes'
import React, { useEffect, useRef, useState } from 'react'
import { ThemeColorView, useThemeColorController, basePreviewVariables } from '../ThemeColorEditor'
import { THEMES, getInitialCustomColors, persistCustomColors, sanitizeColorValue } from '../themes'
import './theme-page.css'

export default function ThemePage({ theme, lang, setTheme, onDraftChange }) {
  const zh = lang === 'zh'
  const [selected, select] = useState(theme)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedSizes, setSavedSizes] = useState(getSizes)
  const [sizes, setSizes] = useState(getSizes)
  const pending = useRef(false)
  const colors = useThemeColorController({ theme, lang, isolated: true, disabled: busy })
  const preset = THEMES.find(item => item.id === selected) || THEMES[0]
  const sizeDirty = JSON.stringify(sizes) !== JSON.stringify(savedSizes)
  const dirty = selected !== theme || sizeDirty
  useEffect(() => { select(theme) }, [theme])
  useEffect(() => {
    onDraftChange?.({ dirty: dirty || colors.model.dirty, busy: busy || colors.model.busy })
    return () => onDraftChange?.({ dirty: false, busy: false })
  }, [dirty, busy, colors.model.dirty, colors.model.busy, onDraftChange])
  const apply = async () => {
    if (pending.current || !dirty || colors.model.open) return
    pending.current = true; setBusy(true); setError('')
    try {
      await persistCustomColors(getInitialCustomColors(), selected, sizeDirty ? sizes : undefined)
      window.__GA_UI_THEME__ = selected
      setTheme(selected)
      setSavedSizes(sizes)
    } catch { setError(zh ? '应用失败，请重试。你的选择仍然保留。' : 'Could not apply. Your selection is retained; please retry.') }
    finally { pending.current = false; setBusy(false) }
  }
  const overrides = colors.model.open ? colors.model.draft : getInitialCustomColors()
  const variables = { ...basePreviewVariables(preset), ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => sanitizeColorValue(value)).map(([key, value]) => [`--${key}`, value])) }
  return <div className="theme-page theme-studio">
    <section aria-label={zh ? '主题预设' : 'Theme presets'}>
      <div className="studio-heading"><h3>{zh ? '选择你的工作氛围' : 'Make it your workspace'}</h3><span>{zh ? '点击预览，应用后生效' : 'Preview first. Apply when ready.'}</span></div>
      <div className="studio-presets">{THEMES.map(item => <button type="button" key={item.id} className="studio-preset" aria-pressed={selected === item.id} disabled={busy || colors.model.open} onClick={() => { select(item.id); setError('') }}>
        <span className="studio-mini" aria-hidden="true" style={{ background: item.preview[0], color: item.preview[2] }}><i style={{ background: item.preview[1] }}/><span><b/><b/><em style={{ background: item.preview[2] }}/><b/></span></span>
        <span className="studio-preset-name">{item.label[lang] || item.label.en}<small>{theme === item.id ? (zh ? '使用中' : 'Active') : selected === item.id ? (zh ? '预览中' : 'Preview') : ''}</small></span>
        <span className="studio-description">{item.description[lang] || item.description.en}</span>
      </button>)}</div>
    </section>
    <section className="studio-sizes">
      <div className="studio-heading"><h3>{zh ? '尺寸与布局' : 'Size & layout'}</h3><button type="button" disabled={busy || colors.model.open} onClick={() => setSizes(normalizeSizes())}>{zh ? '恢复默认尺寸' : 'Reset sizes'}</button></div>
      <p>{zh ? '调整仅在下方预览，应用后同步到聊天界面。窄屏自动限制宽度。' : 'Preview locally; apply to update chat. Widths adapt on small screens.'}</p>
      <div className="studio-density">{[[10,30,'紧凑','Compact'],[14,36,'标准','Standard'],[20,44,'宽松','Comfortable']].map(([spacing,controlHeight,cn,en]) => <button type="button" key={en} disabled={busy || colors.model.open} aria-pressed={sizes.spacing===spacing && sizes.controlHeight===controlHeight} onClick={() => setSizes(s => ({...s,spacing,controlHeight}))}>{zh ? cn : en}</button>)}</div>
      <div className="studio-size-grid">{SIZE_FIELDS.map(([key,cn,en,min,max,step]) => <label key={key} htmlFor={`size-${key}`}><span>{zh ? cn : en}<output>{sizes[key]}{key.endsWith('Weight') ? '' : ' px'}</output></span>{key.endsWith('Weight') && <input className="studio-weight-number" aria-label={`${zh ? cn : en} ${zh ? '数值' : 'value'}`} type="number" min={min} max={max} step={step} value={sizes[key]} disabled={busy || colors.model.open} onChange={e => { if (e.target.value !== '') setSizes(s => ({...s,[key]:Number(e.target.value)})) }} onBlur={() => setSizes(s => normalizeSizes(s))}/>}<input id={`size-${key}`} type="range" min={min} max={max} step={step} value={sizes[key]} disabled={busy || colors.model.open} onChange={e => setSizes(s => ({...s,[key]:Number(e.target.value)}))}/></label>)}</div>
    </section>
    <section className="studio-preview-section" aria-label={zh ? '聊天界面预览' : 'Chat preview'}>
      <div className="studio-heading"><h3>{zh ? '界面预览' : 'Workspace preview'}</h3><span>{preset.label[lang] || preset.label.en} · {zh ? '示例内容，不会发送消息' : 'Sample content, no messages sent'}</span></div>
      <div className="studio-chat" style={{ ...variables, ...sizeVariables(sizes) }}>
        <aside className="studio-chat-sidebar"><strong>GenericAgent</strong><div className="studio-new">＋ {zh ? '新对话' : 'New chat'}</div><small>{zh ? '最近会话' : 'Recent chats'}</small><div className="studio-current">{zh ? '今天的工作计划' : 'Today’s work plan'}</div><p>{zh ? '整理项目思路' : 'Project notes'}</p><p>{zh ? '探索新的想法' : 'Explore ideas'}</p><footer>GenericAgent Admin</footer></aside>
        <div className="studio-chat-main"><div className="studio-chat-top">{zh ? '今天的工作计划' : 'Today’s work plan'}<span>···</span></div><div className="studio-messages"><div className="studio-user">{zh ? '帮我梳理一下今天的工作。' : 'Help me organize today’s work.'}</div><div className="studio-answer"><strong>GenericAgent</strong><p>{zh ? '当然。先从最重要的一件事开始。' : 'Of course. Start with the most important thing.'}</p><ul><li>{zh ? '明确目标，留出专注时间' : 'Define your goal and make time to focus'}</li><li>{zh ? '拆分步骤，逐项推进' : 'Break it into steps and work through them'}</li></ul><span className="studio-status">✓ {zh ? '已完成' : 'Completed'}</span></div></div><div className="studio-composer"><span>{zh ? '有什么可以帮你？' : 'How can I help?'}</span><div><span>＋</span><b>↑</b></div></div></div>
      </div>
    </section>
    <div className="studio-apply"><div><strong>{dirty ? (zh ? '正在预览，尚未应用' : 'Previewing, not applied') : (zh ? '正在使用此主题' : 'This theme is active')}</strong><small>{zh ? '已有的自定义颜色会保留。预览不会改变其他页面。' : 'Custom colors are preserved. Preview leaves other pages unchanged.'}</small></div><button disabled={!dirty || busy || colors.model.open} onClick={() => { select(theme); setSizes(savedSizes); setError('') }}>{zh ? '取消' : 'Cancel'}</button><button className="primary" disabled={!dirty || busy || colors.model.open} onClick={apply}>{busy ? (zh ? '应用中…' : 'Applying…') : (zh ? '应用主题' : 'Apply theme')}</button></div>
    {error && <p role="alert">{error}</p>}
    <div className="studio-advanced"><ThemeColorView model={{ ...colors.model, busy: colors.model.busy || dirty }} actions={colors.actions}/></div>
  </div>
}
