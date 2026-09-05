export const shouldRefreshChatSnapshot = (previous = null, next = null) => {
  if (!previous || !next || previous.id !== next.id) return false
  if (Boolean(next.running)) return false
  return Number(previous.count || 0) !== Number(next.count || 0)
    || Number(previous.updated_at || 0) !== Number(next.updated_at || 0)
    || Boolean(previous.running) !== Boolean(next.running)
}

export const isBTWCommand = (value) => /^\/btw(?:$|[ \t])/.test(String(value || '').trim())

export const shouldFinishStreamFollow = ({ running, replay, completed, eventCount }) => (
  !running && replay && completed && eventCount === 0
)

// Only a reader moving away from the end means to stop following. The scroll
// offset alone cannot say that: a card collapsing above the viewport, or the
// thread being trimmed, drags the offset up with nobody touching anything, and
// the jump the app makes itself after each chunk arrives here too. So the
// decision also needs the content height, which only a reader leaves alone,
// and a note about who asked for the scroll.
export const scrollFollowAction = ({
  nearBottom,
  previousScrollTop,
  scrollTop,
  previousScrollHeight,
  scrollHeight,
  programmatic = false,
  epsilon = 1,
}) => {
  // A scroll the app performs says nothing about what the reader wants, and it
  // passes through the end of the thread on its way anywhere, so it must not
  // be allowed to answer either question.
  if (programmatic) return 'preserve'
  if (nearBottom) return 'resume'
  if (Number(scrollHeight) < Number(previousScrollHeight)) return 'preserve'
  if (Number(scrollTop) < Number(previousScrollTop) - epsilon) return 'pause'
  return 'preserve'
}

export const mergeStreamUserMessage = (messages = [], message = null, clientUserID = '', pendingAssistantID = '') => {
  const current = Array.isArray(messages) ? messages : []
  if (!message || typeof message !== 'object') return current
  const optimisticIndex = clientUserID ? current.findIndex(item => item?.id === clientUserID) : -1
  if (optimisticIndex >= 0) {
    return current.map((item, index) => index === optimisticIndex ? message : item)
  }
  if (message.id && current.some(item => item?.id === message.id)) return current
  const pendingIndex = pendingAssistantID
    ? current.findIndex(item => item?.id === pendingAssistantID && item?.role === 'assistant')
    : -1
  if (pendingIndex >= 0) {
    return [...current.slice(0, pendingIndex), message, ...current.slice(pendingIndex)]
  }
  return [...current, message]
}

export const mergeFinalStreamMessage = (streamed = {}, finalMessage = {}) => {
  const merged = { ...finalMessage }
  if ((!merged.model_id || !String(merged.model_id).trim()) && streamed.model_id) merged.model_id = streamed.model_id
  if (merged.usage == null && streamed.usage != null) merged.usage = streamed.usage
  if ((!Array.isArray(merged.usages) || merged.usages.length === 0) && Array.isArray(streamed.usages) && streamed.usages.length) {
    merged.usages = streamed.usages
  }
  if (!(Number(merged.elapsed_ms) > 0) && Number(streamed.elapsed_ms) > 0) merged.elapsed_ms = streamed.elapsed_ms
  if (!(Number(merged.llm_elapsed_ms) > 0) && Number(streamed.llm_elapsed_ms) > 0) merged.llm_elapsed_ms = streamed.llm_elapsed_ms
  if (!(Number(merged.tool_elapsed_ms) > 0) && Number(streamed.tool_elapsed_ms) > 0) merged.tool_elapsed_ms = streamed.tool_elapsed_ms
  if (!(Number(merged.first_token_ms) > 0) && Number(streamed.first_token_ms) > 0) merged.first_token_ms = streamed.first_token_ms
  if (!(Number(merged.run_started_at_ms) > 0) && Number(streamed.run_started_at_ms) > 0) merged.run_started_at_ms = streamed.run_started_at_ms
  if (!(Number(merged.ctx_chars) > 0) && Number(streamed.ctx_chars) > 0) merged.ctx_chars = streamed.ctx_chars
  if (!(Number(merged.ctx_msgs) > 0) && Number(streamed.ctx_msgs) > 0) merged.ctx_msgs = streamed.ctx_msgs
  // Preserve structured_content from finalMessage (done event)
  if (Array.isArray(finalMessage.structured_content) && finalMessage.structured_content.length > 0) {
    merged.structured_content = finalMessage.structured_content
  }
  return merged
}


export const mergeStreamTerminalMessage = (messages, pendingId, finalMessage, merge = mergeFinalStreamMessage) => {
  const list = Array.isArray(messages) ? messages : []
  const finalId = finalMessage?.id
  const existingIndex = finalId ? list.findIndex(m => m.id === finalId) : -1
  const pendingIndex = list.findIndex(m => m.id === pendingId)
  const targetIndex = existingIndex >= 0 ? existingIndex : pendingIndex
  if (targetIndex < 0) return list

  // History may already contain this reply when an older running snapshot triggers replay.
  // Keep its position and metadata, then remove only this run's redundant placeholders.
  const streamed = pendingIndex >= 0 ? list[pendingIndex] : list[targetIndex]
  const base = existingIndex >= 0 ? { ...streamed, ...list[existingIndex] } : streamed
  const merged = merge(base, finalMessage)
  return list.flatMap((message, index) => {
    if (index === targetIndex) return [merged]
    if (message.id === pendingId || (finalId && message.id === finalId)) return []
    return [message]
  })
}

