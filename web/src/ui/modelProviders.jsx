import React from 'react'
import './modelProviders.css'

function ProviderActions({ provider, model, actions }) {
  return <div className="model-provider-direct-actions">
    <button type="button" onClick={() => actions.openProvider(provider.id)}>{model.editLabel}</button>
    {actions.addModel && <button type="button" onClick={() => actions.addModel(provider.id)}>{model.addModelLabel}</button>}
    {actions.removeProvider && <button type="button" className="model-provider-delete" onClick={() => actions.removeProvider(provider.id)}>{model.deleteLabel}</button>}
  </div>
}

// Presentation only. All editing, confirmation and IO remain in Models.
export function DefaultModelProviders({ model, actions }) {
  return <div data-model-providers-layout="default">
    <header className="model-connections-head">
      <div><strong>{model.title}</strong><span>{model.help}</span></div>
      <button type="button" onClick={actions.addProvider}>{model.addLabel}</button>
    </header>
    <div className="model-connection-grid" tabIndex={0} aria-label={model.title}>
      {model.providers.map(provider => <div key={provider.id} className="model-provider-entry"><button type="button"
        className={`model-connection-card is-${provider.state}`} onClick={() => actions.openProvider(provider.id)}>
        <span className="model-connection-title"><strong>{provider.name}</strong><i className={`is-${provider.state}`} title={provider.stateLabel}/></span>
        <span className="model-connection-base">{provider.endpoint}</span>
        <span className="model-connection-meta"><em>{provider.protocol}</em><b>{provider.modelCount}</b></span>
        <span className="model-directory-status">{provider.stateLabel}</span>
      </button><ProviderActions provider={provider} model={model} actions={actions}/></div>)}
      {!model.providers.length && <div className="model-hint-block">{model.emptyLabel}</div>}
    </div>
  </div>
}

export function StudioModelProviders({ model, actions }) {
  return <div className="studio-model-directory" data-model-providers-layout="studio">
    <aside><h2>{model.title}</h2><p>{model.help}</p><button type="button" onClick={actions.addProvider}>{model.addLabel}</button></aside>
    <div className="studio-model-directory-scroll" tabIndex={0} aria-label={model.title}>
      {model.providers.length ? <table>
        <caption>{model.title}</caption>
        <thead><tr><th scope="col">{model.columns.name}</th><th scope="col">{model.columns.endpoint}</th><th scope="col">{model.columns.protocol}</th><th scope="col">{model.columns.models}</th></tr></thead>
        <tbody>{model.providers.map(provider => <tr key={provider.id}>
          <th scope="row"><button type="button" onClick={() => actions.openProvider(provider.id)}>{provider.name}</button><small className={`model-directory-status is-${provider.state}`}>{provider.stateLabel}</small></th>
          <td>{provider.endpoint}</td><td>{provider.protocol}</td><td>{provider.modelCount}<ProviderActions provider={provider} model={model} actions={actions}/></td>
        </tr>)}</tbody>
      </table> : <p className="model-hint-block">{model.emptyLabel}</p>}
    </div>
  </div>
}
