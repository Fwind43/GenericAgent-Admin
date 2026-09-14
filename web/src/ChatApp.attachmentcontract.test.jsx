import { expect, test } from 'vitest'
import { normalizeChatAttachment, normalizeChatAttachments, chatAttachmentSource } from './lib/chatAttachments.js'

for (const alias of ['dataURL', 'data_url', 'DataURL']) {
  test(`normalizes ${alias} once and emits only canonical fields`, () => {
    const input = { name: 'x.png', type: 'image/png', [alias]: 'data:image/png;base64,eA==', path: '/keep' }
    const normalized = normalizeChatAttachment(input)
    expect(normalized.dataURL).toBe('data:image/png;base64,eA==')
    expect(normalized).not.toHaveProperty('data_url')
    expect(normalized).not.toHaveProperty('DataURL')
    expect(normalized.path).toBe('/keep')
    expect(chatAttachmentSource(normalized)).toBe(normalized.dataURL)
    const persisted = JSON.stringify(normalized)
    expect(JSON.stringify(normalizeChatAttachment(JSON.parse(persisted)))).toBe(persisted)
    expect(input[alias]).toBe(normalized.dataURL)
  })
}
test('keeps remote URLs distinct and prefers canonical inline data', () => {
  const normalized = normalizeChatAttachment({ url: '/image', dataURL: 'new', data_url: 'old' })
  expect(normalized.dataURL).toBe('new')
  expect(chatAttachmentSource(normalized)).toBe('/image')
  expect(normalizeChatAttachments(null)).toEqual([])
  expect(normalizeChatAttachments([null, { DataURL: 'old' }])).toHaveLength(1)
})
