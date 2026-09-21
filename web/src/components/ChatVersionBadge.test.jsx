import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import ChatVersionBadge from './ChatVersionBadge'
vi.mock('../lib/api', () => ({ api: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('shows the running Admin version', async () => {
  api.mockResolvedValue({ version: 'v1.2.3' })
  render(<ChatVersionBadge/>)
  expect(await screen.findByText('Admin v1.2.3')).toBeTruthy()
  expect(api).toHaveBeenCalledWith('/api/version/info')
})
it('does not invent a version on failure', async () => {
  api.mockRejectedValue(new Error('offline'))
  render(<ChatVersionBadge/>)
  expect(await screen.findByText('Admin ?')).toBeTruthy()
})
