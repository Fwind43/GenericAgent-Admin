import test from 'node:test'
import assert from 'node:assert/strict'
import { MARKDOWN_CHAR_LIMIT, MARKDOWN_LINE_LIMIT, assistantTurnFallbackTitle, isToolResultText, parseAssistantContent, splitMarkdownParts, parseCodeFenceInfo, textRenderStats, previewLongText } from './chatTextSafety.js'

test('many content lines do not trigger safe preview by line count alone', () => {
  const text = Array.from({ length: MARKDOWN_LINE_LIMIT + 20 }, (_, i) => `line ${i}`).join('\n')
  const stats = textRenderStats(text)
  assert.equal(stats.lines, MARKDOWN_LINE_LIMIT + 20)
  assert.equal(stats.standaloneNewlineLines, 0)
  assert.equal(stats.tooLarge, false)
})

test('many standalone blank lines still trigger safe preview', () => {
  const text = Array.from({ length: MARKDOWN_LINE_LIMIT + 20 }, () => '').join('\n')
  const stats = textRenderStats(text)
  assert.equal(stats.lines, MARKDOWN_LINE_LIMIT + 20)
  assert.equal(stats.standaloneNewlineLines, MARKDOWN_LINE_LIMIT + 20)
  assert.equal(stats.tooLarge, true)
})

test('preview folds long runs of blank lines', () => {
  const preview = previewLongText(`a\n\n\n\n\n\n\n\n\n\nb`)
  assert.match(preview, /连续空行已折叠/)
})


test('lightweight assistant output extracts leading transport summary', () => {
  const text = [
    '<summary>\u5f53\u524d\u65e0\u6cd5\u67e5\u770b\u684c\u9762</summary>',
    '',
    '\u4f60\u597d\uff0c\u6211\u6b63\u5728\u56de\u590d\u4f60\u7684\u4e34\u65f6\u63d0\u95ee\u3002',
  ].join('\n')
  const parsed = parseAssistantContent(text)
  assert.equal(parsed.runs.length, 0)
  assert.equal(parsed.summary, '\u5f53\u524d\u65e0\u6cd5\u67e5\u770b\u684c\u9762')
  assert.equal(parsed.body, '\u4f60\u597d\uff0c\u6211\u6b63\u5728\u56de\u590d\u4f60\u7684\u4e34\u65f6\u63d0\u95ee\u3002')
})

test('assistant output preserves summary tags outside the transport prefix', () => {
  const text = [
    'Use this HTML:',
    '<summary>Visible disclosure label</summary>',
  ].join('\n')
  assert.equal(parseAssistantContent(text).body, text)
})

test('leading transport summary is extracted after the final marker too', () => {
  const text = [
    'LLM Running (Turn 1)',
    '<summary>work</summary>',
    'working',
    '```',
    '[Info] Final response to user.',
    '```',
    '<summary>transport only</summary>',
    'final answer',
  ].join('\n')
  const parsed = parseAssistantContent(text)
  assert.equal(parsed.runs.length, 1)
  assert.equal(parsed.summary, 'transport only')
  assert.equal(parsed.body, 'final answer')
})

test('assistant content is split into turns before large-text fallback', () => {
  const turnBody = 'x'.repeat(Math.floor(MARKDOWN_CHAR_LIMIT / 2))
  const text = [
    'LLM Running (Turn 1)',
    '<summary>first</summary>',
    turnBody,
    '',
    'LLM Running (Turn 2)',
    '<summary>second</summary>',
    turnBody,
    '',
    '```',
    '[Info] Final response to user.',
    '```',
    'final answer',
  ].join('\n')
  const fullStats = textRenderStats(text)
  assert.equal(fullStats.tooLarge, true)
  const parsed = parseAssistantContent(text)
  assert.equal(parsed.runs.length, 2)
  assert.equal(parsed.runs[0].title, 'first')
  assert.equal(textRenderStats(parsed.runs[0].body).tooLarge, false)
  assert.equal(textRenderStats(parsed.runs[1].body).tooLarge, false)
  assert.equal(parsed.body, 'final answer')
})

test('turn title falls back to unique tool names when summary is missing', () => {
  const parsed = parseAssistantContent([
    'LLM Running (Turn 7)',
    '🛠️ code_run({"script":"test"})',
    '📥 tool result',
    '🛠️ web_scan({"text_only":true})',
    '🛠️ code_run({"script":"build"})',
  ].join('\n'))
  assert.equal(parsed.runs[0].title, 'code_run · web_scan')
})

test('turn title falls back to cleaned body text when no summary or tool exists', () => {
  const parsed = parseAssistantContent([
    'LLM Running (Turn 8)',
    '',
    '## **Inspecting** [chat output](https://example.test)',
    'More detail follows.',
  ].join('\n'))
  assert.equal(parsed.runs[0].title, 'Inspecting chat output')
})

