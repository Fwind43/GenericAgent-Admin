import React from 'react'
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ProjectActionsMenu, { SidebarPreferenceSubmenu } from './ProjectActionsMenu'
afterEach(cleanup)
test('submenu opens without closing parent and selection closes both', () => {
 const change = vi.fn()
 render(<ProjectActionsMenu label="More"><SidebarPreferenceSubmenu label="View" value="projects" options={[{value:'projects',label:'Projects'},{value:'list',label:'List'}]} onChange={change}/></ProjectActionsMenu>)
 fireEvent.click(screen.getByRole('button', {name:'More'}))
 fireEvent.click(screen.getByRole('button', {name:'View'}))
 expect(screen.getByRole('menuitemradio', {name:'Projects'}).getAttribute('aria-checked')).toBe('true')
 fireEvent.click(screen.getByRole('menuitemradio', {name:'List'}))
 expect(change).toHaveBeenCalledWith('list')
 expect(screen.queryByRole('menu')).toBeNull()
})
test('hover opens and Escape closes only submenu', () => {
 render(<ProjectActionsMenu label="More"><SidebarPreferenceSubmenu label="View" value="projects" options={[{value:'projects',label:'Projects'}]} onChange={()=>{}}/></ProjectActionsMenu>)
 fireEvent.click(screen.getByRole('button', {name:'More'}))
 fireEvent.mouseEnter(screen.getByRole('button', {name:'View'}))
 fireEvent.keyDown(screen.getByRole('menuitemradio'), {key:'Escape'})
 expect(screen.queryByRole('menu')).toBeNull()
 expect(screen.getByRole('button', {name:'View'})).toBeTruthy()
})
