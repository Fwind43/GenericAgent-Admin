import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import ProjectSessionPage from './ProjectSessionPage'
afterEach(cleanup)
const ct = (zh, en) => en
const renderItem = item => <div key={item}>{item}</div>
test('initial ten, batches of ten, then no more button', () => {
  render(<ProjectSessionPage items={Array.from({length:25}, (_, i) => `Session ${i}`)} renderItem={renderItem} ct={ct}/> )
  expect(screen.getAllByText(/^Session /)).toHaveLength(10)
  fireEvent.click(screen.getByRole('button', {name:'Load more (15 remaining)...'}))
  expect(screen.getAllByText(/^Session /)).toHaveLength(20)
  fireEvent.click(screen.getByRole('button', {name:'Load more (5 remaining)...'}))
  expect(screen.getAllByText(/^Session /)).toHaveLength(25)
  expect(screen.queryByRole('button')).toBeNull()
})
test('ten or fewer has no button', () => {
  render(<ProjectSessionPage items={Array.from({length:10}, (_, i) => i)} renderItem={renderItem} ct={ct}/>)
  expect(screen.queryByRole('button')).toBeNull()
})
