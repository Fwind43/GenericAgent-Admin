export const SELECTION_KEY = 'ga-admin-ui-package-v1'
export function readSelection(storage, known) {
  try {
    const value = JSON.parse(storage.getItem(SELECTION_KEY) || 'null')
    return value?.version === 1 && known(value.id) ? value.id : 'default'
  } catch { return 'default' }
}
export function writeSelection(storage, id) {
  try { storage.setItem(SELECTION_KEY, JSON.stringify({ version: 1, id })); return true } catch { return false }
}
export function browserStorage() { try { return window.localStorage } catch { return null } }
