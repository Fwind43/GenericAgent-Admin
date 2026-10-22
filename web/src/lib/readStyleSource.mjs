// Static CSS contract tests must read the same ordered imports as the bundler.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export function readStyleSource(file, ancestors = new Set()) {
  const path = file instanceof URL ? fileURLToPath(file) : resolve(file)
  if (ancestors.has(path)) throw new Error(`Circular stylesheet import: ${path}`)
  const seen = new Set(ancestors).add(path)
  return readFileSync(path, 'utf8').replace(/^@import ["'](\.[^"']+)["'];\r?\n?/gm,
    (_, relative) => readStyleSource(resolve(dirname(path), relative), seen))
}
