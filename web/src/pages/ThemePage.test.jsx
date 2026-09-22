import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ThemePage from './ThemePage'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); delete window.__GA_UI_CUSTOM_COLORS__ })
it('previews without saving, cancels, and keeps advanced controls collapsed', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  render(<ThemePage theme="warm" lang="en" setTheme={vi.fn()}/> )
  expect(screen.queryByLabelText('accent', { exact: true })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Dark/ }))
  expect(screen.getByRole('button', { name: 'Apply theme' }).disabled).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('button', { name: 'Apply theme' }).disabled).toBe(true)
})
it('awaits successful save and retains selection on failure', async () => {
  const setTheme = vi.fn()
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false, text: async () => 'offline' }).mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ theme: 'dark', custom_colors: {} }) })
  vi.stubGlobal('fetch', fetch)
  render(<ThemePage theme="warm" lang="en" setTheme={setTheme}/> )
  fireEvent.click(screen.getByRole('button', { name: /Dark/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Apply theme' }))
  await screen.findByRole('alert')
  expect(setTheme).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Apply theme' }))
  await waitFor(() => expect(setTheme).toHaveBeenCalledWith('dark'))
})
