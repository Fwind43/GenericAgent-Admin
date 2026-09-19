import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSchedule } from './useSchedule'
import { api } from '../lib/api'
vi.mock('../lib/api', () => ({ api: vi.fn() }))
vi.mock('../lib/danger', () => ({ confirmDanger: vi.fn(async () => true) }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const setup = () => {
 api.mockImplementation(async (path) => path === '/api/schedule/tasks' ? { tasks: [] } : { id: 'first', raw: { prompt: 'original', custom: { keep: true } } })
 return renderHook(() => useSchedule({ t: { hints: {} }, lang: 'en', setMsg: vi.fn(), setBusy: vi.fn() }))
}
it('retains unknown fields on form save and resets the exact saved baseline', async () => {
 const { result } = setup()
 await act(async () => result.current.loadTask('first'))
 act(() => result.current.setEditor(JSON.stringify({ prompt: 'edited', custom: { keep: true } })))
 expect(result.current.dirty).toBe(true)
 await act(async () => result.current.saveTask())
 const request = api.mock.calls.find(([, options]) => options?.method === 'PUT')
 expect(JSON.parse(request[1].body).raw.custom).toEqual({ keep: true })
 expect(result.current.dirty).toBe(false)
})
it('cancelled selection and creation preserve the draft without requests', async () => {
 const { result } = setup()
 await act(async () => result.current.loadTask('first'))
 act(() => result.current.setEditor('{"prompt":"draft"}'))
 const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
 api.mockClear()
 await act(async () => result.current.loadTask('second'))
 await act(async () => result.current.createTask())
 expect(confirm).toHaveBeenCalledTimes(2)
 expect(api).not.toHaveBeenCalled()
 expect(result.current.taskId).toBe('first')
 expect(result.current.editor).toBe('{"prompt":"draft"}')
})
it('failed saves and edits made during save remain dirty', async () => {
 const { result } = setup()
 await act(async () => result.current.loadTask('first'))
 act(() => result.current.setEditor('{"prompt":"draft"}'))
 api.mockRejectedValueOnce(new Error('fixture failure'))
 await act(async () => result.current.saveTask())
 expect(result.current.dirty).toBe(true)
 let resolveSave
 api.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve }))
 let pending
 await act(async () => { pending = result.current.saveTask() })
 act(() => result.current.setEditor('{"prompt":"newer edit"}'))
 await act(async () => { resolveSave({}); await pending })
 expect(result.current.editor).toBe('{"prompt":"newer edit"}')
 expect(result.current.dirty).toBe(true)
})
