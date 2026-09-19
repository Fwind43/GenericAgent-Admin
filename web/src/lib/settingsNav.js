import { NAV_ITEMS } from './routing.js'

// The settings surface is grouped so the sidebar reads as a preferences list
// instead of a flat console menu. Every route in NAV_ITEMS belongs to exactly
// one group; settingsNavItems() is the single source of truth for nav order.
export const SETTINGS_GROUPS = [
  { id: 'general', items: ['overview', 'settings', 'chat'] },
  { id: 'agent', items: ['models', 'keychain', 'instances', 'channels'] },
  { id: 'automation', items: ['tasks', 'goals'] },
  { id: 'system', items: ['files', 'usage', 'logs'] },
]

export const settingsNavItems = () => SETTINGS_GROUPS.flatMap(group => group.items)

export const settingsNavGroupOf = (tab) => SETTINGS_GROUPS.find(group => group.items.includes(tab))?.id || ''

export const unassignedNavItems = () => {
  const assigned = new Set(settingsNavItems())
  return NAV_ITEMS.filter(item => !assigned.has(item))
}

// Standalone console groups do not change embedded chat settings.
export const ADMIN_GROUPS = [
  { id: 'general', label: { en: 'Workspace', zh: '工作台' }, items: ['overview'] },
  { id: 'agent', label: { en: 'Configuration', zh: '配置' }, items: ['settings', 'chat', 'models', 'keychain', 'instances', 'channels'] },
  { id: 'automation', label: { en: 'Operations', zh: '运行' }, items: ['tasks', 'goals', 'files'] },
  { id: 'system', label: { en: 'Diagnostics', zh: '诊断' }, items: ['usage', 'logs'] },
]
