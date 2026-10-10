import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import GitHubMirrorSetting from './GitHubMirrorSetting'
vi.mock('../lib/api', () => ({ api: vi.fn() }))
vi.mock('../lib/danger', () => ({ confirmDanger: vi.fn() }))
afterEach(cleanup)
beforeEach(() => { api.mockReset(); confirmDanger.mockReset(); confirmDanger.mockResolvedValue(true) })
const input = () => screen.getByRole('textbox', { name: 'GitHub 镜像地址' })
const save = () => screen.getByRole('button', { name: '保存镜像' })
const loaded = async () => { await waitFor(() => expect(input().disabled).toBe(false)) }
const edit = value => fireEvent.change(input(), { target: { value } })
const writes = () => api.mock.calls.filter(([, options]) => options?.method === 'PUT')

it('fetches the latest saved snapshot and changes only the mirror after confirmation', async () => {
  const latest = { github_mirror: 'https://old.example', port: 8920, ui_theme: 'warm', instances: [{ id: 'default', name: 'Unchanged' }] }
  api.mockResolvedValueOnce({ github_mirror: 'https://old.example', port: 8910 })
    .mockResolvedValueOnce(latest).mockResolvedValueOnce({ ...latest, github_mirror: 'https://new.example' })
  render(<GitHubMirrorSetting/>); await loaded()
  expect(input().value).toBe('https://old.example'); expect(save().disabled).toBe(true)
  edit(' https://new.example '); fireEvent.submit(input().closest('form'))
  await screen.findByText('镜像配置已保存')
  expect(confirmDanger).toHaveBeenCalledWith('config-save', expect.any(String))
  expect(api.mock.calls[1]).toEqual(['/api/config'])
  expect(writes()).toEqual([['/api/config', { dangerous: true, method: 'PUT', body: JSON.stringify({ ...latest, github_mirror: 'https://new.example' }) }]])
  expect(input().value).toBe('https://new.example'); expect(save().disabled).toBe(true)
  fireEvent.submit(input().closest('form')); expect(writes()).toHaveLength(1)
})

it('allows clearing the mirror to restore direct access', async () => {
  api.mockResolvedValueOnce({ github_mirror: 'https://old.example' }).mockResolvedValueOnce({ github_mirror: 'https://old.example', port: 8910 }).mockResolvedValueOnce({ github_mirror: '' })
  render(<GitHubMirrorSetting/>); await loaded(); edit(''); fireEvent.click(save())
  await screen.findByText('镜像配置已保存')
  expect(JSON.parse(writes()[0][1].body)).toEqual({ github_mirror: '', port: 8910 })
})

it('cancelled confirmation keeps the draft without writing', async () => {
  api.mockResolvedValue({ github_mirror: '' }); confirmDanger.mockResolvedValue(false)
  render(<GitHubMirrorSetting/>); await loaded(); edit('https://new.example'); fireEvent.click(save())
  await waitFor(() => expect(save().disabled).toBe(false))
  expect(api).toHaveBeenCalledTimes(1); expect(input().value).toBe('https://new.example')
})

it('does not write after closing while confirmation is pending', async () => {
  let resolve; confirmDanger.mockReturnValue(new Promise(r => { resolve = r }))
  api.mockResolvedValue({ github_mirror: '' })
  const view = render(<GitHubMirrorSetting/>); await loaded(); edit('https://new.example'); fireEvent.click(save())
  view.unmount(); await act(async () => resolve(true)); expect(api).toHaveBeenCalledTimes(1)
})

it('keeps a rejected draft and permits retry', async () => {
  api.mockResolvedValueOnce({ github_mirror: '' }).mockResolvedValueOnce({ github_mirror: '', port: 8910 })
    .mockRejectedValueOnce(new Error('invalid mirror')).mockResolvedValueOnce({ github_mirror: '', port: 8920 }).mockResolvedValueOnce({ github_mirror: 'https://retry.example' })
  render(<GitHubMirrorSetting/>); await loaded(); edit('https://retry.example'); fireEvent.click(save())
  expect((await screen.findByRole('alert')).textContent).toContain('invalid mirror')
  expect(input().value).toBe('https://retry.example'); expect(save().disabled).toBe(false)
  fireEvent.click(save()); await screen.findByText('镜像配置已保存'); expect(writes()).toHaveLength(2)
  expect(JSON.parse(writes()[1][1].body).port).toBe(8920)
})

it('blocks edits on load failure and can reload', async () => {
  api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ github_mirror: 'https://loaded.example' })
  render(<GitHubMirrorSetting/>); expect((await screen.findByRole('alert')).textContent).toContain('offline')
  expect(input().disabled).toBe(true); expect(save().disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '重新读取' })); await loaded(); expect(input().value).toBe('https://loaded.example')
})

it('blocks saving during an update and suppresses duplicate confirmation', async () => {
  api.mockResolvedValue({ github_mirror: '' })
  const view = render(<GitHubMirrorSetting disabled/>); await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  expect(input().disabled).toBe(true)
  view.rerender(<GitHubMirrorSetting/>); await loaded(); edit('https://new.example')
  let resolve; confirmDanger.mockReturnValue(new Promise(r => { resolve = r }))
  fireEvent.submit(input().closest('form')); fireEvent.submit(input().closest('form'))
  expect(confirmDanger).toHaveBeenCalledTimes(1)
  await act(async () => resolve(false)); expect(api).toHaveBeenCalledTimes(1)
})

it('does not write if the update becomes busy during confirmation', async () => {
  api.mockResolvedValue({ github_mirror: '' })
  let resolve; confirmDanger.mockReturnValue(new Promise(r => { resolve = r }))
  const view = render(<GitHubMirrorSetting/>); await loaded(); edit('https://new.example'); fireEvent.click(save())
  view.rerender(<GitHubMirrorSetting disabled/>); await act(async () => resolve(true))
  expect(api).toHaveBeenCalledTimes(1)
})

it('does not write if closed or an update starts while the fresh snapshot is loading', async () => {
  let resolve; api.mockResolvedValueOnce({ github_mirror: '' }).mockReturnValueOnce(new Promise(r => { resolve = r }))
  const view = render(<GitHubMirrorSetting/>); await loaded(); edit('https://new.example'); fireEvent.click(save())
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2)); view.rerender(<GitHubMirrorSetting disabled/>)
  await act(async () => resolve({ github_mirror: '', port: 8910 })); expect(writes()).toHaveLength(0)
  view.unmount()
})

it('refuses to write without a fresh snapshot and preserves the draft', async () => {
  api.mockResolvedValueOnce({ github_mirror: '' }).mockRejectedValueOnce(new Error('fresh snapshot unavailable'))
  render(<GitHubMirrorSetting/>); await loaded(); edit('https://new.example'); fireEvent.click(save())
  expect((await screen.findByRole('alert')).textContent).toContain('fresh snapshot unavailable')
  expect(writes()).toHaveLength(0); expect(input().value).toBe('https://new.example')
})

it('supports the English labels', async () => {
  api.mockResolvedValue({ github_mirror: '' }); render(<GitHubMirrorSetting lang="en"/>)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'GitHub mirror URL' }).disabled).toBe(false))
  expect(screen.getByRole('button', { name: 'Save mirror' }).disabled).toBe(true)
})
