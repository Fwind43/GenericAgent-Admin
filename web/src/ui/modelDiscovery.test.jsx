import React, { useState } from 'react'
import { it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ModelDiscoveryList, { partitionDiscoveredModels } from '../pages/ModelDiscoveryList'
afterEach(cleanup)
it('deduplicates discovery and separates existing IDs', () => {
  expect(partitionDiscoveredModels([' a ', 'a', 'b', ''], ['a'])).toEqual({ pending: ['b'], added: ['a'] })
})
it('adds only missing models and disables repeat bulk additions', () => {
  const add = vi.fn()
  function Harness() {
    const [existing, setExisting] = useState(['a'])
    return <ModelDiscoveryList english candidates={['a', 'b', 'c', 'b']} existing={existing} onAdd={ids => { add(ids); setExisting([...existing, ...ids]) }} />
  }
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Add all missing (2)' }))
  expect(add).toHaveBeenCalledWith(['b', 'c'])
  const button = screen.getByRole('button', { name: 'Add all missing (0)' })
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  expect(add).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Added 3' }))
  expect(screen.queryByRole('button', { name: 'Add a' })).toBeNull()
})
it('bulk adds only search matches', () => {
  const add = vi.fn()
  render(<ModelDiscoveryList english candidates={['gpt-x', 'claude-x']} existing={[]} onAdd={add} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'GPT' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add filtered (1)' }))
  expect(add).toHaveBeenCalledWith(['gpt-x'])
})
