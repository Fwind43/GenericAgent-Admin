import React from 'react'
import {afterEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {LogsPage} from './LogsPage'
import {I18N} from '../lib/i18n'
afterEach(cleanup)
const t=I18N.en
function props(){return {t,services:[{name:'fixture-source',kind:'fixture',running:false}],onStart:vi.fn(),onStop:vi.fn(),stream:{selected:'fixture-source',streamState:'reconnecting',filter:'needle',tailLines:200,follow:false,lines:['fixture needle','other'],viewRef:{current:null},...Object.fromEntries(['select','setFilter','setTailLines','setFollow','retry','clear','handleScroll'].map(k=>[k,vi.fn()]))}}}
it('retries without clearing source, filter or follow state',()=>{
 const p=props();render(<LogsPage {...p}/>);fireEvent.click(screen.getByRole('button',{name:t.logsPage.reconnect}))
 expect(p.stream.retry).toHaveBeenCalledTimes(1);expect(p.stream.clear).not.toHaveBeenCalled();expect(p.stream.setFollow).not.toHaveBeenCalled()
 expect(screen.getByLabelText(t.logsPage.filter).value).toBe('needle')
 expect(screen.getByRole('alert')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:t.retry}));expect(p.stream.retry).toHaveBeenCalledTimes(2)
})
it('preserves filter, wrap, source and jump callbacks',()=>{
 const p=props();render(<LogsPage {...p}/>);fireEvent.click(screen.getByRole('button',{name:t.logsPage.wrap}));expect(document.querySelector('.log-view').dataset.wrap).toBe('off')
 fireEvent.click(screen.getByRole('button',{name:t.logsPage.clearFilter}));expect(p.stream.setFilter).toHaveBeenCalledWith('')
 fireEvent.click(screen.getByRole('button',{name:t.logsPage.jumpLatest}));expect(p.stream.setFollow).toHaveBeenCalledWith(true)
 fireEvent.click(screen.getByRole('button',{name:/fixture-source/}));expect(p.stream.select).toHaveBeenCalledWith('fixture-source')
 fireEvent.scroll(document.querySelector('.log-view'));expect(p.stream.handleScroll).toHaveBeenCalledTimes(1)
})

it('filters sources without changing selected output and separates service actions from reading tools',()=>{
 const p=props();p.services.push({name:'other-source',kind:'fixture',running:true});render(<LogsPage {...p}/>);
 fireEvent.change(screen.getByLabelText(`${t.search}: ${t.logsPage.serviceList}`),{target:{value:'other'}});
 expect(screen.queryByRole('button',{name:/fixture-source/})).toBeNull();expect(screen.getByRole('button',{name:/other-source/})).toBeTruthy();
 expect(screen.getByLabelText(t.logsPage.output('fixture-source')).textContent).toContain('fixture needle');
 expect(p.stream.select).not.toHaveBeenCalled();expect(p.onStart).not.toHaveBeenCalled();expect(p.onStop).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:t.logsPage.reconnect}).closest('.log-console-head')).toBeTruthy();
 expect(screen.getByRole('button',{name:t.logsPage.wrap}).closest('.log-console-bar')).toBeTruthy();
 fireEvent.change(screen.getByLabelText(`${t.search}: ${t.logsPage.serviceList}`),{target:{value:'missing'}});expect(screen.getByText(t.empty)).toBeTruthy();
})
