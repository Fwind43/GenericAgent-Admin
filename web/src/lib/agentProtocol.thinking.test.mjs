import assert from 'node:assert/strict'
import test from 'node:test'
import { foldAgentProtocolBlocks, segmentAgentProtocolBlocks, stripAgentProtocolBlocks } from './agentProtocol.js'

test('thinking keeps same-line content and trailing answer across every parser entry', () => {
  for (const text of [
    '<thinking>**Checking**</thinking>Answer',
    '  <THINKING>**Checking**\n</THINKING>Answer',
    '<thinking>\n**Checking**</thinking>Answer',
  ]) {
    const segments = segmentAgentProtocolBlocks(text)
    assert.deepEqual(segments.map(s => s.kind), ['folds', 'prose'])
    assert.equal(segments[0].folds[0].body, '**Checking**')
    assert.equal(segments[0].folds[0].live, false)
    assert.equal(segments[1].text, 'Answer')
    assert.equal(foldAgentProtocolBlocks(text)[0].body, '**Checking**')
    assert.equal(stripAgentProtocolBlocks(text), 'Answer')
  }
})

test('thinking can follow narration on the same line without losing either side', () => {
  const text = '**Inspecting**<thinking>**Checking**</thinking>Answer'
  const segments = segmentAgentProtocolBlocks(text)
  assert.deepEqual(segments.map(s => s.kind), ['prose', 'folds', 'prose'])
  assert.equal(segments[0].text, '**Inspecting**')
  assert.equal(segments[1].folds[0].body, '**Checking**')
  assert.equal(segments[2].text, 'Answer')
  assert.equal(foldAgentProtocolBlocks(text)[0].body, '**Checking**')
  assert.equal(stripAgentProtocolBlocks(text), '**Inspecting**\nAnswer')
})

test('consecutive thinking blocks preserve order and empty tags disappear', () => {
  const text = 'Before\n<thinking> </thinking><thinking>First</thinking><thinking>Second</thinking>After'
  const segments = segmentAgentProtocolBlocks(text)
  assert.deepEqual(segments.map(s => s.kind), ['prose', 'folds', 'prose'])
  assert.deepEqual(segments[1].folds.map(f => f.body), ['First', 'Second'])
  assert.equal(stripAgentProtocolBlocks(text), 'Before\nAfter')
  assert.deepEqual(segmentAgentProtocolBlocks('<thinking> </thinking>'), [])
  assert.deepEqual(segmentAgentProtocolBlocks('<thinking>'), [])
})

test('stream deltas never expose a partially received closing tag', () => {
  const close = '</thinking>'
  for (let length = 0; length <= close.length; length++) {
    const fold = segmentAgentProtocolBlocks('<thinking>**Checking**' + close.slice(0, length))[0].folds[0]
    assert.equal(fold.body, '**Checking**')
    assert.equal(fold.live, length < close.length)
  }
  assert.equal(foldAgentProtocolBlocks('<thinking>Live')[0].live, true)
  assert.equal(stripAgentProtocolBlocks('<thinking>Live'), '')
})

test('fenced and inline code examples are not thinking blocks', () => {
  for (const text of [
    '```xml\n<thinking>Example</thinking>\n```',
    '~~~xml\n<thinking>\nExample\n</thinking>\n~~~',
    '```xml\n<thinking>Example',
    '`<thinking>Example</thinking>`',
    'Example: ``<thinking>Example</thinking>``',
    'Example: \\<thinking>Example',
    '    <thinking>Indented example</thinking>',
  ]) {
    assert.deepEqual(segmentAgentProtocolBlocks(text), [{ kind: 'prose', text: text.trim() }])
    assert.deepEqual(foldAgentProtocolBlocks(text), [])
    assert.equal(stripAgentProtocolBlocks(text), text.trim())
  }
})

test('code fences inside thinking preserve literal closing-tag examples', () => {
  const body = 'Check the XML:\n```xml\n</thinking>\n```\nThen continue.'
  const text = `<thinking>\n${body}\n</thinking>Answer`
  assert.equal(foldAgentProtocolBlocks(text)[0].body, body)
  assert.equal(stripAgentProtocolBlocks(text), 'Answer')
})

test('thinking followed by live tool results keeps the existing tool contract', () => {
  const text = '<thinking>Check</thinking>\n🛠️ Tool: `demo`\n```text\nargs\n```\n`````\npartial result'
  const folds = segmentAgentProtocolBlocks(text)[0].folds
  assert.deepEqual(folds.map(f => f.type), ['thinking', 'tool-call'])
  assert.equal(folds[1].result, 'partial result')
  assert.equal(folds[1].resultLive, true)
  const orphan = segmentAgentProtocolBlocks('`````\npartial result')[0].folds[0]
  assert.equal(orphan.type, 'tool-result-live')
})
