import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isValidProjectName, projectNameError, projectNameErrorText } from './projectName.js'
import { frontendSource } from './frontendSources.mjs'

const en = (_chinese, english) => english

test('a plain name passes and is trimmed the way the server trims it', () => {
  assert.ok(isValidProjectName('alpha'))
  assert.ok(isValidProjectName('  alpha  '))
  assert.ok(isValidProjectName('客户-A_2026'))
})

test('names that cannot be one safe directory segment are refused', () => {
  assert.equal(projectNameError(''), 'empty')
  assert.equal(projectNameError('   '), 'empty')
  assert.equal(projectNameError('.'), 'reserved')
  assert.equal(projectNameError('..'), 'reserved')
  assert.equal(projectNameError('a/b'), 'separator')
  assert.equal(projectNameError('a\\b'), 'separator')
  assert.equal(projectNameError('C:'), 'separator')
  assert.equal(projectNameError('alpha\u0007'), 'control')
  assert.equal(projectNameError('alpha.'), 'trailing_dot')
  assert.equal(projectNameError('x'.repeat(129)), 'too_long')
})

// The limit is on bytes, not characters, because the server measures len([]byte).
test('the length limit counts bytes, so multi-byte names are measured as UTF-8', () => {
  assert.equal(projectNameError('中'.repeat(42)), '')
  assert.equal(projectNameError('中'.repeat(43)), 'too_long')
})

test('every refusal has wording to show the user', () => {
  for (const code of ['empty', 'reserved', 'separator', 'control', 'trailing_dot', 'too_long']) {
    assert.notEqual(projectNameErrorText(code, en), '', `${code} needs a message`)
  }
  assert.equal(projectNameErrorText('', en), '')
})

// The Go validator is the authority; keep the two lists of rules from drifting.
test('the client rules mirror validProjectModeName in the Go handler', () => {
  const go = readFileSync(new URL('../../../internal/api/chat_handlers.go', import.meta.url), 'utf8')
  const validator = go.slice(go.indexOf('func validProjectModeName'))
  assert.match(validator, /len\(\[\]byte\(name\)\) > 128/)
  assert.match(validator, /name == "\." \|\| name == "\.\."/)
  assert.match(validator, /HasSuffix\(name, "\."\)/)
  assert.match(validator, /r < 0x20 \|\| r == 0x7f/)
})

test('the Projects tab offers a way to create the projects it lists', () => {
  const source = frontendSource()
  assert.match(source, /onClick=\{openProjectDraft\}/)
  assert.match(source, /'\/api\/chat\/projects', \{ method:'POST'/)
  // Creating a project should leave the user in a chat bound to it, not just a
  // new folder in the sidebar.
  assert.match(source, /await createSession\(created\)/)
  assert.match(source, /projectNameError\(name\)/)
})

test('projects can be pinned, and the pin is read back from the sessions payload', () => {
  const source = frontendSource()
  assert.match(source, /'\/api\/chat\/projects\/pin', \{ method:'PATCH'/)
  assert.match(source, /onClick=\{\(\)=>toggleProjectPinned\(group\.name, !group\.pinned\)\}/)
  assert.match(source, /aria-pressed=\{group\.pinned\}/)
  assert.match(source, /setPinnedProjects\(previous => reconcileScalarList\(previous, d\.pinned_projects\)\)/)
  assert.match(source, /groupProjectSessions\(projects, sessions, pinnedProjects\)/)
})
