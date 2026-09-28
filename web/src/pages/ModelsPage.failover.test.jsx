import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FailoverGroupBody } from './ModelsPage'
globalThis.React = React
afterEach(cleanup)
it('groups by provider identity and preserves candidate identity and protocol restrictions', () => {
  const candidates = [
    { id: 'a1', instanceId: 'a1', providerVarName: 'a', providerName: 'Provider A', name: 'Shared', model: 'same', family: 'openai' },
    { id: 'a2', instanceId: 'a2', providerVarName: 'a', providerName: 'Provider A', name: 'Shared', model: 'same', family: 'openai' },
    { id: 'b1', instanceId: 'b1', providerVarName: 'b', providerName: 'Provider B', name: 'Other', model: 'other', family: 'anthropic' },
  ]
  const toggleMember = vi.fn()
  render(<FailoverGroupBody group={{members: [{instance_id:'a1'}]}} groupIndex={0}
    candidates={candidates} candidateMap={new Map(candidates.map(c => [c.instanceId,c]))}
    toggleMember={toggleMember} patchGroup={vi.fn()} moveMember={vi.fn()} removeMember={vi.fn()}
    text={{failoverPriority:'Priority',failoverMembers:'Members',failoverMixedWarning:'Incompatible'}} />)
  const a = screen.getByRole('region', {name:'Provider A'})
  expect(within(a).getByText('1 / 2')).toBeTruthy()
  const toggle = within(a).getByRole('button')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(within(a).queryByRole('button', {pressed: true})).toBeNull()
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  const buttons = within(a).getAllByRole('button').slice(1)
  expect(buttons).toHaveLength(2)
  fireEvent.click(buttons[1])
  expect(toggleMember).toHaveBeenCalledWith(0,candidates[1])
  const b = screen.getByRole('region',{name:'Provider B'})
  expect(within(b).getByRole('button').getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(within(b).getByRole('button'))
  expect(within(b).getAllByRole('button')[1].disabled).toBe(true)
  fireEvent.click(toggle)
  expect(within(a).getAllByRole('button')).toHaveLength(1)
  expect(within(a).getByText('1 / 2')).toBeTruthy()
  expect(toggleMember).toHaveBeenCalledTimes(1)
})

it('edits the failover display name without changing the variable name', () => {
  const patchGroup = vi.fn()
  render(<FailoverGroupBody group={{var_name:'mixin_config_main',display_name:'Primary',members:[]}} groupIndex={0}
    candidates={[]} candidateMap={new Map()} patchGroup={patchGroup}
    text={{displayName:'Display name',varName:'Variable'}} />)
  fireEvent.change(screen.getByRole('textbox', {name:'Display name'}), {target:{value:'Backup'}})
  expect(patchGroup).toHaveBeenCalledWith(0, {display_name:'Backup'})
  expect(screen.getByDisplayValue('main').value).toBe('main')
})

it('searches across providers without changing members and restores collapsed groups', () => {
  const candidates = [
    { id:'a', instanceId:'a', providerVarName:'p', providerName:'Alpha', model:'one', family:'native' },
    { id:'b', instanceId:'b', providerVarName:'q', providerName:'Beta', model:'two', family:'legacy' },
  ]
  const toggleMember = vi.fn()
  render(<FailoverGroupBody group={{members:[{instance_id:'a',model:'one'}]}} groupIndex={0}
    candidates={candidates} candidateMap={new Map(candidates.map(c => [c.instanceId,c]))}
    patchGroup={vi.fn()} toggleMember={toggleMember} moveMember={vi.fn()} removeMember={vi.fn()}
    text={{failoverSearch:'Search',failoverNoResults:'No results',failoverNeedsTwo:'Need two'}} />)
  const input = screen.getByRole('textbox', {name:'Search'})
  fireEvent.change(input, {target:{value:'BETA'}})
  expect(screen.queryByRole('region', {name:'Alpha'})).toBeNull()
  expect(within(screen.getByRole('region', {name:'Beta'})).getByRole('button', {pressed:false}).disabled).toBe(true)
  expect(toggleMember).not.toHaveBeenCalled()
  fireEvent.change(input, {target:{value:'missing'}})
  expect(screen.getByText('No results').textContent).toBe('No results')
  fireEvent.change(input, {target:{value:''}})
  expect(within(screen.getByRole('region', {name:'Alpha'})).getByRole('button').getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByText('Need two')).toBeTruthy()
})

it('keeps policy collapsed and preserves editable retry values', () => {
  const patchGroup = vi.fn()
  const {container} = render(<FailoverGroupBody group={{members:[],max_retries:0,base_delay:0,spring_back:30}}
    groupIndex={2} candidates={[]} candidateMap={new Map()} patchGroup={patchGroup}
    text={{failoverPolicy:'Retry policy',failoverRetries:'Retries',failoverDelay:'Delay',failoverSpring:'Spring'}} />)
  const policy = container.querySelector('details')
  expect(policy.open).toBe(false)
  expect(policy.querySelectorAll('input').length).toBe(3)
  expect(policy.querySelector('input').value).toBe('0')
  fireEvent.click(screen.getByText('Retry policy'))
  fireEvent.change(screen.getByLabelText('Retries'), {target:{value:'3'}})
  expect(patchGroup).toHaveBeenCalledWith(2,{max_retries:'3'})
})
