import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { registry } from './registry'
import { defaults } from './default'
import { surfaceView } from './contract'
import { readSelection, writeSelection, browserStorage } from './selection'
import './host.css'
const Context = createContext(null)
export function UiHost({ children, disabled = false, preview = false, packageRegistry = registry }) {
  const safe = disabled || new URLSearchParams(window.location.search).get('ui') === 'safe'
  const [pkg, setPkg] = useState(defaults)
  const [failedSurfaces, setFailedSurfaces] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const generation = useRef(0)
  const mounted = useRef(true)
  const pending = useRef(false)
  const persist = id => {
    if (!preview && !disabled && !writeSelection(browserStorage(), id)) setMessage('Selection applies only to this visit / 选择仅本次生效')
  }
  const restore = (error = '') => {
    generation.current++
    pending.current = false
    setLoading(false)
    setFailedSurfaces([])
    setPkg(defaults)
    setMessage(error ? 'Package failed; default restored / 已恢复默认界面' : '')
    persist('default')
  }
  const select = async (id, guard = () => true) => {
    if (safe || !guard()) return false
    const ticket = ++generation.current
    setLoading(true)
    setMessage('')
    try {
      const next = await packageRegistry.load(id)
      if (!mounted.current || ticket !== generation.current) return false
      // Re-check after async import: a user may have edited a form while loading.
      if (!guard()) { setLoading(false); return false }
      pending.current = true
      setFailedSurfaces([])
      setPkg(next)
      setLoading(false)
      return true
    } catch (error) {
      if (mounted.current && ticket === generation.current) restore(error.message)
      return false
    }
  }
  useEffect(() => {
    mounted.current = true
    if (!safe) {
      const id = preview ? 'studio' : readSelection(browserStorage(), packageRegistry.has)
      if (id !== 'default') void select(id)
    }
    return () => { mounted.current = false; generation.current++ }
  }, []) // A host lifetime is independent of package selection.
  const failSurface = name => {
    pending.current = false
    setFailedSurfaces(current => current.includes(name) ? current : [...current, name])
    setMessage('Surface failed; default view restored / 当前区域已回退默认')
    persist('default')
  }
  const isDefaultSurface = name => failedSurfaces.includes(name) || surfaceView(pkg, name, defaults) === defaults.views[name]
  const committed = () => { if (pending.current) { pending.current = false; persist(pkg.manifest.id) } }
  return <Context.Provider value={{ pkg, id: pkg.manifest.id, select, restore, committed, loading, message, safe, preview, failSurface, isDefaultSurface }}>{children}</Context.Provider>
}
export const useUiPackage = () => useContext(Context)
class SurfaceBoundary extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) { this.props.restore(error.message) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
function Commit({ children, committed }) { useEffect(() => { committed() }); return children }
export function UiSurface({ name, viewProps, fallback = null }) {
  const ui = useUiPackage()
  const View = ui.isDefaultSurface(name) ? defaults.views[name] : surfaceView(ui.pkg, name, defaults)
  const isDefault = View === defaults.views[name]
  return <SurfaceBoundary key={ui.id + name + isDefault} restore={() => ui.failSurface(name)} fallback={fallback}>
    <Commit committed={ui.committed}><View {...viewProps} {...(isDefault ? { fallback } : {})}/></Commit>
  </SurfaceBoundary>
}
export function PackageControls({ allowed, guard }) {
  const ui = useUiPackage()
  return <section className="ui-package-controls" aria-label="Interface packages">
    <div><strong>Interface / 界面包</strong><small>Shell + overview only / 仅管理外壳与概览；其余沿用默认</small></div>
    <div className="ui-package-actions">
      <a href="/admin/overview?ui=preview" target="_blank" rel="noreferrer">Preview Studio / 示例预览 ↗</a>
      <button type="button" disabled={ui.safe || ui.loading || !allowed || ui.id === 'studio'} onClick={() => ui.select('studio', guard)}>Enable Studio / 启用</button>
      <button type="button" disabled={ui.safe || ui.loading || !allowed || ui.id === 'default'} onClick={() => ui.select('default', guard)}>Default / 默认</button>
      <a href="/admin/overview?ui=safe" target="_blank" rel="noreferrer">Safe mode / 安全入口</a>
    </div>
    {!allowed && <small>Switch on Overview after saving or finishing pending work / 请在概览保存修改并等待操作结束后切换</small>}
    {ui.safe && <small>Safe mode: candidate loading disabled. Reloading resets client connections. / 安全模式不加载候选包；刷新会重建客户端连接。</small>}
    {ui.message && <p role="status">{ui.message}</p>}
  </section>
}
