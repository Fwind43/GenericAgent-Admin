import React, { useEffect, useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRegistry, manifest, surfaceView, validateManifest } from './contract'
import { canActivate, readSelection, SELECTION_KEY, writeSelection } from './selection'
import { overviewModel } from './overview'
import { UiHost, UiSurface, useUiPackage } from './UiHost'
import { defaults } from './default'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })
it('validates manifest, duplicate, incompatible and missing views', async () => {
  expect(() => validateManifest({...manifest('studio'),hostUiApi:'^2.0.0'})).toThrow()
  expect(() => validateManifest({...manifest('studio'),surfaces:['chat']})).toThrow()
  expect(() => validateManifest({...manifest('studio'),capabilities:['config.write']})).toThrow()
  const r = createRegistry(); r.register(manifest('studio'),async()=>({views:{}}))
  expect(()=>r.register(manifest('studio'),()=>({}))).toThrow()
  await expect(r.load('studio')).rejects.toThrow('Missing UI view')
  await expect(r.load('unknown')).rejects.toThrow('Unknown UI package')
  expect(surfaceView({views:{}},'admin.shell',defaults)).toBe(defaults.views['admin.shell'])
})
it('handles stale selection and storage failures', () => {
  localStorage.setItem(SELECTION_KEY,'broken'); expect(readSelection(localStorage,()=>true)).toBe('default')
  writeSelection(localStorage,'gone'); expect(readSelection(localStorage,()=>false)).toBe('default')
  expect(writeSelection(null,'studio')).toBe(false)
  expect(readSelection(null,()=>true)).toBe('default')
  writeSelection(localStorage,'studio'); expect(readSelection(localStorage,id=>id==='studio')).toBe('studio')
})
it('limits activation to idle clean overview', () => {
  expect(canActivate({tab:'overview'})).toBe(true)
  for(const state of [{tab:'files'},{tab:'overview',dirty:true},{tab:'overview',busy:true}]) expect(canActivate(state)).toBe(false)
})
it('maps actual host fields and excludes sensitive payloads', () => {
  const model=overviewModel({services:[{name:'worker',running:true,command:'secret'}],schedule:{task_count:2,tasks:[{enabled:true,prompt:'secret'}]},observability:{ok:true,generatedAt:'now',root:'secret',checks:[{name:'core',state:'ok'}]}})
  expect(model.schedule).toEqual({total:2,enabled:1,due:0}); expect(model.health).toBe('ok')
  expect(model.checks[0].ok).toBe(true); expect(model.updatedAt).toBe('now')
  expect(JSON.stringify(model)).not.toContain('secret')
})
const candidate = {manifest:manifest('studio'),views:{'admin.shell':()=> <nav>candidate shell</nav>,'admin.overview':()=> <p>candidate overview</p>}}
function makeRegistry(pkg=candidate) { const r=createRegistry();r.register(defaults.manifest,async()=>defaults);r.register(pkg.manifest,async()=>pkg);return r }
function Harness({guard=()=>true,onMount=()=>{}}) {
  const ui=useUiPackage()
  return <><button onClick={()=>ui.select('studio',guard)}>enable</button><button onClick={()=>ui.select('default',guard)}>default</button><span role="status">{ui.message}</span><UiSurface name="admin.shell" fallback={<nav>default shell</nav>}/><Persistent onMount={onMount}/><UiSurface name="admin.overview" fallback={<p>default overview</p>}/></>
}
function Persistent({onMount}) { const [text,setText]=useState('draft');useEffect(()=>{onMount()},[]);return <input aria-label="persistent" value={text} onChange={e=>setText(e.target.value)}/> }
it('switches and persists while preserving sibling state',async()=>{
 const mounted=vi.fn(); render(<UiHost packageRegistry={makeRegistry()}><Harness onMount={mounted}/></UiHost>)
 fireEvent.change(screen.getByLabelText('persistent'),{target:{value:'kept'}})
 fireEvent.click(screen.getByText('enable')); await screen.findByText('candidate shell')
 await waitFor(()=>expect(readSelection(localStorage,()=>true)).toBe('studio'))
 fireEvent.click(screen.getByText('default'));await screen.findByText('default shell')
 expect(screen.getByLabelText('persistent').value).toBe('kept'); expect(mounted).toHaveBeenCalledTimes(1)
 await waitFor(()=>expect(readSelection(localStorage,()=>true)).toBe('default'))
})
it('rechecks guard after deferred import',async()=>{
 let resolve;let allowed=true;const r=makeRegistry();r.load=()=>new Promise(done=>{resolve=done})
 render(<UiHost packageRegistry={r}><Harness guard={()=>allowed}/></UiHost>);fireEvent.click(screen.getByText('enable'));allowed=false;resolve(candidate)
 await waitFor(()=>expect(screen.queryByText('candidate shell')).toBeNull());expect(screen.getByText('default shell')).toBeTruthy()
})
it('falls back on load failure',async()=>{
 const r=makeRegistry();r.load=async()=>{throw new Error('import failed')}
 render(<UiHost packageRegistry={r}><Harness/></UiHost>);fireEvent.click(screen.getByText('enable'))
 await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('Package failed'));expect(screen.getByText('default shell')).toBeTruthy()
})
it('render failure restores only affected surface and safe persistence',async()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{})
 const broken={...candidate,views:{...candidate.views,'admin.overview':()=>{throw new Error('render failed')}}}
 render(<UiHost packageRegistry={makeRegistry(broken)}><Harness/></UiHost>);fireEvent.click(screen.getByText('enable'))
 await screen.findByText('candidate shell');await screen.findByText('default overview')
 await waitFor(()=>expect(readSelection(localStorage,()=>true)).toBe('default'))
})
it('safe host never loads persisted candidate',()=>{
 writeSelection(localStorage,'studio');const r=makeRegistry();const load=vi.spyOn(r,'load')
 render(<UiHost disabled packageRegistry={r}><Harness/></UiHost>);fireEvent.click(screen.getByText('enable'));expect(load).not.toHaveBeenCalled();expect(screen.getByText('default shell')).toBeTruthy()
})
it('preview does not change persisted selection',async()=>{
 writeSelection(localStorage,'default');render(<UiHost preview packageRegistry={makeRegistry()}><Harness/></UiHost>)
 await screen.findByText('candidate shell');expect(readSelection(localStorage,()=>true)).toBe('default')
})
