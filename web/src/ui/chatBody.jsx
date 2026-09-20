import React from 'react'
import { Bot, CheckCheck, ChevronDown, ChevronUp, CircleHelp, Download, Edit3, FolderOpen, FolderPlus, Loader2, MessageSquarePlus, PanelLeftClose, Pin, Plus, RotateCw, Search, Send, Settings, Sparkles, Square, Trash2, X } from 'lucide-react'
import './chatBody.css'
import { useChatLayout } from './plugins/runtime'

// Stateless views; ChatApp owns all data, drafts, refs, actions and subscriptions.
export function ChatSidebar({ layout = 'default', ProjectActionsMenu, batchDeleting, chatInstanceID, chatInstances, chatInstancesLoading, chatReadState, closeProjectDraft, collapsed, conductorsExpanded, createProject, ct, deleteSession, historyExpanded, menuOpen, menuPos, menuRef, newConductorSession, newSession, onOpenSettings, openProjectDraft, openSessionManager, pinnedExpanded, pinnedProjectGroups, pinnedSessions, projectCreating, projectDraftName, projectDraftOpen, projectOrderSaving, projectSessionGroups, projectSortMode, projectsExpanded, recentSessions, regularProjectGroups, renderSidebarProject, renderSidebarTree, sessionManagerOpen, sessions, setCollapsed, setConductorsExpanded, setHistoryExpanded, setPinnedExpanded, setProjectDraftName, setProjectSortMode, setProjectsExpanded, setSessionHubEnabled, setSessionPinned, setShowAllProjects, setSidebarSearch, showAllProjects, sidebarPreferenceMenu, sidebarPreferences, sidebarSearch, sidebarSections, startRename, switchChatInstance }) {
  const externalLayout = useChatLayout('chat.sidebar')
  return (<aside data-ui-surface="chat.sidebar" {...externalLayout} data-ui-layout={layout} className={`oa-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="oa-side-head">
        <div className="oa-sidebar-brand">GenericAgent <span>Admin</span></div>
        <button
          className="oa-new-chat"
          onClick={newSession}
          disabled={batchDeleting}
          title={ct('新对话', 'New chat')}
          aria-label={ct('新对话', 'New chat')}
        ><MessageSquarePlus size={16}/><span>{ct('新对话', 'New chat')}</span></button>
        <button className="oa-icon-btn" onClick={()=>setCollapsed(true)} title={ct('收起侧栏', 'Collapse sidebar')} aria-label={ct('收起侧栏', 'Collapse sidebar')}><PanelLeftClose size={18} aria-hidden="true"/></button>
      </div>
      <div className="oa-sidebar-sections">
        <div className="oa-sidebar-scroll-tools">
        {sidebarSections.conductors.length === 0 && <button
          className="oa-icon-btn oa-new-conductor"
          onClick={newConductorSession}
          disabled={batchDeleting}
          title={ct('新建 Conductor', 'New Conductor')}
          aria-label={ct('新建 Conductor', 'New Conductor')}
        ><span className="oa-conductor-new-mark" aria-hidden="true">C</span><span>Conductor</span></button>}
        <div className="oa-sidebar-search">
          <Search size={15}/>
          <input
            type="text"
            placeholder={ct('搜索会话...', 'Search sessions...')}
            value={sidebarSearch}
            onChange={(e)=>setSidebarSearch(e.target.value)}
            aria-label={ct('搜索会话', 'Search sessions')}
          />
          {sidebarSearch && <button className="oa-search-clear" onClick={()=>setSidebarSearch('')} aria-label={ct('清除搜索', 'Clear search')}><X size={14}/></button>}
        </div>
        </div>
        {(pinnedSessions.length > 0 || pinnedProjectGroups.length > 0) && <section className="oa-sidebar-section oa-sidebar-pinned">
          <div className="oa-sidebar-section-head">
            <button type="button" className="oa-sidebar-section-toggle" aria-expanded={pinnedExpanded} aria-controls="oa-sidebar-pinned-body" onClick={()=>setPinnedExpanded(value => !value)}>
              <span aria-hidden="true">{pinnedExpanded ? '\u2304' : '\u203a'}</span>{ct('置顶', 'Pinned')}
            </button>
            <div className="oa-sidebar-view-actions">
              <ProjectActionsMenu label={ct('置顶更多', 'More pinned options')}>{sidebarPreferenceMenu}</ProjectActionsMenu>
            </div>
          </div>
          <div id="oa-sidebar-pinned-body" hidden={!pinnedExpanded}>
            <div className="oa-session-list">{pinnedSessions.map(renderSidebarTree)}</div>
            <div className="oa-session-list oa-project-list">{pinnedProjectGroups.map(renderSidebarProject)}</div>
          </div>
        </section>}
        {sidebarSections.conductors.length > 0 && <section className="oa-sidebar-section oa-sidebar-conductors">
          <div className="oa-sidebar-section-head">
            <button type="button" className="oa-sidebar-section-toggle" aria-expanded={conductorsExpanded} aria-controls="oa-sidebar-conductors-body" onClick={()=>setConductorsExpanded(value => !value)}>
              <span aria-hidden="true">{conductorsExpanded ? '\u2304' : '\u203a'}</span>{ct('指挥家', 'Conductors')}
            </button>
            <div className="oa-sidebar-view-actions">
              <ProjectActionsMenu label={ct('指挥家更多', 'More conductor options')}>{sidebarPreferenceMenu}</ProjectActionsMenu>
              <button type="button" className="oa-session-manage-open" onClick={newConductorSession} disabled={batchDeleting} title={ct('新建指挥家', 'New Conductor')} aria-label={ct('新建指挥家', 'New Conductor')}><Plus size={16} aria-hidden="true"/></button>
            </div>
          </div>
          <div id="oa-sidebar-conductors-body" hidden={!conductorsExpanded}>
            <div className="oa-session-list">{sidebarSections.conductors.map(renderSidebarTree)}</div>
          </div>
        </section>}
        <section className="oa-sidebar-section" hidden={!sidebarPreferences.showProjects}>
          <div className="oa-sidebar-section-head">
          <button type="button" className="oa-sidebar-section-toggle" aria-expanded={projectsExpanded} aria-controls="oa-sidebar-projects-body" onClick={()=>setProjectsExpanded(value => !value)}>
            <span aria-hidden="true">{projectsExpanded ? '\u2304' : '\u203a'}</span>{ct('项目', 'Projects')}
          </button>
          <div className="oa-sidebar-view-actions">
            <ProjectActionsMenu label={ct('项目更多', 'More project options')}>
              {sidebarPreferenceMenu}
            <button className="oa-session-manage-open" type="button" aria-pressed={projectSortMode} aria-label={ct('项目排序', 'Sort projects')}
              onClick={()=>setProjectSortMode(current => !current)} disabled={batchDeleting || projectOrderSaving || (!projectSortMode && projectSessionGroups.length < 2)}
              title={ct('开启后长按项目手柄拖动，顺序自动保存', 'Enable, then hold a project handle to drag. Order saves automatically.')}>
              {projectSortMode ? ct('完成项目排序', 'Finish sorting projects') : ct('项目排序', 'Sort projects')}
            </button>
            </ProjectActionsMenu>
            <button className="oa-session-manage-open" type="button" onClick={()=>{ setProjectsExpanded(true); openProjectDraft() }} disabled={projectCreating || projectDraftOpen} title={ct("\u65b0\u5efa\u9879\u76ee", "New project")} aria-label={ct("\u65b0\u5efa\u9879\u76ee", "New project")}>
              <Plus size={16}/>
            </button>
          </div>
          </div>
          <div id="oa-sidebar-projects-body" hidden={!projectsExpanded}>
        {projectDraftOpen && <form className="oa-project-draft" onSubmit={e=>{ e.preventDefault(); createProject() }}>
          <input
            autoFocus
            type="text"
            value={projectDraftName}
            onChange={e=>setProjectDraftName(e.target.value)}
            onKeyDown={e=>{ if (e.key === 'Escape') { e.preventDefault(); closeProjectDraft() } }}
            placeholder={ct('项目名，例如 alpha', 'Project name, e.g. alpha')}
            aria-label={ct('新项目名称', 'New project name')}
            disabled={projectCreating}
          />
          <button className="oa-project-draft-save" type="submit" disabled={projectCreating || !projectDraftName.trim()}>{projectCreating ? ct('创建中…', 'Creating…') : ct('创建', 'Create')}</button>
          <button type="button" onClick={closeProjectDraft} disabled={projectCreating}>{ct('取消', 'Cancel')}</button>
        </form>}
        <div className="oa-session-list oa-project-list">
        {(showAllProjects || sidebarSearch || projectSortMode ? regularProjectGroups : regularProjectGroups.slice(0, 5)).map(renderSidebarProject)}
        {!sidebarSearch && !projectSortMode && regularProjectGroups.length > 5 && <button type="button" className="oa-project-show-more" aria-expanded={showAllProjects} onClick={()=>setShowAllProjects(value => !value)}><span aria-hidden="true" style={{ display: 'inline-flex', transform: showAllProjects ? 'rotate(180deg)' : undefined }}><ChevronDown size={12}/></span>{showAllProjects ? ct('收起更多项目', 'Show fewer projects') : ct(`展开其余 ${regularProjectGroups.length - 5} 个项目`, `Show ${regularProjectGroups.length - 5} more projects`)}</button>}
        {!regularProjectGroups.length && <div className="oa-empty-list oa-projects-empty">
          <FolderOpen size={20}/>
          <span>{sidebarSearch ? ct('无匹配项目', 'No matching projects') : ct('暂无可用项目', 'No projects available')}</span>
          {!sidebarSearch && !projectDraftOpen && <button className="oa-projects-empty-cta" type="button" onClick={openProjectDraft} disabled={projectCreating}>
            <FolderPlus size={14}/>{ct('新建项目', 'New project')}
          </button>}
        </div>}
        </div>
          </div>
        </section>
        <section className="oa-sidebar-section">
          <div className="oa-sidebar-section-head">
          <button type="button" className="oa-sidebar-section-toggle" aria-expanded={historyExpanded} aria-controls="oa-sidebar-history-body" onClick={()=>setHistoryExpanded(value => !value)}>
            <span aria-hidden="true">{historyExpanded ? '\u2304' : '\u203a'}</span>{ct('最近', 'Recent')}
          </button>
          <div className="oa-sidebar-view-actions">
            <button
              type="button"
              className="oa-session-manage-open oa-mark-all-read"
              onClick={chatReadState.markAllRead}
              disabled={!chatReadState.hasUnread}
              title={ct('一键已读', 'Mark all as read')}
              aria-label={ct('一键已读', 'Mark all as read')}
            ><CheckCheck size={16}/></button>
            <ProjectActionsMenu label={ct('最近更多', 'More recent options')}>
              {sidebarPreferenceMenu}
              <button type="button" onClick={openSessionManager} disabled={!sessions.length}>{ct('管理会话', 'Manage sessions')}</button>
            </ProjectActionsMenu>
            <button type="button" className="oa-session-manage-open oa-recent-new-chat" onClick={newSession} disabled={batchDeleting} title={ct('新对话', 'New chat')} aria-label={ct('新对话', 'New chat')}><Plus size={16} aria-hidden="true"/></button>
          </div>
          </div>
          <div id="oa-sidebar-history-body" hidden={!historyExpanded}>
        <div className="oa-session-list">
          {recentSessions.map(renderSidebarTree)}
          {!recentSessions.length && <div className="oa-empty-list">{sidebarSearch ? ct('无匹配会话', 'No matching sessions') : ct('暂无历史会话', 'No session history')}</div>}
        </div>
          </div>
        </section>
      </div>
      {!sessionManagerOpen && menuOpen && menuPos && (() => {
        const s = sessions.find(x => x.id === menuOpen)
        if (!s) return null
        return <div ref={menuRef} className="oa-session-menu" style={{ top: menuPos.top, left: menuPos.left }} onClick={e=>e.stopPropagation()}>
          <button onClick={()=>startRename(s)}><Edit3 size={14}/>{ct('重命名', 'Rename')}</button>
          <button onClick={()=>setSessionPinned(s)}><Pin size={14}/>{s.pinned ? ct('\u53d6\u6d88\u7f6e\u9876', 'Unpin') : ct('\u7f6e\u9876', 'Pin')}</button>
          <button onClick={()=>setSessionHubEnabled(s)}><Bot size={14}/>{s.hub_enabled ? ct('退出 Hub', 'Leave Hub') : ct('入驻 Hub', 'Join Hub')}</button>
          <button className="danger" onClick={()=>deleteSession(s.id)}><Trash2 size={14}/>{ct('删除', 'Delete')}</button>
        </div>
      })()}
      <div className="oa-sidebar-foot">
        <label className="oa-sidebar-instance" title={ct('切换实例会更新当前侧栏中的会话', 'Switching instances updates the sessions in this sidebar')}>
          <span>{ct('GA 实例', 'GA instance')}</span>
          <select
            aria-label={ct('选择 GA 实例', 'Select GA instance')}
            value={chatInstanceID}
            onChange={event=>switchChatInstance(event.target.value)}
            disabled={chatInstancesLoading || !chatInstances.length}
          >
            {chatInstancesLoading && <option value={chatInstanceID}>{ct('加载实例…', 'Loading instances…')}</option>}
            {!chatInstancesLoading && !chatInstances.length && <option value="">{ct('默认实例', 'Default instance')}</option>}
            {chatInstances.map(instance => <option key={instance.id} value={instance.id} disabled={instance.initializing}>{instance.name}{instance.initializing ? ct('（初始化中）', ' (initializing)') : ''}</option>)}
          </select>
        </label>
        <button className="oa-sidebar-settings" onClick={()=>{ if (onOpenSettings) onOpenSettings(); else window.location.href = '/admin' }}><Settings size={15}/>{ct('设置', 'Settings')}</button>
      </div>
    </aside>)
}

export function ChatMessages({ layout = 'default', MessageList, activeSessionDetail, activeSidRef, conductorConflict, conductorParentID, ct, editAndResend, fillAskReply, historyPages, isConductorWorker, isCurrentRunning, isNearBottom, messages, openSession, pauseFollow, resumeFollow, sendBTW, sessionLoadFailed, sessionLoading, setConductorConflict, showFollow, sid, streamClock, switchWorldline, threadRef, updateFollowFromScroll, worldlineForView }) {
  const externalLayout = useChatLayout('chat.messages')
  return (<section data-ui-surface="chat.messages" {...externalLayout} data-ui-layout={layout} className="oa-thread" ref={threadRef} aria-busy={sessionLoading} onScroll={updateFollowFromScroll} onWheel={e=>{ if (e.deltaY < 0) pauseFollow() }} onTouchMove={()=>{ if (!isNearBottom(threadRef.current)) pauseFollow() }}>
          {isConductorWorker(activeSessionDetail) && conductorParentID(activeSessionDetail) && <button type="button" className="oa-conductor-back" onClick={()=>openSession(conductorParentID(activeSessionDetail))}>← {ct('返回 Conductor', 'Back to Conductor')}</button>}
          {activeSessionDetail?.conductor?.recovery && <div className="oa-banner" role="status">{ct('恢复待确认：本实例无法确认该任务是否仍在运行，保留原记录且不自动重跑。', 'Recovery pending confirmation: this instance cannot confirm whether the task is still running. Records are preserved without automatic replay.')}</div>}
          {sessionLoading && messages.length === 0 && <div className="oa-session-load" role="status" aria-live="polite">
            <RotateCw size={20} className="oa-session-load-spinner" aria-hidden="true"/>
            <span>{ct('对话加载中…', 'Loading conversation…')}</span>
          </div>}
          {conductorConflict?.parent_session_id === sid && <div className="oa-session-load" role="alert" style={{ flexWrap: 'wrap', overflowWrap: 'anywhere' }}>
            <span>{ct('切换前请先审查子任务；执行结束不代表已经核验。', 'Review the subtask before switching; execution finished does not mean verified.')} <code>{conductorConflict.dispatch_id}</code></span>
            <button type="button" onClick={() => openSession(conductorConflict.session_id)}>{ct('查看待审核任务', 'Open task awaiting review')}</button>
            <button type="button" onClick={() => setConductorConflict(null)}>{ct('关闭', 'Dismiss')}</button>
          </div>}
          {sessionLoadFailed && <div className="oa-session-load" role="alert">
            <span>{ct('对话加载失败', 'Could not load conversation')}</span>
            <button type="button" onClick={() => openSession(sid)}><RotateCw size={15}/>{ct('重试', 'Retry')}</button>
          </div>}
          {!sessionLoading && !sessionLoadFailed && messages.length === 0 && <div className="oa-empty">
            <h1>今天想让 GenericAgent 做什么？</h1>
            <p>支持 Markdown、代码块复制、图片输入、模型切换、会话重命名与删除。</p>
          </div>}
          {!sessionLoading && historyPages.page?.has_more && <button type="button" className="oa-history-load"
            disabled={historyPages.loading} onClick={historyPages.loadOlder}>
            {historyPages.loading ? <Loader2 size={15} className="oa-spin"/> : <ChevronUp size={15}/>}
            {historyPages.loading ? ct('加载中…', 'Loading…') : ct('加载更早消息', 'Load earlier messages')}
          </button>}
          {historyPages.error && <div className="oa-session-load" role="alert">{historyPages.error}</div>}
          <MessageList
            messages={messages}
            isCurrentRunning={isCurrentRunning}
            onAskReply={fillAskReply}
            onEditResend={editAndResend}
            onRetryBTW={(message)=>sendBTW(`/btw ${message.side_question}`, activeSidRef.current, message.id)}
            clockNow={streamClock}
            worldline={worldlineForView}
            conductorDetail={activeSessionDetail}
            onSwitchVersion={switchWorldline}
            sessionKey={sid}
          />
          {showFollow && <div className="oa-follow-row">
            {showFollow && <button className={`oa-follow-btn ${isCurrentRunning ? 'is-live' : ''}`} type="button" onClick={resumeFollow} title={isCurrentRunning ? ct('继续跟随', 'Resume following') : ct('回到最新', 'Jump to latest')} aria-label={isCurrentRunning ? ct('继续跟随', 'Resume following') : ct('回到最新', 'Jump to latest')}><ChevronDown size={16}/></button>}
          </div>}
        </section>)
}

export function ChatComposer({ layout = 'default', ComposerActions, CopyButton, PendingAttachments, ProviderModelCascade, REASONING_EFFORT_OPTIONS, activePromptPreset, activeSessionDetail, activeSidRef, addAttachmentFiles, applyComposerHeight, attachments, autorunEnabled, beginComposerResize, cancelRun, cmdManagerOpen, composerActionsTriggerRef, composerDragHeight, composerManualHeightRef, conductorEnabling, ct, defaultReasoningLabel, depsRepairing, dragging, extraPromptOpen, extraSysPromptPresetID, fileRef, finishComposerResize, handlePromptChange, handlePromptKeyDown, installChatPythonDeps, isConductorParent, isConductorWorker, isCurrentRunning, isUltraPlanPrompt, keychainOpen, loadChatState, loopRailOpen, modelDiagnosis, modelDiagnosisAdvice, modelDiagnosisTitle, moveComposerResize, onDropFiles, onPaste, openExtraPromptEditor, prompt, promptRef, providerGroups, queuedMessages, reasoningEffort, removeAttachment, saveModel, saveReasoningEffort, selectedModelNo, selectedProvider, send, sessionLoadFailed, sessionLoading, setCmdManagerOpen, setDragging, setErr, setKeychainOpen, setLoopRailOpen, sid, toggleAutorun, upgradeToConductor }) {
  const externalLayout = useChatLayout('chat.composer')
  return (<div data-ui-surface="chat.composer" {...externalLayout} data-ui-layout={layout} className={`oa-composer ${dragging ? 'is-dragging' : ''}`} onDragOver={e=>{e.preventDefault(); setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={onDropFiles}>
          <input ref={fileRef} type="file" multiple hidden onChange={e=>{ addAttachmentFiles(e.target.files); e.target.value='' }} />
          {attachments.length > 0 && <PendingAttachments attachments={attachments} onRemove={removeAttachment}/>}
          {modelDiagnosis && <div className={`oa-model-alert ${modelDiagnosis.fixable ? 'is-fixable' : ''}`} role="status" aria-live="polite">
            <div className="oa-model-alert-copy">
              <b><CircleHelp size={14}/>{modelDiagnosisTitle(modelDiagnosis, ct)}</b>
              <span>{modelDiagnosisAdvice(modelDiagnosis, ct)}</span>
            </div>
            <div className="oa-model-alert-actions">
              {modelDiagnosis.fixable && <button className="is-primary" type="button" onClick={installChatPythonDeps} disabled={depsRepairing}>
                <Download size={14}/>{depsRepairing ? ct('安装中…', 'Installing…') : ct('一键安装依赖', 'Install dependencies')}
              </button>}
              <button type="button" onClick={()=>loadChatState(activeSidRef.current || '').catch(e=>setErr(e.message || String(e)))} disabled={depsRepairing}>
                <RotateCw size={14}/>{ct('重新检测', 'Re-check')}
              </button>
              {modelDiagnosis.install_command && <CopyButton text={modelDiagnosis.install_command} compact/>}
            </div>
            {modelDiagnosis.detail && <details className="oa-model-alert-detail">
              <summary>{ct('查看 Python 输出', 'Show Python output')}</summary>
              <pre>{modelDiagnosis.detail}</pre>
            </details>}
          </div>}
          {isUltraPlanPrompt && <div className="oa-ultraplan-mode" aria-live="polite"><span><Sparkles size={14}/>UltraPlan</span><b>{ct('将以规划模式执行，并在完成后展示 run 目录与日志摘要', 'Runs in planning mode and shows the run directory and log summary when complete')}</b></div>}
          <button type="button" className="oa-composer-resize" title={ct('向上拖动增高，向下拖动缩小', 'Drag up to expand, down to shrink')} aria-label={ct('调整输入区高度', 'Resize message input')}
            onPointerDown={beginComposerResize} onPointerMove={moveComposerResize} onPointerUp={finishComposerResize} onPointerCancel={finishComposerResize} onLostPointerCapture={finishComposerResize}
            onKeyDown={event => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
              event.preventDefault()
              composerManualHeightRef.current = composerDragHeight(promptRef.current.getBoundingClientRect().height, 0, event.key === 'ArrowUp' ? -20 : 20, window.innerHeight)
              applyComposerHeight()
            }}/>
          <textarea ref={promptRef} value={prompt} onPaste={onPaste} onChange={handlePromptChange} onKeyDown={handlePromptKeyDown} placeholder={ct('向 GenericAgent 发送消息，可选择/粘贴/拖拽任意文件…', 'Message GenericAgent; select, paste, or drag any file…')} rows={1}/>
          <div className="oa-composer-bar">
            <ComposerActions
              onAttach={() => fileRef.current?.click()}
              onCommands={() => setCmdManagerOpen(true)}
              onSystemPrompt={openExtraPromptEditor}
              onKeychain={() => setKeychainOpen(true)}
              onAutorun={toggleAutorun}
              onLoop={() => setLoopRailOpen(true)}
              onConductor={!isConductorWorker(activeSessionDetail) ? upgradeToConductor : undefined}
              conductorActive={isConductorParent(activeSessionDetail)}
              conductorDisabled={!sid || sessionLoading || sessionLoadFailed || !activeSessionDetail || isCurrentRunning || activeSessionDetail?.running || queuedMessages.length > 0 || conductorEnabling}
              commandsOpen={cmdManagerOpen}
              keychainOpen={keychainOpen}
              systemPromptActive={extraPromptOpen || extraSysPromptPresetID}
              systemPromptLabel={extraSysPromptPresetID ? activePromptPreset.name : ''}
              autorunEnabled={autorunEnabled}
              loopOpen={loopRailOpen}
              triggerRef={composerActionsTriggerRef}
            />
            <div className="oa-composer-primary-actions">
              <ProviderModelCascade groups={providerGroups} selectedProvider={selectedProvider}
                value={selectedModelNo} disabled={!providerGroups.length}
                onChange={v=>saveModel(Number(v))}
                reasoningValue={reasoningEffort}
                onReasoningChange={saveReasoningEffort}
                reasoningOptions={REASONING_EFFORT_OPTIONS.map(option => option.value === 'off' ? { ...option, label: defaultReasoningLabel } : option)} />
              <button
                className="oa-send"
                type="button"
                disabled={sessionLoading || sessionLoadFailed || (!prompt.trim() && !attachments.length)}
                onClick={() => send()}
                title={isCurrentRunning ? ct('加入发送队列', 'Add to send queue') : ct('发送', 'Send')}
                aria-label={isCurrentRunning ? ct('加入发送队列', 'Add to send queue') : ct('发送', 'Send')}
              ><Send size={17}/></button>
              {isCurrentRunning && <button
                className="oa-stop"
                type="button"
                onClick={() => cancelRun(sid)}
                title={ct('停止生成', 'Stop generating')}
                aria-label={ct('停止生成', 'Stop generating')}
              ><Square size={12} fill="currentColor" strokeWidth={0}/></button>}
            </div>
          </div>
        </div>)
}
