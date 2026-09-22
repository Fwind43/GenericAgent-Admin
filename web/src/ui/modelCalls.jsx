import Button from 'antd/es/button'
import Space from 'antd/es/space'
import Tag from 'antd/es/tag'
import { ArrowDown, ArrowUp, Building2, ChevronDown, GripVertical, Layers, Network, Plus, Trash2 } from 'lucide-react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import './modelCalls.css'

// Display-only contract. No profile/config objects, request clients or editor slots.
function Ordering({ model, actions, children }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (over) actions.reorder(active.id, over.id) }}>
    <SortableContext items={model.rows.map(row => row.id)} strategy={verticalListSortingStrategy}>{children}</SortableContext>
  </DndContext>
}
function SortableRow({ row, studio, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id })
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 20 : undefined }}
    role="listitem" data-call-id={row.id} className={studio ? 'studio-call-item' : `model-call-row${isDragging ? ' is-dragging' : ''}${row.group ? ' is-failover' : ''}${row.expanded ? ' is-expanded' : ''}`}>
    {children({ attributes, listeners })}
  </div>
}
function RowActions({ row, model, actions }) {
  const l = model.labels
  return <div className="model-call-actions">
    <Button type="text" size="small" className="model-call-toggle" aria-expanded={row.expanded} aria-label={`${row.expanded ? l.collapse : l.configure}: ${row.actionName}`} onClick={() => actions.toggle(row.id)}>
      {row.expanded ? l.collapse : l.configure}<ChevronDown size={13}/>
    </Button>
    <Button type="text" size="small" icon={<ArrowUp size={15}/>} aria-label={`${l.up} ${row.actionName}`} title={l.up} disabled={!row.canMoveUp} onClick={() => actions.moveUp(row.id)}/>
    <Button type="text" size="small" icon={<ArrowDown size={15}/>} aria-label={`${l.down} ${row.actionName}`} title={l.down} disabled={!row.canMoveDown} onClick={() => actions.moveDown(row.id)}/>
    <Button danger type="text" size="small" icon={<Trash2 size={14}/>} aria-label={`${l.remove} ${row.actionName}`} title={row.group ? l.removeGroup : l.removeModel} onClick={() => actions.remove(row.id)}>{l.remove}</Button>
  </div>
}
function Provider({ row, model, actions }) {
  return !row.group && <button type="button" className="model-call-provider" title={model.labels.provider} onClick={() => actions.openProvider(row.id)}><Building2 size={12}/><span>{row.provider}</span></button>
}
function AddActions({ model, actions }) {
  return <Space size={8} wrap>
    <Button icon={<Network size={14}/>} onClick={actions.addGroup} disabled={!model.canGroup} title={model.groupHelp || undefined}>{model.addGroupLabel}</Button>
    <Button type="primary" icon={<Plus size={15}/>} onClick={actions.addModel} disabled={!model.canAdd}>{model.addLabel}</Button>
  </Space>
}
function Empty({ model, actions }) {
  return <div className="model-empty-state" role="status"><Layers size={34} strokeWidth={1.2} className="model-empty-icon"/><strong>{model.emptyTitle}</strong><span>{model.emptyHelp}</span>
    {!model.loading && <Button type="primary" icon={<Plus size={15}/>} onClick={model.canAdd ? actions.addModel : actions.addProvider}>{model.emptyAction}</Button>}
  </div>
}
function ModelCalls({ model, actions, layout = 'default' }) {
  return <div data-model-calls-layout={layout} className="model-calls-redesign">
    <header className="model-call-head"><div><strong>{model.title}<span className="model-call-count">{model.rows.length}</span></strong><span>{model.help}</span></div><AddActions model={model} actions={actions}/></header>
    {model.rows.length ? <Ordering model={model} actions={actions}><div className="model-call-rows" role="list" tabIndex={0} aria-label={model.title}>
      {model.rows.map(row => <SortableRow key={row.id} row={row}>{({ attributes, listeners }) => <div className="model-call-main">
        <button type="button" {...attributes} {...listeners} className="model-drag-handle" aria-label={`${model.labels.reorder}: ${row.actionName}`} title={model.labels.reorder}><GripVertical size={16}/></button>
        <div className="model-call-slot" aria-label={`--llm-no ${row.slot}`}><strong>{row.slot}</strong><span>--llm-no</span></div>
        <div className="model-call-copy"><span className="model-call-title">{row.group && <Network size={13}/>}<strong title={row.title}>{row.title}</strong>{row.group && <Tag>{model.labels.group}</Tag>}</span>
          <span className="model-call-sub"><code title={row.variable}>{row.variable}</code>{row.detail && <em title={row.detail}>{row.detail}</em>}</span></div>
        <Provider row={row} model={model} actions={actions}/><RowActions row={row} model={model} actions={actions}/>
      </div>}</SortableRow>)}
    </div></Ordering> : <Empty model={model} actions={actions}/>}
  </div>
}
export function DefaultModelCalls(props) { return <ModelCalls {...props} layout="default"/> }
export function StudioModelCalls(props) { return <ModelCalls {...props} layout="studio"/> }
