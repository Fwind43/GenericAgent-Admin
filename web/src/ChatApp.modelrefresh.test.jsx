import React, { useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { MODELS_CHANGE_EVENT, useRuntimeModelRefresh } from './lib/useRuntimeModelRefresh.js'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const mount = (fetchState, sid = 'abc') => renderHook(() => {
  const [llms, setLlms] = useState([])
  const [llmNo, setLlmNo] = useState(0)
  useRuntimeModelRefresh({ sidRef: { current: sid }, fetchState, setLlms, setLlmNo })
  return { llms, llmNo }
})

describe('the chat composer reacts to a provider save in the same document', () => {
  test('the event refetches the active session and keeps the current model', async () => {
    const fetchState = vi.fn(async () => ({ llms: [{ index: 0 }, { index: 3 }] }))
    const view = mount(fetchState)
    expect(fetchState).not.toHaveBeenCalled()
    act(() => { window.dispatchEvent(new Event('ga-admin-models-change')) })
    await waitFor(() => expect(view.result.current.llms.length).toBe(2))
    expect(fetchState).toHaveBeenCalledWith('/api/chat/state/abc')
    expect(fetchState).not.toHaveBeenCalledWith('abc')
    expect(view.result.current.llmNo).toBe(0)
  })

  test('a model saved in another tab falls back to the first runtime model', async () => {
    const fetchState = vi.fn(async () => ({ llms: [{ index: 5, model: 'gpt' }] }))
    const view = mount(fetchState)
    act(() => { view.result.current.llms })
    act(() => { window.dispatchEvent(new Event('ga-admin-models-change')) })
    await waitFor(() => expect(view.result.current.llms.length).toBe(1))
    expect(view.result.current.llmNo).toBe(5)
  })

  test('a failing refetch keeps the previous selection', async () => {
    const fetchState = vi.fn(async () => { throw new Error('offline') })
    const view = mount(fetchState)
    act(() => { window.dispatchEvent(new Event('ga-admin-models-change')) })
    await waitFor(() => expect(fetchState).toHaveBeenCalled())
    expect(view.result.current.llms).toEqual([])
    expect(view.result.current.llmNo).toBe(0)
  })

})

describe('the URL the refresh actually requests', () => {
  // Mirrors ChatApp's wiring: fetchState = sid => chatApi(runtimeStateUrl(sid)).
  const mountWired = (sid, chatApi) => renderHook(() => {
    const [llms, setLlms] = useState([])
    const [llmNo, setLlmNo] = useState(0)
    useRuntimeModelRefresh({
      sidRef: { current: sid },
      fetchState: url => chatApi(url),
      setLlms,
      setLlmNo,
    })
    return { llms, llmNo }
  })

  test('an open session requests /api/chat/state/<sid>', async () => {
    const chatApi = vi.fn(async () => ({ llms: [{ index: 2 }] }))
    const view = mountWired('abc', chatApi)
    act(() => { window.dispatchEvent(new Event(MODELS_CHANGE_EVENT)) })
    await waitFor(() => expect(chatApi).toHaveBeenCalled())
    expect(chatApi).toHaveBeenCalledWith('/api/chat/state/abc')
    expect(chatApi.mock.calls[0][0]).not.toBe('abc')
  })

  test('no session requests the shared /api/chat/state', async () => {
    const chatApi = vi.fn(async () => ({ llms: [{ index: 2 }] }))
    const view = mountWired('', chatApi)
    act(() => { window.dispatchEvent(new Event(MODELS_CHANGE_EVENT)) })
    await waitFor(() => expect(chatApi).toHaveBeenCalled())
    expect(chatApi).toHaveBeenCalledWith('/api/chat/state')
  })
})

test('the settings page and the chat listener agree on one event name', () => {
  expect(MODELS_CHANGE_EVENT).toBe('ga-admin-models-change')
})
