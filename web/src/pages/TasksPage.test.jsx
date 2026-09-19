import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TaskFormEditor, TasksPage } from './TasksPage'
import { I18N } from '../lib/i18n'
afterEach(cleanup)
it('organizes runtime reports into a selectable list and in-place detail without changing its action', () => {
 const readArtifact = vi.fn()
 const report = { path: 'autonomous_reports/fixture.txt', name: 'Fixture report', mod_time: '2026-09-19T00:00:00Z' }
 const { container } = render(<TasksPage t={I18N.en} section="runs" schedule={{ tasks: [] }} taskSvcs={[]} goals={[]} reflectSvcs={[]} autonomousReports={[report]} scheduleState={{ artifactTitle: report.path, artifact: 'Fixture body', readArtifact }} />)
 fireEvent.click(screen.getByRole('button', { name: /Fixture report/ }))
 expect(readArtifact).toHaveBeenCalledWith(report.path, { section: null })
 expect(screen.getByRole('button', { name: /Fixture report/ }).getAttribute('aria-pressed')).toBe('true')
 expect(container.querySelector('.runtime-report-detail .runtime-report-preview pre').textContent).toBe('Fixture body')
 expect(container.querySelector('.runtime-report-preview h3').textContent).toBe(report.path)
})
it('preserves unknown task fields while editing the prompt', () => {
 const onChange=vi.fn()
 render(<TaskFormEditor t={I18N.en} value={JSON.stringify({prompt:'draft',custom:{keep:true}})} onChange={onChange}/> )
 fireEvent.change(screen.getByLabelText(I18N.en.tasks.prompt),{target:{value:'edited'}})
 expect(JSON.parse(onChange.mock.calls[0][0])).toEqual({prompt:'edited',custom:{keep:true}})
})
it('announces failure without discarding the editable draft', () => {
 const noop=vi.fn()
 render(<TasksPage t={I18N.en} section="scheduled" schedule={{tasks:[]}} taskSvcs={[]} reflectSvcs={[]} goals={[]} scheduleState={{error:'Fixture failure',loading:false,selectedTask:'fixture',editorMode:'json',editor:'draft remains',setEditor:noop,reload:noop,createTask:noop,newTaskId:'',setNewTaskId:noop,saveTask:noop,deleteTask:noop}} />)
 expect(screen.getByRole('alert').textContent).toBe('Fixture failure')
 expect(screen.getByDisplayValue('draft remains')).not.toBeNull()
 expect(screen.getByRole('button',{name:I18N.en.save}).className).toContain('primary')
 expect(screen.getByRole('button',{name:I18N.en.delete}).className).toContain('danger')
})
