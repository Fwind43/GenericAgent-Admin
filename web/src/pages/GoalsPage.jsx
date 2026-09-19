import './goals-workbench.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Copy, Eye, Play, RefreshCw, Square, Target, Terminal, Trash2, XCircle } from 'lucide-react'
import { copyText, formatBytes, formatDuration, formatGoalTime, goalBudgetPercent, goalTurnPercent, modelLabel, outputLineCount } from '../lib/format'
import { Panel } from '../components/common'
import { TurnList } from '../components/turns'

export function GoalsPage({ t, goals, objective, setObjective, budget, setBudget, maxTurns, setMaxTurns, llmNo, setLLMNo, llms = [], hive, setHive, outputBytes, setOutputBytes, autoRefresh, setAutoRefresh, selected, output, outputMeta, busy, onStart, onStop, onDelete, onRefresh, onOutput, onClearOutput, setMsg }) {
  const goalList = goals || []
  const running = goalList.filter(g => g.running).length
  const selectedGoal = goalList.find(g => g.id === selected) || outputMeta?.goal || null
  const [goalTab, setGoalTab] = useState('runs')
  const outputBadges = []
  if (outputMeta?.error) outputBadges.push(`${t.error}: ${outputMeta.error}`)
  if (outputMeta?.truncated) outputBadges.push(`${t.hints.goalOutputTruncated}: ${formatBytes(outputMeta.bytesReturned)}/${formatBytes(outputMeta.totalBytes)}`)
  if (outputMeta?.maxBytesCapped) outputBadges.push(`${t.hints.goalOutputCapped}: ${formatBytes(outputMeta.requestedBytes)} -> ${formatBytes(outputMeta.maxBytes)}`)
  if (outputMeta?.defaultBytesUsed) outputBadges.push(`${t.hints.goalOutputDefault}: ${formatBytes(outputMeta.defaultBytes || outputMeta.maxBytes)}`)
  if (outputMeta?.outputStatus) outputBadges.push(`${t.fields.outputStatus}: ${t.goalOutputStatus?.[outputMeta.outputStatus] || outputMeta.outputStatus}`)
  if (outputMeta?.goal?.missing_log) outputBadges.push(t.hints.goalOutputLogMissing)

  const outputBytesShown = outputMeta?.bytesReturned ?? new Blob([output || '']).size
  const outputTotalBytes = outputMeta?.totalBytes ?? outputBytesShown
  const outputLinesShown = outputMeta?.linesReturned ?? outputLineCount(output)
  const outputTotalLines = outputMeta?.totalLines ?? outputLinesShown
  const outputLimitLabel = Number(outputBytes || 0) > 0 ? formatBytes(outputBytes) : t.fields.outputDefault
  const selectedTurnPct = selectedGoal ? goalTurnPercent(selectedGoal) : 0
  const selectedBudgetPct = selectedGoal ? goalBudgetPercent(selectedGoal) : 0

  const copyOutput = async () => {
    try { await copyText(output || ''); setMsg(t.hints.goalOutputCopied) }
    catch (e) { setMsg(e.message) }
  }
  const openOutput = (id) => { onOutput(id); setGoalTab('output') }
  const showStatePath = (path) => { if (path) setMsg(`${t.fields.stateFile}: ${path}`) }

  return <section className="goals-page" aria-busy={busy}>
    <div className="stats schedule-stats goal-stats">
      <div className="stat"><Target/><span>{t.nav.goals}</span><b>{goalList.length}</b></div>
      <div className="stat"><Activity/><span>{t.running}</span><b>{running}</b></div>
      <div className="stat"><Terminal/><span>reflect/goal_mode.py</span><b>{running ? t.running : t.ready}</b></div>
    </div>

    <div className="goal-tabs" role="tablist" aria-label={t.nav.goals}>
      <button role="tab" aria-selected={goalTab==='runs'} className={goalTab==='runs' ? 'active' : ''} onClick={()=>setGoalTab('runs')}>{t.fields.goalRuns}<span>{goalList.length}</span></button>
      <button role="tab" aria-selected={goalTab==='start'} className={goalTab==='start' ? 'active' : ''} onClick={()=>setGoalTab('start')}>{t.fields.startGoalMode}</button>
      <button role="tab" aria-selected={goalTab==='output'} className={goalTab==='output' ? 'active' : ''} onClick={()=>setGoalTab('output')}>{t.fields.outputTail}<span>{selected || '-'}</span></button>
    </div>

    {goalTab==='start' && <Panel title={t.fields.startGoalMode} className="goal-start-panel goal-tab-panel">
      <p className="muted">{t.desc.goals}</p>
      <label className="goal-field">{t.fields.objective}
        <textarea className="goal-objective" value={objective} maxLength={16384} onChange={e=>setObjective(e.target.value)} placeholder={t.fields.goalPlaceholder}/>
      </label>
      <div className="form-grid compact-form goal-params">
        <label>{t.fields.budgetMinutes}<input type="number" min="1" max="43200" value={budget} onChange={e=>setBudget(e.target.value)}/></label>
        <label>{t.fields.maxTurns}<input type="number" min="0" max="10000" value={maxTurns} onChange={e=>setMaxTurns(e.target.value)}/></label>
        <label>{t.fields.llmNo}<select value={llmNo} onChange={e=>setLLMNo(e.target.value)}>
          <option value="">{t.service?.defaultModel || 'Default'}</option>
          {llms.map(m => <option key={m.index} value={m.index}>{modelLabel(m)}</option>)}
        </select></label>
      </div>
      <label className="inline-field goal-hive-toggle"><input type="checkbox" checked={!!hive} onChange={e=>setHive?.(e.target.checked)}/><span>{t.fields.goalHive}</span></label>
      <p className="muted">{t.hints.goalHiveHelp}</p>
      <div className="actions goal-start-actions">
        <button className="primary" disabled={busy || !objective.trim()} onClick={onStart}><Play size={14}/>{t.start}</button>
        <button disabled={busy} onClick={onRefresh}><RefreshCw size={14}/>{t.refresh}</button>
      </div>
    </Panel>}

    {goalTab==='runs' && <Panel title={t.fields.goalRuns} className="goals-list-panel goal-tab-panel">
      <div className="actions goal-list-toolbar"><button disabled={busy} onClick={onRefresh}><RefreshCw size={14}/>{t.refresh}</button></div>
      <div className="goal-list clean-list goal-list-tabbed">
        {goalList.length ? goalList.map(g => <GoalRunCard key={g.id} g={g} t={t} selected={selected} onOutput={openOutput} onState={showStatePath} onStop={onStop} onDelete={onDelete}/>) : <p className="empty-card" role="status">{t.empty}</p>}
      </div>
    </Panel>}

    {goalTab==='output' && <Panel title={`${t.fields.outputTail} · ${selected || '-'}`} className="log-panel goal-output-panel goal-tab-panel">
      {selectedGoal ? <div className="goal-focus-card">
        <div className="goal-focus-main">
          <div className="goal-summary-head"><b>{selectedGoal.id}</b><span className={selectedGoal.running ? 'ok' : ''}>{selectedGoal.status || (selectedGoal.running ? t.running : t.fields.notRunning)}</span></div>
          <p>{selectedGoal.objective || t.empty}</p>
          <div className="goal-progress summary-progress"><span title={`${t.fields.turn} ${Math.round(selectedTurnPct)}%`}><i style={{width: `${selectedTurnPct}%`}} /></span><span title={`${t.fields.elapsed} ${Math.round(selectedBudgetPct)}%`}><i style={{width: `${selectedBudgetPct}%`}} /></span></div>
        </div>
        <div className="goal-summary-grid goal-focus-grid">
          <span>{t.fields.turn}: {selectedGoal.turns_used || 0}/{selectedGoal.max_turns || '-'}</span>
          <span>{t.fields.elapsed}: {formatDuration(selectedGoal.elapsed_seconds)}</span>
          <span>{t.fields.remaining}: {formatDuration(selectedGoal.remaining_seconds)}</span>
          <span>{t.fields.updated}: {formatGoalTime(selectedGoal.mod_time)}</span>
        </div>
        <div className="goal-summary-files"><button disabled={!selectedGoal.state_file} onClick={()=>showStatePath(selectedGoal.state_file)}>{t.fields.stateFile}</button><button disabled={!selectedGoal.id || selectedGoal.missing_log} onClick={()=>openOutput(selectedGoal.id)}>{t.fields.logFile}</button></div>
      </div> : <div className="goal-focus-empty">{t.empty}</div>}

      <details className="goal-controls-details">
        <summary>{t.fields.maxBytes} / {t.fields.outputLimit} · {outputLimitLabel}</summary>
        <div className="goal-toolbar">
          <label className="inline-field">{t.fields.maxBytes}
            <input type="number" min="0" max="1048576" step="4096" value={outputBytes} onChange={e=>setOutputBytes(e.target.value)}/>
          </label>
          <div className="goal-output-presets">
            <button type="button" onClick={()=>setOutputBytes('65536')}>{t.fields.outputPreset64k}</button>
            <button type="button" onClick={()=>setOutputBytes('262144')}>{t.fields.outputPreset256k}</button>
            <button type="button" onClick={()=>setOutputBytes('1048576')}>{t.fields.outputPreset1m}</button>
            <button type="button" onClick={()=>setOutputBytes('0')}>{t.fields.outputDefault}</button>
          </div>
          <label className="toggle-inline"><input type="checkbox" checked={!!autoRefresh} onChange={e=>setAutoRefresh(e.target.checked)} />{t.fields.autoRefresh}</label>
          <button disabled={!selected} onClick={()=>onOutput(selected)}><RefreshCw size={14}/>{t.refresh}</button>
          <button disabled={!output} onClick={copyOutput}><Copy size={14}/>{t.copy}</button>
          <button disabled={!output && !outputMeta} onClick={onClearOutput}><XCircle size={14}/>{t.clear}</button>
        </div>
      </details>

      <div className="goal-output-stats compact">
        <span>{t.fields.outputShown}: {formatBytes(outputBytesShown)} / {formatBytes(outputTotalBytes)}</span>
        <span>{t.fields.outputLines}: {outputLinesShown}{outputTotalLines !== outputLinesShown ? ` / ${outputTotalLines}` : ''}</span>
      </div>
      {outputBadges.length > 0 && <div className="goal-output-meta" role={outputMeta?.error ? 'alert' : 'status'}>{outputBadges.map(m => <span key={m}>{m}</span>)}</div>}
      <GoalChatView output={output} empty={t.empty} />
    </Panel>}
  </section>
}

