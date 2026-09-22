import React from 'react'
import './modelProviders.css'

// Presentation only: configuration and secrets remain in the host editor.
function ProviderDirectory({ model, actions, layout }) {
  return <div data-model-providers-layout={layout} className="model-provider-navigation">
    <header><strong>{model.title}</strong><span>{model.providers.length}</span></header>
    <button type="button" className="model-provider-create" onClick={actions.addProvider}><span aria-hidden="true">+ </span>{model.addLabel}</button>
    <div className="model-provider-navigation-list" aria-label={model.title}>
      {model.providers.map(provider => <div className="model-provider-nav-entry" key={provider.id}>
        <button type="button" className="model-provider-nav-select" aria-pressed={model.selectedId === provider.id} onClick={() => actions.openProvider(provider.id)}>
          <span><strong>{provider.name}</strong><small>{provider.protocol} · {provider.modelCount}</small></span>
          <i className={`is-${provider.state}`} title={provider.stateLabel}/>
        </button>
        <div className="model-provider-direct-actions">
          <button type="button" onClick={() => actions.openProvider(provider.id)}>{model.editLabel}</button>
          {actions.addModel && <button type="button" onClick={() => actions.addModel(provider.id)}>{model.addModelLabel}</button>}
          {actions.removeProvider && <button type="button" className="model-provider-delete" onClick={() => actions.removeProvider(provider.id)}>{model.deleteLabel}</button>}
        </div>
      </div>)}
      {!model.providers.length && <p className="model-hint-block">{model.emptyLabel}</p>}
    </div>
  </div>
}
export function DefaultModelProviders(props) { return <ProviderDirectory {...props} layout="default"/> }
export function StudioModelProviders(props) { return <ProviderDirectory {...props} layout="studio"/> }
