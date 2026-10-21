import { usageHasTokens, formatElapsedMs, formatTokens } from './usageStats.js'
import { measuredOutputRate, cacheHitPercent, cacheReadTokens } from '../lib/chatUsage.js'
import { ct } from './chatFormat.js'
import { memo, useState, useRef, useId, useLayoutEffect, useEffect, useCallback, useMemo } from 'react'
import { ChevronDown, ChevronUp, Clock3 } from 'lucide-react'
import { parseUltraPlanText, mergeUltraPlanStates, stripUltraPlanProgressText, hasUltraPlanDashboardState, parseUltraPlanResult, normalizeUltraPlanState } from './ultraPlan.js'
import { MarkdownBlock, LongTextPreview } from './MarkdownBlocks.jsx'
import { UltraPlanResultCard } from './UltraPlanViews.jsx'
import { segmentAgentProtocolBlocks } from '../lib/agentProtocol'
import ThinkingBlock from '../ThinkingBlock'
import { toolReceiptSummary, parseToolReceiptArgs, normalizeToolArgumentValue } from './toolArgs.js'
import { ToolReceiptSummary, AskUserPanel, FileToolArgsPanel, ToolCallBlock } from './ToolCallBlock.jsx'
import { ToolResultDetails } from './ToolDetails.jsx'
import SummaryBlock from '../SummaryBlock'
import { createAssistantContentParser, textRenderStats, cleanAssistantFinalBody } from '../lib/chatTextSafety'
import { useAutoCollapseProcess } from '../hooks/useAutoCollapseProcess.js'
import { parseStructuredContent } from '../lib/structuredContent'
import { FileSummaryCard } from './MessageCards.jsx'

