import React, { useRef, useState, useLayoutEffect, useEffect } from 'react'
import { ct, chatLanguage } from './chatFormat.js'
import { Check, Clock3, ChevronDown, ChevronLeft, X } from 'lucide-react'
import { SETTINGS_TEXT } from '../lib/i18n'
import { createPortal } from 'react-dom'
import { KeychainPage } from '../pages/KeychainPage'

export function ChatKeychainDialog({ open, onClose, returnFocusRef }) {
  const closeButtonRef = useRef(null)
  const previousFocusRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const titleId = React.useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    previousFocusRef.current = document.activeElement
    const focusFrame = requestAnimationFrame(() => closeButtonRef.current?.focus())
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseRef.current?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      const returnFocus = returnFocusRef?.current || previousFocusRef.current
      requestAnimationFrame(() => returnFocus?.focus?.())
    }
  }, [open, returnFocusRef])

  if (!open || typeof document === 'undefined') return null
  const text = SETTINGS_TEXT[chatLanguage()] || SETTINGS_TEXT.zh
  return createPortal(
    <div className="oa-keychain-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="oa-keychain-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="oa-keychain-dialog-head">
          <div>
            <span className="oa-keychain-dialog-eyebrow">{ct('安全凭据', 'Secure credentials')}</span>
            <h2 id={titleId}>{ct('密钥管理', 'Keychain')}</h2>
            <p>{ct('配置会立即用于当前及后续聊天；密钥值始终隐藏。', 'Changes apply to this and future chats; secret values remain hidden.')}</p>
          </div>
          <button ref={closeButtonRef} type="button" className="oa-keychain-dialog-close" onClick={onClose} title={ct('关闭', 'Close')} aria-label={ct('关闭密钥管理', 'Close keychain')}>
            <X size={17}/>
          </button>
        </header>
        <div className="oa-keychain-dialog-body">
          <KeychainPage text={text}/>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export function PlanTodoCard({ plan }) {
  const listRef = useRef(null)
  const [expanded, setExpanded] = useState(true)
  const panelId = React.useId()
  const active = Boolean(plan?.active)
  const items = Array.isArray(plan?.items) ? plan.items : []
  const done = Number.isFinite(Number(plan?.done)) ? Number(plan.done) : items.filter(item => item?.status === 'done').length
  const total = Number.isFinite(Number(plan?.total)) ? Number(plan.total) : items.length
  const currentIndex = items.findIndex(item => item?.status !== 'done')
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0
  const complete = Boolean(plan?.complete)
  const placeholder = Boolean(plan?.placeholder)
  useLayoutEffect(() => {
    if (!active || !expanded || placeholder || currentIndex < 0) return
    const list = listRef.current
    const current = list?.querySelector('[aria-current="step"]')
    if (!list || !current) return
    const revealCurrent = () => {
      const listRect = list.getBoundingClientRect()
      const currentRect = current.getBoundingClientRect()
      if (currentRect.top < listRect.top) list.scrollTop -= listRect.top - currentRect.top + 6
      else if (currentRect.bottom > listRect.bottom) list.scrollTop += currentRect.bottom - listRect.bottom + 6
    }
    revealCurrent()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(revealCurrent)
    resizeObserver?.observe(list)
    resizeObserver?.observe(current)
    window.addEventListener('resize', revealCurrent)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', revealCurrent)
    }
  }, [active, currentIndex, expanded, placeholder, total])
  if (!active) return null
  const stateLabel = complete ? ct('已完成', 'Completed') : placeholder ? ct('规划中', 'Planning') : total > 0 ? ct('执行中', 'Running') : ct('准备中', 'Preparing')
  const detailLabel = complete
    ? ct('所有步骤均已完成', 'All steps completed')
    : placeholder
      ? ct('正在生成可执行步骤', 'Generating executable steps')
      : currentIndex >= 0 && total > 0
        ? ct(`正在处理第 ${currentIndex + 1} 步`, `Processing step ${currentIndex + 1}`)
        : ct('等待任务步骤', 'Waiting for task steps')
  return (
    <section className={`oa-plan-card${complete ? ' is-complete' : ''}`} aria-label={ct('任务执行计划', 'Task execution plan')}>
      <button type="button" className="oa-plan-head" onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded} aria-controls={panelId}
        aria-label={expanded ? '\u6536\u8d77\u6267\u884c\u8ba1\u5212' : '\u5c55\u5f00\u6267\u884c\u8ba1\u5212'}>
        <span className="oa-plan-identity">
          <span className="oa-plan-mark" aria-hidden="true">{complete ? <Check size={15}/> : <Clock3 size={14}/>}</span>
          <span className="oa-plan-heading">
            <span className="oa-plan-title">{ct('执行计划', 'Execution plan')}</span>
            <span className="oa-plan-detail">{detailLabel}</span>
          </span>
        </span>
        <span className="oa-plan-summary">
          <span className="oa-plan-state"><i aria-hidden="true"/>{stateLabel}</span>
          <span className="oa-plan-count" aria-label={ct(`已完成 ${done} 项，共 ${total} 项`, `${done} of ${total} complete`)}><strong>{done}</strong><span>/ {total}</span></span>
          <span className="oa-plan-chevron" aria-hidden="true">{expanded ? <ChevronDown size={15}/> : <ChevronLeft size={15}/>}</span>
        </span>
      </button>
      <div id={panelId} className="oa-plan-body" hidden={!expanded}>
        <div className="oa-plan-progress" role="progressbar" aria-label={ct('任务完成进度', 'Task completion progress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }}/>
        </div>
        {placeholder ? <div className="oa-plan-placeholder"><span aria-hidden="true"/><span>{ct('正在整理步骤', 'Organizing steps')}</span><code title={plan.pathHint || 'plan.md'}>{plan.pathHint || 'plan.md'}</code></div> : (
          <ol ref={listRef} className="oa-plan-list">
            {items.map((item, index) => {
              const itemComplete = item?.status === 'done'
              const current = !itemComplete && index === currentIndex
              return <li key={`${index}-${item?.content || ''}`} className={`${itemComplete ? 'is-done' : 'is-open'}${current ? ' is-current' : ''}`} aria-current={current ? 'step' : undefined}>
                <span className="oa-plan-status" aria-hidden="true">{itemComplete ? <Check size={11}/> : current ? <Clock3 size={10}/> : <span>{index + 1}</span>}</span>
                <span className="oa-plan-copy">{item?.content || `${ct('步骤', 'Step')} ${index + 1}`}</span>
                {current && <span className="oa-plan-now">{ct('当前', 'Current')}</span>}
              </li>
            })}
          </ol>
        )}
        {plan.step && <div className="oa-plan-step"><span>{ct('当前动作', 'Current action')}</span><p>{plan.step}</p></div>}
      </div>
    </section>
  )
}
