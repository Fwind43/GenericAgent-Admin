import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SidebarCustomization, { SidebarSections } from './SidebarCustomization'
const ct = (_, en) => en
afterEach(cleanup)
it('edits visibility, keyboard-friendly order and restores all sections', () => {
  const update = vi.fn()
  render(<SidebarCustomization preferences={{showProjects:true}} update={update} ct={ct}/> )
  fireEvent.click(screen.getByLabelText('Projects'))
  expect(update).toHaveBeenCalledWith('showProjects', false)
  expect(screen.getByRole('button', {name:'Move Pinned up'}).disabled).toBe(true)
  expect(screen.getByRole('button', {name:'Move Recent down'}).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', {name:'Move Recent up'}))
  expect(update).toHaveBeenCalledWith('sectionOrder', ['pinned','conductors','recent','projects'])
  fireEvent.click(screen.getByRole('button', {name:'Restore default sections'}))
  for (const key of ['showPinned','showConductor','showProjects','showRecent']) expect(update).toHaveBeenCalledWith(key, true)
})
it('reorders sections while keeping search first and preserves mounted content in edit mode', () => {
  const children = [<div key="search">Search</div>, <section key="p" data-sidebar-section="projects">Projects</section>, <section key="r" data-sidebar-section="recent">Recent</section>]
  const view = render(<SidebarSections order={['recent','projects']} customizing={false}>{children}</SidebarSections>)
  const root = view.container.firstChild
  expect(root.textContent).toBe('SearchRecentProjects')
  const section = root.querySelector('[data-sidebar-section="recent"]')
  view.rerender(<SidebarSections order={['recent','projects']} customizing>{children}</SidebarSections>)
  expect(root.hidden).toBe(true)
  expect(root.querySelector('[data-sidebar-section="recent"]')).toBe(section)
})
