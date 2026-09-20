import { StudioModelEditorCommon } from './modelEditorCommon'
import { StudioModelCalls } from './modelCalls'
import { StudioModelProviders } from './modelProviders'
import { StudioTasks } from './tasks'
import { StudioUsage } from './usage'
import { StudioProjectModeSettings, StudioProcessDisplaySettings } from './chatRuntimeSettings'
import { StudioChatTitleSettings } from './chatTitleSettings'
import { StudioAppearanceSettings } from './appearanceSettings'
import { StudioRemoteSettings } from './remoteSettings'
import { StudioGeneralSettings } from './generalSettings.jsx'
import { StudioChatChrome } from './chatChrome'
import { ChatSidebar, ChatMessages, ChatComposer } from './chatBody'
import React from 'react'
import './studio.css'
const copy = (lang, zh, en) => lang === 'zh' ? zh : en
export function StudioShell({ navigation, presentation }) {
  const { lang } = presentation
  return <aside className="studio-sidebar" aria-label={copy(lang, 'Studio 工作台导航', 'Studio workspace navigation')}>
    <div className="studio-wordmark"><span aria-hidden="true">S.</span><div><strong>Studio</strong><small>ADMIN WORKSPACE</small></div></div>
    <button className="studio-chat" type="button" onClick={navigation.backToChat}>↗ {copy(lang,'返回对话','Back to chat')}</button>
    <nav>{navigation.groups.map(group => <section key={group.id}><h2>{group.label}</h2>{group.items.map(item => <button type="button" key={item.id} aria-current={navigation.current === item.id ? 'page' : undefined} onClick={() => navigation.go(item.id)}>{item.label}<span aria-hidden="true">{navigation.current === item.id ? '●' : '↗'}</span></button>)}</section>)}</nav>
    <p className="studio-scope">{copy(lang,'首批 · 管理外壳与概览','Phase 01 · Shell & overview')}<br/>{copy(lang,'聊天及其他页面沿用默认实现','Chat and other pages remain unchanged')}</p>
  </aside>
}
export function StudioOverview({ overview, actions, presentation }) {
  const {lang} = presentation
  const c = (zh,en) => copy(lang,zh,en)
  const running = overview.services.filter(s => s.running).length
  return <section className="studio-overview" aria-label="Studio overview">
    <div className="studio-kicker">{c('运行现场','OPERATIONS AT A GLANCE')}</div>
    <div className="studio-intro"><div><h2>{c('让重要的状态，一目了然。','A clear view of what matters.')}</h2><p>{c('服务、计划与检查项，在同一处安静地掌握。','Services, schedules and checks. One quiet place to stay oriented.')}</p></div><button type="button" onClick={actions.refreshOverview} disabled={actions.refreshing}>{actions.refreshing ? c('刷新中…','Refreshing…') : c('刷新状态 ↻','Refresh snapshot ↻')}</button></div>
    <dl className="studio-metrics"><div><dt>{c('运行服务','Running services')}</dt><dd>{running}<small>/ {overview.services.length}</small></dd></div><div><dt>{c('启用计划','Enabled schedules')}</dt><dd>{overview.schedule.enabled}<small>/ {overview.schedule.total}</small></dd></div><div><dt>{c('已到执行时间','Due now')}</dt><dd>{overview.schedule.due}</dd></div></dl>
    <div className="studio-columns"><section><div className="studio-section-title"><h3>{c('服务状态','Service status')}</h3><span>{c('宿主快照','HOST SNAPSHOT')}</span></div><ul className="studio-rows">{overview.services.map((s,i) => <li key={s.name+i}><span><i className={s.running ? 'is-running' : ''}/>{s.name}</span><small>{s.running ? c('运行中','Running') : c('已停止','Stopped')}</small></li>)}</ul>{!overview.services.length && <p>{c('尚无服务数据','No service data yet')}</p>}</section>
    <section><div className="studio-section-title"><h3>{c('需要留意','Attention')}</h3><span>{overview.health.toUpperCase()}</span></div><ul className="studio-rows">{overview.checks.map((item,i) => <li key={item.name+i}><span>{item.name}</span><small>{item.ok ? c('通过','OK') : c('待处理','Review')}</small></li>)}</ul>{!overview.checks.length && <p>{c('等待检查快照','Waiting for a check snapshot')}</p>}{overview.error && <p role="alert">{c('快照不可用，请重试。',overview.error)}</p>}<p className="studio-footnote">{c('仅查看状态，不启动或停止任务。','Read-only status. No tasks are started or stopped.')}<br/>{overview.updatedAt}</p></section></div>
  </section>
}
export const layouts = { 'chat.sidebar': 'studio', 'chat.messages': 'studio', 'chat.composer': 'studio' }
export const views = { 'admin.shell': StudioShell, 'admin.models.calls': StudioModelCalls, 'admin.models.editor.common': StudioModelEditorCommon, 'admin.models.providers': StudioModelProviders, 'admin.tasks': StudioTasks, 'admin.usage': StudioUsage, 'admin.overview': StudioOverview, 'admin.settings.chat.title': StudioChatTitleSettings, 'admin.settings.chat.project': StudioProjectModeSettings, 'admin.settings.chat.process': StudioProcessDisplaySettings, 'admin.settings.appearance': StudioAppearanceSettings, 'admin.settings.remote': StudioRemoteSettings, 'admin.settings.paths': StudioGeneralSettings, 'admin.settings.network': StudioGeneralSettings, 'admin.settings.startup': StudioGeneralSettings, 'chat.chrome': StudioChatChrome, 'chat.sidebar': ChatSidebar, 'chat.messages': ChatMessages, 'chat.composer': ChatComposer }
