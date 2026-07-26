import { Component } from 'react'

// 统一的加载/错误反馈组件：路由级 Suspense fallback、行内 spinner、骨架屏、错误边界。
// 设计：沿用暖白磨砂 + 绿色强调色，尊重 prefers-reduced-motion。

const localized = (zh, en) => typeof document !== 'undefined' && document.documentElement.lang === 'en' ? en : zh

export function StatusNotice({ kind = 'success', message, onRetry, onDismiss, retryLabel, dismissLabel }) {
  if (!message) return null
  const isError = kind === 'error'
  return (
    <div
      className={`ga-status-notice ga-status-${kind}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-busy={kind === 'pending' ? 'true' : undefined}
    >
      <span className="ga-status-mark" aria-hidden="true" />
      <span className="ga-status-message">{message}</span>
      <span className="ga-status-actions">
        {isError && onRetry ? <button type="button" onClick={onRetry}>{retryLabel || localized('刷新状态', 'Retry')}</button> : null}
        {kind !== 'pending' && onDismiss ? <button type="button" className="ga-status-dismiss" onClick={onDismiss}>{dismissLabel || localized('关闭', 'Close')}</button> : null}
      </span>
    </div>
  )
}

export function Spinner({ label }) {
  return (
    <div className="ga-loading" role="status" aria-live="polite">
      <span className="ga-spinner" aria-hidden="true" />
      {label ? <span className="ga-loading-label">{label}</span> : null}
    </div>
  )
}

// 路由/页面级 Suspense 回退：居中显示，避免布局抖动。
export function RouteFallback({ label }) {
  return (
    <div className="ga-route-fallback" role="status" aria-live="polite">
      <Spinner label={label || localized('加载中…', 'Loading…')} />
    </div>
  )
}

// 内容占位骨架屏：用于列表/卡片加载态。
export function Skeleton({ lines = 3, className = '' }) {
  return (
    <div className={`ga-skeleton ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="ga-skeleton-line" />
      ))}
    </div>
  )
}


export function ErrorFallback({ error, onReset, title }) {
  const message = error?.message || String(error || 'Unknown error')
  return (
    <div className="ga-error-boundary" role="alert" aria-live="assertive">
      <div>
        <strong>{title || localized('页面加载失败', 'Page failed to load')}</strong>
        <p>{localized('当前页面模块渲染异常，其他导航仍可继续使用。', 'This page module failed to render. Other navigation remains available.')}</p>
        <code>{message}</code>
      </div>
      {onReset && <button type="button" onClick={onReset}>{localized('重试', 'Retry')}</button>}
    </div>
  )
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    if (this.props.onError) this.props.onError(error, info)
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      const Fallback = this.props.fallback || ErrorFallback
      return <Fallback error={this.state.error} onReset={this.reset} />
    }
    return this.props.children
  }
}
