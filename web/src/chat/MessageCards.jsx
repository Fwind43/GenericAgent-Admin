import { memo, useState, useEffect, useMemo, useCallback } from 'react'
import { commandResultSummary } from '../lib/chatCommands'
import { Check, FileOutput, Target, ChevronDown, FileText } from 'lucide-react'
import { normalizeGoalCardState, GOAL_CARD_TERMINAL, goalCardPathKey, goalCardStatusInfo, formatGoalCardTime } from './goalCard.js'
import { api } from '../lib/api'
import { dateFromTimestamp, ct } from './chatFormat.js'
import { goalBudgetPercent, goalTurnPercent, formatDuration } from '../lib/format'
import { normalizeToolParts } from './markdownParts.js'
import { splitMarkdownParts } from '../lib/chatTextSafety'
import { parseFileToolArgs } from './toolArgs.js'
import { computeLineDiff, computeWriteRows } from '../lib/lineDiff.js'
import { CopyButton } from './CopyButton.jsx'
import { DiffRows } from './ToolCallBlock.jsx'

const FILE_SUMMARY_AUTO_COLLAPSE_FILES = 4

const FILE_SUMMARY_AUTO_COLLAPSE_CHANGES = 100

export const FileSummaryCard = memo(function FileSummaryCard({ content = '' }) {
  const fileOps = useMemo(() => {
    const parts = normalizeToolParts(splitMarkdownParts(content))
    const ops = []
    for (const part of parts) {
      if (part.type !== 'tool') continue
      const call = part.call || {}
      const parsed = parseFileToolArgs(call.name, call.args)
      if (parsed && parsed.path) {
        // 计算改动统计
        let added = 0, removed = 0, summary = ''
        
        if (parsed.type === 'file_patch') {
          // 用真实行级 diff 统计（旧实现取 old/new 块整块行数，会把未变的上下文行也计入 ±）
          const d = computeLineDiff(parsed.old_content || '', parsed.new_content || '', { context: 0 })
          added = d.added
          removed = d.removed
          // 取 new_content 前30个字符作为摘要
          summary = (parsed.new_content || '').trim().slice(0, 50).replace(/\n/g, ' ')
        } else if (parsed.type === 'file_write') {
          const lines = (parsed.content || '').split('\n')
          added = lines.length
          // 取 content 前30个字符作为摘要
          summary = (parsed.content || '').trim().slice(0, 50).replace(/\n/g, ' ')
        }
        
        ops.push({ 
          type: parsed.type, 
          path: parsed.path,
          added,
          removed,
          summary: summary ? summary + (summary.length >= 50 ? '...' : '') : '',
          // Store full content for expandable diff
          old_content: parsed.old_content || '',
          new_content: parsed.new_content || '',
          content: parsed.content || ''
        })
      }
    }
    // 按文件分组：同一文件的多次操作全部保留（此前按 path 去重会丢失前面的改动）
    const groups = new Map()
    for (const op of ops) {
      if (!groups.has(op.path)) groups.set(op.path, [])
      groups.get(op.path).push(op)
    }
    return Array.from(groups.entries()).map(([path, list]) => ({
      path,
      ops: list,
      added: list.reduce((s, o) => s + o.added, 0),
      removed: list.reduce((s, o) => s + o.removed, 0),
      summary: list[list.length - 1].summary,
    }))
  }, [content])

  const totals = useMemo(() => fileOps.reduce((acc, group) => ({
    added: acc.added + group.added,
    removed: acc.removed + group.removed,
  }), { added: 0, removed: 0 }), [fileOps])
  const startsCollapsed = fileOps.length >= FILE_SUMMARY_AUTO_COLLAPSE_FILES
    || totals.added + totals.removed > FILE_SUMMARY_AUTO_COLLAPSE_CHANGES
  const [expandedPaths, setExpandedPaths] = useState(new Set())
  const [collapsed, setCollapsed] = useState(startsCollapsed)

  useEffect(() => {
    setCollapsed(startsCollapsed)
  }, [startsCollapsed])

  const toggleExpand = useCallback((fp) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(fp)) next.delete(fp)
      else next.add(fp)
      return next
    })
  }, [])

  if (fileOps.length === 0) return null

  return (
    <div className="oa-file-summary">
      <button
        className={'oa-file-summary-header clickable' + (collapsed ? ' collapsed' : '')}
        type="button"
        onClick={() => setCollapsed(v => !v)}
        aria-expanded={!collapsed}
      >
        <FileText size={13} />
        <span>{ct('文件改动', 'File changes')} · {fileOps.length}</span>
        <span className="oa-file-summary-totals" aria-label={ct(`共新增 ${totals.added} 行，删除 ${totals.removed} 行`, `${totals.added} lines added, ${totals.removed} removed`)}>
          <span className="stat-added">+{totals.added}</span>
          <span className="stat-removed">−{totals.removed}</span>
        </span>
        <ChevronDown size={12} className={'oa-file-summary-toggle' + (collapsed ? '' : ' open')} />
      </button>
      {!collapsed && (
      <div className="oa-file-summary-list">
        {fileOps.map((group, i) => {
          const filename = group.path.split(/[/\\]/).pop() || group.path
          const expanded = expandedPaths.has(group.path)
          const multi = group.ops.length > 1
          // Compute diff rows on demand（每次操作各算一份）
          const diffResults = expanded
            ? group.ops.map(op => op.type === 'file_patch'
                ? computeLineDiff(op.old_content, op.new_content, { context: 3 })
                : computeWriteRows(op.content))
            : null
          return (
            <div key={i}>
              <div
                className={'oa-file-summary-item' + (expanded ? ' expanded' : '')}
                onClick={() => toggleExpand(group.path)}
                title={group.path}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onKeyDown={e => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    toggleExpand(group.path)
                  }
                }}
              >
                <ChevronDown size={11} className={'oa-file-chevron' + (expanded ? ' open' : '')} />
                <span className="oa-file-name">{filename}</span>
                <CopyButton
                  text={group.path}
                  compact
                  label={ct(`复制路径：${group.path}`, `Copy path: ${group.path}`)}
                  copiedLabel={ct('路径已复制', 'Path copied')}
                />
                {multi && <span className="oa-file-op-count">×{group.ops.length}</span>}
                <span className="oa-file-stats">
                  {group.removed > 0 && <span className="stat-removed">-{group.removed}</span>}
                  {group.added > 0 && <span className="stat-added">+{group.added}</span>}
                </span>
                {group.summary && !expanded && <span className="oa-file-preview">{group.summary}</span>}
              </div>
              {expanded && diffResults && group.ops.map((op, j) => (
                <div key={j}>
                  {multi && (
                    <div className="oa-file-op-label">
                      #{j + 1} · {op.type === 'file_patch' ? 'patch' : 'write'}
                      <span className="oa-file-stats">
                        {op.type === 'file_patch' && op.removed > 0 && <span className="stat-removed">-{op.removed}</span>}
                        {op.added > 0 && <span className="stat-added">+{op.added}</span>}
                      </span>
                    </div>
                  )}
                  <div className="oa-file-summary-diff">
                    <DiffRows rows={diffResults[j].rows} />
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
})

export function GoalStatusCard({ state, pending = false }) {
  const [snap, setSnap] = useState(() => normalizeGoalCardState(state))
  const [removed, setRemoved] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [clockNow, setClockNow] = useState(() => Date.now())
  useEffect(() => { setSnap(prev => ({ ...(prev || {}), ...(normalizeGoalCardState(state) || {}) })) }, [state])
  const status = String(snap?.status || '').toLowerCase()
  const terminal = removed || GOAL_CARD_TERMINAL.has(status)
  const stateFile = snap?.state_file || ''
  const goalId = snap?.id || ''
  useEffect(() => {
    if (terminal) return undefined
    const timer = setInterval(() => setClockNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [terminal])
  useEffect(() => {
    if ((!stateFile && !goalId) || terminal) return undefined
    let stop = false
    let timer = null
    const tick = async () => {
      try {
        const d = await api('/api/goals/list')
        if (stop) return
        const goals = Array.isArray(d?.goals) ? d.goals : []
        const hit = goals.find(g => (
          (stateFile && goalCardPathKey(g?.state_file) === goalCardPathKey(stateFile))
          || (goalId && String(g?.id || '') === String(goalId))
        ))
        if (hit) {
          setRemoved(false)
          setSnap(prev => normalizeGoalCardState({ ...(prev || {}), ...hit }))
        }
      } catch { /* 网络波动时保留旧快照 */ }
      if (!stop) timer = setTimeout(tick, 5000)
    }
    tick()
    return () => { stop = true; if (timer) clearTimeout(timer) }
  }, [stateFile, goalId, terminal])
  if (!snap) return null
  const startedAt = dateFromTimestamp(snap.start_time)?.getTime()
  const serverElapsed = Number(snap.elapsed_seconds || 0)
  const elapsedSeconds = !terminal && Number.isFinite(startedAt)
    ? Math.max(serverElapsed, Math.floor((clockNow - startedAt) / 1000))
    : serverElapsed
  const budgetTotal = Number(snap.budget_seconds || 0) || (serverElapsed + Number(snap.remaining_seconds || 0))
  const liveSnap = { ...snap, elapsed_seconds: elapsedSeconds, remaining_seconds: Math.max(0, budgetTotal - elapsedSeconds) }
  const info = goalCardStatusInfo(liveSnap.status, removed)
  const budgetPct = goalBudgetPercent(liveSnap)
  const turnPct = goalTurnPercent(liveSnap)
  const maxTurns = Number(liveSnap.max_turns || 0)
  const errText = liveSnap.error_class || liveSnap.last_error || ''
  const startTimeText = formatGoalCardTime(liveSnap.start_time)
  return (
    <div className={`oa-goalcard ${info.cls}`}>
      <button type="button" className="oa-goalcard-head" onClick={() => setCollapsed(v => !v)}
        aria-expanded={!collapsed} title={collapsed ? '展开目标详情' : '收起目标详情'}>
        <span className="oa-goalcard-mark"><Target size={15} /></span>
        <span className="oa-goalcard-title">
          <b>目标模式</b>
          <small>{liveSnap.objective || '(未提供目标描述)'}</small>
        </span>
        <em className={`oa-goalcard-chip ${info.cls}`}>{info.cls === 'is-running' && !removed ? <span className="oa-goalcard-dot" /> : null}{info.text}</em>
        <ChevronDown size={14} className={`oa-goalcard-chevron ${collapsed ? 'is-collapsed' : ''}`} />
      </button>
      {!collapsed && (
        <div className="oa-goalcard-body">
          <div className="oa-goalcard-bar">
            <span className="oa-goalcard-bar-label">时间预算</span>
            <span className="oa-goalcard-track"><span className="oa-goalcard-fill" style={{ width: `${budgetPct}%` }} /></span>
            <span className="oa-goalcard-bar-value">{formatDuration(liveSnap.elapsed_seconds || 0)}{budgetTotal ? ` / ${formatDuration(budgetTotal)}` : ''}</span>
          </div>
          <div className="oa-goalcard-bar">
            <span className="oa-goalcard-bar-label">轮次</span>
            <span className="oa-goalcard-track"><span className="oa-goalcard-fill" style={{ width: `${turnPct}%` }} /></span>
            <span className="oa-goalcard-bar-value">{Number(liveSnap.turns_used || 0)}{maxTurns ? ` / ${maxTurns}` : ''}</span>
          </div>
          <div className="oa-goalcard-meta">
            {startTimeText ? <span>启动 {startTimeText}</span> : null}
            {liveSnap.mode ? <span>模式 {liveSnap.mode}</span> : null}
            {liveSnap.pid ? <span>PID {liveSnap.pid}</span> : null}
            {removed ? <span>状态文件已清理</span> : null}
          </div>
          {liveSnap.summary ? <div className="oa-goalcard-summary">{String(liveSnap.summary)}</div> : null}
          {errText ? <div className="oa-goalcard-err">{String(errText)}</div> : null}
        </div>
      )}
    </div>
  )
}

export const CommandResultCard = memo(function CommandResultCard({ result = {} }) {
  const command = `/${String(result.command || '').replace(/^\//, '')}`
  const summary = commandResultSummary(result)
  const treeNodes = Array.isArray(result.tree?.nodes) ? result.tree.nodes : []
  const services = Array.isArray(result.services) ? result.services : []
  const commands = Array.isArray(result.commands) ? result.commands : []
  const records = Array.isArray(result.records) ? result.records : []
  const status = result.session && typeof result.session === 'object' ? result.session : null

  return (
    <section className="oa-command-result" aria-label={`${command} \u547d\u4ee4\u7ed3\u679c`}>
      <header><Check size={17}/><div><b>{summary}</b><span>{command}</span></div></header>
      {command === '/worldline' && result.action !== 'restore' && (
        treeNodes.length > 0
          ? <div className="oa-command-list" aria-label="\u4e16\u754c\u7ebf\u8282\u70b9">
              {treeNodes.map((node, index) => {
                const id = String(node?.id || node?.node_id || node?.key || '')
                const title = String(node?.title || node?.label || node?.summary || node?.content_preview || '')
                return <div key={id || index}><code>{id || `#${index + 1}`}</code><span>{title || '\u672a\u547d\u540d\u8282\u70b9'}</span></div>
              })}
            </div>
          : <div className="oa-command-empty">{'\u6682\u65e0\u4e16\u754c\u7ebf\u8282\u70b9'}</div>
      )}
      {services.length > 0 && <div className="oa-command-services">
        {services.map((service, index) => <div key={service?.name || index}>
          <i className={`oa-command-dot ${service?.running ? 'is-running' : ''}`}/>
          <b>{service?.name || `service-${index + 1}`}</b>
          <span>{service?.running ? '\u8fd0\u884c\u4e2d' : '\u672a\u8fd0\u884c'}</span>
          <em>{service?.status || service?.message || ''}</em>
        </div>)}
      </div>}
      {commands.length > 0 && <div className="oa-command-list">
        {commands.map((item, index) => {
          const name = typeof item === 'string' ? item : (item?.command || item?.name || '')
          const description = typeof item === 'string' ? '' : (item?.description || item?.usage || '')
          return <div key={name || index}><code>{name || `#${index + 1}`}</code><span>{description}</span></div>
        })}
      </div>}
      {status && command === '/status' && <dl className="oa-command-kv">
        <div><dt>Session</dt><dd>{status.id || '-'}</dd></div>
        <div><dt>Messages</dt><dd>{Number(status.message_count || 0)}</dd></div>
      </dl>}
      {records.length > 0 && <details className="oa-command-records"><summary>{records.length} \u6761\u5de5\u5177\u5ba1\u8ba1\u8bb0\u5f55</summary><pre>{JSON.stringify(records, null, 2)}</pre></details>}
      {command === '/export' && result.filename && <div className="oa-command-download"><FileOutput size={15}/><span>{result.filename}</span><b>{'\u5df2\u4e0b\u8f7d'}</b></div>}
    </section>
  )
})
