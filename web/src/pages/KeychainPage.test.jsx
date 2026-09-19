import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeychainPage } from './KeychainPage'
import { SETTINGS_TEXT } from '../lib/i18n'
import { registerDialogAdapter } from '../lib/danger'

const reply = payload => Promise.resolve({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: async () => JSON.stringify(payload),
})

const setup = (initial = ['ALPHA_KEY', 'BETA_KEY'], props = {}) => {
  let keys = [...initial]
  const calls = []
  globalThis.fetch = vi.fn((url, options = {}) => {
    calls.push([url, options])
    const body = options.body ? JSON.parse(options.body) : null
    if (options.method === 'PUT') keys = [...new Set([...keys, body.name])].sort()
    if (options.method === 'DELETE') keys = keys.filter(key => key !== body.name)
    return reply({ keys })
  })
  render(<KeychainPage text={SETTINGS_TEXT.en} {...props}/>)
  return calls
}


let unregisterDialogAdapter = () => {}
const mockDialog = (result = true) => {
  const adapter = vi.fn(() => result)
  unregisterDialogAdapter()
  unregisterDialogAdapter = registerDialogAdapter(adapter)
  return adapter
}

afterEach(() => {
  unregisterDialogAdapter()
  unregisterDialogAdapter = () => {}
  cleanup()
  vi.restoreAllMocks()
})

describe('KeychainPage', () => {
  it('lists names and never renders secret values', async () => {
    setup()
    expect(await screen.findByText('ALPHA_KEY')).not.toBeNull()
    expect(screen.getByText('BETA_KEY')).not.toBeNull()
    expect(screen.queryByText('actual-secret')).toBeNull()
    expect(screen.getByText('2')).not.toBeNull()
  })

  it('writes a key with dangerous confirmation and clears the secret input', async () => {
    const calls = setup([])
    mockDialog()
    const user = userEvent.setup()

    await screen.findByText('No keys saved')
    await user.type(screen.getByLabelText('Name'), 'NEW_KEY')
    const secret = screen.getByLabelText('Secret value')
    await user.type(secret, 'actual-secret')
    await user.click(screen.getByRole('button', { name: 'Save key' }))

    await screen.findByText('NEW_KEY')
    const put = calls.find(([, options]) => options.method === 'PUT')
    expect(put[1].headers['X-GA-Confirm']).toBe('dangerous')
    expect(JSON.parse(put[1].body)).toEqual({ name: 'NEW_KEY', value: 'actual-secret' })
    expect(secret.value).toBe('')
    expect(screen.queryByText('actual-secret')).toBeNull()
  })

  it('deletes by name with dangerous confirmation', async () => {
    const calls = setup(['REMOVE_ME'])
    mockDialog()
    const user = userEvent.setup()

    await screen.findByText('REMOVE_ME')
    await user.click(screen.getByRole('button', { name: 'Remove REMOVE_ME' }))
    await waitFor(() => expect(screen.queryByText('REMOVE_ME')).toBeNull())

    const remove = calls.find(([, options]) => options.method === 'DELETE')
    expect(remove[1].headers['X-GA-Confirm']).toBe('dangerous')
    expect(JSON.parse(remove[1].body)).toEqual({ name: 'REMOVE_ME' })
  })
})

 it('keeps failed writes visible and preserves the draft for retry', async () => {
    setup([])
    mockDialog()
    const user = userEvent.setup()
    await screen.findByText('No keys saved')
    await user.type(screen.getByLabelText('Name'), 'RETRY_KEY')
    await user.type(screen.getByLabelText('Secret value'), 'fixture-only')
    globalThis.fetch.mockImplementationOnce(() => Promise.reject(new Error('fixture write failed')))
    await user.click(screen.getByRole('button', { name: 'Save key' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('fixture write failed'))
    expect(screen.getByLabelText('Name').value).toBe('RETRY_KEY')
    expect(screen.getByLabelText('Secret value').value).toBe('fixture-only')
    expect(screen.getByRole('status').closest('.keychain-editor')).toBeNull()
  })

it('admin selection guards drafts, cancels replacement, and retries failed writes without reading values', async () => {
 const state = vi.fn()
 const calls = setup(['ALPHA_KEY', 'BETA_KEY'], { adminWorkspace: true, onDraftState: state })
 const dialog = mockDialog()
 const user = userEvent.setup()
 await user.click(await screen.findByRole('button', { name: 'ALPHA_KEY' }))
 expect(screen.getByLabelText('Name').readOnly).toBe(true)
 expect(screen.getByLabelText('Secret value').value).toBe('')
 await user.type(screen.getByLabelText('Secret value'), 'fixture-only')
 dialog.mockReturnValueOnce(false)
 await user.click(screen.getByRole('button', { name: 'BETA_KEY' }))
 expect(screen.getByLabelText('Name').value).toBe('ALPHA_KEY')
 expect(screen.getByLabelText('Secret value').value).toBe('fixture-only')
 globalThis.fetch.mockImplementationOnce(() => Promise.reject(new Error('fixture rejected')))
 await user.click(screen.getByRole('button', { name: 'Save key' }))
 await waitFor(() => expect(screen.getByRole('status').textContent).toBe('fixture rejected'))
 expect(screen.getByLabelText('Secret value').value).toBe('fixture-only')
 await user.click(screen.getByRole('button', { name: 'Cancel editing' }))
 expect(screen.getByLabelText('Secret value').value).toBe('')
 expect(screen.getByRole('button', { name: 'ALPHA_KEY' }).getAttribute('aria-pressed')).toBe('true')
 await user.type(screen.getByLabelText('Secret value'), 'fixture-retry')
 await user.click(screen.getByRole('button', { name: 'Save key' }))
 await waitFor(() => expect(screen.getByLabelText('Secret value').value).toBe(''))
 expect(state).toHaveBeenLastCalledWith({ dirty: false, busy: false })
 expect(calls.filter(([, o]) => !o.method || o.method === 'GET')).toHaveLength(1)
 expect(calls.every(([url]) => url === '/api/keychain')).toBe(true)
})
