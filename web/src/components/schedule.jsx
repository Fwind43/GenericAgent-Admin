// The index is deliberately a summary. Prompt, reports and mutation actions live
// in the selected detail; the entire row is a keyboard-accessible selection.
export function TaskRow({ task, t, selected, disabled, onEdit }) {
  const id = task.id
  return <button type="button" disabled={disabled} className={`task-summary ${selected ? 'is-selected' : ''}`} aria-pressed={!!selected} onClick={() => onEdit(id)}>
    <span className="task-summary-heading"><strong>{id}</strong><span className={`pill ${task.enabled ? 'running' : 'stopped'}`}>{task.enabled ? t.enabled : t.disabled}</span></span>
    <span className="task-summary-meta">{task.repeat || 'manual'}{task.schedule ? ` · ${task.schedule}` : ''}</span>
    <span className="task-summary-prompt">{task.prompt || t.empty}</span>
    <span className="task-summary-meta">{t.tasks.reports}: {task.reports?.length || 0}{task.last_run ? ` · ${t.tasks.lastRun}: ${task.last_run}` : ''}</span>
  </button>
}
