import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ChatSidebar } from './chatBody'
import ProjectActionsMenu from '../components/ProjectActionsMenu'
import { normalizeSidebarLayout } from '../lib/chatSidebarPreferences.js'

const ct = (_, en) => en
const emptyText = 'No pinned items yet. Pin a session or project from its menu.'
afterEach(cleanup)
const sidebarProps = {
  ct, ProjectActionsMenu, sidebarPreferences: { showPinned: true, showProjects: true, showRecent: true },
  updateSidebarPreference: vi.fn(), sidebarSections: { conductors: [] },
  pinnedExpanded: true, projectsExpanded: true, historyExpanded: true,
  pinnedSessions: [], pinnedProjectGroups: [], regularProjectGroups: [], recentSessions: [],
  sessions: [], chatInstances: [], sidebarSearch: '', projectDraftName: '',
  chatReadState: { markAllRead: vi.fn(), hasUnread: false },
  renderSidebarTree: item => <div key={item.id}>{item.title}</div>,
  renderSidebarProject: item => <div key={item.id}>{item.title}</div>,
}
const pinnedSection = container => container.querySelector('[data-sidebar-section="pinned"]')

it('applies one shared display limit to pinned projects and sessions', () => {
  const preferences = {sectionLayout:{sections:{pinned:{count:5}}}}
  const { container } = render(<ChatSidebar {...sidebarProps} sidebarPreferences={preferences}
    pinnedProjectGroups={Array.from({length:8}, (_,i)=>({id:`p${i+1}`}))}
    pinnedSessions={Array.from({length:3}, (_,i)=>({id:`s${i}`}))}
    renderSidebarProject={(group, index, options)=><div key={group.id} data-index={index} data-testid="pinned-item">Project {group.id} limit {options.initialLimit}</div>}
    renderSidebarTree={node=><div key={node.id} data-testid="pinned-item">Session {node.id}</div>}/> )
  expect(within(pinnedSection(container)).getAllByTestId('pinned-item')).toHaveLength(5)
  expect(screen.getByText('Project p1 limit 5')).toBeTruthy()
  fireEvent.click(within(pinnedSection(container)).getByRole('button',{name:'Load more (6 remaining)...'}))
  expect(within(pinnedSection(container)).getAllByTestId('pinned-item')).toHaveLength(11)
})

it.each(['projects', 'pinned'])('passes the %s display count to project session pages', section => {
  const groups = [{id:'p1'}]
  render(<ChatSidebar {...sidebarProps} sidebarPreferences={{sectionLayout:{sections:{[section]:{count:5}}}}}
    regularProjectGroups={section === 'projects' ? groups : []} pinnedProjectGroups={section === 'pinned' ? groups : []}
    renderSidebarProject={(group, index, options)=><div key={group.id} data-index={index}>Nested limit {options.initialLimit}</div>}/> )
  expect(screen.getByText('Nested limit 5')).toBeTruthy()
})

it('keeps an enabled empty pinned section visible with guidance and its settings menu', () => {
  const { container } = render(<ChatSidebar {...sidebarProps}/> )
  const section = pinnedSection(container)
  expect(section).not.toBeNull()
  expect(section.hidden).toBe(false)
  expect(within(section).getByRole('button', { name: /Pinned/ }).getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText(emptyText)).toBeTruthy()
  expect(within(section).getByRole('button', { name: 'More pinned options' })).toBeTruthy()
})

it('preserves the section when the last pinned item is removed', () => {
  const { container, rerender } = render(<ChatSidebar {...sidebarProps} pinnedSessions={[{ id: 's1', title: 'Pinned session' }]}/> )
  expect(screen.getByText('Pinned session')).toBeTruthy()
  expect(screen.queryByText(emptyText)).toBeNull()
  rerender(<ChatSidebar {...sidebarProps}/> )
  expect(pinnedSection(container)).not.toBeNull()
  expect(screen.getByText(emptyText)).toBeTruthy()
})

it('renders pinned projects without an empty hint and reports an empty search without hiding the section', () => {
  const { container, rerender } = render(<ChatSidebar {...sidebarProps} pinnedProjectGroups={[{ id: 'p1', title: 'Pinned project' }]}/> )
  expect(screen.getByText('Pinned project')).toBeTruthy()
  expect(screen.queryByText(emptyText)).toBeNull()
  rerender(<ChatSidebar {...sidebarProps} sidebarSearch="missing"/> )
  expect(pinnedSection(container).hidden).toBe(false)
  expect(screen.getByText('No matching pinned items')).toBeTruthy()
  expect(screen.queryByText(emptyText)).toBeNull()
})

it('still honors explicit hiding, assigned tabs and collapsed bodies', () => {
  const { container, rerender } = render(<ChatSidebar {...sidebarProps} sidebarPreferences={{ ...sidebarProps.sidebarPreferences, showPinned: false }}/> )
  expect(pinnedSection(container)).toBeNull()
  const sectionLayout = normalizeSidebarLayout({ tabs: [{ id: 'work', name: 'Work' }], sections: { pinned: { tab: 'work' } } })
  rerender(<ChatSidebar {...sidebarProps} sidebarPreferences={{ ...sidebarProps.sidebarPreferences, sectionLayout }}/> )
  expect(pinnedSection(container)).toBeNull()
  rerender(<ChatSidebar {...sidebarProps} sidebarPreferences={{ ...sidebarProps.sidebarPreferences, sectionLayout: { ...sectionLayout, active: 'work' } }}/> )
  expect(pinnedSection(container).hidden).toBe(false)
  rerender(<ChatSidebar {...sidebarProps} pinnedExpanded={false}/> )
  expect(pinnedSection(container).hidden).toBe(false)
  expect(container.querySelector('#oa-sidebar-pinned-body').hidden).toBe(true)
})

it('renders a shared section in both tabs and shows the add-section empty state only after local removal', () => {
  const sectionLayout = normalizeSidebarLayout({tabs:[{id:'work',name:'Work'}], sections:{
    pinned:{tabs:['home','work']},projects:{tabs:[]},conductors:{tabs:[]},recent:{tabs:[]},
  }})
  const preferences = { ...sidebarProps.sidebarPreferences, sectionLayout }
  const { container, rerender } = render(<ChatSidebar {...sidebarProps} sidebarPreferences={preferences}/> )
  expect(pinnedSection(container)).not.toBeNull()
  expect(screen.queryByText('No sections in this tab yet')).toBeNull()
  rerender(<ChatSidebar {...sidebarProps} sidebarPreferences={{...preferences,sectionLayout:{...sectionLayout,active:'work'}}}/> )
  expect(pinnedSection(container)).not.toBeNull()
  expect(screen.queryByText('No sections in this tab yet')).toBeNull()
  const removed = {...sectionLayout,active:'work',sections:{...sectionLayout.sections,pinned:{tabs:['home'],count:10}}}
  rerender(<ChatSidebar {...sidebarProps} sidebarPreferences={{...preferences,sectionLayout:removed}}/> )
  expect(pinnedSection(container)).toBeNull()
  expect(screen.getByText('No sections in this tab yet')).toBeTruthy()
  rerender(<ChatSidebar {...sidebarProps} sidebarPreferences={{...preferences,sectionLayout:{...removed,active:'home'}}}/> )
  expect(pinnedSection(container)).not.toBeNull()
})
