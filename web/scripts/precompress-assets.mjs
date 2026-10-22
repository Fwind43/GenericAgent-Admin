import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Run after Vite has finalized asset URLs and CSS. Never compress index.html:
// the server injects the user's palette at request time.
export function precompressAssets() {
  let outputDir
  return {
    name: 'precompress-assets',
    apply: 'build',
    configResolved(config) {
      outputDir = path.resolve(config.root, config.build.outDir, 'assets')
    },
    closeBundle() {
      for (const fileName of readdirSync(outputDir)) {
        if (!/\.(?:js|mjs|css|json|svg|txt|xml)$/i.test(fileName)) continue
        const file = path.join(outputDir, fileName)
        const bytes = readFileSync(file)
        if (bytes.length < 1024) continue
        const compressed = brotliCompressSync(bytes, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        })
        if (compressed.length < bytes.length) {
          if (!brotliDecompressSync(compressed).equals(bytes)) throw new Error(`Brotli mismatch: ${fileName}`)
          writeFileSync(`${file}.br`, compressed)
        }
      }
    },
  }
}
