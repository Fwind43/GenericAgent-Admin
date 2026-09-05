import { useLayoutEffect, useRef, useState } from 'react'
import { createHistoryPageCache, prependHistoryPage, reconcileHistoryPage } from './chatHistoryPages.js'

export function useChatHistoryPages({ api, setMessages, messagesRef, threadRef, pauseFollow, onConflict }) {
  const cacheRef = useRef(null)
  if (!cacheRef.current) cacheRef.current = createHistoryPageCache()
  const currentRef = useRef(null)
  const generationRef = useRef(0)
  const requestsRef = useRef(new Set())
  const anchorRef = useRef(null)
  const [page, setPage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const olderRequestRef = useRef(null)

  const cancel = () => {
    generationRef.current++
    for (const controller of requestsRef.current) controller.abort()
    requestsRef.current.clear()
    olderRequestRef.current = null
    setLoading(false)
    setError('')
    anchorRef.current = null
  }
  const begin = () => {
    const current = currentRef.current
    if (current) cacheRef.current.put(current.key, { ...current.snapshot, messages: messagesRef.current })
    cancel()
    currentRef.current = null
    setPage(null)
  }
  const clear = () => {
    begin()
    cacheRef.current.clear()
  }
  const apply = (snapshot, key) => {
    const current = currentRef.current
    const previous = current?.key === key
      ? { ...current.snapshot, messages: messagesRef.current }
      : cacheRef.current.get(key)
    const merged = reconcileHistoryPage(snapshot, previous)
    cancel()
    currentRef.current = { key, snapshot: merged }
    setPage(merged)
    messagesRef.current = merged.messages || []
    setMessages(messagesRef.current)
    return merged
  }
  const guardedRequest = async (url, accept) => {
    const generation = generationRef.current
    const controller = new AbortController()
    requestsRef.current.add(controller)
    try {
      const result = await api(url, { signal: controller.signal })
      if (!controller.signal.aborted && generation === generationRef.current) accept(result)
    } catch (e) {
      if (controller.signal.aborted || generation !== generationRef.current || e.name === 'AbortError') return
      setError(e.message || String(e))
      if (/changed; refresh history/.test(e.message)) onConflict()
    } finally {
      requestsRef.current.delete(controller)
    }
  }
  const loadOlder = async () => {
    const current = currentRef.current
    if (!current?.snapshot.has_more || olderRequestRef.current) return
    const request = {}
    olderRequestRef.current = request
    setLoading(true)
    setError('')
    const { snapshot } = current
    await guardedRequest(`/api/chat/session/${encodeURIComponent(snapshot.id)}?view=page&before=${encodeURIComponent(snapshot.before)}`, earlier => {
      const thread = threadRef.current
      pauseFollow()
      if (thread) anchorRef.current = { thread, top: thread.scrollTop, height: thread.scrollHeight }
      const messages = prependHistoryPage(messagesRef.current, earlier)
      const next = { ...currentRef.current.snapshot, ...earlier, messages }
      currentRef.current = { ...currentRef.current, snapshot: next }
      setPage(next)
      messagesRef.current = messages
      setMessages(messages)
    })
    if (olderRequestRef.current === request) {
      olderRequestRef.current = null
      setLoading(false)
    }
  }
  const loadOlderNearTop = () => {
    const thread = threadRef.current
    if (thread && thread.scrollTop <= 240 && !error) return loadOlder()
  }
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    anchor.thread.scrollTop = anchor.top + anchor.thread.scrollHeight - anchor.height
    anchorRef.current = null
  }, [page])
  useLayoutEffect(() => () => {
    generationRef.current++
    for (const controller of requestsRef.current) controller.abort()
    cacheRef.current.clear()
  }, [])
  return { page, loading, error, begin, clear, apply, loadOlder, loadOlderNearTop }
}
