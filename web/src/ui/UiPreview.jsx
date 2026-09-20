import React, { useState } from 'react'
import { UiHost, UiSurface, useUiPackage } from './UiHost'
import { previewOverview } from './overview'
import { ADMIN_GROUPS } from '../lib/settingsNav'
import { I18N } from '../lib/i18n'
function Preview() {
  const ui = useUiPackage()
  const [tab, setTab] = useState('overview')
  const [refreshes, setRefreshes] = useState(0)
  const lang = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en'
  const presentation = { lang }
  const navigation = { current: tab, groups: ADMIN_GROUPS.map(g => ({id:g.id,label:g.label[lang],items:g.items.map(id=>({id,label:I18N[lang].nav[id]}))})), go: setTab, backToChat: () => setTab('chat') }
  return <><div className="ui-preview-banner"><strong>FICTIONAL PREVIEW / 虚构示例 · 不调用业务 API</strong><a href="/admin/overview">Cancel / 返回管理（不启用）</a><span>Enable separately on Overview / 请在真实概览单独启用</span>{ui.message && <span role="status">{ui.message}</span>}</div>
    <div className="app admin-workbench" data-ui-package={ui.id}>
      <UiSurface name="admin.shell" viewProps={{ navigation, presentation }} fallback={<aside>Default interface / 默认界面</aside>}/>
      <main className="main">{tab === 'overview' ? <UiSurface name="admin.overview" viewProps={{ overview: previewOverview, presentation, actions: {refreshOverview: () => setRefreshes(n=>n+1), refreshing:false} }}/>: <p>Default page not mounted in preview / 示例不加载实际页面: {tab}<button onClick={()=>setTab('overview')}>Overview / 概览</button></p>}<p role="status">Example refreshes / 示例刷新: {refreshes}</p></main>
    </div></>
}
export default function UiPreview() { return <UiHost preview><Preview/></UiHost> }
