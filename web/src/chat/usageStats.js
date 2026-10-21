import { measuredOutputRate, cacheHitPercent, cacheReadTokens } from '../lib/chatUsage.js'
import { chatLocale } from './chatFormat.js'

export const usageHasTokens = (u) => !!u && ((u.input_tokens || 0) > 0 || (u.cache_creation_tokens || 0) > 0 || cacheReadTokens(u) > 0 || (u.output_tokens || 0) > 0)

export const formatElapsedMs = (ms = 0) => {
  const safe = Math.max(0, Number(ms) || 0)
  if (safe < 1000) return `${(safe / 1000).toFixed(1)}s`
  const totalSeconds = Math.floor(safe / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) return `${seconds}s`
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h${minutes % 60}m${seconds}s`
  return `${minutes}m${seconds}s`
}

export const getElapsedMs = (m, now = Date.now(), live = true) => {
  if (!m || m.role !== 'assistant') return 0
  if (m.elapsed_ms > 0) return m.elapsed_ms
  if (live && m.run_started_at_ms > 0) return Math.max(0, now - m.run_started_at_ms)
  return 0
}

export const freezeActiveAssistantElapsed = (messages = [], stoppedAtMs = Date.now()) => {
  const targetIndex = messages.findLastIndex(m => (
    m?.role === 'assistant'
    && Number(m.run_started_at_ms) > 0
    && !(Number(m.elapsed_ms) > 0)
  ))
  if (targetIndex < 0) return messages
  return messages.map((m, index) => {
    if (index !== targetIndex) return m
    const toolElapsedMs = Math.max(0, Number(m.tool_elapsed_ms) || 0)
    const toolLiveMs = Math.max(0, Number(m.tool_live_elapsed_ms) || 0)
    const toolActiveCount = Math.max(0, Number(m.tool_live_active_count) || 0)
    const toolUpdatedAtMs = Number(m.tool_live_updated_at_ms) || Number(m.tool_live_timing_at_ms) || 0
    const projectedToolMs = toolUpdatedAtMs > 0 && toolActiveCount > 0
      ? toolLiveMs + Math.max(0, Number(stoppedAtMs) - toolUpdatedAtMs) * toolActiveCount
      : toolLiveMs
    return {
      ...m,
      elapsed_ms: Math.max(1, Number(stoppedAtMs) - Number(m.run_started_at_ms)),
      tool_elapsed_ms: Math.max(toolElapsedMs, projectedToolMs),
      tool_live_active_count: 0,
    }
  })
}

export const formatTokens = (count = 0) => {
  const num = Math.max(0, Number(count) || 0)
  if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`
  return num.toLocaleString(chatLocale())
}

// 各内部 turn 用量累加得到整条回复总计
export const sumUsages = (usages) => {
  if (!Array.isArray(usages) || !usages.length) return null
  return usages.reduce((acc, u) => ({
    input_tokens: acc.input_tokens + (u?.input_tokens || 0),
    cache_creation_tokens: acc.cache_creation_tokens + (u?.cache_creation_tokens || 0),
    cache_read_tokens: acc.cache_read_tokens + cacheReadTokens(u),
    output_tokens: acc.output_tokens + (u?.output_tokens || 0),
  }), { input_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, output_tokens: 0 })
}

// 会话级可观测性摘要：只使用消息完成后写入的真实字段，不猜测未提供的首 token/速率。
export const buildChatStats = (messages = [], now = Date.now(), running = false) => {
  const turns = (Array.isArray(messages) ? messages : []).filter(m => m?.role === 'assistant' && m?.kind !== 'btw' && (m?.usage || m?.usages || m?.elapsed_ms > 0 || m?.run_started_at_ms > 0))
  const activeIndex = running ? turns.findLastIndex(m => Number(m.run_started_at_ms) > 0 && !(Number(m.elapsed_ms) > 0)) : -1
  const usages = turns.flatMap(m => Array.isArray(m.usages) && m.usages.length ? m.usages : (m.usage ? [m.usage] : []))
  const total = sumUsages(usages)
  const elapsedMs = turns.reduce((sum, m, index) => sum + getElapsedMs(m, now, index === activeIndex), 0)
  // Apply the legacy elapsed fallback per reply so a new live clock cannot hide history.
  const llmElapsedMs = turns.reduce((sum, m, index) => {
    const measuredMs = Math.max(0, Number(m.llm_elapsed_ms) || 0)
    return sum + (measuredMs || getElapsedMs(m, now, index === activeIndex))
  }, 0)
  const toolElapsedMs = turns.reduce((sum, m, index) => {
    const terminalMs = Math.max(0, Number(m.tool_elapsed_ms) || 0)
    const liveMs = Math.max(0, Number(m.tool_live_elapsed_ms) || 0)
    const activeCount = index === activeIndex ? Math.max(0, Number(m.tool_live_active_count) || 0) : 0
    const updatedAtMs = Number(m.tool_live_updated_at_ms) || Number(m.tool_live_timing_at_ms) || 0
    const projectedMs = updatedAtMs > 0 && activeCount > 0
      ? liveMs + Math.max(0, now - updatedAtMs) * activeCount
      : liveMs
    return sum + Math.max(terminalMs, projectedMs)
  }, 0)
  const ttftValues = usages.map(usage => Number(usage?.ttft_ms) || 0).filter(value => value > 0).sort((a, b) => a - b)
  const legacyFirstTokenValues = turns.map(m => Number(m.first_token_ms) || 0).filter(value => value > 0).sort((a, b) => a - b)
  const firstTokenValues = ttftValues.length ? ttftValues : legacyFirstTokenValues
  const middle = Math.floor(firstTokenValues.length / 2)
  const firstTokenMs = firstTokenValues.length
    ? (firstTokenValues.length % 2 ? firstTokenValues[middle] : (firstTokenValues[middle - 1] + firstTokenValues[middle]) / 2)
    : 0
  return {
    rounds: turns.length,
    steps: usages.length,
    elapsedMs,
    llmElapsedMs,
    toolElapsedMs,
    firstTokenMs,
    firstTokenSamples: firstTokenValues.length,
    firstTokenIsModelTTFT: ttftValues.length > 0,
    inputTokens: total?.input_tokens || 0,
    outputTokens: total?.output_tokens || 0,
    outputRate: measuredOutputRate(usages),
    cachePercent: cacheHitPercent(usages),
  }
}
