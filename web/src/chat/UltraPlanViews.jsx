import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { mergeUltraPlanStates, parseUltraPlanText, hasUltraPlanDashboardState, clampUltraPlanDrawerWidth, ULTRAPLAN_DRAWER_DEFAULT_WIDTH, getUltraPlanDrawerMaxWidth, ULTRAPLAN_DRAWER_MIN_WIDTH, taskFileName, parseUltraPlanResult } from './ultraPlan.js'
import { Sparkles, PanelRightOpen, X, ChevronDown, ChevronLeft, Clock3, Check, FileOutput, ExternalLink, ChevronRight } from 'lucide-react'
import { createPortal } from 'react-dom'
import { preferredUltraPlanOutputFile } from '../lib/ultraPlanTasks'
import { api } from '../lib/api'
import { ct } from './chatFormat.js'
import { parseSubagentOutput } from './subagentOutput.js'
import { ToolCallCollapse } from './ToolCallBlock.jsx'
import { MarkdownBlock } from './MarkdownBlocks.jsx'
import { assistantTurnFallbackTitle } from '../lib/chatTextSafety'
import Tag from 'antd/es/tag'
import Collapse from 'antd/es/collapse'

export function UltraPlanResultCard({ text = '' }) {
  const result = parseUltraPlanResult(text)
  if (!result) return null
  return <div className={`oa-ultraplan-result ${result.ok ? 'is-ok' : 'is-error'}`}>
    <div className="oa-ultraplan-head">
      <span className="oa-ultraplan-orb"><Sparkles size={16}/></span>
      <div><b>UltraPlan</b><small>{ct('显式 /ultraplan 调用结果', 'Explicit /ultraplan result')}</small></div>
      <em>{result.ok ? ct('完成', 'Completed') : ct('异常', 'Error')} · Exit {result.exitCodeText || '0'}</em>
    </div>
    {result.objective && <div className="oa-ultraplan-objective">{result.objective}</div>}
    <div className="oa-ultraplan-meta">
      {result.runDir && <span><b>Run dir</b><code>{result.runDir}</code></span>}
      {result.script && <span><b>Script</b><code>{result.script}</code></span>}
    </div>
    {(result.stdout || result.stderr) && <div className="oa-ultraplan-logs">
      {result.stdout && <details open><summary>stdout</summary><pre>{result.stdout}</pre></details>}
      {result.stderr && <details open={!result.ok}><summary>stderr</summary><pre>{result.stderr}</pre></details>}
    </div>}
  </div>
}

function SubagentOutputBlock({ text, onAskReply, isRunning }) {
  const { prefix, turns } = useMemo(() => parseSubagentOutput(text), [text])
  const latestKey = turns.length > 0 ? String(turns[turns.length - 1].n) : ''
  const [activeKeys, setActiveKeys] = useState(() => isRunning && latestKey ? [latestKey] : [])
  const previousLatestKeyRef = useRef(latestKey)
  const previousRunningRef = useRef(isRunning)

  // Follow a newly streamed turn while work is running, collapsing older turns.
  // A running -> terminal transition collapses everything once; subsequent
  // terminal renders preserve any turn the user manually reopens.
  useEffect(() => {
    const wasRunning = previousRunningRef.current
    const previousLatestKey = previousLatestKeyRef.current
    if (wasRunning && !isRunning) {
      setActiveKeys([])
    } else if (isRunning && latestKey && (!wasRunning || latestKey !== previousLatestKey)) {
      setActiveKeys([latestKey])
    }
    previousRunningRef.current = isRunning
    previousLatestKeyRef.current = latestKey
  }, [isRunning, latestKey])

  const renderSeg = (seg, i) => {
    if (seg.type === 'summary') return (
      <div key={i} className="sa-out-summary">{seg.text}</div>
    )
    if (seg.type === 'tool') return (
      <ToolCallCollapse key={i} name={seg.name} args={seg.args} />
    )
    if (seg.type === 'exec') return (
      <div key={i} className="sa-out-exec">{seg.text}</div>
    )
    if (seg.type === 'result') return (
      <div key={i} className="sa-out-result-block">
        <span className="sa-out-result-label">Result</span>
        <span className="sa-out-result-text">{seg.text}</span>
      </div>
    )
    if (seg.type === 'artifact') {
      const fname = seg.path.replace(/\\/g, '/').split('/').pop()
      return (
        <div key={i} className="sa-out-artifact">
          <span className="sa-out-artifact-label">Artifact</span>
          <span className="sa-out-artifact-path" title={seg.path}>{fname}</span>
        </div>
      )
    }
    if (seg.type === 'roundend') return (
      <div key={i} className="sa-out-roundend">&#x2014; Round End &#x2014;</div>
    )
    if (seg.type === 'text' && seg.text) return (
      <MarkdownBlock key={i} text={seg.text} onAskReply={onAskReply} />
    )
    return null
  }

  const turnItems = turns.map(t => {
    const summaryText = t.children.find(s => s.type === 'summary')?.text || ''
    const fallbackSource = t.children.map((seg) => {
      if (seg.type === 'tool') return `🛠️ ${seg.name}()`
      if (seg.type === 'text') return seg.text
      return ''
    }).filter(Boolean).join('\n')
    const fallbackText = assistantTurnFallbackTitle(fallbackSource, t.n)
    const previewSource = summaryText || fallbackText
    const preview = previewSource.slice(0, 52) + (previewSource.length > 52 ? '…' : '')
    const label = (
      <span className="sa-turn-label">
        <Tag color="purple" style={{ fontSize: 10, padding: '0 5px', lineHeight: '18px', marginRight: 6 }}>
          Turn {t.n}
        </Tag>
        {preview && <span className="sa-turn-preview">{preview}</span>}
      </span>
    )
    return {
      key: String(t.n),
      label,
      children: <div className="sa-turn-body">{t.children.map(renderSeg)}</div>
    }
  })

  return (
    <div className="sa-out">
      {prefix.map(renderSeg)}
      {turnItems.length > 0 && (
        <Collapse
          size="small"
          className="sa-turn-collapse"
          activeKey={activeKeys}
          onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys : (keys ? [keys] : []))}
          items={turnItems}
        />
      )}
    </div>
  )
}

