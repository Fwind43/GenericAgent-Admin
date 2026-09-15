import { useEffect, useRef, useState } from 'react'
import { chatReadKey, createReadDwell, isChatResultVisible } from './chatReadState.js'

export function useChatReadState({ instance, sid, snapshot, messages, sessions, running, loading, threadRef, api, onError }) {
  const [readKeys, setReadKeys] = useState(() => new Set())
  const pending = useRef(new Set())
  const needsReceipt = session => !!session?.result?.revision && session.unread === true &&
    !readKeys.has(chatReadKey(instance, session.id, session.result))
  const unread = session => !session?.running && needsReceipt(session)
  const mark = async (candidates, includeRunning = false) => {
    const selected = candidates.filter(session => (includeRunning ? needsReceipt(session) : unread(session)) &&
      !pending.current.has(chatReadKey(instance, session.id, session.result)))
    if (!selected.length) return
    const keys = selected.map(session => chatReadKey(instance, session.id, session.result))
    keys.forEach(key => pending.current.add(key))
    try {
      const response = await api('/api/chat/read', { method: 'POST', body: JSON.stringify({ receipts: selected.map(session => ({ sid: session.id, result: session.result })) }) })
      const accepted = new Set(keys)
      setReadKeys(previous => {
        const next = new Set(previous)
        for (const receipt of response.receipts || []) {
          const key = chatReadKey(instance, receipt.sid, receipt.result)
          if (accepted.has(key)) next.add(key)
        }
        return next
      })
    } catch (error) {
      if (error?.name !== 'AbortError') onError?.(error.message)
    } finally {
      keys.forEach(key => pending.current.delete(key))
    }
  }
  const markRef = useRef(mark)
  useEffect(() => { markRef.current = mark })
  const summary = sessions.find(session => session.id === sid)
  const result = snapshot?.id === sid ? snapshot.result : null
  const message = messages.find(item => item.id === result?.id)
  const eligible = !loading && result?.revision && message?.content_revision === result.revision &&
    summary?.result?.id === result.id && summary?.result?.revision === result.revision &&
    summary?.result?.visible_revision === result.visible_revision
  const key = chatReadKey(instance, sid, result)
  const currentNeedsReceipt = needsReceipt(summary)
  const currentUnread = unread(summary)
  useEffect(() => {
    if (!eligible || !currentNeedsReceipt) return undefined
    const tick = createReadDwell(() => { void markRef.current([summary], true) })
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
  }, [eligible, currentNeedsReceipt, key, result, summary, threadRef])
  return {
    unread, currentUnread, hasUnread: sessions.some(unread),
    markSessionRead: sessionID => mark(sessions.filter(session => session.id === sessionID)),
    markAllRead: () => mark(sessions),
  }
}
