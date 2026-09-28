import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import SessionTimeTooltip from './SessionTimeTooltip'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    constructor(type, init = {}) { super(type, init); this.pointerType = init.pointerType || 'mouse' }
  })
})
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })
const advance = ms => act(() => { vi.advanceTimersByTime(ms) })
function setup() {
  const click = vi.fn()
  render(<SessionTimeTooltip title="Conversation" timeLabel="Updated: yesterday"><button onClick={click}>Conversation</button></SessionTimeTooltip>)
  return { button: screen.getByRole('button', { name: 'Conversation' }), click }
}
it('shows time on hover and keyboard focus, not in the row', () => {
  const { button } = setup()
  expect(button.textContent).toBe('Conversation')
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.mouseEnter(button); advance(200)
  expect(screen.getByRole('tooltip').textContent).toContain('Updated: yesterday')
  fireEvent.keyDown(document, { key: 'Escape' }); advance(500)
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.focus(button); advance(200)
  expect(screen.getByRole('tooltip')).toBeTruthy()
  fireEvent.blur(button); advance(500)
  expect(screen.queryByRole('tooltip')).toBeNull()
})
it('keeps a short touch as normal navigation', () => {
  const { button, click } = setup()
  fireEvent.pointerDown(button, { pointerType: 'touch' }); advance(100)
  fireEvent.pointerUp(button, { pointerType: 'touch' }); fireEvent.click(button); advance(600)
  expect(click).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('tooltip')).toBeNull()
})
it('shows time on long press without navigating and dismisses automatically', () => {
  const { button, click } = setup()
  fireEvent.pointerDown(button, { pointerType: 'touch' }); advance(550)
  expect(screen.getByRole('tooltip').textContent).toContain('Updated: yesterday')
  fireEvent.pointerUp(button, { pointerType: 'touch' }); fireEvent.click(button)
  expect(click).not.toHaveBeenCalled()
  advance(3000); expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.pointerDown(button, { pointerType: 'touch' }); fireEvent.pointerUp(button); fireEvent.click(button)
  expect(click).toHaveBeenCalledTimes(1)
  fireEvent.pointerEnter(button, { pointerType: 'mouse' }); fireEvent.mouseEnter(button); advance(200)
  expect(screen.getByRole('tooltip')).toBeTruthy()
})
it('cancels a press on movement, cancellation, and unmount', () => {
  const { button } = setup()
  fireEvent.pointerDown(button, { pointerType: 'touch', clientX: 0, clientY: 0 })
  fireEvent.pointerMove(button, { pointerType: 'touch', clientX: 30, clientY: 0 }); advance(600)
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.pointerDown(button, { pointerType: 'touch' }); fireEvent.pointerCancel(button); advance(600)
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.pointerDown(button, { pointerType: 'touch' }); cleanup(); advance(600)
  expect(screen.queryByRole('tooltip')).toBeNull()
})
