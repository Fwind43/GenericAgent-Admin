// Both React commits and tail resizes request the same frame's bottom position.
export function createThreadFollowScheduler({ getThread, isFollowing, onScroll, schedule, cancel }) {
  let frame = null
  let target = null
  let behavior = 'auto'
  const reset = () => {
    if (frame !== null) cancel(frame)
    frame = null
    target = null
    behavior = 'auto'
  }
  return {
    request(nextBehavior = 'auto') {
      const thread = getThread()
      if (!thread || !isFollowing()) return
      if (target && target !== thread) reset()
      target = thread
      if (nextBehavior === 'smooth') behavior = 'smooth'
      if (frame !== null) return
      frame = schedule(() => {
        const expected = target
        const mode = behavior
        frame = null
        target = null
        behavior = 'auto'
        // A wheel gesture or a session switch can happen after the request.
        if (!expected || expected !== getThread() || !isFollowing()) return
        if (expected.scrollHeight - expected.clientHeight - expected.scrollTop <= 1) return
        expected.scrollTo({ top: expected.scrollHeight, behavior: mode })
        onScroll(expected, mode)
      })
    },
    cancel: reset,
  }
}