function UltraPlanTaskRow({ task, onAskReply }) {
  const linesJoined = Array.isArray(task.output_lines) ? task.output_lines.join('\n') : ''
  const initialContent = task.output || linesJoined || ''
  const outputFile = preferredUltraPlanOutputFile(task)
  const status = task.status || 'running'
  const isRunning = status === 'running'
  const isFailed = status === 'fail' || status === 'failed'
  const [open, setOpen] = useState(() => isRunning)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [content, setContent] = useState(initialContent)
  // running tasks are always expandable (live stream), done tasks are always expandable
  const hasOutput = isRunning || status === 'done' || Boolean(task.output || linesJoined || outputFile)

  // When a task enters running state, open it by default. After it becomes done,
  // keep the current open state so the user can collapse it manually.
  useEffect(() => {
    if (isRunning) setOpen(true)
  }, [isRunning])

  // Sync content from SSE-pushed task.output / task.output_lines
  useEffect(() => {
    const next = task.output || (Array.isArray(task.output_lines) ? task.output_lines.join('\n') : '')
    if (next && next !== content) setContent(next)
  }, [task.output, task.output_lines])

  // Poll output file while running; do a final fetch when done (covers running→done transition)
  useEffect(() => {
    if (!open || !outputFile) return
    let cancelled = false
    const fetchFile = async () => {
      try {
        const d = await api(`/api/files/read?path=${encodeURIComponent(outputFile)}`)
        if (!cancelled && d?.content) setContent(d.content)
      } catch (_) {}
    }
    if (isRunning) {
      fetchFile() // immediate first fetch on open
      const timer = setInterval(fetchFile, 500)
      return () => { cancelled = true; clearInterval(timer) }
    } else {
      // Done: one-time fetch (handles: open after done, OR running→done while panel was open)
      fetchFile()
      return () => { cancelled = true }
    }
  }, [open, isRunning, outputFile])

  const toggle = async () => {
    if (!hasOutput) return
    const nextOpen = !open
    setOpen(nextOpen)
    // running tasks are handled by the polling useEffect above
    if (!nextOpen || isRunning || content || !outputFile) return
    setLoading(true)
    setError('')
    try {
      const d = await api(`/api/files/read?path=${encodeURIComponent(outputFile)}`)
      setContent(d?.content || '')
      if (!d?.content) setError('Output file is empty.')
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`oa-up-task-wrap ${status}${open ? ' is-open' : ''}`}>
      <div
        className={`oa-up-task ${status}${hasOutput ? ' has-output' : ''}`}
        onClick={hasOutput ? toggle : undefined}
        role={hasOutput ? 'button' : undefined}
        tabIndex={hasOutput ? 0 : undefined}
        aria-expanded={hasOutput ? open : undefined}
        onKeyDown={hasOutput ? (e) => (e.key === 'Enter' || e.key === ' ') && toggle() : undefined}
        title={outputFile || task.desc || ''}
      >
        <span className={`oa-up-task-dot oa-up-task-dot-${status}`} aria-hidden="true">
          {status === 'done' ? <Check size={12} /> : isFailed ? <X size={12} /> : <Clock3 size={12} />}
        </span>
        <span className="oa-up-task-desc">{task.desc}</span>
        {outputFile && <span className="oa-up-task-file">{taskFileName(outputFile)}</span>}
        {hasOutput && (
          <span className="oa-up-task-chevron-wrap">
            <ChevronRight size={13} className="oa-up-task-chevron" />
          </span>
        )}
      </div>
      {open && hasOutput && (
        <div className="oa-up-task-output">
          {loading && <div className="oa-up-task-output-meta">Loading output…</div>}
          {error && <div className="oa-up-task-output-error">{error}</div>}
          {!loading && !error && content && <SubagentOutputBlock text={content} onAskReply={onAskReply} isRunning={isRunning} />}
          {!loading && !error && !content && status === 'running' && (
            <div className="oa-up-task-output-waiting">
              <span className="oa-up-task-output-waiting-dot" /><span className="oa-up-task-output-waiting-dot" /><span className="oa-up-task-output-waiting-dot" />
              <span>{ct('等待输出…', 'Waiting for output…')}</span>
            </div>
          )}
          {!loading && !error && !content && status === 'done' && (
            <div className="oa-up-task-output-meta" style={{color:'var(--muted-2)',fontStyle:'italic'}}>{ct('暂无输出内容', 'No output yet')}</div>
          )}
        </div>
      )}
    </div>
  )
}

