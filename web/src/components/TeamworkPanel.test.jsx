import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import TeamworkPanel from './TeamworkPanel'
import { registerDialogAdapter } from '../lib/danger'
import { api } from '../lib/api'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const ct = (_, english) => english
const member = { id: 'review', name: 'Reviewer', role: 'Verify evidence', llm_no: 2 }
function setup(overrides = {}) {
  const props = {
    detail: { id: 'lead', conductor: { role: 'parent', team: [member] } },
    request: vi.fn(async (url, options) => url.endsWith('/models')
      ? { models: [{ index: 2, model: 'review-model' }, { index: 7, model: 'writer-model' }] }
      : { conductor: { role: 'parent', team: options?.body ? JSON.parse(options.body).members : [] } }),
    onChanged: vi.fn(), onOpen: vi.fn(), onClose: vi.fn(), ct, ...overrides,
  }
  return { ...render(<TeamworkPanel {...props}/>), props }
}
it('saves editable named members with runtime model indices', async () => {
  const { props } = setup()
  await screen.findByRole('option', { name: '#7 writer-model' })
  fireEvent.change(screen.getByLabelText('Name 1'), { target: { value: 'Writer' } })
  fireEvent.change(screen.getByLabelText('Model 1'), { target: { value: '7' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save team' }))
  await waitFor(() => expect(props.onChanged).toHaveBeenCalled())
  expect(props.request).toHaveBeenLastCalledWith('/api/chat/conductor/lead/teamwork', {
    method: 'POST', body: JSON.stringify({ members: [{ ...member, name: 'Writer', llm_no: 7 }] }),
  })
  expect(screen.getByRole('dialog').parentElement.parentElement).toBe(document.body)
})
it('locks editing during unfinished work and shows member results', async () => {
  setup({ detail: { id: 'lead', conductor: { role: 'parent', team: [member] }, conductor_children: [
    { dispatch_id: 'job', session_id: 'worker', member_name: 'Reviewer', status: 'running', objective: 'Check sources', summary: 'Evidence found' },
  ] } })
  await screen.findByRole('option', { name: '#2 review-model' })
  expect(screen.getByLabelText('Name 1').matches(':disabled')).toBe(true)
  expect(screen.getByText('Evidence found')).toBeTruthy()
})
it('keeps failed saves visible without reporting success', async () => {
  const { props } = setup({ request: vi.fn(async url => {
    if (url.endsWith('/models')) return { models: [{ index: 2, model: 'review-model' }] }
    throw new Error('Session is running')
  }) })
  await screen.findByRole('option', { name: '#2 review-model' })
  fireEvent.click(screen.getByRole('button', { name: 'Save team' }))
  await screen.findByText('Session is running')
  expect(props.onChanged).not.toHaveBeenCalled()
})
it('does not apply a late save after the panel is unmounted', async () => {
  let finish
  const { props, unmount } = setup({ request: vi.fn(url => url.endsWith('/models')
    ? Promise.resolve({ models: [{ index: 2, model: 'review-model' }] })
    : new Promise(resolve => { finish = resolve })) })
  await screen.findByRole('option', { name: '#2 review-model' })
  fireEvent.click(screen.getByRole('button', { name: 'Save team' }))
  unmount()
  finish({ conductor: { role: 'parent', team: [member] } })
  await Promise.resolve()
  expect(props.onChanged).not.toHaveBeenCalled()
})

for (const accepted of [false, true]) {
  it(`requires confirmation before enabling coordination (accepted=${accepted})`, async () => {
    const confirm = vi.fn(() => accepted)
    const unregister = registerDialogAdapter(confirm)
    try {
      const { props } = setup({ detail: { id: 'lead' } })
      await waitFor(() => expect(screen.queryByText('Loading models…')).toBeNull())
      fireEvent.click(screen.getByRole('button', { name: 'Enable lead coordination' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Enable lead coordination' }).disabled).toBe(false))
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ kind: 'confirm', operation: 'conductor-enable' }))
      const writes = props.request.mock.calls.filter(([, options]) => options?.method === 'POST')
      expect(writes).toEqual(accepted ? [['/api/chat/conductor/lead/enable', { method: 'POST', dangerous: true, body: JSON.stringify({ dangerous: true }) }]] : [])
      expect(props.onChanged).toHaveBeenCalledTimes(accepted ? 1 : 0)
    } finally { unregister() }
  })
}
it('does not enable after unmount while confirmation is pending', async () => {
  let finish
  const unregister = registerDialogAdapter(() => new Promise(resolve => { finish = resolve }))
  try {
    const { props, unmount } = setup({ detail: { id: 'lead' } })
    await waitFor(() => expect(screen.queryByText('Loading models…')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Enable lead coordination' }))
    expect(screen.getByRole('button', { name: 'Enable lead coordination' }).disabled).toBe(true)
    unmount()
    finish(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(props.request.mock.calls.filter(([, options]) => options?.method === 'POST')).toEqual([])
    expect(props.onChanged).not.toHaveBeenCalled()
  } finally { unregister() }
})

it('sends valid JSON through the real API wrapper when saving members', async () => {
  const fetchMock = vi.fn(async (url, options) => {
    let result
    if (url.endsWith('/models')) result = { models: [{ index: 2, model: 'review-model' }] }
    else {
      expect(options.headers['Content-Type']).toBe('application/json')
      expect(typeof options.body).toBe('string')
      const body = JSON.parse(options.body)
      expect(body).toEqual({ members: [member] })
      result = { conductor: { role: 'parent', team: body.members } }
    }
    return { ok: true, text: async () => JSON.stringify(result) }
  })
  vi.stubGlobal('fetch', fetchMock)
  const { props } = setup({ request: api })
  await screen.findByRole('option', { name: '#2 review-model' })
  fireEvent.click(screen.getByRole('button', { name: 'Save team' }))
  await waitFor(() => expect(props.onChanged).toHaveBeenCalledWith({ role: 'parent', team: [member] }))
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
it('sends confirmed enable as JSON with the confirmation header through the real API wrapper', async () => {
  const unregister = registerDialogAdapter(() => true)
  const fetchMock = vi.fn(async (url, options) => {
    if (url.endsWith('/enable')) {
      expect(options.headers['X-GA-Confirm']).toBe('dangerous')
      expect(typeof options.body).toBe('string')
      expect(JSON.parse(options.body)).toEqual({ dangerous: true })
    }
    const result = url.endsWith('/models') ? { models: [] } : { conductor: { role: 'parent', team: [] } }
    return { ok: true, text: async () => JSON.stringify(result) }
  })
  vi.stubGlobal('fetch', fetchMock)
  try {
    const { props } = setup({ request: api, detail: { id: 'lead' } })
    await waitFor(() => expect(screen.queryByText('Loading models…')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Enable lead coordination' }))
    await waitFor(() => expect(props.onChanged).toHaveBeenCalledWith({ role: 'parent', team: [] }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  } finally { unregister() }
})
