import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_THEME_ID,
  THEMES,
  applyThemeToDocument,
  getInitialTheme,
  getNextThemeId,
  getTheme,
  isThemeId,
  persistTheme,
  persistThemeLocal,
} from '../themes.js'

test('theme registry has unique IDs and complete appearance metadata', () => {
  assert.ok(THEMES.length >= 3)
  assert.equal(new Set(THEMES.map(theme => theme.id)).size, THEMES.length)
  assert.ok(isThemeId(DEFAULT_THEME_ID))

  for (const theme of THEMES) {
    assert.match(theme.id, /^[a-z][a-z0-9-]*$/)
    assert.ok(['light', 'dark'].includes(theme.colorScheme))
    assert.equal(typeof theme.icon, 'object')
    assert.equal(typeof theme.label?.en, 'string')
    assert.equal(typeof theme.label?.zh, 'string')
    assert.ok(['default', 'dark'].includes(theme.antdAlgorithm))
    assert.equal(typeof theme.antdToken, 'object')
  }
})

test('theme navigation and invalid values are derived from the registry', () => {
  assert.equal(getTheme('missing').id, DEFAULT_THEME_ID)

  THEMES.forEach((theme, index) => {
    assert.equal(getTheme(theme.id), theme)
    assert.equal(getNextThemeId(theme.id), THEMES[(index + 1) % THEMES.length].id)
  })

  assert.equal(getNextThemeId('missing'), THEMES[0].id)
})

test('applying a theme synchronizes palette and shared color-scheme attributes', () => {
  const documentRef = { documentElement: { dataset: {} } }
  const darkTheme = THEMES.find(theme => theme.colorScheme === 'dark')
  assert.ok(darkTheme)

  assert.equal(applyThemeToDocument(darkTheme.id, documentRef), darkTheme)
  assert.deepEqual(documentRef.documentElement.dataset, {
    theme: darkTheme.id,
    colorScheme: darkTheme.colorScheme,
  })

  const fallback = applyThemeToDocument('missing', documentRef)
  assert.equal(fallback.id, DEFAULT_THEME_ID)
  assert.equal(documentRef.documentElement.dataset.theme, DEFAULT_THEME_ID)
  assert.equal(documentRef.documentElement.dataset.colorScheme, fallback.colorScheme)
})

test('initial theme honors valid storage and otherwise uses the product default', () => {
  const previousWindow = globalThis.window

  try {
    globalThis.window = {
      localStorage: { getItem: () => 'warm' },
      matchMedia: () => { throw new Error('system preference must not override the product default') },
    }
    assert.equal(getInitialTheme(), 'warm')

    globalThis.window.localStorage.getItem = () => 'missing'
    assert.equal(getInitialTheme(), DEFAULT_THEME_ID)

    globalThis.window.__GA_UI_THEME__ = 'dark'
    globalThis.window.localStorage.getItem = () => 'light'
    assert.equal(getInitialTheme(), 'dark')

    globalThis.window.__GA_UI_THEME__ = 'not-a-theme'
    assert.equal(getInitialTheme(), 'light')
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('persistThemeLocal writes localStorage and emits theme-change', () => {
  const previousWindow = globalThis.window
  const stored = {}
  const events = []
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored[key] ?? null,
      setItem: (key, value) => { stored[key] = value },
    },
    dispatchEvent: (event) => { events.push(event) },
  }
  try {
    const theme = persistThemeLocal('dark')
    assert.equal(theme.id, 'dark')
    assert.equal(stored['ga-admin-theme'], 'dark')
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'ga-admin-theme-change')
    assert.equal(events[0].detail, 'dark')
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('persistTheme PUTs when the injected theme differs and skips when it matches', async () => {
  const previousWindow = globalThis.window
  const previousFetch = globalThis.fetch
  const stored = {}
  const calls = []
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored[key] ?? null,
      setItem: (key, value) => { stored[key] = String(value) },
    },
    dispatchEvent: () => true,
  }
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body })
    return { ok: true, status: 200, text: async () => '{}' }
  }
  try {
    persistTheme('dark')
    for (let i = 0; i < 50 && calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(stored['ga-admin-theme'], 'dark')
    assert.equal(globalThis.window.__GA_UI_THEME__, 'dark')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/ui/theme')
    assert.equal(calls[0].method, 'PUT')
    assert.equal(calls[0].body, JSON.stringify({ theme: 'dark' }))
    assert.equal(calls[0].headers['X-GA-Confirm'], 'dangerous')

    persistTheme('dark')
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(calls.length, 1)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (previousFetch === undefined) delete globalThis.fetch
    else globalThis.fetch = previousFetch
  }
})

