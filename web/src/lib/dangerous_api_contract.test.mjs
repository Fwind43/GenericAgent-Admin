
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

test('App gates dangerous API calls behind confirmDanger except read-only key reveal', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const lines = app.split(/\r?\n/)
  const misses = []
  const noConfirmReadOnlyRevealRoutes = new Set(["'/api/models/raw'"])
  lines.forEach((line, idx) => {
    if (!line.includes('dangerous:true') && !line.includes('dangerous: true')) return
    if ([...noConfirmReadOnlyRevealRoutes].some(route => line.includes(route))) return
    const window = lines.slice(Math.max(0, idx - 6), idx + 1).join('\n')
    if (!window.includes('confirmDanger(')) misses.push(`${idx + 1}: ${line.trim()}`)
  })
  assert.deepEqual(misses, [])
})

test('version update UI keeps destructive update behind status-aware controls', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  assert.match(app, /confirmDanger\('version-update'/)
  assert.match(app, /api\('\/api\/version\/update', \{ dangerous:true, method:'POST'/)
  assert.match(app, /disabled=\{versionBusy \|\| versionStatus\?\.running \|\| !versionCheck\?\.update\}/)
  assert.match(app, /setInterval\(\(\) => refreshVersionStatus\(\)\.catch\(error =>/)
  assert.match(app, /shouldReportVersionPollError\(versionRestartGraceUntil\.current\)/)
  assert.match(app, /versionRestartGraceUntil\.current = beginVersionRestartGrace\(\)/)
  assert.match(app, /shouldReloadAfterVersionUpdate\(versionStatus, versionUpdateNeedsReload\.current\)/)
  assert.match(app, /versionMatchesExpectedRelease\(info\?\.version, expectedVersion\)/)
  assert.match(app, /window\.location\.reload\(\)/)
  assert.match(app, /api\('\/api\/version\/status'\)/)
})

const internalApiDir = new URL('../../../internal/api/', import.meta.url)
const backendApi = readFileSync(new URL('api.go', internalApiDir), 'utf8')
const backendSources = readdirSync(internalApiDir)
  .filter(name => name.endsWith('.go') && !name.endsWith('_test.go'))
  .map(name => readFileSync(new URL(name, internalApiDir), 'utf8'))

const protectedMutatingRoutes = Array.from(
  backendApi.matchAll(/mux\.HandleFunc\("([^"]+)",\s*s\.requireDangerousConfirm\(/g),
  match => match[1],
)

const dangerousHeaderHandlers = new Set()
for (const src of backendSources) {
  const funcMatches = Array.from(src.matchAll(/func\s+\(s \*Server\)\s+(\w+)\s*\(/g))
  funcMatches.forEach((match, idx) => {
    const body = src.slice(match.index, funcMatches[idx + 1]?.index ?? src.length)
    if (body.includes('requireDangerousHeader(')) dangerousHeaderHandlers.add(match[1])
  })
}

const dangerousHeaderRoutes = Array.from(
  backendApi.matchAll(/mux\.HandleFunc\("([^"]+)",\s*s\.(\w+)\)/g),
  match => ({ route: match[1], handler: match[2] }),
).filter(({ handler }) => dangerousHeaderHandlers.has(handler)).map(({ route }) => route)

const protectedFrontendRoutes = Array.from(new Set([...protectedMutatingRoutes, ...dangerousHeaderRoutes]))
const alwaysHeaderRoutes = new Set(['/api/models/raw'])
const noConfirmReadOnlyRevealRoutes = new Set(['/api/models/raw'])

const exactRouteString = (route) => new RegExp(`['"]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`)
const mutatingMethod = /method:\s*['"](?:POST|PUT|DELETE)['"]/

test('frontend dangerous-route list is derived from backend confirm and header gates', () => {
  assert.ok(protectedMutatingRoutes.length > 20, 'expected many backend dangerous routes')
  assert.ok(protectedMutatingRoutes.includes('/api/models/export'), 'models export backend route should be discovered')
  assert.ok(dangerousHeaderRoutes.includes('/api/models/raw'), 'models raw header-gated route should be discovered')
  assert.ok(dangerousHeaderRoutes.includes('/api/models/import-mykey'), 'mykey import reveal/save header-gated route should be discovered')
})

test('frontend sends dangerous header for every protected mutating API route it calls', () => {
  const srcDir = new URL('../', import.meta.url)
  const files = ['App.jsx', 'ChatApp.jsx', 'pages/FilesPage.jsx', 'pages/GoalsPage.jsx', 'components/ProcessGuard.jsx']
  const misses = []
  const seen = new Map(protectedFrontendRoutes.map(route => [route, 0]))

  for (const file of files) {
    const app = readFileSync(new URL(file, srcDir), 'utf8')
    const lines = app.split(/\r?\n/)
    lines.forEach((line, idx) => {
      for (const route of protectedFrontendRoutes) {
        if (!exactRouteString(route).test(line)) continue
        const call = lines.slice(idx, Math.min(lines.length, idx + 4)).join('\n')
        if (!call.includes('api(')) continue
        const isDangerousMethod = mutatingMethod.test(call) || alwaysHeaderRoutes.has(route)
        const safeMaskedMyKeyImport = route === '/api/models/import-mykey' && /reveal\s*:\s*false/.test(call) && /save\s*:\s*false/.test(call)
        if (!isDangerousMethod || safeMaskedMyKeyImport) continue
        seen.set(route, (seen.get(route) || 0) + 1)
        const guardWindow = lines.slice(Math.max(0, idx - 8), Math.min(lines.length, idx + 4)).join('\n')
        const hasDangerousHeader = call.includes('dangerous:true') || call.includes('dangerous: true')
        const hasConfirm = guardWindow.includes('confirmDanger(')
        const requiresConfirm = !noConfirmReadOnlyRevealRoutes.has(route)
        if (!hasDangerousHeader || (requiresConfirm && !hasConfirm)) misses.push(`${file}:${idx + 1} ${route} dangerous=${hasDangerousHeader} confirm=${hasConfirm}`)
      }
    })
  }

  assert.deepEqual(misses, [])
  assert.ok(seen.get('/api/models/export') > 0, 'models export call should be covered')
  assert.ok(seen.get('/api/ga/processes/kill') > 0, 'process kill call should be covered')
  assert.ok(seen.get('/api/ga/processes/adopt') > 0, 'process adopt call should be covered')
})
