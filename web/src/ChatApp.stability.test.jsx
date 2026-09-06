import React from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ChatMessage } from './ChatApp.jsx'

afterEach(cleanup)
const onAskReply = () => {}
const firstTurn = [
  'LLM Running (Turn 1)', '<summary>Inspect source</summary>', 'Stable **paragraph**.', '',
  '\u{1F6E0}\uFE0F Tool: `file_patch`', '```text',
  JSON.stringify({ path: 'src/demo.js', old_content: 'const n = 1', new_content: 'const n = 2' }),
  '```', '',
].join('\n')
const secondTurn = '\nLLM Running (Turn 2)\n<summary>Check result</summary>\nNext body'
const final = '\n\n```\n[Info] Final response to user.\n```\nFinal answer'
const message = (content, pending = true) => <ChatMessage
  message={{ id: 'stable-turns', role: 'assistant', content, files: [], created_at: 0 }}
  pending={pending} isLatestMessage onAskReply={onAskReply}
/>

describe('streamed turn stability', () => {
  test('keeps the same body and tool state across rollover, completion and stack toggles', () => {
    const view = render(message(firstTurn))
    const turn = view.container.querySelector('[data-turn="1"]')
    const body = turn.querySelector('.oa-turn-body')
    const paragraph = body.querySelector('.oa-md p')
    const toggle = body.querySelector('.oa-patch-toggle')
    expect(toggle).toBeTruthy()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    view.rerender(message(firstTurn + secondTurn))
    expect(view.container.querySelector('[data-turn="1"]')).toBe(turn)
    expect(turn.querySelector('.oa-turn-body')).toBe(body)
    expect(body.querySelector('.oa-md p')).toBe(paragraph)
    expect(body.querySelector('.oa-patch-toggle')).toBe(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(body.hidden).toBe(true)
    expect(turn.classList.contains('oa-turn-card')).toBe(true)

    view.rerender(message(firstTurn + secondTurn + final, false))
    expect(view.container.querySelector('.oa-turn-stack-head').getAttribute('aria-expanded')).toBe('false')
    expect(turn.hidden).toBe(true)
    expect(body.querySelector('.oa-patch-toggle')).toBe(toggle)
    fireEvent.click(view.container.querySelector('.oa-turn-stack-head'))
    expect(turn.hidden).toBe(false)
    fireEvent.click(view.container.querySelector('.oa-turn-stack-head'))
    expect(turn.hidden).toBe(true)
    fireEvent.click(view.container.querySelector('.oa-turn-stack-head'))
    expect(turn.hidden).toBe(false)
    fireEvent.click(turn.querySelector('.oa-turn-toggle'))
    expect(body.hidden).toBe(false)
    expect(body.querySelector('.oa-md p')).toBe(paragraph)
    expect(body.querySelector('.oa-patch-toggle')).toBe(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  test('retains a manual step collapse when more tokens and turns arrive', () => {
    const view = render(message(firstTurn))
    view.rerender(message(firstTurn + secondTurn))
    const turn = view.container.querySelector('[data-turn="1"]')
    expect(turn.querySelector('.oa-turn-body').hidden).toBe(true)
    fireEvent.click(turn.querySelector('button[aria-expanded]'))
    expect(turn.querySelector('.oa-turn-body').hidden).toBe(false)
    fireEvent.click(turn.querySelector('button[aria-expanded]'))
    expect(turn.querySelector('.oa-turn-body').hidden).toBe(true)
    view.rerender(message(firstTurn + secondTurn + ' continues'))
    expect(turn.querySelector('.oa-turn-body').hidden).toBe(true)
    view.rerender(message(firstTurn + secondTurn + final, false))
    expect(turn.querySelector('.oa-turn-body').hidden).toBe(true)
  })

  test('historical bodies mount on first expansion, then survive hiding', () => {
    const view = render(message(firstTurn + secondTurn + final, false))
    const turn = view.container.querySelector('[data-turn="1"]')
    const body = turn.querySelector('.oa-turn-body')
    expect(turn.hidden).toBe(true)
    expect(body.childElementCount).toBe(0)
    fireEvent.click(view.container.querySelector('.oa-turn-stack-head'))
    fireEvent.click(turn.querySelector('button'))
    const toggle = body.querySelector('.oa-patch-toggle')
    expect(toggle).toBeTruthy()
    fireEvent.click(toggle)
    fireEvent.click(turn.querySelector('button'))
    fireEvent.click(turn.querySelector('button'))
    expect(body.querySelector('.oa-patch-toggle')).toBe(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })
})
