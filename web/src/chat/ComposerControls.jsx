import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { ChevronDown, Check, FileImage, Paperclip, Sparkles, FileText, KeyRound, Bot, Orbit, Plus, X, Search } from 'lucide-react'
import { ct } from './chatFormat.js'
import { isMobileModelPickerViewport } from './viewport.js'
import { createPortal } from 'react-dom'
import { REASONING_EFFORT_LEVELS } from '../lib/reasoningEffort'

function ReasoningEffortOptions({ options = [], value = 'off', onChange }) {
  return (
    <div className="oa-reasoning-options">
      {options.map((option, optionIndex) => {
        const active = option.value === value
        const followsModel = option.value === 'off'
        const canonicalLevel = REASONING_EFFORT_LEVELS.indexOf(option.value)
        const effortLevel = Math.max(1, canonicalLevel > 0 ? canonicalLevel : optionIndex)
        return (
          <button
            key={option.value}
            type="button"
            className={`${active ? 'active ' : ''}${followsModel ? 'oa-reasoning-default' : ''}`.trim()}
            aria-label={option.label}
            aria-pressed={active}
            onClick={() => onChange?.(option.value)}
          >
            {followsModel ? (
              <>
                <span className="oa-reasoning-label">{option.label}</span>
                <span className="oa-reasoning-hint" aria-hidden="true">跟随模型配置</span>
              </>
            ) : (
              <>
                <span
                  className="oa-reasoning-meter"
                  style={{ '--oa-reasoning-fill': `${(effortLevel / 7) * 100}%` }}
                  aria-hidden="true"
                ><span /></span>
                <span className="oa-reasoning-label">{option.label}</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function ProviderModelCascade({
  groups,
  selectedProvider,
  value,
  onChange,
  reasoningValue = 'off',
  reasoningOptions = [],
  onReasoningChange,
  disabled,
}) {
  const [open, setOpen] = useState(false)
  const [mobilePicker, setMobilePicker] = useState(isMobileModelPickerViewport)
  const [collapsedProviders, setCollapsedProviders] = useState(() => new Set())
  const [previewProvider, setPreviewProvider] = useState(selectedProvider || groups[0]?.value || '')
  const [query, setQuery] = useState('')
  const ref = useRef()
  const layerRef = useRef(null)
  const triggerRef = useRef(null)
  const modelListRef = useRef(null)
  const menuId = React.useId()
  const titleId = `${menuId}-title`
  const resetPreview = () => {
    setQuery('')
    if (selectedProvider && groups.some(group => group.value === selectedProvider)) setPreviewProvider(selectedProvider)
    else setPreviewProvider(groups[0]?.value || '')
  }
  const toggleMenu = () => {
    if (!open) {
      resetPreview()
      setCollapsedProviders(new Set(groups.filter(group => group.value !== selectedProvider).map(group => group.value)))
    }
    setOpen(value => !value)
  }
  const closeMenu = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) window.requestAnimationFrame?.(() => triggerRef.current?.focus())
  }
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(max-width: 680px)')
    if (!mq) return undefined
    const sync = () => setMobilePicker(Boolean(mq.matches))
    sync()
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync)
      return () => mq.removeEventListener('change', sync)
    }
    mq.addListener?.(sync)
    return () => mq.removeListener?.(sync)
  }, [])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const h = e => {
      if (!ref.current?.contains(e.target) && !layerRef.current?.contains(e.target)) close()
    }
    const onKeyDown = e => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close()
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  useEffect(() => {
    if (!open || !mobilePicker || typeof document === 'undefined') return undefined
    const root = document.documentElement
    const previousOverflow = root.style.overflow
    root.style.overflow = 'hidden'
    return () => { root.style.overflow = previousOverflow }
  }, [open, mobilePicker])
  useEffect(() => {
    if (selectedProvider && groups.some(group => group.value === selectedProvider)) setPreviewProvider(selectedProvider)
    else if (groups[0]) setPreviewProvider(groups[0].value)
    else setPreviewProvider('')
  }, [selectedProvider, groups])

  const activeGroup = groups.find(group => group.value === selectedProvider)
  const previewGroup = groups.find(group => group.value === previewProvider) || activeGroup || groups[0]
  const activeModel = activeGroup?.models.find(model => String(model.value) === String(value))
  const activeReasoning = reasoningOptions.find(option => option.value === reasoningValue)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredGroups = groups.map(group => {
    const providerMatch = group.label.toLocaleLowerCase().includes(normalizedQuery)
    return {
      ...group,
      models: !normalizedQuery || providerMatch
        ? group.models
        : group.models.filter(model => model.label.toLocaleLowerCase().includes(normalizedQuery)),
    }
  }).filter(group => group.models.length)
  const displayModel = activeModel?.label || ct('\u672a\u53d1\u73b0\u6a21\u578b', 'No models found')
  const displayReasoning = activeReasoning?.label || ct('\u9ed8\u8ba4', 'Default')
  const displayValue = `${displayModel} \u00b7 ${displayReasoning}`
  useLayoutEffect(() => {
    if (!open || previewGroup?.value !== selectedProvider) return
    const list = modelListRef.current
    const current = list?.querySelector('[aria-current="true"]')
    if (!list || !current) return
    const listRect = list.getBoundingClientRect()
    const currentRect = current.getBoundingClientRect()
    if (currentRect.top < listRect.top) list.scrollTop -= listRect.top - currentRect.top + 2
    else if (currentRect.bottom > listRect.bottom) list.scrollTop += currentRect.bottom - listRect.bottom + 2
  }, [open, previewGroup?.value, selectedProvider, value])

  const chooseModel = modelValue => {
    onChange?.(modelValue)
  }
  const chooseReasoning = effort => {
    onReasoningChange?.(effort)
    // Keep menu open when adjusting reasoning effort
    // closeMenu()
  }
  const mobileLayer = open && mobilePicker && typeof document !== 'undefined' ? createPortal(
    <div className="oa-model-picker-layer" ref={layerRef}>
      <button className="oa-model-picker-backdrop" type="button" tabIndex={-1}
        aria-label={ct('点击背景关闭模型选择器', 'Close model picker from backdrop')} onClick={() => closeMenu(true)} />
      <section id={menuId} className="oa-model-picker-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="oa-model-picker-header">
          <div>
            <span>{ct('当前会话', 'Current chat')}</span>
            <h2 id={titleId}>{ct('选择模型', 'Choose a model')}</h2>
          </div>
          <button type="button" aria-label={ct('关闭模型选择器', 'Close model picker')} onClick={() => closeMenu(true)}>
            <X size={18} />
          </button>
        </header>
        <div className="oa-model-picker-providers" role="tablist" aria-label={ct('服务商', 'Providers')}>
          {groups.map(group => (
            <button key={group.value} type="button" role="tab"
              className={group.value === previewGroup?.value ? 'active' : ''}
              aria-selected={group.value === previewGroup?.value}
              aria-controls={`${menuId}-models`}
              onClick={() => setPreviewProvider(group.value)}>
              {group.label}
            </button>
          ))}
        </div>
        <div id={`${menuId}-models`} className="oa-model-picker-models" ref={modelListRef}
          role="tabpanel" aria-label={previewGroup ? `${previewGroup.label} ${ct('模型', 'models')}` : ct('模型', 'Models')}>
          <div className="oa-model-picker-section-heading">
            <strong>{previewGroup?.label || ct('模型', 'Models')}</strong>
            <span>{previewGroup?.models.length || 0} {ct('个模型', 'models')}</span>
          </div>
          {previewGroup?.models.length ? previewGroup.models.map(model => {
            const isCurrent = previewGroup.value === selectedProvider && String(model.value) === String(value)
            return <button key={model.value} type="button" className={isCurrent ? 'active' : ''}
              aria-current={isCurrent ? 'true' : undefined} onClick={() => chooseModel(model.value)}>
              <span>{model.label}</span>
              <span className="oa-model-picker-check" aria-hidden="true">{isCurrent && <Check size={16} />}</span>
            </button>
          }) : <div className="oa-model-picker-empty">{ct('这个服务商还没有可用模型', 'No models are available for this provider')}</div>}
        </div>
        <div className="oa-model-picker-reasoning" aria-label={ct('\u63a8\u7406\u5f3a\u5ea6', 'Reasoning effort')}>
          <div className="oa-model-picker-section-heading">
            <strong>{ct('\u63a8\u7406\u5f3a\u5ea6', 'Reasoning effort')}</strong>
            <span>{displayReasoning}</span>
          </div>
          <ReasoningEffortOptions
            options={reasoningOptions}
            value={reasoningValue}
            onChange={onReasoningChange}
          />
        </div>
      </section>
    </div>,
    document.body,
  ) : null

  return (
    <div className="oa-model-select oa-composer-cascade" ref={ref}>
      <button ref={triggerRef} type="button" disabled={disabled} title={displayValue}
        aria-label={`${ct('\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6', 'Model and reasoning effort')}\uff1a${displayValue}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={menuId}
        onClick={toggleMenu}>
        <span className="oa-cascade-current-model">{displayModel}</span>
        <span className="oa-cascade-current-effort">{displayReasoning}</span>
        <ChevronDown size={13} />
      </button>
      {open && !mobilePicker && <div id={menuId} className="oa-cascade-menu" role="dialog" aria-label={ct('\u670d\u52a1\u5546\u3001\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6', 'Provider, model, and reasoning effort')}>
        <div className="oa-cascade-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            aria-label={ct('\u641c\u7d22\u670d\u52a1\u5546\u6216\u6a21\u578b', 'Search providers or models')}
            placeholder={ct('\u641c\u7d22\u670d\u52a1\u5546\u6216\u6a21\u578b', 'Search providers or models')}
            autoFocus
          />
          {query && <button type="button" onClick={() => setQuery('')} aria-label={ct('\u6e05\u9664\u641c\u7d22', 'Clear search')}><X size={13} /></button>}
        </div>
        <div className="oa-cascade-catalog" ref={modelListRef} aria-label={ct('\u6309\u670d\u52a1\u5546\u5206\u7ec4\u7684\u6a21\u578b', 'Models grouped by provider')}>
          {filteredGroups.length ? filteredGroups.map(group => {
            const expanded = Boolean(normalizedQuery) || !collapsedProviders.has(group.value)
            const modelsId = `${menuId}-group-${encodeURIComponent(group.value)}`
            return <section className="oa-cascade-group" key={group.value} aria-label={group.label}>
              <h3 className="oa-cascade-provider-heading" aria-label={group.label}>
                <button type="button" className="oa-cascade-provider-toggle"
                  aria-label={group.label} aria-expanded={expanded} aria-controls={modelsId}
                  disabled={Boolean(normalizedQuery)}
                  onClick={() => {
                    setCollapsedProviders(previous => {
                      const next = new Set(previous)
                      if (next.has(group.value)) next.delete(group.value)
                      else next.add(group.value)
                      return next
                    })
                  }}>
                  <ChevronDown size={13} aria-hidden="true" />
                  <span>{group.label}</span>
                  <span>{group.models.length}</span>
                </button>
              </h3>
              <div id={modelsId} className="oa-cascade-group-models" hidden={!expanded}>
                {group.models.map(model => {
                  const isCurrent = group.value === selectedProvider && String(model.value) === String(value)
                  return <button key={model.value} type="button"
                    className={isCurrent ? 'active' : ''}
                    aria-current={isCurrent ? 'true' : undefined}
                    title={`${group.label} / ${model.label}`}
                    onClick={() => chooseModel(model.value)}>
                    <span>{model.label}</span>
                    {isCurrent && <Check size={13} />}
                  </button>
                })}
              </div>
            </section>
          }) : <div className="oa-cascade-empty">{ct('\u6ca1\u6709\u5339\u914d\u7684\u670d\u52a1\u5546\u6216\u6a21\u578b', 'No matching providers or models')}</div>}
        </div>
        <div className="oa-cascade-reasoning" aria-label={ct('\u63a8\u7406\u5f3a\u5ea6', 'Reasoning effort')}>
          <div className="oa-cascade-heading">{ct('\u63a8\u7406\u5f3a\u5ea6', 'Reasoning effort')}</div>
          <ReasoningEffortOptions
            options={reasoningOptions}
            value={reasoningValue}
            onChange={onReasoningChange}
          />
        </div>
      </div>}
      {mobileLayer}
    </div>
  )
}

export function ComposerActions({ onAttach, onPhotos, onCommands, onSystemPrompt, onKeychain, onAutorun, onLoop, onConductor, conductorActive, conductorDisabled, commandsOpen, keychainOpen, systemPromptActive, systemPromptLabel, autorunEnabled, loopOpen, triggerRef }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const fallbackTriggerRef = useRef(null)
  const actionTriggerRef = triggerRef || fallbackTriggerRef
  const triggerId = React.useId()

  useEffect(() => {
    if (!open) return
    const handleClick = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const actions = [
    ...(onPhotos ? [{ icon: FileImage, label: ct('相册', 'Photos'), onClick: onPhotos, active: false }] : []),
    { icon: Paperclip, label: ct('附件', 'Attachments'), onClick: onAttach, active: false },
    { icon: Sparkles, label: ct('命令', 'Commands'), onClick: onCommands, active: commandsOpen },
    { icon: FileText, label: systemPromptActive ? `${ct('系统提示', 'System prompt')} · ${systemPromptLabel}` : ct('系统提示', 'System prompt'), onClick: onSystemPrompt, active: systemPromptActive },
    { icon: KeyRound, label: ct('密钥管理', 'Keychain'), onClick: onKeychain, active: keychainOpen },
    { icon: Bot, label: ct('自主行动', 'Auto-action'), onClick: onAutorun, active: autorunEnabled },
    { icon: Orbit, label: 'Loop', onClick: onLoop, active: loopOpen },
    ...(onConductor ? [{ icon: Bot, label: conductorActive ? ct('切换为普通会话', 'Switch to ordinary chat') : ct('升级为指挥家', 'Upgrade to Conductor'), onClick: onConductor, disabled: conductorDisabled }] : []),
  ]

  return (
    <div className="oa-composer-actions" ref={ref}>
      <button
        ref={actionTriggerRef}
        id={triggerId}
        type="button"
        className={`oa-composer-actions-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(!open)}
        title={ct('更多操作', 'More actions')}
        aria-label={ct('更多操作', 'More actions')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus size={17} />
      </button>
      {open && (
        <div className="oa-composer-actions-menu" role="menu" aria-labelledby={triggerId}>
          {actions.map((action, i) => {
            const Icon = action.icon
            return (
              <button
                key={i}
                type="button"
                className={action.active ? 'is-active' : ''}
                disabled={action.disabled}
                onClick={() => {
                  action.onClick?.()
                  setOpen(false)
                }}
                role="menuitem"
              >
                <Icon size={16} />
                <span>{action.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function CustomSelect({ value, onChange, options, disabled, ariaLabel }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const h = e => { if (!ref.current?.contains(e.target)) close() }
    const onScroll = e => { if (!ref.current?.contains(e.target)) close() }
    document.addEventListener('mousedown', h)
    window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('scroll', onScroll, true) }
  }, [open])
  const label = options.find(o => String(o.value) === String(value))?.label ?? String(value)
  const displayLabel = label.includes('/') ? label.split('/').pop() : label
  return (
    <div className="oa-cselect" ref={ref}>
      <button type="button" disabled={disabled} title={label} aria-label={ariaLabel ? `${ariaLabel}: ${label}` : undefined} onClick={() => setOpen(o => !o)}>
        <span>{displayLabel}</span><ChevronDown size={13}/>
      </button>
      {open && <ul role="listbox">
        {options.map(o => (
          <li key={o.value} role="option" aria-selected={String(o.value)===String(value)}
            className={String(o.value)===String(value)?'active':''}
            onMouseDown={() => { onChange(o.value); setOpen(false) }}>
            {String(o.value)===String(value) && <Check size={11}/>}{o.label}
          </li>
        ))}
      </ul>}
    </div>
  )
}
