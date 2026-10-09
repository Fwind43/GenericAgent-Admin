import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ProjectActionsMenu, { SidebarPreferenceSubmenu } from './ProjectActionsMenu'

const options = [{ value:'a', label:'Alpha' }, { value:'b', label:'Beta' }]
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

it('portals the submenu outside a transformed, clipped sidebar and closes after selection', () => {
  const change = vi.fn()
  const { container } = render(<div style={{ transform:'translateX(0)', overflow:'hidden' }}><SidebarPreferenceSubmenu label="Add section" value="" options={options} onChange={change}/></div>)
  fireEvent.click(screen.getByRole('button', { name:'Add section' }))
  const panel = screen.getByRole('menu', { name:'Add section' })
  expect(panel.parentElement).toBe(document.body)
  expect(container.contains(panel)).toBe(false)
  fireEvent.click(screen.getByRole('menuitemradio', { name:'Alpha' }))
  expect(change).toHaveBeenCalledWith('a')
  expect(screen.queryByRole('menu')).toBeNull()
})

it('keeps the parent menu alive on submenu pointerdown and internal scroll', () => {
  const change = vi.fn()
  render(<ProjectActionsMenu label="Settings"><SidebarPreferenceSubmenu label="Filter" value={['a']} options={options} onChange={change} multiple/></ProjectActionsMenu>)
  fireEvent.click(screen.getByRole('button', { name:'Settings' }))
  fireEvent.mouseEnter(screen.getByRole('button', { name:'Filter' }).parentElement)
  fireEvent.click(screen.getByRole('button', { name:'Filter' }))
  const item = screen.getByRole('menuitemcheckbox', { name:'Beta' })
  fireEvent.pointerDown(item)
  fireEvent.click(item)
  expect(change).toHaveBeenCalledWith('b')
  expect(screen.getByRole('button', { name:'Settings' }).getAttribute('aria-expanded')).toBe('true')
  fireEvent.scroll(screen.getByRole('menu'))
  expect(screen.getByRole('menu')).not.toBeNull()
  fireEvent.scroll(document.body)
  expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.getByRole('button', { name:'Settings' }).getAttribute('aria-expanded')).toBe('false')
})

it('bridges hover movement into the portal without leaving a stale open menu', () => {
  vi.useFakeTimers()
  render(<SidebarPreferenceSubmenu label="Count" value={10} options={[{value:10,label:'10'}]} onChange={vi.fn()}/>)
  const trigger = screen.getByRole('button', { name:'Count' })
  fireEvent.mouseEnter(trigger.parentElement)
  fireEvent.mouseLeave(trigger.parentElement)
  fireEvent.mouseEnter(screen.getByRole('menu'))
  vi.advanceTimersByTime(200)
  expect(screen.getByRole('menu')).not.toBeNull()
  fireEvent.keyDown(screen.getByRole('menu'), { key:'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  fireEvent.click(trigger)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('menu')).toBeNull()
})

it('measures the actual submenu before placing it against the viewport edges', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.getAttribute('role') === 'menu'
      ? { width:200, height:120 }
      : { left:950, right:1000, top:740 }
  })
  render(<SidebarPreferenceSubmenu label="Tab" value="" options={options} onChange={vi.fn()}/>)
  fireEvent.click(screen.getByRole('button', { name:'Tab' }))
  const panel = screen.getByRole('menu')
  expect(panel.style.left).toBe('750px')
  expect(panel.style.top).toBe(`${window.innerHeight - 128}px`)
  fireEvent.resize(window)
  expect(screen.queryByRole('menu')).toBeNull()
})

it('does not open an empty Add section menu', () => {
  render(<SidebarPreferenceSubmenu label="Add section" value="" options={[]} onChange={vi.fn()}/>)
  const trigger = screen.getByRole('button', { name:'Add section' })
  expect(trigger.disabled).toBe(true)
  fireEvent.mouseEnter(trigger.parentElement)
  expect(screen.queryByRole('menu')).toBeNull()
})
