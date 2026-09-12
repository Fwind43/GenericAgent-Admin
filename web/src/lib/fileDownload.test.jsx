import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileDownloadTarget, downloadFile } from './fileDownload.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
describe('authenticated file downloads', () => {
  it('recognizes relative and same-origin URLs but never external origins', () => {
    const base = 'http://100.64.0.2:8787/'
    expect(fileDownloadTarget('/api/files/download?path=E%3A%5Ctest.html', base).name).toBe('test.html')
    expect(fileDownloadTarget(base + 'api/files/download?path=x', base).href).toBe('/api/files/download?path=x')
    expect(fileDownloadTarget('https://evil.test/api/files/download?path=x', base)).toBeNull()
    expect(fileDownloadTarget('/api/files/download', base)).toBeNull()
    expect(fileDownloadTarget('/api/files/open?path=x', base)).toBeNull()
  })
  it('fetches with page credentials and downloads a blob, delaying cleanup', async () => {
    vi.useFakeTimers()
    const blob = new Blob(['payload'])
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
    let clicked
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicked = { href: this.href, name: this.download } })
    await downloadFile('/api/files/download?path=test.html')
    expect(fetchMock).toHaveBeenCalledWith('/api/files/download?path=test.html', { credentials: 'same-origin', redirect: 'error' })
    expect(clicked).toEqual({ href: 'blob:test', name: 'test.html' })
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })
  it('reports auth and server errors instead of saving an error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'authentication required' }))
    await expect(downloadFile('/api/files/download?path=x')).rejects.toThrow('HTTP 401: authentication required')
    await expect(downloadFile('https://evil.test/api/files/download?path=x')).rejects.toThrow('Invalid file download URL')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
