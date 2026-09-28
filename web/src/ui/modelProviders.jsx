import React from 'react'
import { GripVertical } from 'lucide-react'
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import './modelProviders.css'

function SortableProvider({ provider, disabled, reorderLabel, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: provider.id, disabled })
  return <div ref={setNodeRef} className="model-provider-nav-entry" style={{ transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 1 : undefined, opacity: isDragging ? 0.7 : 1 }} role="group">
    <button type="button" ref={setActivatorNodeRef} className="model-provider-drag-handle" {...attributes} {...listeners} disabled={disabled} aria-label={`${reorderLabel}: ${provider.name}`} title={reorderLabel}><GripVertical size={16} aria-hidden="true"/></button>
    {children}
  </div>
}

// Presentation only: configuration and secrets remain in the host editor.
function ProviderDirectory({ model, actions, layout }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 350, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const reorder = ({ active, over }) => {
    if (over && active.id !== over.id && !model.reorderingDisabled) actions.reorderProviders?.(active.id, over.id)
  }
  return <div data-model-providers-layout={layout} className="model-provider-navigation">
    <header><strong>{model.title}</strong><span>{model.providers.length}</span></header>
    <button type="button" className="model-provider-create" onClick={actions.addProvider}><span aria-hidden="true">+ </span>{model.addLabel}</button>
    {model.reorderHelp && model.providers.length > 1 && <p className="model-provider-reorder-help">{model.reorderHelp}</p>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
    <SortableContext items={model.providers.map(provider => provider.id)} strategy={verticalListSortingStrategy}>
    <div className="model-provider-navigation-list" role="navigation" aria-label={model.title}>
      {model.providers.map(provider => <SortableProvider key={provider.id} provider={provider} disabled={model.reorderingDisabled || !actions.reorderProviders || model.providers.length < 2} reorderLabel={model.reorderLabel}>
        <button type="button" className="model-provider-nav-select" aria-pressed={model.selectedId === provider.id} onClick={() => actions.openProvider(provider.id)}>
          <span><strong>{provider.name}</strong><small>{provider.protocol} · {provider.modelCount}</small></span>
          <i className={`is-${provider.state}`} title={provider.stateLabel}/>
        </button>
        <div className="model-provider-direct-actions">
          <button type="button" onClick={() => actions.openProvider(provider.id)}>{model.editLabel}</button>
          {actions.addModel && <button type="button" onClick={() => actions.addModel(provider.id)}>{model.addModelLabel}</button>}
          {actions.removeProvider && <button type="button" className="model-provider-delete" onClick={() => actions.removeProvider(provider.id)}>{model.deleteLabel}</button>}
        </div>
      </SortableProvider>)}
      {!model.providers.length && <p className="model-hint-block">{model.emptyLabel}</p>}
    </div>
    </SortableContext>
    </DndContext>
  </div>
}
export function DefaultModelProviders(props) { return <ProviderDirectory {...props} layout="default"/> }
export function StudioModelProviders(props) { return <ProviderDirectory {...props} layout="studio"/> }
