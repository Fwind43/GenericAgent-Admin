import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fontCssPath = resolve(here, '../fonts/misans.css')
const fontDir = resolve(here, '../../public/fonts/misans')
const fontCss = readFileSync(fontCssPath, 'utf8')
const mainSource = readFileSync(resolve(here, '../main.jsx'), 'utf8')
const generalSource = readFileSync(resolve(here, '../ui/appearanceSettings.jsx'), 'utf8')
const i18nSource = readFileSync(resolve(here, 'i18n.js'), 'utf8')

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')

test('MiSans is bundled as a complete local variable-font asset set', () => {
  const faces = fontCss.match(/@font-face\s*\{/g) || []
  const urls = [...fontCss.matchAll(/url\("([^"\n]+\.woff2)"\)/g)].map(match => match[1])
  const files = readdirSync(fontDir).filter(name => name.endsWith('.woff2')).sort()

  assert.equal(faces.length, 56)
  assert.equal(urls.length, 56)
  assert.equal(new Set(urls).size, 56)
  assert.equal(files.length, 56)
  assert.ok(urls.every(url => url.startsWith('/fonts/misans/')))
  assert.deepEqual(urls.map(url => url.split('/').at(-1)).sort(), files)
  assert.equal((fontCss.match(/font-family:\s*MiSans VF;/g) || []).length, 56)
  assert.doesNotMatch(fontCss, /font-style:\s*(?:italic|oblique)/i)
  assert.equal((fontCss.match(/font-weight:\s*1 999;/g) || []).length, 56)
  assert.equal((fontCss.match(/font-display:\s*swap;/g) || []).length, 56)
  assert.equal((fontCss.match(/unicode-range:\s*[^;]+;/g) || []).length, 56)
  assert.doesNotMatch(fontCss, /url\(["']?https?:\/\//i)

  for (const file of files) {
    assert.equal(readFileSync(resolve(fontDir, file)).subarray(0, 4).toString('ascii'), 'wOF2')
  }
})

test('bundled MiSans files match the committed SHA-256 manifest', () => {
  const manifest = readFileSync(resolve(fontDir, 'SHA256SUMS.txt'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map(line => line.match(/^([a-f0-9]{64})  (.+\.woff2)$/))
    .map(match => match && [match[1], match[2]])

  assert.equal(manifest.length, 56)
  assert.ok(manifest.every(Boolean))
  assert.equal(new Set(manifest.map(([, name]) => name)).size, 56)
  for (const [expectedHash, name] of manifest) {
    assert.equal(sha256(resolve(fontDir, name)), expectedHash)
  }
})

test('MiSans loading and required attribution stay wired into the product', () => {
  const fontImport = mainSource.indexOf("import './fonts/misans.css'")
  const productCssImport = mainSource.indexOf("import './style.css'")
  assert.ok(fontImport >= 0)
  assert.ok(productCssImport > fontImport)

  const licensePath = resolve(fontDir, 'MiSans-License.pdf')
  const noticePath = resolve(fontDir, 'NOTICE.txt')
  assert.ok(existsSync(licensePath))
  assert.ok(existsSync(noticePath))
  assert.equal(readFileSync(licensePath).subarray(0, 4).toString('ascii'), '%PDF')
  assert.match(readFileSync(noticePath, 'utf8'), /Xiaomi Inc\./)
  assert.match(readFileSync(noticePath, 'utf8'), /MiSans Font Intellectual Property License Agreement/)

  assert.match(generalSource, /model\.text\.fontAttribution/)
  assert.match(generalSource, /href="\/fonts\/misans\/MiSans-License\.pdf"/)
  assert.match(generalSource, /model\.text\.fontLicense/)
  assert.ok(i18nSource.includes('\u672c\u8f6f\u4ef6\u4f7f\u7528\u5c0f\u7c73 MiSans \u5b57\u4f53\u3002'))
  assert.ok(i18nSource.includes('This software uses the Xiaomi MiSans font.'))
})
