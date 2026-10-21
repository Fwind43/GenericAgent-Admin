import { useMemo, memo, useState, useEffect } from 'react'
import { buildWorldlineRows, buildWorldlineEdges, worldlineMaxLevel, worldlineNodeKindLabel, worldlineNodeTitle } from '../lib/worldlineTree'
import { RotateCw, X } from 'lucide-react'
import { fmtDate } from './sessionLabels.js'
import { ct } from './chatFormat.js'

export const WorldlineRestoreDialog = memo(function WorldlineRestoreDialog({ nodes = [], onClose, onSelect }) {
  const [selectedNodeID, setSelectedNodeID] = useState('')
  const [restoreMode, setRestoreMode] = useState('both')
  const [restoreTarget, setRestoreTarget] = useState('at')

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="oa-worldline-backdrop" onMouseDown={(event)=>{ if (event.target === event.currentTarget) onClose?.() }}>
      <section className="oa-worldline-dialog" role="dialog" aria-modal="true" aria-labelledby="oa-worldline-title">
        <header className="oa-worldline-dialog-head">
          <div>
            <small>WORLDLINE</small>
            <h2 id="oa-worldline-title">{ct('选择回退点', 'Choose a rollback point')}</h2>
            <p>{ct('配置恢复范围与位置后填入命令，由你确认后发送。', 'Choose the restore scope and position, then insert the command for review before sending.')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={ct('关闭回退点选择', 'Close rollback-point picker')}><X size={17}/></button>
        </header>
        <div className="oa-worldline-node-list">
          {nodes.map((node, index) => {
            const nodeID = String(node?.id || '').trim()
            const ordinal = node?.ordinal ?? index + 1
            const title = node?.title || node?.summary || node?.name || `${ct('回退点', 'Rollback point')} ${ordinal}`
            const selected = !!nodeID && nodeID === selectedNodeID
            return <button key={nodeID || index} className={`oa-worldline-node${selected ? ' is-selected' : ''}`} type="button" disabled={!nodeID} aria-pressed={selected} onClick={()=>setSelectedNodeID(nodeID)}>
              <span className="oa-worldline-node-no">{ordinal}</span>
              <span className="oa-worldline-node-copy"><b>{title}</b><code>{nodeID || ct('缺少节点 ID', 'Missing node ID')}</code></span>
              <span className="oa-worldline-node-action">{selected ? ct('已选择', 'Selected') : ct('选择', 'Select')}</span>
            </button>
          })}
        </div>
        <div className="oa-worldline-options">
          <fieldset>
            <legend>{ct('恢复范围', 'Restore scope')}</legend>
            <div>
              {[['both', ct('对话与代码', 'Conversation and code')], ['conversation', ct('仅对话', 'Conversation only')], ['code', ct('仅代码', 'Code only')]].map(([value, label]) =>
                <button key={value} type="button" className={restoreMode === value ? 'is-selected' : ''} aria-pressed={restoreMode === value} onClick={()=>setRestoreMode(value)}>{label}</button>)}
            </div>
          </fieldset>
          <fieldset>
            <legend>{ct('恢复位置', 'Restore position')}</legend>
            <div>
              {[['at', ct('定位到节点', 'At the node')], ['before', ct('节点之前', 'Before the node')]].map(([value, label]) =>
                <button key={value} type="button" className={restoreTarget === value ? 'is-selected' : ''} aria-pressed={restoreTarget === value} onClick={()=>setRestoreTarget(value)}>{label}</button>)}
            </div>
          </fieldset>
        </div>
        <footer>
          <span>{ct(`${nodes.length} 个可用回退点`, `${nodes.length} rollback points available`)}</span><kbd>Esc</kbd><span>{ct('关闭', 'Close')}</span>
          <button className="oa-worldline-confirm" type="button" disabled={!selectedNodeID} onClick={()=>onSelect?.(selectedNodeID, restoreMode, restoreTarget)}>{ct('确认并填入命令', 'Confirm and insert command')}</button>
        </footer>
      </section>
    </div>
  )
})

