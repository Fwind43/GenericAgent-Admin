import './logs-workbench.css'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Check, Copy, Download, Play, RefreshCw, Search, Square, Trash2, WrapText, X } from 'lucide-react'
import { copyText } from '../lib/format'
import { buildLogRows, splitLogMatch } from '../lib/logLines'

const COPIED_FOR_MS = 1400

export function LogsPage({ t, services, stream, onStart, onStop }) {
  const text = t.logsPage
  const [wrap, setWrap] = useState(true)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(copyTimer.current), [])

  const selectedService = services.find(s => s.name === stream.selected)
  const runningCount = services.filter(s => s.running).length
  const filtering = stream.filter.trim() !== ''
  const rows = useMemo(() => buildLogRows(stream.lines, stream.filter), [stream.lines, stream.filter])
  const raw = () => stream.lines.join('\n')

  const copy = async () => {
    await copyText(raw())
    setCopied(true)
    window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), COPIED_FOR_MS)
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([raw()], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${stream.selected || 'service'}.log`
    link.click()
    URL.revokeObjectURL(url)
  }
  const jumpToLatest = () => stream.setFollow(true)

  return <section className="logs-page">
    <div className="log-workbench">
      <div className="log-rail" role="group" aria-label={text.serviceList}>
        <div className="log-rail-head">
          <span>{t.lists.processes}</span>
          <em>{runningCount}/{services.length}</em>
        </div>
        <div className="log-rail-list">
          {services.map(s => <button
            type="button"
            key={s.name}
            title={s.name}
            aria-current={stream.selected === s.name ? 'true' : undefined}
            onClick={() => stream.select(s.name)}
          >
            <span className={s.running ? 'log-dot is-running' : 'log-dot'} aria-hidden="true"/>
            <span className="log-rail-name">{s.name}</span>
            <small>{s.running && s.pid ? `PID ${s.pid}` : s.kind}</small>
          </button>)}
          {!services.length && <p className="log-rail-empty">{t.empty}</p>}
        </div>
      </div>

      <div className="log-console">
        <div className="log-console-head">
          <span className="log-console-id">
            <span className={selectedService?.running ? 'log-dot is-running' : 'log-dot'} aria-hidden="true"/>
            <b>{stream.selected || text.noSelection}</b>
            {selectedService && <small>{selectedService.kind}{selectedService.pid ? ` · PID ${selectedService.pid}` : ''}</small>}
          </span>
          <span className={`stream-state ${stream.streamState}`} role="status">
            <span aria-hidden="true"/>{text.streamLabels[stream.streamState] || text.streamLabels.idle}
          </span>
          <span className="log-count">{filtering ? text.matchCount(rows.length, stream.lines.length) : text.lineCount(stream.lines.length)}</span>
        </div>

        <div className="log-console-bar">
          <span className="log-filter">
            <Search size={14} aria-hidden="true"/>
            <input
              type="search"
              value={stream.filter}
              placeholder={text.filterPlaceholder}
              aria-label={text.filter}
              disabled={!stream.selected}
              onChange={e => stream.setFilter(e.target.value)}
            />
            {filtering && <button type="button" className="log-filter-clear" onClick={() => stream.setFilter('')} title={text.clearFilter} aria-label={text.clearFilter}><X size={13}/></button>}
          </span>
          <label className="log-tail">
            <span>{t.hints.tailLines}</span>
            <input type="number" min="20" max="2000" step="20" aria-label={t.hints.tailLines} value={stream.tailLines} onChange={e => stream.setTailLines(Number(e.target.value) || 200)}/>
          </label>
          <span className="log-console-actions">
            <button type="button" className={stream.follow ? 'is-on' : ''} aria-pressed={stream.follow} disabled={!stream.selected} onClick={() => stream.setFollow(value => !value)}><ArrowDownToLine size={14}/>{text.follow}</button>
            <button type="button" className={wrap ? 'is-on' : ''} aria-pressed={wrap} onClick={() => setWrap(value => !value)}><WrapText size={14}/>{text.wrap}</button>
            <button type="button" className="log-icon-button" disabled={!stream.lines.length} onClick={copy} title={copied ? text.copied : t.copy} aria-label={copied ? text.copied : t.copy}>{copied ? <Check size={14}/> : <Copy size={14}/>}</button>
            <button type="button" className="log-icon-button" disabled={!stream.lines.length} onClick={download} title={t.download} aria-label={t.download}><Download size={14}/></button>
            <button type="button" className="log-icon-button" disabled={!stream.lines.length} onClick={stream.clear} title={t.clear} aria-label={t.clear}><Trash2 size={14}/></button>
            <button type="button" className="log-icon-button" disabled={!stream.selected} onClick={stream.retry} title={text.reconnect} aria-label={text.reconnect}><RefreshCw size={14}/><span>{text.reconnect}</span></button>
            {selectedService?.running
              ? <button type="button" disabled={!stream.selected} onClick={() => onStop(stream.selected)}><Square size={14}/>{t.stop}</button>
              : <button type="button" disabled={!stream.selected} onClick={() => onStart(stream.selected)}><Play size={14}/>{t.start}</button>}
          </span>
        </div>

        {stream.selected && stream.streamState === 'reconnecting' && <div className="log-stream-error" role="alert">
          <span>{text.interrupted}</span>
          <button type="button" onClick={stream.retry}>{t.retry}</button>
        </div>}

        {!stream.selected
          ? <p className="log-selection-empty" role="status">{text.selectPrompt}</p>
          : <div className="log-console-body">
            <pre
              ref={stream.viewRef}
              onScroll={stream.handleScroll}
              className="log-view"
              data-wrap={wrap ? 'on' : 'off'}
              tabIndex={0}
              aria-label={text.output(stream.selected)}
            >
              {rows.map(row => <div key={row.index} className={row.level ? `log-line is-${row.level}` : 'log-line'}>
                <span className="log-line-no" aria-hidden="true">{row.number}</span>
                <span className="log-line-text">{splitLogMatch(row.text, stream.filter).map((part, i) => part.match
                  ? <mark key={i}>{part.text}</mark>
                  : <React.Fragment key={i}>{part.text}</React.Fragment>)}</span>
              </div>)}
            </pre>
            {!rows.length && <p className="log-output-empty" role="status">{filtering ? text.noMatches(stream.filter.trim()) : text.noOutput}</p>}
            {!stream.follow && <button type="button" className="log-jump" onClick={jumpToLatest}><ArrowDownToLine size={14}/>{text.jumpLatest}</button>}
          </div>}
      </div>
    </div>
  </section>
}

export default LogsPage