import {
  CUSTOM_COLORS_STORAGE_KEY,
  applyCustomColorsToDocument,
  hydrateCustomColors,
  normalizeCustomColors,
  persistCustomColors,
  persistCustomColorsLocal,
  resetCustomColors,
  sanitizeColorValue,
} from '../themes.js'

const fakeDocument = () => {
  const head = { children: [], appendChild(node) { this.children = this.children.filter(child => child.id !== node.id); this.children.push(node) } }
  const element = { id: '', textContent: '', removed: false, remove() { this.removed = true; head.children = head.children.filter(child => child.id !== this.id) } }
  const doc = {
    documentElement: { dataset: {} },
    head,
    createElement: () => element,
    getElementById: id => head.children.find(child => child.id === id) || null,
  }
  return { doc, head, element }
}

test('green ships as a light palette with a full registry entry', () => {
  const green = THEMES.find(theme => theme.id === 'green')
  assert.ok(green, 'green theme must be registered')
  assert.equal(green.colorScheme, 'light')
  assert.equal(green.antdAlgorithm, 'default')
  assert.deepEqual(green.preview, ['#F4FAF3', '#E3F0E0', '#2F7D4F'])
  assert.equal(typeof green.label?.zh, 'string')
  assert.equal(typeof green.label?.en, 'string')
  // Registry order is a product decision: green comes after dark.
  assert.deepEqual(THEMES.map(theme => theme.id), ['light', 'warm', 'dark', 'green'])
})

test('custom colors accept only whitelisted tokens holding literal colors', () => {
  assert.equal(sanitizeColorValue('#2F7D4F'), '#2F7D4F')
  assert.equal(sanitizeColorValue('  #abc '), '#abc')
  assert.equal(sanitizeColorValue('#11223344'), '#11223344')
  assert.equal(sanitizeColorValue('rgb(47, 125, 79)'), 'rgb(47, 125, 79)')
  assert.equal(sanitizeColorValue('rgba(47, 125, 79, .5)'), 'rgba(47, 125, 79, .5)')

  // Rejections: CSS injection, unknown keywords, wrong arity, malformed hex.
  assert.equal(sanitizeColorValue('red'), '')
  assert.equal(sanitizeColorValue('red;} body{display:none'), '')
  assert.equal(sanitizeColorValue('#12'), '')
  assert.equal(sanitizeColorValue('#12345'), '')
  assert.equal(sanitizeColorValue('rgb(1,2)'), '')
  assert.equal(sanitizeColorValue('rgba(1,2,3,2)'), '')
  assert.equal(sanitizeColorValue('url(http://x/y)'), '')
  assert.equal(sanitizeColorValue('#' + 'a'.repeat(33)), '')
  assert.equal(sanitizeColorValue(123), '')
  assert.equal(sanitizeColorValue(null), '')

  assert.deepEqual(normalizeCustomColors({ accent: '#2F7D4F', '--bg': '#fff', bogus: '#000', muted: 'red' }), {
    accent: '#2F7D4F',
    bg: '#fff',
  })
  assert.deepEqual(normalizeCustomColors(null), {})
})

