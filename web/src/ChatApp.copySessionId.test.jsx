import React from 'react'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { execPath } from 'node:process'
import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import * as icons from 'lucide-react'
import { copyText } from './lib/format'

const source = readFileSync('src/ChatApp.jsx', 'utf8')
const body = source.slice(source.indexOf('  const copySessionId = async'), source.indexOf('  const startRename ='))
const makeCopy = new Function('copyText', 'closeSessionMenu', 'setErr', 'setSessionCopyNotice', 'ct', `${body}; return copySessionId`)
const view = readFileSync('src/ui/chatBody.jsx', 'utf8')
const start = view.indexOf('      {!sessionManagerOpen && menuOpen && menuPos && (() => {')
const markup = view.slice(start, view.indexOf('      <div className="oa-sidebar-foot">', start)).trim().slice(1, -1)
const compiled = execFileSync(execPath, ['--input-type=module', '-e', "import { transformSync } from 'esbuild'; import { readFileSync } from 'node:fs'; process.stdout.write(transformSync(readFileSync(0, 'utf8'), { loader: 'jsx', jsx: 'transform' }).code)"], { input: `return (${markup})`, encoding: 'utf8' })
const draw = new Function('React', 'sessionManagerOpen', 'menuOpen', 'menuPos', 'sessions', 'menuRef', 'copySessionId', 'ct', 'startRename', 'setSessionPinned', 'setSessionHubEnabled', 'deleteSession', 'Copy', 'Edit3', 'Pin', 'Bot', 'Trash2', compiled)
const ct = (_, en) => en
const originalExec = Object.getOwnPropertyDescriptor(document, 'execCommand')
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); if (originalExec) Object.defineProperty(document, 'execCommand', originalExec); else delete document.execCommand })

const noticeBody = source.slice(source.indexOf('  const [sessionCopyNotice,'), source.indexOf('  const [llms,', source.indexOf('  const [sessionCopyNotice,')))
const useCopyNotice = new Function('useState', 'useRef', 'useCallback', 'useEffect', `${noticeBody}; return { notice: sessionCopyNotice, show: setSessionCopyNotice }`)
function mountedNotice() {
  let current
  function Notice() {
    current = useCopyNotice(React.useState, React.useRef, React.useCallback, React.useEffect)
    return current.notice ? <div role="status">{current.notice}</div> : null
  }
  const ui = render(<Notice/>)
  return { ...ui, show: text => current.show(text) }
}

test.each(['Session ID copied', 'Could not copy session ID'])('copy feedback auto-dismisses after three seconds: %s', text => {
  vi.useFakeTimers()
  const ui = mountedNotice()
  act(() => ui.show(text))
  act(() => vi.advanceTimersByTime(2999))
  expect(ui.getByRole('status').textContent).toBe(text)
  act(() => vi.advanceTimersByTime(1))
  expect(ui.queryByRole('status')).toBeNull()
})

test('repeating identical copy feedback restarts its timeout', () => {
  vi.useFakeTimers()
  const ui = mountedNotice()
  act(() => ui.show('Session ID copied'))
  act(() => vi.advanceTimersByTime(2000))
  act(() => ui.show('Session ID copied'))
  expect(vi.getTimerCount()).toBe(1)
  act(() => vi.advanceTimersByTime(1000))
  expect(ui.getByRole('status')).toBeTruthy()
  act(() => vi.advanceTimersByTime(1999))
  expect(ui.getByRole('status')).toBeTruthy()
  act(() => vi.advanceTimersByTime(1))
  expect(ui.queryByRole('status')).toBeNull()
})

test('manual dismissal cancels the old timer before the next copy', () => {
  vi.useFakeTimers()
  const ui = mountedNotice()
  act(() => ui.show('Session ID copied'))
  act(() => vi.advanceTimersByTime(1000))
  act(() => ui.show(''))
  expect(ui.queryByRole('status')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  act(() => ui.show('Session ID copied'))
  act(() => vi.advanceTimersByTime(2000))
  expect(ui.getByRole('status')).toBeTruthy()
  act(() => vi.advanceTimersByTime(1000))
  expect(ui.queryByRole('status')).toBeNull()
})

test('unmount cancels pending copy feedback cleanup', () => {
  vi.useFakeTimers()
  const ui = mountedNotice()
  act(() => ui.show('Session ID copied'))
  expect(vi.getTimerCount()).toBe(1)
  ui.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

function callback(copy = vi.fn().mockResolvedValue()) {
  const close = vi.fn(), err = vi.fn(), notice = vi.fn()
  return { run: makeCopy(copy, close, err, notice, ct), copy, close, err, notice }
}

test('copies the menu target, not the active or first session', () => {
  const copy = vi.fn(), bubble = vi.fn()
  const ui = render(<div onClick={bubble}>{draw(React, false, 'target-id', { top: 8, left: 8 }, [{ id: 'active-id' }, { id: 'target-id' }], { current: null }, copy, ct, vi.fn(), vi.fn(), vi.fn(), vi.fn(), icons.Copy, icons.Edit3, icons.Pin, icons.Bot, icons.Trash2)}</div>)
  fireEvent.click(ui.getByRole('button', { name: 'Copy session ID' }))
  expect(copy).toHaveBeenCalledExactlyOnceWith('target-id')
  expect(bubble).not.toHaveBeenCalled()
})

test('closes the menu, restores focus, and reports successful copy', async () => {
  const c = callback(); await c.run('target-id')
  expect(c.copy).toHaveBeenCalledExactlyOnceWith('target-id')
  expect(c.close).toHaveBeenCalledWith({ restoreFocus: true })
  expect(c.notice).toHaveBeenLastCalledWith('Session ID copied')
  expect(c.err).toHaveBeenLastCalledWith('')
})

test('reports failure without a false success', async () => {
  const c = callback(vi.fn().mockRejectedValue(new Error('denied'))); await c.run('target-id')
  expect(c.notice).toHaveBeenLastCalledWith(expect.stringContaining('Could not copy'))
  expect(c.notice).not.toHaveBeenCalledWith('Session ID copied')
})

test('ignores missing IDs', async () => {
  const c = callback(); await c.run(''); expect(c.copy).not.toHaveBeenCalled(); expect(c.close).not.toHaveBeenCalled()
})

test('uses native clipboard with the exact ID', async () => {
  const writeText = vi.fn().mockResolvedValue(); vi.stubGlobal('navigator', { clipboard: { writeText } })
  await copyText('session-123'); expect(writeText).toHaveBeenCalledExactlyOnceWith('session-123')
})

test.each([true, false, 'throw'])('legacy copy cleans up on result %s', async result => {
  vi.stubGlobal('navigator', {})
  document.execCommand = vi.fn(() => { expect(document.querySelector('textarea').value).toBe('session-123'); if (result === 'throw') throw new Error('denied'); return result })
  if (result === true) await copyText('session-123'); else await expect(copyText('session-123')).rejects.toThrow()
  expect(document.querySelector('textarea')).toBeNull()
})

test('menu anchor stays inside short and narrow viewports', () => {
  const line = source.split('\n').find(x => x.includes('setMenuPos({ top: Math.max'))
  const place = new Function('rect', 'window', 'setMenuPos', line)
  for (const width of [320, 390, 1280]) for (const height of [240, 720]) {
    const set = vi.fn(); place({ top: height - 12, right: width }, { innerHeight: height, innerWidth: width }, set)
    const p = set.mock.calls[0][0]; expect(p.top).toBeGreaterThanOrEqual(8); expect(p.top + 194).toBeLessThanOrEqual(height - 8); expect(p.left + 164).toBeLessThanOrEqual(width - 8)
  }
})
