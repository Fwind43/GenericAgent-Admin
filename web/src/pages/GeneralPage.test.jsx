import React, { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeneralPage } from './GeneralPage'
import { I18N, SETTINGS_TEXT } from '../lib/i18n'
import { registerDialogAdapter } from '../lib/danger'

const reply = (payload, ok = true) => Promise.resolve({
  ok,
  status: ok ? 200 : 400,
  statusText: ok ? 'OK' : 'Bad Request',
  text: async () => JSON.stringify(payload),
})

const baseConfig = { ga_root: 'C:/ga', proxy_mode: 'off', port: 8787, remote_access: false, remote_allow_anonymous: false }

// The page is a controlled editor, so the harness owns the config draft the
// same way App does and exposes the saved payload for assertions.
function Harness({ config = baseConfig, onSave = () => {} }) {
  const [cfg, setCfg] = useState(config)
  const [root, setRoot] = useState(config.ga_root || '')
  return <GeneralPage
    t={I18N.en}
    lang="en"
    text={SETTINGS_TEXT.en}
    cfg={cfg}
    setCfg={setCfg}
    root={root}
    setRoot={setRoot}
    savedCfg={config}
    onSave={() => onSave(cfg)}
    busy={false}
    theme="light"
    setTheme={() => {}}
    onLanguage={() => {}}
    autostart={{ supported: true, enabled: false }}
    onToggleAutostart={() => {}}
  />
}

// SettingToggle folds the hint into the same <label>, so switches are matched
// by their role and a name prefix instead of an exact label string.
const toggle = (name) => screen.getByRole('switch', { name: new RegExp(name) })

const mockBackend = ({ auth = { username: 'admin', passwordSet: false, managedByEnvironment: false }, listen = { address: '127.0.0.1:52341' }, onCall } = {}) => {
  const fetchMock = vi.fn((url, options = {}) => {
    onCall?.(url, options)
    if (url === '/api/auth/status') return reply(auth)
    if (url === '/api/health') return reply({ ok: true, listen })
    if (url === '/api/auth/password') return reply({ ok: true, passwordSet: options.method !== 'DELETE' })
    return reply({})
  })
  globalThis.fetch = fetchMock
  return fetchMock
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

describe('GeneralPage update mirror', () => {
  it('edits the GitHub mirror and includes it in the saved config', async () => {
    mockBackend()
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.en.network.title }))

    const input = await screen.findByLabelText('GitHub mirror')
    await user.type(input, 'https://mirror.example')
    await user.click(screen.getAllByRole('button', { name: /save changes/i })[0])

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].github_mirror).toBe('https://mirror.example')
  })
})

