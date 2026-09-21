import React, { Suspense, lazy, useMemo, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ConfigProvider from 'antd/es/config-provider'
import antdTheme from 'antd/es/theme'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import './fonts/misans.css'
import 'katex/dist/katex.min.css'
import './style.css'
import { RouteFallback, ErrorBoundary } from './components/feedback.jsx'
import { AppDialogHost } from './components/AppDialogHost.jsx'
import { GlobalImagePreview } from './components/GlobalImagePreview.jsx'
import './theme-tokens.css'
import { UiHost } from './ui/UiHost'
import { applyThemeToDocument, createAntdTheme, getInitialCustomColors, getInitialTheme, getTheme, hydrateCustomColors, isThemeId } from './themes'

// Chat is the primary interface: it owns "/" (and legacy "/chat").
// The admin console lives under "/admin" and acts as the settings area.
const uiMode = new URLSearchParams(window.location.search).get('ui')
const isolatedUiRoute = /^\/admin(?:\/|$)/.test(window.location.pathname) && ['preview', 'safe'].includes(uiMode)
const UiPreview = lazy(() => import('./ui/UiPreview.jsx'))
const UiRecovery = lazy(() => import('./ui/UiRecovery.jsx'))
const rootPath = window.location.pathname.replace(/\/+$/, '')
const isAdmin = rootPath === '/admin' || rootPath.startsWith('/admin/')
// Each route imports on its own line because the build pairs one dependency
// list, stylesheets included, with one dynamic import expression. Choosing
// between two imports inside a single expression left both sharing the chat
// list, so the admin bundle's stylesheet was never linked in a build.
const AdminRoot = lazy(() => import('./App.jsx'))
const ChatRoot = lazy(() => import('./ChatApp.jsx'))
function RoutedRoot() {
  const [admin, setAdmin] = useState(isAdmin)
  const [chatVisited, setChatVisited] = useState(!isAdmin)
  const chatURL = useRef(isAdmin ? '/chat' : window.location.pathname + window.location.search + window.location.hash)
  useEffect(() => {
    const onPopState = () => {
      const nextAdmin = /^\/admin(?:\/|$)/.test(window.location.pathname)
      if (!nextAdmin) setChatVisited(true)
      setAdmin(nextAdmin)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const openSettings = () => {
    chatURL.current = window.location.pathname + window.location.search + window.location.hash
    window.history.pushState(null, '', '/admin')
    setAdmin(true)
  }
  const backToChat = () => {
    window.history.pushState(null, '', chatURL.current)
    setChatVisited(true)
    setAdmin(false)
  }
  return <>
    {chatVisited && <div style={{ display: admin ? 'none' : 'contents' }}><ChatRoot onOpenSettings={openSettings}/></div>}
    {admin && <AdminRoot onClose={backToChat}/>}
  </>
}

const storedLanguage = () => localStorage.getItem('ga-admin-lang-explicit') === '1' && localStorage.getItem('ga-admin-lang') === 'en' ? 'en' : 'zh'

function LocalizedRoot() {
  const [lang, setLang] = useState(storedLanguage)
  const [colorMode, setColorMode] = useState(getInitialTheme)
  const [customColors, setCustomColors] = useState(getInitialCustomColors)
  useEffect(() => {
    const update = event => setCustomColors(event.detail || {})
    window.addEventListener('ga-admin-custom-colors-change', update)
    return () => window.removeEventListener('ga-admin-custom-colors-change', update)
  }, [])
  useEffect(() => {
    const onLanguageChange = event => setLang(event.detail === 'en' ? 'en' : 'zh')
    window.addEventListener('ga-admin-language-change', onLanguageChange)
    return () => window.removeEventListener('ga-admin-language-change', onLanguageChange)
  }, [])
  useEffect(() => {
    const onThemeChange = event => setColorMode(current => isThemeId(event.detail) ? event.detail : current)
    window.addEventListener('ga-admin-theme-change', onThemeChange)
    return () => window.removeEventListener('ga-admin-theme-change', onThemeChange)
  }, [])
  useEffect(() => {
    const activeTheme = applyThemeToDocument(colorMode)
    localStorage.setItem('ga-admin-theme', activeTheme.id)
  }, [colorMode])
  // Saved custom colors must be live on the very first paint; the injected
  // boot script covers the same-origin index.html case, this covers the rest.
  useEffect(() => {
    if (!isolatedUiRoute) void hydrateCustomColors()
  }, [])
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])
  const loading = lang === 'en' ? 'Loading interface…' : '正在加载界面…'
  const activeTheme = getTheme(colorMode)
  const componentTheme = useMemo(() => createAntdTheme(activeTheme, antdTheme, customColors), [activeTheme, customColors])
  return <ConfigProvider locale={lang === 'en' ? enUS : zhCN} theme={componentTheme}>
    <AppDialogHost />
    <GlobalImagePreview />
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback label={loading} />}>
        {isolatedUiRoute ? (uiMode === 'safe' ? <UiRecovery/> : <UiPreview/>) : <UiHost><RoutedRoot /></UiHost>}
      </Suspense>
    </ErrorBoundary>
  </ConfigProvider>
}

createRoot(document.getElementById('root')).render(
  <LocalizedRoot />
)
