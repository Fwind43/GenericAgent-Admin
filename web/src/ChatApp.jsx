import { ChatPackageBar } from './ui/chatChrome'
import { UiSurface, useUiPackage } from './ui/UiHost'
import { conductorSidebarActivity, conductorSidebarSections, conductorSessionTree } from './lib/chatConductor.js'
import { sortSidebarSessions, filterSidebarRecentNodes } from './lib/chatSidebarPreferences.js'
import { useSidebarPreferences } from './hooks/useSidebarPreferences'
import { normalizeChatAttachments, chatAttachmentSource } from './lib/chatAttachments.js'
import './conductor.css'
import './chatSidebar.css'
import ProjectSessionPage from './components/ProjectSessionPage'
import ProjectActionsMenu, { SidebarPreferenceSubmenu } from './components/ProjectActionsMenu'
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { applyThemeToDocument, getInitialTheme, persistTheme } from './themes'
import ThemePicker from './ThemePicker'
import { useAutoCollapseProcess } from './hooks/useAutoCollapseProcess.js'
import MessageNavigator from './components/MessageNavigator'
import SessionTimeTooltip from './components/SessionTimeTooltip'
import ThinkingBlock from './ThinkingBlock'
import SummaryBlock from './SummaryBlock'
import { createStreamDeltaBatcher, decideStreamFollow, isBTWCommand, isLoopFollowActive, mergeFinalStreamMessage, mergeStreamTerminalMessage, mergeStreamUserMessage, nextStreamClientUserID, pickResumePlaceholderId, sameStreamRun, scrollFollowAction, shouldRefreshChatSnapshot } from './lib/chatStream.js'
import { cacheHitPercent, cacheReadTokens, measuredOutputRate } from './lib/chatUsage.js'
import { modelDiagnosisAdvice, modelDiagnosisTitle } from './lib/modelDiagnosis.js'
import { projectNameError, projectNameErrorText } from './lib/projectName.js'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { Bot, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleAlert, CircleHelp, Clock3, Copy, Edit3, ExternalLink, FileImage, Folder, FolderOpen, FolderPlus, GitBranch, Loader2, Lock, MessageSquarePlus, MoreHorizontal, Orbit, PanelLeftOpen, PanelLeftClose, PanelRightOpen, Pin, Plus, RotateCw, Send, Settings, Sparkles, Square, Trash2, X } from 'lucide-react'
import { api, apiStream } from './lib/api'
import { createChatSessionCache } from './lib/chatSessionCache.js'
import { createChatSessionListReader } from './lib/chatSessionListReader.js'
import { useChatHistoryPages } from './lib/useChatHistoryPages.js'
import { useChatReadState } from './lib/useChatReadState.js'
import { historyStatsMessages } from './lib/chatHistoryPages.js'
import { addChatInstanceToURL, chatInstanceOptions, initialChatInstanceID, persistChatInstanceID } from './lib/chatInstanceScope'
import { clearChatLaunchIntent, readChatLaunchIntent } from './lib/chatLaunchIntent'
import { chooseChatSessionID, loadSelectedChatSessionID, persistSelectedChatSessionID } from './lib/chatSessionSelection'
import { forgetSessionScroll, rememberSessionScroll, sessionScrollRestore } from './lib/chatSessionScroll'
import { createThreadFollowScheduler } from './lib/chatFollowScheduler.js'
import { loopSidebarView, updateSessionLoop } from './lib/chatLoopSidebar.js'
import { normalizeLoopRecords } from './lib/chatLoopRecords.js'
import { confirmDanger } from './lib/danger'
import { copyText, fuzzyMatch } from './lib/format'
import { LONG_TEXT_PREVIEW_CHARS, MARKDOWN_CHAR_LIMIT, MARKDOWN_LINE_LIMIT, createAssistantContentParser, cleanAssistantFinalBody, textRenderStats } from './lib/chatTextSafety'
import { parseStructuredContent } from './lib/structuredContent'
import { segmentAgentProtocolBlocks } from './lib/agentProtocol'
import { aggregateChatTaskbarState, chatTaskbarState, publishTaskbarState, shouldRefreshChatTaskbar, waitingChatSessions } from './lib/chatTaskbar.js'
import { REASONING_EFFORT_OPTIONS, normalizeReasoningEffort } from './lib/reasoningEffort'
import { deleteChatSessions, normalizeSessionIds } from './lib/chatSessionManagement'
import { clearChatSessionDraftsAsync, listChatSessionDraftIds, loadChatSessionDraft, loadChatSessionDraftAttachmentsAsync, mergeChatSessionDraftSessions, saveChatSessionDraftAsync } from './lib/chatSessionDrafts'
import { projectSessionLabel, projectSidebarGroups, groupProjectSessions, runningProjectKeys } from './lib/chatProjectSessions.js'
import { useRuntimeModelRefresh } from './lib/useRuntimeModelRefresh.js'
import { hubSessions } from './lib/chatHubSessions.js'
import { groupRecentSessions } from './lib/chatSessionGroups.js'
import { equalSessionSummaryValue, reconcileScalarList, reconcileSessionSummaries } from './lib/chatSessionReconcile.js'
import { createPromptPreset, normalizePromptPresets, promptPresetPatch, selectedPromptPresetView } from './lib/promptPresets'
import { commandResultSummary, reduceCommandResult } from './lib/chatCommands'
import { buildChatRunPayload, buildEditResendItem } from './lib/worldlineEdit'
import { messageVersionInfo } from './lib/worldlineTree'
import { pollGeneratedChatTitle, shouldPollGeneratedTitle } from './lib/chatTitlePolling'
import {
  COMPOSER_MOBILE_BREAKPOINT,
  composerTextareaLayout,
  composerDragHeight,
} from './lib/composerHeight.js'
import {
  canStopConductorWorker,
  conductorChildren,
  conductorWorkers,
  conductorParentID,
  conductorPollActions,
  conductorStatusCounts,
  isConductorParent,
  isConductorWorker,
  shouldPollConductorSessions,
  workerStatus,
} from './lib/chatConductor.js'
import { dateFromTimestamp, chatLocale, chatLanguage, ct, fmtTime, loopPhaseLabel, loopStopReasonText } from './chat/chatFormat.js'
import { toolReceiptSummary, parseToolReceiptArgs, normalizeToolArgumentValue } from './chat/toolArgs.js'
import { hasUltraPlanDashboardState, stripUltraPlanProgressText, mergeUltraPlanStates, normalizeUltraPlanState, parseUltraPlanText, parseUltraPlanResult } from './chat/ultraPlan.js'
import { buildChatStats, getElapsedMs, sumUsages, formatTokens, freezeActiveAssistantElapsed, formatElapsedMs, usageHasTokens } from './chat/usageStats.js'
import { slashCommandNextDrawer, slashCommandInsertText, isArgumentStyleSlashCmd, SLASH_ARG_SUFFIX_RE, builtinSlashCommandKey, builtinSlashKey, BUILTIN_SLASH_COMMANDS } from './chat/slashCommands.js'
import { JUMP_TOP_MARGIN, threadCanScroll, isNearBottom, SMOOTH_SETTLE_MS, FOLLOW_SETTLE_MS, isMobileViewport, isNarrowChatViewport, prefersReducedMotion } from './chat/viewport.js'
import { groupRuntimeModels, runtimeModelLabel, runtimeModelGroup, sessionAgeText, formatAge, fmtDate, shortTitle, stripBTWEcho, parseBTWDisplay } from './chat/sessionLabels.js'
import { getFileVisual, isImageFile, uploadFileSource, uploadFileName, MAX_CHAT_UPLOAD_BYTES_TOTAL, MAX_CHAT_UPLOAD_BYTES_PER_FILE, MAX_CHAT_UPLOAD_FILES } from './chat/uploadFiles.js'
import { isWorldlinePickerResult, worldlineRestoreCommand, worldlineReadURL } from './chat/worldline.js'
import { extractSavedFilePaths, stripUserAttachmentBlock } from './chat/userMessageText.js'
import { CopyButton } from './chat/CopyButton.jsx'
import { ToolCallBlock, FileToolArgsPanel, AskUserPanel, ToolReceiptSummary } from './chat/ToolCallBlock.jsx'
import { ToolResultDetails } from './chat/ToolDetails.jsx'
import { JsonTree } from './chat/JsonTree.jsx'
import { MarkdownBlock, FileAttachment, LongTextPreview } from './chat/MarkdownBlocks.jsx'
import { UltraPlanMessageDrawer, UltraPlanResultCard } from './chat/UltraPlanViews.jsx'
import { CustomSelect, ComposerActions, ProviderModelCascade } from './chat/ComposerControls.jsx'
import { WorldlinePanel, WorldlineRestoreDialog } from './chat/WorldlineViews.jsx'
import { PlanTodoCard, ChatKeychainDialog } from './chat/ChatDialogs.jsx'
import { CommandResultCard, GoalStatusCard, FileSummaryCard } from './chat/MessageCards.jsx'
export { CommandResultCard, GoalStatusCard } from './chat/MessageCards.jsx'
export { PlanTodoCard, ChatKeychainDialog } from './chat/ChatDialogs.jsx'
export { WorldlinePanel, WorldlineRestoreDialog } from './chat/WorldlineViews.jsx'
export { ComposerActions, ProviderModelCascade } from './chat/ComposerControls.jsx'
export { isWorldlinePickerResult, worldlineRestoreCommand, worldlineReadURL } from './chat/worldline.js'
export { groupRuntimeModels } from './chat/sessionLabels.js'
export { buildChatStats, getElapsedMs, freezeActiveAssistantElapsed } from './chat/usageStats.js'
export { stripUltraPlanProgressText } from './chat/ultraPlan.js'
export { normalizeFileToolText, parseToolReceiptArgs, parseToolResultDetails } from './chat/toolArgs.js'

gsap.registerPlugin(useGSAP)

export const SessionAutorunBadge = memo(function SessionAutorunBadge({ enabled = false, sessionId = '', targetSessionId = '' }) {
  if (!enabled || !sessionId || sessionId !== targetSessionId) return null
  const label = ct('Autorun 已开启', 'Autorun enabled')
  return <em className="oa-session-autorun-badge" title={label} aria-label={label}>Autorun</em>
})

function ConductorSessionTree({ session, workers, renderSession, activeSessionId }) {
  const [expanded, setExpanded] = useState(false)
  const activeWorkerId = workers.find(worker => worker.id === activeSessionId)?.id
  useEffect(() => {
    if (activeWorkerId) setExpanded(true)
  }, [activeWorkerId])
  return <div className="oa-conductor-tree">
    {renderSession(session, { treeExpanded: expanded, onToggleTree: () => setExpanded(value => !value) })}
    {expanded && <div className="oa-conductor-tree-children">{workers.map(worker => renderSession(worker, { nested:true }))}</div>}
  </div>
}

const SidebarSessionRow = memo(function SidebarSessionRow({
  session,
  projectLabel = '',
  active = false,
  editing = false,
  menuOpen = false,
  draftTitle = '',
  hasDraft = false,
  ageText = '',
  unread = false,
  waiting = false,
  childRunning = 0,
  nested = false,
  treeExpanded,
  onToggleTree,
  actionsRef,
}) {
  const sidebarLoop = loopSidebarView(session.loop)
  const title = shortTitle(session)
  const conductorKind = isConductorParent(session) ? 'parent' : (isConductorWorker(session) ? 'worker' : '')
  const childrenRunning = conductorKind === 'parent' ? childRunning : 0
  const runningLabel = conductorKind === 'parent'
    ? ct('指挥家运行中', 'Conductor running')
    : ct('运行中', 'Running')
  const childRunningLabel = ct('子任务运行中', 'Child tasks running')
  return <div className={`oa-session-row ${active?'active':''} ${session.running || childrenRunning > 0 ? 'is-running' : ''} ${session.pinned?'is-pinned':''} ${nested?'is-conductor-worker':''}`}>
    {editing ? <div className="oa-rename">
      <input value={draftTitle} autoFocus aria-label={ct('会话标题', 'Session title')} onChange={event=>actionsRef.current.setDraftTitle(event.target.value)} onKeyDown={event=>{ if(event.key==='Enter') actionsRef.current.saveRename(session.id); if(event.key==='Escape') actionsRef.current.cancelRename() }}/>
      <button onClick={()=>actionsRef.current.saveRename(session.id)} aria-label={ct('保存标题', 'Save title')}><Check size={14}/></button><button onClick={()=>actionsRef.current.cancelRename()} aria-label={ct('取消重命名', 'Cancel rename')}><X size={14}/></button>
    </div> : <SessionTimeTooltip title={title} timeLabel={session.updated_at ? `${ct('更新时间', 'Updated')}: ${ageText} · ${fmtTime(session.updated_at)}` : ''}><button className="oa-session" onClick={()=>actionsRef.current.openSession(session.id)}>
      <span className="oa-session-title">{session.pinned && <Pin className="oa-session-pin" size={12} aria-label={ct('\u5df2\u7f6e\u9876', 'Pinned')}/>}<b>{title}</b>{projectLabel && <span className="oa-session-project-badge" title={ct(`项目：${projectLabel}`, `Project: ${projectLabel}`)}><Folder size={10} aria-hidden="true"/>{projectLabel}</span>}{conductorKind === 'parent' && <span role={onToggleTree ? 'button' : undefined} tabIndex={onToggleTree ? 0 : undefined} aria-expanded={onToggleTree ? treeExpanded : undefined} onClick={onToggleTree ? event=>{ event.stopPropagation(); onToggleTree(event) } : undefined} onKeyDown={onToggleTree ? event=>{ if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onToggleTree(event) } } : undefined} className={`oa-session-conductor-badge ${onToggleTree ? 'oa-conductor-badge-toggle' : ''}`} title={onToggleTree ? (treeExpanded ? ct('收起子会话', 'Collapse child sessions') : ct('点击展开子会话', 'Click to expand child sessions')) : ct('指挥家会话', 'Conductor session')} aria-label={onToggleTree ? (treeExpanded ? ct('指挥家：收起子会话', 'Conductor: collapse child sessions') : ct('指挥家：展开子会话', 'Conductor: expand child sessions')) : ct('指挥家会话', 'Conductor session')}>{ct('指挥家', 'Conductor')}{onToggleTree && (treeExpanded ? <ChevronDown size={12} aria-hidden="true"/> : <ChevronRight size={12} aria-hidden="true"/>)}</span>}{conductorKind === 'worker' && !nested && <em className="oa-conductor-role is-worker">{ct('子任务', 'Worker')}</em>}{waiting && <em className="oa-session-waiting-label" title={ct('\u7b49\u5f85\u56de\u590d', 'Waiting for reply')}><CircleAlert size={12} aria-hidden="true"/>{ct('\u5f85\u56de\u590d', 'Waiting')}</em>}{unread && <em className="oa-session-unread-label">{ct('未读', 'Unread')}</em>}<SessionAutorunBadge enabled={Boolean(session.autorun?.enabled)} sessionId={session.id} targetSessionId={session.id}/>{sidebarLoop && <em className="oa-session-loop-badge" title={ct(`Loop 进行中 · 第 ${sidebarLoop.round} 轮`, `Loop active · round ${sidebarLoop.round}`)}>Loop {sidebarLoop.round}</em>}{session.hub_enabled && <em className="oa-session-hub-badge" title={ct('已入驻官方 Hub', 'Joined official Hub')}>Hub</em>}{hasDraft && <em className="oa-session-draft-badge">{ct('草稿', 'Draft')}</em>}</span>
      {((session.running && !waiting) || childrenRunning > 0) && <small className="oa-session-activity">
        {session.running && !waiting && <em className="oa-session-running-label" role="img" aria-label={runningLabel} title={runningLabel}><span className="oa-session-running-wave" style={{ '--oa-wave-phase': `${-(Array.from(String(session.id)).reduce((hash, char)=> (hash * 31 + char.charCodeAt(0)) % 2400, 0) / 1000)}s` }} aria-hidden="true"><i/><i/><i/><i/></span></em>}
        {childrenRunning > 0 && <em className="oa-session-running-label oa-session-child-running-label" role="img" aria-label={childRunningLabel} title={childRunningLabel}><GitBranch size={12} strokeWidth={1.8} aria-hidden="true"/></em>}
      </small>}
    </button></SessionTimeTooltip>}
    {!editing && <button className={`oa-session-more ${menuOpen ? 'is-open' : ''}`} onClick={(event)=>actionsRef.current.toggleMenu(session.id, event)} aria-label={ct('会话操作', 'Session actions')}><MoreHorizontal size={16}/></button>}
  </div>
})

const ConductorWorkspace = memo(function ConductorWorkspace({ detail, sessions, onOpen, onStop, onRecover, onClose, stoppingID = '' }) {
  const workers = conductorWorkers(detail, sessions)
  const counts = conductorStatusCounts(workers)
  const usage = detail?.conductor_usage_summary
  const usageText = (value) => `${Number(value?.prompt_tokens || 0).toLocaleString()} / ${Number(value?.output_tokens || 0).toLocaleString()}`
  return <aside id="oa-conductor-workers" className="oa-conductor-events oa-conductor-agents" aria-label="Subagents">
    <div className="oa-conductor-events-body">
      <header className="oa-conductor-events-head"><b>Subagents <span>{counts.total}</span></b><button type="button" className="oa-icon-btn" onClick={onClose} aria-label={ct('关闭子代理侧栏', 'Close subagents')}><X size={16}/></button></header>
      <div className="oa-conductor-event-scroll">
        <section aria-label={ct('任务用量', 'Task usage')}>
          <p>{ct('累计派发', 'Dispatches')}: {detail?.conductor_dispatch_count ?? '\u2014'}</p>
          {usage ? <>
            <small>{ct('Token：输入 / 输出', 'Tokens: input / output')}</small>
            <p>{ct('父任务', 'Parent')}: {usageText(usage.parent)}</p>
            <p>{ct('已封存子任务', 'Finalized children')}: {usageText(usage.children)}</p>
            <p>{ct('已记录合计', 'Recorded total')}: {usageText(usage.total)}</p>
            {usage.missing_dispatches > 0 && <p role="status">{ct('缺失用量快照', 'Missing usage snapshots')}: {usage.missing_dispatches}. {ct('合计不完整，缺失不代表零消耗。', 'Total incomplete; missing does not mean zero usage.')}</p>}
          </> : <p>{ct('用量未知', 'Usage unavailable')}</p>}
          <small>{ct('运行中用量不完整；子任务仅计入已保存的终态快照。', 'Running usage is incomplete; children include only saved terminal snapshots.')}</small>
        </section>
        {workers.length ? workers.map((worker, index) => {
          const id = String(worker?.session_id || worker?.id || '')
          const status = workerStatus(worker)
          const active = canStopConductorWorker(worker) || status === 'cancelling'
          const objective = String(worker?.objective || '')
          const taskName = worker?.task_name || worker?.title || objective.split('\n')[0] || ct('未命名任务', 'Untitled task')
          const statusLabel = ct(({ recovery_pending: '恢复待确认', queued: '排队中', running: '执行中', cancelling: '停止中', succeeded: '执行结束', failed: '失败', cancelled: '已取消' })[status] || '未知', status === 'recovery_pending' ? 'Recovery pending confirmation' : status === 'succeeded' ? 'Execution finished' : status || 'unknown')
          return <article className="oa-conductor-agent" key={id}>
            <div className="oa-conductor-agent-head"><button type="button" onClick={()=>onOpen(id)} title={id}>Subagent {index + 1}<ExternalLink size={13}/></button><span><i className={`oa-conductor-status-dot is-${status}`} aria-hidden="true"/>{statusLabel}</span></div>
            <small>{active ? ct('当前任务', 'Current task') : ct('最近任务', 'Latest task')}</small>
            <h3 title={taskName}>{taskName}</h3>
            {status === 'recovery_pending' && <p role="status">{ct('本实例无法确认任务归属或运行状态；保留原记录，不自动重跑，也不释放可能仍占用的槽位。', 'This instance cannot confirm ownership or runtime. Records and possible occupied slots are preserved; no automatic replay.')}</p>}
            {status === 'succeeded' && <p>{worker.review?.status === 'verified' ? ct('已核验（父代理审查）', 'Verified (parent review)') : worker.review?.status === 'needs_work' ? ct('需补充', 'Needs work') : ct('待核验', 'Pending review')}</p>}
            {worker.evidence?.length > 0 && <details><summary>{ct('工具记录', 'Tool records')} ({worker.evidence.length})</summary>{worker.evidence.map(item => <p key={item.id}><code>{item.id} · {item.tool}</code><br/>{item.result}</p>)}</details>}
            {worker.review?.unverified && <p>{worker.review.unverified}</p>}
            {worker.review?.basis && <p>{worker.review.basis}</p>}
            {objective && <details><summary>{ct('任务详情', 'Task details')}</summary><p>{objective}</p></details>}
            {status === 'recovery_pending' && <button type="button" className="oa-conductor-stop" disabled={!!stoppingID} onClick={()=>onRecover(worker)}>{ct('确认中断并交回指挥家', 'Confirm interruption and return to conductor')}</button>}
            {canStopConductorWorker(worker) && <button type="button" className="oa-conductor-stop" onClick={()=>onStop(id)} disabled={stoppingID === id}>{stoppingID === id ? ct('停止中…', 'Stopping…') : ct('停止任务', 'Stop task')}</button>}
          </article>
        }) : <p className="oa-conductor-empty">{ct('尚未派发子代理。', 'No subagents dispatched yet.')}</p>}
      </div>
    </div>
  </aside>
})

export const PendingAttachments = memo(function PendingAttachments({ attachments = [], onRemove }) {
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    if (!preview || typeof document === 'undefined') return undefined
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event) => { if (event.key === 'Escape') setPreview(null) }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [preview])

  if (!attachments.length) return null

  return <>
    <div className="oa-attach-preview">
      {normalizeChatAttachments(attachments).map((attachment) => {
        const name = uploadFileName(attachment)
        const image = isImageFile(attachment)
        const source = image ? uploadFileSource(attachment) : ''
        const visual = getFileVisual(name)
        const Icon = visual.Icon
        const extension = (name.match(/\.([^.]+)$/)?.[1] || 'FILE').slice(0, 6).toUpperCase()
        return <div className={`oa-attach-thumb ${image ? 'is-image' : `is-file oa-file-kind-${visual.kind}`}`} key={attachment.id} title={name}>
          {image
            ? <button className="oa-attach-open" type="button" onClick={()=>setPreview({ name, source })} title={ct('预览图片', 'Preview image')} aria-label={ct(`预览图片 ${name}`, `Preview image ${name}`)}><img src={source} alt=""/></button>
            : <div className="oa-attach-file-icon"><Icon size={25}/><small>{extension}</small></div>}
          <span>{image ? <FileImage size={12}/> : <Icon size={12}/>} {name}</span>
          <button className="oa-attach-remove" type="button" onClick={()=>onRemove?.(attachment.id)} title={ct('移除附件', 'Remove attachment')} aria-label={ct(`移除附件 ${name}`, `Remove attachment ${name}`)}><X size={12}/></button>
        </div>
      })}
    </div>
    {preview && typeof document !== 'undefined' && createPortal(
      <div className="oa-attachment-lightbox" onMouseDown={(event)=>{ if (event.target === event.currentTarget) setPreview(null) }}>
        <section className="oa-attachment-lightbox-dialog" role="dialog" aria-modal="true" aria-label={ct(`图片预览 ${preview.name}`, `Image preview ${preview.name}`)}>
          <img src={preview.source} alt={preview.name}/>
          <footer><span title={preview.name}>{preview.name}</span><button type="button" onClick={()=>setPreview(null)} aria-label={ct('关闭图片预览', 'Close image preview')}><X size={18}/></button></footer>
        </section>
      </div>,
      document.body,
    )}
  </>
})

export function SessionManagerGroup({ label, items, selectedIds, collapsed, disabled, onToggle, onSelect, children }) {
  const selected = items.filter(item => selectedIds.has(item.id)).length
  const all = items.length > 0 && selected === items.length
  return <section className="oa-session-manager-group">
    <div className="oa-session-manager-group-header">
      <button type="button" className="oa-session-group-select" role="checkbox"
        aria-label={ct(`选择分组：${label}`, `Select group: ${label}`)} aria-checked={all ? true : selected ? 'mixed' : false}
        disabled={disabled || !items.length} onClick={onSelect}>
        <span className={`oa-session-check ${all ? 'is-checked' : selected ? 'is-partial' : ''}`}>{all && <Check size={12}/>}</span>
      </button>
      <button type="button" className="oa-session-group-toggle" aria-expanded={!collapsed} onClick={onToggle}>
        <span>{label}</span><small>{selected} / {items.length}</small>
        <ChevronDown size={14} style={{ transform: collapsed ? 'rotate(90deg)' : 'none' }} aria-hidden="true"/>
      </button>
    </div>
    {!collapsed && children}
  </section>
}

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

