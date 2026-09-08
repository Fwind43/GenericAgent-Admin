import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProjectModeSetting from './ProjectModeSetting'
afterEach(cleanup)
it('defaults to official and saves Admin explicitly', async () => {
  const save = vi.fn().mockResolvedValue('admin')
  render(<ProjectModeSetting onSave={save} lang="en" />)
  expect(screen.getByRole('combobox').value).toBe('official')
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'admin' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('admin'))
  await screen.findByText('Saved. All projects use this mode from the next turn.')
})
it('shows save errors without claiming success', async () => {
  render(<ProjectModeSetting value="admin" onSave={vi.fn().mockRejectedValue(new Error('save failed'))} lang="en" />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'official' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('save failed')
  expect(screen.queryByText('Saved. All projects use this mode from the next turn.')).toBeNull()
})
it('reflects persisted mode changes', () => {
  const { rerender } = render(<ProjectModeSetting value="official" />)
  rerender(<ProjectModeSetting value="admin" />)
  expect(screen.getByRole('combobox').value).toBe('admin')
})