test('turn title keeps summary priority and only uses Turn N for empty content', () => {
  const withSummary = parseAssistantContent('LLM Running (Turn 9)\n<summary>Preferred summary</summary>\n🛠️ code_run({})')
  assert.equal(withSummary.runs[0].title, 'Preferred summary')
  assert.equal(assistantTurnFallbackTitle('📥 result only', 10), 'Turn 10')
})

test('assistant parser ignores transcript markers inside fenced tool output', () => {
  const text = [
    'LLM Running (Turn 24)',
    '<summary>real 24</summary>',
    'before tool output',
    '```',
    'tool log includes a fake marker:',
    'LLM Running (Turn 25)',
    '<summary>fake turn in code fence</summary>',
    '```',
    'after tool output',
    '',
    'LLM Running (Turn 25)',
    '<summary>real 25</summary>',
    'real turn body',
    '',
    '```',
    '[Info] Final response to user.',
    '```',
    'final answer',
  ].join('\n')
  const parsed = parseAssistantContent(text)
  assert.equal(parsed.runs.length, 2)
  assert.equal(parsed.runs[0].turn, 24)
  assert.equal(parsed.runs[0].title, 'real 24')
  assert.match(parsed.runs[0].body, /fake marker/)
  assert.match(parsed.runs[0].body, /after tool output/)
  assert.equal(parsed.runs[1].turn, 25)
  assert.equal(parsed.runs[1].title, 'real 25')
  assert.equal(parsed.body, 'final answer')
})

test('short inner fence does not close a longer tool-output fence', () => {
  const text = [
    'LLM Running (Turn 24)',
    '<summary>real 24</summary>',
    '`````text',
    'code_run stdout starts a markdown sample:',
    '```',
    'LLM Running (Turn 999)',
    '<summary>fake marker in tool output</summary>',
    '`````',
    'LLM Running (Turn 25)',
    '<summary>real 25</summary>',
    'real turn body',
  ].join('\n')
  const parsed = parseAssistantContent(text)
  assert.deepEqual(parsed.runs.map(run => run.turn), [24, 25])
  assert.match(parsed.runs[0].body, /Turn 999/)
  assert.equal(parsed.runs[1].title, 'real 25')
})

test('trailing unclosed fence remains a code part while tool output streams', () => {
  const text = [
    'Tool preface',
    '````text',
    '{"tabs_only": false}',
    '````',
    '`````',
    "[Info] {'status': 'success', 'metadata': {'tabs_count': 103}}",
  ].join('\n')
  const parts = splitMarkdownParts(text)
  assert.deepEqual(parts.map(part => part.type), ['text', 'code', 'text', 'code'])
  assert.equal(parts[1].fence, '````')
  assert.equal(parts[1].lang, 'text')
  assert.equal(parts[1].closed, true)
  assert.match(parts[1].text, /tabs_only/)
  assert.equal(parts[3].fence, '`````')
  assert.equal(parts[3].lang, '')
  assert.equal(parts[3].closed, false)
  assert.match(parts[3].text, /^\[Info\].*tabs_count/)
})

test('Info is recognized as a tool result marker', () => {
  assert.equal(isToolResultText("[Info] {'status': 'success'}"), true)
  assert.equal(isToolResultText('[Information] ordinary prose'), false)
})

test('parseCodeFenceInfo handles lang:filename and title attributes', () => {
  assert.deepEqual(parseCodeFenceInfo('text:test_render_doc.txt'), { lang: 'text', filename: 'test_render_doc.txt' })
  assert.deepEqual(parseCodeFenceInfo('python:app.py'), { lang: 'python', filename: 'app.py' })
  assert.deepEqual(parseCodeFenceInfo('json title="config.json"'), { lang: 'json', filename: 'config.json' })
  assert.deepEqual(parseCodeFenceInfo("ts filename='src/index.ts'"), { lang: 'ts', filename: 'src/index.ts' })
  assert.deepEqual(parseCodeFenceInfo('js main.js'), { lang: 'js', filename: 'main.js' })
  assert.deepEqual(parseCodeFenceInfo('python'), { lang: 'python', filename: '' })
  assert.deepEqual(parseCodeFenceInfo(':README.md'), { lang: '', filename: 'README.md' })
  assert.deepEqual(parseCodeFenceInfo(''), { lang: '', filename: '' })
})

test('splitMarkdownParts preserves filename from fence info', () => {
  const parts = splitMarkdownParts('```text:test_render_doc.txt\nHello Doc\n```')
  assert.equal(parts.length, 1)
  assert.equal(parts[0].type, 'code')
  assert.equal(parts[0].lang, 'text')
  assert.equal(parts[0].filename, 'test_render_doc.txt')
  assert.equal(parts[0].text, 'Hello Doc\n')
})
