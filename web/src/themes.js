import { Leaf, Moon, Sun, Sunset } from 'lucide-react'

// Appearance is data-driven: add a registry entry and a matching CSS token scope.
// `colorScheme` selects shared light/dark compatibility rules; theme IDs only select palettes.
// Keep the order intentional; pickers render this registry as an explicit choice list.
export const THEMES = Object.freeze([
  {
    id: 'light',
    colorScheme: 'light',
    icon: Sun,
    label: { zh: '\u6d45\u8272', en: 'Light' },
    description: { zh: '\u6e05\u6670\u3001\u514b\u5236\u7684\u51b7\u8c03\u754c\u9762', en: 'Crisp, restrained cool tones' },
    preview: ['#f7f8fb', '#ffffff', '#171717'],
    antdAlgorithm: 'default',
    antdToken: { colorBgBase: '#ffffff', colorTextBase: '#171717', colorBorder: 'rgba(23, 23, 23, .14)' },
  },
  {
    id: 'warm',
    colorScheme: 'light',
    icon: Sunset,
    label: { zh: '暖色', en: 'Warm' },
    description: { zh: '温暖金色调卡其色系统', en: 'Warm gold-tinted khaki palette' },
    preview: ['#FEFCF7', '#FAF7F0', '#C9A961'],  // Updated to match new colorPrimary
    antdAlgorithm: 'default',
    antdToken: {
      colorBgBase: '#FEFCF7',
      colorTextBase: '#1A1610',
      colorBorder: '#E0D8C8',
      colorPrimary: '#C9A961',  // Reduced saturation from #B8860B
      colorSuccess: '#3D8B40',
      colorWarning: '#E68A00',
      colorError: '#C62828',
      colorInfo: '#0288A8',
      colorBgContainer: '#F3EEE3',
      colorBgLayout: '#FAF7F0',
      colorBgElevated: '#F3EEE3',
    },
  },
  {
    id: 'dark',
    colorScheme: 'dark',
    icon: Moon,
    label: { zh: '\u6df1\u8272', en: 'Dark' },
    description: { zh: '\u4f4e\u7729\u5149\u7684\u6df1\u8272\u5de5\u4f5c\u533a', en: 'Low-glare dark workspace' },
    preview: ['#111214', '#202124', '#e6e7e9'],
    antdAlgorithm: 'dark',
    antdToken: { colorBgBase: '#191c21', colorTextBase: '#ececf1', colorBorder: '#343a42' },
  },
  {
    id: 'green',
    colorScheme: 'light',
    icon: Leaf,
    label: { zh: '\u7eff\u8272', en: 'Green' },
    description: { zh: '\u82d4\u7eff\u4e0e\u96fe\u9762\u7684\u81ea\u7136\u8c03\u8272\u677f', en: 'Moss and mist natural palette' },
    preview: ['#F4FAF3', '#E3F0E0', '#2F7D4F'],
    antdAlgorithm: 'default',
    antdToken: {
      colorBgBase: '#F4FAF3',
      colorTextBase: '#14201A',
      colorBorder: '#C6DDC8',
      colorPrimary: '#2F7D4F',
      colorSuccess: '#2F7D4F',
      colorWarning: '#9A6A00',
      colorError: '#C0392B',
      colorInfo: '#0F7291',
      colorBgContainer: '#E3F0E0',
      colorBgLayout: '#ECF5EA',
      colorBgElevated: '#FFFFFF',
    },
  },
])

export const DEFAULT_THEME_ID = 'warm'

