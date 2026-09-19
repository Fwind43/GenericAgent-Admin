import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { safeJson } from '../lib/format'
import { DEFAULT_SCHEDULE_TASK, buildScheduleCreateRequest, normalizeScheduleTasksPayload } from '../lib/schedule'

// sche_tasks state: the task index, the JSON editor buffer, and the report
// artifact viewer. Writes are confirm-gated and the backend keeps .bak copies.
export function useSchedule({ t, lang, setMsg, setBusy, onOpenSection }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [taskId, setTaskId] = useState('')
  const [editor, setEditor] = useState('{}')
  const [savedEditor, setSavedEditor] = useState('')
  const editorRef = useRef(editor)
  editorRef.current = editor
  const dirty = !!taskId && editor !== savedEditor
  const discardDraft = () => !dirty || window.confirm(lang === 'zh' ? '切换将放弃未保存的任务草稿，继续？' : 'Discard unsaved task edits and continue?')
  useEffect(() => {
    if (!dirty) return
    const warn = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const [newTaskId, setNewTaskId] = useState('new_task')
  const [editorMode, setEditorMode] = useState('form')
  const [artifactTitle, setArtifactTitle] = useState('')
  const [artifact, setArtifact] = useState('')

  const loadScheduleTasks = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    setError('')
    try {
      const d = await api('/api/schedule/tasks')
      const normalized = normalizeScheduleTasksPayload(d)
      setData(normalized)
      return normalized
    } catch (e) {
      setData({ enabled: false, version: 'unknown', tasks: [] })
      setError(e.message)
      if (!quiet) setMsg(e.message)
      throw e
    } finally {
      if (!quiet) setLoading(false)
    }
  }

  const toggleTask = async (id, enabled) => {
    if (!await confirmDanger('schedule-toggle', lang === 'zh' ? `${enabled ? '启用' : '停用'}计划任务 ${id}？` : `${enabled ? 'Enable' : 'Disable'} scheduled task ${id}?`)) return
    setBusy(true)
    try {
      await api('/api/schedule/toggle', { dangerous:true, method:'POST', body: JSON.stringify({ id, enabled }) })
      setMsg(t.hints.taskToggled)
      await loadScheduleTasks({ quiet: true })
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const loadTask = async (id) => {
    if (id === taskId || !discardDraft()) return
    const previousEditor = editorRef.current
    setBusy(true)
    try {
      const d = await api(`/api/schedule/task?id=${encodeURIComponent(id)}`)
      if (editorRef.current !== previousEditor) return
      setTaskId(d.id || id)
      setEditor(safeJson(d.raw))
      setSavedEditor(safeJson(d.raw))
      onOpenSection?.('scheduled')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const saveTask = async () => {
    const id = taskId || newTaskId
    if (!await confirmDanger('schedule-save', lang === 'zh' ? `保存定时任务 ${id}？后端会写入 JSON 并生成备份。` : `Save scheduled task ${id}? The backend writes JSON and creates a backup.`)) return
    setBusy(true)
    try {
      const submittedEditor = editor
      const raw = JSON.parse(submittedEditor)
      await api('/api/schedule/task', { dangerous:true, method:'PUT', body: JSON.stringify({ id, raw }) })
      setSavedEditor(submittedEditor)
      setMsg(t.hints.taskSaved)
      await loadScheduleTasks({ quiet: true })
      onOpenSection?.('scheduled')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const createTask = async () => {
    if (!discardDraft()) return
    const id = newTaskId.trim()
    if (!id) { setMsg('Schedule task id is required'); return }
    if (!await confirmDanger('schedule-create', `Create schedule task ${id}? This writes a sche_tasks JSON file.`)) return
    setBusy(true)
    try {
      const payload = buildScheduleCreateRequest(id, DEFAULT_SCHEDULE_TASK)
      const d = await api('/api/schedule/create', { dangerous:true, method:'POST', body: JSON.stringify(payload) })
      const created = d.task || DEFAULT_SCHEDULE_TASK
      setTaskId(created.id || id)
      setEditor(safeJson(created.raw || payload.task))
      setSavedEditor(safeJson(created.raw || payload.task))
      setMsg(t.hints.taskSaved)
      await loadScheduleTasks()
      onOpenSection?.('scheduled')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const deleteTask = async () => {
    if (!taskId) return
    if (!await confirmDanger('schedule-delete', lang === 'zh' ? `删除定时任务 ${taskId}？后端会先生成备份。` : `Delete scheduled task ${taskId}? The backend creates a backup first.`)) return
    setBusy(true)
    try {
      await api('/api/schedule/delete', { dangerous:true, method:'POST', body: JSON.stringify({ id: taskId }) })
      setMsg(t.hints.taskDeleted)
      setTaskId('')
      setEditor('{}')
      await loadScheduleTasks({ quiet: true })
      onOpenSection?.('scheduled')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  // `section` is null for artifacts that are previewed in place (autonomous
  // reports live next to the goal list rather than on the reports section).
  const readArtifact = async (path, { section = 'reports' } = {}) => {
    setBusy(true)
    try {
      const d = await api(`/api/schedule/artifact?path=${encodeURIComponent(path)}`)
      setArtifactTitle(path)
      setArtifact(d.content || '')
      if (section) onOpenSection?.(section)
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  return {
    data, setData, loading, error,
    taskId, editor, setEditor, dirty, newTaskId, setNewTaskId, editorMode, setEditorMode,
    artifact, artifactTitle,
    loadScheduleTasks, toggleTask, loadTask, saveTask, createTask, deleteTask, readArtifact,
  }
}
