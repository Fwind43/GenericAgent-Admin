// Host-only projection. API catalog/error strings are not trusted display data.
// Exact static tuples audited against internal/api/api.go; new/changed entries stay
// in host detail rendering until explicitly reviewed. Never infer safety from type.
const catalog = [
  {
    "path": "/api/models",
    "level": "dangerous",
    "action": "save_model_draft",
    "reason": "writes GA Admin model draft profiles, including provider endpoints and credentials when supplied"
  },
  {
    "path": "/api/models/raw",
    "level": "dangerous",
    "action": "reveal_model_secrets",
    "reason": "returns unmasked model provider credentials after explicit dangerous authorization"
  },
  {
    "path": "/api/models/import-mykey",
    "level": "dangerous",
    "action": "import_mykey_models",
    "reason": "can execute mykey import and reveal or persist provider credentials when explicitly authorized"
  },
  {
    "path": "/api/models/discover",
    "level": "reversible",
    "action": "discover_provider_models",
    "reason": "queries the selected provider models endpoint without saving configuration"
  },
  {
    "path": "/api/models/export",
    "level": "dangerous",
    "action": "export_models",
    "reason": "writes active GA model configuration"
  },
  {
    "path": "/api/models/title-model",
    "level": "reversible",
    "action": "set_chat_title_model",
    "reason": "changes the model used for chat title generation"
  }
]
const gates = ['/api/models/export', '/api/models/import-mykey']
const labelKeys = ['riskTitle', 'riskReady', 'riskUnavailable', 'riskEmpty', 'riskHelp']
export function modelRiskView(risk, summary, text) {
  const safeItems = []
  const retained = []
  risk.items.forEach((item, index) => {
    const known = catalog.find(entry => item.route === entry.path && item.method === 'GET'
      && ['level', 'action', 'reason'].every(key => item[key] === entry[key]))
    if (known) safeItems.push({ id: index, path: known.path, method: 'GET', level: known.level, action: known.action, reason: known.reason })
    else retained.push({ index, item })
  })
  const missingGates = risk.missingConfirmedWriteRoutes.filter(path => gates.includes(path))
  return {
    view: {
      labels: {
        ...Object.fromEntries(labelKeys.map(key => [key, text[key]])),
        missingGates: text.missingGates(missingGates.join(', ')),
        errors: text.blockItems(summary.errors),
        warnings: text.reminders(summary.warnings),
      },
      items: safeItems,
      hostItemCount: retained.length,
      total: risk.items.length,
      missingGates,
      unavailable: risk.status === 'error',
      errors: summary.errors,
      warnings: summary.warnings,
    },
    retained,
  }
}
