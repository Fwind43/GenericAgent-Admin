import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {GoalsPage} from './GoalsPage'
import {I18N} from '../lib/i18n'
globalThis.React=React
afterEach(cleanup)
const t=I18N.en
function props(){return {t,goals:[],objective:'fixture draft',budget:10,maxTurns:5,llmNo:'',outputBytes:65536,selected:'fixture',output:'',...Object.fromEntries(['setObjective','setBudget','setMaxTurns','setLLMNo','setHive','setOutputBytes','setAutoRefresh','onStart','onStop','onDelete','onRefresh','onOutput','onClearOutput','setMsg'].map(k=>[k,vi.fn()]))}}
it('refreshes the empty runs view and retains start draft across tabs',()=>{
 const p=props();render(<GoalsPage {...p}/>);expect(screen.getByRole('status').textContent).toBe(t.empty)
 fireEvent.click(screen.getByRole('button',{name:t.refresh}));expect(p.onRefresh).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('tab',{name:t.fields.startGoalMode}));expect(screen.getByDisplayValue('fixture draft')).not.toBeNull()
 fireEvent.click(screen.getByRole('button',{name:t.start}));expect(p.onStart).toHaveBeenCalledTimes(1)
})
it('announces output error and permits an explicit mock retry',()=>{
 const p=props();render(<GoalsPage {...p} outputMeta={{error:'Fixture failure'}}/> )
 fireEvent.click(screen.getByRole('tab',{name:new RegExp(t.fields.outputTail)}))
 expect(screen.getByRole('alert').textContent).toContain('Fixture failure')
 fireEvent.click(screen.getByRole('button',{name:t.refresh}));expect(p.onOutput).toHaveBeenCalledWith('fixture')
 expect(p.onStop).not.toHaveBeenCalled();expect(p.onDelete).not.toHaveBeenCalled()
})
