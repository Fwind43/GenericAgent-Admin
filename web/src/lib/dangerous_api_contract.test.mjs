
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { frontendSource, frontendSources } from './frontendSources.mjs'

// Guards can sit at the top of a handler while the request is built further
// down, so the scan looks back over a whole handler rather than a few lines.
const GUARD_LOOKBACK = 30

// Deleting an instance is gated by an in-page confirmation dialog
// (requestDelete -> deleteTarget modal -> remove), which no text scan can see.
const DIALOG_GATED = new Set(['pages/InstancesPage.jsx:/api/instances/delete'])

const dialogGated = (file, window) => [...DIALOG_GATED].some(entry => {
  const [gatedFile, route] = entry.split(':')
  return file === gatedFile && window.includes(route)
})

test('every frontend module gates dangerous API calls behind confirmDanger except read-only key reveal', () => {
  const misses = []
  const noConfirmReadOnlyRevealRoutes = new Set(["'/api/models/raw'", "'/api/ui/theme'"])
  for (const { file, source } of frontendSources()) {
    const lines = source.split(/\r?\n/)
    lines.forEach((line, idx) => {
      if (!line.includes('dangerous:true') && !line.includes('dangerous: true')) return
      const window = lines.slice(Math.max(0, idx - GUARD_LOOKBACK), idx + 2).join('\n')
      if ([...noConfirmReadOnlyRevealRoutes].some(route => window.includes(route))) return
      if (window.includes('confirmDanger(') || dialogGated(file, window)) return
      misses.push(`${file}:${idx + 1}: ${line.trim()}`)
    })
  }
  assert.deepEqual(misses, [])
})

