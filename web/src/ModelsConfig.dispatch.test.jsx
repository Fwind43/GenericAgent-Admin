import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

vi.mock('./lib/danger', () => ({ confirmDanger: vi.fn(async () => true) }))
vi.mock('./lib/api', () => ({ api: vi.fn(async url => (url === '/api/models/export' ? { updated_at: '2026-09-19T00:00:00Z' } : {})) }))

import { useModelsConfig } from './hooks/useModelsConfig'
import { MODELS_CHANGE_EVENT } from './lib/useRuntimeModelRefresh.js'
import { api } from './lib/api'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const options = onPersist => ({
  t: { hints: { modelsSaved: 'saved' } },
  lang: 'en',
  setMsg: vi.fn(),
  setBusy: vi.fn(),
  active: true,
  onPersist,
})

describe('saving providers announces the shared document change', () => {
  test('saveAll writes to /api/models/export and dispatches ga-admin-models-change', async () => {
    const events = []
    const listener = () => events.push('models-change')
    window.addEventListener(MODELS_CHANGE_EVENT, listener)
    const onPersist = vi.fn()
    const { result } = renderHook(() => useModelsConfig(options(onPersist)))
    let saved
    await act(async () => { saved = await result.current.saveAll() })
    window.removeEventListener(MODELS_CHANGE_EVENT, listener)
    expect(saved).toBe(true)
    const call = api.mock.calls.find(([url]) => url === '/api/models/export')
    expect(call).toBeTruthy()
    expect(call[1].method).toBe('POST')
    expect(JSON.parse(call[1].body)).toMatchObject({ overwrite_active: true })
    expect(events).toEqual(['models-change'])
    expect(onPersist).toHaveBeenCalledTimes(1)
  })

  test('a rejected save reports the error and dispatches nothing', async () => {
    const events = []
    const listener = () => events.push('models-change')
    window.addEventListener(MODELS_CHANGE_EVENT, listener)
    api.mockImplementation(async url => {
      if (url === '/api/models/export') throw new Error('export failed')
      return {}
    })
    const setMsg = vi.fn()
    const { result } = renderHook(() => useModelsConfig({ ...options(vi.fn()), setMsg }))
    let saved
    await act(async () => { saved = await result.current.saveAll() })
    window.removeEventListener(MODELS_CHANGE_EVENT, listener)
    expect(saved).toBe(false)
    expect(events).toEqual([])
    expect(setMsg).toHaveBeenCalledWith('export failed')
  })
})
