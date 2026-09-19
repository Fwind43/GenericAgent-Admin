import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ChannelsPage } from './ChannelsPage'
import { I18N } from '../lib/i18n'
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
