import React from 'react'
import {afterEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {UsagePage} from './UsagePage'
import {api} from '../lib/api'
vi.mock('../lib/api',()=>({api:vi.fn()}))
globalThis.React=React
afterEach(()=>{cleanup();vi.resetAllMocks()})
it('recovers failed aggregation with the same API and exposes cumulative scope',async()=>{
 api.mockRejectedValueOnce(new Error('Fixture failure')).mockResolvedValueOnce({assistant_replies:0,session_count:0,totals:{}})
 render(<UsagePage lang="en"/>);expect((await screen.findByRole('alert')).textContent).toContain('Fixture failure')
 fireEvent.click(screen.getByRole('button',{name:'Retry'}))
 await screen.findByText('All recorded usage · heatmap shows the past 52 weeks only')
 await screen.findByText(/No token usage has been recorded/i)
 expect(api).toHaveBeenCalledTimes(2);expect(api).toHaveBeenLastCalledWith('/api/usage/overview')
})
it('keeps recorded metrics while refreshing and provides keyboard scroll regions',async()=>{
 api.mockResolvedValueOnce({assistant_replies:1,session_count:1,totals:{total_tokens:12345},models:[]}).mockImplementationOnce(()=>new Promise(()=>{}))
 render(<UsagePage lang="en"/>);await screen.findByText('12.35K')
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}))
 expect(screen.getByRole('button',{name:'Refresh'}).disabled).toBe(true)
 expect(screen.getByRole('status').textContent).toMatch(/Aggregating/)
 expect(screen.getByText('12.35K')).toBeTruthy()
 expect(Array.from(document.querySelectorAll('.usage-table-wrap, .usage-heatmap-scroll')).every(e=>e.tabIndex===0)).toBe(true)
})
