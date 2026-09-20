import React, { useEffect, useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TasksPage } from '../pages/TasksPage'
import { useSchedule } from '../hooks/useSchedule'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { modelLabel } from '../lib/format'
import { I18N } from '../lib/i18n'
import { UiHost, UiSurface, useUiPackage } from './UiHost'
import { createRegistry, manifest } from './contract'
import { defaults } from './default'
import * as studio from './studio'
vi.mock('../lib/api', () => ({ api: vi.fn(), apiStream: vi.fn(), apiHeaders: vi.fn() }))
vi.mock('../lib/danger', () => ({ confirmDanger: vi.fn() }))
const t = I18N.en
const surface = 'admin.tasks'
const raw = { enabled: true, repeat: 'manual', prompt: 'Synthetic prompt' }
const fixture = () => ({ enabled: 1, done_count: 1, errors: 0, log: { exists: true }, done_recent: [{ name: 'synthetic-report', path: 'fake/report.txt', size: 12 }], tasks: [{ id: 'alpha', ...raw, raw, reports: [], private_config: 'NEVER_EXPOSE' }], auth: 'NEVER_EXPOSE' })
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { resolve, promise } }
let ui, captured, callbacks
function Controls() { ui = useUiPackage(); return <output data-testid="package">{ui.id}</output> }
function capture(View) { return function Probe(props) { captured = props; return <View {...props}/> } }
function Harness({ initialSection = 'scheduled', pending = false }) {
  const [section, onSection] = useState(initialSection)
  const [busy, setBusy] = useState(false)
  const [message, setMsg] = useState('')
  const scheduleState = useSchedule({ t, lang: 'en', setBusy, setMsg, onOpenSection: onSection })
  useEffect(() => { void scheduleState.loadScheduleTasks() }, []) // Same stable host across package changes.
  return <><Controls/><output data-testid="message">{message}</output><TasksPage t={t} lang="en" section={section} onSection={onSection} schedule={scheduleState.data} scheduleState={scheduleState}
    taskSvcs={[{ name: 'task/fake', kind: 'task', running: false, private_config: 'NEVER_EXPOSE' }]}
    reflectSvcs={[{ name: 'reflect/scheduler', kind: 'reflect', running: false }]}
    llms={[{ index: 7, name: 'Synthetic model', model: 'fake', apikey: 'NEVER_EXPOSE' }]}
    actionStates={{ 'task/fake': pending ? { status: 'pending', message: 'Synthetic pending' } : { status: 'error', action: 'start', message: 'Synthetic failed' } }}
    goals={[{ id: 'fake-goal', objective: 'Synthetic goal', running: true, turns_used: 1, max_turns: 3 }]}
    autonomousReports={[{ name: 'synthetic-auto', path: 'fake/autonomous_reports/auto.txt', size: 4 }]} busy={busy} {...callbacks}/>
    <UiSurface name="admin.overview" viewProps={{}} fallback={<span>default-neighbor</span>}/></>
}
function mount(options = {}) {
  const registry = createRegistry()
  registry.register(defaults.manifest, async () => defaults)
  const Broken = () => { throw new Error('synthetic task surface failure') }
  registry.register(manifest('studio'), async () => ({ ...studio, views: { ...studio.views, [surface]: options.broken ? Broken : capture(studio.views[surface]), 'admin.overview': () => <span>studio-neighbor</span> } }))
  return render(<UiHost preview packageRegistry={registry}><Harness {...options}/></UiHost>)
}
async function select(id) { await act(async () => { await ui.select(id) }); await waitFor(() => expect(screen.getByTestId('package').textContent).toBe(id)) }
const click = label => fireEvent.click(screen.getByRole('button', { name: label, exact: true }))
const nav = label => fireEvent.click(within(document.querySelector('.task-subtabs')).getByRole('button', { name: label, exact: true }))
async function loadTask() { fireEvent.click(await screen.findByRole('button', { name: /alpha/ })); await screen.findByDisplayValue('Synthetic prompt') }
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); captured = null
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden') }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  confirmDanger.mockResolvedValue(true)
  callbacks = Object.fromEntries(['onStart', 'onStop', 'onLogs', 'onAutostart', 'onServiceModel', 'onReflectStart', 'onRefreshGoals', 'onOpenGoal'].map(key => [key, vi.fn()]))
  api.mockImplementation(async (url) => {
    if (url === '/api/schedule/tasks') return fixture()
    if (url.startsWith('/api/schedule/task?')) return { id: 'alpha', raw }
    if (url.startsWith('/api/schedule/artifact?')) return { content: 'Synthetic artifact' }
    if (['/api/schedule/task', '/api/schedule/create', '/api/schedule/delete', '/api/schedule/toggle'].includes(url)) return { task: { id: 'alpha', raw } }
    throw new Error(`Unmocked endpoint ${url}`)
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it.each(['default', 'studio'])('wires edit/save/toggle/create/delete and confirmation in %s', async id => {
  mount(); await screen.findByRole('button', { name: /alpha/ }); await select(id); await loadTask()
  fireEvent.change(screen.getByLabelText(t.tasks.prompt), { target: { value: 'Edited synthetic' } })
  click(t.save)
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/schedule/task', expect.objectContaining({ dangerous: true, method: 'PUT' })))
  expect(JSON.parse(api.mock.calls.find(([url]) => url === '/api/schedule/task')[1].body).raw.prompt).toBe('Edited synthetic')
  await waitFor(() => expect(screen.getByRole('button', { name: t.save, exact: true }).disabled).toBe(false))
  confirmDanger.mockResolvedValueOnce(false); click(t.remove)
  await act(async () => {}); expect(api.mock.calls.some(([url]) => url === '/api/schedule/delete')).toBe(false)
  click(t.disabled)
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/schedule/toggle', expect.objectContaining({ dangerous: true, body: JSON.stringify({ id: 'alpha', enabled: false }) })))
  await waitFor(() => expect(screen.getByRole('button', { name: t.remove, exact: true }).disabled).toBe(false)); click(t.remove)
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/schedule/delete', expect.objectContaining({ dangerous: true })))
  fireEvent.change(screen.getByLabelText(t.hints.newTaskId), { target: { value: 'synthetic-new' } })
  await waitFor(() => expect(screen.getByRole('button', { name: t.create, exact: true }).disabled).toBe(false)); click(t.create)
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/schedule/create', expect.objectContaining({ dangerous: true })))
  expect(confirmDanger.mock.calls.map(([kind]) => kind)).toEqual(expect.arrayContaining(['schedule-save', 'schedule-delete', 'schedule-toggle', 'schedule-create']))
})
it('retains draft, editor mode, section and request count across packages; whitelist is explicit', async () => {
  mount(); await loadTask()
  fireEvent.change(screen.getByLabelText(t.tasks.prompt), { target: { value: 'Retained draft' } })
  fireEvent.change(screen.getByLabelText(t.hints.newTaskId), { target: { value: 'draft-id' } })
  click(t.tasks.json); const count = api.mock.calls.length
  await select('studio')
  expect(document.querySelector('[data-tasks-layout]').dataset.tasksLayout).toBe('studio')
  expect(screen.getByLabelText(t.hints.newTaskId).value).toBe('draft-id')
  expect(document.querySelector('.json-editor').value).toContain('Retained draft')
  expect(JSON.stringify(captured.model)).not.toContain('NEVER_EXPOSE')
  expect(Object.keys(captured)).toEqual(['model', 'actions', 'layout'])
  expect(Object.keys(captured.actions.schedule).sort()).toEqual(['createTask','deleteTask','loadScheduleTasks','loadTask','readArtifact','saveTask','setEditor','setEditorMode','setNewTaskId','toggleTask'].sort())
  expect(captured.model.llms).toEqual([{ index: 7, label: modelLabel({ name: 'Synthetic model', model: 'fake' }) }])
  await select('default'); expect(api.mock.calls.length).toBe(count)
  expect(document.querySelector('.json-editor').value).toContain('Retained draft')
})
it.each(['default', 'studio'])('wires services, reflection, goals and reports in %s', async id => {
  mount({ initialSection: 'services' }); await select(id)
  click(t.start); expect(callbacks.onStart).toHaveBeenCalledWith('task/fake')
  expect(screen.getByRole('button', { name: t.stop, exact: true }).disabled).toBe(true)
  click(t.logs); expect(callbacks.onLogs).toHaveBeenCalledWith('task/fake')
  fireEvent.click(screen.getByRole('checkbox')); expect(callbacks.onAutostart).toHaveBeenCalledWith('task/fake', true)
  expect(screen.getByRole('alert').textContent).toContain('Synthetic failed'); click(t.retry)
  nav(`${t.nav.goals} / ${t.nav.autonomous}`)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '7' } }); expect(callbacks.onServiceModel).toHaveBeenCalledWith('reflect/scheduler', 7)
  click(t.start); expect(callbacks.onReflectStart).toHaveBeenCalledWith('reflect/scheduler')
  click(t.nav.goals); expect(callbacks.onOpenGoal).toHaveBeenCalledWith('')
  click(/Synthetic goal/); expect(callbacks.onOpenGoal).toHaveBeenCalledWith('fake-goal')
  click(t.refresh); expect(callbacks.onRefreshGoals).toHaveBeenCalledOnce()
  click(/synthetic-auto/); await screen.findByText('Synthetic artifact')
  expect(document.querySelector('.task-subtabs .active').textContent).toContain(t.nav.goals)
  nav(t.lists.recentReports); click(/synthetic-report/)
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/schedule/artifact?path=fake%2Freport.txt'))
})
it('retains loading through switch, shows refresh errors and empty retry state', async () => {
  const pending = deferred(); api.mockImplementationOnce(() => pending.promise)
  mount(); expect(document.querySelector('[role="status"]').textContent).toContain(t.busy)
  await select('studio'); expect(api).toHaveBeenCalledTimes(1)
  await act(async () => pending.resolve(fixture())); await screen.findByRole('button', { name: /alpha/ })
  api.mockRejectedValueOnce(new Error('Synthetic refresh error')); click(t.refresh)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Synthetic refresh error')
  api.mockResolvedValueOnce({ tasks: [], errors: [] }); click(t.refresh)
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(document.querySelector('.task-list').textContent).toBe(t.hints.noTasks)
})
it('keeps mutation busy guard, failure feedback, and pending service guard', async () => {
  mount({ pending: true }); await loadTask()
  const pending = deferred(); api.mockImplementationOnce(() => pending.promise)
  click(t.save); await waitFor(() => expect(screen.getByRole('button', { name: t.save, exact: true }).disabled).toBe(true))
  await select('studio'); expect(screen.getByRole('button', { name: t.remove, exact: true }).disabled).toBe(true)
  await act(async () => pending.resolve({})); await waitFor(() => expect(screen.getByRole('button', { name: t.save, exact: true }).disabled).toBe(false))
  api.mockRejectedValueOnce(new Error('Synthetic save failure')); click(t.save)
  await waitFor(() => expect(screen.getByTestId('message').textContent).toBe('Synthetic save failure'))
  nav(t.lists.taskServices); expect(screen.getByRole('button', { name: t.start, exact: true }).disabled).toBe(true)
})
it('keeps the host task request alive while switching packages', async () => {
  mount(); await screen.findByRole('button', { name: /alpha/ })
  const pending = deferred(); api.mockImplementationOnce(() => pending.promise)
  fireEvent.click(screen.getByRole('button', { name: /alpha/ }))
  const count = api.mock.calls.length
  await select('studio')
  await act(async () => pending.resolve({ id: 'alpha', raw }))
  await screen.findByDisplayValue('Synthetic prompt')
  expect(api.mock.calls.length).toBe(count)
  expect(captured.model.editor.taskId).toBe('alpha')
})
it('falls back only task surface and preserves draft and neighbor', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mount({ broken: true }); await loadTask()
  fireEvent.change(screen.getByLabelText(t.tasks.prompt), { target: { value: 'Fallback draft' } })
  const count = api.mock.calls.length; await select('studio')
  await screen.findByText('studio-neighbor')
  expect(document.querySelector('[data-tasks-layout]').dataset.tasksLayout).toBe('default')
  expect(screen.getByLabelText(t.tasks.prompt).value).toBe('Fallback draft')
  expect(api.mock.calls.length).toBe(count)
})
