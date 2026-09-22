import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addChatInstanceToURL,
  chatInstanceOptions,
  initialChatInstanceID,
  persistChatInstanceID,
} from './chatInstanceScope.js'

const chatSource = (readFileSync(new URL('../ChatApp.jsx', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../ui/chatBody.jsx', import.meta.url), 'utf8'))
const chatStyles = readFileSync(new URL('../style.css', import.meta.url), 'utf8')

test('renders the instance selector once directly above settings in the session sidebar', () => {
  assert.equal((chatSource.match(/className="oa-sidebar-instance"/g) || []).length, 1)
  assert.equal((chatSource.match(/aria-label=\{ct\('选择 GA 实例'/g) || []).length, 1)
  const sidebar = chatSource.indexOf('<aside data-ui-surface="chat.sidebar"')
  const search = chatSource.indexOf('className="oa-sidebar-search"', sidebar)
  const footer = chatSource.indexOf('className="oa-sidebar-foot"', sidebar)
  const selector = chatSource.indexOf('className="oa-sidebar-instance"', footer)
  const settings = chatSource.indexOf('className="oa-sidebar-settings"', footer)
  const sidebarEnd = chatSource.indexOf('</aside>', sidebar)
  assert.ok(sidebar >= 0)
  assert.ok(search > sidebar && search < footer)
  assert.ok(footer > search && selector > footer && selector < settings)
  assert.ok(settings < sidebarEnd)
  assert.doesNotMatch(chatSource, /oa-instance-select|oa-mobile-instance-select/)
  assert.doesNotMatch(chatSource, /刷新会话|Refresh sessions|RefreshCw/)
  assert.equal((chatStyles.match(/grid-template-columns:\s*320px minmax\(0,1fr\)/g) || []).length, 2)
  assert.equal((chatStyles.match(/\.oa-sidebar\s*\{[^}]*width:\s*320px/g) || []).length, 2)
  assert.match(chatStyles, /width:min\(90vw,340px\)\s*!important/)
  assert.match(chatStyles, /\.oa-sidebar-instance\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0,1fr\)[^}]*align-items:\s*center/s)
  assert.match(chatStyles, /\.oa-sidebar \.oa-session-row\s*\{[^}]*margin:0;[^}]*border-bottom:1px solid var\(--oa-side-line\);[^}]*border-radius:0;[^}]*background:transparent;[^}]*box-shadow:none;/s)
  assert.match(chatStyles, /html \.oa-sidebar \.oa-project-group,[^{]*\{[^}]*border-bottom:1px solid var\(--oa-side-line\);[^}]*border-radius:0;[^}]*background:transparent;[^}]*box-shadow:none;/s)
  assert.match(chatStyles, /\.oa-sidebar \.oa-project-body\s*\{[^}]*margin-top:0;[^}]*padding:0 0 0 14px;[^}]*border-top:1px solid var\(--oa-side-line\);/s)
  assert.match(chatStyles, /\.oa-session span\s*\{[^}]*font-size:\s*14\.5px;[^}]*font-weight:\s*450;/s)
  assert.match(chatStyles, /\.oa-session-row\.active \.oa-session span\s*\{[^}]*font-weight:\s*500/s)
  assert.match(chatStyles, /\.oa-project-head b\s*\{[^}]*font-weight:\s*520;/s)
})

test('addChatInstanceToURL scopes only chat API routes and preserves query/hash', () => {
  assert.equal(addChatInstanceToURL('/api/chat/sessions', ' ga-2 '), '/api/chat/sessions?instance_id=ga-2')
  assert.equal(addChatInstanceToURL('/api/chat/stream/s1?from=7#tail', 'ga 2'), '/api/chat/stream/s1?from=7&instance_id=ga+2#tail')
  assert.equal(addChatInstanceToURL('/api/instances', 'ga-2'), '/api/instances')
  assert.equal(addChatInstanceToURL('/api/chat/sessions', ''), '/api/chat/sessions')
})

test('initialChatInstanceID prefers the tab URL over session storage', () => {
  const storage = { getItem: () => 'stored-instance' }
  assert.equal(initialChatInstanceID({ location: { search: '?instance_id=url-instance' }, storage }), 'url-instance')
  assert.equal(initialChatInstanceID({ location: { search: '' }, storage }), 'stored-instance')
})

test('persistChatInstanceID updates tab storage and current URL', () => {
  const calls = []
  const storage = {
    setItem: (key, value) => calls.push(['set', key, value]),
    removeItem: key => calls.push(['remove', key]),
  }
  const history = { state: { keep: true }, replaceState: (...args) => calls.push(['replace', ...args]) }
  const location = { href: 'http://localhost/chat?keep=1#thread' }

  persistChatInstanceID('ga-3', { history, location, storage })
  assert.deepEqual(calls[0], ['set', 'ga-admin-chat-instance-id', 'ga-3'])
  assert.deepEqual(calls[1], ['replace', history.state, '', '/chat?keep=1&instance_id=ga-3#thread'])
})

test('chatInstanceOptions normalizes names and initialization state', () => {
  assert.deepEqual(chatInstanceOptions({ items: [
    { id: 'alpha', name: 'Alpha', init_status: 'ready' },
    { id: ' beta ', name: '', init_status: 'INITIALIZING' },
    { id: '', name: 'ignored' },
  ] }), [
    { id: 'alpha', name: 'Alpha', initializing: false },
    { id: 'beta', name: 'beta', initializing: true },
  ])
})
