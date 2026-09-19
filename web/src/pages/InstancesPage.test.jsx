import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InstancesPage from './InstancesPage'
import { registerDialogAdapter } from '../lib/danger'

const reply = (payload, ok = true) => Promise.resolve({
  ok,
  status: ok ? 200 : 400,
  statusText: ok ? 'OK' : 'Bad Request',
  text: async () => JSON.stringify(payload),
})

const initialPayload = {
  default_instance_id: 'primary',
  items: [{ id: 'primary', name: 'Primary', ga_root: 'C:/ga', python_path: '', effective_python: 'C:/Python/python.exe' }],
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

describe('InstancesPage', () => {
  it('loads and identifies the default GA instance', async () => {
    globalThis.fetch = vi.fn(() => reply(initialPayload))
    render(<InstancesPage lang="en" />)

    expect(await screen.findByRole('heading', { name: 'Primary' })).not.toBeNull()
    expect(screen.getByText('Default')).not.toBeNull()
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/instances', expect.objectContaining({ headers: expect.any(Object) }))
  })

  it('opens model configuration for the selected instance', async () => {
    globalThis.fetch = vi.fn(() => reply(initialPayload))
    const onConfigureModels = vi.fn()
    const user = userEvent.setup()
    render(<InstancesPage lang="en" onConfigureModels={onConfigureModels} />)

    const primaryCard = (await screen.findByRole('heading', { name: 'Primary' })).closest('article')
    await user.click(within(primaryCard).getByRole('button', { name: 'Configure models' }))

    expect(onConfigureModels).toHaveBeenCalledTimes(1)
    expect(onConfigureModels).toHaveBeenCalledWith(initialPayload.items[0])
  })

  it('uploads an optional ZIP template as multipart form data', async () => {
    const installed = {
      default_instance_id: 'primary',
      items: [...initialPayload.items, { id: 'uploaded', name: 'uploaded', ga_root: 'C:/admin/uploaded', init_status: 'initializing' }],
      instance: { id: 'uploaded', name: 'uploaded', ga_root: 'C:/admin/uploaded', init_status: 'initializing' },
    }
    globalThis.fetch = vi.fn(url => url === '/api/instances/install' ? reply(installed) : reply(initialPayload))
    mockDialog()
    const user = userEvent.setup()
    render(<InstancesPage lang="en" />)

    await screen.findByRole('heading', { name: 'Primary' })
    await user.click(screen.getByRole('button', { name: 'One-click add' }))
    await user.type(screen.getByLabelText('Instance ID'), 'uploaded')
    const archive = new File(['zip fixture'], 'GA.zip', { type: 'application/zip' })
    await user.upload(screen.getByLabelText('GA.zip template (optional)'), archive)
    await user.click(screen.getByRole('button', { name: 'Start creating' }))

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    const [url, options] = globalThis.fetch.mock.calls[1]
    expect(url).toBe('/api/instances/install')
    expect(options.headers['X-GA-Confirm']).toBe('dangerous')
    expect(options.headers['Content-Type']).toBeUndefined()
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.body.get('id')).toBe('uploaded')
    expect(options.body.get('use_template')).toBe('true')
    expect(options.body.get('template').name).toBe('GA.zip')
  })

  it('adds an initializing instance immediately and polls it to ready', async () => {
    const initializing = {
      default_instance_id: 'primary',
      items: [...initialPayload.items, {
        id: 'genericagent',
        name: 'GenericAgent',
        ga_root: 'C:/admin/genericagent',
        effective_python: 'python',
        init_status: 'initializing',
        init_stage: 'queued',
        init_progress: 5,
      }],
    }
    const ready = {
      ...initializing,
      items: initializing.items.map(item => item.id === 'genericagent' ? { ...item, init_status: 'ready' } : item),
    }
    let listCalls = 0
    globalThis.fetch = vi.fn((url) => {
      if (url === '/api/instances/install') return reply(initializing)
      listCalls += 1
      return reply(listCalls === 1 ? initialPayload : ready)
    })
    const confirmSpy = mockDialog()
    const user = userEvent.setup()
    render(<InstancesPage lang="en" />)

    await screen.findByRole('heading', { name: 'Primary' })
    await user.click(screen.getByRole('button', { name: 'One-click add' }))
    expect(screen.getByRole('heading', { name: 'Choose the new instance ID' })).not.toBeNull()
    expect(screen.queryByLabelText('Display name')).toBeNull()
    expect(screen.queryByLabelText('GenericAgent root')).toBeNull()
    await user.type(screen.getByLabelText('Instance ID'), 'genericagent')
    await user.click(screen.getByRole('button', { name: 'Start creating' }))

    expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ operation: 'install_instance' }))
    const [url, options] = globalThis.fetch.mock.calls[1]
    expect(url).toBe('/api/instances/install')
    expect(options.method).toBe('POST')
    expect(options.headers['X-GA-Confirm']).toBe('dangerous')
    expect(JSON.parse(options.body)).toEqual({ id: 'genericagent', use_template: false })

    const installedHeading = await screen.findByRole('heading', { name: 'GenericAgent' })
    const installedCard = installedHeading.closest('article')
    expect(within(installedCard).getByText('Initializing')).not.toBeNull()
    expect(within(installedCard).getByText('Waiting to start')).not.toBeNull()
    const initProgress = within(installedCard).getByRole('progressbar', { name: 'Waiting to start' })
    expect(initProgress.value).toBe(5)
    expect(within(installedCard).getByText('C:/admin/genericagent')).not.toBeNull()
    expect(within(installedCard).getByRole('button', { name: 'Edit' }).disabled).toBe(true)
    expect(within(installedCard).getByRole('button', { name: 'Set as default' }).disabled).toBe(true)
    expect(within(installedCard).getByRole('button', { name: 'Delete' }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'One-click add' }).disabled).toBe(false)
    expect(screen.getByText('Instance added and initializing in the background')).not.toBeNull()

    await waitFor(() => expect(within(installedCard).getByText('Ready')).not.toBeNull(), { timeout: 3000 })
    expect(within(installedCard).queryByRole('progressbar')).toBeNull()
    expect(within(installedCard).getByRole('button', { name: 'Edit' }).disabled).toBe(false)
    expect(within(installedCard).getByRole('button', { name: 'Set as default' }).disabled).toBe(false)
    expect(listCalls).toBe(2)
  })

  it('defaults to the persistent template when one is available', async () => {
    const payload = { ...initialPayload, template_available: true }
    globalThis.fetch = vi.fn(() => reply(payload))
    mockDialog()
    const user = userEvent.setup()
    render(<InstancesPage lang="en" />)

    await screen.findByRole('heading', { name: 'Primary' })
    await user.click(screen.getByRole('button', { name: 'One-click add' }))
    const reuse = screen.getByRole('checkbox', { name: 'Use the saved GA.zip template' })
    expect(reuse.checked).toBe(true)
    expect(reuse.disabled).toBe(false)
    expect(screen.getByText('A saved template is ready to reuse.')).not.toBeNull()
    await user.type(screen.getByLabelText('Instance ID'), 'from-template')
    await user.click(screen.getByRole('button', { name: 'Start creating' }))

    const [url, options] = globalThis.fetch.mock.calls[1]
    expect(url).toBe('/api/instances/install')
    expect(JSON.parse(options.body)).toEqual({ id: 'from-template', use_template: true })
  })

  it('shows initialization failure details and stops polling', async () => {
    const initializing = {
      default_instance_id: 'primary',
      items: [...initialPayload.items, {
        id: 'genericagent',
        name: 'GenericAgent',
        ga_root: 'C:/admin/genericagent',
        effective_python: 'python',
        init_status: 'initializing',
      }],
    }
    const failed = {
      ...initializing,
      items: initializing.items.map(item => item.id === 'genericagent' ? {
        ...item,
        init_status: 'failed',
        init_error: 'download failed: test network unavailable',
      } : item),
    }
    let listCalls = 0
    globalThis.fetch = vi.fn(() => {
      listCalls += 1
      return reply(listCalls === 1 ? initializing : failed)
    })
    render(<InstancesPage lang="en" />)

    const installedHeading = await screen.findByRole('heading', { name: 'GenericAgent' })
    const installedCard = installedHeading.closest('article')
    expect(within(installedCard).getByText('Initializing')).not.toBeNull()
    await waitFor(() => expect(within(installedCard).getByText('Initialization failed')).not.toBeNull(), { timeout: 3000 })
    expect(within(installedCard).getByText('download failed: test network unavailable')).not.toBeNull()
    expect(within(installedCard).getByRole('button', { name: 'Edit' }).disabled).toBe(false)
    expect(within(installedCard).getByRole('button', { name: 'Set as default' }).disabled).toBe(false)

    const callsAfterFailure = listCalls
    await new Promise(resolve => window.setTimeout(resolve, 1400))
    expect(listCalls).toBe(callsAfterFailure)
  })

  it('confirms creation and sends the dangerous confirmation header', async () => {
    const created = {
      default_instance_id: 'primary',
      items: [...initialPayload.items, { id: 'secondary', name: 'Secondary', ga_root: 'D:/ga', effective_python: 'python' }],
    }
    globalThis.fetch = vi.fn((url) => url === '/api/instances' ? reply(initialPayload) : reply(created))
    mockDialog()
    const user = userEvent.setup()
    render(<InstancesPage lang="en" />)

    await screen.findByRole('heading', { name: 'Primary' })
    await user.click(screen.getByRole('button', { name: 'Add instance' }))
    const editor = screen.getByRole('form', { name: 'Create GA instance' })
    expect(within(editor).getByText('Set the instance identity and local runtime.')).not.toBeNull()
    expect(editor.querySelectorAll('.instance-editor-actions')).toHaveLength(1)
    expect(editor.querySelector('.instance-editor-footer .instance-editor-actions')).not.toBeNull()
    expect(editor.querySelector('.instance-editor-heading-icon')).not.toBeNull()
    expect(within(editor).getByRole('group', { name: 'Instance identity' })).not.toBeNull()
    expect(within(editor).getByRole('group', { name: 'Runtime environment' })).not.toBeNull()
    await user.type(screen.getByLabelText('Instance ID'), 'secondary')
    await user.type(screen.getByLabelText('Display name'), 'Secondary')
    await user.type(screen.getByLabelText('GenericAgent root'), 'D:/ga')
    await user.click(screen.getByRole('button', { name: 'Create instance' }))

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    const [url, options] = globalThis.fetch.mock.calls[1]
    expect(url).toBe('/api/instances/create')
    expect(options.method).toBe('POST')
    expect(options.headers['X-GA-Confirm']).toBe('dangerous')
    expect(JSON.parse(options.body)).toMatchObject({ id: 'secondary', name: 'Secondary', ga_root: 'D:/ga' })
    expect(await screen.findByRole('heading', { name: 'Secondary' })).not.toBeNull()
  })

  it('updates an instance without allowing its ID to change', async () => {
    const updated = {
      ...initialPayload,
      items: [{ ...initialPayload.items[0], name: 'Primary updated', python_path: 'C:/Python/python.exe' }],
    }
    globalThis.fetch = vi.fn((url) => url === '/api/instances' ? reply(initialPayload) : reply(updated))
    mockDialog()
    const user = userEvent.setup()
    render(<InstancesPage lang="en" />)

    const heading = await screen.findByRole('heading', { name: 'Primary' })
    await user.click(within(heading.closest('article')).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Instance ID').disabled).toBe(true)
    await user.clear(screen.getByLabelText('Display name'))
    await user.type(screen.getByLabelText('Display name'), 'Primary updated')
    await user.type(screen.getByLabelText('Python path'), 'C:/Python/python.exe')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    const [url, options] = globalThis.fetch.mock.calls[1]
    expect(url).toBe('/api/instances/update')
    expect(options.method).toBe('PUT')
    expect(options.headers['X-GA-Confirm']).toBe('dangerous')
    expect(JSON.parse(options.body)).toEqual({
      id: 'primary',
      name: 'Primary updated',
      ga_root: 'C:/ga',
      python_path: 'C:/Python/python.exe',
    })
    expect(await screen.findByRole('heading', { name: 'Primary updated' })).not.toBeNull()
  })

  it('keeps the reserved default instance non-deletable after switching the active default', async () => {
    const protectedDefault = { id: 'default', name: 'Default', ga_root: 'C:/ga', python_path: '', effective_python: 'python' }
    const secondary = { id: 'secondary', name: 'Secondary', ga_root: 'D:/ga', python_path: '', effective_python: 'python' }
    globalThis.fetch = vi.fn(() => reply({
      default_instance_id: 'secondary',
      items: [protectedDefault, secondary],
    }))
    const user = userEvent.setup()
    render(<InstancesPage lang="en" />)

    const defaultCard = (await screen.findByRole('heading', { name: 'Default' })).closest('article')
    const deleteButton = within(defaultCard).getByRole('button', { name: 'Delete' })
    expect(deleteButton.disabled).toBe(true)
    await user.click(deleteButton)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('uses an in-page confirmation and cancels without deleting', async () => {
    const secondary = { id: 'secondary', name: 'Secondary', ga_root: 'D:/ga', python_path: '', effective_python: 'python' }
    globalThis.fetch = vi.fn(() => reply({ ...initialPayload, items: [...initialPayload.items, secondary] }))
    const confirmSpy = mockDialog()
    const user = userEvent.setup()
    render(<InstancesPage lang="en" />)

    const secondaryCard = (await screen.findByRole('heading', { name: 'Secondary' })).closest('article')
    await user.click(within(secondaryCard).getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog', { name: 'Confirm instance deletion' })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(confirmSpy).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Confirm instance deletion' })).toBeNull()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('sets another default before deleting the previous default', async () => {
    const secondary = { id: 'secondary', name: 'Secondary', ga_root: 'D:/ga', python_path: '', effective_python: 'python' }
    const twoInstances = { ...initialPayload, items: [...initialPayload.items, secondary] }
    const secondaryDefault = { ...twoInstances, default_instance_id: 'secondary' }
    const secondaryOnly = { ...secondaryDefault, items: [secondary] }
    globalThis.fetch = vi.fn((url) => {
      if (url === '/api/instances') return reply(twoInstances)
      if (url === '/api/instances/default') return reply(secondaryDefault)
      return reply(secondaryOnly)
    })
    mockDialog()
    const user = userEvent.setup()
    render(<InstancesPage lang="en" />)

    const primaryHeading = await screen.findByRole('heading', { name: 'Primary' })
    const primaryCard = primaryHeading.closest('article')
    expect(within(primaryCard).getByRole('button', { name: 'Delete' }).disabled).toBe(true)
    const secondaryCard = screen.getByRole('heading', { name: 'Secondary' }).closest('article')
    await user.click(within(secondaryCard).getByRole('button', { name: 'Set as default' }))

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    let [url, options] = globalThis.fetch.mock.calls[1]
    expect(url).toBe('/api/instances/default')
    expect(options.method).toBe('PUT')
    expect(options.headers['X-GA-Confirm']).toBe('dangerous')
    expect(JSON.parse(options.body)).toEqual({ id: 'secondary' })

    await user.click(within(screen.getByRole('heading', { name: 'Primary' }).closest('article')).getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', { name: 'Confirm instance deletion' })
    expect(within(dialog).getByText(/Primary/)).not.toBeNull()
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    await user.click(within(dialog).getByRole('button', { name: 'Delete instance' }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3))
    ;[url, options] = globalThis.fetch.mock.calls[2]
    expect(url).toBe('/api/instances/delete')
    expect(options.method).toBe('DELETE')
    expect(options.headers['X-GA-Confirm']).toBe('dangerous')
    expect(JSON.parse(options.body)).toEqual({ id: 'primary' })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Primary' })).toBeNull())
    expect(screen.getByRole('heading', { name: 'Secondary' })).not.toBeNull()
  })
})

it('announces a load failure and allows a safe refresh retry', async () => {
 globalThis.fetch = vi.fn().mockImplementationOnce(() => reply({error:'Fixture unavailable'}, false)).mockImplementation(() => reply(initialPayload))
 const user=userEvent.setup()
 render(<InstancesPage lang="en" />)
 expect(await screen.findByRole('alert')).not.toBeNull()
 await user.click(screen.getByRole('button', {name:'Refresh'}))
 expect(await screen.findByRole('heading', {name:'Primary'})).not.toBeNull()
})
