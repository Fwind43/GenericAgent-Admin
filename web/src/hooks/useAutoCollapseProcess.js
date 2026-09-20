import { useSyncExternalStore } from 'react'

export const AUTO_COLLAPSE_PROCESS_KEY = 'ga-admin-auto-collapse-process'
const changeEvent = 'ga-admin-auto-collapse-process-change'
let fallback = true
let memoryOnly = false

function getSnapshot() {
  if (memoryOnly) return fallback
  try {
    return window.localStorage.getItem(AUTO_COLLAPSE_PROCESS_KEY) !== 'false'
  } catch {
    return fallback
  }
}

function subscribe(listener) {
  const onStorage = event => {
    if (event.key === AUTO_COLLAPSE_PROCESS_KEY || event.key === null) { memoryOnly = false; listener() }
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(changeEvent, listener)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(changeEvent, listener)
  }
}

export function setAutoCollapseProcess(enabled) {
  fallback = Boolean(enabled)
  try {
    window.localStorage.setItem(AUTO_COLLAPSE_PROCESS_KEY, String(fallback))
    memoryOnly = false
  } catch { memoryOnly = true }
  window.dispatchEvent(new Event(changeEvent))
  return !memoryOnly
}

export function useAutoCollapseProcess() {
  return [useSyncExternalStore(subscribe, getSnapshot, () => true), setAutoCollapseProcess]
}