// Custom palette overrides. `scope: 'chat'` tokens live on the `.oa-chat` root,
// every other token is a global design token. Values are limited to literal
// colors so a stored string can never smuggle in extra CSS declarations.
export const CUSTOM_COLOR_TOKENS = Object.freeze([
  { token: 'bg', scope: 'global' },
  { token: 'bg-soft', scope: 'global' },
  { token: 'surface', scope: 'global' },
  { token: 'surface-strong', scope: 'global' },
  { token: 'surface-muted', scope: 'global' },
  { token: 'border', scope: 'global' },
  { token: 'border-strong', scope: 'global' },
  { token: 'text', scope: 'global' },
  { token: 'muted', scope: 'global' },
  { token: 'accent', scope: 'global' },
  { token: 'accent-hover', scope: 'global' },
  { token: 'accent-text', scope: 'global' },
  { token: 'on-accent', scope: 'global' },
  { token: 'hover', scope: 'global' },
  { token: 'selected', scope: 'global' },
  { token: 'selected-text', scope: 'global' },
  { token: 'disabled-bg', scope: 'global' },
  { token: 'disabled-text', scope: 'global' },
  { token: 'focus', scope: 'global' },
  { token: 'success', scope: 'global' },
  { token: 'warning', scope: 'global' },
  { token: 'error', scope: 'global' },
  { token: 'info', scope: 'global' },
  { token: 'scrollbar-track', scope: 'global' },
  { token: 'scrollbar-thumb', scope: 'global' },
  { token: 'scrollbar-hover', scope: 'global' },
  { token: 'oa-bg', scope: 'chat' },
  { token: 'oa-panel', scope: 'chat' },
  { token: 'oa-text', scope: 'chat' },
  { token: 'oa-muted', scope: 'chat' },
  { token: 'oa-line', scope: 'chat' },
  { token: 'oa-green', scope: 'chat' },
  { token: 'oa-hover', scope: 'chat' },
  { token: 'oa-user', scope: 'chat' },
])

const CUSTOM_COLOR_TOKEN_SET = new Set(CUSTOM_COLOR_TOKENS.map(item => item.token))
const CUSTOM_COLOR_SCOPE = new Map(CUSTOM_COLOR_TOKENS.map(item => [item.token, item.scope]))
const COLOR_VALUE_RE = /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgb\(\s*\d{1,3}(?:\s*,\s*\d{1,3}){2}\s*\)|rgba\(\s*\d{1,3}(?:\s*,\s*\d{1,3}){2}\s*,\s*(?:0|1|0?\.\d+)\s*\))$/
export const CUSTOM_COLORS_STORAGE_KEY = 'ga-admin-custom-colors'
export const CUSTOM_COLORS_STYLE_ID = 'ga-custom-colors'

export const sanitizeColorValue = value => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 32) return ''
  if (!COLOR_VALUE_RE.test(trimmed)) return ''
  if (trimmed.startsWith('rgb') && trimmed.match(/[\d.]+/g).slice(0, 3).some(n => Number(n) > 255)) return ''
  return trimmed
}

export const normalizeCustomColors = (input) => {
  const source = input && typeof input === 'object' ? input : {}
  const out = {}
  for (const [rawToken, rawValue] of Object.entries(source)) {
    const token = String(rawToken).trim().replace(/^--/, '')
    if (!CUSTOM_COLOR_TOKEN_SET.has(token)) continue
    const value = sanitizeColorValue(rawValue)
    if (value) out[token] = value
  }
  return out
}

export const applyCustomColorsToDocument = (input, documentRef = globalThis.document) => {
  const colors = normalizeCustomColors(input)
  const root = documentRef?.documentElement
  const styleId = CUSTOM_COLORS_STYLE_ID
  let element = documentRef?.getElementById?.(styleId) || null
  const globalDeclarations = []
  const chatDeclarations = []
  for (const [token, value] of Object.entries(colors)) {
    const declaration = `--${token}:${value};`
    if (CUSTOM_COLOR_SCOPE.get(token) === 'chat') chatDeclarations.push(declaration)
    else globalDeclarations.push(declaration)
  }
  if (!globalDeclarations.length && !chatDeclarations.length) {
    element?.remove?.()
    if (root) delete root.dataset.customColors
    return {}
  }
  if (!element && documentRef?.createElement) {
    element = documentRef.createElement('style')
    element.id = styleId
  }
  if (element) {
    const rules = []
    if (globalDeclarations.length) rules.push(`html:root[data-custom-colors="1"]:not([data-external-ui="active"]){${globalDeclarations.join('')}}`)
    if (chatDeclarations.length) rules.push(`html:root[data-custom-colors="1"]:not([data-external-ui="active"]) .oa-chat{${chatDeclarations.join('')}}`)
    element.textContent = rules.join('')
    // :root raises specificity above preset root and chat token scopes.
    // Keep the sheet last as well for equally specific late-loaded rules.
    documentRef.head?.appendChild(element)
  }
  if (root) root.dataset.customColors = '1'
  return colors
}

