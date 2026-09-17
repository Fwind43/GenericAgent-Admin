import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FilePreviewLink from './FilePreviewLink'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function open(name) {
  render(<FilePreviewLink href={`/api/files/download?path=${name}`} download={name}>preview</FilePreviewLink>)
  fireEvent.click(screen.getByText('preview'))
}
function response(text) {
  const bytes = new TextEncoder().encode(text)
  let done = false
  return { ok: true, headers: new Headers(), body: { getReader: () => ({ read: async () => done ? { done: true } : (done = true, { done: false, value: bytes }) }) } }
}
it('unsupported formats offer download without fetching', async () => {
  vi.stubGlobal('fetch', vi.fn())
  open('book.docx')
  expect(await screen.findByText(/此格式暂不支持/)).toBeTruthy()
  expect(screen.getByText('下载').getAttribute('download')).toBe('book.docx')
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('关闭'))
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('renders text without interpreting HTML', async () => {
  vi.stubGlobal('Blob', class { constructor(parts) { this.parts = parts } async text() { return new TextDecoder().decode(this.parts[0]) } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('<script>alert(1)</script>')))
  open('code.txt')
  expect(await screen.findByText('<script>alert(1)</script>')).toBeTruthy()
  expect(document.querySelector('dialog script')).toBeNull()
  expect(fetch).toHaveBeenCalledWith('/api/files/download?path=code.txt', expect.objectContaining({ credentials: 'same-origin', redirect: 'error' }))
})
it('isolates HTML scripts without same-origin access', async () => {
  vi.stubGlobal('Blob', class { constructor(parts) { this.parts = parts } async text() { return new TextDecoder().decode(this.parts[0]) } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('<h1>Preview</h1>')))
  open('page.html')
  await waitFor(() => expect(document.querySelector('iframe[title="page.html"]')).toBeTruthy())
  const frame = document.querySelector('iframe[title="page.html"]')
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  expect(frame.getAttribute('srcdoc')).toContain("connect-src 'none'")
  expect(frame.getAttribute('srcdoc')).toContain('<h1>Preview</h1>')
})
it('shows HTTP failures and keeps download available', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
  open('page.html')
  expect(await screen.findByText(/HTTP 401/)).toBeTruthy()
  expect(screen.getByText('下载')).toBeTruthy()
})
it('renders Markdown by default and can switch back to source', async () => {
  vi.stubGlobal('Blob', class { constructor(parts) { this.parts = parts } async text() { return new TextDecoder().decode(this.parts[0]) } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('# Guide\n\n**bold** and `code`\n\n```js\nalert("ok")\n```')))
  open('guide.md')
  expect(await screen.findByRole('heading', { name: 'Guide' })).toBeTruthy()
  expect(screen.getByText('bold').closest('strong')).toBeTruthy()
  expect(screen.getByText('alert("ok")')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Markdown 预览' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: '源码' }))
  expect(screen.getByText(/# Guide/).tagName).toBe('PRE')
})
it('does not execute Markdown HTML or load remote images', async () => {
  vi.stubGlobal('Blob', class { constructor(parts) { this.parts = parts } async text() { return new TextDecoder().decode(this.parts[0]) } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('<script>alert(1)</script>\n\n![remote](https://evil.example/pixel.png)\n\n[bad](javascript:alert(1))')))
  open('unsafe.markdown')
  expect(await screen.findByText('<script>alert(1)</script>')).toBeTruthy()
  expect(document.querySelector('dialog script')).toBeNull()
  expect(document.querySelector('dialog img')).toBeNull()
  expect(screen.getByText('[image: remote]')).toBeTruthy()
  expect(screen.getByText('bad').closest('a')).toBeNull()
})
it('closes an open preview on Escape', async () => {
  vi.stubGlobal('Blob', class { constructor(parts) { this.parts = parts } async text() { return new TextDecoder().decode(this.parts[0]) } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('# Guide')))
  open('guide.md')
  expect(await screen.findByRole('heading', { name: 'Guide' })).toBeTruthy()
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
