import React, { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// A script-free document: same production styles, no sessions, polling or writes.
export default function ThemeChatPreview({ preset, variables, zh }) {
 const ref = useRef(null)
 const [doc, setDoc] = useState(null)
 const ready = () => setDoc(ref.current?.contentDocument)
 useLayoutEffect(() => {
  if (!doc) return
  doc.head.replaceChildren(...Array.from(document.querySelectorAll('style,link[rel="stylesheet"]')).map(n => n.cloneNode(true)))
  doc.documentElement.dataset.theme = preset.id
  doc.documentElement.dataset.colorScheme = preset.colorScheme
  doc.documentElement.style.cssText = ''
  for (const [key,value] of Object.entries(variables)) doc.documentElement.style.setProperty(key,value)
  doc.body.style.margin = '0'
 }, [doc, preset, variables])
 return <iframe ref={ref} onLoad={ready} title={zh ? '真实样式聊天预览' : 'Production chat preview'} className="studio-real-preview" srcDoc="<!doctype html><html><head></head><body></body></html>">{doc && createPortal(
  <div className="oa-chat" style={{height:'620px',minHeight:0}}>
   <aside className="oa-sidebar"><div className="oa-side-head"><div className="oa-sidebar-brand"><span>GenericAgent Admin</span></div><button className="oa-new-chat" type="button">＋ {zh ? '新对话' : 'New chat'}</button></div><div className="oa-sidebar-sections"><section className="oa-sidebar-section"><div className="oa-sidebar-section-head">{zh ? '最近会话' : 'Recent chats'}</div><div className="oa-session-title">{zh ? '今天的工作计划' : 'Today’s work plan'}</div></section></div></aside>
   <main className="oa-main"><header className="oa-topbar"><div className="oa-title"><b>{zh ? '今天的工作计划' : 'Today’s work plan'}</b></div></header><div className="oa-workspace"><section className="oa-thread"><div className="oa-message-list"><div className="oa-message user"><div className="oa-bubble"><div className="oa-content">{zh ? '帮我梳理一下今天的工作。' : 'Help me organize today’s work.'}</div></div></div><div className="oa-message assistant"><div className="oa-bubble"><div className="oa-content"><div className="oa-md"><p>{zh ? '当然。先从最重要的一件事开始。' : 'Of course. Start with the most important thing.'}</p><p><strong>{zh ? '明确目标' : 'Define your goal'}</strong>{zh ? '，留出专注时间。' : ' and make time to focus.'}</p><ul><li>{zh ? '拆分步骤，逐项推进' : 'Break it into steps'}</li></ul></div></div></div></div></div></section></div><footer className="oa-composer-wrap"><div className="oa-composer"><textarea readOnly aria-label="Preview composer" placeholder={zh ? '有什么可以帮你？' : 'How can I help?'}/><div className="oa-composer-bar">＋</div></div></footer></main>
  </div>, doc.body)}</iframe>
}
