import React from 'react'
import { expect, test, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { lazySurface } from './lazySurface'

test('loads only on mount and forwards props after resolving', async () => {
  let resolve
  const load = vi.fn(() => new Promise(r => { resolve = r }))
  const View = lazySurface(load, 'Panel')
  expect(load).not.toHaveBeenCalled()
  const mounted = render(<View label="Ready" />)
  expect(screen.getByRole('status').textContent).toBe('Loading...')
  expect(load).toHaveBeenCalledTimes(1)
  resolve({ Panel: ({ label }) => <div>{label}</div> })
  expect(await screen.findByText('Ready')).toBeTruthy()
  mounted.rerender(<View label="Updated" />)
  expect(screen.getByText('Updated')).toBeTruthy()
  expect(load).toHaveBeenCalledTimes(1)
  cleanup()
})
