import { segmentAgentProtocolBlocks } from './agentProtocol.js'

const waitingResult = (value) => /waiting for (?:the )?user (?:input|reply|response)|waiting for your (?:answer|reply)|awaiting (?:user )?(?:input|reply|response)|\u7b49\u5f85\u7528\u6237|\u7b49\u5f85\u56de\u590d/i.test(String(value || ''))
const stoppedText = /^(?:Stopped\.|\u5df2\u4e2d\u6b62\u3002)$/
const isAskUser = (name) => /(?:^|[._-])ask_user$/i.test(String(name || ''))

export function hasPendingTaskbarQuestion(message) {
  const content = String(message?.content || '')
  // Avoid parsing the stream on ordinary token updates without an ask tool.
  if (content.includes('ask_user')) {
    const segments = segmentAgentProtocolBlocks(content)
    const last = segments.at(-1)
    const call = last?.kind === 'folds' ? last.folds.at(-1) : null
    if (call?.type === 'tool-call' && isAskUser(call.label)) {
      return !String(call.result || '').trim() || waitingResult(call.result)
    }
  }
  const blocks = message?.structured_content
  if (!Array.isArray(blocks)) return false
  const lastCallIndex = blocks.findLastIndex(block => block.type === 'tool_use')
  const call = blocks[lastCallIndex]
  if (!isAskUser(call?.name)) return false
  const trailing = blocks.slice(lastCallIndex + 1)
  if (trailing.some(block => block.type === 'text' && String(block.text || '').trim())) return false
  const result = trailing.find(block => block.type === 'tool_result' && block.tool_use_id === call.id)
  if (!result) return true
  const text = Array.isArray(result.content) ? result.content.map(block => block.text || '').join('\n') : result.content
  return waitingResult(text)
}

export function chatTaskbarState({ sid, messages = [], loading = false, running = false, error = '', stopped = false }) {
  if (!sid || loading) return 'idle'
  const last = messages.findLast(message => message.role === 'assistant' || message.role === 'user')
  if (stopped) return 'idle'
  const question = last?.role === 'assistant' && hasPendingTaskbarQuestion(last)
  if (running) return question ? 'waiting' : 'running'
  if (last?.role === 'assistant' && stoppedText.test(String(last.content || '').trim())) return 'idle'
  if (error || last?.error) return 'failed'
  if (question) return 'waiting'
  if (last?.role !== 'assistant') return 'idle'
  return String(last.content || '').trim() || last.structured_content?.length || last.files?.length ? 'completed' : 'idle'
}

export function waitingChatSessions({ sessions = [], sid = '', liveState = 'idle', liveRunning = false }) {
  const waiting = sessions.filter(session => session.id === sid && liveRunning
    ? liveState === 'waiting'
    : session.taskbar_state === 'waiting')
  if (sid && liveRunning && liveState === 'waiting' && !sessions.some(session => session.id === sid)) {
    waiting.push({ id: sid })
  }
  return waiting
}

// Use the same unread set as the sidebar; workflow status stays inside the chat.
export function aggregateChatTaskbarState({ sessions = [], unread = new Set() }) {
  return sessions.some(session => unread.has(session.id)) ? 'unread' : 'idle'
}

export function shouldRefreshChatTaskbar(doc = globalThis.document, target = globalThis.window) {
  return !doc?.hidden || typeof target?.__gaTaskbarState === 'function'
}

export function publishTaskbarState(state, target = globalThis.window) {
  if (typeof target?.__gaTaskbarState !== 'function') return
  try {
    const result = target.__gaTaskbarState(state)
    result?.catch?.(() => {})
  } catch { /* Native decoration must never interrupt a chat. */ }
}
