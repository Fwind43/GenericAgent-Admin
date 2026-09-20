export const UI_API = '1.0.0'
export const SURFACES = ['admin.shell', 'admin.overview', 'admin.settings.appearance', 'admin.settings.remote', 'admin.settings.paths', 'admin.settings.network', 'admin.settings.startup', 'chat.chrome', 'chat.sidebar', 'chat.messages', 'chat.composer']
export const CAPABILITIES = ['navigation', 'overview.read', 'overview.refresh', 'settings.edit', 'settings.save', 'settings.autostart']
export function validateManifest(m) {
  if (!m || m.manifestVersion !== 1 || !/^[a-z][a-z0-9-]*$/.test(m.id || '') || !/^\d+\.\d+\.\d+$/.test(m.version || '')) throw new Error('Invalid UI manifest')
  if (m.hostUiApi !== '^1.0.0' || m.source !== 'builtin') throw new Error('Incompatible UI package')
  if (!Array.isArray(m.surfaces) || !m.surfaces.length || new Set(m.surfaces).size !== m.surfaces.length || m.surfaces.some(s => !SURFACES.includes(s))) throw new Error('Unknown UI surface')
  if (!Array.isArray(m.capabilities) || m.capabilities.some(c => !CAPABILITIES.includes(c))) throw new Error('Unknown UI capability')
  return m
}
export function createRegistry() {
  const entries = new Map()
  return {
    register(manifest, load) {
      validateManifest(manifest)
      if (entries.has(manifest.id) || typeof load !== 'function') throw new Error('Duplicate or invalid UI registration')
      entries.set(manifest.id, { manifest, load })
    },
    has: id => entries.has(id),
    async load(id) {
      const entry = entries.get(id)
      if (!entry) throw new Error('Unknown UI package')
      const module = await entry.load()
      for (const surface of entry.manifest.surfaces) if (typeof module.views?.[surface] !== 'function') throw new Error('Missing UI view: ' + surface)
      return { manifest: entry.manifest, views: module.views, layouts: module.layouts || {} }
    },
  }
}
export const surfaceView = (pkg, surface, defaults) => pkg?.views?.[surface] || defaults.views[surface]
export const manifest = id => ({ manifestVersion: 1, id, version: '0.1.0', hostUiApi: '^1.0.0', source: 'builtin', surfaces: [...SURFACES], capabilities: [...CAPABILITIES] })
