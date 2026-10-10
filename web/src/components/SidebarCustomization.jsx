import React, { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Home, LayoutGrid, Plus, GripVertical, Pin, Bot, Folder, Clock, Briefcase, Star, Heart, Code, Terminal, BookOpen, FileText, MessageSquare, Flag, Zap, Globe, Rocket, Music, Camera, Image, Coffee, Palette, Shield, Wrench, CalendarDays, Pencil, Trash2, Eye, EyeOff, SlidersHorizontal } from 'lucide-react'
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import ProjectActionsMenu, { SidebarPreferenceSubmenu } from './ProjectActionsMenu'
import { normalizeSidebarLayout, normalizeSidebarOrder, sidebarSectionKeys, sidebarDisplayCounts, sidebarTabIcons } from '../lib/chatSidebarPreferences.js'

const tabIconComponents = { grid: LayoutGrid, folder: Folder, briefcase: Briefcase, star: Star, heart: Heart, code: Code, terminal: Terminal, book: BookOpen, file: FileText, message: MessageSquare, bot: Bot, pin: Pin, flag: Flag, zap: Zap, globe: Globe, rocket: Rocket, music: Music, camera: Camera, image: Image, coffee: Coffee, palette: Palette, shield: Shield, wrench: Wrench, calendar: CalendarDays }
const tabIconLabels = { grid: ['网格', 'Grid'], folder: ['文件夹', 'Folder'], briefcase: ['公文包', 'Briefcase'], star: ['星标', 'Star'], heart: ['爱心', 'Heart'], code: ['代码', 'Code'], terminal: ['终端', 'Terminal'], book: ['书籍', 'Book'], file: ['文档', 'Document'], message: ['对话', 'Chat'], bot: ['机器人', 'Bot'], pin: ['图钉', 'Pin'], flag: ['旗帜', 'Flag'], zap: ['闪电', 'Lightning'], globe: ['地球', 'Globe'], rocket: ['火箭', 'Rocket'], music: ['音乐', 'Music'], camera: ['相机', 'Camera'], image: ['图片', 'Image'], coffee: ['咖啡', 'Coffee'], palette: ['调色盘', 'Palette'], shield: ['盾牌', 'Shield'], wrench: ['扳手', 'Wrench'], calendar: ['日历', 'Calendar'] }
function SidebarTabIcon({ icon, size = 17 }) {
  const Component = tabIconComponents[icon] || LayoutGrid
  return <Component size={size} aria-hidden="true"/>
}

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
function SidebarTabNameEditor({ editing, ct, onSave, onClose }) {
  const [name, setName] = useState(editing.name)
  const [icon, setIcon] = useState(editing.icon || (editing.id === 'home' ? undefined : 'grid'))
  const [showIcons, setShowIcons] = useState(Boolean(editing.showIcons))
  const input = useRef(null)
  const panel = useRef(null)
  const grid = useRef(null)
  const gridId = useId()
  const rect = editing.anchor.getBoundingClientRect()
  const width = Math.min(248, window.innerWidth - 16)
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - (showIcons ? 232 : 66)))
  useEffect(() => {
    if (editing.showIcons) return
    input.current?.focus()
    input.current?.select()
  }, [editing.showIcons])
  useEffect(() => {
    if (showIcons) grid.current?.querySelector('[aria-pressed="true"]')?.focus()
  }, [showIcons])
  useEffect(() => {
    const outside = e => {
      if (panel.current?.contains(e.target) || editing.anchor.contains(e.target)) return
      if (name.trim()) onSave(name.trim(), icon, false)
      else onClose(false)
    }
    const key = e => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        if (showIcons) { setShowIcons(false); input.current?.focus() }
        else onClose(true)
      }
    }
    const hide = e => { if (e.type === 'resize' || !(e.target instanceof Node) || !panel.current?.contains(e.target)) onClose(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', hide)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', hide)
      window.removeEventListener('scroll', hide, true)
    }
  }, [editing, name, icon, showIcons, onSave, onClose])
  const moveIconFocus = e => {
    const buttons = Array.from(grid.current.querySelectorAll('button'))
    const index = buttons.indexOf(e.target)
    const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 6, ArrowUp: -6 }[e.key]
    if (index < 0 || (delta === undefined && !['Home', 'End'].includes(e.key))) return
    e.preventDefault()
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + delta + buttons.length) % buttons.length
    buttons[next].focus()
  }
  return createPortal(<form ref={panel} className="oa-sidebar-tab-editor" role="dialog" aria-label={editing.id === 'new' ? ct('新建选项卡', 'New tab') : ct('编辑选项卡', 'Edit tab')} style={{ top, left, width }}
    onSubmit={e=>{ e.preventDefault(); if (name.trim()) onSave(name.trim(), icon, true) }}>
    <div className="oa-sidebar-tab-editor-row">
      <button type="button" className="oa-sidebar-tab-icon-trigger" aria-label={ct("选择图标", "Choose icon")} title={ct("选择图标", "Choose icon")} aria-expanded={showIcons} aria-controls={showIcons ? gridId : undefined} onClick={()=>setShowIcons(value=>!value)}>{editing.id === 'home' && !icon ? <Home size={17} aria-hidden="true"/> : <SidebarTabIcon icon={icon}/>}</button>
    <input ref={input} maxLength={40} aria-label={ct('选项卡名称', 'Tab name')} title={ct('回车保存，Esc 取消', 'Enter to save, Esc to cancel')} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{ if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault() }}/>
    </div>
    {showIcons && <div id={gridId} ref={grid} className="oa-sidebar-tab-icon-grid" role="group" aria-label={ct('选项卡图标', 'Tab icons')} onKeyDown={moveIconFocus}>
      {sidebarTabIcons.map(key=><button key={key} type="button" className="oa-sidebar-tab-icon-option" aria-label={ct(...tabIconLabels[key])} title={ct(...tabIconLabels[key])} aria-pressed={icon === key} onClick={()=>{ setIcon(key); setShowIcons(false); input.current?.focus() }}><SidebarTabIcon icon={key} size={18}/></button>)}
    </div>}
  </form>, document.body)
}
export function SidebarTabs({ preferences, update, ct, onCustomize }) {
  const layout = normalizeSidebarLayout(preferences.sectionLayout)
  const [editing, setEditing] = useState(null)
  const tabs = useRef(null)
  const closeEditor = restoreFocus => {
    if (restoreFocus && editing?.anchor.isConnected) editing.anchor.focus()
    setEditing(null)
  }
  const save = (name, icon, restoreFocus) => {
    if (!editing || !name.trim()) return
    if (editing.id === 'new' && layout.tabs.length >= 12) { closeEditor(restoreFocus); return }
    if (editing.id !== 'new' && !layout.tabs.some(t=>t.id === editing.id)) { closeEditor(restoreFocus); return }
    const id = editing.id === 'new' ? `tab-${globalThis.crypto.randomUUID()}` : editing.id
    update('sectionLayout', { ...layout, active: id, tabs: editing.id === 'new' ? [...layout.tabs, { id, name: name.trim(), icon }] : layout.tabs.map(t=>t.id === id ? { ...t, name: name.trim(), icon } : t) })
    closeEditor(restoreFocus)
  }
  const rename = (tab, showIcons = false) => {
    const anchor = Array.from(tabs.current.querySelectorAll('[role="tab"]')).find(button=>button.dataset.tabId === tab.id)
    if (anchor) setEditing({ id: tab.id, name: tab.name, icon: tab.icon, showIcons, anchor })
  }
  return <div className="oa-sidebar-tab-area">
    <div ref={tabs} className="oa-sidebar-tabs" role="tablist" aria-label={ct('侧栏选项卡', 'Sidebar tabs')}>
      {layout.tabs.map(tab => {
        const name = tab.id === 'home' && tab.name === 'Home' ? ct('主页', 'Home') : tab.name
        const hideName = tab.hideName !== false
        return <div className="oa-sidebar-tab-item" key={tab.id}>
        <ProjectActionsMenu className="oa-sidebar-tab-menu" label={ct(`管理选项卡 ${name}`, `Manage tab ${name}`)} renderTrigger={({ triggerProps, closeMenu }) => <button type="button" role="tab" data-tab-id={tab.id} aria-label={name} title={name} aria-selected={layout.active === tab.id} {...triggerProps} aria-haspopup="menu" onClick={e=>{
          if (layout.active === tab.id) triggerProps.onClick(e)
          else {
            e.stopPropagation()
            closeMenu()
            update('sectionLayout', current=>({ ...normalizeSidebarLayout(current), active: tab.id }))
          }
        }}>{tab.id === 'home' && !tab.icon ? <Home size={17} aria-hidden="true" /> : <SidebarTabIcon icon={tab.icon}/>}{!hideName && <span>{name}</span>}</button>}>
          <button type="button" onClick={()=>rename({...tab, name})}><Pencil size={15} aria-hidden="true"/>{ct('重命名', 'Rename')}</button>
          <button type="button" onClick={()=>rename({...tab, name}, true)}><Palette size={15} aria-hidden="true"/>{ct('更改图标', 'Change icon')}</button>
          {tab.id !== 'home' && <button type="button" title={ct('删除选项卡，版块移回主页，不删除会话', 'Move sections home without deleting conversations')} onClick={()=>update('sectionLayout', { ...layout, active: layout.active === tab.id ? 'home' : layout.active, tabs: layout.tabs.filter(t=>t.id !== tab.id), sections: Object.fromEntries(Object.entries(layout.sections).map(([k,v])=>[k, v.tab === tab.id ? {...v, tab:'home'} : v])) })}><Trash2 size={15} aria-hidden="true"/>{ct('删除选项卡', 'Delete tab')}</button>}
          <div className="oa-sidebar-tab-menu-divider" role="separator"/>
          <button type="button" onClick={()=>update('sectionLayout', {...layout, tabs:layout.tabs.map(t=>t.id === tab.id ? {...t,hideName:!hideName} : t)})}>{hideName ? <Eye size={15} aria-hidden="true"/> : <EyeOff size={15} aria-hidden="true"/>}{hideName ? ct('显示选项卡名称', 'Show tab name') : ct('隐藏选项卡名称', 'Hide tab name')}</button>
          {onCustomize && <><div className="oa-sidebar-tab-menu-divider" role="separator"/><button type="button" onClick={onCustomize}><SlidersHorizontal size={15} aria-hidden="true"/>{ct('自定义侧边栏', 'Customize sidebar')}</button></>}
        </ProjectActionsMenu>
      </div>})}
      <button type="button" className="oa-icon-btn" disabled={layout.tabs.length >= 12} aria-label={ct('新建选项卡', 'New tab')} onClick={e=>{ if (editing?.id === 'new') closeEditor(true); else setEditing({ id:'new', name:ct('新建选项卡', 'New tab'), anchor:e.currentTarget }) }}><Plus size={16} aria-hidden="true" /></button>
    </div>
    {editing && <SidebarTabNameEditor key={editing.id} editing={editing} ct={ct} onSave={save} onClose={closeEditor}/>}
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
