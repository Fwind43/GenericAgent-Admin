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
  const buttons = within(a).getAllByRole('button')
  expect(buttons).toHaveLength(2)
  fireEvent.click(buttons[1])
  expect(toggleMember).toHaveBeenCalledWith(0,candidates[1])
  expect(within(screen.getByRole('region',{name:'Provider B'})).getByRole('button').disabled).toBe(true)
})
