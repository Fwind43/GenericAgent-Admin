import React, { useState } from 'react'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { execPath } from 'node:process'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import * as icons from 'lucide-react'

// Exercise the actual inline queue markup without mounting chat network effects.
const source = readFileSync('src/ChatApp.jsx', 'utf8')
const start = source.indexOf('        {queuedMessages.length > 0 && <div className={`oa-queue-dock')
const markup = source.slice(start, source.indexOf('        {cmdDrawer.open', start)).trim().slice(1, -1)
const names = ['React', 'queuedMessages', 'queueCollapsed', 'setQueueCollapsed', 'queueEditingId', 'queueDraft', 'setQueueDraft', 'guidingQueueId', 'isCurrentRunning', 'ct', 'saveQueueEdit', 'cancelQueueEdit', 'guideQueuedItem', 'removeQueued', 'editQueued', 'Sparkles', 'ChevronRight', 'ChevronDown', 'Check', 'X', 'Trash2', 'Edit3']
const compiled = execFileSync(execPath, ['--input-type=module', '-e', "import { transformSync } from 'esbuild'; import { readFileSync } from 'node:fs'; process.stdout.write(transformSync(readFileSync(0, 'utf8'), { loader: 'jsx', jsx: 'transform' }).code)"], { input: `return (${markup})`, encoding: 'utf8' })
const draw = new Function(...names, compiled)
const actions = Array.from({ length: 5 }, () => vi.fn())
function Queue({ messages, editing = '' }) {
  const [collapsed, setCollapsed] = useState(false)
  const [draft, setDraft] = useState('draft')
  return draw(React, messages, collapsed, setCollapsed, editing, draft, setDraft, '', true, (_, en) => en, ...actions, icons.Sparkles, icons.ChevronRight, icons.ChevronDown, icons.Check, icons.X, icons.Trash2, icons.Edit3)
}
const messages = Array.from({ length: 30 }, (_, i) => ({ id: String(i), text: `Message ${i}` }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
test('collapses many messages, keeps count updated, and expands without queue mutations', () => {
  const view = render(<Queue messages={messages} />)
  const list = view.container.querySelector('#oa-queue-list')
  expect(list.children.length).toBe(30)
  fireEvent.click(view.getByRole('button', { name: 'Collapse send queue' }))
  expect(list.hidden).toBe(true)
  expect(view.getByRole('button', { name: 'Expand send queue' }).getAttribute('aria-expanded')).toBe('false')
  view.rerender(<Queue messages={messages.slice(1)} />)
  expect(list.hidden).toBe(true)
  expect(view.container.querySelector('.oa-queue-count').textContent).toContain('29')
  fireEvent.click(view.getByRole('button', { name: 'Expand send queue' }))
  expect(list.hidden).toBe(false)
  expect(list.children.length).toBe(29)
  actions.forEach(action => expect(action).not.toHaveBeenCalled())
})
test('preserves unsaved editing across collapse and expansion; empty queue disappears', () => {
  const view = render(<Queue messages={messages} editing="0" />)
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'unsaved edit' } })
  fireEvent.click(view.getByRole('button', { name: 'Collapse send queue' }))
  expect(view.queryByRole('textbox')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Expand send queue' }))
  expect(view.getByRole('textbox').value).toBe('unsaved edit')
  view.rerender(<Queue messages={[]} />)
  expect(view.container.querySelector('.oa-queue-dock')).toBeNull()
})
