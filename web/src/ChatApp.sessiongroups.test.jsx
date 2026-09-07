import React from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { SessionManagerGroup } from './ChatApp'

afterEach(cleanup)
const items = [{ id: 'a' }, { id: 'b' }]
test.each([[[], 'false'], [['a'], 'mixed'], [['a', 'b'], 'true']])('group selection state %j', (ids, state) => {
  const onSelect = vi.fn(), onToggle = vi.fn()
  const { getByRole, getByText } = render(<SessionManagerGroup label="Group" items={items} selectedIds={new Set(ids)} onSelect={onSelect} onToggle={onToggle}>row</SessionManagerGroup>)
  expect(getByRole('checkbox').getAttribute('aria-checked')).toBe(state)
  expect(getByText(`${ids.length} / 2`)).toBeTruthy()
  fireEvent.click(getByRole('checkbox'))
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
})
test('collapse hides rows but retains count and selection control', () => {
  const onToggle = vi.fn(), onSelect = vi.fn()
  const props = { label: 'Group', items, selectedIds: new Set(['a']), onToggle, onSelect }
  const { getByRole, queryByText, rerender } = render(<SessionManagerGroup {...props}>row</SessionManagerGroup>)
  fireEvent.click(getByRole('button'))
  expect(onToggle).toHaveBeenCalledTimes(1)
  expect(onSelect).not.toHaveBeenCalled()
  rerender(<SessionManagerGroup {...props} collapsed>row</SessionManagerGroup>)
  expect(queryByText('row')).toBeNull()
  expect(getByRole('button').getAttribute('aria-expanded')).toBe('false')
  expect(getByRole('checkbox').getAttribute('aria-checked')).toBe('mixed')
  fireEvent.click(getByRole('checkbox'))
  expect(onSelect).toHaveBeenCalledTimes(1)
  rerender(<SessionManagerGroup {...props}>row</SessionManagerGroup>)
  expect(queryByText('row')).toBeTruthy()
})
test('busy and empty groups disable selection', () => {
  const onSelect = vi.fn()
  const props = { label: 'Group', selectedIds: new Set(), onSelect }
  const { getByRole, rerender } = render(<SessionManagerGroup {...props} items={items} disabled />)
  fireEvent.click(getByRole('checkbox'))
  expect(onSelect).not.toHaveBeenCalled()
  rerender(<SessionManagerGroup {...props} items={[]} />)
  expect(getByRole('checkbox').disabled).toBe(true)
})