function parseGoalOutput(output) {
  const text = output || ''
  const lines = text.split(/\r?\n/)
  const items = []
  let current = null
  const push = () => {
    if (!current) return
    current.content = current.content.join('\n').trimEnd()
    if (current.content || current.title) items.push(current)
    current = null
  }
  const classify = (raw) => {
    const line = raw.trim()
    if (!line) return null
    let m = line.match(/^<summary>(.*?)<\/summary>\s*(.*)$/i)
    if (m) return { type:'summary', role:'assistant', title:'summary', content:[m[1] || '', m[2] || ''].filter(Boolean).join('\n') }
    m = line.match(/^\[Agent\]\s*(.*)$/i)
    if (m) return { type:'agent', role:'assistant', title:'Agent', content:m[1] }
    m = line.match(/^\[(USER|ASSISTANT|SYSTEM|TOOL|FUNCTION|DEVELOPER)\]\s*:?\s*(.*)$/i)
    if (m) return { type:m[1].toLowerCase(), role:m[1].toLowerCase()==='user'?'user':'assistant', title:m[1].toLowerCase(), content:m[2] }
    m = line.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[,\.]\d+)?)(?:\s+|\s*[-|]\s*)(.*)$/)
    if (m) return { type:'log', role:'system', title:m[1], content:m[2] }
    if (/^(ERROR|ERR|FAIL|FAILED|EXCEPTION|TRACEBACK)\b/i.test(line)) return { type:'error', role:'system', title:'error', content:raw }
    if (/^(WARN|WARNING)\b/i.test(line)) return { type:'warn', role:'system', title:'warning', content:raw }
    if (/^(INFO|DEBUG|STATUS|STEP|TURN|GOAL|PLAN|ACTION|OBSERVATION|RESULT)\b[:：\]]?/i.test(line)) return { type:'event', role:'system', title:line.split(/[:：\]]/)[0].slice(0,24), content:raw }
    return null
  }
  for (const raw of lines) {
    const hit = classify(raw)
    if (hit) {
      push()
      current = { role:hit.role, type:hit.type, title:hit.title, content:[hit.content || ''] }
    } else if (current) {
      current.content.push(raw)
    } else if (raw.trim()) {
      current = { role:'system', type:'raw', title:'log', content:[raw] }
    }
  }
  push()
  return items.map((m, i) => ({ id:`goal-${i}`, ...m }))
}

