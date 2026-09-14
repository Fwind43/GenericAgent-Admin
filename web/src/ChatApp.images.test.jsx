import React from 'react'
import { afterEach, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ChatMessage } from './ChatApp.jsx'

afterEach(cleanup)

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII='

for (const theme of ['light', 'dark', 'warm']) {
  for (const field of ['dataURL', 'data_url', 'url']) {
    test(`sent guide image supports ${field} in ${theme}`, () => {
      document.documentElement.dataset.theme = theme
      const { container, rerender } = render(
        <ChatMessage message={{ id: 'guide-image', role: 'user', content: 'Inspect screenshot', files: [{ name: 'screenshot.png', type: 'image/png', [field]: image }] }} />,
      )
      const check = () => {
        expect(container.querySelector('.oa-msg-image').getAttribute('src')).toBe(image)
        expect(container.querySelector('.oa-msg-image-link').getAttribute('href')).toBe(image)
      }
      check()
      rerender(<ChatMessage message={JSON.parse(JSON.stringify({ id: 'guide-image', role: 'user', content: 'Inspect screenshot', files: [{ name: 'screenshot.png', type: 'image/png', [field]: image }] }))} />)
      check()
      delete document.documentElement.dataset.theme
    })
  }
}
