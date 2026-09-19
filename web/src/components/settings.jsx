import React from 'react'

// Layout primitives for the settings surface. Every settings page is a stack of
// cards, and every card is a list of rows that pair a label with one control,
// so unrelated pages stay visually consistent without sharing state.

// `settings-page` keeps the shared page width, input theming, and dark-mode
// overrides that already exist for the settings surface.
export function SettingsPage({ children, className = '' }) {
  return <div className={`settings-page set-page ${className}`.trim()}>{children}</div>
}

export function SettingsSection({ title, description = '', icon = null, actions = null, children, className = '', id, hidden = false }) {
  return <section id={id} hidden={hidden} className={`set-card ${className}`.trim()}>
    <header className="set-card-head">
      {icon && <span className="set-card-icon" aria-hidden="true">{icon}</span>}
      <div className="set-card-copy">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="set-card-actions">{actions}</div>}
    </header>
    <div className="set-card-body">{children}</div>
  </section>
}

export function SettingRow({ label, hint = '', htmlFor = '', stacked = false, children }) {
  return <div className={`set-row${stacked ? ' is-stacked' : ''}`}>
    <div className="set-row-copy">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="set-row-label">{label}</span>}
      {hint && <small>{hint}</small>}
    </div>
    <div className="set-row-control">{children}</div>
  </div>
}

export function SettingToggle({ id, checked, disabled = false, onChange, label, hint = '', onText = '', offText = '' }) {
  return <div className="set-row set-row-toggle">
    <label className="set-toggle" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="set-toggle-track" aria-hidden="true"><span className="set-toggle-knob"/></span>
      <span className="set-row-copy"><span className="set-row-label">{label}</span>{hint && <small>{hint}</small>}</span>
    </label>
    {(onText || offText) && <span className={`settings-toggle-state set-state ${checked ? 'is-on' : 'is-off'}`}>{checked ? onText : offText}</span>}
  </div>
}

export function SettingNote({ tone = 'info', icon = null, children }) {
  return <p className={`set-note is-${tone}`}>{icon}<span>{children}</span></p>
}

export function SettingFooter({ children }) {
  return <div className="set-card-footer">{children}</div>
}

export function SettingStat({ label, value, tone = '' }) {
  return <div className={`set-stat ${tone}`.trim()}><span>{label}</span><b>{value}</b></div>
}
