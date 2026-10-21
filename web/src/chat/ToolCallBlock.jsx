import Tag from 'antd/es/tag'
import Collapse from 'antd/es/collapse'
import { useState, useMemo, useEffect } from 'react'
import { getAskUserPayload } from '../lib/askUserPayload'
import { parseFileToolArgs, toolReceiptSummary } from './toolArgs.js'
import { ct } from './chatFormat.js'
import { computeLineDiff, computeWriteRows } from '../lib/lineDiff.js'
import { FileCode2, ChevronDown, CornerDownLeft } from 'lucide-react'
import { CopyButton } from './CopyButton.jsx'

export const ToolReceiptSummary = ({ fold, target, receipt: derivedReceipt }) => {
  const receipt = derivedReceipt ?? toolReceiptSummary(fold)
  const resolvedTarget = target || receipt.target
  return (
    <span className={`ga-receipt is-${receipt.state}`} data-state={receipt.state} aria-label={[receipt.kind, receipt.tool, receipt.status, resolvedTarget].filter(Boolean).join(' · ')}>
      <span className="ga-receipt-kind">{receipt.kind}</span>
      <span className="ga-receipt-tool">{receipt.tool}</span>
      {receipt.status && <span className={`ga-receipt-status is-${receipt.state}`}>{receipt.status}</span>}
      {resolvedTarget && <span className="ga-receipt-target" title={resolvedTarget}>{resolvedTarget}</span>}
    </span>
  )
}

export function ToolCallCollapse({ name, args }) {
  const keys = Object.keys(args)
  const preview = keys.slice(0, 3).join(' · ') + (keys.length > 3 ? ` +${keys.length - 3}` : '')
  const label = (
    <span className="sa-tool-collapse-label">
      <Tag color="blue" style={{ fontFamily: 'var(--mono,ui-monospace,monospace)', fontSize: 11, marginRight: 6 }}>{name}</Tag>
      {keys.length > 0 && <span className="sa-tool-preview">{preview}</span>}
    </span>
  )
  if (keys.length === 0) return (
    <div className="sa-tool-empty">
      <Tag color="blue" style={{ fontFamily: 'var(--mono,ui-monospace,monospace)', fontSize: 11 }}>{name}</Tag>
    </div>
  )
  return (
    <Collapse ghost size="small" className="sa-tool-collapse" items={[{
      key: '1',
      label,
      children: <pre className="sa-tool-json">{JSON.stringify(args, null, 2)}</pre>
    }]} />
  )
}

export function AskUserPanel({ call, onReply }) {
  const ask = getAskUserPayload(call)
  const hasStructured = Boolean(ask.question || ask.candidates.length)
  const chooseCandidate = (event, value) => {
    event.stopPropagation()
    onReply?.(value)
  }
  const resultText = String(call.result || '').trim()
  const showResult = resultText && !/^Waiting for your answer\s*(?:\.{3}|…)?$/i.test(resultText)
  return <div className="oa-ask-panel">
    {hasStructured ? <div className="oa-ask-body">
      {ask.question && <p className="oa-ask-question">{ask.question}</p>}
      {ask.candidates.length > 0 && <div className="oa-ask-options" role="group" aria-label={ct('快捷回复', 'Quick replies')}>{ask.candidates.map((x,i)=><button type="button" key={`${x}-${i}`} onClick={(event)=>chooseCandidate(event, x)} title={ct('点击填入输入框', 'Insert into the input')}><CornerDownLeft size={13} /><span>{x}</span></button>)}</div>}
    </div> : call.args && <div className="oa-tool-args"><span>{ct('问题', 'Question')}</span><pre>{call.args}</pre></div>}
    {showResult && <div className="oa-tool-result oa-ask-result"><span>{ct('回复', 'Reply')}</span><pre>{call.result}</pre></div>}
  </div>
}

// Unified diff rows: line numbers + -/+ gutter, collapsed context
const PATCH_AUTO_COLLAPSE_CHANGES = 12

export function DiffRows({ rows }) {
  return <div className="oa-diff" role="table" aria-label="文件改动逐行对照">
    {rows.map((row, i) => {
      if (row.type === 'gap') {
        return <div className="oa-diff-row oa-diff-gap" key={`g${i}`} role="row">
          <span className="oa-diff-no" aria-hidden="true">⋯</span>
          <span className="oa-diff-sign" aria-hidden="true" />
          <span className="oa-diff-text">{`未改动 ${row.count} 行`}</span>
        </div>
      }
      const sign = row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '
      return <div className={`oa-diff-row oa-diff-${row.type}`} key={i} role="row">
        <span className="oa-diff-no">{row.type === 'add' ? row.newNo : row.oldNo}</span>
        <span className="oa-diff-sign" aria-hidden="true">{sign}</span>
        <span className="oa-diff-text">{row.text === '' ? '\u00a0' : row.text}</span>
      </div>
    })}
  </div>
}

