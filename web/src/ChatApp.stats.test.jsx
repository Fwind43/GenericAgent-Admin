// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ChatStats, buildChatStats, freezeActiveAssistantElapsed } from './ChatApp.jsx'

afterEach(() => cleanup())

describe('chat stats', () => {
  test('converts long LLM durations to readable units', () => {
    const { container } = render(<ChatStats messages={[
      { role: 'assistant', elapsed_ms: 1_158_500 },
    ]} />)

    expect(container.querySelector('.oa-chat-stats')?.textContent).toContain('LLM 19m18s')
  })

  test('shows LLM and tool durations separately', () => {
    const { container } = render(<ChatStats messages={[{
      role: 'assistant', elapsed_ms: 11_180_000, llm_elapsed_ms: 565_000, tool_elapsed_ms: 11_212_000,
    }]} />)
    const text = container.querySelector('.oa-chat-stats')?.textContent || ''
    expect(text).toContain('LLM 9m25s · 工具调用 3h6m52s')
  })
  test('uses the live run clock for an unfinished assistant turn', () => {
    const messages = [{ role: 'assistant', run_started_at_ms: 2_000 }]
    const stats = buildChatStats(messages, 5_000, true)

    expect(stats.llmElapsedMs).toBe(3_000)
    expect(stats.toolElapsedMs).toBe(0)

    const { container } = render(<ChatStats messages={messages} now={5_000} running />)
    expect(container.querySelector('.oa-chat-stats')?.textContent).toContain('LLM 3s · 工具调用 0.0s')
  })

  test('keeps historical timing when a new reply starts and finishes', () => {
    const history = [{ role: 'assistant', elapsed_ms: 9_000 }]
    const active = { role: 'assistant', run_started_at_ms: 20_000 }
    const { container, rerender } = render(<ChatStats messages={history} now={20_000} />)
    const text = () => container.querySelector('.oa-chat-stats').textContent
    expect(text()).toContain('LLM 9s')
    rerender(<ChatStats messages={[...history, active]} now={20_000} running />)
    expect(text()).toContain('LLM 9s')
    rerender(<ChatStats messages={[...history, active]} now={21_000} running />)
    expect(text()).toContain('LLM 10s')
    rerender(<ChatStats messages={[...history, { ...active, elapsed_ms: 2_000 }]} now={22_000} />)
    expect(text()).toContain('LLM 11s')
  })

  test('combines legacy fallback and measured durations per reply', () => {
    const messages = [
      { role: 'assistant', elapsed_ms: 9_000 },
      { role: 'assistant', elapsed_ms: 8_000, llm_elapsed_ms: 3_000 },
      { role: 'assistant', run_started_at_ms: 20_000 },
    ]
    expect(buildChatStats(messages, 21_000, true).llmElapsedMs).toBe(13_000)
  })

  test('does not count measured active timing twice', () => {
    const messages = [{ role: 'assistant', run_started_at_ms: 20_000, llm_elapsed_ms: 500 }]
    expect(buildChatStats(messages, 21_000, true).llmElapsedMs).toBe(500)
  })

  test('projects an active tool timer from the latest server snapshot', () => {
    const stats = buildChatStats([{
      role: 'assistant', run_started_at_ms: 1_000,
      tool_live_elapsed_ms: 250, tool_live_active_count: 1, tool_live_updated_at_ms: 1_000,
    }], 1_750, true)

    expect(stats.toolElapsedMs).toBe(1_000)
    const { container } = render(<ChatStats messages={[{
      role: 'assistant', run_started_at_ms: 1_000,
      tool_live_elapsed_ms: 250, tool_live_active_count: 1, tool_live_updated_at_ms: 1_000,
    }]} now={1_750} running />)
    expect(container.querySelector('.oa-chat-stats')?.textContent).toContain('工具调用 1s')
  })

  test('freezes the interrupted turn and never resumes it on later clocks', () => {
    const previous = { role: 'assistant', run_started_at_ms: 100, elapsed_ms: 400 }
    const active = {
      role: 'assistant', run_started_at_ms: 2_000,
      tool_live_elapsed_ms: 500, tool_live_active_count: 1, tool_live_updated_at_ms: 6_000,
    }
    const frozen = freezeActiveAssistantElapsed([previous, active], 10_000)

    expect(frozen[0]).toBe(previous)
    expect(frozen[1]).toMatchObject({
      elapsed_ms: 8_000,
      tool_elapsed_ms: 4_500,
      tool_live_active_count: 0,
    })
    const stopped = buildChatStats(frozen, 10_000, false)
    const muchLater = buildChatStats(frozen, 3_610_000, false)
    expect(muchLater.elapsedMs).toBe(stopped.elapsedMs)
    expect(muchLater.llmElapsedMs).toBe(stopped.llmElapsedMs)
    expect(muchLater.toolElapsedMs).toBe(stopped.toolElapsedMs)
  })

  test('uses the median of per-call model TTFT samples', () => {
    const messages = [{
      role: 'assistant',
      first_token_ms: 25,
      usages: [{ ttft_ms: 100 }, { ttft_ms: 1000 }, { ttft_ms: 400 }],
    }]

    const stats = buildChatStats(messages)
    expect(stats.firstTokenMs).toBe(400)
    expect(stats.firstTokenSamples).toBe(3)
    expect(stats.firstTokenIsModelTTFT).toBe(true)

    const { container } = render(<ChatStats messages={messages} />)
    expect(container.querySelector('.oa-chat-stats')?.textContent).toContain('\u6a21\u578b TTFT \u4e2d\u4f4d 0.4s \u00b7 3\u6b21')
  })

  test('falls back to legacy message timing when TTFT samples are absent', () => {
    const stats = buildChatStats([
      { role: 'assistant', first_token_ms: 900, elapsed_ms: 1 },
      { role: 'assistant', first_token_ms: 100, elapsed_ms: 1 },
    ])

    expect(stats.firstTokenMs).toBe(500)
    expect(stats.firstTokenSamples).toBe(2)
    expect(stats.firstTokenIsModelTTFT).toBe(false)
  })

  test('renders zero-value stats for a new conversation', () => {
    const { container } = render(<ChatStats messages={[]} />)
    const stats = container.querySelector('.oa-chat-stats')

    expect(stats).toBeTruthy()
    expect(stats.textContent).toContain('0 轮 · 0 步')
    expect(stats.textContent).toContain('LLM 0.0s')
    expect(stats.textContent).toContain('缓存命中 0%')
    expect(stats.textContent).toContain('输入 0 · 输出 0')
  })
})
