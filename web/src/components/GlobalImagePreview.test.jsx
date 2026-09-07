import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GlobalImagePreview } from './GlobalImagePreview'

vi.mock('antd', () => ({
  Image: ({ src, alt, preview }) => <div role="dialog"><img src={src} alt={alt} /><button onClick={() => preview.onOpenChange(false)}>Close</button></div>,
}))
afterEach(cleanup)

describe('GlobalImagePreview', () => {
  it('previews linked Markdown without following the link and restores focus', () => {
    const follow = vi.fn()
    render(<><GlobalImagePreview /><a href="#other" onClick={follow}><img tabIndex={0} src="/test.png" alt="Diagram" /></a></>)
    const image = screen.getByAltText('Diagram')
    fireEvent.click(image)
    expect(screen.getByRole('dialog').querySelector('img').getAttribute('src')).toBe('/test.png')
    expect(follow).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Close'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(image)
  })
  it('captures attachment buttons exactly once and supports keyboard activation', () => {
    const local = vi.fn()
    render(<><GlobalImagePreview /><button className="oa-attach-open" onClick={local}><img src="/attachment.png" alt="Attachment" /></button></>)
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(local).not.toHaveBeenCalled()
  })
  it('keeps opt-outs, disabled controls, native previews and modified clicks intact', () => {
    render(<><GlobalImagePreview /><img data-image-preview="off" src="/logo.png" alt="Logo" /><button disabled><img src="/disabled.png" alt="Disabled" /></button><span className="ant-image"><img src="/native.png" alt="Native" /></span><img src="/normal.png" alt="Normal" /></>)
    for (const name of ['Logo', 'Disabled', 'Native']) fireEvent.click(screen.getByAltText(name))
    fireEvent.click(screen.getByAltText('Normal'), { ctrlKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByAltText('Normal'))
    expect(screen.getByRole('dialog')).not.toBeNull()
  })
  it('handles images added after mount and removes listeners on unmount', () => {
    const { rerender, unmount } = render(<GlobalImagePreview />)
    rerender(<><GlobalImagePreview /><img src="/late.png" alt="Late" /></>)
    fireEvent.click(screen.getByAltText('Late'))
    expect(screen.getByRole('dialog')).not.toBeNull()
    unmount()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
