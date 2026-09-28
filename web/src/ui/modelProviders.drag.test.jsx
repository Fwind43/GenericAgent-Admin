import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DefaultModelProviders, StudioModelProviders } from './modelProviders'

beforeEach(() => {
  class TestPointerEvent extends MouseEvent {
    constructor(type, options = {}) {
      super(type, options)
      Object.defineProperties(this, {
        isPrimary: { value: options.isPrimary ?? true },
        pointerId: { value: options.pointerId ?? 1 },
        pointerType: { value: options.pointerType ?? 'mouse' },
      })
    }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const entry = this.closest('.model-provider-nav-entry')
    const index = entry ? [...entry.parentElement.children].indexOf(entry) : 0
    const top = index * 100
    return { x: 0, y: top, top, bottom: top + 90, left: 0, right: 240, width: 240, height: 90, toJSON() {} }
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mount(View, disabled = false) {
  const actions = { reorderProviders: vi.fn(), openProvider: vi.fn(), addProvider: vi.fn() }
  render(<View model={{ title: 'Providers', addLabel: 'Add', editLabel: 'Edit', reorderLabel: 'Reorder', reorderingDisabled: disabled, providers: [0, 1, 2].map(id => ({ id, name: `Provider ${id}`, protocol: 'OAI', modelCount: 1 })) }} actions={actions}/>)
  return actions
}

it.each([
  ['default', DefaultModelProviders, 'mouse'], ['studio', StudioModelProviders, 'mouse'],
  ['default', DefaultModelProviders, 'touch'], ['studio', StudioModelProviders, 'touch'],
])('reorders the first provider immediately with %s / %s / %s', (_name, View, pointerType) => {
  const actions = mount(View)
  const handle = screen.getByRole('button', { name: 'Reorder: Provider 0' })
  fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 30, pointerType })
  fireEvent.pointerMove(document, { clientX: 200, clientY: 42, pointerType })
  fireEvent.pointerMove(document, { clientX: 200, clientY: 230, pointerType })
  fireEvent.pointerUp(document, { clientX: 200, clientY: 230, pointerType })
  expect(actions.reorderProviders).toHaveBeenCalledWith(0, 2)
  expect(actions.openProvider).not.toHaveBeenCalled()
})

it('does not reorder from a click, small movement, cancellation, or disabled handle', () => {
  const actions = mount(DefaultModelProviders)
  const handle = screen.getByRole('button', { name: 'Reorder: Provider 0' })
  fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 30 })
  fireEvent.pointerMove(document, { clientX: 200, clientY: 33 })
  fireEvent.pointerUp(document)
  expect(actions.reorderProviders).not.toHaveBeenCalled()
  fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 30 })
  fireEvent.pointerMove(document, { clientX: 200, clientY: 42 })
  fireEvent.pointerMove(document, { clientX: 200, clientY: 230 })
  fireEvent.pointerCancel(document)
  expect(actions.reorderProviders).not.toHaveBeenCalled()
  cleanup()
  const blocked = mount(DefaultModelProviders, true)
  const disabled = screen.getByRole('button', { name: 'Reorder: Provider 0' })
  expect(disabled.disabled).toBe(true)
  fireEvent.pointerDown(disabled, { button: 0, clientX: 200, clientY: 30 })
  fireEvent.pointerMove(document, { clientX: 200, clientY: 230 })
  fireEvent.pointerUp(document)
  expect(blocked.reorderProviders).not.toHaveBeenCalled()
})
