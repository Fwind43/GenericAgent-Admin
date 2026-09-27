import React, { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageList, ComposerActions, ProviderModelCascade, PendingAttachments } from '../ChatApp'
import { ChatSidebar, ChatMessages, ChatComposer } from '../ui/chatBody'
import ProjectActionsMenu from '../components/ProjectActionsMenu'

const noop = () => {}
const no = () => false
const PREVIEW_DOCUMENT = '<!doctype html><html><head></head><body></body></html>'

// Render the production views, not ChatApp's session/network controller.
// The inert boundary also prevents portals and file pickers escaping this document.
function PreviewContent({ zh }) {
  const ct = (cn, en) => zh ? cn : en
  const threadRef = useRef(null)
  const promptRef = useRef(null)
  const fileRef = useRef(null)
  const activeSidRef = useRef('theme-preview')
  const title = ct('今天的工作计划', 'Today’s work plan')
  const messages = [
    { id: 'preview-user', role: 'user', content: ct('帮我梳理一下今天的工作。', 'Help me organize today’s work.') },
    { id: 'preview-assistant', role: 'assistant', model_id: 'Preview', content: ct(
      '当然。先从最重要的一件事开始。\n\n**明确目标**，留出专注时间。\n\n- 拆分步骤，逐项推进\n- 检查结果，记录进展\n\n`status: ready`',
      'Of course. Start with the most important thing.\n\n**Define your goal** and make time to focus.\n\n- Break it into steps\n- Check results and record progress\n\n`status: ready`') },
  ]
  return <div className="oa-chat" inert style={{ height: '100vh', minHeight: 0 }}>
    <ChatSidebar ct={ct} version="Preview" ProjectActionsMenu={ProjectActionsMenu}
      renderSidebarProject={noop} renderSidebarTree={noop} collapsed={false} sidebarSearch="" sidebarSections={{ conductors: [] }}
      sidebarPreferences={{ showProjects: true }} chatReadState={{ hasUnread: false, markAllRead: noop }}
      pinnedSessions={[]} pinnedProjectGroups={[]} regularProjectGroups={[]} projectSessionGroups={[]}
      recentSessions={[]} sessions={[]} chatInstances={[]} chatInstanceID=""
      historyExpanded projectsExpanded pinnedExpanded conductorsExpanded onOpenSettings={noop}/>
    <main className="oa-main">
      <header className="oa-topbar"><div className="oa-title"><b>{title}</b></div></header>
      <div className="oa-workspace">
        <ChatMessages ct={ct} MessageList={MessageList} messages={messages} sid="theme-preview"
          activeSidRef={activeSidRef} threadRef={threadRef} historyPages={{}} isConductorWorker={no}
          pauseFollow={noop} isNearBottom={() => true} updateFollowFromScroll={noop}/>
      </div>
      <footer className="oa-composer-wrap">
        <ChatComposer ct={ct} ComposerActions={ComposerActions} ProviderModelCascade={ProviderModelCascade}
          PendingAttachments={PendingAttachments} promptRef={promptRef} fileRef={fileRef}
          prompt={ct('从第一步开始', 'Start with the first step')} handlePromptChange={noop}
          attachments={[]} queuedMessages={[]} providerGroups={[]} REASONING_EFFORT_OPTIONS={[]}
          isConductorWorker={no} isConductorParent={no} send={noop}/>
      </footer>
    </main>
  </div>
}

export default function ThemeChatPreview({ preset, variables, zh }) {
  const ref = useRef(null)
  const [doc, setDoc] = useState(null)
  const ready = () => setDoc(ref.current?.contentDocument)
  useLayoutEffect(() => {
    if (!doc) return
    const syncStyles = () => {
      doc.head.replaceChildren(...Array.from(document.querySelectorAll('style,link[rel="stylesheet"]')).map(node => node.cloneNode(true)))
    }
    syncStyles()
    // Keep lazy-loaded production CSS and development HMR in sync too.
    const observer = new MutationObserver(syncStyles)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true })
    return () => observer.disconnect()
  }, [doc])
  useLayoutEffect(() => {
    if (!doc) return
    doc.documentElement.lang = zh ? 'zh' : 'en'
    doc.documentElement.dataset.theme = preset.id
    doc.documentElement.dataset.colorScheme = preset.colorScheme
    doc.documentElement.style.cssText = ''
    for (const [key, value] of Object.entries(variables)) doc.documentElement.style.setProperty(key, value)
    doc.body.style.margin = '0'
  }, [doc, preset, variables, zh])
  return <iframe ref={ref} onLoad={ready} title={zh ? '真实组件聊天预览' : 'Production chat preview'} className="studio-real-preview" srcDoc={PREVIEW_DOCUMENT}>
    {doc && createPortal(<PreviewContent zh={zh}/>, doc.body)}
  </iframe>
}
