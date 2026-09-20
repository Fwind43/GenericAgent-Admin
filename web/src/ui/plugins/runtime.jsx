import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { pluginStore } from './store'
import { validateBundle, AREAS } from './protocol'
import './plugins.css'
const External = createContext(null)
export function useExternalUi() { return useContext(External) }
export function ExternalUiProvider({ children, store = pluginStore, disabled = false, onEnable }) {
  const [bundle, setBundle] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const locked = useRef(false), epoch = useRef(0)
  useEffect(() => {
    let alive = true; const current = ++epoch.current
    if (!disabled) store.active().then(async id => {
      if (id === 'default') return
      const loaded = await store.load(id)
      if (alive && current === epoch.current) { onEnable?.(); setBundle(loaded) }
    }).catch(async e => { if (alive && current === epoch.current) { setError(e.message); setBundle(null); try { await store.activate('default') } catch { /* visible error remains */ } } })
    return () => { alive = false }
  }, [store, disabled])
  useEffect(() => {
    const root = globalThis.document?.documentElement
    if (!root) return
    if (bundle && !disabled) root.dataset.externalUi = 'active'
    else delete root.dataset.externalUi
    return () => { delete root.dataset.externalUi }
  }, [bundle, disabled])
  async function activate(id) {
    if (disabled || locked.current) throw new Error('Plugin operation unavailable')
    locked.current = true; setBusy(true); ++epoch.current
    try {
      const next = id === 'default' ? null : validateBundle(await store.load(id))
      await store.activate(id)
      onEnable?.(); setBundle(next); setError('')
    } catch (e) { setError(e.message); throw e } finally { locked.current = false; setBusy(false) }
  }
  async function refresh() { if (bundle) setBundle(await store.load(bundle.manifest.id)) }
  function fail(message) { setBundle(null); setError(message); ++epoch.current; store.activate('default').catch(e => setError(message + '; ' + e.message)) }
  return <External.Provider value={{ bundle: disabled ? null : bundle, error, busy: busy || disabled, store, activate, refresh, fail }}><div className="gaui-runtime" data-external-ui={bundle ? 'active' : undefined}>{children}</div></External.Provider>
}
export function useChatLayout(area) {
  const ui = useExternalUi(), view = ui?.bundle?.views[area]
  return view ? { 'data-gaui-density': ui.bundle.config.density || view.layout.density, 'data-gaui-align': view.layout.align, 'data-gaui-order': view.layout.hostOrder, style: { '--gaui-accent': ui.bundle.config.accent || '#557766' } } : {}
}
export function projectData(area, props) {
  if (area === 'admin.shell') return { title: 'Workspace', navigation: (props.navigation?.groups || []).flatMap(g => g.items).slice(0, 40).map(i => ({ id: String(i.id), label: String(i.label).slice(0, 100) })) }
  const o = props.overview || {}
  return { title: 'Overview', status: String(o.health || 'pending'), services: (o.services || []).slice(0, 80).map(s => ({ label: String(s.name).slice(0, 100), status: s.running ? 'Running' : 'Stopped' })), metrics: ['total', 'enabled', 'due'].map(k => ({ label: k, value: Number(o.schedule?.[k]) || 0 })) }
}
export function dispatchAction(area, node, item, data, props) {
  if (area === 'admin.shell' && node.action === 'navigate' && node.target === 'item.id' && typeof item?.id === 'string' && data.navigation?.some(i => i.id === item.id) && props.navigation?.current !== item.id) props.navigation?.go?.(item.id)
  else if (area === 'admin.shell' && node.action === 'backToChat') props.navigation?.backToChat?.()
  else if (area === 'admin.overview' && node.action === 'refreshOverview' && !props.actions?.refreshing) props.actions?.refreshOverview?.()
}
export function NodeTree({ node, data = {}, item, invoke = () => {} }) {
  if (!node) return null
  if (node.type === 'each') return (data[node.source] || []).slice(0, 80).map((entry, i) => <NodeTree key={i} node={node.children[0]} data={data} item={entry} invoke={invoke}/> )
  const s = node.style || {}, style = { gap: s.gap, padding: s.padding, borderRadius: s.radius, ...(node.type === 'grid' ? { gridTemplateColumns: `repeat(${s.columns || 2}, minmax(0, 1fr))` } : {}) }
  const value = node.bind?.startsWith('item.') ? item?.[node.bind.slice(5)] : data[node.bind]
  const content = node.bind ? String(value ?? '') : node.text
  const Tag = ({ heading: 'h3', text: 'p', badge: 'span', button: 'button' })[node.type] || 'div'
  return <Tag className={`gaui-node gaui-${node.type} gaui-${s.tone || 'plain'}`} style={style} {...(node.type === 'button' ? { type: 'button', onClick: () => invoke(node, item) } : {})}>{content}{node.children?.map((n, i) => <NodeTree key={i} node={n} data={data} item={item} invoke={invoke}/>)}</Tag>
}
export function ExternalView({ bundle, area, data, invoke }) {
  const view = bundle.views[area]
  return <section className="gaui-view" aria-label={bundle.manifest.name + ' ' + area} style={{ '--gaui-accent': bundle.config.accent || '#557766' }}><NodeTree node={view.before} data={data} invoke={invoke}/><NodeTree node={view.after} data={data} invoke={invoke}/></section>
}
export class ExternalBoundary extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.fail('External view failed; default restored') }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
export function coverage(bundle) { return { covered: bundle.manifest.surfaces, missing: AREAS.filter(s => !bundle.manifest.surfaces.includes(s)) } }