const ToolScriptPreview = ({ value }) => {
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(() => value.split(/\r\n?|\n/).length > 4)
  const codeRef = useRef(null)
  const codeId = useId()

  useLayoutEffect(() => {
    const code = codeRef.current
    if (!code) return
    const measure = () => {
      if (!code.getClientRects().length) return
      const lineHeight = Number.parseFloat(getComputedStyle(code).lineHeight)
      if (lineHeight > 0) setCanExpand(code.scrollHeight > lineHeight * 4 + 1)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(code)
    return () => observer.disconnect()
  }, [value])

  const toggleLabel = expanded
    ? ct('\u6536\u8d77\u811a\u672c', 'Collapse script')
    : ct('\u5c55\u5f00\u5b8c\u6574\u811a\u672c', 'Show full script')
  return (
    <div className={`ga-tool-script${expanded ? ' is-expanded' : ''}`}>
      <pre className="ga-tool-arg-code" ref={codeRef} id={codeId}>{value}</pre>
      {canExpand && (
        <button type="button" className="ga-tool-script-toggle" aria-expanded={expanded}
          aria-controls={codeId} title={toggleLabel} onClick={() => setExpanded(current => !current)}>
          {expanded ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
          <span>{toggleLabel}</span>
        </button>
      )}
    </div>
  )
}

const ToolArgumentValue = ({ value, name = '', depth = 0 }) => {
  const normalized = normalizeToolArgumentValue(value)
  if (Array.isArray(normalized)) {
    return (
      <ol className="ga-tool-arg-list">
        {normalized.map((item, index) => (
          <li key={index}><ToolArgumentValue value={item} depth={depth + 1} /></li>
        ))}
      </ol>
    )
  }
  if (normalized && typeof normalized === 'object') {
    return (
      <dl className="ga-tool-arg-object">
        {Object.entries(normalized).map(([key, item]) => (
          <div className="ga-tool-arg-object-row" key={key}>
            <dt>{key}</dt>
            <dd><ToolArgumentValue value={item} name={key} depth={depth + 1} /></dd>
          </div>
        ))}
      </dl>
    )
  }
  if (typeof normalized === 'string') {
    if (/^script$/i.test(name)) return <ToolScriptPreview value={normalized} />
    const codeLike = normalized.includes('\n') || /^(script|code|content|patch|old_content|new_content)$/i.test(name)
    return codeLike
      ? <pre className="ga-tool-arg-code">{normalized}</pre>
      : <span className="ga-tool-arg-text">{normalized || ct('空字符串', 'Empty string')}</span>
  }
  if (normalized === null) return <span className="ga-tool-arg-literal is-null">null</span>
  return <span className={`ga-tool-arg-literal is-${typeof normalized}`}>{String(normalized)}</span>
}

const ToolArguments = ({ body = '' }) => {
  const args = parseToolReceiptArgs(body)
  const entries = Object.entries(args)
  if (!entries.length) return <pre className="ga-fold-pre">{body}</pre>

  return (
    <dl className="ga-tool-args">
      {entries.map(([key, value]) => (
        <div className="ga-tool-arg" key={key}>
          <dt>{key}</dt>
          <dd><ToolArgumentValue value={value} name={key} /></dd>
        </div>
      ))}
    </dl>
  )
}

const renderAssistantBody = (text = '', onAskReply, ultraplan_state, openAskUser = false) => {
  const parsedState = parseUltraPlanText(text)
  const upState = mergeUltraPlanStates(ultraplan_state, parsedState)
  const cleanText = stripUltraPlanProgressText(text)
  if (hasUltraPlanDashboardState(upState)) {
    return cleanText ? (
      <div className="oa-ultraplan-prose">
        <MarkdownBlock text={cleanText} onAskReply={onAskReply} />
      </div>
    ) : null
  }
  const result = parseUltraPlanResult(text)
  if (result) return <UltraPlanResultCard text={text} />
  
  // Render agent protocol blocks in their original prose/tool interleaving.
  const segments = segmentAgentProtocolBlocks(cleanText)
  if (segments.length === 0) return null

  const renderFold = (fold, key) => {
    if (fold.type === 'thinking') {
      return <ThinkingBlock key={key} body={fold.body} live={fold.live} label={ct('思考过程', 'Thought process')}>
        <MarkdownBlock text={fold.body} onAskReply={onAskReply} />
      </ThinkingBlock>
    }
    const hasResult = Object.prototype.hasOwnProperty.call(fold, 'result')
    const receipt = toolReceiptSummary(fold)
    const isFileMutation = receipt.tool === 'file_patch' || receipt.tool === 'file_write'
    return (
      <details
        key={key}
        className={`ga-fold ${fold.cls}`}
        open={fold.open || (openAskUser && receipt.tool === 'ask_user')}
        data-fold-type={fold.type}
      >
        <summary>{fold.type.startsWith('tool-call') ? <ToolReceiptSummary fold={fold} receipt={receipt} /> : fold.label}</summary>
        {fold.type.startsWith('tool-call') ? (
          receipt.tool === 'ask_user'
            ? <AskUserPanel call={{ args: fold.body, result: hasResult ? fold.result : '' }} onReply={onAskReply} />
            : <div className="ga-tool-pair">
              <section className="ga-tool-pair-section ga-tool-pair-call">
                <div className="ga-tool-pair-label">{isFileMutation ? ct('文件改动', 'File changes') : ct('调用参数', 'Arguments')}</div>
                {isFileMutation
                  ? <FileToolArgsPanel toolName={receipt.tool} args={fold.body} />
                  : <ToolArguments body={fold.body} />}
              </section>
              {hasResult && <section className="ga-tool-pair-section ga-tool-pair-result">
                <div className="ga-tool-pair-label">{fold.resultLive ? ct('工具结果…', 'Tool result…') : ct('工具结果', 'Tool result')}</div>
                <ToolResultDetails body={fold.result} live={fold.resultLive} />
              </section>}
            </div>
        ) : <pre className="ga-fold-pre">{fold.body}</pre>}
      </details>
    )
  }

  return (
    <>
      {segments.map((segment, segmentIdx) => segment.kind === 'prose'
        ? <MarkdownBlock key={`prose-${segmentIdx}`} text={segment.text} onAskReply={onAskReply} />
        : segment.kind === 'summary'
        ? <SummaryBlock key={`summary-${segmentIdx}`} label={ct('摘要', 'Summary')}>
          <MarkdownBlock text={segment.body} onAskReply={onAskReply} />
        </SummaryBlock>
        : <div className="ga-execution-log" key={`folds-${segmentIdx}`}>
          {segment.folds.map((fold, foldIdx) => renderFold(fold, `${segmentIdx}-${foldIdx}`))}
        </div>)}
    </>
  )
}

const AssistantBody = memo(function AssistantBody({ text = '', onAskReply, ultraplan_state, openAskUser = false }) {
  return renderAssistantBody(text, onAskReply, ultraplan_state, openAskUser)
})

const AssistantTurn = memo(function AssistantTurn({ turn, current, stackOpen, pending, usage, onAskReply, ultraplan_state, isLatestMessage }) {
  // A streamed turn keeps its body and local tool state when the next turn starts.
  const [expanded, setExpanded] = useState(false)
  const open = current || expanded
  const [visited, setVisited] = useState(current)
  const toggle = () => {
    setVisited(true)
    setExpanded(value => !value)
  }
  return <section className={current ? 'oa-turn-current' : `oa-turn-node oa-turn-card ${open ? 'open' : 'collapsed'}`} hidden={!current && !stackOpen} data-turn={turn.turn}>
    {current
      ? <div className="oa-turn-current-head"><span className="oa-turn-index oa-turn-index-current">{ct('步骤', 'Step')} {turn.turn}</span><b>{turn.title || ct('正在执行', 'Running')}</b><UsageRow u={usage} className="oa-usage-inline" /><em>{pending ? ct('实时输出中', 'Live output') : ct('最新一轮', 'Latest turn')}</em></div>
      : <button className="oa-turn-toggle" type="button" onClick={toggle} aria-expanded={open} title={turn.title || ct('执行步骤', 'Execution step')}>
        <span className="oa-turn-index">{ct('步骤', 'Step')} {turn.turn}</span><b>{turn.title || ct('执行步骤', 'Execution step')}</b><UsageRow u={usage} className="oa-usage-inline" /><ChevronDown size={15} className="oa-turn-chevron"/>
      </button>}
    <div className="oa-turn-body" hidden={!open}>
      {(current || visited) && (turn.body || ultraplan_state
        ? <AssistantBody text={turn.body || ''} onAskReply={onAskReply} ultraplan_state={ultraplan_state} openAskUser={isLatestMessage} />
        : <p className="oa-turn-empty">{current ? ct('正在等待该轮输出…', 'Waiting for this turn’s output…') : ct('该轮暂无详细输出', 'No detailed output for this turn')}</p>)}
    </div>
  </section>
})

export const AssistantContent = memo(function AssistantContent({ content, structuredContent, pending, onAskReply, isLatestMessage = false, turnUsages, ultraplan_state, runStartedAtMS = 0, clockNow = 0, modelID = '', contentPartial = false, executionCount = 0, onLoadExecution }) {
  // Follow the run lifecycle until the user explicitly toggles execution history.
  const [stackOpenOverride, setStackOpenOverride] = useState(null)
  const [executionLoading, setExecutionLoading] = useState(false)
  const [executionError, setExecutionError] = useState('')
  const executionRequestRef = useRef(null)
  const executionMountedRef = useRef(true)
  useEffect(() => { executionMountedRef.current = true; return () => { executionMountedRef.current = false } }, [])
  const loadExecution = useCallback(async () => {
    if (!contentPartial || !onLoadExecution || executionRequestRef.current) return
    executionRequestRef.current = true
    setExecutionLoading(true)
    setExecutionError('')
    try { await onLoadExecution() }
    catch (e) { if (executionMountedRef.current && e.name !== 'AbortError') setExecutionError(String(e.message || e)) }
    finally { executionRequestRef.current = null; if (executionMountedRef.current) setExecutionLoading(false) }
  }, [contentPartial, onLoadExecution])
  const parseContent = useMemo(() => createAssistantContentParser(), [])
  const [autoCollapseProcess] = useAutoCollapseProcess()
  // A display preference must not eagerly download lazy historical bodies.
  // Live runs still expand automatically; explicit clicks override both defaults.
  const stackOpen = stackOpenOverride ?? (Boolean(pending) || (!contentPartial && !autoCollapseProcess))
  const autoExecutionRequested = useRef(false)
  useEffect(() => {
    if (contentPartial && stackOpen && !autoExecutionRequested.current) {
      autoExecutionRequested.current = true
      loadExecution()
    }
  }, [contentPartial, stackOpen, loadExecution])
  const toggleExecution = () => {
    setStackOpenOverride(!stackOpen)
    if (!stackOpen && contentPartial) {
      autoExecutionRequested.current = true
      loadExecution()
    }
  }
  const liveUltraPlanState = useMemo(() => normalizeUltraPlanState(ultraplan_state), [ultraplan_state])
  const stats = useMemo(() => textRenderStats(content), [content])
  
  // The streamed payload contains GA's complete multi-turn text protocol, while
  // structuredContent is only the backend's last assistant message. Prefer the
  // complete protocol whenever it has turn markers so the terminal event cannot
  // replace the live turn stack with a differently shaped final-only view.
  const parsed = useMemo(() => {
    if (contentPartial) return { runs: [], body: cleanAssistantFinalBody(content) }
    const textResult = parseContent(content)
    if (textResult.runs.length > 0) return textResult
    if (structuredContent) {
      const result = parseStructuredContent(structuredContent)
      if (result) return result
    }
    return textResult
  }, [content, structuredContent, parseContent, contentPartial])
  const hasTurnSplit = parsed.runs.length > 0 || contentPartial
  const hasLiveUltraPlan = !!(liveUltraPlanState && (liveUltraPlanState.phases?.length > 0 || liveUltraPlanState.recentTasks?.length > 0 || liveUltraPlanState.objective))
  if (!content && pending && !hasLiveUltraPlan) {
    const startedAt = Number(runStartedAtMS) || 0
    const elapsedSeconds = startedAt > 0 ? Math.max(0, Math.floor(((Number(clockNow) || Date.now()) - startedAt) / 1000)) : 0
    const waitingLabel = modelID
      ? ct('模型已接入，正在生成', 'Model connected, generating')
      : elapsedSeconds < 2
        ? ct('正在连接模型', 'Connecting to model')
        : ct('正在准备回复', 'Preparing response')
    const waitingTime = elapsedSeconds >= 60
      ? `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
      : `${elapsedSeconds}s`
    const waitingStage = modelID ? 'generating' : elapsedSeconds < 2 ? 'connecting' : 'preparing'
    return <div className="oa-content oa-thinking" data-stage={waitingStage} role="status" aria-label={waitingLabel}>
      <span className="oa-thinking-pulse" aria-hidden="true"><i/><i/><i/></span>
      <span className="oa-thinking-copy">
        <span className="oa-thinking-label">{waitingLabel}</span>
        {modelID && <span className="oa-thinking-model" title={modelID}>{modelID}</span>}
      </span>
      {elapsedSeconds >= 3 && <span className="oa-thinking-time" aria-hidden="true">
        <Clock3 size={12}/>
        <span>{waitingTime}</span>
      </span>}
    </div>
  }
  if (content && stats.tooLarge && !hasTurnSplit) return <div className="oa-content"><LongTextPreview text={content} stats={stats} /></div>
  const lastRunIndex = parsed.runs.length - 1
  // A persisted UltraPlan state belongs to the final user-visible branch. When a
  // response has turn markers but no explicit final marker, that branch is the
  // latest run rather than parsed.body.
  const ultraPlanStateForLastRun = !parsed.body && hasLiveUltraPlan
    ? (liveUltraPlanState || ultraplan_state)
    : undefined
  return <div className={`oa-content ${hasTurnSplit ? 'oa-agent-output' : ''}`}>
    {hasTurnSplit && <div className={`oa-turn-stack ${stackOpen ? 'open' : 'collapsed'}`}>
      <button className="oa-turn-stack-head" data-running={pending ? 'true' : 'false'} type="button" onClick={toggleExecution} aria-expanded={stackOpen} title={stackOpen ? ct('折叠执行过程', 'Collapse execution') : ct('展开执行过程', 'Expand execution')}>
        <span className="oa-run-dot"/>
        <span className="oa-run-label">{ct('执行过程', 'Execution')}</span>
        <b>{contentPartial ? executionCount : parsed.runs.length}</b>
        <em className="oa-run-status">{executionLoading ? ct('加载中', 'Loading') : pending ? ct('正在生成', 'Generating') : ct('已完成', 'Completed')}</em>
        <ChevronDown className="oa-stack-chevron" size={15}/>
      </button>
      {contentPartial && stackOpen && <div className="oa-history-status" role="status" aria-live="polite">
        {executionError ? <><span>{executionError}</span><button type="button" disabled={executionLoading} onClick={loadExecution}>{ct('重试', 'Retry')}</button></> : ct('正在加载执行详情…', 'Loading execution details…')}
      </div>}
      {parsed.runs.map((run, index) => <AssistantTurn
        key={`${run.turn}-${index}`}
        turn={run}
        current={index === lastRunIndex}
        stackOpen={stackOpen}
        pending={pending}
        usage={turnUsages && turnUsages[index]}
        onAskReply={onAskReply}
        ultraplan_state={index === lastRunIndex ? ultraPlanStateForLastRun : undefined}
        isLatestMessage={index === lastRunIndex && isLatestMessage}
      />)}
    </div>}
    {(parsed.summary || parsed.body || !parsed.runs.length) && <div className={executionCount || parsed.runs.length ? 'oa-final-answer' : ''}>
      {(executionCount > 0 || parsed.runs.length > 0) && <div className="oa-final-label">返回给用户</div>}
      {parsed.tools && parsed.tools.length > 0 && <div className="oa-tools-section">
        {parsed.tools.map((call, idx) => <ToolCallBlock key={idx} call={call} onAskReply={onAskReply} />)}
      </div>}
      {renderAssistantBody(parsed.body || (!parsed.summary ? content : '') || '', onAskReply, liveUltraPlanState || ultraplan_state, isLatestMessage)}
    </div>}
    <FileSummaryCard content={content} />
  </div>
})

export const UsageRow = ({ u, usages = [], label, className, elapsedMs = 0, live = false, ctxChars = 0, ctxMsgs = 0, showTTFT = false, firstTokenMs = 0 }) => {
  const modelTTFT = usages.map(item => Number(item?.ttft_ms)).find(value => Number.isFinite(value) && value > 0) || 0
  const ttft = modelTTFT || (Number.isFinite(Number(firstTokenMs)) && Number(firstTokenMs) > 0 ? Number(firstTokenMs) : 0)
  const hasTokens = usageHasTokens(u)
  const hasElapsed = elapsedMs > 0
  const hasCtx = ctxChars > 0 || ctxMsgs > 0
  const outputRate = measuredOutputRate(usages)
  const cachePercent = cacheHitPercent(usages)
  const hasOutputRate = outputRate > 0
  const hasCachePercent = cachePercent > 0
  if (!hasTokens && !hasElapsed && !hasCtx && !showTTFT) return null
  return <div className={`oa-usage ${className || ''}`}>
    {label && <span className="oa-usage-label">{label}</span>}
    {hasElapsed && <span className={live ? 'oa-usage-time is-live' : 'oa-usage-time'} title={live ? ct('实时耗时', 'Live elapsed time') : ct('耗时', 'Elapsed time')}><svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 1.5A4.5 4.5 0 1 1 8 11a4.5 4.5 0 0 1 0-7.5z"/><path d="M7.5 4.5h1v3.65l2.2 1.3-.5.9L7.5 9V4.5z"/></svg>{ct('耗时', 'Time')} <b>{formatElapsedMs(elapsedMs)}</b></span>}
    {showTTFT && <span className="oa-usage-ttft" title={modelTTFT ? ct('本轮首次有效模型调用的首 token 耗时，不累计后续步骤', 'Time to first token of the first measured model call in this round; later steps are not summed') : ct('旧数据首响应耗时；无采样时不估算', 'Legacy first-response time; no estimate without a sample')}>
      {modelTTFT || !ttft ? 'TTFT' : ct('首响应', 'First response')} <b>{ttft > 0 ? `${(ttft / 1000).toFixed(2)}s` : '—'}</b>
    </span>}
    {u?.input_tokens > 0 && <span className="oa-usage-in" title={ct(`输入: ${u.input_tokens.toLocaleString()} tokens`, `Input: ${u.input_tokens.toLocaleString()} tokens`)}><svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M8 11.5 3.5 7l1.1-1.1L8 9.3l3.4-3.4L12.5 7 8 11.5Z"/></svg>{ct('输入', 'Input')} <b>{formatTokens(u.input_tokens)}</b></span>}
    {u?.cache_creation_tokens > 0 && <span className="oa-usage-cache-write" title={ct(`缓存写入: ${u.cache_creation_tokens.toLocaleString()} tokens`, `Cache creation: ${u.cache_creation_tokens.toLocaleString()} tokens`)}><svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M8 1v9m0 0 3-3m-3 3L5 7M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>{ct('缓存写入', 'Cache write')} <b>{formatTokens(u.cache_creation_tokens)}</b></span>}
    {cacheReadTokens(u) > 0 && <span className="oa-usage-cache-read" title={ct(`缓存读取: ${cacheReadTokens(u).toLocaleString()} tokens`, `Cache read: ${cacheReadTokens(u).toLocaleString()} tokens`)}><svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M8 15V6m0 0 3 3M8 6 5 9M3 3h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>{ct('缓存读取', 'Cache read')} <b>{formatTokens(cacheReadTokens(u))}</b></span>}
    {u?.output_tokens > 0 && <span className="oa-usage-out" title={ct(`输出: ${u.output_tokens.toLocaleString()} tokens`, `Output: ${u.output_tokens.toLocaleString()} tokens`)}><svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M8 4.5 12.5 9l-1.1 1.1L8 6.7l-3.4 3.4L3.5 9 8 4.5Z"/></svg>{ct('输出', 'Output')} <b>{formatTokens(u.output_tokens)}</b></span>}
    {hasOutputRate && <span className="oa-usage-rate" title={ct('请求平均输出速率：已计时调用的输出 token 总数 ÷ 这些调用的请求总耗时；包含 TTFT、隐藏推理及网络等待，不含工具执行。不是纯解码速度；旧记录不估算。', 'Request-average output throughput: measured output tokens / complete model-request time, including TTFT, hidden reasoning and network wait, excluding tool execution. Not decoder-only speed; legacy records are not estimated.')}><svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M3 11a5 5 0 0 1 10 0M8 11l3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="8" cy="11" r="1" fill="currentColor"/></svg><b>{outputRate.toFixed(1)}</b> {ct('tok/s', 'tok/s')}</span>}
    {hasCachePercent && <span className="oa-usage-cache-hit" title={ct(`缓存命中率: ${cachePercent.toFixed(2)}%`, `Cache hit rate: ${cachePercent.toFixed(2)}%`)}><svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M13 4L6 11 3 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>{ct('缓存', 'Cache')} <b>{cachePercent % 1 === 0 ? cachePercent.toFixed(0) : cachePercent.toFixed(1)}%</b></span>}
    {hasCtx && <span className="oa-usage-ctx" title={ct(
      `AI 当前记住了 ${ctxMsgs} 条对话消息${ctxChars > 0 ? `，约 ${formatTokens(ctxChars)} 字` : ''}。上下文越长记忆越多，超出上限时旧消息会被自动裁剪。`,
      `AI currently holds ${ctxMsgs} messages in context${ctxChars > 0 ? ` (~${formatTokens(ctxChars)} chars)` : ''}. Older messages are trimmed when the limit is reached.`
    )}><svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M2 4h12v1.5H2V4zm0 3.5h9v1.5H2V7.5zm0 3.5h7v1.5H2V11z"/></svg>{ct('上下文', 'Ctx')} <b>{ctxMsgs > 0 ? `${ctxMsgs}msg` : ''}{ctxChars > 0 ? ` ${formatTokens(ctxChars)}ch` : ''}</b></span>}
  </div>
}
