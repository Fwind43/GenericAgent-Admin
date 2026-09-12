import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import FileDownloadLink from './FileDownloadLink'
import { downloadFile } from '../lib/fileDownload.js'
import { showAppAlert } from '../lib/danger'
vi.mock('../lib/fileDownload.js', () => ({ downloadFile: vi.fn() }))
vi.mock('../lib/danger', () => ({ showAppAlert: vi.fn().mockResolvedValue() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('intercepts navigation, prevents duplicate requests and unlocks when finished', async () => {
  let finish
  downloadFile.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { getByRole } = render(<FileDownloadLink href="/api/files/download?path=a" download="a">Save</FileDownloadLink>)
  const link = getByRole('link')
  expect(fireEvent.click(link)).toBe(false)
  fireEvent.click(link)
  expect(downloadFile).toHaveBeenCalledTimes(1)
  expect(link.getAttribute('aria-busy')).toBe('true')
  finish()
  await waitFor(() => expect(link.getAttribute('aria-busy')).toBe('false'))
})
it('preserves caller-handled modified clicks', () => {
  const { getByRole } = render(<FileDownloadLink href="/api/files/download?path=a" onClick={e => e.preventDefault()}>Save</FileDownloadLink>)
  fireEvent.click(getByRole('link'), { ctrlKey: true })
  expect(downloadFile).not.toHaveBeenCalled()
})
it('shows the HTTP error instead of silently failing', async () => {
  downloadFile.mockRejectedValue(new Error('HTTP 401: authentication required'))
  const { getByRole } = render(<FileDownloadLink href="/api/files/download?path=a">Save</FileDownloadLink>)
  fireEvent.click(getByRole('link'))
  await waitFor(() => expect(showAppAlert).toHaveBeenCalledWith(expect.stringContaining('HTTP 401'), { operation: 'file-download' }))
})
