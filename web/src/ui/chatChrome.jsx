import React from 'react'
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

// Appearance is managed exclusively in Settings > Appearance.
export function ChatPackageBar() { return null }
