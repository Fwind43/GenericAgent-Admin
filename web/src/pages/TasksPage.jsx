import React, { useState } from 'react'
import { Activity, CalendarClock, Code2, FileCode2, FolderCog, RefreshCw, Save, Server, ShieldAlert, SlidersHorizontal, Target, Terminal, XCircle } from 'lucide-react'
import { Panel, ServiceRow } from '../components/common'
import { TaskRow } from '../components/schedule'
import { normalizeScheduleTasksPayload } from '../lib/schedule'

import './tasks-workbench.css'

const KNOWN_TASK_FIELDS = ['enabled','max_delay_hours','repeat','schedule','prompt']

export function TaskFormEditor({ value, onChange, t }) {
  const text = t.tasks
  let data
  try { data = JSON.parse(value) } catch { data = null }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return <textarea className="json-editor compact-editor" value={value} placeholder={text.parseFailed} onChange={e=>onChange(e.target.value)}/>
  }
  const updateField = (key, val) => onChange(JSON.stringify({ ...data, [key]: val }, null, 2))
  const extraKeys = Object.keys(data).filter(k => !KNOWN_TASK_FIELDS.includes(k))
  const repeatOptions = ['manual','daily','weekly','every_2h','every_4h','every_6h','every_8h','every_12h','once']

  return <div className="schedule-form-editor">
    <div className="form-field">
      <label>{text.enabledLabel}</label>
      <label className="toggle-switch">
        <input type="checkbox" checked={!!data.enabled} onChange={e => updateField('enabled', e.target.checked)} />
        <span className="toggle-slider"></span>
        <span className="toggle-label">{data.enabled ? t.enabled : t.disabled}</span>
      </label>
    </div>
    <div className="form-field">
      <label>{text.maxDelay}</label>
      <input type="number" aria-label={text.maxDelay} value={data.max_delay_hours ?? ''} onChange={e => updateField('max_delay_hours', e.target.value ? parseInt(e.target.value, 10) : 0)} />
    </div>
    <div className="form-field">
      <label>{text.repeat}</label>
      <select aria-label={text.repeat} value={data.repeat || ''} onChange={e => updateField('repeat', e.target.value)}>
        <option value="">{text.choose}</option>
        {repeatOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
    <div className="form-field">
      <label>{text.schedule}</label>
      <input type="text" aria-label={text.schedule} value={data.schedule || ''} onChange={e => updateField('schedule', e.target.value)} placeholder={text.schedulePlaceholder}/>
    </div>
    <div className="form-field">
      <label>{text.prompt}</label>
      <textarea aria-label={text.prompt} value={data.prompt || ''} onChange={e => updateField('prompt', e.target.value)} placeholder={text.promptPlaceholder}/>
    </div>
    {extraKeys.length > 0 && <details className="extra-fields">
      <summary>{text.extraFields} ({extraKeys.length})</summary>
      <pre>{JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k]) => !KNOWN_TASK_FIELDS.includes(k))), null, 2)}</pre>
    </details>}
  </div>
}

