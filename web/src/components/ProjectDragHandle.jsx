import React, { useEffect, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'

export default function ProjectDragHandle({ name, groups, disabled, onReorder, label }) {
  const drag = useRef(null)
  const [active, setActive] = useState(false)
  const clear = () => {
    const d = drag.current
    if (d) { clearTimeout(d.timer); d.target?.classList.remove('is-drop-target') }
    drag.current = null
  }
  useEffect(() => clear, [])
  const finish = (cancel = false) => {
    const d = drag.current
    if (!cancel && d?.active && d.target) {
      const target = d.target.dataset.projectName
      const source = groups.find(g => g.name === name)
      const dest = groups.find(g => g.name === target)
      if (source && dest && source.pinned === dest.pinned && name !== target) {
        const names = groups.map(g => g.name)
        const index = names.indexOf(target)
        names.splice(names.indexOf(name), 1)
        names.splice(index, 0, name)
        onReorder(names)
      }
    }
    clear(); setActive(false)
  }
  return <button type="button" className={`oa-project-reorder ${active ? 'is-dragging' : ''}`} disabled={disabled}
    title={label} aria-label={`${label}: ${name}`} aria-pressed={active}
    onContextMenu={e => e.preventDefault()}
    onPointerDown={e => {
      if (e.button !== 0 || disabled) return
      clear()
      e.currentTarget.setPointerCapture(e.pointerId)
      const d = { x:e.clientX, y:e.clientY, active:false, target:null }
      d.timer = setTimeout(() => { d.active = true; setActive(true) }, 350)
      drag.current = d
    }}
    onPointerMove={e => {
      const d = drag.current
      if (!d) return
      if (!d.active) {
        if (Math.hypot(e.clientX-d.x, e.clientY-d.y) > 10) { clear(); setActive(false) }
        return
      }
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-project-name]')
      d.target?.classList.remove('is-drop-target')
      d.target = target
      target?.classList.add('is-drop-target')
      const list = e.currentTarget.closest('.oa-session-list')
      if (list) {
        const rect = list.getBoundingClientRect()
        if (e.clientY < rect.top + 40) list.scrollTop -= 16
        if (e.clientY > rect.bottom - 40) list.scrollTop += 16
      }
    }}
    onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}
    onKeyDown={e => { if (e.key === 'Escape') finish(true) }}>
    <GripVertical size={14} aria-hidden="true"/>
  </button>
}
