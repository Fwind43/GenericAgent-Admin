import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('main route content is guarded by ErrorBoundary and Suspense fallback', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  assert.match(app, /import \{ ErrorBoundary, RouteFallback, StatusNotice \} from '\.\/components\/feedback'/)
  assert.match(app, /<ErrorBoundary resetKey=\{tab\}>/)
  assert.match(app, /<Suspense fallback=\{<RouteFallback label=\{t\.loading\} \/>\}>/)
})

test('feedback module exposes accessible error fallback', () => {
  const feedback = readFileSync(new URL('../components/feedback.jsx', import.meta.url), 'utf8')
  assert.match(feedback, /export class ErrorBoundary extends Component/)
  assert.match(feedback, /role="alert"/)
  assert.match(feedback, /componentDidUpdate\(prevProps\)/)
})