const AssistantContent = memo(function AssistantContent({ content, structuredContent, pending, onAskReply, isLatestMessage = false, turnUsages, ultraplan_state, runStartedAtMS = 0, clockNow = 0, modelID = '', contentPartial = false, executionCount = 0, onLoadExecution }) {
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

const UsageRow = ({ u, usages = [], label, className, elapsedMs = 0, live = false, ctxChars = 0, ctxMsgs = 0, showTTFT = false, firstTokenMs = 0 }) => {
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

export const ChatStats = memo(function ChatStats({ messages = [], now = Date.now(), running = false }) {
  const stats = buildChatStats(messages, now, running)
  return <div className="oa-chat-stats" aria-label="对话统计">
    <span>{stats.rounds} 轮 · {stats.steps} 步</span>
    <i aria-hidden="true">|</i>
    <span>LLM {formatElapsedMs(stats.llmElapsedMs)} · 工具调用 {formatElapsedMs(stats.toolElapsedMs)}</span>
    <i aria-hidden="true">|</i>
    <span>{stats.firstTokenIsModelTTFT ? '模型 TTFT 中位' : '首 token 中位'} {stats.firstTokenMs > 0 ? `${(stats.firstTokenMs / 1000).toFixed(1)}s · ${stats.firstTokenSamples}次` : '—'} · <span className="oa-chat-stats-rate" title={ct('请求平均输出速率：已计时调用的输出 token 总数 ÷ 这些调用的请求总耗时；包含 TTFT、隐藏推理及网络等待，不含工具执行。不是纯解码速度；旧记录不估算。', 'Request-average output throughput: measured output tokens / complete model-request time, including TTFT, hidden reasoning and network wait, excluding tool execution. Not decoder-only speed; legacy records are not estimated.')}>{stats.outputRate > 0 ? `${stats.outputRate.toFixed(1)} tok/s` : '— tok/s'}</span></span>
    <i aria-hidden="true">|</i>
    <span>缓存命中 {stats.cachePercent}%</span>
    <i aria-hidden="true">|</i>
    <span>输入 {formatTokens(stats.inputTokens)} · 输出 {formatTokens(stats.outputTokens)}</span>
  </div>
})

export const ChatMessage = memo(function ChatMessage({
  message: m, pending, onAskReply, isLatestMessage = false, onEditResend, onRetryBTW,
  editDisabled = false, clockNow = 0, conductorWorker = false, onLoadMessage,
}) {
  const userText = m.role === 'user' ? stripUserAttachmentBlock(m.content) : m.content
  const shortInstruction = '\n\n[Server-owned Conductor worker instruction]\nComplete only this delegated objective. Return a concise, evidence-based result for the parent.'
  const legacyInstruction = `${shortInstruction} Do not attempt to dispatch other workers.`
  const workerInstruction = typeof userText === 'string'
    ? ([legacyInstruction, shortInstruction].find(suffix => userText.endsWith(suffix)) || '')
    : ''
  // Legacy inference is restricted to messages without explicit provenance.
  const delegated = m.role === 'user' && (m.sender_kind === 'conductor' ||
    (!m.sender_kind && conductorWorker && !!workerInstruction))
  const delegatedObjective = delegated ? (workerInstruction ? userText.slice(0, -workerInstruction.length) : userText) : ''
  const messageFiles = normalizeChatAttachments(m.files)
  const imageFiles   = messageFiles.filter(isImageFile)
  const nonImageFiles = messageFiles.filter(f => !isImageFile(f))
  const metadataFilePaths = nonImageFiles
    .map(file => String(file?.path || file?.Path || '').trim())
    .filter(Boolean)
  const savedFilePaths = m.role === 'user'
    ? (metadataFilePaths.length > 0 ? metadataFilePaths : extractSavedFilePaths(m.content))
    : []
  const pendingFiles = savedFilePaths.length > 0 ? [] : nonImageFiles
  const [copied,  setCopied]  = useState(false)
  const [copyErr, setCopyErr] = useState('')
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState(userText || '')
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState('')
  const editRef = useRef(null)
  const ageText = m.role === 'user' ? formatAge(m.created_at) : ''
  const assistantModelId = m.role === 'assistant' ? String(m.model_id || '').trim() : ''
  const assistantCreatedAt = m.role === 'assistant' ? dateFromTimestamp(m.created_at) : null
  const assistantTime = assistantCreatedAt?.toLocaleString() || ''
  const turnUsages = Array.isArray(m.usages) && m.usages.length ? m.usages : (m.usage ? [m.usage] : [])
  const hasUsage = turnUsages.some(usageHasTokens)
  const usageTotal = hasUsage ? sumUsages(turnUsages) : null
  const elapsedMs = getElapsedMs(m, clockNow, pending)
  const showUsageRow = m.role === 'assistant' && (hasUsage || elapsedMs > 0 || m.ctx_chars > 0 || m.ctx_msgs > 0)
  const isBTW = m.kind === 'btw'
  const btwDisplay = m.role === 'user' ? parseBTWDisplay(userText) : null

  const copyContent = async () => {
    try {
      const full = m.content_partial ? await onLoadMessage(m) : m
      const txt = m.role === 'user' ? userText : (full.content || '')
      await navigator.clipboard.writeText(txt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) { if (e.name !== 'AbortError') setCopyErr(String(e)) }
  }
  const startMessageEdit = () => {
    setEditDraft(userText || '')
    setEditError('')
    setEditing(true)
    requestAnimationFrame(() => editRef.current?.focus())
  }
  const cancelMessageEdit = () => {
    if (editSubmitting) return
    setEditing(false)
    setEditError('')
    setEditDraft(userText || '')
  }
  const submitMessageEdit = async () => {
    const nextText = editDraft.trim()
    if (!nextText || editSubmitting || !onEditResend) return
    setEditSubmitting(true)
    setEditError('')
    try {
      await onEditResend(m.id, nextText)
      setEditing(false)
    } catch (e) {
      setEditError(e?.message || String(e))
    } finally {
      setEditSubmitting(false)
    }
  }

  // 助手消息把操作按钮排进正文末尾的页脚，与「总计」同一行；用户消息保留气泡外悬浮布局
  const metaNode = (
    <div className="oa-msg-meta">
      {ageText && <span className="oa-msg-age" title={ageText}><Clock3 size={11}/>{ageText}</span>}
      {copyErr  && <span className="oa-copy-err">{copyErr}</span>}
      <button type="button" className="oa-icon-btn oa-copy-btn"
        onClick={copyContent} title={ct('复制', 'Copy')} aria-label={ct('复制消息', 'Copy message')}>
        {copied ? <Check size={13}/> : <Copy size={13}/>}
      </button>
      {m.role === 'user' && !delegated && !pending && onEditResend && (
        <button type="button" className="oa-icon-btn oa-message-edit-trigger"
          onClick={startMessageEdit} disabled={editDisabled}
          title={editDisabled ? ct('对话运行中，请等待完成后再编辑', 'Wait for the running conversation to finish before editing') : ct('编辑并重新发送', 'Edit and resend')} aria-label={ct('编辑并重新发送', 'Edit and resend')}>
          <Edit3 size={13}/>
        </button>
      )}
      {m.role === 'user' && !pending && onAskReply && (
        <button type="button" className="oa-icon-btn oa-ask-reply-btn"
          onClick={() => onAskReply(m.content)}
          title={ct('以此为上下文继续提问', 'Continue from this context')} aria-label={ct('以此继续', 'Continue from here')}>
          <MessageSquarePlus size={13}/>
        </button>
      )}
    </div>
  )

  return (
    <article className={`oa-message ${delegated ? 'user conductor-dispatch' : m.role} ${pending ? 'pending' : ''} ${editing ? 'oa-message-editing' : ''} ${isBTW ? 'oa-message-btw' : ''}`} data-id={m.id}>
      <div className="oa-msg-body">
        {m.role === 'assistant'
          ? (<>
              {(assistantModelId || assistantTime) && (
                <div className="oa-meta" aria-label={ct('回复信息', 'Response information')}>
                  <span className="oa-meta-brand">GenericAgent</span>
                  {assistantModelId && (
                    <span className="oa-model-id" title={`Model ID: ${assistantModelId}`}>{assistantModelId}</span>
                  )}
                  {assistantTime && <span className="oa-meta-separator" aria-hidden="true">{'·'}</span>}
                  {assistantTime && (
                    <time className="oa-message-time" dateTime={assistantCreatedAt.toISOString()} title={assistantTime}>{assistantTime}</time>
                  )}
                </div>
              )}
              {isBTW && <div className="oa-btw-head">
                <span className="oa-btw-mark" aria-hidden="true" />
                <div><span>侧问</span><strong>{m.side_question || '未记录问题'}</strong></div>
                {m.btw_status !== 'done' && <em>{m.btw_status === 'pending' ? '思考中…' : '未完成'}</em>}
              </div>}
              {m.commandResult
                ? <CommandResultCard result={m.commandResult} />
                : m.btw_status === 'error'
                  ? <div className="oa-btw-error" role="alert"><span>{m.content || '侧问失败，请重试'}</span><button type="button" onClick={() => onRetryBTW?.(m)}>重试</button></div>
                  : <AssistantContent content={isBTW ? stripBTWEcho(m.content) : m.content} structuredContent={m.structured_content} pending={m.btw_status === 'pending' || pending} onAskReply={onAskReply} isLatestMessage={isLatestMessage} turnUsages={turnUsages} ultraplan_state={m.ultraplan_state} runStartedAtMS={m.run_started_at_ms} clockNow={clockNow} modelID={assistantModelId} contentPartial={m.content_partial} executionCount={m.execution_count} onLoadExecution={onLoadMessage ? () => onLoadMessage(m) : undefined} />}
            </>)
          : (<>
              {imageFiles.length > 0 && (
                <div className="oa-msg-images">
                  {imageFiles.map((f, i) => {
                    const src = chatAttachmentSource(f)
                    return (
                      <a key={i} className="oa-msg-image-link" href={src} target="_blank" rel="noreferrer" title={ct('打开原图', 'Open original image')}>
                        <img src={src} alt={f.name || ct('图片', 'Image')} className="oa-msg-image" />
                      </a>
                    )
                  })}
                </div>
              )}
              {(savedFilePaths.length > 0 || pendingFiles.length > 0) && (
                <div className="oa-message-files">
                  {savedFilePaths.map((savedPath, i) => (
                    <FileAttachment key={`${savedPath}-${i}`} path={savedPath} />
                  ))}
                  {pendingFiles.map((file, i) => {
                    const name = uploadFileName(file)
                    const visual = getFileVisual(name)
                    const Icon = visual.Icon
                    return <span className={`oa-pending-file oa-file-kind-${visual.kind}`} key={`${name}-${i}`} title={ct(`附件：${name}`, `Attachment: ${name}`)}><Icon size={18}/><b>{name}</b></span>
                  })}
                </div>
              )}
              {delegated ? <section className="oa-conductor-dispatch-card">
                <header>{ct('指挥家', 'Conductor')}<span>{ct('派发子任务', 'Delegated task')}</span></header>
                <div className="oa-conductor-dispatch-objective">{delegatedObjective}</div>
                <details><summary>{ct('内部执行指令', 'Internal worker instruction')}</summary><pre>{workerInstruction.trim()}</pre></details>
              </section> : editing
                ? (<div className="oa-message-editor">
                    <textarea ref={editRef} value={editDraft}
                      onChange={e => setEditDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Escape') cancelMessageEdit()
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitMessageEdit() }
                      }}
                      disabled={editSubmitting} aria-label={ct('编辑已发送消息', 'Edit sent message')} />
                    {editError && <div className="oa-message-editor-error" role="alert">{editError}</div>}
                    <div className="oa-message-editor-actions">
                      <span className="oa-message-editor-hint">{ct('重发会从此消息继续，并保留原附件', 'Resending continues from this message and keeps its original attachments')}</span>
                      <button type="button" className="oa-message-editor-cancel" onClick={cancelMessageEdit} disabled={editSubmitting}>{ct('取消', 'Cancel')}</button>
                      <button type="button" className="oa-message-editor-submit" onClick={submitMessageEdit}
                        disabled={editSubmitting || !editDraft.trim()}>{editSubmitting ? ct('发送中…', 'Sending…') : ct('发送', 'Send')}</button>
                    </div>
                  </div>)
                : (<div className={`oa-msg-text${btwDisplay ? ' oa-user-btw' : ''}`}>
                    {btwDisplay
                      ? <><span className="oa-user-btw-command"><i aria-hidden="true"/>/btw</span><span className="oa-user-btw-prompt">{btwDisplay.prompt || '侧问'}</span></>
                      : userText}
                  </div>)}
            </>)
        }
        {m.role === 'assistant'
          ? (<div className="oa-msg-footer">
              {showUsageRow && <UsageRow u={usageTotal} usages={turnUsages} showTTFT firstTokenMs={m.first_token_ms} elapsedMs={elapsedMs} live={pending} label={ct('总计', 'Total')} className="oa-usage-total" ctxChars={m.ctx_chars || 0} ctxMsgs={m.ctx_msgs || 0} />}
              {metaNode}
            </div>)
          : null}
      </div>

      {m.role === 'assistant' && (
        <UltraPlanMessageDrawer content={m.content || ''} state={m.ultraplan_state} pending={pending} onAskReply={onAskReply} />
      )}

      {m.goal_state && <GoalStatusCard state={m.goal_state} pending={pending} />}

      {m.role === 'user' ? metaNode : null}
    </article>
  )
})

export const ConductorEvents = memo(function ConductorEvents({ conductorDetail, onClose }) {
  const events = conductorChildren(conductorDetail).flatMap((worker, index) => [
    { time: worker.created_at, kind: 'dispatched', label: ct('任务已派发', 'Task dispatched') },
    { time: worker.started_at, kind: 'started', label: ct('子任务已启动', 'Worker started') },
    { time: worker.finished_at, kind: 'finished', label: `${ct('子任务结束', 'Worker finished')} · ${ct(({ succeeded: '已完成', completed: '已完成', failed: '失败', cancelled: '已取消' })[workerStatus(worker)] || workerStatus(worker), workerStatus(worker))}` },
  ].filter(event => Number(event.time) > 0).map(event => ({ ...event, worker, id: `${worker.dispatch_id || worker.session_id || index}-${event.kind}` })))
    .sort((a, b) => Number(a.time) - Number(b.time))
  return <aside id="oa-conductor-events" className="oa-conductor-events" aria-label={ct('任务事件', 'Task events')}>
    <div className="oa-conductor-events-body">
      <header className="oa-conductor-events-head"><b>{ct('任务事件', 'Task events')} <span>{events.length}</span></b><button type="button" className="oa-icon-btn" onClick={onClose} aria-label={ct('关闭任务事件', 'Close task events')}><X size={16}/></button></header>
      <div className="oa-conductor-event-scroll">{events.slice().reverse().map(event => <article key={event.id} className={`oa-conductor-event is-${event.kind === 'finished' ? workerStatus(event.worker) : event.kind}`}>
        <div className="oa-conductor-event-meta"><strong>{event.label}</strong><time title={new Date(Number(event.time) * 1000).toLocaleString()}>{new Date(Number(event.time) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
        <details className="oa-conductor-event-task"><summary><span>{event.worker.title || event.worker.objective || event.worker.session_id}</span></summary><p>{event.worker.objective || event.worker.title || event.worker.session_id}</p></details>
        {event.kind === 'finished' && (event.worker.result || event.worker.error) && <details><summary>{ct('查看结果 / 错误', 'View result / error')}</summary><pre>{event.worker.error || event.worker.result}</pre></details>}
      </article>)}</div>
    </div>
  </aside>
})

const MESSAGE_RENDER_TAIL = 2
const MESSAGE_RENDER_LIMIT = 12
const MESSAGE_HEIGHT_CACHE_LIMIT = 160
const messageHeightCache = new Map()

function messageRenderKey(message) {
  return String(message?.render_key || message?.id || '')
}

function estimatedMessageHeight(message, showTimeline, showVersions) {
  const chars = String(message?.content || '').length
  const base = message?.role === 'user' ? 72 : 96
  return Math.min(1200, base + Math.ceil(chars / 90) * 24 + (showTimeline ? 38 : 0) + (showVersions ? 32 : 0))
}

function rememberMessageHeight(cacheKey, height) {
  if (!cacheKey || !Number.isFinite(height) || height <= 0) return
  messageHeightCache.delete(cacheKey)
  messageHeightCache.set(cacheKey, Math.ceil(height))
  while (messageHeightCache.size > MESSAGE_HEIGHT_CACHE_LIMIT) {
    messageHeightCache.delete(messageHeightCache.keys().next().value)
  }
}

const VirtualMessageSlot = memo(function VirtualMessageSlot({
  active, cacheKey, estimatedHeight, messageID, messageKey, children,
}) {
  const slotRef = useRef(null)
  useLayoutEffect(() => {
    if (!active || !slotRef.current) return undefined
    const slot = slotRef.current
    const measure = () => rememberMessageHeight(cacheKey, slot.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(slot)
    return () => observer.disconnect()
  }, [active, cacheKey])
  const height = messageHeightCache.get(cacheKey) || estimatedHeight
  return (
    <div
      ref={slotRef}
      className={`oa-message-slot ${active ? 'is-active' : 'is-placeholder'}`}
      data-message-id={messageID}
      data-message-key={messageKey}
      style={active ? undefined : { height }}
      aria-hidden={active ? undefined : 'true'}
    >
      {active ? children : null}
    </div>
  )
})

function MessageListContent({
  messages, isCurrentRunning, onAskReply, onEditResend, onRetryBTW, clockNow, onLoadMessage,
  worldline, onSwitchVersion, conductorDetail, sessionKey,
}) {
  const rootRef = useRef(null)
  const threadMessages = useMemo(() => messages.filter(message => message.kind !== 'btw'), [messages])
  const lastMessageId = threadMessages.at(-1)?.id
  // Content deltas retain the same slots: keep observer/effect dependencies
  // stable until the ordered key sequence changes. JSON preserves key boundaries.
  const messageKeysJSON = JSON.stringify(threadMessages.map(messageRenderKey))
  const messageKeys = useMemo(() => JSON.parse(messageKeysJSON), [messageKeysJSON])
  const tailKeys = useMemo(() => new Set(messageKeys.slice(-MESSAGE_RENDER_TAIL)), [messageKeys])
  const [activeKeys, setActiveKeys] = useState(() => new Set(tailKeys))
  const activationOrderRef = useRef([])
  const visibleKeysRef = useRef(new Set())
  const queueRef = useRef([])
  const frameRef = useRef(0)

  const activateKey = useCallback(key => {
    setActiveKeys(current => {
      const next = new Set(current)
      if (key) {
        next.add(key)
        activationOrderRef.current = [...activationOrderRef.current.filter(item => item !== key), key]
      }
      if (next.size > MESSAGE_RENDER_LIMIT) {
        const removable = [...next].filter(item => !tailKeys.has(item) && !visibleKeysRef.current.has(item))
        for (const victim of removable) {
          if (next.size <= MESSAGE_RENDER_LIMIT) break
          next.delete(victim)
          activationOrderRef.current = activationOrderRef.current.filter(item => item !== victim)
        }
      }
      return next.size === current.size && [...next].every(key => current.has(key)) ? current : next
    })
  }, [tailKeys])

  useEffect(() => {
    const available = new Set(messageKeys)
    activationOrderRef.current = activationOrderRef.current.filter(key => available.has(key))
    setActiveKeys(current => {
      const next = new Set([...current].filter(key => available.has(key)))
      tailKeys.forEach(key => next.add(key))
      if (next.size > MESSAGE_RENDER_LIMIT) {
        for (const key of next) {
          if (next.size <= MESSAGE_RENDER_LIMIT) break
          if (!tailKeys.has(key) && !visibleKeysRef.current.has(key)) next.delete(key)
        }
      }
      return next.size === current.size && [...next].every(key => current.has(key)) ? current : next
    })
  }, [messageKeys, tailKeys])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const forceActivate = event => activateKey(String(event.detail?.key || ''))
    root.addEventListener('ga-activate-message', forceActivate)
    return () => root.removeEventListener('ga-activate-message', forceActivate)
  }, [activateKey])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof IntersectionObserver !== 'function') {
      setActiveKeys(current => {
        const next = new Set(messageKeys)
        if (next.size === current.size && [...next].every(key => current.has(key))) return current
        return next
      })
      return undefined
    }
    const scrollRoot = root.closest('.oa-thread')
    const activateNext = () => {
      frameRef.current = 0
      const key = queueRef.current.shift()
      if (!key) return
      if (visibleKeysRef.current.has(key)) activateKey(key)
      if (queueRef.current.length) frameRef.current = requestAnimationFrame(activateNext)
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const key = entry.target.dataset.messageKey
        if (!key) continue
        if (entry.isIntersecting) {
          visibleKeysRef.current.add(key)
          if (!queueRef.current.includes(key)) queueRef.current.push(key)
        } else {
          visibleKeysRef.current.delete(key)
          queueRef.current = queueRef.current.filter(item => item !== key)
        }
      }
      // The budget is soft only for the actual viewport and the streaming tail.
      activateKey(null)
      if (queueRef.current.length && !frameRef.current) frameRef.current = requestAnimationFrame(activateNext)
    }, { root: scrollRoot, rootMargin: '0px' })
    root.querySelectorAll('.oa-message-slot').forEach(node => observer.observe(node))
    return () => {
      observer.disconnect()
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      queueRef.current = []
      visibleKeysRef.current.clear()
    }
  }, [activateKey, sessionKey, messageKeys])

  return (
    <div ref={rootRef} className="oa-message-list">
      {threadMessages.map((m, i) => {
        const key = messageRenderKey(m)
        const dateKey = fmtDate(m.created_at)
        const prevDate = i > 0 ? fmtDate(threadMessages[i - 1]?.created_at) : ''
        const showTimeline = i === 0 || dateKey !== prevDate
        const versionInfo = m.role === 'user' && onSwitchVersion ? messageVersionInfo(worldline, m.id) : null
        const showVersions = Boolean(versionInfo && versionInfo.total > 1)
        const cacheKey = `${sessionKey}:${key}`
        return (
          <VirtualMessageSlot
            key={key}
            active={activeKeys.has(key)}
            cacheKey={cacheKey}
            estimatedHeight={estimatedMessageHeight(m, showTimeline, showVersions)}
            messageID={m.id}
            messageKey={key}
          >
            {showTimeline && <div className="oa-timeline"><span>{dateKey}</span></div>}
            <ChatMessage
              message={m}
              conductorWorker={conductorDetail?.conductor?.role === 'worker'}
              pending={!m.kind && isCurrentRunning && m.id === lastMessageId}
              onAskReply={onAskReply}
              isLatestMessage={m.role === 'assistant' && m.id === lastMessageId}
              onEditResend={onEditResend}
              onRetryBTW={onRetryBTW}
              onLoadMessage={onLoadMessage}
              editDisabled={isCurrentRunning}
              clockNow={clockNow}
            />
            {showVersions && <div className="oa-msg-versions">
              <button type="button" disabled={isCurrentRunning || !versionInfo.previous_node_id}
                onClick={() => onSwitchVersion(versionInfo.previous_node_id)} title="上一个版本" aria-label="上一个版本">
                <ChevronLeft size={13}/>
              </button>
              <em>{versionInfo.index}/{versionInfo.total}</em>
              <button type="button" disabled={isCurrentRunning || !versionInfo.next_node_id}
                onClick={() => onSwitchVersion(versionInfo.next_node_id)} title="下一个版本" aria-label="下一个版本">
                <ChevronRight size={13}/>
              </button>
            </div>}
          </VirtualMessageSlot>
        )
      })}
    </div>
  )
}

export const MessageList = memo(function MessageList({
  messages, isCurrentRunning, onAskReply, onEditResend, onRetryBTW, clockNow, onLoadMessage,
  worldline = null, onSwitchVersion = null, conductorDetail = null, sessionKey = '',
}) {
  return <MessageListContent
    key={sessionKey}
    messages={messages}
    isCurrentRunning={isCurrentRunning}
    onAskReply={onAskReply}
    onEditResend={onEditResend}
    onRetryBTW={onRetryBTW}
              onLoadMessage={onLoadMessage}
    clockNow={clockNow}
    worldline={worldline}
    onSwitchVersion={onSwitchVersion}
    conductorDetail={conductorDetail}
    sessionKey={sessionKey}
  />
})

