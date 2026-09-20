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
  const ui = useExternalUi(), view = chatView(ui?.bundle, area)
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
export function NodeTree({ node, data = {}, item, invoke = () => {}, canInvoke = () => true }) {
  if (!node) return null
  if (node.type === 'each') return (data[node.source] || []).slice(0, 80).map((entry, i) => <NodeTree key={i} node={node.children[0]} data={data} item={entry} invoke={invoke} canInvoke={canInvoke}/> )
  const s = node.style || {}, style = { gap: s.gap, padding: s.padding, borderRadius: s.radius, ...(node.type === 'grid' ? { gridTemplateColumns: `repeat(${s.columns || 2}, minmax(0, 1fr))` } : {}) }
  const value = node.bind?.startsWith('item.') ? item?.[node.bind.slice(5)] : data[node.bind]
  const content = node.bind ? String(value ?? '') : node.text
  const Tag = ({ heading: 'h3', text: 'p', badge: 'span', button: 'button' })[node.type] || 'div'
  return <Tag className={`gaui-node gaui-${node.type} gaui-${s.tone || 'plain'}`} style={style} {...(node.type === 'button' ? { type: 'button', disabled: !canInvoke(node), onClick: () => invoke(node, item) } : {})}>{content}{node.children?.map((n, i) => <NodeTree key={i} node={n} data={data} item={item} invoke={invoke} canInvoke={canInvoke}/>)}</Tag>
}
export function ExternalView({ bundle, area, data, invoke, canInvoke = () => true }) {
  const view = bundle.views[area]
  return <section className="gaui-view" aria-label={bundle.manifest.name + ' ' + area} style={{ '--gaui-accent': bundle.config.accent || '#557766' }}><NodeTree node={view.content} data={data} invoke={invoke} canInvoke={canInvoke}/><NodeTree node={view.before} data={data} invoke={invoke} canInvoke={canInvoke}/><NodeTree node={view.after} data={data} invoke={invoke} canInvoke={canInvoke}/></section>
}
export class ExternalBoundary extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.fail('External view failed; default restored') }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
export function coverage(bundle) { return { covered: bundle.manifest.surfaces, missing: AREAS.filter(s => !bundle.manifest.surfaces.includes(s)) } }

// Validate each chat surface independently at the rendering boundary. Host siblings never remount.
function chatView(bundle, area) {
  if (!bundle?.views?.[area] || !bundle.manifest.surfaces.includes(area)) return null
  try {
    return validateBundle({ ...bundle, manifest: { ...bundle.manifest, surfaces: [area] }, views: { [area]: bundle.views[area] } }).views[area]
  } catch { return null }
}
export function canChatAction(area, node, state) {
  if (node.target !== undefined) return false
  const navigation = area === 'chat.sidebar' || area === 'chat.navigation'
  if (navigation && node.action === 'openSettings') return !state.blocked
  if (navigation && node.action === 'manageSessions') return !state.blocked && !state.managing
  if (area === 'chat.navigation' && ['newChat', 'collapseSidebar'].includes(node.action)) return !state.blocked
  if (['chat.messages', 'chat.followToolbar'].includes(area) && node.action === 'followLatest') return !!state.canFollow && !state.loading
  if (area === 'chat.composer' && node.action === 'openCommands') return !state.loading && !state.commandsOpen
  return false
}
export function dispatchChatAction(area, node, state, actions) {
  if (canChatAction(area, node, state)) actions[node.action]?.()
}
// Only the selected presentation slot is replaced. Business siblings stay in the host tree.
export function ChatReplacement({ area, state = {}, actions = {}, children }) {
  const ui = useExternalUi(), view = chatView(ui?.bundle, area)
  if (!view) return children
  const data = { title: area === 'chat.navigation' ? 'Conversations' : 'Conversation navigation', status: state.loading ? 'Loading' : state.running ? 'Running' : 'Ready', value: Number.isSafeInteger(state.count) ? state.count : 0 }
  return <ExternalBoundary key={ui.bundle.manifest.id + area} fallback={children} fail={() => {}}>
    <div className="gaui-external" data-chat-replacement={area}>
      <ExternalView bundle={ui.bundle} area={area} data={data} canInvoke={node => canChatAction(area, node, state)} invoke={node => dispatchChatAction(area, node, state, actions)}/>
    </div>
  </ExternalBoundary>
}
export function ChatDecoration({ area, position, state = {}, actions = {} }) {
  const ui = useExternalUi(), view = chatView(ui?.bundle, area)
  if (!view) return null
  // Explicit summary projection: no message/draft/attachment values, IDs, refs or controllers.
  const data = { title: area === 'chat.sidebar' ? 'Conversations' : area === 'chat.messages' ? 'Conversation' : 'Compose', status: state.loading ? 'Loading' : state.running ? 'Running' : 'Ready', value: Number.isSafeInteger(state.count) ? state.count : 0 }
  return <ExternalBoundary key={ui.bundle.manifest.id + position} fallback={null} fail={() => {}}>
    <div className="gaui-chat-region gaui-external" data-chat-decoration={position} data-host-order={view.layout.hostOrder} style={{ '--gaui-accent': ui.bundle.config.accent || '#3388cc' }}>
      <NodeTree node={view[position]} data={data} invoke={node => dispatchChatAction(area, node, state, actions)}/>
    </div>
  </ExternalBoundary>
}
