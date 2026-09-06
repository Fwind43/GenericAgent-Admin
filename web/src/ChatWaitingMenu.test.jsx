import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import ChatWaitingMenu from './ChatWaitingMenu.jsx'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

test('lists waiting titles and projects and opens the selected session', async () => {
  localStorage.setItem('ga-admin-lang', 'en')
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const onOpen = vi.fn()
  render(<ChatWaitingMenu sessions={[
    { id: 'alpha', title: 'Confirm deployment', project_mode: 'Folded project' },
    { id: 'beta', title: 'Choose a model' },
  ]} sid="alpha" onOpen={onOpen}/> )
  const trigger = screen.getByRole('button', { name: 'Waiting for reply (2)' })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(trigger)
  await screen.findByRole('menuitem', { name: /Confirm deployment\s*Folded project/ })
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getByRole('menuitem', { name: 'Choose a model' }))
  expect(onOpen).toHaveBeenCalledExactlyOnceWith('beta')
  await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'))
})
