import React from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { normalizeSidebarOrder, sidebarSectionKeys } from '../lib/chatSidebarPreferences.js'

export function SidebarSections({ order, customizing, children }) {
  const keys = normalizeSidebarOrder(order)
  const sorted = React.Children.toArray(children).sort((a, b) => {
    const rank = child => child.props?.['data-sidebar-section'] ? keys.indexOf(child.props['data-sidebar-section']) + 1 : 0
    return rank(a) - rank(b)
  })
  return <div className="oa-sidebar-sections" hidden={customizing}>{sorted}</div>
}

export default function SidebarCustomization({ preferences, update, ct }) {
  const order = normalizeSidebarOrder(preferences.sectionOrder)
  const labels = { pinned: ct('置顶', 'Pinned'), conductors: ct('指挥家', 'Conductors'), projects: ct('项目', 'Projects'), recent: ct('最近', 'Recent') }
  const flags = { pinned: 'showPinned', conductors: 'showConductor', projects: 'showProjects', recent: 'showRecent' }
  function move(key, delta) {
    const index = order.indexOf(key)
    const target = index + delta
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    update('sectionOrder', next)
  }
  return <div className="oa-sidebar-customize" aria-label={ct('自定义侧边栏', 'Customize sidebar')}>
    <h2>{ct('侧边栏版块', 'Sidebar sections')}</h2>
    <p>{ct('选择显示内容，调整排列顺序。', 'Choose what to show and arrange its order.')}</p>
    {order.map((key, index) => <div className="oa-sidebar-customize-row" key={key}>
      <label><input type="checkbox" checked={preferences[flags[key]] !== false} onChange={event=>update(flags[key], event.target.checked)}/><span>{labels[key]}</span></label>
      <button type="button" className="oa-icon-btn" disabled={index === 0} onClick={()=>move(key, -1)} aria-label={ct(`上移${labels[key]}`, `Move ${labels[key]} up`)}><ChevronUp size={15}/></button>
      <button type="button" className="oa-icon-btn" disabled={index === order.length - 1} onClick={()=>move(key, 1)} aria-label={ct(`下移${labels[key]}`, `Move ${labels[key]} down`)}><ChevronDown size={15}/></button>
    </div>)}
    <button type="button" className="oa-sidebar-customize-reset" onClick={()=>{ update('sectionOrder', [...sidebarSectionKeys]); Object.values(flags).forEach(key=>update(key, true)) }}>{ct('恢复默认版块', 'Restore default sections')}</button>
    <p className="oa-sidebar-customize-note">{ct('仅调整导航显示，不会删除项目或会话。', 'Only changes navigation. Projects and chats are not deleted.')}</p>
  </div>
}
