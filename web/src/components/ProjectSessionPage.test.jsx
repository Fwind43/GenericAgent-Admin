import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import ProjectSessionPage from './ProjectSessionPage'
afterEach(cleanup)
const ct = (zh, en) => en
const renderItem = item => <div key={item}>{item}</div>
test('initial ten, one click reveals all remaining sessions', () => {
  render(<ProjectSessionPage items={Array.from({length:25}, (_, i) => `Session ${i}`)} renderItem={renderItem} ct={ct}/> )
  expect(screen.getAllByText(/^Session /)).toHaveLength(10)
  fireEvent.click(screen.getByRole('button', {name:'Load more (15 remaining)...'}))
  expect(screen.getAllByText(/^Session /)).toHaveLength(25)
  expect(screen.queryByRole('button')).toBeNull()
})
test.each([false, true])('changing the display count resets the page (expanded=%s)', expanded => {
  const items = Array.from({length:25}, (_, i) => `Session ${i}`)
  const { rerender } = render(<ProjectSessionPage items={items} renderItem={renderItem} ct={ct} initialLimit={10}/>)
  if (expanded) fireEvent.click(screen.getByRole('button'))
  rerender(<ProjectSessionPage items={items} renderItem={renderItem} ct={ct} initialLimit={5}/>)
  expect(screen.getAllByText(/^Session /)).toHaveLength(5)
  expect(screen.getByRole('button', {name:'Load more (20 remaining)...'})).toBeTruthy()
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getAllByText(/^Session /)).toHaveLength(25)
  rerender(<ProjectSessionPage items={[...items, 'Session 25']} renderItem={renderItem} ct={ct} initialLimit={5}/>)
  expect(screen.getAllByText(/^Session /)).toHaveLength(26)
  rerender(<ProjectSessionPage items={items} renderItem={renderItem} ct={ct} initialLimit={15}/>)
  expect(screen.getAllByText(/^Session /)).toHaveLength(15)
})

test('ten or fewer has no button', () => {
  render(<ProjectSessionPage items={Array.from({length:10}, (_, i) => i)} renderItem={renderItem} ct={ct}/>)
  expect(screen.queryByRole('button')).toBeNull()
})
