import React from 'react'
import { afterEach, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ChatMessage } from './ChatApp.jsx'

const short = '\n\n[Server-owned Conductor worker instruction]\nComplete only this delegated objective. Return a concise, evidence-based result for the parent.'
const long = short + ' Do not attempt to dispatch other workers.'
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-theme'); document.documentElement.removeAttribute('data-color-scheme') })
for (const theme of ['light', 'dark', 'warm']) {
  for (const [name, sender, suffix, worker, expected] of [
    ['structured', 'conductor', '', false, true],
    ['new short', 'conductor', short, true, true],
    ['legacy short', undefined, short, true, true],
    ['legacy long', undefined, long, true, true],
    ['manual', 'user', '', true, false],
    ['manual copied instruction', 'user', short, true, false],
    ['legacy manual', undefined, '', true, false],
    ['non-worker legacy', undefined, long, false, false],
  ]) {
    test(`${theme}: ${name} survives refresh`, () => {
      document.documentElement.setAttribute('data-theme', theme)
      document.documentElement.setAttribute('data-color-scheme', theme === 'dark' ? 'dark' : 'light')
      const message = { id: 'sender-test', role: 'user', sender_kind: sender, content: 'Weather task' + suffix }
      const props = { message, conductorWorker: worker, pending: false }
      const { container, rerender } = render(<ChatMessage {...props} />)
      const verify = () => {
        const card = container.querySelector('.oa-conductor-dispatch-card')
        expect(!!card).toBe(expected)
        if (expected) {
          expect(card.querySelector('header').textContent).toContain('\u6307\u6325\u5bb6')
          expect(card.querySelector('header').textContent).toContain('\u6d3e\u53d1\u5b50\u4efb\u52a1')
          expect(card.querySelector('.oa-conductor-dispatch-objective').textContent).toBe('Weather task')
        }
      }
      verify()
      rerender(<ChatMessage {...props} message={JSON.parse(JSON.stringify(message))} />)
      verify()
    })
  }
}
