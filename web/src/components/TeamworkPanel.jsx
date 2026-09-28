import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Users, X } from 'lucide-react'
import { confirmDanger } from '../lib/danger'
import './TeamworkPanel.css'

const terminal = status => ['succeeded', 'failed', 'cancelled'].includes(status)

export default function TeamworkPanel({ detail, busy, request, onChanged, onOpen, onClose, ct }) {
  const [members, setMembers] = useState(() => detail.conductor?.team || [])
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState(0)
  const dialogRef = useRef(null)
  const alive = useRef(true)
  const parent = detail.conductor?.role === 'parent'
  const tasks = detail.conductor_children || []
  const locked = busy || saving || tasks.some(task => !terminal(task.status) || task.recovery)
  const base = `/api/chat/conductor/${encodeURIComponent(detail.id)}`

  useEffect(() => {
    let disposed = false
    request(`${base}/models`).then(result => {
      if (!disposed) { setModels(result.models || []); setLoading(false) }
    }).catch(err => { if (!disposed) { setError(err.message); setLoading(false) } })
    return () => { disposed = true }
  }, [base, request, retry])

  useEffect(() => {
    alive.current = true
    const previous = document.activeElement
    const node = dialogRef.current
    node?.querySelector('button')?.focus()
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const focusable = [...node.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    node?.addEventListener('keydown', keydown)
    return () => { alive.current = false; node?.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus() }
  }, [onClose])

  const edit = (id, field, value) => {
    setSaved(false)
    setMembers(items => items.map(member => member.id === id ? { ...member, [field]: value } : member))
  }
  const enable = async () => {
    if (locked) return
    setSaving(true); setError('')
    try {
      if (!await confirmDanger('conductor-enable', ct('\u542f\u7528\u4e3b\u63a7\u534f\u4f5c\uff1f\u4e3b\u63a7\u53ef\u6d3e\u53d1\u5b50\u4efb\u52a1\uff0c\u4fee\u6539\u5171\u4eab\u5de5\u4f5c\u76ee\u5f55\u5e76\u4ea7\u751f\u989d\u5916\u7528\u91cf\u3002', 'Enable lead coordination? The lead can dispatch tasks, modify the shared workspace, and incur additional usage.'))) return
      if (!alive.current) return
      const result = await request(`${base}/enable`, { method: 'POST', body: { dangerous: true } })
      if (alive.current) onChanged(result.conductor)
    } catch (err) { if (alive.current) setError(err.message) }
    finally { if (alive.current) setSaving(false) }
  }
  const save = async event => {
    event.preventDefault(); setSaving(true); setSaved(false); setError('')
    try {
      const result = await request(`${base}/teamwork`, { method: 'POST', body: { members } })
      if (alive.current) { onChanged(result.conductor); setMembers(result.conductor.team || []); setSaved(true) }
    } catch (err) { if (alive.current) setError(err.message) }
    finally { if (alive.current) setSaving(false) }
  }
  const valid = members.every(member => member.name.trim() && member.role.trim() && models.some(model => Number(model.index) === member.llm_no))
    && new Set(members.map(member => member.name.trim().toLowerCase())).size === members.length
  const statusLabel = status => ({ queued: ct('\u6392\u961f\u4e2d', 'Queued'), running: ct('\u6267\u884c\u4e2d', 'Running'), succeeded: ct('\u5df2\u8fd4\u56de', 'Returned'), failed: ct('\u5931\u8d25', 'Failed'), cancelled: ct('\u5df2\u53d6\u6d88', 'Cancelled') }[status] || status)

  return createPortal(<div className="oa-teamwork-overlay" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className="oa-teamwork-panel" role="dialog" aria-modal="true" aria-labelledby="teamwork-title">
      <header><h2 id="teamwork-title"><Users size={18}/>Teamwork</h2><button type="button" onClick={onClose} aria-label={ct('\u5173\u95ed\u56e2\u961f', 'Close team')}><X size={18}/></button></header>
      <div className="oa-teamwork-scroll">
        <p className="oa-teamwork-intro">{ct('\u5f53\u524d\u4f1a\u8bdd\u6a21\u578b\u62c5\u4efb\u4e3b\u63a7\uff0c\u8d1f\u8d23\u5206\u5de5\u3001\u4f20\u9012\u6210\u5458\u7ed3\u679c\u548c\u6700\u7ec8\u6c47\u603b\u3002\u6210\u5458\u5171\u4eab\u9879\u76ee\u5de5\u4f5c\u76ee\u5f55\uff0c\u591a\u6a21\u578b\u8c03\u7528\u4f1a\u589e\u52a0\u7528\u91cf\u3002', 'The current conversation model leads: it delegates, shares member results, and delivers the final answer. Members share the project workspace. Multiple models increase usage.')}</p>
        {error && <p role="alert" className="oa-teamwork-error">{error}</p>}
        {loading && <p role="status">{ct('\u6b63\u5728\u8bfb\u53d6\u6a21\u578b\u2026', 'Loading models…')}</p>}
        {!loading && models.length === 0 && <p>{ct('\u6682\u65e0\u53ef\u7528\u6a21\u578b\u3002', 'No models available.')} <button type="button" onClick={() => { setLoading(true); setError(''); setRetry(value => value + 1) }}>{ct('\u91cd\u8bd5', 'Retry')}</button></p>}
        {!parent ? <button className="oa-teamwork-primary" disabled={locked} onClick={enable}>{ct('\u542f\u7528\u4e3b\u63a7\u534f\u4f5c', 'Enable lead coordination')}</button> : <form onSubmit={save}>
          <h3>{ct('\u56e2\u961f\u6210\u5458', 'Team members')} <small>{members.length}/8</small></h3>
          {locked && <p role="status">{ct('\u4efb\u52a1\u6267\u884c\u6216\u7b49\u5f85\u6062\u590d\u65f6\u4e0d\u53ef\u7f16\u8f91\u6210\u5458\u3002', 'Membership is locked while tasks run or await recovery.')}</p>}
          <fieldset disabled={locked || loading}>
            {members.map((member, index) => <div className="oa-teamwork-member" key={member.id}>
              <label>{ct('\u540d\u79f0', 'Name')} {index + 1}<input required maxLength={40} value={member.name} onChange={event => edit(member.id, 'name', event.target.value)}/></label>
              <label>{ct('\u6a21\u578b', 'Model')} {index + 1}<select value={member.llm_no} onChange={event => edit(member.id, 'llm_no', Number(event.target.value))}>
                {!models.some(model => Number(model.index) === member.llm_no) && <option value={member.llm_no}>{ct('\u4e0d\u53ef\u7528\u6a21\u578b', 'Unavailable model')} #{member.llm_no}</option>}
                {models.map(model => <option key={model.index} value={model.index}>#{model.index} {model.name || model.model || model.provider}</option>)}
              </select></label>
              <label className="oa-teamwork-role">{ct('\u804c\u8d23', 'Role')} {index + 1}<textarea required maxLength={1000} rows={2} value={member.role} onChange={event => edit(member.id, 'role', event.target.value)}/></label>
              <button type="button" onClick={() => { setSaved(false); setMembers(items => items.filter(item => item.id !== member.id)) }} aria-label={`${ct('\u79fb\u9664\u6210\u5458', 'Remove member')} ${index + 1}`}>{ct('\u79fb\u9664', 'Remove')}</button>
            </div>)}
            <div className="oa-teamwork-actions"><button type="button" disabled={members.length >= 8 || !models.length} onClick={() => { setSaved(false); setMembers(items => [...items, { id: `m-${crypto.randomUUID()}`, name: '', role: '', llm_no: Number(models[0].index) }]) }}><Plus size={14}/>{ct('\u6dfb\u52a0\u6210\u5458', 'Add member')}</button><button className="oa-teamwork-primary" type="submit" disabled={!valid || saving}>{saving ? ct('\u4fdd\u5b58\u4e2d\u2026', 'Saving…') : ct('\u4fdd\u5b58\u56e2\u961f', 'Save team')}</button></div>
          </fieldset>
          {saved && <p role="status">{ct('\u5df2\u4fdd\u5b58\uff0c\u53ef\u5728\u4e3b\u4f1a\u8bdd\u53d1\u9001\u4efb\u52a1\u3002', 'Saved. Send your task in the main conversation.')}</p>}
          {members.length === 0 && <p className="oa-teamwork-hint">{ct('\u6dfb\u52a0\u6210\u5458\u540e\u4fdd\u5b58\u4ee5\u542f\u7528\u56fa\u5b9a\u56e2\u961f\uff1b\u4fdd\u5b58\u7a7a\u56e2\u961f\u5219\u8fd4\u56de\u666e\u901a Conductor\u3002', 'Add and save members for a fixed team. Saving an empty team returns to ordinary Conductor.')}</p>}
        </form>}
        <section className="oa-teamwork-discussion" aria-label={ct('\u56e2\u961f\u8ba8\u8bba', 'Team discussion')}><h3>{ct('\u56e2\u961f\u8ba8\u8bba', 'Team discussion')}</h3>
          {!tasks.length && <p className="oa-teamwork-hint">{ct('\u53d1\u9001\u4efb\u52a1\u540e\uff0c\u8fd9\u91cc\u663e\u793a\u4e3b\u63a7\u5206\u5de5\u4e0e\u6210\u5458\u56de\u590d\u3002\u6700\u7ec8\u6c47\u603b\u5728\u4e3b\u4f1a\u8bdd\u3002', 'Assignments and member replies appear here after you send a task. The final synthesis stays in the main conversation.')}</p>}
          {tasks.map(task => <article key={task.dispatch_id || task.session_id}>
            <div className="oa-teamwork-taskhead"><b>{task.member_name || task.member_id || ct('\u5b50\u4efb\u52a1', 'Subagent')}</b><span>{statusLabel(task.status)}</span></div>
            <p><strong>{ct('\u4e3b\u63a7\u5206\u5de5\uff1a', 'Lead assignment: ')}</strong>{task.objective}</p>
            {task.summary && <p className="oa-teamwork-reply">{task.summary}</p>}
            {task.error && <p className="oa-teamwork-error">{task.error}</p>}
            {task.recovery && <p>{ct('\u7b49\u5f85\u6062\u590d', 'Awaiting recovery')}</p>}
            {task.status === 'succeeded' && <small>{task.review_status === 'verified' ? ct('\u4e3b\u63a7\u5df2\u9a8c\u6536', 'Verified by lead') : ct('\u5c1a\u672a\u9a8c\u6536', 'Not yet verified')}</small>}
            <button type="button" onClick={() => { onOpen(task.session_id); onClose() }}>{ct('\u67e5\u770b\u6210\u5458\u4f1a\u8bdd', 'Open member conversation')}</button>
          </article>)}
        </section>
      </div>
    </section>
  </div>, document.body)
}
