import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
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
