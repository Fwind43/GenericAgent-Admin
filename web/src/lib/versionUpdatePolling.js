export const VERSION_RESTART_GRACE_MS = 30_000
export const VERSION_RELOAD_DELAY_MS = 1_500
export const VERSION_RELOAD_RETRY_MS = 1_000

export const beginVersionRestartGrace = (now = Date.now()) => now + VERSION_RESTART_GRACE_MS

export const shouldReportVersionPollError = (graceUntil, now = Date.now()) => (
  !Number.isFinite(graceUntil) || graceUntil <= 0 || now >= graceUntil
)

export const shouldReloadAfterVersionUpdate = (status, observedRunning) => (
  Boolean(observedRunning && status?.stage === 'done' && !status?.running && !status?.error)
)

export const versionMatchesExpectedRelease = (current, expected) => {
  const normalize = value => String(value || '').trim().replace(/^v/i, '')
  const expectedVersion = normalize(expected)
  return expectedVersion === '' || normalize(current) === expectedVersion
}