function UltraPlanDashboard({ state, onAskReply }) {
  const [expanded, setExpanded] = useState(true)
  const panelId = React.useId()
  const { objective, phases = [], recentTasks = [], complete, events = [], resultFiles = [], current, taskOutputs = {}, task_outputs = {} } = state
  const outputsMap = (taskOutputs && Object.keys(taskOutputs).length) ? taskOutputs : (task_outputs || {})
  const phaseTasks = phases.flatMap((phase) => Array.isArray(phase.tasks) ? phase.tasks : [])
  const trackedItems = phases.length ? phases : recentTasks
  const completedItems = complete ? trackedItems.length : trackedItems.filter((item) => item?.status === 'done').length
  const progressPercent = complete ? 100 : (trackedItems.length ? Math.round((completedItems / trackedItems.length) * 100) : 0)
  const taskCount = phaseTasks.length || recentTasks.length
  const hasFailure = [...phases, ...phaseTasks, ...recentTasks].some((item) => item?.status === 'fail' || item?.status === 'failed')
  const hasWork = Boolean(current || phases.length || recentTasks.length)
  const statusTone = complete ? 'done' : hasFailure ? 'failed' : hasWork ? 'run' : 'pending'
  const statusLabel = complete ? '\u5df2\u5b8c\u6210' : hasFailure ? '\u9700\u5173\u6ce8' : hasWork ? '\u6267\u884c\u4e2d' : '\u51c6\u5907\u4e2d'
  const progressLabel = phases.length
    ? `${completedItems} / ${phases.length} \u9636\u6bb5\u5b8c\u6210`
    : recentTasks.length
      ? `${completedItems} / ${recentTasks.length} \u4efb\u52a1\u5b8c\u6210`
      : complete ? '\u6267\u884c\u5df2\u5b8c\u6210' : '\u7b49\u5f85\u6267\u884c\u6b65\u9aa4'
  const isEmpty = !current && phases.length === 0 && recentTasks.length === 0 && resultFiles.length === 0
  const openFile = (fp) => {
    if (!fp) return
    const u = `/api/files/read?path=${encodeURIComponent(fp)}`
    window.open(u, '_blank', 'noopener')
  }
  return (
    <div className={`oa-up-dash oa-up-${statusTone}${expanded ? '' : ' is-collapsed'}`}>
      <button type="button" className="oa-up-head" onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded} aria-controls={panelId}
        aria-label={expanded ? '\u6536\u8d77 UltraPlan \u6267\u884c\u9762\u677f' : '\u5c55\u5f00 UltraPlan \u6267\u884c\u9762\u677f'}>
        <span className="oa-up-icon oa-up-mark" aria-hidden="true"><Sparkles size={15} strokeWidth={2.1} /></span>
        <span className="oa-up-heading">
          <span className="oa-up-title-row">
            <span className="oa-up-title">UltraPlan</span>
            <span className="oa-up-kicker">{'\u4efb\u52a1\u7f16\u6392'}</span>
          </span>
          <span className="oa-up-obj">{objective || '\u7b49\u5f85\u4efb\u52a1\u76ee\u6807'}</span>
        </span>
        <span className={`oa-up-badge oa-up-${statusTone}`}>{statusLabel}</span>
        <span className="oa-up-chevron" aria-hidden="true">
          {expanded ? <ChevronDown size={15} /> : <ChevronLeft size={15} />}
        </span>
      </button>
      <div id={panelId} className="oa-up-body" hidden={!expanded}>
        <section className="oa-up-overview" aria-label="UltraPlan \u6267\u884c\u6458\u8981">
          <div className="oa-up-progress-head">
            <div>
              <span className="oa-up-section-label">{'\u6267\u884c\u8fdb\u5ea6'}</span>
              <strong className="oa-up-progress-copy">{progressLabel}</strong>
            </div>
            <span className="oa-up-progress-value">{progressPercent}<small>%</small></span>
          </div>
          <div className="oa-up-progress-track" role="progressbar" aria-label="UltraPlan \u6267\u884c\u8fdb\u5ea6"
            aria-valuemin="0" aria-valuemax="100" aria-valuenow={progressPercent}>
            <span style={{ '--oa-up-progress': progressPercent / 100 }} />
          </div>
          <div className="oa-up-stats" aria-label="\u6267\u884c\u7edf\u8ba1">
            <span><strong>{phases.length}</strong>{' \u9636\u6bb5'}</span>
            <span><strong>{taskCount}</strong>{' \u4efb\u52a1'}</span>
            <span><strong>{resultFiles.length}</strong>{' \u4ea7\u7269'}</span>
          </div>
          {!complete && current && (
            <div className="oa-up-current">
              <span className="oa-up-current-dot" aria-hidden="true" />
              <span className="oa-up-current-label">{'\u5f53\u524d'}</span>
              <span>{current}</span>
            </div>
          )}
        </section>

        {isEmpty && (
          <div className="oa-up-empty">
            <Clock3 size={16} aria-hidden="true" />
            <div><strong>{'\u7b49\u5f85 UltraPlan \u53d1\u5e03\u6b65\u9aa4'}</strong><span>{'\u8ba1\u5212\u5f00\u59cb\u540e\uff0c\u9636\u6bb5\u548c\u4efb\u52a1\u4f1a\u5728\u8fd9\u91cc\u5b9e\u65f6\u66f4\u65b0\u3002'}</span></div>
          </div>
        )}

        {recentTasks.length > 0 && phases.length === 0 && (
          <section className="oa-up-section oa-up-recent">
            <div className="oa-up-section-head">
              <span className="oa-up-section-label">{'\u6267\u884c\u4efb\u52a1'}</span>
              <span>{recentTasks.length}</span>
            </div>
            <div className="oa-up-tasks">
              {recentTasks.map((task, i) => {
                const lines = (task && task.id && outputsMap && outputsMap[task.id]) ? outputsMap[task.id] : null
                const injected = lines && lines.length ? { ...task, output_lines: lines } : task
                return <UltraPlanTaskRow key={task?.id || i} task={injected} onAskReply={onAskReply} />
              })}
            </div>
          </section>
        )}

        {phases.length > 0 && (
          <section className="oa-up-section oa-up-phase-section">
            <div className="oa-up-section-head">
              <span className="oa-up-section-label">{'\u6267\u884c\u9636\u6bb5'}</span>
              <span>{completedItems}/{phases.length}</span>
            </div>
            <div className="oa-up-phases">
              {phases.map((ph, i) => {
                const phaseFailed = ph.status === 'fail' || ph.status === 'failed'
                return (
                  <div key={ph.id || ph.name || i} className={`oa-up-phase ${ph.status || 'running'}`}>
                    <span className="oa-up-phase-icon" aria-hidden="true">
                      {ph.status === 'done' ? <Check size={13} /> : phaseFailed ? <X size={13} /> : <Clock3 size={13} />}
                    </span>
                    <div className="oa-up-phase-body">
                      <div className="oa-up-phase-info">
                        <span className="oa-up-phase-name">{ph.name}</span>
                        {ph.desc && <span className="oa-up-phase-desc">{ph.desc}</span>}
                        {ph.elapsed && <span className="oa-up-phase-time">{ph.elapsed}</span>}
                      </div>
                      {ph.tasks && ph.tasks.length > 0 && (
                        <div className="oa-up-tasks">
                          {ph.tasks.map((task, j) => {
                            const lines = (task && task.id && outputsMap && outputsMap[task.id]) ? outputsMap[task.id] : null
                            const injected = lines && lines.length ? { ...task, output_lines: lines } : task
                            return <UltraPlanTaskRow key={task?.id || j} task={injected} onAskReply={onAskReply} />
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {resultFiles.length > 0 && (
          <section className="oa-up-files">
            <div className="oa-up-files-head">
              <span className="oa-up-section-label">{'\u4ea7\u51fa\u6587\u4ef6'}</span>
              <span>{resultFiles.length}</span>
            </div>
            <div className="oa-up-files-list">
              {resultFiles.map((result, i) => (
                <button type="button" key={result.file || i} className="oa-up-file-item" onClick={() => openFile(result.file)} title={result.file}>
                  <span className="oa-up-file-icon" aria-hidden="true"><FileOutput size={15} /></span>
                  <span className="oa-up-file-body">
                    <span className="oa-up-file-desc">{result.desc || taskFileName(result.file)}</span>
                    <span className="oa-up-file-path">{result.file}</span>
                  </span>
                  <ExternalLink size={13} className="oa-up-file-open" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        )}

        {events.length > 0 && (
          <details className="oa-up-events">
            <summary><span>{'\u8fd0\u884c\u65e5\u5fd7'}</span><span className="oa-up-events-count">{events.length}</span></summary>
            <div className="oa-up-events-body">
              {events.map((event, i) => (
                <div key={i} className={`oa-up-event oa-up-event-${event.tag}`}>
                  <span className="oa-up-event-tag">[{event.tag}]</span>
                  <span className="oa-up-event-body">{event.body}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

export function UltraPlanMessageDrawer({ content = '', state, pending = false, onAskReply }) {
  const mergedState = useMemo(
    () => mergeUltraPlanStates(state, parseUltraPlanText(content)),
    [state, content],
  )
  const available = hasUltraPlanDashboardState(mergedState)
  const [open, setOpen] = useState(false)
  const [drawerWidth, setDrawerWidth] = useState(() => clampUltraPlanDrawerWidth(ULTRAPLAN_DRAWER_DEFAULT_WIDTH))
  const [drawerMaxWidth, setDrawerMaxWidth] = useState(() => getUltraPlanDrawerMaxWidth())
  const [resizing, setResizing] = useState(false)
  const entryRef = useRef(null)
  const drawerWidthRef = useRef(drawerWidth)
  const resizeSessionRef = useRef(null)
  const autoOpenedRef = useRef(false)
  const userDismissedRef = useRef(false)
  const drawerId = React.useId()
  const titleId = `${drawerId}-title`

  const applyDrawerWidth = useCallback((nextWidth) => {
    const maxWidth = getUltraPlanDrawerMaxWidth()
    const width = clampUltraPlanDrawerWidth(nextWidth, maxWidth)
    drawerWidthRef.current = width
    setDrawerMaxWidth(maxWidth)
    setDrawerWidth(width)
  }, [])

  const beginDrawerResize = useCallback((event) => {
    if (event.button != null && event.button !== 0) return
    const startX = Number.isFinite(event.clientX) ? event.clientX : 0
    resizeSessionRef.current = {
      pointerId: event.pointerId,
      startX,
      startWidth: drawerWidthRef.current,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setResizing(true)
    event.preventDefault()
  }, [])

  const moveDrawerResize = useCallback((event) => {
    const session = resizeSessionRef.current
    if (!session || (session.pointerId != null && event.pointerId !== session.pointerId)) return
    const clientX = Number.isFinite(event.clientX) ? event.clientX : session.startX
    applyDrawerWidth(session.startWidth + session.startX - clientX)
    event.preventDefault()
  }, [applyDrawerWidth])

  const finishDrawerResize = useCallback((event) => {
    const session = resizeSessionRef.current
    if (!session || (session.pointerId != null && event.pointerId !== session.pointerId)) return
    resizeSessionRef.current = null
    setResizing(false)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const resizeDrawerFromKeyboard = useCallback((event) => {
    const step = event.shiftKey ? 64 : 32
    let nextWidth = null
    if (event.key === 'ArrowLeft') nextWidth = drawerWidthRef.current + step
    else if (event.key === 'ArrowRight') nextWidth = drawerWidthRef.current - step
    else if (event.key === 'Home') nextWidth = ULTRAPLAN_DRAWER_MIN_WIDTH
    else if (event.key === 'End') nextWidth = getUltraPlanDrawerMaxWidth()
    if (nextWidth == null) return
    event.preventDefault()
    applyDrawerWidth(nextWidth)
  }, [applyDrawerWidth])

  const closeDrawer = useCallback(() => {
    userDismissedRef.current = true
    setOpen(false)
    const restoreFocus = () => entryRef.current?.focus()
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restoreFocus)
    else setTimeout(restoreFocus, 0)
  }, [])

  useEffect(() => {
    const syncWidthToViewport = () => applyDrawerWidth(drawerWidthRef.current)
    syncWidthToViewport()
    window.addEventListener('resize', syncWidthToViewport)
    return () => window.removeEventListener('resize', syncWidthToViewport)
  }, [applyDrawerWidth])

  useEffect(() => {
    if (!available || !pending || mergedState?.complete || autoOpenedRef.current || userDismissedRef.current) return
    autoOpenedRef.current = true
    setOpen(true)
  }, [available, pending, mergedState?.complete])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeDrawer()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, closeDrawer])

  if (!available) return null

  const phases = Array.isArray(mergedState.phases) ? mergedState.phases : []
  const recentTasks = Array.isArray(mergedState.recentTasks) ? mergedState.recentTasks : []
  const phaseTasks = phases.flatMap(phase => Array.isArray(phase.tasks) ? phase.tasks : [])
  const total = phaseTasks.length || recentTasks.length || phases.length
  const done = mergedState.complete
    ? total
    : (phaseTasks.length ? phaseTasks : (recentTasks.length ? recentTasks : phases))
      .filter(item => String(item?.status || '').toLowerCase() === 'done').length
  const statusText = mergedState.complete
    ? '\u5df2\u5b8c\u6210'
    : (pending ? '\u6267\u884c\u4e2d' : '\u53ef\u67e5\u770b')
  const objective = String(mergedState.objective || mergedState.current || '\u67e5\u770b\u8ba1\u5212\u4e0e\u5b50\u4efb\u52a1\u8fdb\u5c55')

  return (
    <div className="oa-message-ultraplan">
      <button
        ref={entryRef}
        type="button"
        className="oa-up-entry"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpen(true)}
      >
        <span className="oa-up-entry-mark" aria-hidden="true"><Sparkles size={15} /></span>
        <span className="oa-up-entry-copy">
          <b>UltraPlan</b>
          <small>{objective}</small>
        </span>
        <span className={`oa-up-entry-status ${mergedState.complete ? 'is-done' : 'is-running'}`}>
          {statusText}{total > 0 ? ` \u00b7 ${done}/${total}` : ''}
        </span>
        <PanelRightOpen size={16} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div className="oa-message-ultraplan oa-up-drawer-layer" data-ultraplan-drawer-owner="message">
          <aside
            id={drawerId}
            className={`oa-up-drawer ${resizing ? 'is-resizing' : ''}`}
            role="region"
            aria-labelledby={titleId}
            style={{ '--oa-up-drawer-width': `${drawerWidth}px` }}
          >
            <div
              className="oa-up-drawer-resize"
              role="separator"
              aria-label={'\u8c03\u6574 UltraPlan \u4fa7\u680f\u5bbd\u5ea6'}
              aria-orientation="vertical"
              aria-controls={drawerId}
              aria-valuemin={ULTRAPLAN_DRAWER_MIN_WIDTH}
              aria-valuemax={drawerMaxWidth}
              aria-valuenow={drawerWidth}
              aria-valuetext={`${drawerWidth} px`}
              tabIndex={0}
              onPointerDown={beginDrawerResize}
              onPointerMove={moveDrawerResize}
              onPointerUp={finishDrawerResize}
              onPointerCancel={finishDrawerResize}
              onKeyDown={resizeDrawerFromKeyboard}
            />
            <header className="oa-up-drawer-head">
              <span className="oa-up-drawer-kicker">MESSAGE-LINKED PLAN</span>
              <div>
                <h2 id={titleId}>UltraPlan</h2>
                <p>{objective}</p>
              </div>
              <button type="button" className="oa-up-drawer-close" aria-label={'\u5173\u95ed UltraPlan \u8be6\u60c5'} onClick={closeDrawer}>
                <X size={18} />
              </button>
            </header>
            <div className="oa-up-drawer-scroll">
              <UltraPlanDashboard state={mergedState} onAskReply={onAskReply} />
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </div>
  )
}
