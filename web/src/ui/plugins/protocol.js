export const AREAS = ['admin.shell', 'admin.overview', 'chat.sidebar', 'chat.messages', 'chat.composer']
export const LIMITS = { archive: 1048576, entries: 8, depth: 8, nodes: 160 }
const bad = new Set(['__proto__', 'constructor', 'prototype'])
const fail = message => { throw new Error(message) }
const object = x => !!x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype
function fields(x, allowed) { if (!object(x) || Object.keys(x).some(k => bad.has(k) || !allowed.includes(k))) fail('Unknown or unsafe field') }
function text(x, max = 120) { if (typeof x !== 'string' || x.length > max) fail('Invalid text') }
function choice(x, values) { if (!values.includes(x)) fail('Unsupported value') }
function safeWalk(x, depth = 0) {
  if (depth > 24) fail('JSON depth exceeded')
  if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (bad.has(k)) fail('Unsafe property'); safeWalk(v, depth + 1) }
}
export function parseJSON(s) { const x = JSON.parse(s); safeWalk(x); return x }
export function validateConfig(schema, config) {
  if (!object(config) || Object.keys(config).some(k => !Object.hasOwn(schema, k))) fail('Unknown configuration')
  const result = {}
  for (const [key, spec] of Object.entries(schema)) {
    const value = Object.hasOwn(config, key) ? config[key] : spec.default
    if (spec.type === 'color') { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('Use a six-digit hex color') }
    else choice(value, spec.options)
    result[key] = value
  }
  return result
}
export function validateBundle(input) {
  safeWalk(input); fields(input, ['manifest', 'views', 'schema', 'config'])
  const { manifest: m, views, schema } = input
  fields(m, ['format', 'id', 'version', 'name', 'surfaces'])
  if (m.format !== 'gaui/1' || !/^[a-z][a-z0-9-]{2,39}$/.test(m.id) || ['default', 'studio'].includes(m.id)) fail('Invalid plugin identity')
  text(m.version, 30); text(m.name, 70)
  if (!Array.isArray(m.surfaces) || !m.surfaces.length || new Set(m.surfaces).size !== m.surfaces.length) fail('Invalid coverage')
  m.surfaces.forEach(s => choice(s, AREAS)); fields(views, m.surfaces)
  if (Object.keys(views).length !== m.surfaces.length) fail('Missing surface')
  if (!object(schema) || Object.keys(schema).length > 12) fail('Invalid schema')
  for (const [key, spec] of Object.entries(schema)) {
    if (!/^[a-z][a-zA-Z0-9]{0,24}$/.test(key)) fail('Invalid config key')
    fields(spec, ['type', 'label', 'default', 'options']); text(spec.label, 60); choice(spec.type, ['color', 'enum'])
    if (spec.type === 'enum') {
      if (!Array.isArray(spec.options) || !spec.options.length || spec.options.length > 8) fail('Invalid options')
      spec.options.forEach(v => text(v, 40))
    } else if (spec.options !== undefined) fail('Color options forbidden')
  }
  let count = 0
  function node(n, depth, area, inEach = false) {
    if (++count > LIMITS.nodes || depth > LIMITS.depth) fail('View complexity exceeded')
    fields(n, ['type', 'text', 'bind', 'children', 'source', 'action', 'target', 'style'])
    choice(n.type, ['stack', 'row', 'grid', 'heading', 'text', 'badge', 'button', 'each'])
    if (n.text !== undefined) text(n.text, 300)
    if (n.bind !== undefined) { choice(n.bind, ['title', 'label', 'status', 'value', 'item.label', 'item.status', 'item.value']); if (n.bind.startsWith('item.') && !inEach) fail('Item binding outside list') }
    if (n.style !== undefined) {
      fields(n.style, ['gap', 'padding', 'radius', 'tone', 'columns'])
      for (const k of ['gap', 'padding', 'radius']) if (n.style[k] !== undefined && (!Number.isInteger(n.style[k]) || n.style[k] < 0 || n.style[k] > 24)) fail('Style outside bounds')
      if (n.style.tone !== undefined) choice(n.style.tone, ['plain', 'muted', 'accent'])
      if (n.style.columns !== undefined) choice(n.style.columns, [1, 2, 3])
    }
    if (n.type === 'each') {
      choice(n.source, ['navigation', 'services', 'metrics'])
      if (inEach || !Array.isArray(n.children) || n.children.length !== 1) fail('Invalid repetition')
      if ((n.source === 'navigation') !== (area === 'admin.shell')) fail('Data unavailable on this surface')
    } else if (n.source !== undefined) fail('Source only allowed on lists')
    if (n.type === 'button') {
      choice(n.action, ['navigate', 'backToChat', 'refreshOverview'])
      if (n.action === 'navigate') { if (area !== 'admin.shell' || n.target !== 'item.id' || !inEach) fail('Invalid navigation') }
      else if (n.target !== undefined) fail('Unexpected action parameter')
      if (n.action === 'backToChat' && area !== 'admin.shell') fail('Action unavailable')
      if (n.action === 'refreshOverview' && area !== 'admin.overview') fail('Action unavailable')
    } else if (n.action !== undefined || n.target !== undefined) fail('Action only allowed on buttons')
    if (n.children !== undefined) {
      if (!['stack', 'row', 'grid', 'each'].includes(n.type) || !Array.isArray(n.children) || n.children.length > 24) fail('Invalid children')
      n.children.forEach(c => node(c, depth + 1, area, inEach || n.type === 'each'))
    }
  }
  for (const [area, view] of Object.entries(views)) {
    fields(view, ['before', 'after', 'layout']); fields(view.layout, ['density', 'align', 'hostOrder'])
    choice(view.layout.density, ['comfortable', 'compact']); choice(view.layout.align, ['stretch', 'center']); choice(view.layout.hostOrder, ['first', 'last'])
    if (!view.before) fail('Missing view tree')
    node(view.before, 0, area); if (view.after) node(view.after, 0, area)
  }
  const config = validateConfig(schema, input.config || {})
  return JSON.parse(JSON.stringify({ manifest: m, views, schema, config }))
}
export function crc32(bytes) {
  let c = -1
  for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) }
  return (c ^ -1) >>> 0
}
// v1 accepts STORE ZIP only. No decompressor, executable assets or external URLs.
export function readArchive(buffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 22 || bytes.length > LIMITS.archive) fail('Archive size exceeded')
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = p => d.getUint16(p, true), u32 = p => d.getUint32(p, true)
  const end = bytes.length - 22
  if (u32(end) !== 0x06054b50 || u16(end + 20) || u16(end + 4) || u16(end + 6)) fail('Unsupported ZIP footer')
  const count = u16(end + 10), start = u32(end + 16), size = u32(end + 12)
  if (count < 1 || count > LIMITS.entries || u16(end + 8) !== count || start + size !== end) fail('Invalid ZIP directory')
  const decoder = new TextDecoder('utf-8', { fatal: true }), files = {}, expected = ['manifest.json', 'views.json', 'config.schema.json', 'defaults.json']
  let cursor = start, total = 0, local = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) fail('Invalid ZIP entry')
    const flags = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16), packed = u32(cursor + 20), length = u32(cursor + 24)
    const n = u16(cursor + 28), extra = u16(cursor + 30), comment = u16(cursor + 32), offset = u32(cursor + 42)
    if (flags & ~0x800 || method !== 0 || packed !== length || extra || comment || offset !== local || u16(cursor + 34)) fail('Use plain STORE ZIP without extras')
    if (cursor + 46 + n > end || offset + 30 + n + length > start) fail('Truncated ZIP')
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + n))
    if (!expected.includes(name) || Object.hasOwn(files, name)) fail('Unsupported or duplicate file path')
    if (u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method || u32(offset + 14) !== crc || u32(offset + 18) !== packed || u32(offset + 22) !== length || u16(offset + 26) !== n || u16(offset + 28)) fail('ZIP headers disagree')
    if (decoder.decode(bytes.subarray(offset + 30, offset + 30 + n)) !== name) fail('ZIP path mismatch')
    total += length; if (total > LIMITS.archive) fail('Expanded size exceeded')
    const data = bytes.subarray(offset + 30 + n, offset + 30 + n + length)
    if (crc32(data) !== crc) fail('ZIP checksum failed')
    files[name] = parseJSON(decoder.decode(data)); local = offset + 30 + n + length; cursor += 46 + n
  }
  if (cursor !== end || local !== start || Object.keys(files).length !== expected.length) fail('Incomplete archive')
  return validateBundle({ manifest: files['manifest.json'], views: files['views.json'], schema: files['config.schema.json'], config: files['defaults.json'] })
}
