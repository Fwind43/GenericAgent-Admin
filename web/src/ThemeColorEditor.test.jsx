import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ThemeColorEditor from './ThemeColorEditor'
import { CUSTOM_COLOR_TOKENS, CUSTOM_COLORS_STYLE_ID, CUSTOM_COLORS_STORAGE_KEY, customColorsToAntd, hydrateCustomColors, persistCustomColorsLocal, sanitizeColorValue } from './themes'

beforeEach(() => {
  localStorage.clear()
  delete window.__GA_UI_CUSTOM_COLORS__
  persistCustomColorsLocal({ accent: '#abcdef' })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.__GA_UI_CUSTOM_COLORS__ })
const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit colors' }))
const change = value => fireEvent.change(screen.getByLabelText('accent', { exact: true }), { target: { value } })
it('lists all 34 tokens; preview and cancel never persist; malformed colors block save', () => {
  render(<ThemeColorEditor theme="warm" />); edit()
  expect(screen.getAllByRole('textbox')).toHaveLength(CUSTOM_COLOR_TOKENS.length)
  change('#123456')
  expect(document.getElementById(CUSTOM_COLORS_STYLE_ID).textContent).toContain('--accent:#123456')
  expect(JSON.parse(localStorage.getItem(CUSTOM_COLORS_STORAGE_KEY))).toEqual({ accent: '#abcdef' })
  change('rgb(999,0,0)')
  expect(screen.getByRole('button', { name: 'Save colors' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }))
  expect(document.getElementById(CUSTOM_COLORS_STYLE_ID).textContent).toContain('--accent:#abcdef')
  expect(fetch).not.toHaveBeenCalled()
})
it('keeps failed draft, awaits retry and clears only overrides on explicit save', async () => {
  fetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => '{"error":"fixture"}' })
  render(<ThemeColorEditor theme="dark" />); edit(); change('#123456')
  fireEvent.click(screen.getByRole('button', { name: 'Save colors' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('accent', { exact: true }).value).toBe('#123456')
  expect(JSON.parse(localStorage.getItem(CUSTOM_COLORS_STORAGE_KEY))).toEqual({ accent: '#abcdef' })
  fireEvent.click(screen.getByRole('button', { name: 'Save colors' }))
  await screen.findByRole('status')
  expect(JSON.parse(localStorage.getItem(CUSTOM_COLORS_STORAGE_KEY))).toEqual({ accent: '#123456' })
  edit(); fireEvent.click(screen.getByRole('button', { name: 'Restore defaults (draft)' }))
  expect(localStorage.getItem(CUSTOM_COLORS_STORAGE_KEY)).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Save colors' }))
  await waitFor(() => expect(localStorage.getItem(CUSTOM_COLORS_STORAGE_KEY)).toBeNull())
  expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toEqual({ theme: 'dark', custom: {} })
})
it('cancels on leaving the settings group and unmount', () => {
  const view = render(<ThemeColorEditor theme="light" />); edit(); change('#123456')
  view.rerender(<ThemeColorEditor theme="light" active={false} />)
  expect(document.getElementById(CUSTOM_COLORS_STYLE_ID).textContent).toContain('--accent:#abcdef')
  view.rerender(<ThemeColorEditor theme="light" />); edit(); change('#456789'); view.unmount()
  expect(document.getElementById(CUSTOM_COLORS_STYLE_ID).textContent).toContain('--accent:#abcdef')
})
it('server empty reset wins stale cache, but a late response cannot overwrite editing', async () => {
  fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{"custom":{}}' })
  await hydrateCustomColors()
  expect(localStorage.getItem(CUSTOM_COLORS_STORAGE_KEY)).toBeNull()
  let resolve
  fetch.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const loading = hydrateCustomColors()
  await waitFor(() => expect(resolve).toBeTypeOf('function'))
  render(<ThemeColorEditor theme="warm" />); edit(); change('#123456')
  resolve({ ok: true, status: 200, text: async () => '{"custom":{"accent":"#999999"}}' })
  await loading
  expect(document.getElementById(CUSTOM_COLORS_STYLE_ID).textContent).toContain('--accent:#123456')
})
it('validates color grammar and maps semantic AntD tokens', () => {
  for (const value of ['#12', '#12345', 'rgb(256,0,0)', 'rgba(1,2,3,2)', 'var(--x)', 'red;display:none']) expect(sanitizeColorValue(value)).toBe('')
  for (const value of ['#1234', '#12345678', 'rgb(255,0,1)', 'rgba(1,2,3,.5)']) expect(sanitizeColorValue(value)).toBe(value)
  expect(customColorsToAntd({ 'accent-text': '#112233', success: '#123456', focus: '#abcdef', 'on-accent': '#fff' })).toMatchObject({ colorLink: '#112233', colorSuccess: '#123456', controlOutline: '#abcdef', colorTextLightSolid: '#fff' })
})
