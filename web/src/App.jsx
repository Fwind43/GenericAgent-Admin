import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { Activity, BarChart3, BrainCircuit, FileCode2, FolderCog, Globe2, KeyRound, Menu, MessageSquare, PanelLeftClose, Play, RefreshCw, Server, SlidersHorizontal, Sparkles, Target, Terminal } from 'lucide-react'
import './admin-mobile.css'
import { applyThemeToDocument, getInitialTheme, persistTheme } from './themes'
import { api } from './lib/api'
import { buildObservabilitySnapshot, observabilityRequest } from './lib/observability'
import { confirmDanger } from './lib/danger'
import { I18N, SETTINGS_TEXT, SETUP_TEXT } from './lib/i18n'
import { buildRoute, parseRoute } from './lib/routing'
import { SETTINGS_GROUPS } from './lib/settingsNav'
import { modelLabel } from './lib/format'
import { ErrorBoundary, RouteFallback, StatusNotice } from './components/feedback'
import SetupWizard from './components/SetupWizard.jsx'
import { useFiles } from './hooks/useFiles'
import { useGoals } from './hooks/useGoals'
import { useLogStream } from './hooks/useLogStream'
import { useModelsConfig } from './hooks/useModelsConfig'
import { useSchedule } from './hooks/useSchedule'
import { useServices } from './hooks/useServices'
import { useTitleModel } from './hooks/useTitleModel'
import { useVersionUpdates } from './hooks/useVersionUpdates'
// Page-level code splitting keeps the app shell small and loads each route on demand.
const OverviewPage = lazy(() => import('./pages/OverviewPage'))
const GeneralPage = lazy(() => import('./pages/GeneralPage'))
const ChatSettingsPage = lazy(() => import('./pages/ChatSettingsPage'))
const KeychainPage = lazy(() => import('./pages/KeychainPage'))
const GoalsPage = lazy(() => import('./pages/GoalsPage').then(m => ({ default: m.GoalsPage })))
const UsagePage = lazy(() => import('./pages/UsagePage').then(m => ({ default: m.UsagePage })))
const InstancesPage = lazy(() => import('./pages/InstancesPage'))
const Models = lazy(() => import('./pages/ModelsPage').then(m => ({ default: m.Models })))
const FilesPage = lazy(() => import('./pages/FilesPage').then(m => ({ default: m.FilesPage })))
const ChannelsPage = lazy(() => import('./pages/ChannelsPage').then(m => ({ default: m.ChannelsPage })))
const TasksPage = lazy(() => import('./pages/TasksPage').then(m => ({ default: m.TasksPage })))
const LogsPage = lazy(() => import('./pages/LogsPage').then(m => ({ default: m.LogsPage })))

gsap.registerPlugin(useGSAP)

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const NAV_ICONS = {
  overview: <Activity size={16}/>,
  settings: <SlidersHorizontal size={16}/>,
  chat: <Sparkles size={16}/>,
  models: <BrainCircuit size={16}/>,
  keychain: <KeyRound size={16}/>,
  instances: <Server size={16}/>,
  channels: <Globe2 size={16}/>,
  tasks: <Terminal size={16}/>,
  goals: <Target size={16}/>,
  files: <FileCode2 size={16}/>,
  usage: <BarChart3 size={16}/>,
  logs: <FolderCog size={16}/>,
}

