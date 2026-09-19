import React, { useRef, useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useAdminDrawerFocus } from './useAdminDrawerFocus'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function Fixture({ mobile = true, embedded = false }) {
  window.matchMedia = () => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const [open, setOpen] = useState(false)
  const sidebarRef = useRef(null), toggleRef = useRef(null), mainRef = useRef(null)
  const close = React.useCallback(() => setOpen(false), [])
  useAdminDrawerFocus({ open, embedded, sidebarRef, toggleRef, mainRef, close })
  return <><aside ref={sidebarRef}><button onClick={close}>Close</button><button aria-current="page">Current</button><button>Last</button></aside><main ref={mainRef}><button ref={toggleRef} onClick={() => setOpen(true)}>Open</button></main></>
}
it('focuses current navigation, traps Tab and returns focus on Escape', () => {
  render(<Fixture/>); fireEvent.click(screen.getByText('Open'))
  expect(document.activeElement).toBe(screen.getByText('Current'))
  expect(document.querySelector('main').inert).toBe(true)
  screen.getByText('Last').focus(); fireEvent.keyDown(document, { key: 'Tab' })
  expect(document.activeElement).toBe(screen.getByText('Close'))
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(screen.getByText('Last'))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(document.activeElement).toBe(screen.getByText('Open'))
  expect(document.querySelector('main').inert).not.toBe(true)
})
it('restores focus when the close button is activated', () => {
  render(<Fixture/>); fireEvent.click(screen.getByText('Open')); fireEvent.click(screen.getByText('Close'))
  expect(document.activeElement).toBe(screen.getByText('Open'))
})
it.each([{mobile:false}, {embedded:true}])('does not lock desktop or embedded content: %j', props => {
  render(<Fixture {...props}/>); fireEvent.click(screen.getByText('Open'))
  expect(document.querySelector('main').inert).not.toBe(true)
})