export const getInitialCustomColors = () => {
  if (typeof window === 'undefined') return {}
  const injected = normalizeCustomColors(window.__GA_UI_CUSTOM_COLORS__)
  if (window.__GA_UI_CUSTOM_COLORS__ !== undefined) return injected
  try {
    return normalizeCustomColors(JSON.parse(window.localStorage.getItem(CUSTOM_COLORS_STORAGE_KEY) || '{}'))
  } catch {
    return {}
  }
}

export const persistCustomColorsLocal = (input) => {
  const colors = normalizeCustomColors(input)
  if (typeof window === 'undefined') return colors
  try {
    if (Object.keys(colors).length) window.localStorage.setItem(CUSTOM_COLORS_STORAGE_KEY, JSON.stringify(colors))
    else window.localStorage.removeItem(CUSTOM_COLORS_STORAGE_KEY)
  } catch { /* storage may be unavailable; the in-memory palette still applies */ }
  // Storing and painting are one step: callers never have to remember to apply.
  applyCustomColorsToDocument(colors)
  window.dispatchEvent(new CustomEvent('ga-admin-custom-colors-change', { detail: colors }))
  return colors
}

// Preview is intentionally memory-only; revision guards late hydration responses.
let paletteRevision = 0
export const previewCustomColors = input => {
  paletteRevision += 1
  const colors = applyCustomColorsToDocument(input)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ga-admin-custom-colors-change', { detail: colors }))
  return colors
}

export const fetchStoredCustomColors = async () => {
  const { api } = await import('./lib/api.js')
  const body = await api('/api/ui/theme')
  return normalizeCustomColors(body?.custom)
}

// Server (including an empty palette) wins. Local/injected values are only an
// offline/first-paint fallback, never a reason to skip server reconciliation.
export const hydrateCustomColors = async () => {
  if (typeof window === 'undefined') return {}
  const revision = paletteRevision
  const initial = getInitialCustomColors()
  applyCustomColorsToDocument(initial)
  try {
    const stored = await fetchStoredCustomColors()
    if (revision !== paletteRevision) return initial
    window.__GA_UI_CUSTOM_COLORS__ = stored
    return persistCustomColorsLocal(stored)
  } catch {
    return initial
  }
}

export const persistCustomColors = async (input, themeId = DEFAULT_THEME_ID) => {
  const colors = normalizeCustomColors(input)
  if (typeof window === 'undefined') return colors
  const { api } = await import('./lib/api.js')
  await api('/api/ui/theme', {
    method: 'PUT',
    dangerous: true,
    body: JSON.stringify({ theme: getTheme(themeId).id, custom: colors }),
  })
  // No local mutation until the server acknowledged the write. Errors propagate.
  paletteRevision += 1
  window.__GA_UI_CUSTOM_COLORS__ = colors
  return persistCustomColorsLocal(colors)
}

// Ant Design consumes literal colors, not CSS vars (its palette algorithm parses
// them). The same change event drives draft previews and persisted palettes.
export const customColorsToAntd = input => {
  const colors = normalizeCustomColors(input)
  const mapping = {
    bg: ['colorBgLayout'], surface: ['colorBgContainer', 'colorBgElevated'],
    'surface-strong': ['colorBgBase'], 'surface-muted': ['colorFillTertiary'],
    text: ['colorText', 'colorTextBase'], muted: ['colorTextSecondary'],
    border: ['colorBorder', 'colorBorderSecondary'], 'border-strong': ['colorSplit'],
    accent: ['colorPrimary', 'colorInfo'], 'accent-hover': ['colorPrimaryHover'],
    'accent-text': ['colorLink'], 'on-accent': ['colorTextLightSolid'],
    hover: ['controlItemBgHover'], selected: ['controlItemBgActive', 'controlItemBgActiveHover'],
    'selected-text': ['colorPrimaryText'], 'disabled-bg': ['colorBgContainerDisabled'],
    'disabled-text': ['colorTextDisabled'], focus: ['controlOutline'],
    success: ['colorSuccess'], warning: ['colorWarning'], error: ['colorError'], info: ['colorInfo'],
  }
  return Object.fromEntries(Object.entries(mapping).flatMap(([key, targets]) =>
    colors[key] ? targets.map(target => [target, colors[key]]) : []))
}