function GoalChatView({ output, empty }) {
  const items = useMemo(() => parseGoalOutput(output), [output])
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block:'end' }) }, [items.length, output])
  if (!output) return <div className="goal-chat-empty">{empty}</div>
  return <div className="goal-chat-wrap">
    <div className="goal-chat-stream" aria-live="polite">
      <TurnList messages={items} empty={empty} className="goal-turn-list"/>
      <div ref={endRef} />
    </div>
    <details className="goal-raw-details">
      <summary>Raw log</summary>
      <pre className="log-view goal-output">{output}</pre>
    </details>
  </div>
}

function GoalRunCard({ g, t, selected, onOutput, onState, onStop, onDelete }) {
  const turnPct = goalTurnPercent(g)
  const budgetPct = goalBudgetPercent(g)
  const originLabel = t.goalOrigins?.[g.origin] || g.origin || '-'
  const stopLevelLabel = t.goalStopLevels?.[g.stop_level] || g.stop_level || '-'
  const trustLabel = g.pid_trusted ? (t.goalTrust?.trusted || 'PID trusted') : (t.goalTrust?.untrusted || 'PID untrusted')
  const pidLabel = g.running ? (g.pid ? `${t.fields.pid} ${g.pid}` : t.running) : t.fields.notRunning
  const actions = Array.isArray(g.actions) ? g.actions : []
  const canStop = actions.length ? actions.includes('stop') : (!!g.running && !!g.id && (!g.managed || !!g.pid))
  const canDelete = actions.length ? actions.includes('delete') : !g.running
  const statusTitle = [g.raw_status && `${t.fields.rawStatus}: ${g.raw_status}`, g.last_event && `${t.fields.lastEvent}: ${g.last_event}`, g.error_class && `${t.fields.errorClass}: ${g.error_class}`].filter(Boolean).join(' · ')
  const statusClass = g.error_class ? 'err-text' : (g.running ? 'ok' : '')
  return <div className={`goal-row ${g.running ? 'running' : ''} ${g.origin === 'external' ? 'external' : ''} ${selected===g.id ? 'selected' : ''}`}>
    <button className="goal-row-main" onClick={()=>onOutput(g.id)}>
      <div className="goal-row-title"><b>{g.id}</b><span className={statusClass} title={statusTitle}>{g.status || '-'}</span></div>
      <div className="goal-row-meta">
        <span>{pidLabel}</span>
        <span>{t.fields.source} {originLabel}</span>
        <span>{t.fields.control} {stopLevelLabel}</span>
        <span className={g.pid_trusted ? 'ok' : 'warn-text'}>{trustLabel}</span>
        {g.raw_status && g.raw_status !== g.status ? <span>{t.fields.rawStatus} {g.raw_status}</span> : null}
        {g.last_event ? <span title={g.last_event}>{t.fields.lastEvent} {g.last_event}</span> : null}
        {g.error_class ? <span className="err-text">{t.fields.errorClass} {g.error_class}</span> : null}
        <span>{t.fields.turn} {g.turns_used || 0}/{g.max_turns || '-'}</span>
        <span>{t.fields.elapsed} {formatDuration(g.elapsed_seconds)}</span>
        <span>{t.fields.remaining} {formatDuration(g.remaining_seconds)}</span>
        {g.mode ? <span>{g.mode}</span> : null}
        {g.hive?.readme_url ? <span>{t.fields.hiveBoard} {g.hive.readme_url}</span> : null}
        {g.hive?.worker_pid ? <span>{t.fields.hiveWorker} PID {g.hive.worker_pid}</span> : null}
        {g.hive?.cwd ? <span>{t.fields.hiveCwd} {g.hive.cwd}</span> : null}
        {g.python_path ? <span>Python {g.python_path}</span> : null}
      </div>
      <div className="goal-progress"><span title={`${t.fields.turn} ${Math.round(turnPct)}%`}><i style={{width: `${turnPct}%`}} /></span><span title={`${t.fields.elapsed} ${Math.round(budgetPct)}%`}><i style={{width: `${budgetPct}%`}} /></span></div>
      <p>{g.objective || t.empty}</p>
      <small>{t.fields.started} {formatGoalTime(g.start_time ? g.start_time * 1000 : 0)} · {t.fields.updated} {formatGoalTime(g.mod_time)}{g.end_time ? ` · ${t.fields.ended} ${formatGoalTime(g.end_time * 1000)}` : ''}</small>
      <em><span className={g.missing_log ? 'err-text' : 'ok'}>{g.missing_log ? t.fields.logMissing : t.fields.logReady}</span></em>
    </button>
    <div className="actions goal-row-actions">
      <button onClick={()=>onOutput(g.id)}><Eye size={14}/>{t.read}</button>
      <button disabled={!g.state_file} onClick={()=>onState(g.state_file)}>{t.fields.stateFile}</button>
      <button disabled={!g.id || g.missing_log} onClick={()=>onOutput(g.id)}>{t.fields.logFile}</button>
      <button disabled={!canStop} title={g.managed ? (g.pid_trusted ? t.goalStopLevels?.exact_pid : t.goalTrust?.untrusted) : t.goalStopLevels?.soft_state} onClick={()=>onStop(g)}><Square size={14}/>{t.stop}</button>
      <button className="danger" disabled={!canDelete} title={!canDelete ? t.hints.goalDeleteRunning : t.hints.goalDeleteConfirm.replace('{id}', g.id || '-')} onClick={()=>onDelete?.(g)}><Trash2 size={14}/>{t.delete}</button>
    </div>
  </div>
}