export function TasksPage({
  t, lang, section, onSection, schedule, scheduleState, taskSvcs, reflectSvcs, llms,
  actionStates, onStart, onStop, onLogs, onAutostart, onServiceModel, onReflectStart,
  goals, onRefreshGoals, onOpenGoal, autonomousReports, busy,
}) {
  const tasks = normalizeScheduleTasksPayload(schedule).tasks
  const [serviceId, setServiceId] = useState('')
  const [runtimeId, setRuntimeId] = useState('')
  const selectedTask = tasks.find(task => task.id === scheduleState.taskId)
  const serviceIndex = (items, selected, select) => <div className="service-master-detail">
    <div className="service-index" aria-label={t.lists.taskServices}>
      {items.map(svc => <button type="button" key={svc.name} aria-pressed={(selected || items[0]?.name) === svc.name} onClick={() => select(svc.name)}><strong>{svc.name}</strong><small>{svc.running ? t.running : t.stopped}</small></button>)}
    </div>
    <div className="service-selected">{items.filter(svc => svc.name === (items.some(item => item.name === selected) ? selected : items[0]?.name)).map(svc => <ServiceRow key={svc.name} svc={svc} t={t} llms={llms} actionState={actionStates[svc.name]} onStart={onStart} onStop={onStop} onLogs={onLogs} onAutostart={onAutostart} onModel={onServiceModel} onReflectStart={onReflectStart}/>)}</div>
  </div>
  const runningGoals = goals.filter(g => g.running).length
  const sections = [
    ['services', <Server key="i" size={14}/>, t.lists.taskServices],
    ['scheduled', <CalendarClock key="i" size={14}/>, t.lists.scheduledTasks],
    ['runs', <Target key="i" size={14}/>, `${t.nav.goals} / ${t.nav.autonomous}`],
    ['reports', <FolderCog key="i" size={14}/>, t.lists.recentReports],
  ]

  return <section className="tasks-page tasks-desktop-workbench">
    <div className="stats schedule-stats">
      <div className="stat"><Activity/><span>{t.lists.taskServices}</span><b>{taskSvcs.length}</b></div>
      <div className="stat"><CalendarClock/><span>{t.cards.enabledTasks || t.enabled}</span><b>{schedule.enabled || 0}</b></div>
      <div className="stat"><FolderCog/><span>{t.cards.reports}</span><b>{schedule.done_count || 0}</b></div>
      <div className="stat"><Target/><span>{t.nav.goals}</span><b>{runningGoals}/{goals.length}</b></div>
      <div className="stat"><ShieldAlert/><span>{t.error}</span><b>{schedule.errors || 0}</b></div>
    </div>

    <div className="subtabs task-subtabs" role="navigation" aria-label={lang === 'zh' ? '任务分类' : 'Task sections'}>
      {sections.map(([id, sectionIcon, label]) => <button key={id} type="button" aria-current={section===id ? 'page' : undefined} className={section===id ? 'active' : ''} onClick={()=>onSection(id)}>{sectionIcon}{label}</button>)}
    </div>

    {section==='services' && <div className="single-panel">
      <Panel title={t.lists.taskServices}>
        <div className="service-list clean-list">
          {taskSvcs.length
            ? serviceIndex(taskSvcs, serviceId, setServiceId)
            : <p className="muted">{t.hints.noTasks}</p>}
        </div>
      </Panel>
    </div>}

    {section==='scheduled' && <div className="workspace tasks-workspace">
      <Panel title={t.lists.scheduledTasks}>
        <div className="task-create">
          <div className="task-create-input-row">
            <input aria-label={t.hints.newTaskId} value={scheduleState.newTaskId} onChange={e=>scheduleState.setNewTaskId(e.target.value)} placeholder={t.hints.newTaskId}/>
          </div>
          <div className="task-create-btn-row">
            <button onClick={scheduleState.createTask} disabled={busy || !scheduleState.newTaskId.trim()}><FileCode2 size={14}/>{t.create}</button>
            <button onClick={()=>scheduleState.loadScheduleTasks()} disabled={scheduleState.loading}><RefreshCw size={14}/>{t.refresh}</button>
            {schedule.log?.exists && <button onClick={()=>scheduleState.readArtifact('sche_tasks/scheduler.log')}><Terminal size={14}/>{t.nav.logs}</button>}
          </div>
        </div>
        {scheduleState.error && <p className="err-text" role="alert">{scheduleState.error}</p>}
        <div className="task-list clean-list" aria-busy={scheduleState.loading}>
          {scheduleState.loading
            ? <p className="muted" role="status">{t.busy}</p>
            : tasks.length
              ? tasks.map((task, idx) => <TaskRow key={task.id || task.name || idx} task={task} t={t} selected={task.id === scheduleState.taskId} disabled={busy} onEdit={scheduleState.loadTask}/>)
              : <p className="muted">{t.hints.noTasks}</p>}
        </div>
      </Panel>
      <Panel title={`${t.lists.editor} · ${scheduleState.taskId || t.empty}`}>
        {selectedTask && <>
          <div className="task-detail-meta"><code>{selectedTask.path}</code><span>{selectedTask.next_run || selectedTask.schedule}</span></div>
          <div className="task-report-links">
            {selectedTask.result_file && <button onClick={() => scheduleState.readArtifact(selectedTask.result_file)}>{t.tasks.result}</button>}
            {(selectedTask.reports || []).map((r, i) => <button key={r.path || i} disabled={!r.path} onClick={() => scheduleState.readArtifact(r.path)}>{r.name || r.path || t.tasks.report}</button>)}
            <button disabled={busy} onClick={() => scheduleState.toggleTask(selectedTask.id, !selectedTask.enabled)}>{selectedTask.enabled ? t.disabled : t.enabled}</button>
          </div>
        </>}
        {scheduleState.dirty && <p role="status" className="task-draft-status">{lang === 'zh' ? '未保存草稿' : 'Unsaved draft'}</p>}
        <div className="editor-mode-toggle">
          <button aria-pressed={scheduleState.editorMode==='form'} className={scheduleState.editorMode==='form' ? 'active' : ''} onClick={()=>scheduleState.setEditorMode('form')}><SlidersHorizontal size={14}/>{t.tasks.form}</button>
          <button aria-pressed={scheduleState.editorMode==='json'} className={scheduleState.editorMode==='json' ? 'active' : ''} onClick={()=>scheduleState.setEditorMode('json')}><Code2 size={14}/>{t.tasks.json}</button>
        </div>
        <p className="muted">{scheduleState.editorMode==='json' ? t.hints.jsonHelp : t.tasks.formHelp}</p>
        {scheduleState.editorMode==='json'
          ? <textarea className="json-editor compact-editor" value={scheduleState.editor} onChange={e=>scheduleState.setEditor(e.target.value)}/>
          : <TaskFormEditor value={scheduleState.editor} onChange={scheduleState.setEditor} t={t}/>}
        <div className="actions">
          <button className="primary" onClick={scheduleState.saveTask} disabled={busy || (!scheduleState.taskId && !scheduleState.newTaskId)}><Save size={14}/>{t.save}</button>
          <button className="danger" onClick={scheduleState.deleteTask} disabled={busy || !scheduleState.taskId}><XCircle size={14}/>{t.remove}</button>
        </div>
      </Panel>
    </div>}

    {section==='runs' && <div className="workspace tasks-workspace">
      <Panel title={`${t.nav.goals} · ${runningGoals}/${goals.length}`}>
        <div className="actions"><button onClick={()=>onOpenGoal('')}><Target size={14}/>{t.nav.goals}</button><button onClick={onRefreshGoals}><RefreshCw size={14}/>{t.refresh}</button></div>
        <div className="goal-list compact-goals">
          {goals.length
            ? goals.map(g => <button className="goal-row" key={g.id} onClick={()=>onOpenGoal(g.id)}><div><b>{g.objective || g.id}</b><span>{g.status || '-'} · {g.running ? `${t.fields.pid} ${g.pid}` : t.fields.notRunning}</span></div><small>{t.fields.turn} {g.turns_used || 0}/{g.max_turns || '-'}</small></button>)
            : <p className="muted">{t.empty}</p>}
        </div>
      </Panel>
      <Panel title={t.lists.reflectServices}>
        {reflectSvcs.length
          ? serviceIndex(reflectSvcs, runtimeId, setRuntimeId)
          : <p className="muted">{t.hints.noReflect}</p>}
      </Panel>
      <Panel title={`${t.nav.autonomous} · ${t.lists.recentReports}`}>
        <div className="report-list">
          {autonomousReports.length
            ? autonomousReports.map(r=><button key={r.path} className={scheduleState.artifactTitle===r.path ? 'active' : ''} onClick={()=>scheduleState.readArtifact(r.path, { section: null })}>{r.name}<small>{new Date(r.mod_time).toLocaleString()}</small></button>)
            : <p className="muted">{t.empty}</p>}
        </div>
        <pre className="artifact-view">{scheduleState.artifactTitle?.includes('autonomous_reports') ? (scheduleState.artifact || t.empty) : t.empty}</pre>
      </Panel>
    </div>}

    {section==='reports' && <div className="workspace tasks-workspace">
      <Panel title={t.lists.recentReports}>
        <div className="report-list clean-list">
          {(schedule.done_recent || []).length
            ? (schedule.done_recent || []).map(r => <button key={r.path} className={scheduleState.artifactTitle===r.path ? 'active' : ''} onClick={()=>scheduleState.readArtifact(r.path)}>{r.name}<small>{new Date(r.mod_time).toLocaleString()}</small></button>)
            : <p className="muted">{t.empty}</p>}
        </div>
      </Panel>
      <Panel title={scheduleState.artifactTitle || t.lists.generatedPreview}>
        <pre className="artifact-view">{scheduleState.artifact || t.empty}</pre>
      </Panel>
    </div>}
  </section>
}

export default TasksPage
