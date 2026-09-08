import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CHAT_SESSION_DRAFTS_STORAGE_KEY,
  clearChatSessionDrafts,
  listChatSessionDraftIds,
  loadChatSessionDraft,
  mergeChatSessionDraftSessions,
  saveChatSessionDraft,
} from './chatSessionDrafts.js'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
}

function functionBlock(source, start, end) {
  const from = source.indexOf(start)
  assert.notEqual(from, -1, `missing start marker: ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.notEqual(to, -1, `missing end marker: ${end}`)
  return source.slice(from, to)
}

test('project new chat is always available outside the actions menu', () => {
  const main = readFileSync(new URL('../ChatApp.jsx', import.meta.url), 'utf8')
  const header = functionBlock(main, '<div className="oa-project-head">', '<div className="oa-project-body"')
  const menuStart = header.indexOf('<ProjectActionsMenu')
  assert.ok(menuStart > 0)
  const outsideMenu = header.slice(0, menuStart)
  assert.match(outsideMenu, /className="oa-project-add"/)
  assert.match(outsideMenu, /onClick=\{\(\)=>newProjectSession\(group.name\)\}/)
  assert.match(outsideMenu, /disabled=\{batchDeleting\}/)
  assert.doesNotMatch(header.slice(menuStart), /oa-project-add/)
  assert.doesNotMatch(main, /No chats yet\. Start one from the/)
})

test('pinned projects expose a persistent status outside the menu and collapsed body', () => {
  const main = readFileSync(new URL('../ChatApp.jsx', import.meta.url), 'utf8')
  const header = functionBlock(main, '<div className="oa-project-head">', '<ProjectActionsMenu')
  assert.match(header, /group\.pinned && <span className="oa-project-pinned-badge"/)
  assert.match(header, /<Pin size=\{11\} aria-hidden="true"/)
  assert.match(header, /'Pinned'/)
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8')
  assert.match(css, /\.oa-sidebar \.oa-project-pinned-badge\s*\{[^}]*display:inline-flex;[^}]*flex:0 0 auto;/)
})

test('new chat stays out of the session list until its first send', () => {
  const main = readFileSync(new URL('../ChatApp.jsx', import.meta.url), 'utf8')

  // Scoped to newSession alone. A project chat is persisted by the server the
  // moment it is created, so newProjectSession does refresh the list, and the
  // block must not stretch far enough to pick up unrelated project helpers.
  const mainNewSession = functionBlock(main, '  const newSession = async () => {', '  const newProjectSession = async')
  assert.doesNotMatch(mainNewSession, /setSessions\s*\(/)
  assert.doesNotMatch(mainNewSession, /loadSessions\s*\(/)

  const mainSend = functionBlock(main, '  const runSend = async (item = {}) => {', '  const expandCustomSlashCommand =')
  assert.match(mainSend, /await loadSessions\(id\)/)
})

test('chat session drafts persist independently and clear selectively', () => {
  const storage = memoryStorage()

  saveChatSessionDraft('session-a', 'draft A', storage)
  saveChatSessionDraft('session-b', 'draft B', storage)
  assert.deepEqual(listChatSessionDraftIds(storage).sort(), ['session-a', 'session-b'])
  assert.equal(loadChatSessionDraft('session-a', storage), 'draft A')
  assert.equal(loadChatSessionDraft('session-b', storage), 'draft B')

  saveChatSessionDraft('session-a', '', storage)
  assert.deepEqual(listChatSessionDraftIds(storage), ['session-b'])
  assert.equal(loadChatSessionDraft('session-a', storage), '')
  assert.equal(loadChatSessionDraft('session-b', storage), 'draft B')

  clearChatSessionDrafts(['session-b', 'missing'], storage)
  assert.deepEqual(listChatSessionDraftIds(storage), [])
  assert.equal(loadChatSessionDraft('session-b', storage), '')
  assert.equal(storage.getItem(CHAT_SESSION_DRAFTS_STORAGE_KEY), null)
})

test('draft-backed blank sessions merge into one instance without duplicating server sessions', () => {
  const storage = memoryStorage({
    [CHAT_SESSION_DRAFTS_STORAGE_KEY]: JSON.stringify({
      legacy: 'legacy draft',
    }),
  })
  saveChatSessionDraft('local-a', 'draft A', storage, 'instance-a')
  saveChatSessionDraft('local-b', 'draft B', storage, 'instance-b')

  assert.deepEqual(listChatSessionDraftIds(storage, 'instance-a').sort(), ['legacy', 'local-a'])
  assert.equal(loadChatSessionDraft('local-a', storage, 'instance-a'), 'draft A')
  assert.equal(loadChatSessionDraft('local-a', storage, 'instance-b'), '')

  const server = [{ id: 'legacy', title: 'Saved', updated_at: '2026-01-01T00:00:00Z' }]
  const merged = mergeChatSessionDraftSessions(server, 'instance-a', storage)
  assert.deepEqual(merged.map(session => session.id), ['local-a', 'legacy'])
  assert.equal(merged[0].local_draft, true)
  assert.equal(merged[1], server[0])
  assert.ok(Number.isFinite(Date.parse(merged[0].updated_at)))

  saveChatSessionDraft('local-a', '', storage, 'instance-a')
  assert.deepEqual(mergeChatSessionDraftSessions(merged, 'instance-a', storage), server)
})

test('chat session draft storage failures do not break the composer', () => {
  const corrupt = memoryStorage({ [CHAT_SESSION_DRAFTS_STORAGE_KEY]: '{not-json' })
  assert.equal(loadChatSessionDraft('session-a', corrupt), '')
  assert.doesNotThrow(() => saveChatSessionDraft('session-a', 'recovered', corrupt))
  assert.equal(loadChatSessionDraft('session-a', corrupt), 'recovered')

  const unavailable = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
    removeItem() { throw new Error('blocked') },
  }
  assert.equal(loadChatSessionDraft('session-a', unavailable), '')
  assert.doesNotThrow(() => saveChatSessionDraft('session-a', 'draft', unavailable))
  assert.doesNotThrow(() => clearChatSessionDrafts('session-a', unavailable))
})

test('main chat wires reactive draft badges into persistence, sending, and deletion', () => {
  const main = readFileSync(new URL('../ChatApp.jsx', import.meta.url), 'utf8')
  const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8')
  assert.match(main, /listChatSessionDraftIds/)
  assert.match(main, /loadChatSessionDraft/)
  assert.match(main, /saveChatSessionDraft/)
  assert.match(main, /clearChatSessionDrafts/)
  assert.match(main, /mergeChatSessionDraftSessions/)
  assert.match(main, /const \[draftSessionIds, setDraftSessionIds\]/)
  assert.equal(main.match(/className="oa-session-draft-badge"/g)?.length, 2)
  assert.match(style, /\.oa-session-title \.oa-session-draft-badge/)
  assert.match(style, /html\[data-color-scheme="dark"\] \.oa-session-title \.oa-session-draft-badge/)

  const openSession = functionBlock(main, '  const openSession = async', '  const loadSessions = async')
  assert.match(openSession, /loadChatSessionDraft\(id, undefined, chatInstanceRef\.current\)/)

  const loadSessions = functionBlock(main, '  const loadSessions = async', '  const createSession = async')
  assert.match(loadSessions, /mergeChatSessionDraftSessions\(d\.sessions, chatInstanceRef\.current\)/)

  const promptSetter = functionBlock(main, '  const setSessionPrompt =', '  useEffect(() => { activeSidRef.current = sid }, [sid])')
  assert.match(promptSetter, /persistSessionDraft\(sessionId, next\)/)

  const promptChange = functionBlock(main, '  const handlePromptChange =', '  const handlePromptKeyDown =')
  assert.match(promptChange, /setSessionPrompt\(v\)/)

  const promptKeyDown = functionBlock(main, '  const handlePromptKeyDown =', '  const guideQueued =')
  assert.match(promptKeyDown, /e\.isComposing \|\| e\.keyCode === 229/)
  assert.match(promptKeyDown, /if \(e\.isComposing \|\| e\.keyCode === 229\) return/)

  const send = functionBlock(main, '  const send = async', '  const applySlashCommand =')
  assert.match(send, /setSessionPrompt\(''\)/)
  const runSend = functionBlock(main, '  const runSend = async (item = {}) => {', '  const expandCustomSlashCommand =')
  assert.match(runSend, /clearSessionDrafts\(id\)/)

  const deleteSession = functionBlock(main, '  const deleteSession = async', '  const openSessionManager =')
  assert.match(deleteSession, /clearSessionDrafts\(id\)/)
  const batchDelete = functionBlock(main, '  const deleteSelectedSessions = async', '  const startRename =')
  assert.match(batchDelete, /clearSessionDrafts\(result\.deletedIds\)/)
})
