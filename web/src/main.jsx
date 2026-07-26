import React, { Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import './style.css'
import { RouteFallback, ErrorBoundary } from './components/feedback.jsx'

const isChat = window.location.pathname.replace(/\/+$/, '') === '/chat'
const Root = lazy(() => (isChat ? import('./ChatApp.jsx') : import('./App.jsx')))

const storedLanguage = () => localStorage.getItem('ga-admin-lang-explicit') === '1' && localStorage.getItem('ga-admin-lang') === 'en' ? 'en' : 'zh'

function LocalizedRoot() {
  const [lang, setLang] = useState(storedLanguage)
  useEffect(() => {
    const onLanguageChange = event => setLang(event.detail === 'en' ? 'en' : 'zh')
    window.addEventListener('ga-admin-language-change', onLanguageChange)
    return () => window.removeEventListener('ga-admin-language-change', onLanguageChange)
  }, [])
  const loading = lang === 'en' ? 'Loading interface…' : '正在加载界面…'
  return <ConfigProvider locale={lang === 'en' ? enUS : zhCN} theme={{ token: { colorPrimary: '#10a37f', borderRadius: 10, fontFamily: 'Inter, system-ui, sans-serif' } }}>
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback label={loading} />}>
        <Root />
      </Suspense>
    </ErrorBoundary>
  </ConfigProvider>
}

createRoot(document.getElementById('root')).render(
  <LocalizedRoot />
)