// live=true (default): deltas animate frame-by-frame as before.
// live=false: deltas accumulate silently until beginLive() flushes the backlog
// in one shot (used for replayed events when reattaching after a page refresh,
// so the whole in-progress output appears instantly instead of retyping).
export const createStreamDeltaBatcher = ({ onFlush, schedule, cancel, live = true }) => {
  let pending = ''
  let scheduled = null
  let drainResolvers = []

  const resolveDrains = () => {
    if (pending || scheduled != null) return
    const resolvers = drainResolvers
    drainResolvers = []
    resolvers.forEach(resolve => resolve())
  }
  const scheduleNext = () => {
    if (pending && scheduled == null) {
      // Skip frame-by-frame animation when tab is in background
      if (typeof document !== 'undefined' && document.hidden) {
        flushNow()
      } else {
        scheduled = schedule(flushFrame)
      }
    }
  }
  const flushFrame = () => {
    scheduled = null
    if (!pending) return
    // If tab became hidden during scheduled flush, drain immediately instead of chunking
    if (typeof document !== 'undefined' && document.hidden) {
      flushNow()
      return
    }
    // Small model deltas stay immediate; network bursts are drained across a few
    // frames so the response advances continuously instead of jumping by blocks.
    const chunkSize = pending.length <= 24 ? pending.length : Math.min(64, Math.max(4, Math.ceil(pending.length / 8)))
    const chunk = pending.slice(0, chunkSize)
    pending = pending.slice(chunkSize)
    onFlush(chunk)
    scheduleNext()
    resolveDrains()
  }

  const flushNow = () => {
    if (scheduled != null) {
      cancel(scheduled)
      scheduled = null
    }
    if (!pending) return
    const chunk = pending
    pending = ''
    onFlush(chunk)
    resolveDrains()
  }

  return {
    push(delta) {
      if (!delta) return
      pending += delta
      if (live) scheduleNext()
    },
    beginLive() {
      if (live) return
      live = true
      flushNow()
    },
    flushNow,
    drain() {
      if (!live) flushNow()
      if (!pending && scheduled == null) return Promise.resolve()
      return new Promise(resolve => drainResolvers.push(resolve))
    },
  }
}

// When re-attaching to a running stream (page refresh), replayed deltas must land on the
// placeholder of *that* run. Only the tail message can be it: an empty assistant earlier in
// the history is a stale leftover from an aborted/refreshed run, and targeting one of those
// would append the replay mid-history while the tail stayed stuck on "thinking" forever.
export const pickResumePlaceholderId = (messages) => {
  const list = Array.isArray(messages) ? messages : []
  const tail = list.length ? list[list.length - 1] : null
  if (!tail || tail.role !== 'assistant') return ''
  if (tail.content) return ''
  return tail.id || ''
}

const LOOP_FOLLOW_STATUSES = new Set(['waiting', 'running', 'evaluating'])

export const isLoopFollowActive = (loop) => Boolean(
  loop?.enabled && LOOP_FOLLOW_STATUSES.has(String(loop?.status || '').toLowerCase())
)

export const normalizeStreamRunIdentity = ({ pendingId = '', startedAtMs = 0 } = {}) => ({
  pendingId: String(pendingId || '').trim(),
  startedAtMs: Number(startedAtMs) || 0,
})

export const sameStreamRun = (left, right) => {
  const a = normalizeStreamRunIdentity(left)
  const b = normalizeStreamRunIdentity(right)
  if (a.pendingId && b.pendingId) return a.pendingId === b.pendingId
  return a.startedAtMs > 0 && b.startedAtMs > 0 && a.startedAtMs === b.startedAtMs
}

// An explicitly admitted run (for example, a guided queued message) may already
// have an optimistic user bubble while the backend is still creating the run.
// Preserve that merge key only for the first run attached across that gap.
export const nextStreamClientUserID = ({ clientUserID = '', awaitingRun = false, currentRun = null } = {}) => {
  const current = normalizeStreamRunIdentity(currentRun || {})
  if (!awaitingRun || current.pendingId || current.startedAtMs > 0) return ''
  return String(clientUserID || '').trim()
}

// Decide what to do after a stream response ends. A terminal response remains readable from
// the replay endpoint until the next run starts, so it must never be attached as a new round.
export const decideStreamFollow = ({ running = false, loop = null, currentRun = null, availableRun = null, terminal = false, awaitingRun = false } = {}) => {
  const loopActive = isLoopFollowActive(loop)
  if (running) {
    if (!availableRun?.pendingId && !(Number(availableRun?.startedAtMs) > 0)) return 'wait'
    if (terminal && sameStreamRun(currentRun, availableRun)) return 'wait'
    return 'attach'
  }
  // Guide admission and run creation are separate backend steps. During that
  // short gap state is idle, but the caller explicitly knows a run is coming.
  if (awaitingRun && !currentRun?.pendingId && !(Number(currentRun?.startedAtMs) > 0)) return 'wait'
  return loopActive ? 'wait' : 'finish'
}
