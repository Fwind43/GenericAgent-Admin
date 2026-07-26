const IMMEDIATE_COMMANDS = new Set(['/scheduler', '/rewind', '/clear', '/export', '/help', '/status', '/verbose', '/worldline'])

export const parseImmediateChatCommand = (value) => {
  const text = String(value || '').trim()
  const fields = text.split(/\s+/)
  const name = String(fields[0] || '').toLowerCase()
  if (!IMMEDIATE_COMMANDS.has(name)) return null
  const mode = name === '/scheduler' || name === '/worldline' ? String(fields[1] || 'list').toLowerCase() : ''
  return { name, mode: mode === 'run' ? 'start' : mode, text, fields }
}

export const isDangerousChatCommand = (command) => {
  const parsed = typeof command === 'string' ? parseImmediateChatCommand(command) : command
  if (!parsed) return false
  return parsed.name === '/rewind' || parsed.name === '/clear' || (parsed.name === '/worldline' && parsed.mode === 'restore') || (parsed.name === '/scheduler' && parsed.mode === 'start')
}

export const requiresDangerousChatCommandConfirmation = (value, approvedValue = '') => {
  const text = String(value || '').trim()
  return isDangerousChatCommand(text) && String(approvedValue || '') !== text
}

export const dangerousChatCommandMessage = (command) => {
  const parsed = typeof command === 'string' ? parseImmediateChatCommand(command) : command
  if (!parsed) return ''
  if (parsed.name === '/clear') return '清空当前会话的消息与历史状态？此操作不可恢复。'
  if (parsed.name === '/rewind') return `回退当前会话${parsed.fields[1] ? ` ${parsed.fields[1]} 个用户轮次` : ' 1 个用户轮次'}？被移除的消息不可恢复。`
  if (parsed.name === '/scheduler' && parsed.mode === 'start') return `启动服务：${parsed.fields.slice(2).join(' ') || '未指定'}？`
  return ''
}

const normalizeResultCommand = (value) => {
  const command = String(value || '').trim().toLowerCase()
  if (!command) return ''
  return command.startsWith('/') ? command : `/${command}`
}

export const reduceCommandResult = (payload) => {
  const result = payload?.result && typeof payload.result === 'object' ? payload.result : (payload || {})
  const command = normalizeResultCommand(result.command)
  const patch = { commandResult: result }
  if (command === '/rewind') patch.prefill = String(result.prefill || '')
  if (command === '/clear' && result.cleared === true) patch.cleared = true
  if ((command === '/rewind' || command === '/clear' || (command === '/worldline' && result.action === 'restore')) && result.session) patch.session = result.session
  if (command === '/export' && typeof result.content === 'string') {
    patch.download = {
      content: result.content,
      filename: String(result.filename || 'chat-export.md'),
      mime: String(result.mime_type || result.mime || 'text/plain;charset=utf-8'),
    }
  }
  return patch
}

export const commandResultSummary = (result = {}, language = 'zh') => {
  const en = language === 'en'
  const command = normalizeResultCommand(result.command)
  if (command === '/rewind') return en ? `Rewound ${Number(result.removed_messages || 0)} messages` : `已回退 ${Number(result.removed_messages || 0)} 条消息`
  if (command === '/clear') return en ? (result.cleared ? 'Current session cleared' : 'Clear did not complete') : (result.cleared ? '当前会话已清空' : '清空未完成')
  if (command === '/export') return en ? `Export ready: ${result.filename || 'chat-export.md'}` : `导出已就绪：${result.filename || 'chat-export.md'}`
  if (command === '/scheduler') return en ? (result.mode === 'start' ? 'Service start request completed' : 'Service status') : (result.mode === 'start' ? '服务启动请求已完成' : '服务状态')
  if (command === '/help') return en ? 'Available management commands' : '可用管理命令'
  if (command === '/status') return en ? 'Session and service status' : '会话与服务状态'
  if (command === '/verbose') return en ? `${Array.isArray(result.records) ? result.records.length : 0} tool audit records` : `${Array.isArray(result.records) ? result.records.length : 0} 条工具审计记录`
  if (command === '/worldline') {
    const nodeCount = Array.isArray(result.tree?.nodes) ? result.tree.nodes.length : 0
    return en ? (result.action === 'restore' ? 'Worldline restore completed' : `${nodeCount} worldline node${nodeCount === 1 ? '' : 's'}`) : (result.action === 'restore' ? '世界线恢复完成' : `${nodeCount} 个世界线节点`)
  }
  return command || (en ? 'Command completed' : '命令已完成')
}
