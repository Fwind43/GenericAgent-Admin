import React from 'react'
import { readFileSync } from 'node:fs'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import example from './example.json'
import { readArchive, validateBundle, validateConfig, parseJSON } from './protocol'
import { createPluginStore } from './store'
import { ExternalUiProvider, useExternalUi, projectData, dispatchAction, ExternalView } from './runtime'
import { UiSurface } from '../UiHost'
import { useChatLayout } from './runtime'
import { PluginManager } from './PluginManager'
const fresh = () => JSON.parse(JSON.stringify(example))
const makeStore = () => { const db = new IDBFactory(); return createPluginStore(() => db) }
const archive = () => { const b = readFileSync('public/ui-plugins/local-workshop.gaui.zip'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
afterEach(cleanup)
function State() { const ui = useExternalUi(); return <output data-testid="active">{ui.bundle?.manifest.id || 'default'}</output> }
describe('external UI local package boundary', () => {
  it('connects real surfaces while preserving host draft identity', async () => {
    const store = makeStore(); await store.install(fresh())
    function Host() {
      const ui = useExternalUi(), layout = useChatLayout('chat.composer')
      return <><button onClick={() => ui.activate('local-workshop')}>activate fixture</button><button onClick={() => ui.activate('default')}>restore fixture</button><div data-testid="composer" {...layout}><textarea aria-label="Live draft" defaultValue="unsent"/></div><UiSurface name="admin.overview" viewProps={{ overview: { health: 'healthy', services: [], schedule: {} } }} fallback={<p>host overview</p>}/></>
    }
    render(<ExternalUiProvider store={store}><Host/></ExternalUiProvider>)
    const draft = screen.getByLabelText('Live draft')
    fireEvent.change(draft, { target: { value: 'keep this draft' } })
    fireEvent.click(screen.getByText('activate fixture'))
    await screen.findByRole('region', { name: 'Local Workshop admin.overview' })
    expect(screen.getByTestId('composer').dataset.gauiDensity).toBe('compact')
    expect(screen.getByTestId('composer').closest('.gaui-runtime').dataset.externalUi).toBe('active')
    expect(screen.getByLabelText('Live draft')).toBe(draft)
    fireEvent.click(screen.getByText('restore fixture'))
    await screen.findByText('host overview')
    expect(screen.getByLabelText('Live draft')).toBe(draft)
    expect(draft.value).toBe('keep this draft')
    expect(screen.getByTestId('composer').closest('.gaui-runtime').dataset.externalUi).toBeUndefined()
  })
  it('reads the actual shipped ZIP and defaults', () => {
    const b = readArchive(archive())
    expect(b.manifest.surfaces).toHaveLength(7)
    expect(b.config.accent).toBe('#557766')
    expect(b.config.density).toBe('compact')
  })
  it('rejects damaged, oversized and non-ZIP inputs', () => {
    const bytes = new Uint8Array(archive()); bytes[70] ^= 1
    expect(() => readArchive(bytes.buffer)).toThrow()
    expect(() => readArchive(new ArrayBuffer(1048577))).toThrow()
    expect(() => readArchive(new ArrayBuffer(32))).toThrow()
  })
  it('rejects executable fields, unknown surfaces, unsafe values and pollution', () => {
    for (const mutate of [b => { b.manifest.script = 'fetch(...)' }, b => { b.views['chat.composer'].before = { type: 'iframe', text: 'https://example.test' } }, b => { b.manifest.surfaces.push('admin.models') }, b => { b.views['admin.shell'].before.style = { background: 'url(https://example.test)' } }]) {
      const b = fresh(); mutate(b); expect(() => validateBundle(b)).toThrow()
    }
    expect(() => parseJSON('{"__proto__":{"polluted":true}}')).toThrow()
    expect(() => validateConfig(example.schema, { accent: 'red' })).toThrow()
    expect(() => validateConfig(example.schema, { unknown: 'x' })).toThrow()
    expect({}.polluted).toBeUndefined()
  })
  it('persists installs/config/selection across store instances and restores without deleting', async () => {
    const db = new IDBFactory(), s = createPluginStore(() => db)
    await s.install(fresh()); expect(await s.active()).toBe('default')
    await expect(s.install(fresh())).rejects.toThrow()
    expect(await s.list()).toHaveLength(1)
    await s.saveConfig('local-workshop', { accent: '#123456', density: 'comfortable' })
    await s.activate('local-workshop')
    const reloaded = createPluginStore(() => db)
    expect(await reloaded.active()).toBe('local-workshop')
    expect((await reloaded.load('local-workshop')).config.accent).toBe('#123456')
    await reloaded.activate('default'); await reloaded.activate('default')
    expect(await reloaded.active()).toBe('default')
    expect((await reloaded.list())[0].config.accent).toBe('#123456')
  })
  it('fails unavailable storage without claiming persistence', async () => {
    const s = createPluginStore(() => undefined)
    await expect(s.install(fresh())).rejects.toThrow('IndexedDB unavailable')
    await expect(s.activate('default')).rejects.toThrow('IndexedDB unavailable')
  })
  it('installs/selects/previews/saves/enables/restores through the formal manager', async () => {
    const store = makeStore(), enable = vi.fn()
    render(<ExternalUiProvider store={store} onEnable={enable}><PluginManager/><State/></ExternalUiProvider>)
    fireEvent.change(screen.getByLabelText('Install .gaui.zip'), { target: { files: [{ name: 'local-workshop.gaui.zip', size: archive().byteLength, arrayBuffer: async () => archive() }] } })
    await screen.findByText('Installed locally; not enabled')
    expect(screen.getByRole('option', { name: `${example.manifest.name} ${example.manifest.version}` })).toBeTruthy()
    expect(screen.getByTestId('active').textContent).toBe('default')
    fireEvent.change(screen.getByLabelText('Accent'), { target: { value: '#224466' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview', exact: true }))
    await screen.findByRole('region', { name: 'Fictional plugin preview' })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }))
    expect(screen.getByText('Simulated: refreshOverview')).toBeTruthy()
    expect(await store.active()).toBe('default'); expect(enable).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save plugin configuration' }))
    await screen.findByText('Configuration saved locally')
    fireEvent.click(screen.getByRole('button', { name: 'Enable plugin' }))
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('local-workshop'))
    expect(await store.active()).toBe('local-workshop')
    expect((await store.load('local-workshop')).config.accent).toBe('#224466')
    fireEvent.click(screen.getByRole('button', { name: 'Restore default' }))
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('default'))
    expect(await store.list()).toHaveLength(1)
  })
  it('reloads active package and safe mode ignores its selection', async () => {
    const store = makeStore(); await store.install(fresh()); await store.activate('local-workshop')
    const rendered = render(<ExternalUiProvider store={store}><State/></ExternalUiProvider>)
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('local-workshop'))
    rendered.unmount()
    render(<ExternalUiProvider store={store} disabled><State/></ExternalUiProvider>)
    expect(screen.getByTestId('active').textContent).toBe('default')
    expect(await store.active()).toBe('local-workshop')
  })
  it('uses allowlisted live projections and action callbacks only', () => {
    const go = vi.fn(), refreshOverview = vi.fn()
    const props = { navigation: { current: 'overview', groups: [{ items: [{ id: 'settings', label: 'Settings', secret: 'not exposed' }] }], go } }
    const data = projectData('admin.shell', props)
    expect(JSON.stringify(data)).not.toContain('secret')
    const node = { action: 'navigate', target: 'item.id' }
    dispatchAction('admin.shell', node, { id: 'bad' }, data, props); expect(go).not.toHaveBeenCalled()
    dispatchAction('admin.shell', node, { id: 'settings' }, data, props); expect(go).toHaveBeenCalledWith('settings')
    const overview = projectData('admin.overview', { overview: { health: 'ok', services: [{ name: 'Agent', running: true }], schedule: { total: 3 } } })
    expect(overview.services[0]).toEqual({ label: 'Agent', status: 'Running' })
    dispatchAction('admin.overview', { action: 'refreshOverview' }, null, overview, { actions: { refreshOverview, refreshing: true } }); expect(refreshOverview).not.toHaveBeenCalled()
    render(<ExternalView bundle={validateBundle(fresh())} area="admin.overview" data={overview} invoke={n => dispatchAction('admin.overview', n, null, overview, { actions: { refreshOverview } })}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' })); expect(refreshOverview).toHaveBeenCalledOnce()
    expect(screen.getByText('Agent')).toBeTruthy()
  })
})
