import React, { useState } from 'react'
import ProjectActionsMenu, { SidebarPreferenceSubmenu } from './ProjectActionsMenu'
import { normalizeSidebarLayout, normalizeSidebarOrder, sidebarSectionKeys, sidebarDisplayCounts } from '../lib/chatSidebarPreferences.js'

export function SidebarSections({ order, layout, children }) {
  const keys = normalizeSidebarOrder(order)
  const sorted = React.Children.toArray(children).sort((a, b) => {
    const rank = child => child.props?.['data-sidebar-section'] ? keys.indexOf(child.props['data-sidebar-section']) + 1 : 0
    return rank(a) - rank(b)
  })
  return <div className="oa-sidebar-sections" >{sorted.filter(child => !child.props?.['data-sidebar-section'] || !layout || layout.sections[child.props['data-sidebar-section']].tab === layout.active)}</div>
}

const flags = { pinned: 'showPinned', conductors: 'showConductor', projects: 'showProjects', recent: 'showRecent' }
const sectionLabel = (key, ct) => ({ pinned: ct('置顶', 'Pinned'), conductors: ct('指挥家', 'Conductors'), projects: ct('项目', 'Projects'), recent: ct('最近', 'Recent') })[key]
export default function SidebarCustomization({ preferences, update, ct }) {
  const layout = normalizeSidebarLayout(preferences.sectionLayout)
  return <div className="oa-sidebar-add-sections" aria-label={ct('添加版块', 'Add sections')}>
    {sidebarSectionKeys.map(key => <label key={key}><input type="checkbox" checked={preferences[flags[key]] !== false && layout.sections[key].tab === layout.active} onChange={e => {
      update(flags[key], e.target.checked)
      if (e.target.checked) update('sectionLayout', { ...layout, sections: { ...layout.sections, [key]: { ...layout.sections[key], tab: layout.active } } })
    }}/>{sectionLabel(key, ct)}</label>)}
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
        <button type="button" role="tab" aria-label={tab.id === 'home' ? ct('主页', 'Home') : tab.name} title={tab.name} aria-selected={layout.active === tab.id} onClick={()=>update('sectionLayout', { ...layout, active: tab.id })}>{tab.id === 'home' ? ct('主页', 'Home') : tab.hideName ? tab.name.slice(0,1) : tab.name}</button>
        {tab.id !== 'home' && <ProjectActionsMenu label={ct(`管理选项卡 ${tab.name}`, `Manage tab ${tab.name}`)}>
          <button type="button" onClick={()=>{setEditing(tab.id);setName(tab.name)}}>{ct('重命名', 'Rename')}</button>
          <button type="button" onClick={()=>update('sectionLayout', {...layout, tabs:layout.tabs.map(t=>t.id === tab.id ? {...t,hideName:!t.hideName} : t)})}>{tab.hideName ? ct('显示选项卡名称', 'Show tab name') : ct('隐藏选项卡名称', 'Hide tab name')}</button>
          <button type="button" onClick={()=>update('sectionLayout', { ...layout, active: layout.active === tab.id ? 'home' : layout.active, tabs: layout.tabs.filter(t=>t.id !== tab.id), sections: Object.fromEntries(Object.entries(layout.sections).map(([k,v])=>[k, v.tab === tab.id ? {...v, tab:'home'} : v])) })}>{ct('删除选项卡（版块移回主页）', 'Delete tab (move sections home)')}</button>
        </ProjectActionsMenu>}
      </div>)}
      <button type="button" className="oa-icon-btn" disabled={layout.tabs.length >= 12} aria-label={ct('新建选项卡', 'New tab')} onClick={()=>{setEditing('new');setName('')}}>+</button>
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
