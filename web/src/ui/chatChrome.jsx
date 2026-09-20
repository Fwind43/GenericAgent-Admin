import React from 'react'
import { UiSurface, useUiPackage } from './UiHost'
import './chatChrome.css'

// Packages receive snapshots and callbacks, never the controller or its children.
function ChatChrome({ session, presentation, actions, studio = false }) {
  const en = presentation.lang === 'en'
  return <div className={`ui-chat-chrome ${studio ? 'ui-chat-studio' : ''}`} aria-label={studio ? 'Studio chat' : 'Default chat'}>
    <div className="ui-chat-heading"><small>{studio ? 'STUDIO / CONVERSATION' : 'CHAT'}</small><strong>{session.title}</strong><span role="status">{session.busy ? (en ? 'Working' : '处理中') : (en ? 'Ready' : '就绪')}</span></div>
    <div role="toolbar" aria-label="Package chat tools">
      <button type="button" onClick={actions.newSession} disabled={session.busy}>{en ? 'New conversation' : '新对话'}</button>
      <button type="button" onClick={actions.toggleContext} disabled={!session.id}>{en ? 'Context' : '上下文'}</button>
      <button type="button" onClick={actions.toggleTimeline} disabled={!session.id}>{en ? 'Timeline' : '世界线'}</button>
      <button type="button" onClick={actions.openSettings}>{en ? 'Settings' : '设置'}</button>
    </div>
  </div>
}
export function DefaultChatChrome(props) { return <ChatChrome {...props}/> }
export function StudioChatChrome(props) { return <ChatChrome {...props} studio/> }

export function ChatPackageBar(props) {
  const ui = useUiPackage()
  if (!ui) return null // Direct legacy/test entry points remain usable.
  return <section className="ui-chat-package" aria-label="Chat interface package">
    {/* Always host-owned: package crashes cannot remove recovery controls. */}
    <div className="ui-chat-switcher">
      <span>Interface / 界面包</span>
      <button type="button" disabled={ui.safe || ui.loading || ui.id === 'studio'} onClick={() => ui.select('studio')}>Enable Studio chat / 启用</button>
      <button type="button" disabled={ui.id === 'default' && !ui.loading} onClick={() => ui.restore()}>Restore default chat / 恢复默认</button>
      <a href="/admin/overview?ui=safe" target="_blank" rel="noreferrer">Safe mode / 安全入口</a>
      {ui.message && <span role="status">{ui.message}</span>}
    </div>
    <UiSurface name="chat.chrome" viewProps={props} fallback={<DefaultChatChrome {...props}/>}/>
  </section>
}
