import React, { useState } from 'react'
import { Home, LayoutGrid, Plus, GripVertical, Pin, Bot, Folder, Clock } from 'lucide-react'
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import ProjectActionsMenu, { SidebarPreferenceSubmenu } from './ProjectActionsMenu'
import { normalizeSidebarLayout, normalizeSidebarOrder, sidebarSectionKeys, sidebarDisplayCounts } from '../lib/chatSidebarPreferences.js'

export function SidebarSections({ order, layout, children, hidden = false }) {
  const keys = normalizeSidebarOrder(order)
  const sorted = React.Children.toArray(children).sort((a, b) => {
    const rank = child => child.props?.['data-sidebar-section'] ? keys.indexOf(child.props['data-sidebar-section']) + 1 : 0
    return rank(a) - rank(b)
  })
  return <div className="oa-sidebar-sections" hidden={hidden}>{sorted.filter(child => !child.props?.['data-sidebar-section'] || !layout || layout.sections[child.props['data-sidebar-section']].tab === layout.active)}</div>
}

const flags = { pinned: 'showPinned', conductors: 'showConductor', projects: 'showProjects', recent: 'showRecent' }
const sectionLabel = (key, ct) => ({ pinned: ct('置顶', 'Pinned'), conductors: ct('指挥家', 'Conductors'), projects: ct('项目', 'Projects'), recent: ct('最近', 'Recent') })[key]
const sectionIcons = { pinned: Pin, conductors: Bot, projects: Folder, recent: Clock }
function SortableSection({ section, preferences, update, ct }) {
  const Icon = sectionIcons[section]
  const label = sectionLabel(section, ct)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: section })
  return <div ref={setNodeRef} className={`oa-sidebar-customize-row${isDragging ? ' is-dragging' : ''}`} data-customize-section={section} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <button type="button" ref={setActivatorNodeRef} className="oa-sidebar-drag-handle" {...attributes} {...listeners} aria-label={ct(`调整${label}顺序`, `Reorder ${label}`)} title={ct('拖动调整顺序', 'Drag to reorder')}><GripVertical size={15} aria-hidden="true"/></button>
    <Icon className="oa-sidebar-section-icon" size={17} aria-hidden="true"/>
    <span className="oa-sidebar-customize-label">{label}</span>
    <ProjectActionsMenu label={ct(`${label}版块设置`, `${label} section settings`)}><SidebarSectionOptions section={section} preferences={preferences} update={update} ct={ct}/></ProjectActionsMenu>
  </div>
}
export default function SidebarCustomization({ preferences, update, ct }) {
  const layout = normalizeSidebarLayout(preferences.sectionLayout)
  const order = normalizeSidebarOrder(preferences.sectionOrder)
  const visible = order.filter(key => preferences[flags[key]] !== false && layout.sections[key].tab === layout.active)
  const available = order.filter(key => !visible.includes(key))
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const reorder = ({ active, over }) => {
    if (over && active.id !== over.id) update('sectionOrder', arrayMove(order, order.indexOf(active.id), order.indexOf(over.id)))
  }
  const add = key => {
    update(flags[key], true)
    update('sectionLayout', { ...layout, sections: { ...layout.sections, [key]: { ...layout.sections[key], tab: layout.active } } })
  }
  return <div className="oa-sidebar-customize" aria-label={ct('自定义侧边栏', 'Customize sidebar')}>
    <h2>{ct('侧边栏版块', 'Sidebar sections')}</h2>
    <p>{ct('拖动调整顺序，点击 ··· 设置版块。', 'Drag to reorder. Use ··· to configure sections.')}</p>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder} accessibility={{ screenReaderInstructions: { draggable: ct('按空格键开始排序，使用方向键移动，再按空格键确认，或按 Escape 取消。', 'Press Space to reorder, use arrow keys to move, then Space to confirm or Escape to cancel.') } }}>
      <SortableContext items={visible} strategy={verticalListSortingStrategy}>
        <div className="oa-sidebar-customize-list">{visible.map(section => <SortableSection key={section} section={section} preferences={preferences} update={update} ct={ct}/>)}</div>
      </SortableContext>
    </DndContext>
    {!visible.length && <div className="oa-sidebar-customize-empty">{ct('此选项卡还没有版块', 'No sections in this tab yet')}</div>}
    <div className="oa-sidebar-add-sections">
      <SidebarPreferenceSubmenu label={<><Plus size={16} aria-hidden="true"/>{ct('添加版块', 'Add section')}</>} value={null} options={available.map(key => ({ value: key, label: `${sectionLabel(key, ct)}${layout.sections[key].tab !== layout.active ? ct('（移至此选项卡）', ' (move to this tab)') : ''}` }))} onChange={add}/>
      {!available.length && <small>{ct('所有版块均已添加', 'All sections added')}</small>}
    </div>
    <button type="button" className="oa-sidebar-customize-reset" onClick={()=>{ update('sectionOrder', [...sidebarSectionKeys]); update('sectionLayout', normalizeSidebarLayout()); Object.values(flags).forEach(key=>update(key, true)) }}>{ct('恢复默认版块', 'Restore default sections')}</button>
  </div>
}
export function SidebarTabs({ preferences, update, ct }) {
  const layout = normalizeSidebarLayout(preferences.sectionLayout)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const save = () => {
    if (!name.trim()) return
    const id = editing === 'new' ? `tab-${globalThis.crypto.randomUUID()}` : editing
    update('sectionLayout', { ...layout, active: id, tabs: editing === 'new' ? [...layout.tabs, { id, name: name.trim() }] : layout.tabs.map(t=>t.id === id ? { ...t, name: name.trim() } : t) })
    setEditing(null)
  }
  return <div className="oa-sidebar-tab-area">
    <div className="oa-sidebar-tabs" role="tablist" aria-label={ct('侧栏选项卡', 'Sidebar tabs')}>
      {layout.tabs.map(tab => <div className="oa-sidebar-tab-item" key={tab.id}>
        <button type="button" role="tab" aria-label={tab.id === 'home' ? ct('主页', 'Home') : tab.name} title={tab.id === 'home' ? ct('主页', 'Home') : tab.name} aria-selected={layout.active === tab.id} onClick={()=>update('sectionLayout', { ...layout, active: tab.id })}>{tab.id === 'home' ? <Home size={17} aria-hidden="true" /> : <LayoutGrid size={17} aria-hidden="true" />}{tab.id !== 'home' && !tab.hideName && <span>{tab.name}</span>}</button>
        {tab.id !== 'home' && <ProjectActionsMenu label={ct(`管理选项卡 ${tab.name}`, `Manage tab ${tab.name}`)}>
          <button type="button" onClick={()=>{setEditing(tab.id);setName(tab.name)}}>{ct('重命名', 'Rename')}</button>
          <button type="button" onClick={()=>update('sectionLayout', {...layout, tabs:layout.tabs.map(t=>t.id === tab.id ? {...t,hideName:!t.hideName} : t)})}>{tab.hideName ? ct('显示选项卡名称', 'Show tab name') : ct('隐藏选项卡名称', 'Hide tab name')}</button>
          <button type="button" onClick={()=>update('sectionLayout', { ...layout, active: layout.active === tab.id ? 'home' : layout.active, tabs: layout.tabs.filter(t=>t.id !== tab.id), sections: Object.fromEntries(Object.entries(layout.sections).map(([k,v])=>[k, v.tab === tab.id ? {...v, tab:'home'} : v])) })}>{ct('删除选项卡（版块移回主页）', 'Delete tab (move sections home)')}</button>
        </ProjectActionsMenu>}
      </div>)}
      <button type="button" className="oa-icon-btn" disabled={layout.tabs.length >= 12} aria-label={ct('新建选项卡', 'New tab')} onClick={()=>{setEditing('new');setName('')}}><Plus size={16} aria-hidden="true" /></button>
    </div>
    {editing && <form className="oa-project-draft" onSubmit={e=>{e.preventDefault();save()}}><input autoFocus maxLength={40} aria-label={ct('选项卡名称', 'Tab name')} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key === 'Escape')setEditing(null)}}/><button type="submit" disabled={!name.trim()}>{ct('保存', 'Save')}</button><button type="button" onClick={()=>setEditing(null)}>{ct('取消', 'Cancel')}</button></form>}
  </div>
}
export function SidebarSectionOptions({ section, preferences, update, ct }) {
  const layout = normalizeSidebarLayout(preferences.sectionLayout)
  const order = normalizeSidebarOrder(preferences.sectionOrder)
  const peers = order.filter(k=>layout.sections[k].tab === layout.sections[section].tab)
  const index = peers.indexOf(section)
  const move = delta => {
    const next = [...order], a = next.indexOf(section), b = next.indexOf(peers[index + delta])
    if (b < 0) return
    ;[next[a], next[b]] = [next[b], next[a]]
    update('sectionOrder', next)
  }
  const newTab = () => {
    const id = `tab-${globalThis.crypto.randomUUID()}`
    update('sectionLayout', { ...layout, active:id, tabs:[...layout.tabs, {id, name:ct('新选项卡', 'New tab')}], sections:{...layout.sections, [section]:{...layout.sections[section], tab:id}} })
  }
  const set = patch => update('sectionLayout', { ...layout, sections: { ...layout.sections, [section]: { ...layout.sections[section], ...patch } } })
  return <>
    <SidebarPreferenceSubmenu label={ct(`显示 · ${layout.sections[section].count}`, `Show · ${layout.sections[section].count}`)} value={layout.sections[section].count} options={sidebarDisplayCounts.map(value=>({ value, label: ct(`${value} 项`, `${value} items`) }))} onChange={count=>set({count})}/>
    <button type="button" disabled={index === 0} onClick={()=>move(-1)}>{ct('向上移动', 'Move up')}</button>
    <button type="button" disabled={index === peers.length - 1} onClick={()=>move(1)}>{ct('向下移动', 'Move down')}</button>
    <SidebarPreferenceSubmenu label={ct('移至选项卡', 'Move to tab')} value={layout.sections[section].tab} options={layout.tabs.map(t=>({value:t.id, label:t.id === 'home' ? ct('主页', 'Home') : t.name}))} onChange={tab=>set({tab})}/>
    <button type="button" disabled={layout.tabs.length >= 12} onClick={newTab}>{ct('移至新选项卡', 'Move to new tab')}</button>
    <button type="button" onClick={()=>update(flags[section], false)}>{ct('隐藏版块', 'Hide section')}</button>
  </>
}
