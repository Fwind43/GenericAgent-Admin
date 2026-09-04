const isObject = value => value !== null && typeof value === 'object'

export function equalSessionSummaryValue(left, right) {
  if (Object.is(left, right)) return true
  if (!isObject(left) || !isObject(right)) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (!equalSessionSummaryValue(left[key], right[key])) return false
  }
  return true
}

export function reconcileSessionSummaries(previous, incoming) {
  const before = Array.isArray(previous) ? previous : []
  const after = Array.isArray(incoming) ? incoming : []
  const previousByID = new Map(before.map(session => [session?.id, session]))
  let unchanged = before.length === after.length

  const reconciled = after.map((session, index) => {
    const existing = previousByID.get(session?.id)
    const value = existing && equalSessionSummaryValue(existing, session) ? existing : session
    if (value !== before[index]) unchanged = false
    return value
  })

  return unchanged ? before : reconciled
}

export function reconcileScalarList(previous, incoming) {
  const before = Array.isArray(previous) ? previous : []
  const after = Array.isArray(incoming) ? incoming : []
  if (before.length === after.length && before.every((value, index) => Object.is(value, after[index]))) return before
  return after
}
