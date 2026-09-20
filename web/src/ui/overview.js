// Never expose raw config, inventory, paths, HTTP clients or arbitrary setters.
export function overviewModel({ services = [], schedule = {}, observability, observabilityError = '' }) {
  return {
    services: services.map(s => ({ name: String(s.name || ''), running: !!s.running })),
    schedule: { total: Number(schedule.task_count ?? schedule.tasks?.length) || 0, enabled: Number(schedule.tasks?.filter(t => t.enabled).length) || 0, due: Number(schedule.due_count) || 0 },
    health: observabilityError ? 'error' : !observability ? 'pending' : observability.ok ? 'ok' : 'attention',
    checks: (observability?.checks || []).map(c => ({ name: String(c.name || ''), ok: c.state === 'ok' || c.state === 'optional_missing' })),
    updatedAt: String(observability?.generatedAt || ''),
    error: observabilityError ? 'Snapshot unavailable. Retry from the host.' : '',
  }
}
export const previewOverview = { services: [{name: 'Example scheduler', running: true}, {name: 'Example assistant', running: true}, {name: 'Example integration', running: false}], schedule: {total: 7, enabled: 5, due: 1}, health: 'attention', checks: [{name:'Example workspace',ok:true},{name:'Example integration',ok:false}], updatedAt: '', error: '' }