// Render file tool arguments in a structured way
export function FileToolArgsPanel({ toolName, args }) {
  const fileArgs = parseFileToolArgs(toolName, args)

  const { type, path, content, old_content, new_content, mode } = fileArgs || {}
  const diff = useMemo(() => {
    if (!fileArgs) return null
    return type === 'file_patch'
      ? computeLineDiff(old_content, new_content, { context: 3 })
      : computeWriteRows(content)
  }, [fileArgs, type, old_content, new_content, content])
  const patchStartsExpanded = !diff || (!diff.truncated && diff.added + diff.removed <= PATCH_AUTO_COLLAPSE_CHANGES)
  const [patchExpanded, setPatchExpanded] = useState(patchStartsExpanded)

  useEffect(() => {
    setPatchExpanded(patchStartsExpanded)
  }, [patchStartsExpanded])

  if (!fileArgs) {
    return <div className="oa-tool-args"><span>{'📥 args'}</span><pre>{args}</pre></div>
  }

  const { rows, added, removed, truncated } = diff
  const changedTotal = added + removed
  const fileName = String(path || '').split(/[\\/]/).filter(Boolean).pop() || path
  const isWrite = type === 'file_write'

  return <div className={`oa-tool-args oa-file-tool-args is-patch${isWrite ? ' is-write' : ''}`}>
    <div className="oa-patch-filebar" title={path}>
      <FileCode2 size={14} strokeWidth={1.8} aria-hidden="true" />
      <span className="oa-patch-file-id">
        <strong>{fileName}</strong>
        <span>{path}</span>
        {isWrite && mode && mode !== 'overwrite' && <span className="oa-patch-mode">{mode}</span>}
      </span>
      <span className="oa-patch-stats" aria-label={ct(`新增 ${added} 行，删除 ${removed} 行`, `${added} lines added, ${removed} removed`)}>
        <span className="oa-diff-stats-add">{`+${added}`}</span>
        <span className="oa-diff-stats-del">{`−${removed}`}</span>
      </span>
      {changedTotal > 0 && rows.length > 0 && <button
        className="oa-patch-toggle"
        type="button"
        aria-expanded={patchExpanded}
        aria-label={patchExpanded ? ct('收起文件改动', 'Collapse file changes') : ct('展开文件改动', 'Expand file changes')}
        title={patchExpanded ? ct('收起改动', 'Collapse changes') : ct('展开改动', 'Expand changes')}
        onClick={() => setPatchExpanded(value => !value)}
      >
        <span>{patchExpanded ? ct('收起', 'Collapse') : ct('展开', 'Expand')}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>}
      <CopyButton text={path} compact />
    </div>

    {changedTotal === 0 && <div className="oa-file-tool-empty">{ct('没有行级改动', 'No line-level changes')}</div>}

    {changedTotal > 0 && rows.length > 0 && patchExpanded && (
      <div className="oa-file-tool-preview">
        {truncated && <div className="oa-diff-note">{ct('改动过大，已按块粗粒度对比', 'Large change; showing a coarse block diff')}</div>}
        <DiffRows rows={rows} />
      </div>
    )}
  </div>
}

export function ToolCallBlock({ call, onAskReply }) {
  const toolName = String(call.name || 'unknown').trim()
  const isAskUser = /(?:^|[._-])ask_user$/i.test(toolName)
  const isFileTool = /file_(write|patch)$/i.test(toolName)
  const [open, setOpen] = useState(false)
  const askPayload = isAskUser ? getAskUserPayload(call) : null
  const fileArgs = isFileTool ? parseFileToolArgs(toolName, call.args) : null
  const fileName = fileArgs?.path?.split(/[\\/]/).filter(Boolean).pop()
  const hasResult = call.result !== undefined && call.result !== null
  const isRunning = !!call.args && !hasResult
  const receiptFold = {
    label: toolName,
    body: call.args,
    resultLive: isRunning,
    ...(hasResult ? { result: call.result } : {}),
  }

  // ask_user keeps its interactive panel, but shares the same quiet row header.
  if (isAskUser) {
    return <div className={`oa-tool-call oa-tool-ask-user ${open ? 'open' : 'collapsed'}`}>
      <button className="oa-tool-head" type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="oa-tool-disclosure" aria-hidden="true" />
        <ToolReceiptSummary fold={receiptFold} target={askPayload?.candidates?.length
          ? ct(`${askPayload.candidates.length} 个选项`, `${askPayload.candidates.length} options`)
          : undefined} />
      </button>
      {open && <AskUserPanel call={call} onReply={onAskReply} />}
    </div>
  }

  return <details className="oa-tool-receipt">
    <summary title={ct('展开详情', 'Expand details')}>
      <ToolReceiptSummary fold={receiptFold} target={fileName} />
    </summary>
    <div className="oa-tool-fold">
      {isFileTool ? (
        <FileToolArgsPanel toolName={toolName} args={call.args} />
      ) : (
        call.args && <div className="oa-tool-section">
          <div className="oa-tool-label">args</div>
          <pre className="oa-tool-code">{call.args}</pre>
        </div>
      )}
      {call.result && <div className="oa-tool-section">
        <div className="oa-tool-label oa-tool-label-result">result</div>
        <pre className="oa-tool-code oa-tool-code-result">{call.result}</pre>
      </div>}
    </div>
  </details>
}
