import React, { useEffect, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'

export default function ProjectDragHandle({ name, groups, disabled, onReorder, label }) {
  const drag = useRef(null)
  const [active, setActive] = useState(false)
  const clear = () => {
    const d = drag.current
    if (d) { clearTimeout(d.timer); cancelAnimationFrame(d.frame); d.target?.classList.remove('is-drop-target'); d.source?.style.removeProperty('opacity'); d.slots?.forEach(({node}) => { node.style.removeProperty('transform'); node.style.removeProperty('transition') }); d.ghost?.remove() }
    drag.current = null
  }
  useEffect(() => clear, [])
  const finish = async (cancel = false) => {
    const d = drag.current
    if (d?.finishing) return
    if (d) d.finishing = true
    if (!cancel && d?.active && d.target) {
      const target = d.target.dataset.projectName
      const source = groups.find(g => (g.key || g.name) === name)
      const dest = groups.find(g => (g.key || g.name) === target)
      if (source && dest && source.pinned === dest.pinned && name !== target) {
        const names = groups.map(g => (g.key || g.name))
        const index = names.indexOf(target)
        names.splice(names.indexOf(name), 1)
        names.splice(index, 0, name)
        const nodes = [...d.source.parentElement.querySelectorAll(':scope > [data-project-name]')]
        const before = new Map(nodes.map(node => [node, node.getBoundingClientRect().top]))
        if (d.ghost && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          const rect = d.target.getBoundingClientRect()
          await d.ghost.animate([{ transform:d.ghost.style.transform }, { transform:`translate3d(0, ${(d.dropTop ?? rect.top) - d.top}px, 0) scale(1)` }], { duration:150, easing:'ease-out', fill:'forwards' }).finished.catch(() => {})
        }
        clear(); setActive(false)
        await onReorder(names)
        requestAnimationFrame(() => {
          if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
          nodes.forEach(node => {
            const delta = before.get(node) - node.getBoundingClientRect().top
            if (node.isConnected && delta) node.animate([{ transform:`translateY(${delta}px)` }, { transform:'translateY(0)' }], { duration:220, easing:'cubic-bezier(.2,.8,.2,1)' })
          })
        })
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
      const d = { x:e.clientX, y:e.clientY, pointerY:e.clientY, active:false, target:null, source:e.currentTarget.closest('[data-project-name]') }
      d.timer = setTimeout(() => {
        if (!d.source) return
        d.active = true; setActive(true)
        const head = d.source.firstElementChild
        const rect = head.getBoundingClientRect()
        d.top = rect.top
        d.ghost = head.cloneNode(true)
        d.ghost.setAttribute('aria-hidden', 'true')
        d.ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'))
        Object.assign(d.ghost.style, { position:'fixed', top:`${rect.top}px`, left:`${rect.left}px`, width:`${rect.width}px`, height:`${rect.height}px`, margin:'0', boxSizing:'border-box', pointerEvents:'none', zIndex:'9999', borderRadius:'8px', background:getComputedStyle(head).backgroundColor, boxShadow:'0 6px 20px rgba(0,0,0,.16)', transform:'translate3d(0, 0, 0) scale(1.015)', willChange:'transform' })
        d.source.closest('.oa-sidebar').appendChild(d.ghost)
        d.source.style.opacity = '.15'
        d.list = d.source.closest('.oa-session-list')
        d.scrollTop = d.list?.scrollTop || 0
        const pin = groups.find(g => (g.key || g.name) === name)?.pinned
        d.slots = [...d.source.parentElement.querySelectorAll(':scope > [data-project-name]')]
          .filter(node => groups.find(g => (g.key || g.name) === node.dataset.projectName)?.pinned === pin)
          .map(node => ({ node, rect:node.getBoundingClientRect() }))
        d.from = d.slots.findIndex(slot => slot.node === d.source)
        d.slots.forEach(({node}) => { node.style.transition = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'transform 180ms cubic-bezier(.2,.8,.2,1)' })
      }, 280)
      drag.current = d
    }}
    onPointerMove={e => {
      const d = drag.current
      if (!d || d.finishing) return
      if (!d.active) {
        if (Math.hypot(e.clientX-d.x, e.clientY-d.y) > 10) { clear(); setActive(false) }
        return
      }
      d.ghost.style.transform = `translate3d(0, ${e.clientY-d.y}px, 0) scale(1.015)`
      const scrollDelta = (d.list?.scrollTop || 0) - d.scrollTop
      const y = e.clientY + scrollDelta
      let to = d.from
      d.slots.forEach(({rect}, index) => {
        if (index > d.from && y > rect.top + rect.height / 2) to = index
        if (index < d.from && y < rect.top + rect.height / 2 && to === d.from) to = index
      })
      const height = d.source.getBoundingClientRect().height
      d.slots.forEach(({node}, index) => {
        const shift = to > d.from && index > d.from && index <= to ? -height
          : to < d.from && index >= to && index < d.from ? height : 0
        node.style.transform = `translate3d(0, ${shift}px, 0)`
      })
      d.target = d.slots[to]?.node
      d.dropTop = d.slots[to]?.rect.top - scrollDelta
      if (to > d.from) d.dropTop += d.slots[to].rect.height - height
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
