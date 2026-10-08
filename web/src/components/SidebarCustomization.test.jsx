import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SidebarCustomization, { SidebarSections, SidebarTabs, SidebarSectionOptions } from './SidebarCustomization'
import { normalizeSidebarLayout } from '../lib/chatSidebarPreferences.js'
const ct = (_, en) => en
afterEach(cleanup)
it('edits visibility and restores layout without deleting content', () => {
  const update = vi.fn()
  render(<SidebarCustomization preferences={{showProjects:true}} update={update} ct={ct}/> )
  fireEvent.click(screen.getByLabelText('Projects'))
  expect(update).toHaveBeenCalledWith('showProjects', false)
  fireEvent.click(screen.getByRole('button', {name:'Restore default sections'}))
  expect(update).toHaveBeenCalledWith('sectionLayout', normalizeSidebarLayout())
  for (const key of ['showPinned','showConductor','showProjects','showRecent']) expect(update).toHaveBeenCalledWith(key, true)
})
it('reorders sections, filters by active tab and keeps edit content visible', () => {
  const children = [<div key="search">Search</div>, <section key="p" data-sidebar-section="projects">Projects</section>, <section key="r" data-sidebar-section="recent">Recent</section>]
  const layout = normalizeSidebarLayout({tabs:[{id:'work',name:'Work'}],sections:{projects:{tab:'work'}}})
  const view = render(<SidebarSections order={['recent','projects']} layout={layout}>{children}</SidebarSections>)
  expect(view.container.textContent).toBe('SearchRecent')
  view.rerender(<SidebarSections order={['recent','projects']} layout={{...layout,active:'work'}}>{children}</SidebarSections>)
  expect(view.container.textContent).toBe('SearchProjects')
  expect(view.container.firstChild.hidden).toBe(false)
})
it('creates, renames and deletes tabs while moving sections home', () => {
  const update = vi.fn()
  const layout = normalizeSidebarLayout({tabs:[{id:'work',name:'Work'}],active:'work',sections:{projects:{tab:'work',count:20}}})
  render(<SidebarTabs preferences={{sectionLayout:layout}} update={update} ct={ct}/> )
  fireEvent.click(screen.getByRole('button',{name:'Manage tab Work'}))
  fireEvent.click(screen.getByRole('button',{name:'Rename'}))
  fireEvent.change(screen.getByLabelText('Tab name'),{target:{value:'Office'}})
  fireEvent.click(screen.getByRole('button',{name:'Save'}))
  expect(update.mock.calls.at(-1)[1].tabs[1].name).toBe('Office')
  fireEvent.click(screen.getByRole('button',{name:'Manage tab Work'}))
  fireEvent.click(screen.getByRole('button',{name:'Delete tab (move sections home)'}))
  expect(update.mock.calls.at(-1)[1].sections.projects).toEqual({tab:'home',count:20})
  fireEvent.click(screen.getByRole('button',{name:'New tab'}))
  fireEvent.change(screen.getByLabelText('Tab name'),{target:{value:'Personal'}})
  fireEvent.click(screen.getByRole('button',{name:'Save'}))
  expect(update.mock.calls.at(-1)[1].tabs.at(-1).name).toBe('Personal')
})
it('section menus change count, order and tab ownership', () => {
  const update = vi.fn()
  render(<SidebarSectionOptions section="recent" preferences={{}} update={update} ct={ct}/> )
  fireEvent.mouseEnter(screen.getByRole('button',{name:'Show · 10'}).parentElement)
  fireEvent.click(screen.getByRole('button',{name:'Show · 10'}))
  fireEvent.click(screen.getByRole('menuitemradio',{name:'20 items'}))
  expect(update.mock.calls.at(-1)[1].sections.recent.count).toBe(20)
  fireEvent.click(screen.getByRole('button',{name:'Move up'}))
  expect(update).toHaveBeenCalledWith('sectionOrder',['pinned','conductors','recent','projects'])
  expect(screen.getByRole('button',{name:'Move down'}).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button',{name:'Move to new tab'}))
  const next = update.mock.calls.at(-1)[1]
  expect(next.sections.recent.tab).toBe(next.active)
  expect(next.tabs.at(-1).id).toBe(next.active)
})
