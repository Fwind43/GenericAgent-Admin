import { Eye, Power } from 'lucide-react'

const statusLabel = (task, t) => {
  if (task.error) return t.error
  if (task.status) return task.status
  return task.enabled ? t.enabled : t.disabled
}

export function TaskRow({ task, t, onToggle, onEdit, onArtifact }) {
  const id = task.id || task.name || t.tasks.unnamed
  const status = statusLabel(task, t)
  return (
    <div className={`task-row status-${String(status).toLowerCase()}`}>
      <div>
        <b>{id}</b>
        <span>{task.schedule || t.tasks.unscheduled} - {task.repeat || t.tasks.manual} - <b className="status-badge">{status}</b></span>
        {!task.enabled && !task.error && <em className="muted">{t.tasks.explicitEnable}</em>}
        {task.error && <em className="err-text">{task.error}</em>}
        {task.next_hint && <em>{task.next_hint}</em>}
        <p>{task.prompt || t.empty}</p>
        {task.recent_reports?.length > 0 && <div className="mini-reports">{task.recent_reports.map((r, idx)=><button key={r.path || r.name || idx} onClick={()=>onArtifact(r.path)} disabled={!r.path}>{r.name || r.path || t.tasks.report}</button>)}</div>}
        <div className="actions">
          <button onClick={()=>onEdit(id)}><Eye size={14}/>{t.read}</button>
          <button onClick={()=>onToggle(id, !task.enabled)}><Power size={14}/>{task.enabled ? t.disabled : t.enabled}</button>
        </div>
      </div>
    </div>
  )
}