export function WorldlinePanel({ state, loading, switchingId, disabled, onClose, onRefresh, onSwitch }) {
  const rows = useMemo(() => buildWorldlineRows(state?.nodes, state?.current_path, state?.head), [state])
  const edges = useMemo(() => buildWorldlineEdges(rows), [rows])
  const maxLevel = worldlineMaxLevel(rows)
  const rowHeight = 50
  const levelGap = 18
  const graphInset = 12
  const graphWidth = graphInset * 2 + maxLevel * levelGap
  const graphHeight = rows.length * rowHeight
  const unavailable = !state || state.available === false
  return (
    <aside className="oa-context-drawer oa-worldline-drawer" aria-label="世界线分支">
      <div className="oa-context-head">
        <div><b>世界线</b></div>
        <div className="oa-context-actions">
          <button type="button" onClick={onRefresh} disabled={loading} aria-label="刷新世界线" title="刷新"><RotateCw size={14}/></button>
          <button type="button" onClick={onClose} aria-label="关闭世界线"><X size={15}/></button>
        </div>
      </div>
      {unavailable && <div className="oa-worldline-empty">{
        state?.degraded_reason === 'inactive'
          ? '世界线功能未启用，发送一条消息后自动激活。'
          : (state?.degraded_reason || '还没有世界线记录，发送一条消息后再试。')
      }</div>}
      {!unavailable && rows.length === 0 && <div className="oa-worldline-empty">{loading ? '加载中…' : '暂无节点'}</div>}
      {!unavailable && rows.length > 0 && <div className="oa-worldline-list">
        <div className="oa-worldline-tree" style={{ '--wl-graph-width': `${graphWidth}px`, '--wl-tree-height': `${graphHeight}px` }}>
          <svg className="oa-worldline-graph" width={graphWidth} height={graphHeight} viewBox={`0 0 ${graphWidth} ${graphHeight}`} aria-hidden="true">
            {edges.map(edge => {
              const x1 = graphInset + edge.parentLevel * levelGap
              const x2 = graphInset + edge.childLevel * levelGap
              const y1 = edge.parentIndex * rowHeight + rowHeight / 2
              const y2 = edge.childIndex * rowHeight + rowHeight / 2
              const d = x1 === x2
                ? `M ${x1} ${y1} L ${x2} ${y2}`
                : (() => {
                    const railX = x1 + (x2 - x1) / 2
                    const leaveY = Math.min(y1 + rowHeight * 0.32, y2)
                    const joinY = Math.max(leaveY, y2 - rowHeight * 0.32)
                    return `M ${x1} ${y1} C ${x1} ${leaveY}, ${railX} ${leaveY}, ${railX} ${leaveY} L ${railX} ${joinY} C ${railX} ${y2}, ${x2} ${y2}, ${x2} ${y2}`
                  })()
              return <path key={edge.id} className={`oa-worldline-edge${edge.onPath ? ' on-path' : ''}`} d={d}/>
            })}
            {rows.map((row, index) => {
              const x = graphInset + row.level * levelGap
              const y = index * rowHeight + rowHeight / 2
              return <g key={row.node.id} className={`oa-worldline-node${row.onPath ? ' on-path' : ''}${row.isCurrent ? ' is-current' : ''}`}>
                {row.isCurrent && <circle className="oa-worldline-node-ring" cx={x} cy={y} r="7"/>}
                <circle className="oa-worldline-node-dot" cx={x} cy={y} r={row.isFork ? 4.5 : 3.5}/>
              </g>
            })}
          </svg>
          <div className="oa-worldline-rows">
            {rows.map(row => (
              <div key={row.node.id} className={`oa-worldline-row${row.onPath ? ' on-path' : ''}${row.isCurrent ? ' is-current' : ''}`}>
                <div className="oa-worldline-info">
                  <div className="oa-worldline-title">
                    {worldlineNodeKindLabel(row.node) && <em className="oa-worldline-kind" title={`节点类型：${worldlineNodeKindLabel(row.node)}`}>{worldlineNodeKindLabel(row.node)}</em>}
                    <b title={worldlineNodeTitle(row.node)}>{worldlineNodeTitle(row.node)}</b>
                    {row.node.untracked_changes && <em className="oa-worldline-badge oa-worldline-untracked" title={`存在世界线外的文件改动，切换分支不会还原这些文件：\n${(row.node.untracked_files || []).join('\n') || '未知文件'}`} aria-label="外部改动">⚠</em>}
                    {row.node.mapping_status && row.node.mapping_status !== 'mapped' && <em className="oa-worldline-badge oa-worldline-unmapped" title="无消息映射" aria-label="无消息映射">⊘</em>}
                  </div>
                  <span className="oa-worldline-date">{row.node.created_at ? fmtDate(row.node.created_at) : ''}</span>
                </div>
                {!row.isCurrent && <button type="button" className="oa-worldline-switch" 
                    disabled={disabled || !!switchingId || row.node.mapping_status === 'unmapped'}
                    title={row.node.mapping_status === 'unmapped' ? '起点节点无对话内容，无法切换' : ''}
                    onClick={() => onSwitch(row.node.id)}>{switchingId === row.node.id ? '切换中…' : '切换'}</button>}
              </div>
            ))}
          </div>
        </div>
      </div>}
      {state?.truncated && <div className="oa-worldline-empty">节点过多，已截断显示。</div>}
    </aside>
  )
}
