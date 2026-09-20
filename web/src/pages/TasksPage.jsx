import React, { useState } from 'react'
import { normalizeScheduleTasksPayload } from '../lib/schedule'
import { modelLabel } from '../lib/format'
import { UiSurface } from '../ui/UiHost'
import { DefaultTasks } from '../ui/tasks'
export { TaskFormEditor } from '../ui/tasks'

const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key]]))
const report = value => pick(value, ['path', 'name', 'size', 'mod_time'])
const service = value => pick(value, ['name', 'kind', 'running', 'autostart', 'model_no', 'pid', 'returncode', 'return_code', 'started_at', 'workdir', 'command', 'log_path', 'log'])
const task = value => ({ ...pick(value, ['id', 'name', 'enabled', 'schedule', 'repeat', 'status', 'prompt', 'path', 'next_run', 'last_run', 'result_file']), reports: (value.reports || []).map(report) })

export function TasksPage({
  t, lang, section, onSection, schedule, scheduleState, taskSvcs, reflectSvcs, llms,
  actionStates, onStart, onStop, onLogs, onAutostart, onServiceModel, onReflectStart,
  goals, onRefreshGoals, onOpenGoal, autonomousReports, busy,
}) {
  const [serviceId, setServiceId] = useState('')
  const [runtimeId, setRuntimeId] = useState('')
  const tasks = normalizeScheduleTasksPayload(schedule).tasks.map(task)
  const model = {
    t: {
      ...pick(t, ['running', 'stopped', 'start', 'stop', 'logs', 'autostartService', 'retry', 'enabled', 'disabled', 'error', 'create', 'refresh', 'busy', 'empty', 'save', 'remove']),
      tasks: pick(t.tasks, ['parseFailed', 'enabledLabel', 'maxDelay', 'repeat', 'choose', 'schedule', 'schedulePlaceholder', 'prompt', 'promptPlaceholder', 'extraFields', 'result', 'report', 'reports', 'lastRun', 'form', 'json', 'formHelp']),
      lists: pick(t.lists, ['taskServices', 'scheduledTasks', 'recentReports', 'editor', 'reflectServices', 'generatedPreview']),
      cards: pick(t.cards, ['enabledTasks', 'reports']), nav: pick(t.nav, ['goals', 'autonomous', 'logs']),
      hints: pick(t.hints, ['noTasks', 'noReflect', 'newTaskId', 'jsonHelp']),
      fields: pick(t.fields, ['pid', 'notRunning', 'turn']),
      service: pick(t.service, ['defaultModel', 'model', 'returnCode', 'startedAt', 'workdir', 'command', 'log']),
      serviceDesc: pick(t.serviceDesc, ['scheduler', 'autonomous']),
    },
    lang, section, busy, serviceId, runtimeId, tasks,
    selectedTask: tasks.find(item => item.id === scheduleState.taskId),
    schedule: { ...pick(schedule, ['enabled', 'done_count', 'errors']), log: { exists: !!schedule?.log?.exists }, done_recent: (schedule?.done_recent || []).map(report) },
    editor: pick(scheduleState, ['taskId', 'editor', 'dirty', 'newTaskId', 'editorMode', 'artifact', 'artifactTitle', 'loading', 'error']),
    taskSvcs: taskSvcs.map(service), reflectSvcs: reflectSvcs.map(service),
    llms: llms.map(item => ({ index: item.index, label: modelLabel(item) })),
    actionStates: Object.fromEntries([...taskSvcs, ...reflectSvcs].map(item => [item.name, pick(actionStates?.[item.name], ['status', 'message', 'action'])])),
    goals: goals.map(item => pick(item, ['id', 'objective', 'running', 'status', 'pid', 'turns_used', 'max_turns'])),
    runningGoals: goals.filter(item => item.running).length, autonomousReports: autonomousReports.map(report),
  }
  const actions = {
    onSection, onStart, onStop, onLogs, onAutostart, onServiceModel, onReflectStart, onRefreshGoals, onOpenGoal, setServiceId, setRuntimeId,
    schedule: {
      setNewTaskId: scheduleState.setNewTaskId, setEditor: scheduleState.setEditor, setEditorMode: scheduleState.setEditorMode,
      createTask: () => scheduleState.createTask(), loadScheduleTasks: () => scheduleState.loadScheduleTasks().catch(() => {}),
      loadTask: id => scheduleState.loadTask(id), toggleTask: (id, enabled) => scheduleState.toggleTask(id, enabled),
      saveTask: () => scheduleState.saveTask(), deleteTask: () => scheduleState.deleteTask(),
      readArtifact: (path, options) => scheduleState.readArtifact(path, options),
    },
  }
  const props = { model, actions }
  return <UiSurface name="admin.tasks" viewProps={props} fallback={<DefaultTasks {...props}/>}/>
}
export default TasksPage
