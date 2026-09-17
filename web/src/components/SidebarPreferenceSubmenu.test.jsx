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

test('multiple choices toggle independently and keep the menu open', () => {
 function Example() {
  const [value, setValue] = React.useState(['projects'])
  return <ProjectActionsMenu label="More"><SidebarPreferenceSubmenu multiple label="View" value={value} options={[{value:'projects',label:'Projects'},{value:'conductor',label:'Conductor'}]} onChange={key=>setValue(current=>current.includes(key) ? current.filter(v=>v!==key) : [...current,key])}/></ProjectActionsMenu>
 }
 render(<Example/>)
 fireEvent.click(screen.getByRole('button', {name:'More'}))
 fireEvent.click(screen.getByRole('button', {name:'View'}))
 const projects = screen.getByRole('menuitemcheckbox', {name:'Projects'})
 const conductor = screen.getByRole('menuitemcheckbox', {name:'Conductor'})
 expect(projects.getAttribute('aria-checked')).toBe('true')
 expect(conductor.getAttribute('aria-checked')).toBe('false')
 fireEvent.click(conductor)
 expect(projects.getAttribute('aria-checked')).toBe('true')
 expect(conductor.getAttribute('aria-checked')).toBe('true')
 fireEvent.click(projects)
 fireEvent.click(conductor)
 expect(projects.getAttribute('aria-checked')).toBe('false')
 expect(conductor.getAttribute('aria-checked')).toBe('false')
 expect(screen.getByRole('menu')).toBeTruthy()
})