export default function App() {
  const defaultLang = 'zh'
  const [lang, setLang] = useState(() => localStorage.getItem('ga-admin-lang-explicit') === '1' ? (localStorage.getItem('ga-admin-lang') || defaultLang) : defaultLang)
  const [theme, setTheme] = useState(getInitialTheme)
  const [adminSidebarOpen, setAdminSidebarOpen] = useState(false)
  const initialRoute = useMemo(() => parseRoute(), [])
  const [tab, setTab] = useState(initialRoute.tab)
  const [taskSection, setTaskSection] = useState(initialRoute.taskSubTab)
  const [cfg, setCfg] = useState(null)
  const [savedCfg, setSavedCfg] = useState(null)
  const [root, setRoot] = useState('')
  const [health, setHealth] = useState(null)
  const [busy, setBusy] = useState(false)
  const [booting, setBooting] = useState(true)
  const [notice, setNotice] = useState(null)
  const [observability, setObservability] = useState(null)
  const [observabilityError, setObservabilityError] = useState('')
  // The server binds an ephemeral port by default, so the real address comes
  // from the health endpoint instead of the configured host/port pair.
  const [listenAddress, setListenAddress] = useState('')
  const appScope = useRef(null)

  const t = I18N[lang] || I18N.en
  const text = SETTINGS_TEXT[lang] || SETTINGS_TEXT.en

  const setMsg = (message, kind) => {
    const value = String(message || '')
    const inferredKind = /(?:失败|错误|无效|error|failed|invalid)/i.test(value) ? 'error' : (/^(?:正在|加载|保存中|启动中)/.test(value) ? 'pending' : 'success')
    setNotice(value ? { message: value, kind: kind || inferredKind } : null)
  }

  const chooseLang = (nextLang) => {
    localStorage.setItem('ga-admin-lang-explicit', '1')
    localStorage.setItem('ga-admin-lang', nextLang)
    setNotice(null)
    setLang(nextLang)
    window.dispatchEvent(new CustomEvent('ga-admin-language-change', { detail: nextLang }))
  }

  useEffect(() => {
    const activeTheme = applyThemeToDocument(theme)
    persistTheme(activeTheme.id)
  }, [theme])
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en' }, [lang])
  useEffect(() => {
    const url = buildRoute(tab, taskSection)
    if (window.location.pathname !== url) window.history.replaceState(null, '', url)
  }, [tab, taskSection])

  const openTab = (next) => {
    setAdminSidebarOpen(false)
    setTab(next)
  }
  const services = useServices({ t, setMsg, setBusy })
  const logStream = useLogStream({ active: tab === 'logs' })
  const version = useVersionUpdates({ t, lang, setMsg, setBusy })
  const files = useFiles({ t, setMsg, setBusy, onOpen: () => setTab('files') })
  const schedule = useSchedule({ t, lang, setMsg, setBusy, onOpenSection: (section) => { setTab('tasks'); setTaskSection(section) } })
  const goals = useGoals({ t, lang, setMsg, setBusy, active: tab === 'goals' })
  const models = useModelsConfig({ t, lang, setMsg, setBusy, active: tab === 'models' })
  const titleModel = useTitleModel({ t, lang, setMsg, active: tab === 'chat', fallbackProfiles: models.persistedProfiles })

  const inventory = health?.inventory || {}
  const scheduleSummary = schedule.data || inventory.schedule || {}

  const readObservability = async () => {
    const request = (endpoint) => {
      const req = observabilityRequest(endpoint)
      return api(req.url, req.options)
    }
    const [apiHealth, inv, risks] = await Promise.all([
      request('/api/health'),
      request('/api/ga/inventory'),
      request('/api/risk/catalog'),
    ])
    setObservability(buildObservabilitySnapshot({ health: apiHealth, inventory: inv, risks }))
    setListenAddress(apiHealth?.listen?.address || '')
    setObservabilityError('')
  }

  const load = async () => {
    setBooting(true)
    setNotice({ kind: 'pending', message: t.overview.refreshing })
    try {
      const [c, h] = await Promise.all([
        api('/api/config'),
        api('/api/ga/health'),
        version.loadSnapshot(),
      ])
      setCfg(c); setSavedCfg(c); setRoot(c.ga_root || ''); setHealth(h)
      await readObservability().catch(e => { setObservability(null); setObservabilityError(e.message) })
      if (!h?.ok) {
        services.setServices([])
        return
      }
      await services.refresh()
      setNotice({ kind: 'success', message: t.overview.refreshed })
    } catch (e) {
      setNotice({ kind: 'error', message: t.overview.refreshFailed(e.message) })
    } finally { setBooting(false) }
  }
  useEffect(() => { load() }, [])

  // Route-scoped data: each page pulls what it needs the first time it opens.
  useEffect(() => {
    if (!health?.ok) return
    if (tab === 'tasks') {
      schedule.loadScheduleTasks({ quiet: true }).catch(() => {})
      goals.loadGoals().catch(() => {})
      if (!services.llms.length) services.loadLLMs()
    }
    if (tab === 'goals' && !services.llms.length) services.loadLLMs()
    if (tab === 'files' && !files.list.length) files.loadFiles(files.path).catch(e => setMsg(e.message))
  }, [tab, health?.ok])

  useGSAP(() => {
    if (prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(appScope)
      let tl
      const targets = '.stats .stat, .panel, .workspace, .log-workbench, .goals-page, .set-card'
      const play = () => {
        tl = gsap.timeline({ defaults: { ease: 'power2.out', duration: 0.28 } })
        tl.from(q('.main > header'), { y: 8, autoAlpha: 0, clearProps: 'transform,opacity,visibility' })
          .from(q(targets), { y: 10, autoAlpha: 0, stagger: 0.025, clearProps: 'transform,opacity,visibility' }, '-=0.12')
      }
      const raf = window.requestAnimationFrame(play)
      const guard = window.setTimeout(() => {
        gsap.set(q(`.main > header, ${targets}`), { autoAlpha: 1, clearProps: 'transform,opacity,visibility' })
      }, 900)
      return () => { window.cancelAnimationFrame(raf); window.clearTimeout(guard); tl?.kill() }
    }, appScope)
    return () => ctx.revert()
  }, { scope: appScope, dependencies: [tab, lang] })

  const saveConfig = async () => {
    if (!await confirmDanger('config-save', lang === 'zh' ? '保存 GA Admin 配置？会写入配置文件并可能切换 GA 根目录。' : 'Save the GA Admin configuration? This writes the configuration file and may switch the GA root.')) return
    setBusy(true)
    try {
      const c = await api('/api/config', { dangerous:true, method: 'PUT', body: JSON.stringify({ ...cfg, ga_root: root }) })
      setCfg(c); setSavedCfg(c)
      setMsg(t.hints.rootSaved)
      await load()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const saveGitHubMirror = async (value) => {
    const c = await api('/api/config', {
      dangerous: true,
      method: 'PUT',
      body: JSON.stringify({ ...(savedCfg || cfg || {}), github_mirror: value }),
    })
    setSavedCfg(c)
    setCfg(current => ({ ...(current || {}), github_mirror: c.github_mirror || '' }))
    return c.github_mirror || ''
  }

  const viewServiceLogs = (name) => { setTab('logs'); logStream.select(name) }
  const startService = (name) => services.serviceAction(name, 'start')
  const stopService = (name) => services.serviceAction(name, 'stop')
  const openModels = (instance = null) => { models.openFor(instance); openTab('models') }
  const openGoal = (id) => { if (id) goals.setSelected(id); setTab('goals') }

  if (health && !health.ok) {
    // /api/setup/complete answers with {root, config}, so the root comes from the
    // saved snapshot rather than the top level of the response.
    return <SetupWizard initialRoot={root} lang={lang} text={SETUP_TEXT[lang]} onComplete={(result) => {
      const nextRoot = result?.config?.ga_root || result?.root
      if (nextRoot) setRoot(nextRoot)
      load()
    }} />
  }

  // The listen address and health belong to the whole console, not to a route,
  // so they sit in the shell chrome. Both copies are rendered but the layout
  // only ever shows one: the mobile bar is hidden on desktop, and the sidebar
  // is hidden while the drawer is closed.
  const serviceStatus = <div className="admin-service-status" aria-label={lang === 'zh' ? '服务状态' : 'Service status'}>
    <span className="admin-service-endpoint"><Server size={13} aria-hidden="true"/><span>{listenAddress || (lang === 'zh' ? '本机' : 'local')}</span></span>
    <span role="status" aria-live="polite" className={`admin-service-health ${health?.ok ? 'is-ready' : 'is-error'}`}><span className="admin-service-health-dot" aria-hidden="true"/>{health?.ok ? t.ready : t.error}</span>
  </div>

  return <>
    {services.pickerOpen && <div className="modal-overlay" onClick={services.closePicker}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3>{t.service.chooseReflectModel}</h3><button className="modal-close" aria-label={t.close} onClick={services.closePicker}>✕</button></div>
        <p className="muted">{t.service.aboutToStart(services.pendingServiceName)}</p>
        <select value={services.reflectLLMNo} onChange={e => services.setReflectLLMNo(e.target.value)}>
          {services.llms.length ? services.llms.map(m => <option key={m.index} value={m.index}>{modelLabel(m)}</option>) : <option value="0">{t.service.noModelsDefault}</option>}
        </select>
        <div className="modal-actions">
          <button onClick={services.confirmReflectStart}><Play size={14}/>{t.start}</button>
          <button onClick={services.closePicker}>{t.cancel}</button>
        </div>
      </div>
    </div>}
    <div ref={appScope} className={`app app-tab-${tab} ${adminSidebarOpen ? 'admin-sidebar-open' : ''}`}>
      <button type="button" className="admin-sidebar-scrim" aria-label={lang === 'zh' ? '关闭管理导航' : 'Close admin navigation'} onClick={()=>setAdminSidebarOpen(false)} />
      <aside id="admin-sidebar" className="sidebar">
        <div className="admin-sidebar-heading">
          <div className="brand"><img className="brand-logo" src="/icon.png" alt=""/><div><h1>{t.appName}</h1><p>{t.tagline}</p></div></div>
          <button type="button" className="admin-sidebar-close" aria-label={lang === 'zh' ? '收起管理导航' : 'Collapse admin navigation'} onClick={()=>setAdminSidebarOpen(false)}><PanelLeftClose size={20} aria-hidden="true"/></button>
        </div>
        <button type="button" className="admin-back-to-chat" onClick={()=>{ window.location.href = '/' }}><MessageSquare size={15} aria-hidden="true"/>{lang === 'zh' ? '返回对话' : 'Back to chat'}</button>
        <nav aria-label={t.mainNavigation}>
          {SETTINGS_GROUPS.map(group => <div className="set-nav-group" key={group.id}>
            <span className="set-nav-group-title">{t.navGroups[group.id]}</span>
            {group.items.map(item => <button
              key={item}
              type="button"
              aria-current={tab===item ? 'page' : undefined}
              className={tab===item ? 'active' : ''}
              onClick={()=>{ if (item === 'models') openModels(); else openTab(item) }}
            >{NAV_ICONS[item]}{t.nav[item]}</button>)}
          </div>)}
        </nav>
        <button type="button" className="refresh" onClick={load} disabled={booting}><RefreshCw size={15} aria-hidden="true"/>{booting ? t.busy : t.refresh}</button>
        <StatusNotice kind={notice?.kind} message={notice?.message} retryLabel={t.retry} dismissLabel={t.close} onRetry={notice?.kind === 'error' ? load : undefined} onDismiss={notice?.kind === 'success' ? ()=>setNotice(null) : undefined}/>
        {serviceStatus}
      </aside>
      <main className="main">
        <div className="admin-mobile-bar">
          <button type="button" className="admin-sidebar-toggle" aria-label={lang === 'zh' ? '展开管理导航' : 'Open admin navigation'} aria-expanded={adminSidebarOpen} aria-controls="admin-sidebar" onClick={()=>setAdminSidebarOpen(true)}><Menu size={21} aria-hidden="true"/></button>
          <span>{t.appName}</span>
          {serviceStatus}
        </div>
        <header className="admin-page-header">
          <h2>{t.nav[tab]}</h2>
          <p>{t.desc[tab]}</p>
        </header>
        <ErrorBoundary resetKey={tab}>
          <Suspense fallback={<RouteFallback label={t.loading} />}>
            {tab==='overview' && <OverviewPage
              t={t}
              text={text}
              services={services.services}
              schedule={scheduleSummary}
              observability={observability}
              observabilityError={observabilityError}
              onRefreshObservability={() => readObservability().catch(error => { setObservability(null); setObservabilityError(error.message) })}
              version={version}
              root={root}
              githubMirror={savedCfg?.github_mirror || ''}
              onSaveGitHubMirror={saveGitHubMirror}
            />}
            {tab==='settings' && <GeneralPage
              t={t}
              lang={lang}
              text={text}
              cfg={cfg}
              setCfg={setCfg}
              root={root}
              setRoot={setRoot}
              savedCfg={savedCfg}
              onSave={saveConfig}
              busy={busy}
              theme={theme}
              setTheme={setTheme}
              onLanguage={chooseLang}
              autostart={version.autostart}
              onToggleAutostart={version.toggleAutostart}
            />}
            {tab==='chat' && <ChatSettingsPage t={t} text={text} titleModel={titleModel}/>}
            {tab==='keychain' && <KeychainPage text={text}/>}
            {tab==='models' && <Models officialSlots={models.officialSlots} t={t} profiles={models.profiles} setProfiles={models.setProfiles} patchProfile={models.patchProfile} addModelProfiles={models.addProfiles} removeModelProfile={models.removeProfile} importModels={models.importModels} previewModels={models.previewModels} failoverGroups={models.failoverGroups} setFailoverGroups={models.setFailoverGroups} discoverModels={models.discoverModels} modelPreview={models.preview} changes={models.changes} saveState={models.saveState} saveAll={models.saveAll} discardDraft={models.discardDraft} importLoading={models.importLoading} riskCatalog={observability?.riskItems || []} riskCatalogError={observabilityError} revealedKeys={models.revealedKeys} revealBusy={models.keyBusy} getProfileKey={models.getProfileKey} onRevealKey={models.revealKey} onClearRevealedKey={models.clearRevealedKey} modelInstance={models.instance} modelInstanceLabel={lang === 'zh' ? '当前实例' : 'Current instance'}/>}
            {tab==='instances' && <InstancesPage lang={lang} onConfigureModels={openModels}/>}
            {tab==='channels' && <ChannelsPage frontendSvcs={services.frontendSvcs} t={t} actionStates={services.actionStates} onStart={startService} onStop={stopService} onLogs={viewServiceLogs} onAutostart={services.toggleAutostart} onReflectStart={services.startReflectService} onOpenHub={()=>window.open('http://127.0.0.1:19737', '_blank', 'noopener,noreferrer')}/>}
            {tab==='tasks' && <TasksPage
              t={t}
              lang={lang}
              section={taskSection}
              onSection={setTaskSection}
              schedule={scheduleSummary}
              scheduleState={schedule}
              taskSvcs={services.taskSvcs}
              reflectSvcs={services.reflectSvcs}
              llms={services.llms}
              actionStates={services.actionStates}
              onStart={startService}
              onStop={stopService}
              onLogs={viewServiceLogs}
              onAutostart={services.toggleAutostart}
              onServiceModel={services.setServiceModel}
              onReflectStart={services.startReflectService}
              goals={goals.goals}
              onRefreshGoals={goals.loadGoals}
              onOpenGoal={openGoal}
              autonomousReports={inventory.autonomous_reports || []}
              busy={busy}
            />}
            {tab==='goals' && <GoalsPage t={t} goals={goals.goals} objective={goals.objective} setObjective={goals.setObjective} budget={goals.budget} setBudget={goals.setBudget} maxTurns={goals.maxTurns} setMaxTurns={goals.setMaxTurns} llmNo={goals.llmNo} setLLMNo={goals.setLLMNo} llms={services.llms} hive={goals.hive} setHive={goals.setHive} outputBytes={goals.outputBytes} setOutputBytes={goals.setOutputBytes} autoRefresh={goals.autoRefresh} setAutoRefresh={goals.setAutoRefresh} selected={goals.selected} output={goals.output} outputMeta={goals.outputMeta} busy={busy} onStart={goals.start} onStop={goals.stop} onDelete={goals.remove} onRefresh={goals.loadGoals} onOutput={goals.loadOutput} onClearOutput={goals.clearOutput} setMsg={setMsg}/>}
            {tab==='files' && <FilesPage t={t} filePath={files.path} setFilePath={files.setPath} fileList={files.list} fileContent={files.content} loadedFileContent={files.loadedContent} loadedFilePath={files.loadedPath} setFileContent={files.setContent} fileSearch={files.search} setFileSearch={files.setSearch} searchHits={files.searchHits} tailLines={files.tailLines} setTailLines={files.setTailLines} loadFiles={files.loadFiles} readFile={files.readFile} tailFile={files.tailFile} saveFile={files.saveFile} discardChanges={files.discardChanges} deleteFile={files.deleteFile} downloadFile={files.downloadFile} runSearch={files.runSearch} fileStatus={files.status} dismissFileStatus={files.dismissStatus} busy={busy}/>}
            {tab==='usage' && <UsagePage lang={lang}/>}
            {tab==='logs' && <LogsPage t={t} services={services.services} stream={logStream} onStart={startService} onStop={stopService}/>}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  </>
}
