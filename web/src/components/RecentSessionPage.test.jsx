import React from 'react'
import { test, expect } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import ProjectSessionPage from './ProjectSessionPage'
const ct = (zh, en) => en
const renderItem = item => <div data-testid="session" key={item}>{item}</div>
test('recent sessions show ten then expand all; search key resets the limit', () => {
 const items = Array.from({length: 25}, (_, i) => `session-${i}`)
 const frame = key => <ProjectSessionPage key={key} items={items} renderItem={renderItem} ct={ct} expandLabel={n => `Expand ${n} more...`}/>
 const view = render(frame(''))
 expect(view.getAllByTestId('session')).toHaveLength(10)
 fireEvent.click(view.getByRole('button', {name:'Expand 15 more...'}))
 expect(view.getAllByTestId('session')).toHaveLength(25)
 expect(view.queryByRole('button')).toBeNull()
 view.rerender(frame('search'))
 expect(view.getAllByTestId('session')).toHaveLength(10)
 cleanup()
})
test('ten or fewer sessions need no expand button', () => {
 const view = render(<ProjectSessionPage items={['one']} renderItem={renderItem} ct={ct}/>)
 expect(view.queryByRole('button')).toBeNull()
 cleanup()
})