describe('GeneralPage remote access', () => {
  it('shows the real listen address instead of the configured port', async () => {
    mockBackend()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.en.remote.title }))

    expect(await screen.findByText('127.0.0.1:52341')).not.toBeNull()
  })

  it('keeps the port and password controls hidden while remote access is off', async () => {
    mockBackend()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.en.remote.title }))

    await screen.findByText('127.0.0.1:52341')
    expect(screen.queryByLabelText('Fixed port')).toBeNull()
    expect(screen.queryByRole('switch', { name: /Require a password/ })).toBeNull()
  })

  it('reveals the port and password requirement once remote access is enabled', async () => {
    mockBackend()
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.en.remote.title }))

    await screen.findByText('127.0.0.1:52341')
    await user.click(toggle('Allow remote access'))

    expect(screen.getByLabelText('Fixed port').value).toBe('8787')
    // Password protection is the default, and the page says a password is still missing.
    expect(toggle('Require a password').checked).toBe(true)
    expect(screen.getByText(/Set an access password below/)).not.toBeNull()
  })

  it('warns loudly when the operator opts out of the remote password', async () => {
    mockBackend()
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.en.remote.title }))

    await screen.findByText('127.0.0.1:52341')
    await user.click(toggle('Allow remote access'))
    await user.click(toggle('Require a password'))

    expect(screen.getByText(/anonymous remote access is allowed/i)).not.toBeNull()
  })

  it('saves remote access as a config change', async () => {
    mockBackend()
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.en.remote.title }))

    await screen.findByText('127.0.0.1:52341')
    await user.click(toggle('Allow remote access'))
    const saveButtons = screen.getAllByRole('button', { name: /Save changes/ })
    await user.click(saveButtons[saveButtons.length - 1])

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ remote_access: true }))
  })

  it('sets a first password without asking for a current one', async () => {
    const calls = []
    mockBackend({ onCall: (url, options) => calls.push([url, options]) })
    mockDialog()
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.en.remote.title }))

    await screen.findByText('127.0.0.1:52341')
    expect(screen.queryByPlaceholderText('Current password')).toBeNull()
    await user.type(screen.getByPlaceholderText('New password'), 'correct-horse')
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: /Set password/ }))

    await waitFor(() => expect(screen.getByText('Password updated.')).not.toBeNull())
    const [, options] = calls.find(([url]) => url === '/api/auth/password')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ currentPassword: '', newPassword: 'correct-horse', confirmPassword: 'correct-horse' })
    // Once a password exists the form switches to change mode and offers removal.
    expect(screen.getByPlaceholderText('Current password')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Remove password/ })).not.toBeNull()
  })

  it('rejects a mismatched confirmation before calling the API', async () => {
    const calls = []
    mockBackend({ onCall: (url) => calls.push(url) })
    const confirmSpy = mockDialog()
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.en.remote.title }))

    await screen.findByText('127.0.0.1:52341')
    await user.type(screen.getByPlaceholderText('New password'), 'correct-horse')
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'correct-mouse')
    await user.click(screen.getByRole('button', { name: /Set password/ }))

    expect(screen.getByText('The passwords do not match.')).not.toBeNull()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(calls).not.toContain('/api/auth/password')
  })

  it('rejects a password below the minimum length', async () => {
    mockBackend()
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.en.remote.title }))

    await screen.findByText('127.0.0.1:52341')
    await user.type(screen.getByPlaceholderText('New password'), 'short')
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'short')
    await user.click(screen.getByRole('button', { name: /Set password/ }))

    expect(screen.getByText('The password needs at least 8 characters.')).not.toBeNull()
  })

  it('requires the current password once one is configured', async () => {
    mockBackend({ auth: { username: 'admin', passwordSet: true, managedByEnvironment: false } })
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.en.remote.title }))

    const change = await screen.findByRole('button', { name: /Change password/ })
    await user.type(screen.getByPlaceholderText('New password'), 'correct-horse')
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'correct-horse')
    expect(change.disabled).toBe(true)

    await user.type(screen.getByPlaceholderText('Current password'), 'old-secret')
    expect(change.disabled).toBe(false)
  })

  it('removes the password through DELETE after a confirmation', async () => {
    const calls = []
    mockBackend({ auth: { username: 'admin', passwordSet: true, managedByEnvironment: false }, onCall: (url, options) => calls.push([url, options]) })
    mockDialog()
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.en.remote.title }))

    await user.click(await screen.findByRole('button', { name: /Remove password/ }))

    await waitFor(() => expect(screen.getByText('Password removed.')).not.toBeNull())
    const [, options] = calls.find(([url]) => url === '/api/auth/password')
    expect(options.method).toBe('DELETE')
    expect(screen.getByRole('button', { name: /Set password/ })).not.toBeNull()
  })

  it('surfaces a rejected removal from the backend', async () => {
    globalThis.fetch = vi.fn((url, options = {}) => {
      if (url === '/api/auth/status') return reply({ username: 'admin', passwordSet: true, managedByEnvironment: false })
      if (url === '/api/health') return reply({ ok: true, listen: { address: '0.0.0.0:8787' } })
      if (url === '/api/auth/password' && options.method === 'DELETE') return reply({ error: 'remote access requires a password' }, false)
      return reply({})
    })
    mockDialog()
    const user = userEvent.setup()
    render(<Harness config={{ ...baseConfig, remote_access: true }} />)
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.en.remote.title }))

    await user.click(await screen.findByRole('button', { name: /Remove password/ }))

    await waitFor(() => expect(screen.getByText('remote access requires a password')).not.toBeNull())
  })

  it('hides the password form when the credential comes from the environment', async () => {
    mockBackend({ auth: { username: 'operator', passwordSet: true, managedByEnvironment: true } })
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.en.remote.title }))

    expect(await screen.findByText(/GA_ADMIN_AUTH_USER/)).not.toBeNull()
    expect(screen.queryByPlaceholderText('New password')).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove password/ })).toBeNull()
  })
})
