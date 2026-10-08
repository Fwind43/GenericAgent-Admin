import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { I18N } from '../lib/i18n'
import { useVersionUpdates } from '../hooks/useVersionUpdates'
import SystemUpdateModal from '../components/SystemUpdateModal'

vi.mock('../lib/api', () => ({ api: vi.fn() }))
vi.mock('../lib/danger', () => ({ confirmDanger: vi.fn() }))
const candidate = { update: true, latest: { tag_name: 'v1.2.3', body: '<script>not executable</script>\n## Notes' }, asset: {}, checksum: {} }
const ready = { id: 'op-1', stage: 'ready', running: true, progress: 90, target_version: 'v1.2.3', check: candidate }
let backendStatus
beforeEach(() => {
  vi.clearAllMocks()
  backendStatus = { stage: '', running: false }
  api.mockImplementation(async path => {
    if (path === '/api/version/info') return { version: 'v1.2.2', update_supported: true }
    if (path === '/api/version/status') return backendStatus
    if (path === '/api/version/check') return candidate
    if (path === '/api/autostart/status') return { supported: true }
    if (path === '/api/ga/git-status') return { available: false }
    return { ...backendStatus, stage: 'queued', running: true }
  })
  confirmDanger.mockResolvedValue(true)
  window.matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
})
afterEach(cleanup)
const posted = path => api.mock.calls.filter(([p, options]) => p === path && options?.method === 'POST')
async function hook(status = { stage: '', running: false }) {
  backendStatus = status
  const h = renderHook(() => useVersionUpdates({ t: I18N.en, lang: 'en', setMsg: vi.fn(), setBusy: vi.fn(), active: false }))
  await act(async () => { await h.result.current.loadSnapshot() })
  return h
}

describe('version action safety', () => {
  it('cancels without posting and releases the action lock', async () => {
    const h = await hook(ready)
    confirmDanger.mockResolvedValueOnce(false)
    await act(async () => { await h.result.current.restartVersion() })
    expect(posted('/api/version/restart')).toHaveLength(0)
    expect(h.result.current.busy).toBe(false)
    await act(async () => { await h.result.current.restartVersion() })
    expect(posted('/api/version/restart')[0][1]).toMatchObject({ dangerous: true, body: JSON.stringify({ operation_id: 'op-1' }) })
  })
  it('ignores a duplicate click while confirmation is pending', async () => {
    const h = await hook(ready)
    let accept
    confirmDanger.mockImplementationOnce(() => new Promise(resolve => { accept = resolve }))
    await act(async () => {
      const first = h.result.current.restartVersion()
      await h.result.current.restartVersion()
      accept(true)
      await first
    })
    expect(confirmDanger).toHaveBeenCalledTimes(1)
    expect(posted('/api/version/restart')).toHaveLength(1)
  })
  it('rejects a transaction replaced while the confirmation was open', async () => {
    const h = await hook(ready)
    confirmDanger.mockImplementationOnce(async () => { backendStatus = { ...ready, id: 'op-2' }; return true })
    await act(async () => { await h.result.current.restartVersion() })
    expect(posted('/api/version/restart')).toHaveLength(0)
    expect(h.result.current.actionError).toMatch(/operation changed/)
  })
  it('preserves the last snapshot on disconnection and blocks restart', async () => {
    const h = await hook(ready)
    api.mockImplementationOnce(async () => { throw new Error('disconnected') })
    await act(async () => { await h.result.current.refreshStatus().catch(() => {}) })
    expect(h.result.current.status.id).toBe('op-1')
    expect(h.result.current.statusError).toBe('disconnected')
    await act(async () => { await h.result.current.restartVersion() })
    expect(confirmDanger).not.toHaveBeenCalled()
    expect(posted('/api/version/restart')).toHaveLength(0)
  })
  it('does not prepare if another transaction started during confirmation', async () => {
    const h = await hook()
    await act(async () => { await h.result.current.checkVersion() })
    confirmDanger.mockImplementationOnce(async () => { backendStatus = ready; return true })
    await act(async () => { await h.result.current.updateVersion() })
    expect(posted('/api/version/update')).toHaveLength(0)
    expect(h.result.current.status.id).toBe('op-1')
  })
  it('retains release data but blocks prepare after a failed recheck', async () => {
    const h = await hook()
    await act(async () => { await h.result.current.checkVersion() })
    api.mockImplementationOnce(async () => { throw new Error('GitHub unavailable') })
    await act(async () => { await h.result.current.checkVersion() })
    expect(h.result.current.check.latest.tag_name).toBe('v1.2.3')
    expect(h.result.current.checkError).toBe('GitHub unavailable')
    await act(async () => { await h.result.current.updateVersion() })
    expect(posted('/api/version/update')).toHaveLength(0)
  })
})

it('shows prepared state, safe release text and distinct logs; closing does not call an action', () => {
  const close = vi.fn(), restart = vi.fn(), prepare = vi.fn()
  render(<SystemUpdateModal open onClose={close} lang="en" version={{ info: { version: 'v1.2.2', update_supported: true }, check: candidate, status: { ...ready, log: 'checksum verified' }, restartVersion: restart, updateVersion: prepare, refreshStatus: vi.fn().mockResolvedValue(ready) }} />)
  expect(screen.getByText('v1.2.2')).toBeTruthy()
  expect(screen.getByText(/this process still runs the old version/)).toBeTruthy()
  expect(document.querySelector('.system-update-release-text').textContent).toContain('<script>not executable</script>')
  expect(document.querySelector('.system-update-release-text script')).toBeNull()
  expect(screen.getByLabelText('Execution log').textContent).toBe('checksum verified')
  expect(screen.queryByRole('button', { name: 'Download & prepare' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Restart & apply' }))
  expect(restart).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getAllByRole('button', { name: 'Close', exact: true }).at(-1))
  expect(close).toHaveBeenCalledTimes(1)
  expect(prepare).not.toHaveBeenCalled()
})
