import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './MessageNavigator.css'

export function messageNavigationNodes(messages, attachmentLabel, emptyLabel) {
  return messages.filter(m => m.role === 'user' && m.kind !== 'btw' && m.id != null).map(m => {
    const content = String(m.content || '').replace(/\s+/g, ' ').trim()
    const attachments = Array.isArray(m.files) ? m.files : []
    const files = attachments.map(a => a.name || '').filter(Boolean).join(', ')
    return { id: String(m.id), label: (content || files || (attachments.length ? attachmentLabel : emptyLabel)).slice(0, 180) }
  })
}

// Independent scroll state: a streamed answer must not rerender the full chat
// simply because the reading position or a hovered marker changes.
export default function MessageNavigator({ messages, sessionID, threadRef, onNavigate, loading, hasMore, loadingOlder, onLoadOlder, ct }) {
  const nodes = useMemo(() => messageNavigationNodes(messages, ct('\u9644\u4ef6\u6d88\u606f', 'Attachment'), ct('\u7a7a\u6d88\u606f', 'Empty message')), [messages, ct])
  const signature = JSON.stringify(messages.filter(m => m.kind !== 'btw').map(m => String(m.id)))
  const nodeSignature = JSON.stringify(nodes.map(n => n.id))
  const trackRef = useRef(null)
  const positionRef = useRef(null)
  const olderRequestRef = useRef(null)
  const listID = useId()
  const navRef = useRef(null)
  const suppressTouchClick = useRef(false)
  const [activeID, setActiveID] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [layout, setLayout] = useState({ right: 12, top: 0, height: 0 })

  useEffect(() => {
    const thread = threadRef.current
    if (!thread || loading) return
    let frame = 0
    const ids = new Set(JSON.parse(nodeSignature))
    const cards = [...thread.querySelectorAll('.oa-message')]
    const userCards = cards.filter(card => ids.has(card.dataset.id))
    const measure = () => {
      frame = 0
      const bounds = thread.getBoundingClientRect()
      const parent = thread.parentElement.getBoundingClientRect()
      const composer = parseFloat(getComputedStyle(thread).getPropertyValue('--oa-composer-h')) || 0
      const height = Math.max(0, thread.clientHeight - composer - 32)
      const next = { right: Math.max(8, parent.right - bounds.right + 12), top: bounds.top - parent.top + 16, height }
      setLayout(old => old.right === next.right && old.top === next.top && old.height === next.height ? old : next)
      let current = userCards[0]?.dataset.id || ''
      const anchor = bounds.top + Math.min(100, thread.clientHeight * 0.2)
      for (const card of userCards) {
        if (card.getBoundingClientRect().top > anchor) break
        current = card.dataset.id
      }
      if (thread.scrollHeight > thread.clientHeight && thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 4) current = userCards.at(-1)?.dataset.id || current
      setActiveID(current)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    observer?.observe(thread)
    observer?.observe(thread.parentElement)
    // Answer/code/image expansion can move later turns without resizing the thread.
    cards.forEach(card => observer?.observe(card))
    thread.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      thread.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [threadRef, sessionID, loading, signature, nodeSignature])

  useEffect(() => {
    setExpanded(false)
    suppressTouchClick.current = false
  }, [sessionID, loading])

  useEffect(() => {
    if (!expanded) return
    const dismiss = event => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !navRef.current?.contains(event.target)) setExpanded(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismiss)
    }
  }, [expanded])

  useLayoutEffect(() => {
    const track = trackRef.current
    const previous = positionRef.current
    if (!track) { positionRef.current = null; return }
    const first = track.querySelector('[data-message-node]')
    // Preserve the old first node's viewport position when history is prepended.
    if (previous?.sessionID === sessionID && previous.firstID !== first?.dataset.messageNode) {
      const anchor = [...track.querySelectorAll('[data-message-node]')].find(item => item.dataset.messageNode === previous.firstID)
      if (anchor) track.scrollTop = previous.top + anchor.offsetTop - previous.offset
    }
    positionRef.current = { sessionID, firstID: first?.dataset.messageNode, offset: first?.offsetTop || 0, top: track.scrollTop, height: track.scrollHeight }
  }, [nodeSignature, sessionID, loading, hasMore, expanded])

  useEffect(() => {
    const track = trackRef.current
    if (!track || expanded || track.contains(document.activeElement)) return
    const item = [...track.querySelectorAll('[data-message-node]')].find(el => el.dataset.messageNode === activeID)
    if (!item) return
    // Never scrollIntoView here: it also scrolls the ancestor conversation.
    if (item.offsetTop < track.scrollTop) track.scrollTop = item.offsetTop
    else if (item.offsetTop + item.offsetHeight > track.scrollTop + track.clientHeight) track.scrollTop = item.offsetTop + item.offsetHeight - track.clientHeight
  }, [activeID, layout.height, expanded])

  if (loading || !nodes.length) return null
  const loadOlder = async () => {
    if (!hasMore || loadingOlder || !onLoadOlder || olderRequestRef.current?.sessionID === sessionID) return
    const request = { sessionID }
    olderRequestRef.current = request
    try { await onLoadOlder() }
    finally { if (olderRequestRef.current === request) olderRequestRef.current = null }
  }
  const scroll = event => {
    const track = event.currentTarget
    const previous = positionRef.current
    const top = Math.max(0, track.scrollTop)
    if (previous) positionRef.current = { ...previous, top, height: track.scrollHeight }
    if (expanded && previous?.sessionID === sessionID && top < previous.top && top <= 8 && track.scrollHeight === previous.height) loadOlder()
  }
  const keyboard = event => {
    const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const buttons = [...trackRef.current.querySelectorAll('button')].filter(b => !b.disabled)
    const index = buttons.indexOf(event.target)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))
    const target = buttons[next]
    target?.focus({ preventScroll: true })
    if (target) trackRef.current.scrollTop = Math.max(0, target.offsetTop - trackRef.current.clientHeight / 2)
  }
  const select = action => {
    if (suppressTouchClick.current) { suppressTouchClick.current = false; return }
    if (!expanded) { setExpanded(true); return }
    action?.()
  }
  return <nav className="oa-message-nav" ref={navRef} data-expanded={expanded}
    aria-label={ct('\u6d88\u606f\u8282\u70b9', 'Message navigation')}
    style={{ right: layout.right, top: layout.top, height: layout.height }}
    onPointerEnter={event => { if (event.pointerType !== 'touch') setExpanded(true) }}
    onPointerLeave={event => { if (event.pointerType !== 'touch') setExpanded(false) }}
    onPointerDown={event => {
      suppressTouchClick.current = event.pointerType === 'touch' && !expanded
      if (suppressTouchClick.current) { event.preventDefault(); setExpanded(true) }
    }}
    onFocus={() => setExpanded(true)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false) }}>
    <ul className="oa-message-nav-track" ref={trackRef} id={listID} aria-label={ct('\u6d88\u606f\u5217\u8868', 'Message list')}
      onScroll={scroll}
      onWheel={event => { if (expanded && event.deltaY < 0 && event.currentTarget.scrollTop <= 8) loadOlder() }}
      onKeyDown={event => { suppressTouchClick.current = false; keyboard(event) }}>
      {hasMore && <li><button type="button" className="oa-message-nav-older" disabled={loadingOlder} onClick={() => select(loadOlder)}
        title={ct('\u52a0\u8f7d\u66f4\u65e9\u7684\u6d88\u606f\u8282\u70b9', 'Load earlier message nodes')} aria-label={ct('\u52a0\u8f7d\u66f4\u65e9\u7684\u6d88\u606f\u8282\u70b9', 'Load earlier message nodes')}>
        <span className="oa-message-nav-label" aria-hidden="true">{ct('\u52a0\u8f7d\u66f4\u65e9\u6d88\u606f', 'Load earlier messages')}</span><span className="oa-message-nav-mark" aria-hidden="true">{'\u22ef'}</span>
      </button></li>}
      {nodes.map((node, index) => <li key={node.id}><button type="button" className="oa-message-nav-node" data-message-node={node.id}
        aria-label={`${index + 1}. ${node.label}`} aria-current={node.id === activeID ? 'location' : undefined}
        aria-expanded={expanded} aria-controls={listID}
        tabIndex={node.id === (activeID || nodes[0].id) ? 0 : -1}
        onClick={() => select(() => onNavigate(node.id))}>
        <span className="oa-message-nav-label" aria-hidden="true">{node.label}</span><span className="oa-message-nav-mark" aria-hidden="true"><span /></span>
      </button></li>)}
    </ul>
  </nav>
}
