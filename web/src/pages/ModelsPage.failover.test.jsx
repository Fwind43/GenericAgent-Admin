import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FailoverGroupBody } from './ModelsPage'
globalThis.React = React
afterEach(cleanup)
it('groups by provider identity and preserves candidate identity and protocol restrictions', () => {
  const candidates = [
    { instanceId: 'a1', providerVarName: 'a', providerName: 'Provider A', name: 'Shared', model: 'same', family: 'openai' },
    { instanceId: 'a2', providerVarName: 'a', providerName: 'Provider A', name: 'Shared', model: 'same', family: 'openai' },
    { instanceId: 'b1', providerVarName: 'b', providerName: 'Provider B', name: 'Other', model: 'other', family: 'anthropic' },
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
