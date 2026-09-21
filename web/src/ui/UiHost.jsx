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
  return <Context.Provider value={{ pkg, id: pkg.manifest.id, select, restore, committed, loading, message, safe, preview, failSurface, isDefaultSurface, isFailedSurface: name => failedSurfaces.includes(name) }}>{children}</Context.Provider>
}
export function useUiPackage() {
  return useContext(Context)
}
class SurfaceBoundary extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) { this.props.restore(error.message) }
  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
function Commit({ children, committed }) { useEffect(() => { committed() }); return children }
export function UiSurface({ name, viewProps, fallback = null, preserveMount = false }) {
  const ui = useUiPackage()
  const DefaultView = defaults.views[name]
  if (!ui) return <DefaultView {...viewProps} fallback={fallback}/>
  const failed = ui.isFailedSurface(name)
  const View = failed ? DefaultView : surfaceView(ui.pkg, name, defaults)
  const isDefault = View === DefaultView
  const layout = failed ? 'default' : (ui.pkg.layouts?.[name] || 'default')
  const recovery = fallback || (preserveMount ? <DefaultView {...viewProps}/> : null)
  return <SurfaceBoundary key={preserveMount ? name : ui.id + name + isDefault} resetKey={ui.id} restore={() => ui.failSurface(name)} fallback={recovery}>
    <Commit committed={ui.committed}><View {...viewProps} layout={layout} {...(isDefault ? { fallback } : {})}/></Commit>
  </SurfaceBoundary>
}