test('version update UI keeps destructive update behind status-aware controls', () => {
  const source = frontendSource()
  assert.match(source, /confirmDanger\('version-update'/)
  assert.match(source, /api\('\/api\/version\/update', \{ dangerous:true, method:'POST'/)
  const modal = readFileSync(new URL('../components/SystemUpdateModal.jsx', import.meta.url), 'utf8')
  const hook = readFileSync(new URL('../hooks/useVersionUpdates.js', import.meta.url), 'utf8')
  const view = readFileSync(new URL('./versionUpdateView.js', import.meta.url), 'utf8')
  assert.match(modal, /disabled=\{!view\.canPrepare\}/)
  assert.match(modal, /disabled=\{!view\.canRestart\}/)
  assert.match(view, /canPrepare: Boolean\([^\n]+!statusError && !locked\)/)
  assert.match(hook, /if \(actionPending\.current \|\| !currentView\(\)\.canPrepare\) return/)
  assert.match(hook, /updateOperationLocked\(latestStatus\)/)
  assert.match(hook, /latestStatus\.id !== operationID/)
  assert.match(hook, /body: JSON\.stringify\(\{ operation_id: operationID \}\)/)
  assert.match(source, /setInterval\([^,]+,\s*VERSION_RELOAD_RETRY_MS\)/)
  assert.match(source, /api\('\/api\/version\/status'\)/)
})

test('GA source updates stay with GA: the console only reads git status', () => {
  const source = frontendSource()
  assert.doesNotMatch(source, /\/api\/ga\/git-update/)
  assert.match(source, /api\('\/api\/ga\/git-status\?remote=1'\)/)
  assert.match(source, /<code>\/update<\/code>/)
  assert.match(source, /copy\.sourceSelfUpdateCta/)
})

// Without git there is still a GA root to show and /update to point at, so the
// card stays and only the git-dependent rows go: the branch row and the check
// button.
test('the GA source card keeps its place when git cannot answer', () => {
  const source = frontendSource()
  assert.match(source, /const sourceAvailable = gitStatus\?\.available !== false/)
  assert.match(source, /<Panel area="source" title=\{copy\.sourceTitle\}/)
  assert.doesNotMatch(source, /\{sourceAvailable && <Panel area="source"/)
  assert.match(source, /\{sourceAvailable && <div className="overview-kv">\s*<span>\{copy\.branch\}/)
  assert.match(source, /\{sourceAvailable && <button type="button" onClick=\{version\.checkSource\}/)
  assert.match(source, /api\('\/api\/ga\/git-status'\)\.catch/)
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
  backendApi.matchAll(/mux\.HandleFunc\("([^"]+)",\s*(?:s\.(\w+)|s\.withModelInstance\(\(\*Server\)\.(\w+)\))\)/g),
  match => ({ route: match[1], handler: match[2] || match[3] }),
).filter(({ handler }) => dangerousHeaderHandlers.has(handler)).map(({ route }) => route)

const protectedFrontendRoutes = Array.from(new Set([...protectedMutatingRoutes, ...dangerousHeaderRoutes]))
const alwaysHeaderRoutes = new Set(['/api/models/raw'])
const noConfirmReadOnlyRevealRoutes = new Set(['/api/models/raw', '/api/ui/theme'])

const exactRouteString = (route) => new RegExp(`['"]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`)
const mutatingMethod = /method:\s*['"](?:POST|PUT|DELETE)['"]/
// Chat routes go through chatApi, which appends the instance id before calling
// api; the guard requirements are identical either way.
const apiCall = /\bapi\(|\bchatApi\(/

test('frontend dangerous-route list is derived from backend confirm and header gates', () => {
  assert.ok(protectedMutatingRoutes.length > 20, 'expected many backend dangerous routes')
  assert.ok(protectedMutatingRoutes.includes('/api/models/export'), 'models export backend route should be discovered')
  assert.ok(dangerousHeaderRoutes.includes('/api/models/raw'), 'models raw header-gated route should be discovered')
  assert.ok(dangerousHeaderRoutes.includes('/api/models/import-mykey'), 'mykey import reveal/save header-gated route should be discovered')
})

test('frontend sends dangerous header for every protected mutating API route it calls', () => {
  const misses = []
  const seen = new Map(protectedFrontendRoutes.map(route => [route, 0]))

  for (const { file, source } of frontendSources()) {
    const lines = source.split(/\r?\n/)
    lines.forEach((line, idx) => {
      for (const route of protectedFrontendRoutes) {
        if (!exactRouteString(route).test(line)) continue
        const call = lines.slice(idx, Math.min(lines.length, idx + 4)).join('\n')
        if (!apiCall.test(call)) continue
        const isDangerousMethod = mutatingMethod.test(call) || alwaysHeaderRoutes.has(route)
        const safeMaskedMyKeyImport = route === '/api/models/import-mykey' && /reveal\s*:\s*false/.test(call) && /save\s*:\s*false/.test(call)
        if (!isDangerousMethod || safeMaskedMyKeyImport) continue
        seen.set(route, (seen.get(route) || 0) + 1)
        const guardWindow = lines.slice(Math.max(0, idx - GUARD_LOOKBACK), Math.min(lines.length, idx + 4)).join('\n')
        const hasDangerousHeader = call.includes('dangerous:true') || call.includes('dangerous: true')
        const hasConfirm = guardWindow.includes('confirmDanger(') || dialogGated(file, guardWindow)
        const requiresConfirm = !noConfirmReadOnlyRevealRoutes.has(route)
        if (!hasDangerousHeader || (requiresConfirm && !hasConfirm)) misses.push(`${file}:${idx + 1} ${route} dangerous=${hasDangerousHeader} confirm=${hasConfirm}`)
      }
    })
  }

  assert.deepEqual(misses, [])
  assert.ok(seen.get('/api/models/export') > 0, 'models export call should be covered')
  assert.ok(seen.get('/api/ga/processes/kill') > 0, 'process kill call should be covered')
  assert.ok(seen.get('/api/ga/processes/adopt') > 0, 'process adopt call should be covered')
  assert.ok(seen.get('/api/chat/python/install-deps') > 0, 'chat python dependency repair call should be covered')
})

