export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const isNarrowChatViewport = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches

export const isMobileViewport = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 560px)').matches

export const isMobileModelPickerViewport = () => Boolean(typeof window !== 'undefined' && window.matchMedia?.('(max-width: 680px)')?.matches)

// One distance decides every follow question: within this much of the end
// counts as reading the newest output. It clears the row these buttons sit in,
// which takes its own space at the end of the thread, so a reader parked at
// the bottom is not told they have fallen behind by the button offering to
// take them there.
const FOLLOW_END_GAP = 56

// A scroll the app asked for lands a frame or two later; until then its events
// must not be read as the reader moving. An animated one keeps arriving for
// as long as it runs.
export const FOLLOW_SETTLE_MS = 200

export const SMOOTH_SETTLE_MS = 700

export const isNearBottom = (el, gap = FOLLOW_END_GAP) => !el || (el.scrollHeight - el.scrollTop - el.clientHeight) <= gap

// Nothing to follow, and nothing to offer a way back to, when the thread fits
// on screen.
export const threadCanScroll = (el) => Boolean(el) && (el.scrollHeight - el.clientHeight) > FOLLOW_END_GAP

// Where a jump parks the message it lands on, and how far its top must have
// cleared the edge to count as being behind the reader at all.
export const JUMP_TOP_MARGIN = 12
