import { useEffect, useState } from 'react'
import { chatReadEvent, chatReadKey, createReadDwell, isChatResultUnread, isChatResultVisible, markChatResultRead } from './chatReadState.js'

export function useChatReadState({ instance, sid, snapshot, messages, sessions, running, loading, threadRef }) {
  const [readKeys, setReadKeys] = useState(() => new Set())
  const [, refresh] = useState(0)
  const storage = (() => { try { return window.localStorage } catch { return null } })()
  useEffect(() => {
    const sync = () => refresh(value => value + 1)
    window.addEventListener('storage', sync)
    window.addEventListener(chatReadEvent, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(chatReadEvent, sync)
    }
  }, [])
  const unread = session => !readKeys.has(chatReadKey(instance, session?.id, session?.result)) && isChatResultUnread(session, instance, storage)
  const markSessionRead = sessionId => {
    const session = sessions.find(item => item.id === sessionId)
    if (!unread(session)) return
    const selectedKey = chatReadKey(instance, session.id, session.result)
    markChatResultRead(instance, session.id, session.result, storage, window)
    setReadKeys(previous => previous.has(selectedKey) ? previous : new Set(previous).add(selectedKey))
  }
  const result = snapshot?.id === sid ? snapshot.result : null
  const summary = sessions.find(session => session.id === sid)
  const message = messages.find(item => item.id === result?.id)
  const eligible = !loading && !running && !summary?.running && result?.revision && message?.content_revision === result.revision &&
    (!summary || (summary.result?.id === result.id && summary.result?.revision === result.revision))
  const key = chatReadKey(instance, sid, result)
  const currentUnread = unread({ id: sid, result, running })
  useEffect(() => {
    if (!eligible || !currentUnread) return undefined
    const tick = createReadDwell(() => {
      setReadKeys(previous => new Set([...previous, key]))
      markChatResultRead(instance, sid, result, storage, window)
    })
    const check = () => tick(isChatResultVisible(threadRef.current, result), performance.now())
    const reset = () => tick(false, performance.now())
    const timer = window.setInterval(check, 100)
    const thread = threadRef.current
    thread?.addEventListener('scroll', check, { passive: true })
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', reset)
    check()
    return () => {
      window.clearInterval(timer)
      thread?.removeEventListener('scroll', check)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', reset)
    }
  }, [eligible, currentUnread, key, instance, sid, result, storage, threadRef])
  return { unread, currentUnread, markSessionRead }
}
