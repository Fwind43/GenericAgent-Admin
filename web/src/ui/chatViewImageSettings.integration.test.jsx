import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useViewImageModel } from '../hooks/useViewImageModel'
import { DefaultChatViewImageSettings } from './chatViewImageSettings'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'

vi.mock('../lib/api', () => ({ api: vi.fn() }))
vi.mock('../lib/danger', () => ({ confirmDanger: vi.fn() }))
const setMsg = vi.fn()
const labels = { title: 'Image viewing', description: 'd', toggle: 'Enable view_image tool', toggleHelp: 'h', on: 'On', off: 'Off', mode: 'Who reads', modeMain: 'Main', modeVision: 'Vision', modeMainHelp: 'mh', modeVisionHelp: 'vh', model: 'Vision model', modelHelp: 'm', save: 'Save', saving: 'Saving', scope: 's' }
const option = { provider_var_name: 'fixture', provider_display_name: 'Offline', model: 'eye-model' }
const choice = JSON.stringify(['fixture', 'eye-model'])
function Harness() {
  const v = useViewImageModel({ lang: 'en', setMsg, active: true })
  return <DefaultChatViewImageSettings model={{ enabled: v.enabled, mode: v.mode, draft: v.draft, busy: v.saving, feedback: v.feedback, missingModel: v.missingModel, options: v.options, labels }}
    actions={{ setEnabled: v.setEnabled, setMode: v.setMode, selectModel: v.setDraft, save: v.submit }}/>
}
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body).config)
const toggle = () => screen.getByLabelText(labels.toggle, { exact: false })
const modeSelect = () => document.getElementById('settings-view-image-mode')
const save = () => screen.getByRole('button', { name: labels.save })
let saved
const loaded = async () => { await waitFor(() => expect(api).toHaveBeenCalledTimes(1)); await act(async () => {}) }
beforeEach(() => {
  vi.clearAllMocks()
  saved = { enable: false, mode: 'main', provider_var_name: '', model: '' }
  confirmDanger.mockResolvedValue(true)
  api.mockImplementation(async (url, o) => {
    if (url !== '/api/models/view-image-model') throw new Error('Unexpected endpoint ' + url)
    if (o?.method === 'PUT') { saved = JSON.parse(o.body).config; return { config: saved } }
    return { config: saved, options: [option] }
  })
})
afterEach(cleanup)

it('loads disabled state and keeps mode select disabled until enabled', async () => {
  render(<Harness/>)
  await loaded()
  expect(modeSelect().disabled).toBe(true)
  expect(document.getElementById('settings-view-image-model')).toBeNull()
})

it('saves main mode without a model', async () => {
  render(<Harness/>)
  await loaded()
  fireEvent.click(toggle())
  expect(modeSelect().disabled).toBe(false)
  fireEvent.click(save())
  await waitFor(() => expect(puts()).toHaveLength(1))
  expect(puts()[0]).toMatchObject({ enable: true, mode: 'main', provider_var_name: '', model: '' })
  expect(confirmDanger).toHaveBeenCalledWith('models-view-image', expect.any(String))
})

it('vision mode requires a model and then saves the chosen one', async () => {
  render(<Harness/>)
  await loaded()
  fireEvent.click(toggle())
  fireEvent.change(modeSelect(), { target: { value: 'vision' } })
  const model = document.getElementById('settings-view-image-model')
  expect(model).not.toBeNull()
  fireEvent.click(save())
  expect(await screen.findByText('Vision mode requires a vision model')).toBeTruthy()
  expect(puts()).toHaveLength(0)
  fireEvent.change(model, { target: { value: choice } })
  fireEvent.click(save())
  await waitFor(() => expect(puts()).toHaveLength(1))
  expect(puts()[0]).toMatchObject({ enable: true, mode: 'vision', provider_var_name: 'fixture', model: 'eye-model', llm_no: 0 })
})

it('cancelled confirmation sends nothing', async () => {
  confirmDanger.mockResolvedValue(false)
  render(<Harness/>)
  await loaded()
  fireEvent.click(toggle())
  fireEvent.click(save())
  await waitFor(() => expect(confirmDanger).toHaveBeenCalled())
  expect(puts()).toHaveLength(0)
})
