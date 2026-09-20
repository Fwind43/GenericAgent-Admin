import { createRegistry, manifest } from './contract'
import { defaults } from './default'
export const registry = createRegistry()
registry.register(defaults.manifest, async () => defaults)
// Explicit build-time allowlist. No user-controlled URL or module specifier.
registry.register(manifest('studio'), () => import('./studio.jsx'))