// Keep unfilled states derived from the preset, not from explicit state colors.
// AntD removes seed overrides in formatToken, but regenerates alias tokens there.
// Apply all explicit colors after derivation, and repeat only non-seed overrides
// in token so alias formatting also preserves explicitly supplied state colors.
export const createAntdTheme = (preset, antd, input) => {
  const baseAlgorithm = antd[`${preset.antdAlgorithm}Algorithm`] || antd.defaultAlgorithm
  const explicit = customColorsToAntd(input)
  const aliases = Object.fromEntries(Object.entries(explicit).filter(([key]) =>
    !Object.prototype.hasOwnProperty.call(antd.defaultSeed, key)))
  return {
    algorithm: Object.keys(explicit).length
      ? seed => ({ ...baseAlgorithm(seed), ...explicit })
      : baseAlgorithm,
    token: {
      colorPrimary: '#10a37f', borderRadius: 10, fontFamily: 'var(--font)',
      ...preset.antdToken, ...aliases,
    },
  }
}

// Clearing sends an explicit empty object so the server drops the palette
// instead of keeping the previous one.
export const resetCustomColors = (themeId = DEFAULT_THEME_ID) => persistCustomColors({}, themeId)

const themeById = new Map(THEMES.map(theme => [theme.id, theme]))

export const isThemeId = value => themeById.has(value)

export const getTheme = value => themeById.get(value) || themeById.get(DEFAULT_THEME_ID)

export const getNextThemeId = value => {
  const currentIndex = THEMES.findIndex(theme => theme.id === value)
  return THEMES[(currentIndex + 1) % THEMES.length].id
}

export const getThemeLabel = (value, lang = 'en') => {
  const theme = getTheme(value)
  return theme.label[lang] || theme.label.en
}

export const applyThemeToDocument = (value, documentRef = globalThis.document) => {
  const theme = getTheme(value)
  const root = documentRef?.documentElement
  if (root) {
    root.dataset.theme = theme.id
    root.dataset.colorScheme = theme.colorScheme
  }
  // Inside the desktop window the title bar is painted by the OS, not by CSS.
  // The host binds this function so the frame can follow the palette; in a
  // plain browser it simply does not exist.
  globalThis.gaNativeTheme?.(theme.colorScheme === 'dark')
  return theme
}

export const getInitialTheme = () => {
  if (typeof window === 'undefined') return DEFAULT_THEME_ID
  const injected = window.__GA_UI_THEME__
  if (isThemeId(injected)) return injected
  const stored = window.localStorage.getItem('ga-admin-theme')
  return isThemeId(stored) ? stored : DEFAULT_THEME_ID
}

export const persistThemeLocal = (themeId) => {
  const theme = getTheme(themeId)
  if (typeof window === 'undefined') return theme
  window.localStorage.setItem('ga-admin-theme', theme.id)
  window.dispatchEvent(new CustomEvent('ga-admin-theme-change', { detail: theme.id }))
  return theme
}

export const persistTheme = (themeId) => {
  const theme = persistThemeLocal(themeId)
  if (typeof window === 'undefined') return theme
  if (window.__GA_UI_THEME__ === theme.id) return theme
  window.__GA_UI_THEME__ = theme.id
  void import('./lib/api.js').then(({ api }) => api('/api/ui/theme', {
    method: 'PUT',
    dangerous: true,
    body: JSON.stringify({ theme: theme.id }),
  })).catch(() => {})
  return theme
}