test('applying custom colors writes one last stylesheet covering both scopes', () => {
  const { doc, head, element } = fakeDocument()
  const applied = applyCustomColorsToDocument({ accent: '#2F7D4F', 'oa-bg': '#F4FAF3', bogus: '#000' }, doc)

  assert.deepEqual(applied, { accent: '#2F7D4F', 'oa-bg': '#F4FAF3' })
  assert.equal(element.id, 'ga-custom-colors')
  assert.equal(doc.documentElement.dataset.customColors, '1')
  assert.deepEqual(head.children.map(child => child.id), ['ga-custom-colors'])
  assert.match(element.textContent, /html\[data-custom-colors="1"\]\{--accent:#2F7D4F;\}/)
  assert.match(element.textContent, /html\[data-custom-colors="1"\] \.oa-chat\{--oa-bg:#F4FAF3;\}/)
  assert.doesNotMatch(element.textContent, /bogus/)

  // Repainting keeps a single sheet and moves it behind later stylesheets.
  applyCustomColorsToDocument({ text: '#14201A' }, doc)
  assert.equal(head.children.length, 1)
  assert.equal(element.textContent, 'html[data-custom-colors="1"]{--text:#14201A;}')

  // Clearing drops both the sheet and the attribute.
  assert.deepEqual(applyCustomColorsToDocument({}, doc), {})
  assert.equal(head.children.length, 0)
  assert.equal(element.removed, true)
  assert.equal('customColors' in doc.documentElement.dataset, false)
})

test('storing a palette applies it locally and clearing removes the stored copy', () => {
  const previousWindow = globalThis.window
  const stored = {}
  const events = []
  globalThis.window = {
    localStorage: {
      getItem: key => stored[key] ?? null,
      setItem: (key, value) => { stored[key] = String(value) },
      removeItem: key => { delete stored[key] },
    },
    dispatchEvent: event => { events.push(event) },
  }
  try {
    assert.deepEqual(persistCustomColorsLocal({ accent: '#2F7D4F', 'oa-line': 'red' }), { accent: '#2F7D4F' })
    assert.equal(stored[CUSTOM_COLORS_STORAGE_KEY], JSON.stringify({ accent: '#2F7D4F' }))
    assert.equal(events.at(-1).type, 'ga-admin-custom-colors-change')

    assert.deepEqual(persistCustomColorsLocal({}), {})
    assert.equal(CUSTOM_COLORS_STORAGE_KEY in stored, false)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('hydrate prefers the local palette and falls back to the stored server copy', async () => {
  const previousWindow = globalThis.window
  const previousFetch = globalThis.fetch
  const { doc, head } = fakeDocument()
  const stored = {}
  const calls = []
  globalThis.document = doc
  globalThis.window = {
    localStorage: {
      getItem: key => stored[key] ?? null,
      setItem: (key, value) => { stored[key] = String(value) },
      removeItem: key => { delete stored[key] },
    },
    dispatchEvent: () => true,
  }
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, body: init.body })
    return { ok: true, status: 200, text: async () => JSON.stringify({ theme: 'green', custom: { accent: '#26653F' } }) }
  }
  try {
    // Local palette present: applies, and never asks the server.
    stored[CUSTOM_COLORS_STORAGE_KEY] = JSON.stringify({ accent: '#2F7D4F' })
    assert.deepEqual(await hydrateCustomColors(), { accent: '#2F7D4F' })
    assert.equal(calls.length, 0)
    assert.match(head.children[0].textContent, /--accent:#2F7D4F/)

    // Empty client: pulls the persisted palette and caches it locally.
    delete stored[CUSTOM_COLORS_STORAGE_KEY]
    assert.deepEqual(await hydrateCustomColors(), { accent: '#26653F' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/ui/theme')
    assert.equal(stored[CUSTOM_COLORS_STORAGE_KEY], JSON.stringify({ accent: '#26653F' }))
  } finally {
    delete globalThis.document
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (previousFetch === undefined) delete globalThis.fetch
    else globalThis.fetch = previousFetch
  }
})

test('persistCustomColors PUTs the palette with the active theme and reset clears it', async () => {
  const previousWindow = globalThis.window
  const previousFetch = globalThis.fetch
  const { doc } = fakeDocument()
  const calls = []
  globalThis.document = doc
  globalThis.window = {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    dispatchEvent: () => true,
  }
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body })
    return { ok: true, status: 200, text: async () => '{}' }
  }
  const settle = async () => {
    for (let i = 0; i < 50 && calls.length === 0; i += 1) await new Promise(resolve => setTimeout(resolve, 10))
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  try {
    persistCustomColors({ accent: '#F4FAF3', 'oa-text': '#14201A' }, 'green')
    await settle()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/ui/theme')
    assert.equal(calls[0].method, 'PUT')
    assert.equal(calls[0].headers['X-GA-Confirm'], 'dangerous')
    assert.deepEqual(JSON.parse(calls[0].body), { theme: 'green', custom: { accent: '#F4FAF3', 'oa-text': '#14201A' } })

    resetCustomColors('green')
    await settle()
    assert.equal(calls.length, 2)
    assert.deepEqual(JSON.parse(calls[1].body), { theme: 'green', custom: {} })
  } finally {
    delete globalThis.document
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (previousFetch === undefined) delete globalThis.fetch
    else globalThis.fetch = previousFetch
  }
})
