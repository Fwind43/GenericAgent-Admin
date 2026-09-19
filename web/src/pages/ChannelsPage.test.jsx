import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ChannelsPage } from './ChannelsPage'
import { I18N } from '../lib/i18n'
import { confirmDanger } from '../lib/danger'
import { api } from '../lib/api'
vi.mock('../lib/api', () => ({ api: vi.fn() }))
vi.mock('../lib/danger', () => ({ confirmDanger: vi.fn().mockResolvedValue(true) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('keeps channel drafts and pending scope visible after a rejected save', async () => {
 api.mockResolvedValueOnce({ path: '/fixture/config', profiles: [{ id: 'fixture', name: 'Fixture channel', fields: [{ name: 'endpoint', label: 'Endpoint', value: '' }] }] }).mockRejectedValueOnce(new Error('fixture rejected'))
 render(<ChannelsPage frontendSvcs={[]} t={I18N.en} />)
 const input = await screen.findByLabelText('Endpoint')
 fireEvent.change(input, { target: { value: 'https://fixture.invalid/draft' } })
 fireEvent.click(screen.getByRole('button', { name: I18N.en.save }))
 expect((await screen.findByRole('alert')).textContent).toContain('fixture rejected')
 expect(input.value).toBe('https://fixture.invalid/draft')
 expect(screen.getByRole('status').textContent).toBe(I18N.en.channels.pendingChanges(1))
 expect(api.mock.calls[1][1].method).toBe('PUT')
 expect(screen.getByText(I18N.en.channels.saveConfirm)).toBeTruthy()
})

it('groups fields, retains selection drafts, and confirms refresh or discard', async () => {
 const fixture = { path: '/fixture/config', profiles: ['one', 'two'].map(id => ({ id, name: id, fields: [{ name: 'endpoint', label: 'Endpoint', value: id }, { name: 'key', label: 'Key', secret: true, value: '' }, { name: 'fixture_allowed_users', label: 'Allowed', value: '' }] })) }
 api.mockResolvedValue(fixture)
 const state = vi.fn()
 render(<ChannelsPage frontendSvcs={[]} t={I18N.en} onDraftState={state}/>)
 const input = await screen.findByLabelText('Endpoint')
 expect(screen.getByText('Connection & behavior')).toBeTruthy()
 expect(screen.getByText('Access scope')).toBeTruthy()
 expect(screen.getByRole('group', { name: 'Credentials' })).toBeTruthy()
 fireEvent.change(input, { target: { value: 'draft' } })
 fireEvent.click(screen.getByRole('button', { name: /two/ }))
 expect(screen.getByLabelText('Endpoint').value).toBe('two')
 fireEvent.click(screen.getByRole('button', { name: /one/ }))
 expect(screen.getByLabelText('Endpoint').value).toBe('draft')
 confirmDanger.mockResolvedValueOnce(false)
 fireEvent.click(screen.getByRole('button', { name: I18N.en.refresh }))
 await new Promise(resolve => setTimeout(resolve, 0))
 expect(api).toHaveBeenCalledTimes(1)
 expect(screen.getByLabelText('Endpoint').value).toBe('draft')
 fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
 await screen.findByDisplayValue('one')
 expect(state).toHaveBeenLastCalledWith({ dirty: false, busy: false })
})