export default function ChatApp({ onOpenSettings } = {}) {
  const uiPackage = useUiPackage()
  // Theme state: sync with localStorage and system preference
  const [conductorEventsOpen, setConductorEventsOpen] = useState(false)
  const [conductorWorkersOpen, setConductorWorkersOpen] = useState(false)
  const [conductorConflict, setConductorConflict] = useState(null)
  const [theme, setTheme] = useState(getInitialTheme)
  useEffect(() => {
    const activeTheme = applyThemeToDocument(theme)
    persistTheme(activeTheme.id)
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = chatLanguage() === 'en' ? 'en' : 'zh-CN'
    api('/api/config').then(cfg => {
      setCfg(cfg)
    }).catch(() => {})
    api('/api/slash-commands').then(res => {
      const items = Array.isArray(res?.commands) ? res.commands : []
      const normalized = items
        .filter(c => c && typeof c.cmd === 'string' && c.cmd.trim().startsWith('/'))
        .map(c => ({
          ...c,
          cmd: c.cmd.trim(),
          key: c.key || c.cmd.trim(),
          insert: c.insert || c.cmd.trim(),
          builtIn: c.builtIn !== false,
        }))
      if (normalized.length) {
        const serverKeys = new Set(normalized.map(c => builtinSlashKey(c.cmd)))
        const missing = BUILTIN_SLASH_COMMANDS.filter(c => !serverKeys.has(builtinSlashKey(c.cmd)))
        setSlashCommands(missing.length ? [...normalized, ...missing] : normalized)
      }
    }).catch(() => {})
  }, [])
  const [chatInstanceID, setChatInstanceID] = useState(initialChatInstanceID)
  const [chatInstances, setChatInstances] = useState([])
  const [chatInstancesLoading, setChatInstancesLoading] = useState(true)
  const [sessions, setSessions] = useState([])
  const [projects, setProjects] = useState([])
  const [pinnedProjects, setPinnedProjects] = useState([])
  const [projectOrder, setProjectOrder] = useState([])
  const { preferences: sidebarPreferences, update: updateSidebarPreference, error: sidebarPreferencesError } = useSidebarPreferences()
  const historyExpanded = sidebarPreferences.historyExpanded
  const setHistoryExpanded = value => updateSidebarPreference('historyExpanded', value)
  const pinnedExpanded = sidebarPreferences.pinnedExpanded
  const setPinnedExpanded = value => updateSidebarPreference('pinnedExpanded', value)
  const conductorsExpanded = sidebarPreferences.conductorsExpanded
  const setConductorsExpanded = value => updateSidebarPreference('conductorsExpanded', value)
  const projectsExpanded = sidebarPreferences.projectsExpanded
  const setProjectsExpanded = value => updateSidebarPreference('projectsExpanded', value)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const showAllProjects = sidebarPreferences.showAllProjects
  const setShowAllProjects = value => updateSidebarPreference('showAllProjects', value)
  const expandedProjectNames = new Set(sidebarPreferences.expandedProjectNames)
  const setExpandedProjectNames = update => updateSidebarPreference('expandedProjectNames', current => [...update(new Set(current))])
  const [projectDraftOpen, setProjectDraftOpen] = useState(false)
  const [projectDraftName, setProjectDraftName] = useState('')
  const [projectCreating, setProjectCreating] = useState(false)
  const [draftSessionIds, setDraftSessionIds] = useState(() => new Set(listChatSessionDraftIds(undefined, chatInstanceID)))
  const [sid, setSid] = useState('')
  const [messages, setMessages] = useState([])
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionLoadFailed, setSessionLoadFailed] = useState(false)
  const [rawHistory, setRawHistory] = useState([])
  const [historyInfo, setHistoryInfo] = useState([])
  const [workingState, setWorkingState] = useState(null)
  const [planState, setPlanState] = useState(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false)
  const mobileToolsTriggerRef = useRef(null)
  useEffect(() => {
    if (!mobileToolsOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return
      setMobileToolsOpen(false)
      requestAnimationFrame(() => mobileToolsTriggerRef.current?.focus())
    }
    const closeAboveBreakpoint = () => {
      if (window.innerWidth > 420) setMobileToolsOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeAboveBreakpoint)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeAboveBreakpoint)
    }
  }, [mobileToolsOpen])
  // The Loop rail starts collapsed: its launcher already reports the round and
  // spins while a loop runs, so an idle session need not give up the width.
  const [loopRailOpen, setLoopRailOpen] = useState(false)
  const [btwRailOpen, setBtwRailOpen] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [loopState, setLoopState] = useState(null)
  const [activeSessionDetail, setActiveSessionDetail] = useState(null)
  const [conductorEnabling, setConductorEnabling] = useState(false)
  const conductorEnablingRef = useRef(false)
  const [conductorStoppingID, setConductorStoppingID] = useState('')
  const [loopConfigOpen, setLoopConfigOpen] = useState(false)
  const [loopObjective, setLoopObjective] = useState('')
  const [loopMaxRounds, setLoopMaxRounds] = useState(0)
  const [loopMaxRetries, setLoopMaxRetries] = useState(2)
  const [loopUpdating, setLoopUpdating] = useState(false)
  const loopRecords = useMemo(() => normalizeLoopRecords(loopState), [loopState])
  const [busy, setBusy] = useState(false)
  const [streamingSid, setStreamingSid] = useState('')
  const [err, setErr] = useState('')
  const [taskbarStoppedRun, setTaskbarStoppedRun] = useState('')
  const taskbarRunKey = JSON.stringify([chatInstanceID, sid, messages.findLast(message => message.role === 'user')?.id || ''])
  const taskbarState = chatTaskbarState({
    sid, messages, loading: sessionLoading,
    running: (busy && streamingSid === sid) || sessions.some(session => session.id === sid && session.running),
    error: err,
    stopped: taskbarStoppedRun === taskbarRunKey,
  })

  useEffect(() => {
    const clear = () => publishTaskbarState('idle')
    window.addEventListener('pagehide', clear)
    return () => {
      window.removeEventListener('pagehide', clear)
      clear()
    }
  }, [])
  const [collapsed, setCollapsed] = useState(() => isNarrowChatViewport())
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (sidebarPreferencesError) setNotice(ct('侧栏设置未保存到后端：', 'Sidebar settings were not saved to the server: ') + sidebarPreferencesError)
  }, [sidebarPreferencesError, ct])
  const [sessionCopyNotice, updateSessionCopyNotice] = useState('')
  const sessionCopyNoticeTimerRef = useRef(null)
  const setSessionCopyNotice = useCallback((message) => {
    clearTimeout(sessionCopyNoticeTimerRef.current)
    sessionCopyNoticeTimerRef.current = null
    updateSessionCopyNotice(message)
    if (message) {
      sessionCopyNoticeTimerRef.current = setTimeout(() => {
        sessionCopyNoticeTimerRef.current = null
        updateSessionCopyNotice('')
      }, 3000)
    }
  }, [])
  useEffect(() => () => clearTimeout(sessionCopyNoticeTimerRef.current), [])
  const [llms, setLlms] = useState([])
  const [chatBackend, setChatBackend] = useState(null)
  const [depsRepairing, setDepsRepairing] = useState(false)
  const [llmNo, setLlmNo] = useState(0)
  const [loopControllerLlmNo, setLoopControllerLlmNo] = useState(null)
  const [reasoningEffort, setReasoningEffort] = useState('off')
  const [extraSysPrompts, setExtraSysPrompts] = useState([])
  const [extraSysPromptPresetID, setExtraSysPromptPresetID] = useState('')
  const [promptPresets, setPromptPresets] = useState([])
  const [extraPromptOpen, setExtraPromptOpen] = useState(false)
  const [extraPromptSelection, setExtraPromptSelection] = useState('')
  const [extraPromptTargetSid, setExtraPromptTargetSid] = useState('')
  const [promptPresetManagerOpen, setPromptPresetManagerOpen] = useState(false)
  const [extraPromptDraft, setExtraPromptDraft] = useState([])
  const [extraPromptSaving, setExtraPromptSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState('')
  const [menuPos, setMenuPos] = useState(null)
  const menuRef = useRef(null)
  const menuTriggerRef = useRef(null)
  const sidebarSessionActionsRef = useRef(null)
  const [editing, setEditing] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [sessionManagerOpen, setSessionManagerOpen] = useState(false)
  const [sessionManagerView, setSessionManagerView] = useState('project')
  const [collapsedSessionGroups, setCollapsedSessionGroups] = useState(() => new Set())
  const [selectedSessionIds, setSelectedSessionIds] = useState([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [hubUpdatingSessionId, setHubUpdatingSessionId] = useState('')
  const [attachments, setAttachments] = useState([])
  const attachmentsRef = useRef([])
  const draftRestoreRef = useRef(null)
  const draftRestoreFailedRef = useRef(false)
  const updateAttachments = (value) => {
    attachmentsRef.current = value
    setAttachments(value)
  }
  const [queuedMessages, setQueuedMessages] = useState([])
  const [queueCollapsed, setQueueCollapsed] = useState(false)
  const [queueEditingId, setQueueEditingId] = useState('')
  const [queueDraft, setQueueDraft] = useState('')
  const [guidingQueueId, setGuidingQueueId] = useState('')
  const autorunEnabled = Boolean(sessions.find(entry => entry.id === sid)?.autorun?.enabled)
  const autorunSavingRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [autoFollow, setAutoFollow] = useState(true)
  const [showFollow, setShowFollow] = useState(false)
  const [cmdDrawer, setCmdDrawer] = useState({ open: false, filter: '', selectedIdx: 0 })
  const [cmdManagerOpen, setCmdManagerOpen] = useState(false)
  const [keychainOpen, setKeychainOpen] = useState(false)
  const [worldlineRestorePicker, setWorldlineRestorePicker] = useState(null)
  const [slashCommands, setSlashCommands] = useState(BUILTIN_SLASH_COMMANDS)
  const [cfg, setCfg] = useState(null)
  const [cmdEditIdx, setCmdEditIdx] = useState(-1)
  const [cmdEditCmd, setCmdEditCmd] = useState('')
  const [cmdEditDesc, setCmdEditDesc] = useState('')
  const [cmdEditContent, setCmdEditContent] = useState('')
  const [isMobile, setIsMobile] = useState(() => isMobileViewport())
  const [streamClock, setStreamClock] = useState(() => Date.now())
  const threadRef = useRef(null)
  const composerWrapRef = useRef(null)
  const composerManualHeightRef = useRef(null)
  const composerResizePointerRef = useRef(null)
  const fileRef = useRef(null)
  const composerActionsTriggerRef = useRef(null)
  const promptRef = useRef(null)
  const cmdDrawerRef = useRef(null)
  const selectedCmdRef = useRef(null)
  const streamAbortRef = useRef(null)
  const chatInstanceRef = useRef(chatInstanceID)
  const chatRequestEpochRef = useRef(0)
  const chatLaunchIntentRef = useRef(readChatLaunchIntent())
  const chatLaunchStartedRef = useRef(false)
  const openedChatInstanceRef = useRef('')
  const chatApi = useCallback(async (url, options) => {
    const epoch = chatRequestEpochRef.current
    const instance = chatInstanceRef.current
    const result = await api(addChatInstanceToURL(url, instance), options)
    if (epoch !== chatRequestEpochRef.current) throw new DOMException('Chat instance changed', 'AbortError')
    return result
  }, [])
  const sessionCacheRef = useRef(null)
  if (!sessionCacheRef.current) sessionCacheRef.current = createChatSessionCache()
  const sessionListReaderRef = useRef(null)
  if (!sessionListReaderRef.current) sessionListReaderRef.current = createChatSessionListReader()
  const loadSessionList = useCallback(async (options = {}) => {
    const epoch = chatRequestEpochRef.current
    const url = addChatInstanceToURL('/api/chat/sessions', chatInstanceRef.current)
    const result = await sessionListReaderRef.current.load(url, options)
    if (epoch !== chatRequestEpochRef.current) throw new DOMException('Chat instance changed', 'AbortError')
    return result
  }, [])
  const sessionLoadAbortRef = useRef(null)
  const loadSessionDetail = (id, options = {}) => sessionCacheRef.current.load(
    addChatInstanceToURL(`/api/chat/session/${id}?view=page&execution=lazy`, chatInstanceRef.current), options,
  )
  const cancelSessionLoad = () => {
    sessionLoadAbortRef.current?.abort()
    sessionLoadAbortRef.current = null
    setSessionLoading(false)
    setSessionLoadFailed(false)
  }
  useEffect(() => () => {
    sessionLoadAbortRef.current?.abort()
    sessionCacheRef.current.clear()
    sessionListReaderRef.current.clear()
  }, [])
  const chatFetch = useCallback(async (url, options) => {
    const epoch = chatRequestEpochRef.current
    const result = await fetch(addChatInstanceToURL(url, chatInstanceRef.current), options)
    if (epoch !== chatRequestEpochRef.current) {
      result.body?.cancel?.().catch?.(() => {})
      throw new DOMException('Chat instance changed', 'AbortError')
    }
    return result
  }, [])
  const runSeqRef = useRef(0)
  const streamActivitySeqRef = useRef(0)
  const activeRunRef = useRef(false)
  const queueWriteRef = useRef(Promise.resolve())
  const guidingQueueRef = useRef('')
  const openSeqRef = useRef(0)
  const activeSidRef = useRef('')
  const extraPromptSelectionSeqRef = useRef(0)
  const [worldlineOpen, setWorldlineOpen] = useState(false)
  const [worldlineState, setWorldlineState] = useState(null)
  const [worldlineLoading, setWorldlineLoading] = useState(false)
  const [worldlineSwitchingId, setWorldlineSwitchingId] = useState('')
  const worldlineSeqRef = useRef(0)
  const messagesRef = useRef([])
  const sessionsRef = useRef([])
  // Keep synchronous mirrors so async reconnect flows do not compare stale render state.
  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { sessionsRef.current = sessions }, [sessions])
  const scrollModeRef = useRef('auto')
  const autoFollowRef = useRef(true)
  const previousScrollTopRef = useRef(0)
  const previousScrollHeightRef = useRef(0)
  const followSettleUntilRef = useRef(0)
  const [followScheduler] = useState(() => createThreadFollowScheduler({
    getThread: () => threadRef.current,
    isFollowing: () => autoFollowRef.current,
    onScroll: (thread, behavior) => {
      previousScrollTopRef.current = thread.scrollTop
      previousScrollHeightRef.current = thread.scrollHeight
      followSettleUntilRef.current = Date.now() + (behavior === 'smooth' ? SMOOTH_SETTLE_MS : FOLLOW_SETTLE_MS)
    },
    schedule: callback => window.requestAnimationFrame(callback),
    cancel: handle => window.cancelAnimationFrame(handle),
  }))
  useLayoutEffect(() => () => followScheduler.cancel(), [followScheduler, sid])
  const sessionScrollSnapshotsRef = useRef(new Map())
  const pendingSessionScrollRestoreRef = useRef(null)
  const pendingRenderedSessionRef = useRef('')
  const renderedSessionRef = useRef('')
  const rememberRenderedSessionScroll = () => {
    const thread = threadRef.current
    if (!thread || !renderedSessionRef.current) return
    rememberSessionScroll(
      sessionScrollSnapshotsRef.current,
      renderedSessionRef.current,
      thread.scrollTop,
      autoFollowRef.current,
    )
  }
  useLayoutEffect(() => { autoFollowRef.current = autoFollow }, [autoFollow])
  const historyPages = useChatHistoryPages({
    api: chatApi, setMessages, messagesRef, threadRef,
    pauseFollow: () => {
      autoFollowRef.current = false
      scrollModeRef.current = 'manual'
      setAutoFollow(false)
    },
    onConflict: () => openSession(activeSidRef.current, false),
  })
  const chatReadState = useChatReadState({
    instance: chatInstanceID, sid, snapshot: historyPages.page, messages, sessions, api: chatApi, onError: setErr,
    running: busy && streamingSid === sid, loading: sessionLoading, threadRef,
  })
  const waitingSessions = waitingChatSessions({
    sessions, sid, liveState: taskbarState, liveRunning: busy && streamingSid === sid,
  })
  const waitingSessionIds = new Set(waitingSessions.map(session => session.id))
  const runningProjects = runningProjectKeys(sessions, waitingSessionIds)
  const conductorSidebarActivities = useMemo(() => new Map(
    conductorSessionTree(sessions).map(node => [node.session.id, conductorSidebarActivity(node.workers)]),
  ), [sessions])
  const aggregateTaskbarState = aggregateChatTaskbarState({
    sid, liveRunning: busy && streamingSid === sid, liveState: taskbarState,
    sessions, unread: new Set(sessions.filter(chatReadState.unread).map(session => session.id)),
  })
  useEffect(() => { publishTaskbarState(aggregateTaskbarState) }, [aggregateTaskbarState])
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState('')
  const [contextRefresh, setContextRefresh] = useState(0)
  useEffect(() => {
    if (!contextOpen || !sid || sessionLoading) return undefined
    const controller = new AbortController()
    const openToken = openSeqRef.current
    const activity = streamActivitySeqRef.current
    setContextLoading(true)
    setContextError('')
    chatApi(`/api/chat/session/${encodeURIComponent(sid)}?view=context`, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted || openToken !== openSeqRef.current || activeSidRef.current !== sid || activity !== streamActivitySeqRef.current) return
        setRawHistory(data.raw_history || [])
        setHistoryInfo(data.history_info || [])
        setWorkingState(data.working || null)
      })
      .catch(error => { if (!controller.signal.aborted && error.name !== 'AbortError') setContextError(error.message || String(error)) })
      .finally(() => { if (!controller.signal.aborted) setContextLoading(false) })
    return () => controller.abort()
  }, [contextOpen, sid, sessionLoading, contextRefresh, chatApi])
  const queuedRef = useRef([])
  const chatScope = useRef(null)
  const persistSessionDraft = useCallback(async (sessionId, value) => {
    const id = String(sessionId || '').trim()
    const draft = typeof value === 'string' ? value : String(value || '')
    if (!id) return
    const instance = chatInstanceRef.current
    if (draftRestoreRef.current) {
      try { await draftRestoreRef.current } catch { return }
      if (chatInstanceRef.current !== instance || activeSidRef.current !== id) return
    }
    if (draftRestoreFailedRef.current) return
    const files = attachmentsRef.current
    const saved = await saveChatSessionDraftAsync(id, draft, undefined, instance, files)
    if (chatInstanceRef.current !== instance || activeSidRef.current !== id) return
    if (!saved) setErr(ct('草稿保存失败，可能已超过浏览器存储容量；请勿刷新或切换会话。', 'Draft could not be saved; browser storage may be full. Do not refresh or switch chats.'))
    setSessions(current => mergeChatSessionDraftSessions(current, chatInstanceRef.current))
    setDraftSessionIds(current => {
      const hasDraft = Boolean(draft) || files.length > 0
      if (current.has(id) === hasDraft) return current
      const next = new Set(current)
      if (hasDraft) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const clearSessionDrafts = useCallback(async (sessionIds) => {
    const values = Array.isArray(sessionIds) ? sessionIds : [sessionIds]
    const ids = values.map(value => String(value || '').trim()).filter(Boolean)
    const cleared = await clearChatSessionDraftsAsync(ids)
    if (!cleared) {
      setErr(ct('草稿清理失败，刷新后旧草稿可能再次出现。', 'Draft cleanup failed; the old draft may reappear after refresh.'))
      return
    }
    if (!ids.length) return
    setSessions(current => mergeChatSessionDraftSessions(current, chatInstanceRef.current))
    setDraftSessionIds(current => {
      const next = new Set(current)
      let changed = false
      for (const id of ids) changed = next.delete(id) || changed
      return changed ? next : current
    })
  }, [])
  const setSessionPrompt = useCallback((value, sessionId = activeSidRef.current) => {
    const next = typeof value === 'string' ? value : String(value || '')
    setPrompt(next)
    persistSessionDraft(sessionId, next)
  }, [persistSessionDraft])
  // Auto-grow to 160px until the user resizes. A manual desktop height then wins
  // across prompt edits and sends, but is clamped whenever the viewport shrinks.
  const applyComposerHeight = useCallback(() => {
    const el = promptRef.current
    if (!el) return
    const isNarrow = typeof window !== 'undefined' && (
      window.matchMedia?.(`(max-width: ${COMPOSER_MOBILE_BREAKPOINT}px)`).matches
      ?? window.innerWidth <= COMPOSER_MOBILE_BREAKPOINT
    )
    if (!composerManualHeightRef.current || isNarrow) el.style.height = 'auto'
    const layout = composerTextareaLayout({
      scrollHeight: el.scrollHeight,
      manualHeight: composerManualHeightRef.current,
      viewportHeight: window.innerHeight,
      isNarrow,
    })
    el.style.height = `${layout.height}px`
    el.style.overflowY = layout.overflowY
    const wrap = composerWrapRef.current
    const root = chatScope.current
    if (wrap && root) {
      root.style.setProperty('--oa-composer-h', `${Math.ceil(wrap.getBoundingClientRect().height)}px`)
      if (autoFollowRef.current) followScheduler.request('auto')
    }
  }, [followScheduler])

  const beginComposerResize = useCallback((event) => {
    const el = promptRef.current
    if (!el || event.button !== 0 || window.innerWidth <= COMPOSER_MOBILE_BREAKPOINT) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    composerResizePointerRef.current = {
      pointerId: event.pointerId, startHeight: el.getBoundingClientRect().height, startY: event.clientY,
    }
  }, [])

  const moveComposerResize = useCallback((event) => {
    const started = composerResizePointerRef.current
    if (!started || event.pointerId !== started.pointerId) return
    composerManualHeightRef.current = composerDragHeight(started.startHeight, started.startY, event.clientY, window.innerHeight)
    applyComposerHeight()
  }, [applyComposerHeight])

  const finishComposerResize = useCallback(() => {
    composerResizePointerRef.current = null
  }, [])

  useEffect(() => {
    window.addEventListener('resize', applyComposerHeight)
    return () => window.removeEventListener('resize', applyComposerHeight)
  }, [applyComposerHeight])

  useEffect(() => {
    if (!busy && !streamingSid) return undefined
    const tick = () => setStreamClock(Date.now())
    tick()
    const timer = window.setInterval(tick, 500)
    return () => window.clearInterval(timer)
  }, [busy, streamingSid])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(max-width: 900px)')
    const syncCollapsed = () => setCollapsed(mq.matches)
    syncCollapsed()
    mq.addEventListener?.('change', syncCollapsed)
    mq.addListener?.(syncCollapsed)
    return () => {
      mq.removeEventListener?.('change', syncCollapsed)
      mq.removeListener?.(syncCollapsed)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(max-width: 560px)')
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener?.('change', sync)
    mq.addListener?.(sync)
    return () => {
      mq.removeEventListener?.('change', sync)
      mq.removeListener?.(sync)
    }
  }, [])

  useLayoutEffect(() => {
    applyComposerHeight()
  }, [applyComposerHeight, prompt])

  const toggleAutorun = useCallback(async () => {
    if (!sid || autorunSavingRef.current) return
    const sessionID = sid
    autorunSavingRef.current = true
    try {
      const data = await api(`/api/chat/autorun/${sessionID}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: !autorunEnabled, language: chatLocale().startsWith('en') ? 'en' : 'zh' }),
      })
      setSessions(items => items.map(item => item.id === sessionID ? { ...item, autorun: data.autorun } : item))
      setNotice(data.autorun.enabled
        ? ct('本会话已开启后台自主行动：约 1 分钟后启动，之后每次回复 30 分钟后再启动', 'Background auto-action enabled for this session: starts in about 1 minute, then 30 minutes after each reply')
        : ct('本会话已关闭自主行动', 'Auto-action disabled for this session'))
    } catch (error) { setErr(error?.message || String(error)) }
    finally { autorunSavingRef.current = false }
  }, [sid, autorunEnabled])

  const current = useMemo(() => sessions.find(s => s.id === sid), [sessions, sid])
  const isUltraPlanPrompt = /^\s*\/ultraplan(?:\s|$)/.test(prompt)
  const effectiveSlashCommands = slashCommands.length ? slashCommands : BUILTIN_SLASH_COMMANDS
  const officialSlashKeys = useMemo(() => new Set(effectiveSlashCommands.map(c => builtinSlashCommandKey(c))), [effectiveSlashCommands])
  const isProtectedSlashCommand = useCallback((cmd = '') => officialSlashKeys.has(builtinSlashKey(cmd)), [officialSlashKeys])
  const allSlashCommands = useMemo(() => {
    const custom = (cfg?.slash_commands || []).filter(c => !officialSlashKeys.has(builtinSlashKey(c.cmd)))
    return [...effectiveSlashCommands, ...custom]
  }, [cfg?.slash_commands, effectiveSlashCommands, officialSlashKeys])
  const filteredCmds = useMemo(() => {
    if (!cmdDrawer.open) return []
    const rawFilter = String(cmdDrawer.filter || '').trimStart()
    const slashFilter = rawFilter.startsWith('/') ? rawFilter : `/${rawFilter}`
    const childAllowed = (base) => {
      const childRoot = `${base} `
      if (slashFilter === childRoot) return true
      if (!slashFilter.startsWith(childRoot)) return false
      const rest = slashFilter.slice(childRoot.length).trimStart()
      return rest.length > 0 && 'help'.startsWith(rest)
    }
    const inProjectScope = slashFilter === '/project' || slashFilter.startsWith('/project ')
    const inContinueScope = slashFilter === '/continue' || slashFilter.startsWith('/continue ')
    const inReviewScope = slashFilter === '/review' || slashFilter.startsWith('/review ')
    const inImproveScope = slashFilter === '/improve' || slashFilter.startsWith('/improve ')
    const inUltraPlanScope = slashFilter === '/ultraplan' || slashFilter.startsWith('/ultraplan ')
    const isReviewNaturalLanguage = /^\/review\s+\S/.test(slashFilter) && !childAllowed('/review')
    const isContinueNumber = /^\/continue\s+\d+$/.test(slashFilter)
    const isUltraPlanObjective = /^\/ultraplan\s+\S/.test(slashFilter)
    const exactRootCandidates = slashFilter.includes(' ')
      ? []
      : allSlashCommands.filter(c => {
          const cmd = String(c.cmd || '')
          const root = cmd.split(/\s+/, 1)[0]
          return root === slashFilter
        })
    const exactRootPrimary = exactRootCandidates.find(c => String(c.cmd || '') === slashFilter) || exactRootCandidates[0]
    const argumentRoot = slashFilter.includes(' ') ? slashFilter.split(/\s+/, 1)[0] : ''
    const argumentRootCandidates = argumentRoot
      ? allSlashCommands.filter(c => String(c.cmd || '').split(/\s+/, 1)[0] === argumentRoot)
      : []
    const argumentFallback = argumentRootCandidates.find(c => SLASH_ARG_SUFFIX_RE.test(String(c.cmd || '')))
      || argumentRootCandidates.find(c => String(c.cmd || '') === argumentRoot)
      || argumentRootCandidates[0]
    return allSlashCommands.filter(c => {
      const cmd = String(c.cmd || '')
      if (exactRootPrimary) return c === exactRootPrimary
      if (argumentFallback && c === argumentFallback) return true
      if (cmd === '/review help') return childAllowed('/review') && fuzzyMatch(cmd, slashFilter)
      if (cmd === '/review <request>') {
        if (isReviewNaturalLanguage) return true
        if (slashFilter === '/review' || fuzzyMatch('/review', rawFilter) || fuzzyMatch('/review', slashFilter)) return true
        if (slashFilter.startsWith('/review ')) return false
      }
      if (cmd === '/continue <number>') {
        if (slashFilter === '/continue ') return true
        if (isContinueNumber) return true
        if (slashFilter.startsWith('/continue ')) return false
      }
      if (cmd === '/ultraplan <goal>') {
        if (slashFilter === '/ultraplan ') return true
        if (isUltraPlanObjective) return true
        if (slashFilter === '/ultraplan' || fuzzyMatch('/ultraplan', rawFilter) || fuzzyMatch('/ultraplan', slashFilter)) return true
        if (slashFilter.startsWith('/ultraplan ')) return false
      }
      if (cmd === '/project' && slashFilter.startsWith('/project ')) return true
      if (inProjectScope && !cmd.startsWith('/project')) return false
      if (inContinueScope && cmd !== '/continue <编号>') return false
      if (inReviewScope && cmd !== '/review <自然语言请求>') return false
      if (inImproveScope && cmd !== '/improve') return false
      if (inUltraPlanScope && cmd !== '/ultraplan <goal>') return false
      return fuzzyMatch(cmd, rawFilter) || fuzzyMatch(cmd, slashFilter) || fuzzyMatch(c.desc || '', rawFilter)
    })
  }, [cmdDrawer.open, cmdDrawer.filter, allSlashCommands])
  useLayoutEffect(() => {
    if (!cmdDrawer.open) return
    selectedCmdRef.current?.scrollIntoView({ block: 'nearest' })
  }, [cmdDrawer.open, cmdDrawer.selectedIdx, filteredCmds.length])
  useEffect(() => {
    if (cmdDrawer.open) setCmdEditIdx(-1)
  }, [cmdDrawer.open, cmdDrawer.filter])
  useEffect(() => {
    if (!cmdManagerOpen) setCmdEditIdx(-1)
  }, [cmdManagerOpen])
  const saveSlashCmds = async (newCmds) => {
    if (!await confirmDanger('chat-slash-commands-save', ct('保存斜杠命令配置？会写入 GA Admin 配置文件。', 'Save slash-command configuration? This writes the GA Admin configuration file.'))) return
    try {
      const safeCmds = (newCmds || [])
        .filter(c => !isProtectedSlashCommand(c?.cmd))
        .map(c => ({ cmd: String(c?.cmd || '').trim(), desc: String(c?.desc || '').trim(), content: String(c?.content || c?.prompt || '').trim() }))
        .filter(c => c.cmd)
      const c = await api('/api/config', { method:'PUT', dangerous: true, body: JSON.stringify({...cfg, slash_commands: safeCmds}) })
      if (c?.slash_commands) { setCfg(c) }
      setCmdEditIdx(-1)
    } catch(e) { setNotice(ct('保存命令失败: ', 'Failed to save command: ') + e.message); setCmdEditIdx(-1) }
  }
  const startEdit = (idx, cmd, desc, content = '') => {
    if (idx < 0 && idx !== -2) return
    setCmdEditIdx(idx); setCmdEditCmd(cmd); setCmdEditDesc(desc); setCmdEditContent(content)
  }
  const saveEdit = () => {
    const normalized = cmdEditCmd.trim()
    if (!normalized) return
    if (isProtectedSlashCommand(normalized)) {
      setNotice(ct('这是 GA Admin 内置命令，不能覆盖或修改', 'This built-in GA Admin command cannot be overridden or edited'))
      setCmdEditIdx(-1)
      return
    }
    const cmds = cfg?.slash_commands || []
    const nextItem = { cmd: normalized, desc: cmdEditDesc.trim() || '', content: cmdEditContent.trim() || cmdEditDesc.trim() || '' }
    if (!nextItem.content) {
      setNotice(ct('请填写这个命令要展开成的指令内容', 'Enter the instruction content this command should expand into'))
      return
    }
    if (cmdEditIdx === -2) {
      saveSlashCmds([...cmds, nextItem])
    } else if (cmdEditIdx >= 0) {
      const newCmds = [...cmds]
      newCmds[cmdEditIdx] = nextItem
      saveSlashCmds(newCmds)
    }
  }
  const deleteCmd = (idx) => {
    if (idx < 0) { setNotice(ct('这是 GA Admin 内置命令，不能删除', 'This built-in GA Admin command cannot be deleted')); return }
    const cmds = cfg?.slash_commands || []; saveSlashCmds(cmds.filter((_, i) => i !== idx))
  }
  const moveUpCmd = (cmd) => {
    if (cmd?.builtIn) return
    const cmds = cfg?.slash_commands || []
    const idx = cmds.findIndex(c => c.cmd === cmd.cmd && c.desc === cmd.desc)
    if (idx <= 0) return
    const newCmds = [...cmds]
    ;[newCmds[idx-1], newCmds[idx]] = [newCmds[idx], newCmds[idx-1]]
    saveSlashCmds(newCmds)
  }
  useEffect(() => { activeSidRef.current = sid }, [sid])

  const isActiveSession = (sessionId) => !sessionId || activeSidRef.current === sessionId

  const applyStreamEvent = (ev, pendingId, clientUserID = '', sessionId = '') => {
    if (!isActiveSession(sessionId)) return
    if (Object.prototype.hasOwnProperty.call(ev, 'raw_history')) {
      setRawHistory(Array.isArray(ev.raw_history) ? ev.raw_history : [])
    }
    if (Object.prototype.hasOwnProperty.call(ev, 'history_info')) {
      setHistoryInfo(Array.isArray(ev.history_info) ? ev.history_info : [])
    }
    if (Object.prototype.hasOwnProperty.call(ev, 'working')) {
      setWorkingState(ev.working && typeof ev.working === 'object' ? ev.working : null)
    }
    if (Object.prototype.hasOwnProperty.call(ev, 'plan')) setPlanState(ev.plan || null)
    if (ev.type === 'loop' && ev.loop && typeof ev.loop === 'object') {
      setLoopState(ev.loop)
      setSessions(xs => updateSessionLoop(xs, sessionId, ev.loop))
      if (ev.loop.status === 'error' && ev.loop.stop_reason) {
        setErr(ct(`Loop \u5df2\u5f02\u5e38\u505c\u6b62\uff1a${loopStopReasonText(ev.loop.stop_reason)}`, `Loop stopped with an error: ${loopStopReasonText(ev.loop.stop_reason)}`))
      }
    }
    const projectFields = ['workspace', 'project_mode', 'project_provider', 'project_id']
    if (projectFields.some(field => Object.prototype.hasOwnProperty.call(ev, field))) {
      const changes = Object.fromEntries(projectFields
        .filter(field => Object.prototype.hasOwnProperty.call(ev, field))
        .map(field => [field, ev[field] || '']))
      setSessions(xs => xs.map(x => x.id === sessionId ? { ...x, ...changes } : x))
    }
    if (ev.type === 'user' && ev.message) {
      setMessages(xs => isActiveSession(sessionId)
        ? mergeStreamUserMessage(xs, ev.message, clientUserID, pendingId)
        : xs)
    }
    if (ev.type === 'start' && ev.run_started_at_ms > 0) {
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m =>
        m.id === pendingId ? { ...m, run_started_at_ms: ev.run_started_at_ms } : m
      ) : xs)
    }
    if (ev.type === 'model' && typeof ev.model_id === 'string' && ev.model_id.trim()) {
      const modelID = ev.model_id.trim()
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m =>
        m.id === pendingId ? { ...m, model_id: modelID } : m
      ) : xs)
    }
    if (ev.type === 'turn_usage' && ev.usage && typeof ev.index === 'number') {
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m => {
        if (m.id !== pendingId) return m
        const usages = Array.isArray(m.usages) ? m.usages.slice() : []
        usages[ev.index] = ev.usage
        return { ...m, usages }
      }) : xs)
    }
    if (ev.type === 'tool_timing' && typeof ev.tool_elapsed_ms === 'number') {
      const receivedAtMs = Date.now()
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m =>
        m.id === pendingId ? {
          ...m,
          tool_live_elapsed_ms: Math.max(0, Number(ev.tool_elapsed_ms) || 0),
          tool_live_active_count: Math.max(0, Number(ev.tool_active_count) || 0),
          tool_live_updated_at_ms: receivedAtMs,
          tool_live_timing_at_ms: Math.max(0, Number(ev.tool_timing_at_ms) || 0),
        } : m
      ) : xs)
    }
    if (ev.type === 'ctx_stats' && typeof ev.ctx_chars === 'number') {
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m =>
        m.id === pendingId ? { ...m, ctx_chars: ev.ctx_chars, ctx_msgs: ev.ctx_msgs } : m
      ) : xs)
    }
    if (ev.message && (ev.type === 'done' || ev.type === 'error')) {
      if (typeof ev.reasoning_effort === 'string') setReasoningEffort(normalizeReasoningEffort(ev.reasoning_effort))
      setMessages(xs => isActiveSession(sessionId) ? mergeStreamTerminalMessage(xs, pendingId, ev.message, m => {
        const elapsedMs = getElapsedMs(m)
        const terminalFields = ['usage', 'usages', 'elapsed_ms', 'llm_elapsed_ms', 'tool_elapsed_ms', 'first_token_ms', 'run_started_at_ms', 'ctx_chars', 'ctx_msgs']
        const finalPayload = { ...ev.message }
        terminalFields.forEach(key => {
          if (Object.prototype.hasOwnProperty.call(ev, key)) finalPayload[key] = ev[key]
        })
        const finalMsg = mergeFinalStreamMessage(m, finalPayload)
        if (elapsedMs > 0 && !(finalMsg.elapsed_ms > 0)) finalMsg.elapsed_ms = elapsedMs
        finalMsg.ultraplan_state = mergeUltraPlanStates(m.ultraplan_state, finalMsg.ultraplan_state) || finalMsg.ultraplan_state || m.ultraplan_state
        if (!finalMsg.goal_state && m.goal_state) finalMsg.goal_state = m.goal_state
        if (!finalMsg.ctx_chars) finalMsg.ctx_chars = ev.ctx_chars || m.ctx_chars || 0
        if (!finalMsg.ctx_msgs) finalMsg.ctx_msgs = ev.ctx_msgs || m.ctx_msgs || 0
        return finalMsg
      }) : xs)
    }
    if (ev.type === 'ultraplan_event' && ev.state) {
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m => {
        if (m.id !== pendingId) return m
        const nextState = mergeUltraPlanStates(m.ultraplan_state, ev.state) || ev.state
        return { ...m, ultraplan_state: nextState }
      }) : xs)
    }
    if (ev.type === 'goal_event' && ev.state) {
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m => {
        if (m.id !== pendingId) return m
        return { ...m, goal_state: { ...(m.goal_state || {}), ...ev.state } }
      }) : xs)
    }
    if (ev.type === 'ultraplan_output' && ev.task_id && Array.isArray(ev.lines)) {
      setMessages(xs => isActiveSession(sessionId) ? xs.map(m => {
        if (m.id !== pendingId) return m
        const prevState = m.ultraplan_state || {}
        const prevOutputs = prevState.taskOutputs || prevState.task_outputs || {}
        const prevLines = Array.isArray(prevOutputs[ev.task_id]) ? prevOutputs[ev.task_id] : []
        const taskOutputs = { ...prevOutputs, [ev.task_id]: [...prevLines, ...ev.lines] }
        const nextState = mergeUltraPlanStates(prevState, { taskOutputs, task_outputs: taskOutputs }) || { ...prevState, taskOutputs, task_outputs: taskOutputs }
        return { ...m, ultraplan_state: nextState }
      }) : xs)
    }
  }

  const createStreamBatcher = (pendingId, sessionId = '') => createStreamDeltaBatcher({
    onFlush: chunk => setMessages(xs => isActiveSession(sessionId) ? xs.map(m => (
      m.id === pendingId ? { ...m, content: (m.content || '') + chunk } : m
    )) : xs),
    schedule: callback => window.requestAnimationFrame ? window.requestAnimationFrame(callback) : window.setTimeout(callback, 16),
    cancel: handle => window.cancelAnimationFrame ? window.cancelAnimationFrame(handle) : window.clearTimeout(handle),
    shouldAnimate: () => !document.hidden && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    // Start in replay mode: backend emits {"type":"sync"} after the backlog,
    // so reattach-after-refresh renders prior output instantly, then animates.
    live: false,
  })

  const readStream = async (res, pendingId, clientUserID = '', sessionId = '') => {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
    const batcher = createStreamBatcher(pendingId, sessionId)
    // A queued rAF can stop firing when the tab is hidden, including after EOF.
    const onVisibilityChange = () => { if (document.hidden) batcher.flushNow() }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
    let commandPatch = null
    let eventCount = 0
    let terminal = false
    let terminalEvent = null
    const applyEvent = (ev) => {
      if (ev?.type === 'command_result') commandPatch = reduceCommandResult(ev)
      applyStreamEvent(ev, pendingId, clientUserID, sessionId)
    }
    const consumeEvent = (ev) => {
      if (ev.type === 'sync') {
        // Replay/live boundary: flush backlog instantly, animate what follows.
        // Not stored in run.Events server-side, so it must NOT bump eventCount
        // (the reconnect cursor would skip a real event otherwise).
        batcher.beginLive()
        return
      }
      if (ev.type === 'delta' && typeof ev.delta === 'string') {
        batcher.push(ev.delta)
      } else if (ev.type === 'done' || ev.type === 'error') {
        terminal = true
        terminalEvent = ev
      } else {
        applyEvent(ev)
      }
      eventCount += 1
    }
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream:true })
        const lines = buf.split('\n'); buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          if (!isActiveSession(sessionId)) return { commandPatch, eventCount, terminal }
          const ev = JSON.parse(line)
          consumeEvent(ev)
        }
      }
      buf += dec.decode()
      if (buf.trim() && isActiveSession(sessionId)) consumeEvent(JSON.parse(buf))
      await batcher.drain()
      if (terminalEvent && isActiveSession(sessionId)) applyEvent(terminalEvent)
    } catch (error) {
      batcher.flushNow()
      error.chatStreamOutcome = { commandPatch, eventCount, terminal }
      throw error
    } finally {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
      batcher.flushNow()
      reader.releaseLock?.()
    }
    return { commandPatch, eventCount, terminal }
  }

  const waitForStreamRetry = (signal, delay = 250) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('aborted'); err.name = 'AbortError'; reject(err); return
    }
    const done = () => { signal?.removeEventListener('abort', aborted); resolve() }
    const aborted = () => {
      clearTimeout(timer)
      const err = new Error('aborted'); err.name = 'AbortError'; reject(err)
    }
    const timer = setTimeout(done, delay)
    signal?.addEventListener('abort', aborted, { once:true })
  })

  const followChatStream = async (initialRes, pendingId, clientUserID, sessionId, signal, awaitingRun = false) => {
    let res = initialRes
    let cursor = 0
    let replay = false
    let commandPatch = null
    let terminal = false
    let currentRun = { pendingId, startedAtMs:0 }
    while (isActiveSession(sessionId)) {
      let completed = false
      let eventCount = 0
      if (res) {
        try {
          const outcome = await readStream(res, pendingId, clientUserID, sessionId)
          eventCount = outcome.eventCount
          cursor += eventCount
          if (outcome.commandPatch) commandPatch = outcome.commandPatch
          completed = true
          terminal = Boolean(outcome.terminal)
        } catch (e) {
          const partial = e?.chatStreamOutcome
          if (partial) {
            eventCount = partial.eventCount
            cursor += eventCount
            if (partial.commandPatch) commandPatch = partial.commandPatch
            terminal = Boolean(partial.terminal)
          }
          if (e?.name === 'AbortError' || signal?.aborted) throw e
        }
        res = null
      }

      let state = null
      try {
        state = await chatApi(`/api/chat/state/${sessionId}`, { signal })
        if (!isActiveSession(sessionId)) return commandPatch
        if (state.loop && typeof state.loop === 'object') {
          setLoopState(state.loop)
          setSessions(xs => updateSessionLoop(xs, sessionId, state.loop))
        }
      } catch (e) {
        if (e?.name === 'AbortError' || signal?.aborted) throw e
        await waitForStreamRetry(signal)
        continue
      }

      const availableRun = {
        pendingId: state.pending_assistant_id || '',
        startedAtMs: state.run_started_at_ms || 0,
      }
      const action = decideStreamFollow({
        running:Boolean(state.running),
        loop:state.loop,
        currentRun,
        availableRun,
        terminal,
        awaitingRun,
      })
      if (action === 'finish') return commandPatch
      if (action === 'wait') {
        await waitForStreamRetry(signal)
        continue
      }

      const nextRun = !sameStreamRun(currentRun, availableRun)
      if (nextRun) {
        clientUserID = nextStreamClientUserID({ clientUserID, awaitingRun, currentRun })
        currentRun = availableRun
        // A local optimistic user id only belongs to the first explicitly
        // admitted run. Later backend-started rounds must append their own user turn.
        pendingId = availableRun.pendingId || `resume-${Date.now()}`
        cursor = 0
        replay = false
        terminal = false
        setMessages(xs => isActiveSession(sessionId) && !xs.some(m => m.id === pendingId)
          ? [...xs, { id:pendingId, role:'assistant', content:'', streaming:true }]
          : xs)
      } else {
        currentRun = { ...currentRun, ...availableRun }
      }

      while (isActiveSession(sessionId)) {
        try {
          res = await chatFetch(`/api/chat/stream/${sessionId}?from=${cursor}`, { signal })
          if (res.status === 204) {
            res = null
            await waitForStreamRetry(signal)
            break
          }
          if (!res.ok) throw new Error(await res.text())
          replay = true
          break
        } catch (e) {
          if (e?.name === 'AbortError' || signal?.aborted) throw e
          await waitForStreamRetry(signal)
        }
      }
    }
    return commandPatch
  }

  const startLoop = async () => {
    const id = activeSidRef.current
    const objective = (loopObjective || prompt).trim()
    if (!id) { setErr(ct('请先创建或打开一个会话。', 'Create or open a chat first.')); return }
    if (!objective) { setErr(ct('请填写 Loop 目标。', 'Enter a Loop objective.')); setLoopConfigOpen(true); return }
    if (loopMaxRounds === '' || loopMaxRetries === '' || !Number.isInteger(Number(loopMaxRounds)) || Number(loopMaxRounds) < 0 || Number(loopMaxRounds) > 10000 || !Number.isInteger(Number(loopMaxRetries)) || Number(loopMaxRetries) < 0 || Number(loopMaxRetries) > 100) {
      setErr(ct('请输入有效整数：轮数 0-10000，重试 0-100。', 'Enter integers: rounds 0-10000, retries 0-100.')); return
    }
    const controllerLlmNo = llms.some(model => model.index === loopControllerLlmNo) ? loopControllerLlmNo : llmNo
    setLoopUpdating(true)
    setErr('')
    try {
      const result = await chatApi(`/api/chat/loop/${id}/start`, { method:'POST', body:JSON.stringify({ objective, controller_llm_no:controllerLlmNo, max_rounds:Number(loopMaxRounds), max_retries:Number(loopMaxRetries) }) })
      setLoopObjective(objective)
      setLoopControllerLlmNo(controllerLlmNo)
      const nextLoopState = result.loop || { enabled:true, status:'waiting', round:0, controller_prompt:objective, controller_llm_no:controllerLlmNo }
      setLoopState(nextLoopState)
      setSessions(xs => updateSessionLoop(xs, id, nextLoopState))
      setLoopConfigOpen(false)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setLoopUpdating(false)
    }
  }

  const stopLoop = async () => {
    const id = activeSidRef.current
    if (!id) return
    setLoopUpdating(true)
    setErr('')
    try {
      const result = await chatApi(`/api/chat/loop/${id}/stop`, { method:'POST', body:'{}' })
      const nextLoopState = result.loop || { ...loopState, enabled:false, status:'stopped', stop_reason:'user' }
      setLoopState(nextLoopState)
      setSessions(xs => updateSessionLoop(xs, id, nextLoopState))
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setLoopUpdating(false)
    }
  }

  const cancelRun = async (id = sid) => {
    if (!id) return
    const stoppedAtMs = Date.now()
    if (isActiveSession(id)) {
      setMessages(xs => freezeActiveAssistantElapsed(xs, stoppedAtMs))
      setStreamClock(stoppedAtMs)
    }
    try {
      streamAbortRef.current?.abort?.()
      await chatApi(`/api/chat/cancel/${id}`, { method:'POST', body:'{}' })
      if (isActiveSession(id)) setTaskbarStoppedRun(taskbarRunKey)
      setMessages(xs => xs.map(m => (m.role === 'assistant' && !m.content) ? { ...m, content:ct('已中止。', 'Stopped.'), error:true } : m))
      setSessions(xs => xs.map(s => s.id === id ? { ...s, running:false } : s))
      setNotice(ct('已中止当前执行', 'Current run stopped'))
      // Aborting the local stream lets runSend's finally reload before the
      // server has persisted the canceled turn. Reload once more only after
      // cancel returns, otherwise the context drawer can stay on that stale
      // (and for a first turn, empty) raw_history snapshot.
      if (isActiveSession(id)) await openSession(id, false)
    } catch (e) { setErr(e.message || String(e)) }
    finally { setBusy(false); setStreamingSid(''); if (id) loadSessions(id).catch(()=>{}) }
  }

  const attachRunningStream = async (id, { waitForRun = false, clientUserID = '' } = {}) => {
    if (!id) return
    ++streamActivitySeqRef.current
    streamAbortRef.current?.abort?.()
    const ctrl = new AbortController()
    streamAbortRef.current = ctrl
    const openToken = openSeqRef.current
    const isCurrent = () => !ctrl.signal.aborted && streamAbortRef.current === ctrl &&
      openSeqRef.current === openToken && isActiveSession(id)
    let pendingId = waitForRun ? '' : `resume-${Date.now()}`
    // Resolve the placeholder id up-front: `followChatStream` below reads `pendingId` right
    // after `await fetch`, which may win the race against the state updater.
    const knownId = waitForRun ? '' : pickResumePlaceholderId(messagesRef.current)
    if (knownId) pendingId = knownId
    setBusy(true); setStreamingSid(id); setAutoFollow(true); setShowFollow(false)
    if (!waitForRun) setMessages(xs => {
      const existingId = pickResumePlaceholderId(xs)
      if (existingId) {
        pendingId = existingId
        return xs
      }
      return [...xs, { id:pendingId, role:'assistant', content:'', created_at:Math.floor(Date.now()/1000), run_started_at_ms:Date.now() }]
    })
    try {
      let res = null
      if (!waitForRun) {
        res = await chatFetch(`/api/chat/stream/${id}`, { signal: ctrl.signal })
        if (res.status === 204) return
        if (!res.ok) throw new Error(await res.text())
      }
      await followChatStream(res, pendingId, clientUserID, id, ctrl.signal, waitForRun)
      if (isCurrent()) {
        const list = await loadSessions(id)
        // The terminal event updates the body, but read receipts also need the
        // persisted result and content revision from the final page snapshot.
        await refreshCompletedRun(id, openToken, isCurrent)
        if (!isCurrent()) return
        const currentSession = list.find(session => session.id === id)
        if (shouldPollGeneratedTitle(currentSession)) {
          void pollGeneratedChatTitle({ sessionId:id, loadSessions, isActive:isActiveSession }).catch(()=>{})
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError' && isActiveSession(id)) setErr(e.message || String(e))
    } finally {
      if (streamAbortRef.current === ctrl) {
        streamAbortRef.current = null
        if (isActiveSession(id)) { setBusy(false); setStreamingSid('') }
      }
    }
  }

  useEffect(() => {
    if (!sid || !isLoopFollowActive(loopState) || streamAbortRef.current) return
    void attachRunningStream(sid, { waitForRun:true })
  }, [sid, streamingSid, loopState?.enabled, loopState?.status])

  const loadChatState = async (id = '', openToken = openSeqRef.current, prefetchedState = null, isCurrent = () => true) => {
    const result = prefetchedState ? await prefetchedState : null
    if (openToken !== openSeqRef.current || !isActiveSession(id)) return null
    if (!isCurrent()) return null
    if (result?.error) throw result.error
    const st = result ? result.state : await chatApi(id ? `/api/chat/state/${id}` : '/api/chat/state')
    if (openToken !== openSeqRef.current || !isActiveSession(id)) return null
    if (!isCurrent()) return null
    const nextLlms = st.llms || []
    const nextNo = st.settings?.llm_no ?? st.llm_no ?? nextLlms[0]?.index ?? 0
    const nextReasoningEffort = normalizeReasoningEffort(st.settings?.reasoning_effort)
    const nextExtraSysPrompts = Array.isArray(st.extra_sys_prompts) ? st.extra_sys_prompts.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : []
    const nextExtraSysPromptPresetID = String(st.extra_sys_prompt_preset_id || '').trim()
    setLlms(nextLlms)
    setChatBackend(st.backend && typeof st.backend === 'object' ? st.backend : null)
    const resolvedNextNo = nextLlms.some(m => m.index === nextNo) ? nextNo : (nextLlms[0]?.index ?? 0)
    setLlmNo(resolvedNextNo)
    setReasoningEffort(nextReasoningEffort)
    setExtraSysPrompts(nextExtraSysPrompts)
    setExtraSysPromptPresetID(nextExtraSysPromptPresetID)
    const nextLoopState = st.loop && typeof st.loop === 'object' ? st.loop : null
    setLoopState(nextLoopState)
    setLoopMaxRounds(nextLoopState?.max_rounds ?? 0)
    setLoopMaxRetries(nextLoopState?.max_retries ?? 2)
    if (id && nextLoopState) setSessions(xs => updateSessionLoop(xs, id, nextLoopState))
    const savedControllerLlmNo = Number(nextLoopState?.controller_llm_no)
    setLoopControllerLlmNo(Number(nextLoopState?.epoch) > 0 && nextLlms.some(model => model.index === savedControllerLlmNo) ? savedControllerLlmNo : null)
    if (st.loop?.controller_prompt) setLoopObjective(st.loop.controller_prompt)
    if (id && st.running) {
      attachRunningStream(id)
    } else if (id && streamingSid && streamingSid !== id) {
      streamAbortRef.current?.abort?.()
      streamAbortRef.current = null
      setBusy(false)
      setStreamingSid('')
    }
    return { extraSysPromptPresetID: nextExtraSysPromptPresetID, extraSysPrompts: nextExtraSysPrompts }
  }

  const openSession = async (id, refreshList = true) => {
    historyPages.begin()
    rememberRenderedSessionScroll()
    renderedSessionRef.current = ''
    pendingSessionScrollRestoreRef.current = null
    pendingRenderedSessionRef.current = ''
    setWorldlineRestorePicker(null)
    const openToken = ++openSeqRef.current
    sessionLoadAbortRef.current?.abort()
    const controller = new AbortController()
    sessionLoadAbortRef.current = controller
    setSessionLoading(true)
    setSessionLoadFailed(false)
    setMessages([])
    messagesRef.current = []
    setRawHistory([])
    setHistoryInfo([])
    setWorkingState(null)
    setPlanState(null)
    setErr('')
    setShowFollow(false)
    activeSidRef.current = id
    applyQueueSnapshot([])
    setQueueEditingId('')
    setQueueDraft('')
    guidingQueueRef.current = ''
    setGuidingQueueId('')
    streamAbortRef.current?.abort?.()
    streamAbortRef.current = null
    scrollModeRef.current = 'auto'
    setSid(id)
    updateAttachments([])
    setPrompt(loadChatSessionDraft(id, undefined, chatInstanceRef.current))
    draftRestoreFailedRef.current = false
    const restoringAttachments = attachmentsRef.current
    const restoring = loadChatSessionDraftAttachmentsAsync(id, undefined, chatInstanceRef.current)
    draftRestoreRef.current = restoring
    try {
      const files = await restoring
      if (openToken !== openSeqRef.current || activeSidRef.current !== id) return
      if (attachmentsRef.current === restoringAttachments) updateAttachments(files)
    } catch {
      if (openToken === openSeqRef.current && activeSidRef.current === id) setErr(ct('附件草稿读取失败，请保留原文件并重试。', 'Draft attachments could not be loaded. Keep the original files and retry.'))
      if (openToken === openSeqRef.current && activeSidRef.current === id) draftRestoreFailedRef.current = true
    } finally {
      if (draftRestoreRef.current === restoring) draftRestoreRef.current = null
    }
    if (openToken !== openSeqRef.current || activeSidRef.current !== id) return
    setBusy(false)
    setStreamingSid('')
    try {
      // Fetch concurrently, but apply state only after history to avoid overwriting stream events.
      const prefetchedState = chatApi(`/api/chat/state/${id}`, { signal: controller.signal }).then(
        state => ({ state }),
        error => ({ error }),
      )
      const d = await loadSessionDetail(id, { signal: controller.signal })
      if (openToken !== openSeqRef.current || activeSidRef.current !== id) return
      setActiveSessionDetail(d)
      const scrollRestore = sessionScrollRestore(sessionScrollSnapshotsRef.current, d.id)
      pendingSessionScrollRestoreRef.current = scrollRestore ? { sessionID: d.id, ...scrollRestore } : null
      pendingRenderedSessionRef.current = d.id
      autoFollowRef.current = !scrollRestore
      setAutoFollow(!scrollRestore)
      setShowFollow(false)
      activeSidRef.current = d.id
      persistSelectedChatSessionID(chatInstanceRef.current, d.id)
      scrollModeRef.current = 'auto'
      setSid(d.id)
      historyPages.apply(d, addChatInstanceToURL(`/api/chat/session/${d.id}?view=page&execution=lazy`, chatInstanceRef.current))
      setActiveSessionDetail(d)
      applyQueueSnapshot(d.queued_messages, d.id)
      setQueueEditingId('')
      setQueueDraft('')
      guidingQueueRef.current = ''
      setGuidingQueueId('')
      setRawHistory(Array.isArray(d.raw_history) ? d.raw_history : [])
      setHistoryInfo(Array.isArray(d.history_info) ? d.history_info : [])
      setWorkingState(d.working || null)
      setPlanState(d.plan || null)
      setLlmNo(d.settings?.llm_no || 0)
      setErr('')
      setNotice('')
      setMenuOpen('')
      setMenuPos(null)
      setSessions(xs => xs.map(x => x.id === d.id ? { ...x, title: d.title, workspace: d.workspace || '', project_mode: d.project_mode || '', project_provider: d.project_provider || '', project_id: d.project_id || '', count: d.messages?.length || x.count, updated_at: d.updated_at || x.updated_at } : x))
      await loadChatState(d.id, openToken, prefetchedState)
      if (openToken === openSeqRef.current && worldlineOpen) loadWorldline(d.id, { force: true }).catch(() => {})
    } catch (e) {
      if (openToken === openSeqRef.current && activeSidRef.current === id && e?.name !== 'AbortError') {
        setSessionLoadFailed(true)
        setErr(e?.message || String(e))
      }
    } finally {
      controller.abort()
      if (sessionLoadAbortRef.current === controller) {
        sessionLoadAbortRef.current = null
        setSessionLoading(false)
      }
    }
  }

  const refreshCompletedRun = async (id, openToken, isCurrent) => {
    if (!isCurrent()) return
    const [d, state] = await Promise.all([
      chatApi(`/api/chat/session/${id}?view=page&execution=lazy`),
      chatApi(`/api/chat/state/${id}`),
    ])
    if (!isCurrent()) return
    // Reconcile in place: reopening clears the thread and clamps its scrollTop.
    historyPages.apply(d, addChatInstanceToURL(`/api/chat/session/${d.id}?view=page&execution=lazy`, chatInstanceRef.current))
    applyQueueSnapshot(d.queued_messages, d.id)
    setRawHistory(Array.isArray(d.raw_history) ? d.raw_history : [])
    setHistoryInfo(Array.isArray(d.history_info) ? d.history_info : [])
    setWorkingState(d.working || null)
    setPlanState(d.plan || null)
    if (contextOpen) setContextRefresh(value => value + 1)
    await loadChatState(d.id, openToken, { state }, isCurrent)
  }

  const refreshActiveSessionSnapshot = async (id) => {
    if (!id || activeSidRef.current !== id) return
    const streamActivityToken = streamActivitySeqRef.current
    const d = await chatApi(`/api/chat/session/${id}?view=page&execution=lazy`)
    if (activeSidRef.current !== id || streamActivitySeqRef.current !== streamActivityToken) return
    // List summaries and detail responses are independent snapshots. An idle
    // summary does not prove this stream has delivered its final output.
    // Leave reconciliation to the stream owner while it is still active.
    if (streamAbortRef.current || activeRunRef.current) return
    historyPages.apply(d, addChatInstanceToURL(`/api/chat/session/${d.id}?view=page&execution=lazy`, chatInstanceRef.current))
    if (contextOpen) setContextRefresh(value => value + 1)
    setPlanState(d.plan || null)
  }

  const loadWorldline = async (id = activeSidRef.current || sid, { force = false, activate = false } = {}) => {
    if (!id) return
    if (!force && !worldlineOpen && worldlineState?.sessionID !== id) return
    const token = ++worldlineSeqRef.current
    setWorldlineLoading(true)
    try {
      const d = await api(worldlineReadURL(id, activate))
      if (token !== worldlineSeqRef.current || activeSidRef.current !== id) return
      setWorldlineState({ sessionID: id, ...d })
    } catch (e) {
      if (token !== worldlineSeqRef.current) return
      setWorldlineState({ sessionID: id, available: false, degraded_reason: e?.message || String(e) })
    } finally {
      if (token === worldlineSeqRef.current) setWorldlineLoading(false)
    }
  }

  const toggleWorldline = () => {
    const next = !worldlineOpen
    setWorldlineOpen(next)
    if (next) loadWorldline(activeSidRef.current || sid, { force: true }).catch(() => {})
  }

  const switchWorldline = async (nodeId) => {
    const id = activeSidRef.current || sid
    if (!id || !nodeId) return
    if (busy && streamingSid === id) { setNotice('对话运行中，完成后再切换世界线'); return }
    setWorldlineSwitchingId(nodeId)
    setErr(''); setNotice('')
    try {
      const d = await chatApi(`/api/chat/worldline/${id}/switch`, { method: 'POST', body: JSON.stringify({ node_id: nodeId }) })
      if (activeSidRef.current !== id) return
      await openSession(id, false)
      if (activeSidRef.current !== id) return
      if (d?.worldline) setWorldlineState({ sessionID: id, ...d.worldline })
      setNotice('已切换到所选世界线分支')
      loadSessions(id).catch(() => {})
    } catch (e) {
      if (activeSidRef.current === id) setErr(e?.message || String(e))
    } finally {
      setWorldlineSwitchingId('')
    }
  }

  const worldlineForView = worldlineState && worldlineState.sessionID === sid ? worldlineState : null

  // Saving provider configuration in the settings view dispatches this event.
  // Refresh the runtime model list in place so the composer offers the new
  // provider without reopening the session or reloading the page.
  const fetchRuntimeState = useCallback(url => chatApi(url), [chatApi])
  useRuntimeModelRefresh({
    sidRef: activeSidRef,
    fetchState: fetchRuntimeState,
    setLlms,
    setLlmNo,
  })

  const loadSessions = async (prefer = sid, options = {}) => {
    const { open = false } = options
    const d = await loadSessionList({ fresh: true })
    const incoming = mergeChatSessionDraftSessions(d.sessions, chatInstanceRef.current)
    const list = reconcileSessionSummaries(sessionsRef.current, incoming)
    sessionsRef.current = list
    setSessions(list)
    const incomingProjects = Array.isArray(d.project_items) ? d.project_items : (d.projects || [])
    setProjects(previous => equalSessionSummaryValue(previous, incomingProjects) ? previous : incomingProjects)
    setPinnedProjects(previous => reconcileScalarList(previous, d.pinned_projects))
    setProjectOrder(previous => reconcileScalarList(previous, d.project_order))
    if (open) {
      const restored = loadSelectedChatSessionID(chatInstanceRef.current)
      const next = chooseChatSessionID(list, prefer, restored)
      if (next) await openSession(next, false)
      else {
        persistSelectedChatSessionID(chatInstanceRef.current, '')
        await loadChatState('', openSeqRef.current)
      }
    } else if (!prefer && !sid) {
      await loadChatState('', openSeqRef.current)
    }
    return list
  }

  const createSession = async (projectMode = '', sessionOptions = {}) => {
    cancelSessionLoad()
    historyPages.begin()
    const selectedProject = projectMode && typeof projectMode === 'object'
      ? { project_provider: projectMode.provider, project_id: projectMode.id }
      : typeof projectMode === 'string' && projectMode.trim()
        ? { project_mode: projectMode.trim() } : null
    rememberRenderedSessionScroll()
    pendingSessionScrollRestoreRef.current = null
    pendingRenderedSessionRef.current = ''
    setWorldlineRestorePicker(null)
    setSessionManagerOpen(false)
    setSelectedSessionIds([])
    const openToken = ++openSeqRef.current
    activeRunRef.current = false
    streamAbortRef.current?.abort?.()
    streamAbortRef.current = null
    const sessionPayload = { ...(selectedProject || {}), ...sessionOptions }
    const d = await chatApi('/api/chat/session/new', { method:'POST', body:JSON.stringify(sessionPayload) })
    if (openToken !== openSeqRef.current) return
    forgetSessionScroll(sessionScrollSnapshotsRef.current, d.id)
    pendingSessionScrollRestoreRef.current = null
    pendingRenderedSessionRef.current = d.id
    activeSidRef.current = d.id
    scrollModeRef.current = 'auto'
    updateAttachments([])
    clearSessionDrafts(d.id)
    setActiveSessionDetail(d)
    setSid(d.id); setMessages([]); applyQueueSnapshot([]); setQueueEditingId(''); setQueueDraft(''); guidingQueueRef.current = ''; setGuidingQueueId(''); setRawHistory([]); setHistoryInfo([]); setWorkingState(null); setPlanState(null); setLoopState(null); setLoopObjective(''); setLoopConfigOpen(false); setContextOpen(false); setSessionPrompt('', d.id); setErr(''); setNotice(sessionOptions.mode === 'conductor' ? ct('已创建 Conductor', 'Conductor created') : ct('已创建新对话', 'New chat created')); setBusy(false); setStreamingSid(''); setAutoFollow(false); setShowFollow(false); setLlmNo(d.settings?.llm_no ?? llmNo)
    await loadChatState(d.id, openToken)
    if (selectedProject) await loadSessions(d.id)
    return d.id
  }

  const newSession = async () => {
    await createSession()
  }

  const newProjectSession = async (projectMode) => {
    await createSession(projectMode)
  }

  const upgradeToConductor = async () => {
    const action = isConductorParent(activeSessionDetail) ? 'disable' : 'enable'
    const target = activeSidRef.current
    if (!target || conductorEnablingRef.current) return
    conductorEnablingRef.current = true
    setConductorConflict(null)
    setConductorEnabling(true)
    setErr('')
    try {
      const result = await api(`/api/chat/conductor/${encodeURIComponent(target)}/${action}`, { method: 'POST' })
      setSessions(items => items.map(item => String(item.id) === String(target) ? { ...item, conductor: result.conductor } : item))
      if (activeSidRef.current === target) {
        setActiveSessionDetail(current => current && String(current.id) === String(target) ? { ...current, conductor: result.conductor } : current)
      }
    } catch (error) {
      if (activeSidRef.current === target) {
        if (error.status === 409 && error.body?.code === 'conductor_review_required') {
          setConductorConflict({ ...error.body, parent_session_id: target })
          setConductorWorkersOpen(true)
        } else setErr(error.message || String(error))
      }
    } finally {
      conductorEnablingRef.current = false
      setConductorEnabling(false)
    }
  }

  const newConductorSession = async () => {
    await createSession('', { mode:'conductor' })
  }

  const recoverConductorWorker = async (worker) => {
    const parentID = activeSidRef.current
    const instanceID = chatInstanceRef.current
    const workerID = worker?.session_id || worker?.id
    const dispatchID = worker?.dispatch_id
    if (!parentID || !workerID || !dispatchID || conductorStoppingID) return
    if (!await confirmDanger('conductor-recovery', ct('仅在确认旧 Admin 实例及其子任务均已停止后继续。此操作将封存中断并交回指挥家审查，可能继续派发并产生费用；不会撤销已有操作。确认已停止？', 'Continue only after verifying that the previous Admin owner and worker have stopped. This finalizes the interruption and returns it for conductor review, which may dispatch work and incur costs. Existing actions are not rolled back. Confirm stopped?'))) return
    if (instanceID !== chatInstanceRef.current || parentID !== activeSidRef.current) return
    setConductorStoppingID(workerID)
    setErr('')
    try {
      await chatApi(`/api/chat/conductor/${encodeURIComponent(parentID)}/recover`, { method: 'POST', body: JSON.stringify({ dispatch_id: dispatchID, confirm_stopped: true }) })
      if (instanceID !== chatInstanceRef.current || parentID !== activeSidRef.current) return
      setNotice(ct('中断已封存，已交回指挥家；已停止的父任务需手动继续。', 'Interruption finalized and returned to conductor; a stopped parent requires manual continuation.'))
      await loadSessions(parentID)
      if (instanceID === chatInstanceRef.current && parentID === activeSidRef.current) await refreshActiveSessionSnapshot(parentID)
    } catch (e) {
      if (instanceID === chatInstanceRef.current && parentID === activeSidRef.current) setErr(e?.message || String(e))
    } finally {
      setConductorStoppingID('')
    }
  }

  const stopConductorWorker = async (workerID) => {
    if (!workerID || conductorStoppingID) return
    setConductorStoppingID(workerID)
    setErr('')
    try {
      await chatApi(`/api/chat/cancel/${encodeURIComponent(workerID)}`, { method:'POST' })
      setNotice(ct('已请求停止子任务', 'Worker stop requested'))
      await loadSessions(activeSidRef.current || '')
      if (activeSidRef.current) await refreshActiveSessionSnapshot(activeSidRef.current)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setConductorStoppingID('')
    }
  }

  // Pinned first, so the projects someone actually works in stop sinking under
  // the alphabetical ones. Applied optimistically: the row should jump the moment
  // it is clicked, and the next list refresh confirms it.
  const toggleProjectPinned = async (name, pinned) => {
    setPinnedProjects(current => pinned
      ? Array.from(new Set(current.concat(name)))
      : current.filter(existing => existing !== name))
    try {
      const d = await chatApi('/api/chat/projects/pin', { method:'PATCH', body: JSON.stringify({ name, pinned }) })
      if (Array.isArray(d?.pinned_projects)) setPinnedProjects(d.pinned_projects)
    } catch (e) {
      if (e.name !== 'AbortError') setErr(e.message || String(e))
      await loadSessions(activeSidRef.current || '').catch(() => {})
    }
  }

  const openProjectFolder = async (project) => {
    const name = project.name
    const instanceID = chatInstanceRef.current
    if (!await confirmDanger('chat-project-folder-open', ct(`在服务器桌面打开项目文件夹 ${name}？`, `Open project folder ${name} on the server desktop?`))) return
    if (instanceID !== chatInstanceRef.current) return
    try {
      await chatApi('/api/files/open', { dangerous: true, method: 'POST', body: JSON.stringify({ project_provider: project.provider || 'official', project_id: project.id || name, mode: 'folder' }) })
    } catch (e) {
      if (e.name !== 'AbortError') setErr(e.message || String(e))
    }
  }

  const openProjectDraft = () => {
    setProjectsExpanded(true)
    setProjectDraftName('')
    setProjectDraftOpen(true)
  }

  const closeProjectDraft = () => {
    setProjectDraftOpen(false)
    setProjectDraftName('')
  }

  // Creating a project used to require typing /project <name> into the composer.
  // Land the user in a usable state instead: make the directory, then open a
  // chat already bound to it.
  const createProject = async () => {
    const name = projectDraftName.trim()
    const problem = projectNameError(name)
    if (problem) {
      setErr(projectNameErrorText(problem, ct))
      return
    }
    if (projectCreating) return
    setProjectCreating(true)
    setErr('')
    try {
      const provider = 'official'
      if (projects.some(existing => (existing?.id || existing) === name)) {
        setErr(ct(`项目 ${name} 已存在。`, `Project ${name} already exists.`))
        return
      }
      const d = await chatApi('/api/chat/projects', { method:'POST', body: JSON.stringify({ name, provider }) })
      const created = String(d?.name || name)
      const project = d?.provider && d?.id ? { provider: d.provider, id: d.id, name: created } : created
      const projectKey = typeof project === 'object' ? project.id : created
      setProjects(Array.isArray(d.project_items) ? d.project_items : Array.isArray(d.projects) ? d.projects : projects.concat(project))
      setExpandedProjectNames(current => new Set(current).add(projectKey))
      closeProjectDraft()
      await createSession(project)
      setNotice(d?.created === false
        ? ct(`项目 ${created} 已存在，已在其中新建对话`, `Project ${created} already existed; started a chat in it`)
        : ct(`已创建项目 ${created}，并新建了一个对话`, `Created project ${created} and started a chat in it`))
    } catch (e) {
      if (e.name !== 'AbortError') setErr(e.message || String(e))
    } finally {
      setProjectCreating(false)
    }
  }

  const deleteSession = async (id) => {
    if (!id || !await confirmDanger('chat-session-delete', ct('删除此会话？此操作不可恢复。', 'Delete this session? This cannot be undone.'))) return
    await chatApi(`/api/chat/session/${id}`, { method:'DELETE' })
    clearSessionDrafts(id)
    forgetSessionScroll(sessionScrollSnapshotsRef.current, id)
    setSessions(xs => xs.filter(x => x.id !== id))
    setMenuOpen('')
    setMenuPos(null)
    if (id === sid) {
      historyPages.clear()
      cancelSessionLoad()
      ++openSeqRef.current
      activeSidRef.current = ''
      renderedSessionRef.current = ''
      pendingRenderedSessionRef.current = ''
      pendingSessionScrollRestoreRef.current = null
      streamAbortRef.current?.abort?.()
      streamAbortRef.current = null
      scrollModeRef.current = 'auto'
      setSid(''); setMessages([]); setBusy(false); setStreamingSid(''); setAutoFollow(true); setShowFollow(false); setNotice(ct('会话已删除', 'Session deleted'))
    }
    setTimeout(() => loadSessions('', { open:true }).catch(()=>{}), 0)
  }

  const openSessionManager = () => {
    setSessionManagerView('all')
    setSessionManagerOpen(true)
    setSelectedSessionIds([])
    setEditing('')
    setDraftTitle('')
    setMenuOpen('')
    setMenuPos(null)
  }

  const closeSessionManager = () => {
    if (batchDeleting) return
    setSessionManagerOpen(false)
    setSelectedSessionIds([])
  }

  const toggleSessionSelection = (id) => {
    if (!id || batchDeleting) return
    setSelectedSessionIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])
  }

  const toggleAllSessions = () => {
    if (batchDeleting) return
    setSelectedSessionIds(ids => {
      const selected = new Set(ids)
      const visibleIds = managedSessions.map(session => session.id)
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id))
      visibleIds.forEach(id => allVisibleSelected ? selected.delete(id) : selected.add(id))
      return [...selected]
    })
  }

  const deleteSelectedSessions = async () => {
    if (batchDeleting) return
    const available = new Set(sessions.map(session => session.id))
    const ids = normalizeSessionIds(selectedSessionIds).filter(id => available.has(id))
    if (!ids.length || !await confirmDanger('chat-session-batch-delete', ct(`永久删除已选的 ${ids.length} 个会话？此操作不可恢复。`, `Permanently delete ${ids.length} selected sessions? This cannot be undone.`))) return

    setBatchDeleting(true)
    setErr('')
    setNotice('')
    try {
      const result = await deleteChatSessions(ids, id => chatApi(`/api/chat/session/${id}`, { method:'DELETE' }))
      clearSessionDrafts(result.deletedIds)
      const deleted = new Set(result.deletedIds)
      const activeDeleted = deleted.has(sid)
      forgetSessionScroll(sessionScrollSnapshotsRef.current, result.deletedIds)
      if (deleted.size) setSessions(xs => xs.filter(session => !deleted.has(session.id)))

      if (activeDeleted) {
        historyPages.clear()
        cancelSessionLoad()
        ++openSeqRef.current
        activeSidRef.current = ''
        renderedSessionRef.current = ''
        pendingRenderedSessionRef.current = ''
        pendingSessionScrollRestoreRef.current = null
        streamAbortRef.current?.abort?.()
        streamAbortRef.current = null
        scrollModeRef.current = 'auto'
        setSid('')
        setMessages([])
        setRawHistory([])
        setHistoryInfo([])
        setWorkingState(null)
        setPlanState(null)
        setContextOpen(false)
        setBusy(false)
        setStreamingSid('')
        setAutoFollow(true)
        setShowFollow(false)
      }

      let refreshError = ''
      if (deleted.size) {
        try {
          await loadSessions(activeDeleted ? '' : sid, { open: activeDeleted })
        } catch (e) {
          refreshError = e?.message || String(e)
        }
      }

      if (result.failedIds.length) {
        setSelectedSessionIds(result.failedIds)
        const detail = result.failures[0]?.error?.message || ''
        setErr(ct(`${result.failedIds.length} 个会话删除失败${detail ? `：${detail}` : ''}${refreshError ? `；刷新失败：${refreshError}` : ''}`, `${result.failedIds.length} sessions could not be deleted${detail ? `: ${detail}` : ''}${refreshError ? `; refresh failed: ${refreshError}` : ''}`))
      } else {
        setSelectedSessionIds([])
        setSessionManagerOpen(false)
        if (refreshError) setErr(ct(`已删除 ${result.deletedIds.length} 个会话，但刷新列表失败：${refreshError}`, `${result.deletedIds.length} sessions deleted, but list refresh failed: ${refreshError}`))
        else setNotice(ct(`已删除 ${result.deletedIds.length} 个会话`, `${result.deletedIds.length} sessions deleted`))
      }
    } finally {
      setBatchDeleting(false)
    }
  }

  const closeSessionMenu = ({ restoreFocus = false } = {}) => {
    setMenuOpen('')
    setMenuPos(null)
    if (restoreFocus) menuTriggerRef.current?.focus()
    menuTriggerRef.current = null
  }

  useEffect(() => {
    if (!menuOpen) return undefined
    // The menu is a fixed layer placed at the coordinates the row had when it
    // opened, so anything that happens elsewhere dismisses it: a pointer that
    // lands outside, Escape, or a scroll that would leave it behind. The
    // trigger is excluded because it closes the menu through its own toggle.
    const onPointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) return
      if (event.target?.closest?.('.oa-session-more')) return
      closeSessionMenu()
    }
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeSessionMenu({ restoreFocus: true })
    }
    const onScroll = (event) => {
      if (menuRef.current?.contains(event.target)) return
      closeSessionMenu()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menuOpen])

  const copySessionId = async (sessionId) => {
    if (!sessionId) return
    closeSessionMenu({ restoreFocus: true })
    setErr('')
    setSessionCopyNotice('')
    try {
      await copyText(sessionId)
      setSessionCopyNotice(ct('会话ID已复制', 'Session ID copied'))
    } catch {
      setSessionCopyNotice(ct('复制会话ID失败，请检查剪贴板权限后重试', 'Could not copy session ID. Check clipboard permissions and try again.'))
    }
  }

  const startRename = (s) => { setEditing(s.id); setDraftTitle(shortTitle(s)); setMenuOpen(''); setMenuPos(null) }
  const saveRename = async (id) => {
    const title = draftTitle.trim()
    if (!title) return
    const d = await chatApi(`/api/chat/session/${id}`, { method:'PATCH', body: JSON.stringify({ title }) })
    setSessions(xs => xs.map(x => x.id === id ? { ...x, title:d.title, updated_at:d.updated_at } : x))
    setEditing(''); setDraftTitle(''); setNotice(ct('会话已更名', 'Session renamed'))
  }

  const setSessionPinned = async (session) => {
    if (!session?.id) return
    const pinned = !session.pinned
    setMenuOpen(''); setMenuPos(null); setErr('')
    setSessions(xs => xs.map(x => x.id === session.id ? { ...x, pinned } : x))
    try {
      const d = await chatApi(`/api/chat/pin/${session.id}`, { method:'PATCH', body:JSON.stringify({ pinned }) })
      setSessions(xs => xs.map(x => x.id === session.id ? { ...x, pinned:Boolean(d.pinned) } : x))
      setNotice(d.pinned ? ct('\u5df2\u7f6e\u9876\u4f1a\u8bdd', 'Session pinned') : ct('\u5df2\u53d6\u6d88\u7f6e\u9876', 'Session unpinned'))
    } catch (e) {
      setSessions(xs => xs.map(x => x.id === session.id ? { ...x, pinned:!pinned } : x))
      setErr(e.message || String(e))
    }
  }

  const setSessionHubEnabled = async (session) => {
    if (!session?.id || hubUpdatingSessionId) return
    const enabled = !session.hub_enabled
    setHubUpdatingSessionId(session.id)
    setMenuOpen(''); setMenuPos(null); setErr('')
    try {
      const d = await chatApi(`/api/chat/hub/${session.id}`, { method:'PATCH', body:JSON.stringify({ enabled }) })
      setSessions(xs => xs.map(x => x.id === session.id ? { ...x, hub_enabled:Boolean(d.hub_enabled) } : x))
      setNotice(d.hub_enabled ? ct('会话已入驻 Hub', 'Session joined Hub') : ct('会话已退出 Hub', 'Session left Hub'))
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setHubUpdatingSessionId('')
    }
  }

  const saveModel = async (next) => {
    setLlmNo(next)
    if (!sid) return
    await chatApi(`/api/chat/settings/${sid}`, { method:'POST', body: JSON.stringify({ llm_no: next, reasoning_effort: reasoningEffort }) })
    setNotice(ct('模型已切换', 'Model changed'))
  }

  // A model list that came back empty is worth explaining: the cause is almost
  // always a missing pip package, a GA root that is not one, or a GA that has no
  // model configured yet, and each has a different next step.
  const modelDiagnosis = !llms.length ? (chatBackend?.diagnosis || null) : null

  const installChatPythonDeps = async () => {
    const packages = (modelDiagnosis?.install_packages || []).join(' ')
    if (!modelDiagnosis?.fixable || !packages) return
    if (!await confirmDanger('chat-python-install-deps', ct(`为 ${modelDiagnosis.python} 安装缺失依赖：${packages}？将执行 pip install。`, `Install missing dependencies into ${modelDiagnosis.python}: ${packages}? This runs pip install.`))) return
    setDepsRepairing(true)
    setErr('')
    setNotice(ct('正在安装依赖，首次安装可能需要一两分钟…', 'Installing dependencies; the first run can take a minute or two…'))
    try {
      const d = await chatApi('/api/chat/python/install-deps', { dangerous:true, method:'POST', body:'{}' })
      if (d?.ok) setNotice(ct(`依赖安装完成，已发现 ${d.llm_count} 个模型`, `Dependencies installed; found ${d.llm_count} models`))
      else { setNotice(''); setErr(d?.error || d?.diagnosis?.hint || ct('依赖安装失败', 'Dependency install failed')) }
      await loadChatState(activeSidRef.current || '')
    } catch (e) {
      if (e.name !== 'AbortError') { setNotice(''); setErr(e.message || String(e)) }
    } finally {
      setDepsRepairing(false)
    }
  }

  const saveReasoningEffort = async (value) => {
    const next = normalizeReasoningEffort(value)
    const prev = reasoningEffort
    setReasoningEffort(next)
    if (!sid) return
    try {
      await chatApi(`/api/chat/settings/${sid}`, { method:'POST', body: JSON.stringify({ llm_no: llmNo, reasoning_effort: next }) })
      setNotice(next === 'off' ? ct('推理强度已设为默认', 'Reasoning effort reset to default') : ct(`推理强度已设为 ${next}`, `Reasoning effort set to ${next}`))
    } catch (e) {
      setReasoningEffort(prev)
      setErr(e.message || String(e))
    }
  }

  const loadPromptPresets = async () => {
    const d = await api('/api/extra-system-prompt-presets')
    const next = normalizePromptPresets(d?.presets)
    setPromptPresets(next)
    return next
  }
  const selectExtraPromptPreset = (value) => {
    extraPromptSelectionSeqRef.current += 1
    setExtraPromptSelection(value)
  }
  const openExtraPromptEditor = () => {
    const targetSid = activeSidRef.current
    const targetOpenToken = openSeqRef.current
    const initialSelectionSeq = extraPromptSelectionSeqRef.current
    setPromptPresetManagerOpen(false)
    setExtraPromptTargetSid(targetSid)
    setExtraPromptSelection(extraSysPromptPresetID)
    setExtraPromptOpen(true)

    Promise.all([
      loadChatState(targetSid, targetOpenToken),
      loadPromptPresets(),
    ]).then(([freshState]) => {
      if (!freshState || targetOpenToken !== openSeqRef.current || activeSidRef.current !== targetSid) return
      if (extraPromptSelectionSeqRef.current === initialSelectionSeq) {
        setExtraPromptSelection(freshState.extraSysPromptPresetID)
      }
    }).catch(e => {
      if (targetOpenToken === openSeqRef.current && activeSidRef.current === targetSid) {
        setErr(e.message || String(e))
      }
    })
  }
  const openPromptPresetManager = () => {
    setExtraPromptDraft(promptPresets.map(item => ({ ...item })))
    setPromptPresetManagerOpen(true)
  }
  const updateExtraPromptDraft = (id, field, value) => {
    setExtraPromptDraft(items => items.map(item => item.id === id ? { ...item, [field]: value } : item))
  }
  const saveExtraPromptSelection = async () => {
    const targetSid = extraPromptTargetSid
    if (!targetSid) {
      setErr(ct('请先创建或打开会话', 'Create or open a session first'))
      return
    }
    if (activeSidRef.current !== targetSid) {
      setExtraPromptOpen(false)
      setErr(ct('会话已切换，请重新选择系统提示预设', 'The session changed; choose the system-prompt preset again'))
      return
    }
    const targetOpenToken = openSeqRef.current
    setExtraPromptSaving(true)
    try {
      const d = await chatApi(`/api/chat/settings/${targetSid}`, {
        method:'POST',
        body: JSON.stringify({ llm_no: llmNo, reasoning_effort: reasoningEffort, ...promptPresetPatch(extraPromptSelection) }),
      })
      if (targetOpenToken !== openSeqRef.current || activeSidRef.current !== targetSid) {
        setExtraPromptOpen(false)
        return
      }
      const savedID = String(d.extra_sys_prompt_preset_id || '').trim()
      const savedPrompts = Array.isArray(d.extra_sys_prompts) ? d.extra_sys_prompts.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : []
      setExtraSysPromptPresetID(savedID)
      setExtraSysPrompts(savedPrompts)
      setExtraPromptSelection(savedID)
      setExtraPromptOpen(false)
      setNotice(savedID ? ct(`已为当前会话启用「${selectedPromptPresetView({ presets: promptPresets, selectedID: savedID, snapshot: savedPrompts }).name}」`, `Enabled “${selectedPromptPresetView({ presets: promptPresets, selectedID: savedID, snapshot: savedPrompts }).name}” for this session`) : ct('当前会话已停用额外系统提示', 'Extra system prompt disabled for this session'))
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setExtraPromptSaving(false)
    }
  }
  const savePromptPresets = async () => {
    const next = normalizePromptPresets(extraPromptDraft)
    if (next.some(item => !item.name || !item.content)) {
      setErr(ct('每个预设都需要名称和提示内容', 'Every preset needs a name and prompt content'))
      return
    }
    if (!await confirmDanger('chat-extra-system-prompt-presets-save', ct(`保存 ${next.length} 个全局系统提示预设？这会写入 GA Admin 配置文件。`, `Save ${next.length} global system-prompt presets? This writes the GA Admin configuration file.`))) return
    setExtraPromptSaving(true)
    try {
      const d = await api('/api/extra-system-prompt-presets', {
        dangerous:true,
        method:'PUT',
        body: JSON.stringify({ presets: next }),
      })
      const saved = normalizePromptPresets(d?.presets)
      setPromptPresets(saved)
      setExtraPromptDraft(saved.map(item => ({ ...item })))
      setPromptPresetManagerOpen(false)
      setNotice(ct(`已保存 ${saved.length} 个系统提示预设`, `${saved.length} system-prompt presets saved`))
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setExtraPromptSaving(false)
    }
  }


  const addAttachmentFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean)
    if (!files.length) return
    if (attachments.length + files.length > MAX_CHAT_UPLOAD_FILES) {
      setErr(ct(`附件最多上传 ${MAX_CHAT_UPLOAD_FILES} 个`, `You can upload up to ${MAX_CHAT_UPLOAD_FILES} attachments`))
      return
    }
    const tooLarge = files.find((file) => (Number(file.size) || 0) > MAX_CHAT_UPLOAD_BYTES_PER_FILE)
    if (tooLarge) {
      setErr(ct(`附件过大：${tooLarge.name || 'attachment'}，单个限制 300MiB`, `Attachment too large: ${tooLarge.name || 'attachment'}; limit 300 MiB per file`))
      return
    }
    const totalBytes = attachments.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
      + files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
    if (totalBytes > MAX_CHAT_UPLOAD_BYTES_TOTAL) {
      setErr(ct('附件总大小限制 300MiB', 'Total attachment size is limited to 300 MiB'))
      return
    }
    const attachmentSession = activeSidRef.current
    const attachmentInstance = chatInstanceRef.current
    const readOne = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve({
        id:`file-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name:file.name || `attachment-${Date.now()}`,
        type:file.type || 'application/octet-stream',
        size:Number(file.size) || 0,
        dataURL:String(reader.result || ''),
      })
      reader.onerror = () => reject(reader.error || new Error(ct('读取附件失败', 'Failed to read attachment')))
      reader.readAsDataURL(file)
    })
    try {
      const next = await Promise.all(files.map(readOne))
      if (attachmentSession !== activeSidRef.current || attachmentInstance !== chatInstanceRef.current) return
      setErr('')
      updateAttachments([...attachmentsRef.current, ...next].slice(0, MAX_CHAT_UPLOAD_FILES))
      persistSessionDraft(attachmentSession, promptRef.current?.value ?? prompt)
    } catch (e) { setErr(e.message || String(e)) }
  }

  const removeAttachment = (id) => {
    updateAttachments(attachmentsRef.current.filter(x => x.id !== id))
    persistSessionDraft(activeSidRef.current, promptRef.current?.value ?? prompt)
  }
  const applyQueueSnapshot = (messages, sessionId = activeSidRef.current) => {
    if (sessionId !== activeSidRef.current) return []
    const next = Array.isArray(messages) ? messages : []
    queuedRef.current = next
    setQueuedMessages(next)
    return next
  }
  const requestQueue = (operation, payload = {}, sessionId = activeSidRef.current) => {
    if (!sessionId) return Promise.resolve([])
    const queueURL = addChatInstanceToURL(`/api/chat/queue/${sessionId}`, chatInstanceRef.current)
    const request = queueWriteRef.current
      .catch(() => {})
      .then(async () => {
        const d = await api(queueURL, { method:'PATCH', body:JSON.stringify({ op:operation, ...payload }) })
        return applyQueueSnapshot(d.queued_messages, sessionId)
      })
    queueWriteRef.current = request
    return request
  }
  const refreshQueue = (sessionId = activeSidRef.current) => {
    if (!sessionId) return Promise.resolve([])
    const queueURL = addChatInstanceToURL(`/api/chat/queue/${sessionId}`, chatInstanceRef.current)
    const request = queueWriteRef.current
      .catch(() => {})
      .then(async () => {
        const d = await api(queueURL)
        return applyQueueSnapshot(d.queued_messages, sessionId)
      })
    queueWriteRef.current = request
    return request
  }
  const enqueueMessage = async (item) => {
    const queued = { ...item, id:`q-${Date.now()}-${Math.random().toString(16).slice(2)}`, queuedAt:Date.now() }
    try {
      const next = await requestQueue('enqueue', { message:queued })
      setNotice(ct(`已加入队列（${next.length} 条）。点击“引导”可中止当前回复并立即发送。`, `Added to queue (${next.length}). Use Guide to stop the current response and send immediately.`))
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message || String(e)) }
  }
  const removeQueued = async (id) => {
    try {
      await requestQueue('remove', { id })
      if (queueEditingId === id) { setQueueEditingId(''); setQueueDraft('') }
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message || String(e)) }
  }
  const editQueued = (id) => {
    const item = queuedRef.current.find(x => x.id === id)
    if (!item) return
    setQueueEditingId(id)
    setQueueDraft(item.text || '')
    setNotice(ct('正在编辑队列消息', 'Editing queued message'))
  }
  const cancelQueueEdit = () => {
    setQueueEditingId('')
    setQueueDraft('')
    setNotice('')
  }
  const saveQueueEdit = async (id) => {
    const text = queueDraft.trim()
    const item = queuedRef.current.find(x => x.id === id)
    if (!item) return
    if (!text && !(item.files || []).length) { setErr(ct('队列消息不能为空', 'Queued message cannot be empty')); return }
    try {
      await requestQueue('update', { id, message:{ ...item, text } })
      setQueueEditingId('')
      setQueueDraft('')
      setErr('')
      setNotice(ct('队列消息已更新', 'Queued message updated'))
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message || String(e)) }
  }
  const guideQueuedItem = (id) => {
    if (guidingQueueRef.current) return
    const item = queuedRef.current.find(x => x.id === id)
    if (!item) return
    guidingQueueRef.current = id
    setGuidingQueueId(id)
    guideQueued(item)
  }
  const onPaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []).filter(Boolean)
    if (files.length) {
      e.preventDefault()
      addAttachmentFiles(files)
    }
  }
  const onDropFiles = (e) => {
    e.preventDefault(); setDragging(false)
    addAttachmentFiles(e.dataTransfer?.files)
  }


  const fillAskReply = useCallback((text) => {
    const value = String(text || '')
    setSessionPrompt(value)
    setNotice(ct('已填入快捷回复，确认后可发送', 'Quick reply inserted; review and send when ready'))
    const focusPrompt = () => {
      const el = promptRef.current
      if (!el) return
      el.focus()
      const len = value.length
      el.setSelectionRange?.(len, len)
    }
    requestAnimationFrame(focusPrompt)
    setTimeout(focusPrompt, 0)
  }, [setSessionPrompt])

  const editAndResend = async (messageId, text) => {
    const item = buildEditResendItem({
      sessionId: activeSidRef.current,
      messageId,
      text,
      busy,
      streamingSid,
    })
    await runSend(item)
  }

  const sendBTW = async (text, sessionId = activeSidRef.current || sid, retryId = '') => {
    if (!sessionId) {
      setNotice(ct('请先打开一个对话再使用 /btw', 'Open a conversation before using /btw'))
      return
    }
    const prompt = String(text || '').trim()
    const question = prompt.replace(/^\/btw(?:\s+|$)/i, '').trim()
    if (!question) {
      setNotice(ct('请在 /btw 后输入问题', 'Enter a question after /btw'))
      return
    }
    const placeholderId = retryId || `btw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const placeholder = {
      id: placeholderId,
      role: 'assistant',
      kind: 'btw',
      side_question: question,
      btw_status: 'pending',
      content: '',
      created_at: Math.floor(Date.now() / 1000),
    }
    setErr(''); setNotice('')
    if (isActiveSession(sessionId)) setMessages(xs => retryId
      ? xs.map(m => m.id === retryId ? placeholder : m)
      : [...xs, placeholder])
    try {
      const data = await chatApi(`/api/chat/btw/${sessionId}`, { method:'POST', body:JSON.stringify({ prompt:`/btw ${question}` }) })
      if (!isActiveSession(sessionId)) return
      if (data?.message) setMessages(xs => xs.map(m => m.id === placeholderId ? { ...data.message, btw_status:'done' } : m))
      await loadSessions(sessionId)
    } catch (e) {
      if (!isActiveSession(sessionId)) return
      const detail = e?.message || String(e)
      setMessages(xs => xs.map(m => m.id === placeholderId
        ? { ...m, btw_status:'error', content:detail }
        : m))
    }
  }

  const runSend = async (item = {}) => {
    const guidedQueueId = guidingQueueRef.current
    const text = String(item.text || '').trim()
    const files = normalizeChatAttachments(item.files).map(({ name, type, dataURL }) => ({ name, type, dataURL }))
    if (!text && !files.length) return
    const runToken = ++runSeqRef.current
    const streamToken = ++streamActivitySeqRef.current
    const openToken = openSeqRef.current
    const ctrl = new AbortController()
    activeRunRef.current = true
    streamAbortRef.current?.abort?.()
    streamAbortRef.current = ctrl
    const targetSessionID = item.sessionId || sid
    setTaskbarStoppedRun('')
    setBusy(true); setStreamingSid(targetSessionID || 'new'); setErr(''); setNotice('')
    let id = targetSessionID
    let commandPatch = null
    let optimistic = null
    let pending = null
    try {
      if (!id) {
        const d = await chatApi('/api/chat/session/new', { method:'POST', body:'{}' })
        if (runToken !== runSeqRef.current || openToken !== openSeqRef.current) return
        id = d.id
        clearSessionDrafts(id)
        activeSidRef.current = id
        scrollModeRef.current = 'auto'
        setSid(id); setStreamingSid(id)
      } else if (!isActiveSession(id)) {
        return
      }
      if (guidedQueueId) {
        await refreshQueue(id)
        guidingQueueRef.current = ''
        setGuidingQueueId('')
      }
      const clientUserID = `u-${Date.now()}`
      setStreamingSid(id)
      setSessions(xs => xs.map(s => s.id === id ? { ...s, running:true } : s))
      setAutoFollow(true); setShowFollow(false)
      const fileNote = files.length ? `\n\n[附件]\n${files.map((file) => `- ${uploadFileName(file)}`).join('\n')}` : ''
      const attachmentPrompt = text || ct('请处理这些附件', 'Please process these attachments')
      optimistic = { id:clientUserID, role:'user', content:attachmentPrompt + fileNote, files, created_at:Math.floor(Date.now()/1000) }
      pending = { id:`a-${Date.now()}`, role:'assistant', content:'', created_at:Math.floor(Date.now()/1000), run_started_at_ms:Date.now() }
      const sourceMessageID = String(item.sourceUserMessageId || '').trim()
      setRawHistory([]); setHistoryInfo([]); setWorkingState(null); setPlanState(null)
      if (!isActiveSession(id)) return
      activeSidRef.current = id
      if (!sourceMessageID) setMessages(xs => isActiveSession(id) ? [...xs, optimistic, pending] : xs)
      const payload = buildChatRunPayload({
        prompt: attachmentPrompt,
        files,
        settings: { llm_no:item.llmNo ?? llmNo, reasoning_effort:item.reasoningEffort || reasoningEffort },
        clientUserID,
        sourceUserMessageId: sourceMessageID,
      })
      const res = await chatFetch(`/api/chat/${id}`, { method:'POST', headers:{'Content-Type':'application/json'}, signal: ctrl.signal, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error(await res.text())
      if (sourceMessageID) setMessages(xs => {
        if (!isActiveSession(id)) return xs
        const cutIdx = xs.findIndex(message => String(message.id) === sourceMessageID)
        if (cutIdx < 0) return xs
        return [...xs.slice(0, cutIdx), optimistic, pending]
      })
      commandPatch = await followChatStream(res, pending.id, clientUserID, id, ctrl.signal)
    } catch (e) {
      if (runToken === runSeqRef.current && openToken === openSeqRef.current && e?.name !== 'AbortError' && isActiveSession(id)) setErr(e.message || String(e))
      if (item.propagateError) throw e
    } finally {
      if (runToken !== runSeqRef.current) return
      if (openToken !== openSeqRef.current || !isActiveSession(id)) {
        activeRunRef.current = false
        return
      }
      // followChatStream only returns after a terminal server state. Release the
      // local admission lock before the best-effort post-run reloads below, so a
      // prompt sent as the final output settles starts immediately instead of
      // being misclassified as queued while those requests are still pending.
      activeRunRef.current = false
      setBusy(false)
      setStreamingSid('')
      if (streamAbortRef.current === ctrl) streamAbortRef.current = null
      const isCurrentRun = () => runToken === runSeqRef.current
        && openToken === openSeqRef.current && streamToken === streamActivitySeqRef.current
        && isActiveSession(id)
      if (id) {
        const refreshedSessions = await loadSessions(id).catch(()=>[])
        if (!isCurrentRun()) return
        await refreshCompletedRun(id, openToken, isCurrentRun).catch(()=>{})
        if (!isCurrentRun()) return
        const refreshedSession = refreshedSessions.find(session => session.id === id)
        if (shouldPollGeneratedTitle(refreshedSession)) {
          void pollGeneratedChatTitle({ sessionId:id, loadSessions, isActive:isActiveSession }).catch(()=>{})
        }
        if (commandPatch?.commandResult && optimistic && pending && isActiveSession(id)) {
          const showWorldlinePicker = isWorldlinePickerResult(commandPatch.commandResult)
          const resultMessage = {
            ...pending,
            content: commandResultSummary(commandPatch.commandResult),
            commandResult: commandPatch.commandResult,
            run_started_at_ms: undefined,
          }
          setMessages(xs => {
            if (!isActiveSession(id)) return xs
            const baseMessages = showWorldlinePicker ? xs.filter(m => m.id !== pending.id) : xs
            const hasUser = baseMessages.some(m => m.id === optimistic.id)
            return [...baseMessages, ...(hasUser ? [] : [optimistic]), ...(showWorldlinePicker ? [] : [resultMessage])]
          })
          if (Object.prototype.hasOwnProperty.call(commandPatch, 'prefill')) setSessionPrompt(commandPatch.prefill, id)
          if (showWorldlinePicker) {
            setWorldlineRestorePicker({ nodes:commandPatch.commandResult.tree.nodes, sessionID:id })
          }
          if (commandPatch.download) {
            const blob = new Blob([commandPatch.download.content], { type:commandPatch.download.mime })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url; link.download = commandPatch.download.filename
            document.body.appendChild(link); link.click(); link.remove()
            URL.revokeObjectURL(url)
          }
        }
      }
      if (id && isActiveSession(id)) loadWorldline(id).catch(() => {})
      // Queue execution is now handled by backend automatically.
    }
  }


  const selectWorldlineRestoreNode = useCallback((nodeID, mode, target) => {
    const command = worldlineRestoreCommand(nodeID, mode, target)
    if (!command) return
    setSessionPrompt(command)
    setWorldlineRestorePicker(null)
    setNotice(ct('已填入恢复命令，确认后发送', 'Restore command inserted; review before sending'))
    window.setTimeout(() => {
      const input = promptRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange?.(command.length, command.length)
    }, 0)
  }, [setSessionPrompt])

  const expandCustomSlashCommand = useCallback((value) => {
    const raw = String(value || '').trim()
    if (!raw.startsWith('/')) return raw
    const custom = (cfg?.slash_commands || [])
      .filter(c => c?.cmd && !isProtectedSlashCommand(c.cmd))
      .map(c => ({ ...c, cmd: String(c.cmd || '').trim() }))
      .sort((a, b) => b.cmd.length - a.cmd.length)
    const hit = custom.find(c => raw === c.cmd || raw.startsWith(`${c.cmd} `) || raw.startsWith(`${c.cmd}\n`))
    if (!hit) return raw
    const args = raw.slice(hit.cmd.length).trim()
    let body = String(hit.content || hit.prompt || hit.desc || '').trim()
    if (!body) return raw
    if (body.includes('{{args}}') || body.includes('{args}')) {
      body = body.replaceAll('{{args}}', args).replaceAll('{args}', args)
    } else if (args) {
      body = `${body}\n\n${args}`
    }
    return body
  }, [cfg?.slash_commands, isProtectedSlashCommand])

  const send = async (textOverride = null) => {
    if (sessionLoadAbortRef.current || sessionLoading || sessionLoadFailed) return
    const hasStringOverride = typeof textOverride === 'string'
    const sourceText = hasStringOverride ? textOverride : prompt
    const text = expandCustomSlashCommand(String(sourceText || '').trim())
    const files = normalizeChatAttachments(attachments).map(({ name, type, dataURL }) => ({ name, type, dataURL }))
    if (text === '/new' && !files.length) {
      if (busy || activeRunRef.current) {
        setNotice(ct('当前正在执行，完成后可使用 /new 创建新对话', 'A run is in progress. Use /new after it completes.'))
        return
      }
      setSessionPrompt('')
      await newSession()
      return
    }
    if (!text && !files.length) return
    if (isBTWCommand(text) && !files.length && !(activeSidRef.current || sid)) {
      await sendBTW(text)
      return
    }
    const item = { text, files, llmNo, reasoningEffort }
    updateAttachments([]); setSessionPrompt('')
    setCmdDrawer({ open:false, filter:'', selectedIdx:0 })
    setCmdEditIdx(-1)
    if (isBTWCommand(text) && !files.length) {
      await sendBTW(text)
      return
    }
    if (busy || activeRunRef.current) {
      enqueueMessage(item)
      return
    }
    await runSend(item)
  }

  const applySlashCommand = (cmd, currentValue = prompt) => {
    if (!cmd) return
    const next = slashCommandInsertText(cmd, currentValue)
    setSessionPrompt(next)
    setCmdDrawer(slashCommandNextDrawer(cmd, next))
    setCmdEditIdx(-1)
    setTimeout(() => promptRef.current?.focus(), 0)
  }

  const handlePromptChange = (e) => {
    const v = e.target.value
    setSessionPrompt(v)
    if (v.startsWith('/')) {
      setCmdDrawer({ open:true, filter:v.slice(1), selectedIdx:0 })
      setCmdEditIdx(-1)
    } else if (cmdDrawer.open) {
      setCmdDrawer({ open:false, filter:'', selectedIdx:0 })
      setCmdEditIdx(-1)
    }
  }

  const handlePromptKeyDown = (e) => {
    // macOS 中文输入法确认英文候选词时也会派发 Enter；此时不能提交消息。
    if (e.isComposing || e.keyCode === 229) return
    const currentValue = e.currentTarget.value
    if (cmdDrawer.open && cmdEditIdx === -1) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCmdDrawer(prev => ({ ...prev, selectedIdx: Math.min(prev.selectedIdx + 1, Math.max(filteredCmds.length - 1, 0)) }))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCmdDrawer(prev => ({ ...prev, selectedIdx: Math.max(prev.selectedIdx - 1, 0) }))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const cmd = filteredCmds[cmdDrawer.selectedIdx]
        const selectingNaturalReview = cmd?.cmd === '/review <request>' && /^\s*\/review\s+\S/.test(currentValue)
        const selectingBareContinue = e.key === 'Enter' && /^\s*\/continue\s*$/.test(currentValue)
        const selectingBareEffort = e.key === 'Enter' && /^\s*\/effort\s*$/.test(currentValue)
        const selectingBareImprove = e.key === 'Enter' && /^\s*\/improve\s*$/.test(currentValue)
        const selectingContinueNumber = cmd?.cmd === '/continue <编号>' && /^\s*\/continue\s+\d+\s*$/.test(currentValue)
        const selectingUltraPlanObjective = cmd?.cmd === '/ultraplan <目标>' && /^\s*\/ultraplan\s+\S/.test(currentValue)
        // 通用参数式命令（如 /goal [goal]）：输入框已是「根命令 + 自由文本」时，Enter 直接发送当前值，
        // 不再走 applySlashCommand（否则 insert 模板会清空用户后面的内容）。
        const selectedCmdText = String(cmd?.cmd || '')
        const selectedCmdRoot = selectedCmdText.split(/\s+/, 1)[0]
        const selectingArgumentFreeText = !!cmd && isArgumentStyleSlashCmd(selectedCmdText)
          && new RegExp(`^\\s*${selectedCmdRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\S`).test(currentValue)
        if (selectingNaturalReview || selectingBareContinue || selectingBareEffort || selectingBareImprove || selectingContinueNumber || selectingUltraPlanObjective || selectingArgumentFreeText) {
          e.preventDefault()
          setCmdDrawer({ open:false, filter:'', selectedIdx:0 })
          setCmdEditIdx(-1)
          if (e.key === 'Enter') send(currentValue)
          return
        }
        if (cmd) {
          e.preventDefault()
          applySlashCommand(cmd, currentValue)
          return
        }
        e.preventDefault()
        setCmdDrawer({ open:false, filter:'', selectedIdx:0 })
        setCmdEditIdx(-1)
        if (e.key === 'Enter') send(currentValue)
        return
      }
      if (e.key === 'Escape') {
        setCmdDrawer({ open:false, filter:'', selectedIdx:0 })
        setCmdEditIdx(-1)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(currentValue)
    }
  }


  const guideQueued = async (item = null) => {
    const next = item || queuedRef.current[0]
    if (!next) {
      guidingQueueRef.current = ''
      setGuidingQueueId('')
      return
    }
    const id = sid
    const wasRunning = busy && streamingSid === sid
    const guidedUser = id && next.id ? {
      id:`guided-${next.id}`,
      role:'user',
      content:String(next.text || ''),
      files:normalizeChatAttachments(next.files),
      created_at:Math.floor(Date.now()/1000),
    } : null
    let guideStarted = false
    // Project the selected queue item before cancellation or guide network I/O so
    // the user's action is visible immediately. The stable queue-derived id also
    // lets the stream/session snapshot replace or deduplicate this local turn.
    if (guidedUser) {
      // Guiding is an explicit jump to the newest turn. Restore follow before the
      // optimistic append so the layout effect reveals it in the same paint.
      scrollModeRef.current = 'smooth'
      setFollowState(true)
      setMessages(xs => isActiveSession(id) && !xs.some(message => message.id === guidedUser.id)
        ? [...xs, guidedUser]
        : xs)
    }
    // Only increment runSeqRef when there's actually a running task to abort
    // Otherwise it will cause the next runSend's token check to fail
    if (wasRunning) {
      ++runSeqRef.current
    }
    try {
      if (wasRunning) {
        streamAbortRef.current?.abort?.()
        if (id) await chatApi(`/api/chat/cancel/${id}`, { method:'POST', body:'{}' })
        setMessages(xs => {
          const pendingAssistantIndex = xs.findLastIndex(message => message.role === 'assistant' && !message.content)
          return xs.map((message, index) => index === pendingAssistantIndex
            ? { ...message, content:ct('已中止，改为执行引导消息。', 'Stopped and switched to the guided message.'), error:true }
            : message)
        })
      }
      // Call backend guide API to trigger queue execution, then attach to the
      // newly-created run so its user turn and output appear without a reload.
      if (id && next.id) {
        const guideURL = `/api/chat/guide/${id}/${next.id}`
        let guideResult = await chatApi(guideURL, { method:'POST', body:'{}' })
        // The local stream state can lag behind the backend. If guide reports
        // an active run, cancel that server-owned run and retry exactly once;
        // otherwise waitForRun would poll forever while the item stays queued.
        if (guideResult?.status === 'queued') {
          await chatApi(`/api/chat/cancel/${id}`, { method:'POST', body:'{}' })
          guideResult = await chatApi(guideURL, { method:'POST', body:'{}' })
        }
        if (guideResult?.status !== 'started') {
          throw new Error(ct('引导消息未能开始执行', 'The guided message did not start'))
        }
        guideStarted = true
        if (!isActiveSession(id)) return
        await refreshQueue(id)
        guidingQueueRef.current = ''
        setGuidingQueueId('')
        setNotice(ct('已引导：中止当前回复并触发队列执行', 'Guided: stopped the current response and triggered queue execution'))
        await attachRunningStream(id, { waitForRun:true, clientUserID:guidedUser.id })
      }
    } catch (e) {
      if (!guideStarted && guidedUser) {
        setMessages(xs => xs.filter(message => message.id !== guidedUser.id))
        if (guidingQueueRef.current === next.id) {
          guidingQueueRef.current = ''
          setGuidingQueueId('')
        }
      }
      setErr(e.message || String(e))
    } finally {
      // attachRunningStream owns busy/streamingSid. A concurrent re-attach may have
      // replaced this guide's controller, so clearing those here would hide the live run.
      activeRunRef.current = false
    }
  }

  useEffect(() => {
    loadPromptPresets().catch(e=>setErr(e.message))
    api('/api/instances').then(payload => {
      const options = chatInstanceOptions(payload)
      setChatInstances(options)
      if (!chatInstanceRef.current && payload?.default_id) {
        const defaultID = String(payload.default_id).trim()
        chatInstanceRef.current = defaultID
        setChatInstanceID(defaultID)
        setDraftSessionIds(new Set(listChatSessionDraftIds(undefined, defaultID)))
        persistChatInstanceID(defaultID)
      }
    }).catch(e => setErr(e.message)).finally(() => setChatInstancesLoading(false))
    return () => streamAbortRef.current?.abort?.()
  }, [])

  useEffect(() => {
    if (chatInstancesLoading) return
    const instanceKey = chatInstanceID || '__default__'
    if (openedChatInstanceRef.current === instanceKey) return
    openedChatInstanceRef.current = instanceKey
    const intent = chatLaunchIntentRef.current
    const openInitialChat = async () => {
      try {
        if (!intent.newChat || chatLaunchStartedRef.current) {
          await loadSessions('', { open:true })
          return
        }
        chatLaunchStartedRef.current = true
        const newSessionID = await createSession()
        if (!newSessionID) return
        if (intent.prompt) setSessionPrompt(intent.prompt, newSessionID)
        clearChatLaunchIntent()
        requestAnimationFrame(() => promptRef.current?.focus())
      } catch (e) {
        if (e?.name !== 'AbortError') setErr(e.message)
      }
    }
    void openInitialChat()
  }, [chatInstanceID, chatInstancesLoading])

  useEffect(() => {
    let stopped = false
    let inFlight = false
    let metadataSessionID = ''
    let metadataRefreshedAt = 0
    const refreshList = async () => {
      if (stopped || inFlight || (!shouldRefreshChatTaskbar() && !shouldPollConductorSessions(sessionsRef.current))) return
      inFlight = true
      try {
        const d = await loadSessionList()
        if (!stopped) {
          const previous = sessionsRef.current
          const incoming = mergeChatSessionDraftSessions(d.sessions, chatInstanceRef.current)
          const next = reconcileSessionSummaries(previous, incoming)
          sessionsRef.current = next
          setSessions(next)
          const incomingProjects = Array.isArray(d.project_items) ? d.project_items : (d.projects || [])
          setProjects(current => equalSessionSummaryValue(current, incomingProjects) ? current : incomingProjects)
          setPinnedProjects(current => reconcileScalarList(current, d.pinned_projects))
          setProjectOrder(current => reconcileScalarList(current, d.project_order))
          const activeID = activeSidRef.current
          const before = previous.find(item => item.id === activeID)
          const after = next.find(item => item.id === activeID)
          const conductorPoll = conductorPollActions(after, {
            streamAttached: Boolean(streamAbortRef.current),
            runAttached: Boolean(activeRunRef.current),
            metadataUnchanged: metadataSessionID === activeID && equalSessionSummaryValue(before, after)
              && equalSessionSummaryValue(
                previous.filter(item => conductorParentID(item) === activeID),
                next.filter(item => conductorParentID(item) === activeID),
              ),
            metadataAge: Date.now() - metadataRefreshedAt,
            workersActive: next.some(item => conductorParentID(item) === activeID && canStopConductorWorker(item)),
          })
          if (conductorPoll.attachRunningStream) {
            void attachRunningStream(activeID, { waitForRun:true })
          }
          if (!guidingQueueRef.current && shouldRefreshChatSnapshot(before, after)) {
            await refreshActiveSessionSnapshot(activeID).catch(() => {})
          }
          if (conductorPoll.refreshMetadata && !stopped && activeSidRef.current === activeID) {
            const metadata = (isConductorParent(after) || after?.conductor_children?.length > 0)
              ? await chatApi(`/api/chat/conductor/${encodeURIComponent(activeID)}/children`)
              : null
            if (!stopped && activeSidRef.current === activeID) {
              metadataSessionID = activeID
              metadataRefreshedAt = Date.now()
              setActiveSessionDetail(current => current && String(current.id) === String(after.id)
                ? { ...current, ...after, ...(Array.isArray(metadata?.children) ? { conductor_children: metadata.children, conductor_usage_summary: metadata.usage_summary, conductor_dispatch_count: metadata.dispatch_count } : {}) }
                : current)
            }
          }
        }
      } catch {
        // Background refresh is best-effort; keep manual refresh errors visible only.
      } finally {
        inFlight = false
      }
    }
    const timer = window.setInterval(refreshList, 3000)
    const onVisible = () => { if (!document.hidden) { metadataRefreshedAt = 0; refreshList() } }
    const onOnline = () => { metadataRefreshedAt = 0; refreshList() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [chatInstanceID])

  useEffect(() => {
    if (!sid) return undefined
    let stopped = false
    let fallbackTimer = null
    const syncQueue = () => {
      if (stopped || document.hidden) return
      void refreshQueue(sid).catch(() => {})
    }
    const stopFallback = () => {
      if (fallbackTimer === null) return
      window.clearInterval(fallbackTimer)
      fallbackTimer = null
    }
    const startFallback = () => {
      if (stopped || fallbackTimer !== null) return
      syncQueue()
      fallbackTimer = window.setInterval(syncQueue, 3000)
    }
    const eventsURL = addChatInstanceToURL(`/api/chat/queue/${sid}/events`, chatInstanceRef.current)
    const source = typeof EventSource === 'undefined' ? null : new EventSource(eventsURL)
    if (source) {
      source.onopen = () => {
        stopFallback()
        syncQueue()
      }
      source.onerror = startFallback
      source.addEventListener('ready', syncQueue)
      source.addEventListener('queue_changed', syncQueue)
    } else {
      startFallback()
    }
    const calibrationTimer = window.setInterval(syncQueue, 60000)
    const onVisible = () => { if (!document.hidden) syncQueue() }
    const onOnline = () => syncQueue()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    syncQueue()
    return () => {
      stopped = true
      source?.close()
      stopFallback()
      window.clearInterval(calibrationTimer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [sid, chatInstanceID])

  useEffect(() => {
    if (!sessionManagerOpen) return
    const previousOverflow = document.body.style.overflow
    const onKey = (e) => {
      if (e.key !== 'Escape' || batchDeleting) return
      setSessionManagerOpen(false)
      setSelectedSessionIds([])
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [sessionManagerOpen, batchDeleting])

  const switchChatInstance = (nextValue) => {
    const nextID = String(nextValue || '').trim()
    if (!nextID || nextID === chatInstanceRef.current) return
    historyPages.clear()
    cancelSessionLoad()
    sessionCacheRef.current.clear()
    sessionListReaderRef.current.clear()
    rememberRenderedSessionScroll()
    sessionScrollSnapshotsRef.current.clear()
    pendingSessionScrollRestoreRef.current = null
    pendingRenderedSessionRef.current = ''
    renderedSessionRef.current = ''
    streamAbortRef.current?.abort?.()
    streamAbortRef.current = null
    chatRequestEpochRef.current += 1
    openSeqRef.current += 1
    worldlineSeqRef.current += 1
    runSeqRef.current += 1
    activeRunRef.current = false
    activeSidRef.current = ''
    chatInstanceRef.current = nextID
    persistChatInstanceID(nextID)
    setChatInstanceID(nextID)
    setDraftSessionIds(new Set(listChatSessionDraftIds(undefined, nextID)))
    setSid('')
    setSessions([])
    setProjects([])
    setMessages([])
    messagesRef.current = []
    setRawHistory([])
    setHistoryInfo([])
    setWorkingState(null)
    setPlanState(null)
    setBusy(false)
    setStreamingSid('')
    setWorldlineOpen(false)
    setWorldlineState(null)
    setWorldlineLoading(false)
    applyQueueSnapshot([])
    setQueueEditingId('')
    setQueueDraft('')
    guidingQueueRef.current = ''
    setGuidingQueueId('')
    updateAttachments([])
    setErr('')
    setNotice(ct('已切换 GA 实例', 'GA instance switched'))
  }

  // The scroll events an app-driven move produces arrive over the frames that
  // follow it, and they are ours rather than the reader's for that whole time.
  const markProgrammaticScroll = (thread, settleMs) => {
    previousScrollTopRef.current = thread.scrollTop
    previousScrollHeightRef.current = thread.scrollHeight
    followSettleUntilRef.current = Date.now() + settleMs
  }
  // Commit and ResizeObserver requests share a frame and read the latest height.
  const scrollToThreadEnd = (behavior = 'auto') => followScheduler.request(behavior)
  const setFollowState = (enabled) => {
    if (!enabled) followScheduler.cancel()
    autoFollowRef.current = enabled
    setAutoFollow(enabled)
    setShowFollow(!enabled && threadCanScroll(threadRef.current))
  }
  const resumeFollow = () => {
    setFollowState(true)
    scrollToThreadEnd('auto')
  }
  // A gesture away from the end stops the chase straight away, including one
  // made from the very bottom: a wheel event arrives before the page has moved,
  // so waiting for the scroll would let the next chunk pull the reader back
  // down first.
  const pauseFollow = () => {
    if (!autoFollowRef.current || !threadCanScroll(threadRef.current)) return
    setFollowState(false)
  }
  const cardTopOffset = (card) => (
    card.getBoundingClientRect().top - threadRef.current.getBoundingClientRect().top
  )
  const jumpToMessageNode = (messageID) => {
    const sessionID = activeSidRef.current
    const thread = threadRef.current
    if (!thread || sessionLoading) return
    setFollowState(false)
    requestAnimationFrame(() => {
      // A session switch can win the frame between releasing follow and jumping.
      if (activeSidRef.current !== sessionID || threadRef.current !== thread) return
      const finishJump = () => {
        if (activeSidRef.current !== sessionID || threadRef.current !== thread) return
        const card = [...thread.querySelectorAll('.oa-message.user')].find(el => el.dataset.id === messageID)
        if (!card) return
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        markProgrammaticScroll(thread, reducedMotion ? FOLLOW_SETTLE_MS : SMOOTH_SETTLE_MS)
        thread.scrollTo({ top: thread.scrollTop + cardTopOffset(card) - JUMP_TOP_MARGIN, behavior: reducedMotion ? 'auto' : 'smooth' })
      }
      const slot = [...thread.querySelectorAll('.oa-message-slot')].find(el => el.dataset.messageId === messageID)
      if (slot?.classList.contains('is-placeholder')) {
        slot.closest('.oa-message-list')?.dispatchEvent(new CustomEvent('ga-activate-message', {
          detail: { key: slot.dataset.messageKey },
        }))
        requestAnimationFrame(finishJump)
        return
      }
      finishJump()
    })
  }
  const updateFollowFromScroll = () => {
    const thread = threadRef.current
    if (!thread) return
    const { scrollTop, scrollHeight } = thread
    const action = scrollFollowAction({
      nearBottom: isNearBottom(thread),
      previousScrollTop: previousScrollTopRef.current,
      scrollTop,
      previousScrollHeight: previousScrollHeightRef.current,
      scrollHeight,
      programmatic: Date.now() < followSettleUntilRef.current,
    })
    if (!sessionLoading && Date.now() >= followSettleUntilRef.current && scrollTop < previousScrollTopRef.current && scrollHeight === previousScrollHeightRef.current) {
      historyPages.loadOlderNearTop()
    }
    previousScrollTopRef.current = scrollTop
    previousScrollHeightRef.current = scrollHeight
    if (action === 'resume' && !autoFollowRef.current) {
      setFollowState(true)
      return
    }
    if (action === 'pause') pauseFollow()
    // Once paused, the button tracks the thread rather than the moment it was
    // paused: it exists to close a gap, and the reader can close that gap by
    // hand at any point.
    if (!autoFollowRef.current) setShowFollow(threadCanScroll(thread) && !isNearBottom(thread))
  }

  useLayoutEffect(() => {
    if (sid && pendingRenderedSessionRef.current === sid) {
      renderedSessionRef.current = sid
      pendingRenderedSessionRef.current = ''
    }
    const scrollRestore = pendingSessionScrollRestoreRef.current
    if (scrollRestore?.sessionID === sid) {
      pendingSessionScrollRestoreRef.current = null
      const thread = threadRef.current
      if (thread) {
        thread.scrollTop = scrollRestore.scrollTop
        markProgrammaticScroll(thread, FOLLOW_SETTLE_MS)
      }
      setShowFollow(!isNearBottom(thread) && threadCanScroll(thread))
    } else if (autoFollow) {
      const behavior = scrollModeRef.current || 'auto'
      scrollModeRef.current = 'auto'
      scrollToThreadEnd(behavior)
    } else {
      // Content that shrank or a thread that no longer scrolls leaves nothing
      // to go back to, so the button follows the thread rather than the flag.
      setShowFollow(!isNearBottom(threadRef.current) && threadCanScroll(threadRef.current))
    }
  }, [messages, busy, autoFollow, sid])

  const lastThreadMessageId = messages.reduce((id, message) => message.kind === 'btw' ? id : message.id, '')
  useEffect(() => {
    const cards = threadRef.current?.querySelectorAll('.oa-message[data-id]')
    const tail = cards?.[cards.length - 1]
    if (!tail || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (autoFollowRef.current) scrollToThreadEnd('auto')
    })
    observer.observe(tail)
    return () => observer.disconnect()
  }, [lastThreadMessageId, sid])

  // The composer floats over the thread, so the thread has to reserve room for
  // it and the follow button has to clear it. Attachments, the send queue, and
  // a grown textarea all change that height, so it is measured rather than
  // guessed.
  useEffect(() => {
    const wrap = composerWrapRef.current
    const root = chatScope.current
    if (!wrap || !root || typeof ResizeObserver === 'undefined') return
    const apply = () => root.style.setProperty('--oa-composer-h', `${Math.round(wrap.getBoundingClientRect().height)}px`)
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  useGSAP(() => {
    if (prefersReducedMotion()) return
    const q = gsap.utils.selector(chatScope)
    gsap.from(q('.oa-sidebar'), { x: -24, autoAlpha: 0, duration: 0.52, ease: 'power3.out', clearProps: 'transform,opacity,visibility' })
    gsap.from(q('.oa-topbar, .oa-thread, .oa-composer-wrap'), { y: 18, autoAlpha: 0, duration: 0.5, stagger: 0.08, ease: 'power3.out', clearProps: 'transform,opacity,visibility' })
  }, { scope: chatScope })

  useGSAP(() => {
    if (prefersReducedMotion() || !messages.length) return
    const lastMessage = chatScope.current?.querySelector('.oa-message:last-of-type, .oa-turn:last-of-type')
    // clearProps 不能省:否则每条消息都会永久留下内联 transform,消息节点被提升为独立
    // 合成层后文字改用灰度抗锯齿,和其余文字的清晰度不一致。
    if (lastMessage) gsap.from(lastMessage, { y: 14, autoAlpha: 0, duration: 0.32, ease: 'power2.out', clearProps: 'transform,opacity,visibility' })
  }, { scope: chatScope, dependencies: [messages.length] })

  const sortedSidebarSessions = useMemo(() => sortSidebarSessions(sessions, sidebarPreferences.sort), [sessions, sidebarPreferences.sort])
  const sidebarPreferenceMenu = <>
    <SidebarPreferenceSubmenu label={ct('显示方式', 'View mode')} multiple value={['showProjects', 'showConductor'].filter(key => sidebarPreferences[key])}
      options={[{ value:'showProjects', label:ct('显示项目', 'Show projects') }, { value:'showConductor', label:ct('显示指挥家', 'Show conductor') }]}
      onChange={key=>updateSidebarPreference(key, !sidebarPreferences[key])}/>
    <SidebarPreferenceSubmenu label={ct('聊天排序方式', 'Chat sort order')} value={sidebarPreferences.sort}
      options={[{ value:'priority', label:ct('优先级', 'Priority') }, { value:'updated', label:ct('最近更新', 'Recently updated') }]}
      onChange={value=>updateSidebarPreference('sort', value)}/>
  </>

  const projectSessionGroups = useMemo(() => groupProjectSessions(projects, sortedSidebarSessions, pinnedProjects, projectOrder), [projects, sortedSidebarSessions, pinnedProjects, projectOrder])
  const sidebarSections = useMemo(() => conductorSidebarSections(sortedSidebarSessions, sidebarSearch, sidebarPreferences.showConductor), [sortedSidebarSessions, sidebarSearch, sidebarPreferences.showConductor])
  const recentGroupLabels = {
    pinned: ct('\u7f6e\u9876', 'Pinned'),
    today: ct('\u4eca\u5929', 'Today'),
    yesterday: ct('\u6628\u5929', 'Yesterday'),
    this_week: ct('\u672c\u5468', 'This week'),
    last_week: ct('\u4e0a\u5468', 'Last week'),
    this_month: ct('\u672c\u6708', 'This month'),
    older: ct('\u66f4\u65e9', 'Older'),
  }
  const managedHubSessions = useMemo(() => hubSessions(sessions), [sessions])
  const managedSessions = sessionManagerView === 'hub' ? managedHubSessions : sessions
  const managedRecentGroups = useMemo(() => groupRecentSessions(managedSessions), [managedSessions])
  const managedProjectGroups = useMemo(() => groupProjectSessions(projects, managedSessions, pinnedProjects, projectOrder), [projects, managedSessions, pinnedProjects, projectOrder])
  const toggleSessionGroup = (key) => setCollapsedSessionGroups(current => {
    const next = new Set(current)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
  const toggleSessionGroupSelection = (items) => {
    if (batchDeleting) return
    setSelectedSessionIds(current => {
      const next = new Set(current)
      const allSelected = items.every(item => next.has(item.id))
      items.forEach(item => allSelected ? next.delete(item.id) : next.add(item.id))
      return [...next]
    })
  }
  const managedSessionGroupLabels = { ...recentGroupLabels }
  const filteredProjectGroups = useMemo(() => projectSidebarGroups(projectSessionGroups, sidebarSearch), [projectSessionGroups, sidebarSearch])
  const selectedSessionIdSet = useMemo(() => new Set(selectedSessionIds), [selectedSessionIds])
  const selectedSessionCount = sessions.reduce((count, session) => count + (selectedSessionIdSet.has(session.id) ? 1 : 0), 0)
  const visibleSelectedSessionCount = managedSessions.reduce((count, session) => count + (selectedSessionIdSet.has(session.id) ? 1 : 0), 0)
  const allSessionsSelected = managedSessions.length > 0 && visibleSelectedSessionCount === managedSessions.length
  const activeModel = llms.find(x => x.index === llmNo) || llms[0]
  const selectedModelNo = activeModel?.index ?? llmNo
  const configuredReasoningEffort = normalizeReasoningEffort(activeModel?.reasoning_effort)
  const defaultReasoningLabel = configuredReasoningEffort === 'off'
    ? ct('默认', 'Default')
    : ct(`默认（${configuredReasoningEffort}）`, `Default (${configuredReasoningEffort})`)
  const providerGroups = useMemo(() => groupRuntimeModels(llms), [llms])
  const selectedProvider = activeModel ? runtimeModelGroup(activeModel).value : (providerGroups[0]?.value || '')
  const loopControllerModel = (Number(loopState?.epoch) > 0
    ? llms.find(model => Number(model.index) === Number(loopState?.controller_llm_no))
    : null)
    || (loopControllerLlmNo != null
      ? llms.find(model => Number(model.index) === Number(loopControllerLlmNo))
      : null)
    || activeModel
    || llms[0]
  const loopControllerModelLabel = loopControllerModel
    ? `${runtimeModelGroup(loopControllerModel).label} / ${runtimeModelLabel(loopControllerModel)}`
    : ct('未发现模型', 'No models found')
  const isCurrentRunning = busy && streamingSid === sid
  const activePromptPreset = selectedPromptPresetView({ presets: promptPresets, selectedID: extraSysPromptPresetID, snapshot: extraSysPrompts })
  const contextJson = useMemo(() => JSON.stringify({ raw_history: rawHistory || [], history_info: historyInfo || [], working: workingState || {} }, null, 2), [rawHistory, historyInfo, workingState])
  const btwMessages = useMemo(() => messages.filter(message => message.kind === 'btw'), [messages])
  const copyContext = async () => {
    try {
      await navigator.clipboard.writeText(contextJson)
      setNotice(ct('模型上下文 JSON 已复制', 'Model context JSON copied'))
    } catch {
      setErr(ct('复制失败，请手动选择 JSON', 'Copy failed; select the JSON manually'))
    }
  }

  sidebarSessionActionsRef.current = {
    openSession: sessionId => {
      chatReadState.markSessionRead(sessionId)
      openSession(sessionId)
    },
    saveRename,
    setDraftTitle,
    cancelRename: () => setEditing(''),
    toggleMenu: (sessionId, event) => {
      event.stopPropagation()
      if (menuOpen === sessionId) { closeSessionMenu(); return }
      const rect = event.currentTarget.getBoundingClientRect()
      menuTriggerRef.current = event.currentTarget
      setMenuPos({ top: Math.max(8, Math.min(rect.top - 78, window.innerHeight - 202)), left: Math.max(8, Math.min(rect.right - 164, window.innerWidth - 172)) })
      setMenuOpen(sessionId)
    },
  }

  const renderSidebarSession = (session, options = {}) => <SidebarSessionRow
    key={session.id}
    session={session}
    projectLabel={options.hideProjectLabel ? '' : projectSessionLabel(session, projectSessionGroups)}
    active={session.id === sid}
    editing={editing === session.id}
    menuOpen={menuOpen === session.id}
    draftTitle={editing === session.id ? draftTitle : ''}
    hasDraft={draftSessionIds.has(session.id)}
    ageText={sessionAgeText(session.updated_at)}
    unread={chatReadState.unread(session)}
    waiting={waitingSessionIds.has(session.id)}
    childRunning={conductorSidebarActivities.get(session.id)?.running || 0}
    treeExpanded={options.treeExpanded}
    onToggleTree={options.onToggleTree}
    nested={Boolean(options.nested)}
    actionsRef={sidebarSessionActionsRef}
  />

  const pinnedProjectGroups = filteredProjectGroups.filter(group => group.pinned)
  const regularProjectGroups = filteredProjectGroups.filter(group => !group.pinned)
  const pinnedSessions = sidebarSections.pinned
  const recentSessions = filterSidebarRecentNodes(
    conductorSidebarSections(sortedSidebarSessions, sidebarSearch, false).recent, sidebarPreferences.recentFilter,
  )
  const renderSidebarTree = (node, options = {}) => node.workers.length
    ? <ConductorSessionTree key={node.session.id} session={node.session} workers={node.workers} renderSession={(session, treeOptions) => renderSidebarSession(session, { ...options, ...treeOptions })} activeSessionId={sid}/>
    : renderSidebarSession(node.session, options)
  const renderSidebarProject = (group, index, { initialLimit = 10 } = {}) => {
          const projectKey = group.key || group.name
          const expanded = expandedProjectNames.has(projectKey)
          const bodyId = `oa-project-sessions-${group.pinned ? 'pinned' : 'normal'}-${index}`
          const toggleLabel = ct(`${expanded ? '收起' : '展开'} ${group.name}`, `${expanded ? 'Collapse' : 'Expand'} ${group.name}`)
          const pinLabel = group.pinned
            ? ct(`取消置顶 ${group.name}`, `Unpin ${group.name}`)
            : ct(`置顶 ${group.name}`, `Pin ${group.name}`)
          return <section data-project-name={projectKey} className={`oa-project-group ${expanded ? 'is-expanded' : 'is-collapsed'} ${group.pinned ? 'is-pinned' : ''}`} key={projectKey}>
            <div className="oa-project-head">
              <button className="oa-project-toggle" type="button" onClick={()=>setExpandedProjectNames(current => {
                const next = new Set(current)
                if (next.has(projectKey)) next.delete(projectKey)
                else next.add(projectKey)
                return next
              })} aria-expanded={expanded} aria-controls={bodyId} aria-label={toggleLabel} title={toggleLabel}>
                {expanded
                  ? <FolderOpen size={17} strokeWidth={1.5} className="oa-project-folder" aria-hidden="true"/>
                  : <Folder size={17} strokeWidth={1.5} className="oa-project-folder" aria-hidden="true"/>}<b title={group.name}>{group.name}</b>
              </button>
              {runningProjects.has(projectKey) && <span className="oa-session-running-label oa-project-running" role="img" aria-label={ct("\u9879\u76ee\u8fd0\u884c\u4e2d", "Project running")} title={ct("\u6709\u4f1a\u8bdd\u6b63\u5728\u8fd0\u884c", "A project session is running")} style={{ flexShrink: 0 }}><span className="oa-session-running-wave" aria-hidden="true"><i/><i/><i/><i/></span></span>}
              <button className="oa-project-add" type="button" onClick={()=>newProjectSession(group.provider ? group : group.name)} disabled={batchDeleting} title={ct(`在 ${group.name} 中新建对话`, `Start a chat in ${group.name}`)} aria-label={ct(`在 ${group.name} 中新建对话`, `Start a chat in ${group.name}`)}><Plus size={15}/></button>
              <ProjectActionsMenu label={ct('项目操作', 'Project actions')}>
              <button type="button" onClick={()=>createSession(group.provider ? group : group.name, { mode:'conductor' })} disabled={batchDeleting}><span className="oa-conductor-new-mark" aria-hidden="true">C</span>{ct('新建项目指挥家', 'New project Conductor')}</button>
              <button className={`oa-project-pin ${group.pinned ? 'is-pinned' : ''}`} type="button" onClick={()=>toggleProjectPinned(projectKey, !group.pinned)} aria-pressed={group.pinned} title={pinLabel} aria-label={pinLabel}><Pin size={14}/>{pinLabel}</button>
              <button type="button" onClick={()=>openProjectFolder(group)} title={ct('在服务器上打开项目文件夹', 'Open project folder on the server')}><FolderOpen size={14}/>{ct('打开项目文件夹', 'Open project folder')}</button>
              </ProjectActionsMenu>
            </div>
            <div className="oa-project-body" id={bodyId} hidden={!expanded}>
              <ProjectSessionPage key={`${projectKey}:${sidebarSearch}`} items={group.sessionTrees} renderItem={node => renderSidebarTree(node, { hideProjectLabel: true })} ct={ct} initialLimit={initialLimit}/>
              {!group.sessionTrees.length && <div className="oa-project-empty">{ct('暂无对话，点击项目旁的 + 新建', 'No chats yet. Click + beside the project to start one.')}</div>}
            </div>
          </section>
  }

  return <div ref={chatScope} className={`oa-chat ${collapsed ? 'is-collapsed' : ''}`}>
    <UiSurface name="chat.sidebar" preserveMount viewProps={{ ProjectActionsMenu, batchDeleting, chatInstanceID, chatInstances, chatInstancesLoading, chatReadState, closeProjectDraft, collapsed, conductorsExpanded, copySessionId, createProject, ct, deleteSession, historyExpanded, menuOpen, menuPos, menuRef, newConductorSession, newSession, onOpenSettings, openProjectDraft, openSessionManager, pinnedExpanded, pinnedProjectGroups, pinnedSessions, projectCreating, projectDraftName, projectDraftOpen, projectSessionGroups, projectsExpanded, recentSessions, regularProjectGroups, renderSidebarProject, renderSidebarTree, sessionManagerOpen, sessions, setCollapsed, setConductorsExpanded, setHistoryExpanded, setPinnedExpanded, setProjectDraftName, setProjectsExpanded, setSessionHubEnabled, setSessionPinned, setShowAllProjects, setSidebarSearch, showAllProjects, sidebarPreferenceMenu, sidebarPreferences, updateSidebarPreference, sidebarSearch, sidebarSections, startRename, switchChatInstance }}/>
    <div className={`oa-sidebar-backdrop ${collapsed ? '' : 'is-visible'}`} aria-hidden={collapsed} onClick={()=>setCollapsed(true)} />

    <main className="oa-main" data-ui-chat={uiPackage?.isDefaultSurface('chat.chrome') === false ? uiPackage.id : 'default'}>
      <ChatPackageBar session={{ id: sid, title: current ? shortTitle(current) : ct('新对话', 'New chat'), busy }} presentation={{ lang: chatLanguage(), theme }} actions={{ openSettings: () => { if (onOpenSettings) onOpenSettings(); else window.location.href = '/admin' }, newSession, toggleContext: () => setContextOpen(v => !v), toggleTimeline: toggleWorldline }}/>
      <header className="oa-topbar">
        {collapsed && <div className="oa-collapsed-actions">
          <button className="oa-icon-btn oa-sidebar-toggle" onClick={()=>setCollapsed(false)} title={ct('展开侧栏', 'Expand sidebar')} aria-label={ct('展开侧栏', 'Expand sidebar')}><PanelLeftOpen size={18} aria-hidden="true"/></button>
          <button className="oa-icon-btn oa-collapsed-new" onClick={newSession} title={ct('新对话', 'New chat')} aria-label={ct('新对话', 'New chat')}><MessageSquarePlus size={18}/></button>
        </div>}
        <div className="oa-title">{(current?.project_id || current?.project_mode) && <span className="oa-project-badge" title={current.project_id || current.project_mode}><FolderOpen size={12} aria-hidden="true"/><span>{current.project_id || current.project_mode}</span></span>}<b>{current ? shortTitle(current) : ct('新对话', 'New chat')}</b>{current?.workspace && <span className="oa-workspace-badge" title={current.workspace}>Workspace: {current.workspace}</span>}</div>
        <div className="oa-topbar-tools" role="toolbar" aria-label={ct('聊天工具', 'Chat tools')}>
          <div className="oa-topbar-view-tools" role="group" aria-label={ct('对话视图', 'Conversation views')}>
            <button className={`oa-context-btn ${contextOpen ? 'is-open' : ''}`} type="button" onClick={()=>setContextOpen(v=>!v)} disabled={!sid} title={ct('查看发给模型的 raw_history', 'View raw_history sent to the model')}>
              <PanelRightOpen size={16}/>{ct('上下文', 'Context')}<span>{rawHistory?.length || historyPages.page?.context_count || 0}</span>
            </button>
            <button className={`oa-context-btn oa-worldline-btn ${worldlineOpen ? 'is-open' : ''}`} type="button" onClick={toggleWorldline} disabled={!sid} title={ct('查看/切换对话世界线分支', 'View or switch conversation timeline branches')}>
              <GitBranch size={16}/>{ct('世界线', 'Timeline')}{(worldlineForView?.nodes?.length || 0) > 0 && <span>{worldlineForView.nodes.length}</span>}
            </button>
          </div>
          {(isConductorParent(activeSessionDetail) || activeSessionDetail?.conductor_children?.length > 0) && <button type="button" className={`oa-context-btn ${conductorWorkersOpen ? 'is-open' : ''}`} aria-expanded={conductorWorkersOpen} aria-controls="oa-conductor-workers" onClick={()=>{setConductorWorkersOpen(v=>!v); setConductorEventsOpen(false)}}><PanelRightOpen size={16}/>Subagents</button>}
          {(isConductorParent(activeSessionDetail) || activeSessionDetail?.conductor_children?.length > 0) && <button type="button" className={`oa-context-btn ${conductorEventsOpen ? 'is-open' : ''}`} aria-expanded={conductorEventsOpen} aria-controls="oa-conductor-events" onClick={()=>{setConductorEventsOpen(v=>!v); setConductorWorkersOpen(false)}}><PanelRightOpen size={16}/>{ct('任务事件', 'Task events')}</button>}
          <ThemePicker className="oa-topbar-theme" value={theme} onChange={setTheme} lang={chatLanguage()} variant="compact" />
        </div>
        <button
          ref={mobileToolsTriggerRef}
          className={`oa-icon-btn oa-mobile-tools-trigger ${mobileToolsOpen ? 'is-open' : ''}`}
          type="button"
          onClick={()=>setMobileToolsOpen(v=>!v)}
          aria-label={ct('打开聊天工具', 'Open chat tools')}
          aria-haspopup="dialog"
          aria-expanded={mobileToolsOpen}
          aria-controls="oa-mobile-tools-menu"
          title={ct('上下文、世界线与配色', 'Context, timeline, and theme')}
        ><MoreHorizontal size={18}/></button>
      </header>

      {mobileToolsOpen && createPortal(<div className="oa-mobile-tools-layer">
        <div className="oa-mobile-tools-backdrop" aria-hidden="true" onClick={()=>setMobileToolsOpen(false)} />
        <div className="oa-mobile-tools-menu" id="oa-mobile-tools-menu" role="dialog" aria-label={ct('聊天工具', 'Chat tools')}>
          <button
            className={`oa-mobile-tools-item ${contextOpen ? 'is-active' : ''}`}
            type="button"
            disabled={!sid}
            onClick={()=>{ setMobileToolsOpen(false); setContextOpen(v=>!v) }}
          >
            <PanelRightOpen size={17}/><span className="oa-mobile-tools-item-copy">{ct('上下文', 'Context')}</span><b className="oa-mobile-tools-item-badge">{rawHistory?.length || historyPages.page?.context_count || 0}</b>
          </button>
          <button
            className={`oa-mobile-tools-item ${worldlineOpen ? 'is-active' : ''}`}
            type="button"
            disabled={!sid}
            onClick={()=>{ setMobileToolsOpen(false); toggleWorldline() }}
          >
            <GitBranch size={17}/><span className="oa-mobile-tools-item-copy">{ct('世界线', 'Timeline')}</span>{(worldlineForView?.nodes?.length || 0) > 0 && <b className="oa-mobile-tools-item-badge">{worldlineForView.nodes.length}</b>}
          </button>
          {(isConductorParent(activeSessionDetail) || activeSessionDetail?.conductor_children?.length > 0) && <button type="button" className={`oa-context-btn ${conductorWorkersOpen ? 'is-open' : ''}`} aria-expanded={conductorWorkersOpen} aria-controls="oa-conductor-workers" onClick={()=>{setConductorWorkersOpen(v=>!v); setConductorEventsOpen(false)}}><PanelRightOpen size={16}/>Subagents</button>}
          {(isConductorParent(activeSessionDetail) || activeSessionDetail?.conductor_children?.length > 0) && <button type="button" className={`oa-context-btn ${conductorEventsOpen ? 'is-open' : ''}`} aria-expanded={conductorEventsOpen} aria-controls="oa-conductor-events" onClick={()=>{setConductorEventsOpen(v=>!v); setConductorWorkersOpen(false)}}><PanelRightOpen size={16}/>{ct('任务事件', 'Task events')}</button>}
          <ThemePicker
            className="oa-mobile-tools-theme"
            value={theme}
            onChange={(nextTheme)=>{ setTheme(nextTheme); setMobileToolsOpen(false) }}
            lang={chatLanguage()}
            variant="compact"
          />
        </div>
      </div>, document.body)}

      {contextOpen && <aside className="oa-context-drawer" aria-label={ct('模型上下文', 'Model context')}>
        <div className="oa-context-head">
          <div><b>{ct('模型上下文', 'Model context')}</b><span>{ct('agent.llmclient.backend.history 完成后的快照', 'Snapshot after agent.llmclient.backend.history completes')}</span></div>
          <div className="oa-context-actions"><button type="button" onClick={() => setContextRefresh(value => value + 1)} disabled={contextLoading} aria-label={ct('刷新上下文', 'Refresh context')}><RotateCw size={15}/></button><button type="button" onClick={copyContext} disabled={contextLoading || Boolean(contextError)}>{ct('复制 JSON', 'Copy JSON')}</button><button type="button" onClick={()=>setContextOpen(false)} aria-label={ct('关闭上下文', 'Close context')}><X size={15}/></button></div>
        </div>
        {contextLoading && <div className="oa-session-load" role="status">{ct('上下文加载中…', 'Loading context…')}</div>}
        {contextError && <div className="oa-session-load" role="alert">{contextError}</div>}
        {!contextLoading && !contextError && <>
          <div className="oa-context-json-tree"><JsonTree data={{ raw_history: rawHistory || [], history_info: historyInfo || [], working: workingState || {} }} /></div>
          <details className="oa-context-raw"><summary>{ct('原始 JSON', 'Raw JSON')}</summary><pre className="oa-context-raw-json">{contextJson}</pre></details>
        </>}
      </aside>}
      {worldlineOpen && <WorldlinePanel
        state={worldlineForView}
        loading={worldlineLoading}
        switchingId={worldlineSwitchingId}
        disabled={isCurrentRunning}
        onClose={() => setWorldlineOpen(false)}
        onRefresh={() => loadWorldline(sid, { force: true }).catch(() => {})}
        onSwitch={switchWorldline}
      />}
      <div className="oa-banner-slot">
        {sessionCopyNotice && createPortal(<div className="oa-session-copy-notice" role="status">
          <span>{sessionCopyNotice}</span>
          <button type="button" className="oa-icon-btn" onClick={() => setSessionCopyNotice('')} aria-label={ct('关闭复制提示', 'Dismiss copy notification')}><X size={16}/></button>
        </div>, document.body)}
        {err && <div className="oa-banner error">
          <span>{err}</span>
          <button type="button" onClick={() => setErr('')} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '18px', lineHeight: '1', padding: '0 4px' }} aria-label="关闭">&times;</button>
        </div>}
      </div>
      <div className={`oa-workspace ${loopRailOpen ? 'has-loop' : ''} ${btwRailOpen && btwMessages.length > 0 ? 'has-btw' : ''} ${btwMessages.length > 0 && !btwRailOpen ? 'has-launchers' : ''}`}>
        <UiSurface name="chat.messages" preserveMount viewProps={{ MessageList, activeSessionDetail, activeSidRef, conductorConflict, conductorParentID, ct, editAndResend, fillAskReply, historyPages, isConductorWorker, isCurrentRunning, isNearBottom, messages, openSession, pauseFollow, resumeFollow, sendBTW, sessionLoadFailed, sessionLoading, setConductorConflict, showFollow, sid, streamClock, switchWorldline, threadRef, updateFollowFromScroll, worldlineForView }}/>
        {(isConductorParent(activeSessionDetail) || activeSessionDetail?.conductor_children?.length > 0) && conductorWorkersOpen && <ConductorWorkspace detail={activeSessionDetail} sessions={sessions} onOpen={openSession} onStop={stopConductorWorker} onRecover={recoverConductorWorker} stoppingID={conductorStoppingID} onClose={()=>setConductorWorkersOpen(false)}/>}
        {(isConductorParent(activeSessionDetail) || activeSessionDetail?.conductor_children?.length > 0) && conductorEventsOpen && <ConductorEvents conductorDetail={activeSessionDetail} onClose={()=>setConductorEventsOpen(false)}/> }
        <MessageNavigator messages={messages} sessionID={sid} threadRef={threadRef}
          onNavigate={jumpToMessageNode} loading={sessionLoading} ct={ct}
          hasMore={historyPages.page?.has_more} loadingOlder={historyPages.loading} onLoadOlder={historyPages.loadOlder}/>
        {loopRailOpen && <div className="oa-loop-backdrop" onClick={()=>setLoopRailOpen(false)} aria-hidden="true"/>}
        {loopRailOpen && <aside className="oa-loop-rail" id="oa-loop-rail" aria-label={ct('Loop 控制', 'Loop controls')}>
          <header className="oa-loop-rail-head">
            <div className="oa-btw-title">
              <span>LOOP</span>
              <b>{loopState?.enabled ? ct('自动推进中', 'Auto advancing') : ct('自动推进', 'Auto advance')}</b>
              {loopState?.enabled && <em>{ct(`第 ${Number(loopState.round) || 0} 轮`, `Round ${Number(loopState.round) || 0}`)}</em>}
            </div>
            <button type="button" className="oa-btw-toggle" onClick={()=>setLoopRailOpen(false)} aria-expanded="true" aria-controls="oa-loop-rail" title={ct('收起 Loop 栏', 'Collapse Loop rail')}><ChevronRight size={15}/><span>{ct('收起', 'Collapse')}</span></button>
          </header>
          <section className={`oa-loop-panel ${loopState?.enabled ? 'is-active' : ''}`}>
            <div className="oa-loop-summary" aria-live="polite">
              <span className="oa-loop-orbit"><Orbit size={17} className={loopState?.enabled && loopState?.status !== 'waiting' ? 'is-spinning' : ''}/></span>
              <div>
                <b>{loopState?.enabled ? ct('正在持续完成目标', 'Continuing toward the objective') : ct('由监督模型推进下一轮', 'Let a controller advance the next turn')}</b>
                <span>{loopState?.enabled ? ct(`当前第 ${Number(loopState.round) || 0} 轮${loopState.max_rounds > 0 ? ` / 最多 ${loopState.max_rounds} 轮` : ' / 不限轮数'}`, `Round ${Number(loopState.round) || 0}${loopState.max_rounds > 0 ? ` / ${loopState.max_rounds} maximum` : ' / unlimited'}`) : ct('设定目标后启动', 'Set an objective to begin')}</span>
                <small className="oa-loop-model">{ct('控制模型：', 'Controller: ')}{loopControllerModelLabel}</small>
              </div>
            </div>
            {!loopState?.enabled && loopState?.stop_reason && <div className={`oa-loop-terminal ${loopState?.status === 'error' ? 'is-error' : ''}`} role={loopState?.status === 'error' ? 'alert' : 'status'}>
              <strong>{loopState?.status === 'error' ? ct('Loop 异常停止', 'Loop stopped with an error') : (loopState?.status === 'completed' ? ct('Loop 已结束', 'Loop finished') : ct('Loop 已停止', 'Loop stopped'))}</strong>
              <span>{loopStopReasonText(loopState.stop_reason)}</span>
            </div>}
            <section className="oa-loop-records" aria-label={ct('监察记录', 'Observer activity')}>
              <div className="oa-loop-records-head">
                <div>
                  <span>{ct('监察记录', 'Observer activity')}</span>
                  <small>{ct('只显示摘要与下一步', 'Summaries and next steps only')}</small>
                </div>
                {loopRecords.length > 0 && <em>{loopRecords.length}</em>}
              </div>
              {loopRecords.length > 0 ? <div className="oa-loop-records-list">
                {loopRecords.map(record => <article className={`oa-loop-record ${record.phase === 'error' ? 'is-error' : ''}`} key={record.key} role={record.phase === 'error' ? 'alert' : undefined}>
                  <div className="oa-loop-record-mark" aria-hidden="true" />
                  <div className="oa-loop-record-body">
                    <div className="oa-loop-record-meta">
                      <b>{loopPhaseLabel(record.phase)}</b>
                      <span>{record.atMS ? fmtTime(record.atMS) : ct('刚刚', 'Just now')}</span>
                      <span>{ct(`第 ${record.round} 轮`, `Round ${record.round}`)}</span>
                    </div>
                    <p>{record.summary}</p>
                    {record.prompt && <div className="oa-loop-record-prompt"><span>{ct('下一步', 'Next step')}</span><strong>{record.prompt}</strong></div>}
                  </div>
                </article>)}
              </div> : <div className="oa-loop-records-empty">{ct('尚无监察记录', 'No observer activity yet')}</div>}
            </section>
            <button
              className={`oa-loop-toggle ${loopState?.enabled ? 'is-active' : ''}`}
              type="button"
              onClick={() => loopState?.enabled ? stopLoop() : setLoopConfigOpen(open => !open)}
              disabled={loopUpdating}
              aria-expanded={!loopState?.enabled ? loopConfigOpen : undefined}
              aria-controls={!loopState?.enabled ? 'oa-loop-config' : undefined}
            >
              {loopState?.enabled ? <Square size={13}/> : <Orbit size={14}/>}
              <span>{loopState?.enabled ? (loopUpdating ? ct('停止中…', 'Stopping…') : ct('停止 Loop', 'Stop Loop')) : (loopConfigOpen ? ct('收起设置', 'Hide settings') : ct('配置 Loop', 'Configure Loop'))}</span>
            </button>
            {loopConfigOpen && !loopState?.enabled && <div className="oa-loop-config" id="oa-loop-config" role="group" aria-label={ct('Loop 设置', 'Loop settings')}>
              <label>
                <span>{ct('目标', 'Objective')}</span>
                <textarea value={loopObjective} onChange={e => setLoopObjective(e.target.value)} placeholder={prompt.trim() || ct('描述 Loop 应持续完成的目标', 'Describe the objective Loop should keep pursuing')} rows={3}/>
              </label>
              <label>
                <span>{ct('控制模型', 'Controller model')}</span>
                <CustomSelect
                  value={loopControllerLlmNo ?? llmNo}
                  onChange={value => setLoopControllerLlmNo(Number(value))}
                  disabled={!llms.length}
                  ariaLabel={ct('Loop 控制模型', 'Loop controller model')}
                  options={llms.map(model => ({ value:model.index, label:`${runtimeModelGroup(model).label} / ${runtimeModelLabel(model)}` }))}
                />
              </label>
              <label>
                <span>{ct('最大轮数', 'Maximum rounds')}</span>
                <input type="number" min="0" max="10000" step="1" value={loopMaxRounds} onChange={e => setLoopMaxRounds(e.target.value)} />
                <small>{ct('0 表示不限；重试不占用新轮次', '0 means unlimited; retries do not count as new rounds')}</small>
              </label>
              <label>
                <span>{ct('单轮内重试次数', 'Retries per round')}</span>
                <input type="number" min="0" max="100" step="1" value={loopMaxRetries} onChange={e => setLoopMaxRetries(e.target.value)} />
                <small>{ct('0 表示不重试；执行与控制模型各自适用此上限', '0 disables retries; worker and controller each use this limit')}</small>
              </label>
              <div className="oa-loop-config-actions">
                <small>{ct('留空目标时使用当前输入内容', 'Uses the current message when objective is empty')}</small>
                <button type="button" onClick={startLoop} disabled={loopUpdating || !(loopObjective.trim() || prompt.trim())}>{loopUpdating ? ct('启动中…', 'Starting…') : ct('启动 Loop', 'Start Loop')}</button>
              </div>
            </div>}
          </section>
        </aside>}
        {btwRailOpen && btwMessages.length > 0 && <aside className="oa-btw-rail" id="oa-btw-rail" aria-label={ct('侧问', 'Side questions')}>
          <header>
            <div className="oa-btw-title"><span>BTW</span><b>{ct('侧问', 'Side questions')}</b><em>{btwMessages.length}</em></div>
            <button type="button" className="oa-btw-toggle" onClick={()=>setBtwRailOpen(false)} aria-expanded="true" aria-controls="oa-btw-rail" title={ct('收起侧问栏', 'Collapse side-question rail')}><ChevronRight size={15}/><span>{ct('收起', 'Collapse')}</span></button>
          </header>
          <div className="oa-btw-rail-list" id="oa-btw-rail-list">
            {btwMessages.map(message => <ChatMessage
              key={message.id}
              message={message}
              pending={false}
              onRetryBTW={()=>sendBTW(`/btw ${message.side_question}`, activeSidRef.current, message.id)}
              clockNow={streamClock}
            />)}
          </div>
        </aside>}
        {btwMessages.length > 0 && !btwRailOpen && <div className="oa-rail-launchers" aria-label={ct('已收起的右侧栏', 'Collapsed right rails')}>
          <button type="button" className="oa-btw-collapsed oa-btw-only-collapsed" onClick={()=>setBtwRailOpen(true)} aria-expanded="false" aria-controls="oa-btw-rail" title={ct('展开侧问栏', 'Expand side-question rail')}>
            <MessageSquarePlus size={15}/><span>BTW</span><b>{btwMessages.length}</b>
          </button>
        </div>}
      </div>

      <footer className="oa-composer-wrap" ref={composerWrapRef}>
        <PlanTodoCard plan={planState}/>
        {queuedMessages.length > 0 && <div className={`oa-queue-dock ${isCurrentRunning ? 'is-running' : 'is-idle'}`} aria-label={ct('待发送队列', 'Send queue')}>
          <div className="oa-queue-guide-hint">
            <Sparkles className="oa-queue-guide-icon" size={14} aria-hidden="true"/>
            <span className="oa-queue-guide-copy"><b>待发送</b><small>{isCurrentRunning ? '回复进行中，可接管任意一条立即发送' : '回复结束后将按顺序发送'}</small></span>
            <span className="oa-queue-count" aria-label={`${queuedMessages.length} 条待发送消息`}>{queuedMessages.length} 条</span>
            <button type="button" className="oa-queue-action oa-queue-toggle" onClick={() => setQueueCollapsed(value => !value)} aria-expanded={!queueCollapsed} aria-controls="oa-queue-list" aria-label={queueCollapsed ? ct('展开待发送队列', 'Expand send queue') : ct('收起待发送队列', 'Collapse send queue')} title={queueCollapsed ? ct('展开待发送队列', 'Expand send queue') : ct('收起待发送队列', 'Collapse send queue')}>{queueCollapsed ? <ChevronRight size={16}/> : <ChevronDown size={16}/>}</button>
          </div>
          <div id="oa-queue-list" className="oa-queue-list" hidden={queueCollapsed}>
          {queuedMessages.map((q, i) => {
            const isEditingQueue = queueEditingId === q.id
            const isGuidingQueue = guidingQueueId === q.id
            return <div key={q.id} className={`oa-queued-item ${isEditingQueue ? 'is-editing' : ''} ${isGuidingQueue ? 'is-guiding' : ''}`}>
              <span className="oa-queue-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <div className="oa-queue-content" title={isEditingQueue ? '' : (q.text || ct('请处理这些附件', 'Please process these attachments'))}>
                {isEditingQueue ? <textarea className="oa-queue-edit-input" value={queueDraft} autoFocus rows={2} onChange={e=>setQueueDraft(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter' && (e.ctrlKey || e.metaKey)) saveQueueEdit(q.id); if(e.key==='Escape') cancelQueueEdit() }} /> : <>
                  <b>{q.text || ct('请处理这些附件', 'Please process these attachments')}</b>
                  {q.files?.length ? <em>{ct(`${q.files.length} 个附件`, `${q.files.length} attachments`)}</em> : null}
                </>}
              </div>
              <div className="oa-queue-actions">
                {isEditingQueue ? <>
                  <button className="oa-queue-action is-confirm" type="button" onClick={()=>saveQueueEdit(q.id)} title={ct('保存队列消息', 'Save queued message')} aria-label={ct('保存队列消息', 'Save queued message')}><Check size={14}/></button>
                  <button className="oa-queue-action" type="button" onClick={cancelQueueEdit} title={ct('取消编辑', 'Cancel editing')} aria-label={ct('取消编辑', 'Cancel editing')}><X size={14}/></button>
                </> : <>
                  <button className="oa-guide-btn" type="button" onClick={()=>guideQueuedItem(q.id)} disabled={!isCurrentRunning || Boolean(guidingQueueId)} title={isGuidingQueue ? '正在中止当前回复并发送这条消息' : (isCurrentRunning ? `暂停当前输出，立即发送消息${i + 1}` : '回复结束后会自动发送')}><Sparkles size={14}/>{isGuidingQueue ? '接管中…' : '引导发送'}</button>
                  <button className="oa-queue-action is-danger" type="button" onClick={()=>removeQueued(q.id)} title={ct('删除这条队列消息', 'Delete this queued message')} aria-label={ct('删除这条队列消息', 'Delete this queued message')}><Trash2 size={14}/></button>
                  <button className="oa-queue-action" type="button" onClick={()=>editQueued(q.id)} title={ct('编辑这条队列消息', 'Edit this queued message')} aria-label={ct('编辑这条队列消息', 'Edit this queued message')}><Edit3 size={14}/></button>
                </>}
              </div>
            </div>
          })}
          </div>
        </div>}
        {cmdDrawer.open && <div className="oa-cmd-drawer" ref={cmdDrawerRef}>
          {filteredCmds.length === 0 && <div className="oa-cmd-item" style={{color:'var(--text-secondary)',justifyContent:'center',cursor:'default',padding:'12px 14px'}}>{ct('无匹配命令', 'No matching commands')}</div>}
          {filteredCmds.map((c,i)=>{
            return (
              <div key={c.cmd+i} ref={i===cmdDrawer.selectedIdx ? selectedCmdRef : null} className={`oa-cmd-item${i===cmdDrawer.selectedIdx?' selected':''}`} onMouseEnter={() => setCmdDrawer(d => ({ ...d, selectedIdx: i }))} onMouseDown={e=>{e.preventDefault();applySlashCommand(c,promptRef.current?.value ?? prompt)}}>
                <span className="oa-cmd-name">{c.cmd}</span>
                <span className="oa-cmd-desc">{c.desc}</span>
              </div>
            )
          })}
        </div>}
        <ChatKeychainDialog open={keychainOpen} onClose={() => setKeychainOpen(false)} returnFocusRef={composerActionsTriggerRef}/>
        {cmdManagerOpen && createPortal(
          <div className="oa-cmd-manager-backdrop" onMouseDown={()=>setCmdManagerOpen(false)}>
          <div className="oa-cmd-manager" role="dialog" aria-modal="true" aria-label={ct('自定义斜杠命令', 'Custom slash commands')} onMouseDown={e=>e.stopPropagation()}>
            <div className="oa-cmd-manager-head">
              <div><h3>{ct('自定义斜杠命令', 'Custom slash commands')}</h3><p>{ct('官方命令只读锁定；用户命令可新增、编辑、删除。', 'Official commands are read-only; custom commands can be added, edited, and deleted.')}</p></div>
              <button className="oa-icon-btn" type="button" onClick={()=>setCmdManagerOpen(false)} title={ct('关闭', 'Close')}><X size={16}/></button>
            </div>
            <div className="oa-cmd-manager-actions">
              <button className="oa-guide-btn" type="button" onClick={()=>startEdit(-2, '/', '', '')}><Plus size={14}/>{ct('新增自定义命令', 'Add custom command')}</button>
              <span>{ct(`${(cfg?.slash_commands || []).filter(c => !isProtectedSlashCommand(c?.cmd)).length} 个自定义 · ${effectiveSlashCommands.length} 个官方`, `${(cfg?.slash_commands || []).filter(c => !isProtectedSlashCommand(c?.cmd)).length} custom · ${effectiveSlashCommands.length} official`)}</span>
            </div>
            {cmdEditIdx !== -1 && <div className="oa-cmd-edit-card">
              <input value={cmdEditCmd} onChange={e=>setCmdEditCmd(e.target.value)} placeholder={ct('命令，例如 /hello', 'Command, for example /hello')} autoFocus />
              <input value={cmdEditDesc} onChange={e=>setCmdEditDesc(e.target.value)} placeholder={ct('描述，例如 代码审查模板', 'Description, for example Code review template')} />
              <textarea value={cmdEditContent} onChange={e=>setCmdEditContent(e.target.value)} placeholder={ct('发送时展开成的指令内容。可用 {args} 插入 /命令 后面的参数。', 'Instruction content expanded on send. Use {args} for arguments after /command.')} rows={4}/>
              <button type="button" onClick={saveEdit}>{ct('保存', 'Save')}</button>
              <button type="button" onClick={()=>setCmdEditIdx(-1)}>{ct('取消', 'Cancel')}</button>
            </div>}
            <div className="oa-cmd-manager-list">
              <div className="oa-cmd-section-title">{ct('用户自定义', 'Custom')}</div>
              {(cfg?.slash_commands || []).filter(c => !isProtectedSlashCommand(c?.cmd)).length === 0 && <div className="oa-cmd-empty">{ct('暂无自定义命令，点击上方新增。', 'No custom commands. Use the button above to add one.')}</div>}
              {(cfg?.slash_commands || []).map((c, i) => {
                if (isProtectedSlashCommand(c?.cmd)) return null
                return <div className="oa-cmd-manage-row" key={`${c.cmd}-${i}`}>
                  <div><b>{c.cmd}</b><small>{c.desc || ct('无描述', 'No description')}</small>{(c.content || c.prompt) && <em>{c.content || c.prompt}</em>}</div>
                  <button type="button" onClick={()=>startEdit(i, c.cmd || '/', c.desc || '', c.content || c.prompt || '')}><Edit3 size={14}/>{ct('编辑', 'Edit')}</button>
                  <button type="button" onClick={()=>deleteCmd(i)}><Trash2 size={14}/>{ct('删除', 'Delete')}</button>
                </div>
              })}
              <div className="oa-cmd-section-title">{ct('官方命令', 'Official commands')}</div>
              {effectiveSlashCommands.map((c, i) => <div className="oa-cmd-manage-row is-locked" key={`${c.cmd}-${i}`}>
                <div><b>{c.cmd}</b><small>{c.desc || ct('官方命令', 'Official command')}</small></div>
                <span><Lock size={13}/>{ct('只读', 'Read-only')}</span>
              </div>)}
            </div>
          </div>
          </div>,
          document.body,
        )}
        {extraPromptOpen && createPortal(
          <div className="oa-cmd-manager-backdrop" onMouseDown={()=>setExtraPromptOpen(false)}>
          <div className={`oa-cmd-manager oa-prompt-preset-dialog ${promptPresetManagerOpen ? 'is-managing' : 'is-picking'}`} role="dialog" aria-modal="true" aria-label={ct('系统提示预设', 'System-prompt presets')} onMouseDown={e=>e.stopPropagation()}>
            <div className="oa-cmd-manager-head">
              <div>
                <h3>{promptPresetManagerOpen ? ct('管理系统提示预设', 'Manage system-prompt presets') : ct('选择系统提示预设', 'Choose a system-prompt preset')}</h3>
                <p>{promptPresetManagerOpen ? ct('预设全局可用；已绑定会话会保留选择时的内容快照。', 'Presets are global; bound sessions keep a snapshot of the selected content.') : ct('每个会话可启用一个预设，运行 Agent 时动态追加。', 'Each session can enable one preset that is appended when the agent runs.')}</p>
              </div>
              <button className="oa-icon-btn" type="button" onClick={()=>setExtraPromptOpen(false)} title={ct('关闭', 'Close')}><X size={16}/></button>
            </div>
            {promptPresetManagerOpen ? <>
              <div className="oa-cmd-manager-actions">
                <button className="oa-guide-btn" type="button" onClick={()=>setExtraPromptDraft(items => [...items, createPromptPreset(items)])}><Plus size={14}/>{ct('新增预设', 'Add preset')}</button>
                <span>{ct(`${extraPromptDraft.length} 个预设`, `${extraPromptDraft.length} presets`)}</span>
              </div>
              <div className="oa-cmd-manager-list oa-prompt-preset-editor-list">
                {extraPromptDraft.length === 0 && <div className="oa-cmd-empty">{ct('暂无预设。新增后填写名称和提示内容。', 'No presets yet. Add one, then enter its name and prompt content.')}</div>}
                {extraPromptDraft.map((item, index) => <div className="oa-cmd-edit-card oa-prompt-preset-edit-card" key={item.id}>
                  <div className="oa-prompt-preset-edit-head">
                    <input value={item.name} onChange={e=>updateExtraPromptDraft(item.id, 'name', e.target.value)} placeholder={`${ct('预设名称', 'Preset name')} ${index + 1}`} aria-label={`${ct('预设名称', 'Preset name')} ${index + 1}`}/>
                    <code title={ct('稳定预设 ID', 'Stable preset ID')}>{item.id}</code>
                  </div>
                  <textarea value={item.content} onChange={e=>updateExtraPromptDraft(item.id, 'content', e.target.value)} placeholder={ct('输入追加到 Agent 系统提示中的内容', 'Enter content to append to the agent system prompt')} rows={5}/>
                  <button type="button" onClick={()=>setExtraPromptDraft(items => items.filter(preset => preset.id !== item.id))}><Trash2 size={14}/>{ct('删除', 'Delete')}</button>
                </div>)}
              </div>
              <div className="oa-cmd-manager-actions oa-prompt-preset-footer">
                <button className="oa-guide-btn" type="button" onClick={savePromptPresets} disabled={extraPromptSaving}>{extraPromptSaving ? ct('保存中…', 'Saving…') : ct('保存全局预设', 'Save global presets')}</button>
                <button type="button" onClick={()=>setPromptPresetManagerOpen(false)} disabled={extraPromptSaving}><ChevronLeft size={14}/>{ct('返回选择', 'Back to selection')}</button>
              </div>
            </> : <>
              <div className="oa-cmd-manager-actions">
                <span>{ct(`${promptPresets.length} 个可用预设`, `${promptPresets.length} presets available`)}</span>
                <button type="button" onClick={openPromptPresetManager}><Edit3 size={14}/>{ct('管理预设', 'Manage presets')}</button>
              </div>
              <div className="oa-cmd-manager-list oa-prompt-preset-picker" role="radiogroup" aria-label={ct('当前会话系统提示预设', 'Current session system-prompt preset')}>
                <label className={`oa-prompt-preset-option ${extraPromptSelection === '' ? 'is-selected' : ''}`}>
                  <input type="radio" name="extra-system-prompt-preset" value="" checked={extraPromptSelection === ''} onChange={()=>selectExtraPromptPreset('')}/>
                  <span className="oa-prompt-preset-radio"><Check size={13}/></span>
                  <span className="oa-prompt-preset-copy"><b>{ct('不使用预设', 'Do not use a preset')}</b><small>{ct('仅使用 Agent 默认系统提示', 'Use only the default agent system prompt')}</small></span>
                </label>
                {activePromptPreset.orphaned && <label className={`oa-prompt-preset-option is-orphaned ${extraPromptSelection === activePromptPreset.id ? 'is-selected' : ''}`}>
                  <input type="radio" name="extra-system-prompt-preset" value={activePromptPreset.id} checked={extraPromptSelection === activePromptPreset.id} onChange={()=>selectExtraPromptPreset(activePromptPreset.id)}/>
                  <span className="oa-prompt-preset-radio"><Check size={13}/></span>
                  <span className="oa-prompt-preset-copy"><b>{ct('已删除的预设', 'Deleted preset')}</b><small>{activePromptPreset.content || ct('当前会话仍保留原内容快照', 'This session still retains the original content snapshot')}</small></span>
                  <em>{ct('快照', 'Snapshot')}</em>
                </label>}
                {promptPresets.map(item => <label className={`oa-prompt-preset-option ${extraPromptSelection === item.id ? 'is-selected' : ''}`} key={item.id}>
                  <input type="radio" name="extra-system-prompt-preset" value={item.id} checked={extraPromptSelection === item.id} onChange={()=>selectExtraPromptPreset(item.id)}/>
                  <span className="oa-prompt-preset-radio"><Check size={13}/></span>
                  <span className="oa-prompt-preset-copy"><b>{item.name}</b><small>{item.content}</small></span>
                </label>)}
                {promptPresets.length === 0 && !activePromptPreset.orphaned && <div className="oa-cmd-empty">{ct('还没有预设。先进入“管理预设”新建一个。', 'No presets yet. Open Manage presets to create one.')}</div>}
              </div>
              <div className="oa-cmd-manager-actions oa-prompt-preset-footer">
                <button className="oa-guide-btn" type="button" onClick={saveExtraPromptSelection} disabled={extraPromptSaving}>{extraPromptSaving ? ct('应用中…', 'Applying…') : ct('应用到当前会话', 'Apply to current session')}</button>
                <button type="button" onClick={()=>setExtraPromptOpen(false)} disabled={extraPromptSaving}>{ct('取消', 'Cancel')}</button>
              </div>
            </>}
          </div>
          </div>,
          document.body,
        )}
        <UiSurface name="chat.composer" preserveMount viewProps={{ ComposerActions, CopyButton, PendingAttachments, ProviderModelCascade, REASONING_EFFORT_OPTIONS, activePromptPreset, activeSessionDetail, activeSidRef, addAttachmentFiles, applyComposerHeight, attachments, autorunEnabled, beginComposerResize, cancelRun, cmdManagerOpen, composerActionsTriggerRef, composerDragHeight, composerManualHeightRef, conductorEnabling, ct, defaultReasoningLabel, depsRepairing, dragging, extraPromptOpen, extraSysPromptPresetID, fileRef, finishComposerResize, handlePromptChange, handlePromptKeyDown, installChatPythonDeps, isConductorParent, isConductorWorker, isCurrentRunning, isUltraPlanPrompt, keychainOpen, loadChatState, loopRailOpen, modelDiagnosis, modelDiagnosisAdvice, modelDiagnosisTitle, moveComposerResize, onDropFiles, onPaste, openExtraPromptEditor, prompt, promptRef, providerGroups, queuedMessages, reasoningEffort, removeAttachment, saveModel, saveReasoningEffort, selectedModelNo, selectedProvider, send, sessionLoadFailed, sessionLoading, setCmdManagerOpen, setDragging, setErr, setKeychainOpen, setLoopRailOpen, sid, toggleAutorun, upgradeToConductor }}/>
        <ChatStats messages={historyStatsMessages(historyPages.page?.stats_messages, messages)} now={streamClock} running={isCurrentRunning}/>
      </footer>
    </main>

    {worldlineRestorePicker && worldlineRestorePicker.sessionID === sid && <WorldlineRestoreDialog nodes={worldlineRestorePicker.nodes} onClose={()=>setWorldlineRestorePicker(null)} onSelect={selectWorldlineRestoreNode}/>}
    {sessionManagerOpen && <div className="oa-session-manager-backdrop" onMouseDown={e=>{ if (e.target === e.currentTarget) closeSessionManager() }}>
      <section className="oa-session-manager-modal" role="dialog" aria-modal="true" aria-labelledby="oa-session-manager-dialog-title" onMouseDown={e=>e.stopPropagation()}>
        <header className="oa-session-manager-dialog-head">
          <div className="oa-session-manager-dialog-heading">
            <h2 id="oa-session-manager-dialog-title">管理历史会话</h2>
            <p>批量删除不再需要的会话</p>
          </div>
          <button className="oa-icon-btn oa-session-manager-dialog-close" type="button" onClick={closeSessionManager} disabled={batchDeleting} aria-label={ct('关闭会话管理', 'Close session manager')} autoFocus><X size={17}/></button>
        </header>
        <div className="oa-session-manager-dialog-tools">
          <div className="oa-session-manager-filter" role="group" aria-label={ct('会话筛选', 'Session filter')}>
            <button type="button" className={sessionManagerView === 'project' ? 'is-active' : ''} onClick={()=>setSessionManagerView('project')} disabled={batchDeleting}>{ct('项目', 'Project')}<small>{sessions.length}</small></button>
            <button type="button" className={sessionManagerView === 'time' ? 'is-active' : ''} onClick={()=>setSessionManagerView('time')} disabled={batchDeleting}>{ct('时间', 'Time')}<small>{sessions.length}</small></button>
            <button type="button" className={sessionManagerView === 'hub' ? 'is-active' : ''} onClick={()=>setSessionManagerView('hub')} disabled={batchDeleting}>Hub<small>{managedHubSessions.length}</small></button>
          </div>
          <button className="oa-session-select-all" type="button" role="checkbox" aria-checked={allSessionsSelected ? true : (visibleSelectedSessionCount ? 'mixed' : false)} onClick={toggleAllSessions} disabled={!managedSessions.length || batchDeleting}>
            <span className={`oa-session-check ${allSessionsSelected ? 'is-checked' : ''} ${!allSessionsSelected && visibleSelectedSessionCount ? 'is-partial' : ''}`}>{allSessionsSelected && <Check size={12}/>}</span>
            <span>{allSessionsSelected ? ct('取消全选', 'Clear selection') : ct('全选', 'Select all')}</span>
          </button>
          <span className="oa-session-selected-count">{ct('已选', 'Selected')} {visibleSelectedSessionCount} / {managedSessions.length}</span>
        </div>
        <div className="oa-session-manager-dialog-list">
          {(() => {
            
            // 公共会话行渲染函数
            const renderSessionRow = (s) => {
              const selected = selectedSessionIdSet.has(s.id)
              const hubUpdating = hubUpdatingSessionId === s.id
              const sourceLabel = s.title_source === 'objective' ? ct('任务目标', 'Task goal') : s.title_source === 'generated' ? 'AI' : s.title_source === 'manual' ? '手动' : '旧标题'
              return <div key={s.id} className={`oa-session-manager-dialog-row ${selected ? 'is-selected' : ''}`}>
                <button className="oa-session-manager-dialog-select" type="button" role="checkbox" aria-checked={selected} onClick={()=>toggleSessionSelection(s.id)} disabled={batchDeleting || Boolean(hubUpdatingSessionId)}>
                  <span className={`oa-session-check ${selected ? 'is-checked' : ''}`}>{selected && <Check size={12}/>}</span>
                  <span className="oa-session-dialog-copy">
                    <span className="oa-session-dialog-title">{s.running && <i className="oa-session-running-dot" aria-hidden="true"/>}<b>{shortTitle(s)}</b><SessionAutorunBadge enabled={Boolean(s.autorun?.enabled)} sessionId={s.id} targetSessionId={s.id}/>{s.hub_enabled && <em className="oa-session-hub-badge">Hub</em>}{draftSessionIds.has(s.id) && <em className="oa-session-draft-badge">{ct('草稿', 'Draft')}</em>}{s.id === sid && <em>当前</em>}<em className={`is-title-source is-${s.title_source || 'legacy'}`}>{sourceLabel}</em></span>
                    <small><Clock3 size={12}/>{fmtTime(s.updated_at) || ct('刚刚', 'Just now')} · {s.count || 0} 条{waitingSessionIds.has(s.id) ? <span className="oa-session-waiting-label"><CircleAlert size={12} aria-hidden="true"/>{ct('\u5f85\u56de\u590d', 'Waiting')}</span> : s.running ? <span>运行中</span> : chatReadState.unread(s) && <span className="oa-session-unread-label">{ct('未读', 'Unread')}</span>}</small>
                  </span>
                </button>
                <button className={`oa-session-dialog-hub-action ${s.hub_enabled ? 'is-leave' : ''}`} type="button" onClick={()=>setSessionHubEnabled(s)} disabled={batchDeleting || Boolean(hubUpdatingSessionId)} aria-label={s.hub_enabled ? ct(`退出 Hub：${shortTitle(s)}`, `Leave Hub: ${shortTitle(s)}`) : ct(`入驻 Hub：${shortTitle(s)}`, `Join Hub: ${shortTitle(s)}`)}>
                  <Bot size={13}/><span>{hubUpdating ? ct('处理中…', 'Updating…') : s.hub_enabled ? ct('退出 Hub', 'Leave Hub') : ct('入驻 Hub', 'Join Hub')}</span>
                </button>
              </div>
            }
            
            const groups = sessionManagerView === 'time'
              ? managedRecentGroups.map(group => ({ key: group.key, label: managedSessionGroupLabels[group.key], sessions: group.sessions }))
              : managedProjectGroups.map(group => ({ key: group.key || group.name, label: group.name, sessions: group.sessions }))
            return groups.map(group => {
              const key = `${sessionManagerView}:${group.key}`
              return <SessionManagerGroup key={key} label={group.label} items={group.sessions}
                selectedIds={selectedSessionIdSet} collapsed={collapsedSessionGroups.has(key)}
                disabled={batchDeleting || Boolean(hubUpdatingSessionId)}
                onToggle={()=>toggleSessionGroup(key)} onSelect={()=>toggleSessionGroupSelection(group.sessions)}>
                {group.sessions.map(renderSessionRow)}
              </SessionManagerGroup>
            })
          })()}
          {!managedSessions.length && <div className="oa-session-manager-dialog-empty">{sessionManagerView === 'hub' ? ct('暂无会话入驻 Hub', 'No sessions have joined Hub') : ct('暂无历史会话', 'No session history')}</div>}
        </div>
        <footer className="oa-session-manager-dialog-foot">
          <small>{ct('删除后无法恢复', 'Deleted sessions cannot be recovered')}</small>
          <div>
            <button className="oa-session-dialog-cancel" type="button" onClick={closeSessionManager} disabled={batchDeleting}>{ct('取消', 'Cancel')}</button>
            <button className="oa-session-dialog-delete" type="button" onClick={deleteSelectedSessions} disabled={!selectedSessionCount || batchDeleting}>
              <Trash2 size={15}/><span>{batchDeleting ? ct('正在删除…', 'Deleting…') : ct(`删除所选${selectedSessionCount ? ` (${selectedSessionCount})` : ''}`, `Delete selected${selectedSessionCount ? ` (${selectedSessionCount})` : ''}`)}</span>
            </button>
          </div>
        </footer>
      </section>
    </div>}
  </div>
}
