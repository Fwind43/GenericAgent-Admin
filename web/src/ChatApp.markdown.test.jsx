import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ChatMessage, MessageList } from './ChatApp.jsx'
import { mergeStreamTerminalMessage } from './lib/chatStream.js'
import { reconcileHistoryPage } from './lib/chatHistoryPages.js'

afterEach(() => cleanup())

// Renders model output through the real assistant pipeline
// (ChatMessage -> AssistantContent -> MarkdownBlock -> TextMarkdown).
const renderAssistant = (content, messagePatch = {}) => render(
  <ChatMessage
    message={{ id: 'a-md', role: 'assistant', content, files: [], created_at: 0, ...messagePatch }}
    pending={false}
    onAskReply={vi.fn()}
  />,
).container

describe('assistant markdown rendering', () => {
  test('updates earlier references when a footnote definition arrives during streaming', () => {
    const frame = content => <ChatMessage message={{ id: 'stream-footnote', role: 'assistant', content, files: [], created_at: 0 }} pending onAskReply={vi.fn()} />
    const { container, rerender } = render(frame('Stable **paragraph**.\n\nReference[^late].'))
    const stable = container.querySelector('.oa-md p')
    expect(container.querySelector('.oa-footnote-ref')).toBeNull()

    rerender(frame('Stable **paragraph**.\n\nReference[^late].\n\n[^late]: Final **definition**.'))
    expect(container.querySelector('.oa-md p')).toBe(stable)
    const ref = container.querySelector('.oa-footnote-ref a')
    const item = container.querySelector('.oa-md-footnote-item')
    expect(ref.getAttribute('href')).toBe(`#${item.id}`)
    expect(item.querySelector('strong').textContent).toBe('definition')

    rerender(frame('Stable **paragraph**.\n\nReference[^late].\n\n[^late]: Changed definition.'))
    expect(container.querySelector('.oa-md-footnote-item').textContent).toContain('Changed definition.')
  })

  test('updates table rows and nested list structure while preserving completed blocks', () => {
    const frame = content => <ChatMessage message={{ id: 'stream-structure', role: 'assistant', content, files: [], created_at: 0 }} pending onAskReply={vi.fn()} />
    const prefix = 'Stable **paragraph**.\n\n| Name | Value |\n| --- | --- |\n| A | 1 |'
    const { container, rerender } = render(frame(prefix))
    const stable = container.querySelector('.oa-md p')
    expect(container.querySelectorAll('.oa-md-table tbody tr')).toHaveLength(1)

    rerender(frame(`${prefix}\n| B | 2 |\n\n- parent\n  - child`))
    expect(container.querySelectorAll('.oa-md-table tbody tr')).toHaveLength(2)
    expect(container.querySelector('.oa-list .oa-list').textContent).toContain('child')

    rerender(frame(`${prefix}\n| B | 2 |\n\n- parent\n  - child\n  - next`))
    expect(container.querySelector('.oa-md p')).toBe(stable)
    expect(container.querySelectorAll('.oa-list .oa-list > li')).toHaveLength(2)
  })

  test('renders nested emphasis, code spans and links as real elements', () => {
    const container = renderAssistant('A **bold `snippet` and [link](https://a.test)** tail.')
    const strong = container.querySelector('.oa-md strong')
    expect(strong).toBeTruthy()
    expect(strong.querySelector('code').textContent).toBe('snippet')
    const link = strong.querySelector('a')
    expect(link.getAttribute('href')).toBe('https://a.test')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  test('renders underscore emphasis but leaves snake_case alone', () => {
    const container = renderAssistant('_stressed_ but not snake_case_name here')
    expect(container.querySelector('.oa-md em').textContent).toBe('stressed')
    expect(container.querySelector('.oa-md').textContent).toContain('snake_case_name')
  })

  test('renders file_patch calls as a dedicated file diff instead of raw JSON arguments', () => {
    const args = JSON.stringify({
      path: 'src/components/Demo.jsx',
      old_content: 'const value = 1\nconst stable = true',
      new_content: 'const value = 2\nconst stable = true',
    })
    const container = renderAssistant([
      '\u{1F6E0}\uFE0F Tool: `file_patch`',
      '```text',
      args,
      '```',
    ].join('\n'))

    const panel = container.querySelector('.oa-file-tool-args.is-patch')
    expect(panel).toBeTruthy()
    expect(panel.querySelector('.oa-patch-file-id strong').textContent).toBe('Demo.jsx')
    expect(panel.querySelector('.oa-patch-file-id span').textContent).toBe('src/components/Demo.jsx')
    expect(panel.querySelector('.oa-file-tool-badge')).toBeNull()
    expect(panel.querySelector('.oa-diff-stats-add').textContent).toBe('+1')
    expect(panel.querySelector('.oa-diff-stats-del').textContent).toBe('\u22121')
    const toggle = panel.querySelector('.oa-patch-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toContain('\u6536\u8d77')
    expect(panel.querySelector('.oa-diff-add .oa-diff-text').textContent).toBe('const value = 2')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(panel.querySelector('.oa-diff')).toBeNull()
    fireEvent.click(toggle)
    expect(panel.querySelector('.oa-diff')).toBeTruthy()
    expect(panel.querySelector('.oa-diff-del .oa-diff-text').textContent).toBe('const value = 1')
    expect(container.querySelector('.ga-tool-arg')).toBeNull()
  })

  test('starts a large file_patch collapsed and expands it on demand', () => {
    const before = Array.from({ length: 13 }, (_, i) => `const value${i} = ${i}`).join('\n')
    const after = Array.from({ length: 13 }, (_, i) => `const value${i} = ${i + 1}`).join('\n')
    const args = JSON.stringify({ path: 'src/large.js', old_content: before, new_content: after })
    const container = renderAssistant([
      '\u{1F6E0}\uFE0F Tool: `file_patch`',
      '```text',
      args,
      '```',
    ].join('\n'))

    const panel = container.querySelector('.oa-file-tool-args.is-patch')
    const toggle = panel.querySelector('.oa-patch-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('\u5c55\u5f00')
    expect(panel.querySelector('.oa-diff')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(panel.querySelectorAll('.oa-diff-add').length).toBe(13)
    expect(panel.querySelectorAll('.oa-diff-del').length).toBe(13)
  })

  test('renders file_write with the same compact file bar and collapsible diff as file_patch', () => {
    const args = JSON.stringify({
      path: 'src/generated/config.js',
      content: 'export const enabled = true\nexport const retries = 3',
      mode: 'append',
    })
    const container = renderAssistant([
      '\u{1F6E0}\uFE0F Tool: `file_write`',
      '```text',
      args,
      '```',
    ].join('\n'))

    const panel = container.querySelector('.oa-file-tool-args.is-patch.is-write')
    expect(panel).toBeTruthy()
    expect(panel.querySelector('.oa-patch-file-id strong').textContent).toBe('config.js')
    expect(panel.querySelector('.oa-patch-file-id > span').textContent).toBe('src/generated/config.js')
    expect(panel.querySelector('.oa-patch-mode').textContent).toBe('append')
    expect(panel.querySelector('.oa-file-tool-badge')).toBeNull()
    expect(panel.querySelector('.oa-file-tool-path')).toBeNull()
    expect(panel.querySelector('.oa-diff-stats-add').textContent).toBe('+2')
    expect(panel.querySelector('.oa-diff-stats-del').textContent).toBe('\u22120')
    const toggle = panel.querySelector('.oa-patch-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(panel.querySelectorAll('.oa-diff-add').length).toBe(2)
    fireEvent.click(toggle)
    expect(panel.querySelector('.oa-diff')).toBeNull()
  })

  test('starts a large file_write collapsed and expands it on demand', () => {
    const content = Array.from({ length: 13 }, (_, i) => `line ${i + 1}`).join('\n')
    const args = JSON.stringify({ path: 'src/generated/large.txt', content, mode: 'overwrite' })
    const container = renderAssistant([
      '\u{1F6E0}\uFE0F Tool: `file_write`',
      '```text',
      args,
      '```',
    ].join('\n'))

    const panel = container.querySelector('.oa-file-tool-args.is-patch.is-write')
    const toggle = panel.querySelector('.oa-patch-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(panel.querySelector('.oa-diff')).toBeNull()
    expect(panel.querySelector('.oa-patch-mode')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(panel.querySelectorAll('.oa-diff-add').length).toBe(13)
  })

  test('keeps a small file summary open and shows aggregate line counts', () => {
    const toolCall = (path, content) => [
      '\u{1F6E0}\uFE0F Tool: `file_write`',
      '```text',
      JSON.stringify({ path, content, mode: 'overwrite' }),
      '```',
    ].join('\n')
    const container = renderAssistant([
      toolCall('src/one.js', 'one'),
      toolCall('src/two.js', 'first\nsecond'),
    ].join('\n\n'))

    const toggle = container.querySelector('.oa-file-summary-header')
    expect(toggle).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('.oa-file-summary-item')).toHaveLength(2)
    expect(toggle.querySelector('.stat-added').textContent).toBe('+3')
    expect(toggle.querySelector('.stat-removed').textContent).toBe('\u22120')

    const firstFile = container.querySelector('.oa-file-summary-item')
    expect(firstFile.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(firstFile, { key: ' ' })
    expect(firstFile.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(firstFile, { key: 'Enter' })
    expect(firstFile.getAttribute('aria-expanded')).toBe('false')
  })

  test('starts a many-file summary collapsed and expands only on demand', () => {
    const toolCall = (index) => [
      '\u{1F6E0}\uFE0F Tool: `file_write`',
      '```text',
      JSON.stringify({ path: `src/file-${index}.js`, content: `line ${index}`, mode: 'overwrite' }),
      '```',
    ].join('\n')
    const container = renderAssistant(
      Array.from({ length: 4 }, (_, index) => toolCall(index + 1)).join('\n\n'),
    )

    const toggle = container.querySelector('.oa-file-summary-header')
    expect(toggle).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.oa-file-summary-list')).toBeNull()
    expect(toggle.querySelector('.stat-added').textContent).toBe('+4')
    expect(toggle.querySelector('.stat-removed').textContent).toBe('\u22120')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('.oa-file-summary-item')).toHaveLength(4)
  })

  test('renders a blockquote as a quote element', () => {
    const container = renderAssistant('> quoted **note**\n> second line');
    const quote = container.querySelector('blockquote.oa-md-quote')
    expect(quote).toBeTruthy()
    expect(quote.querySelector('strong').textContent).toBe('note')
  })

  test('renders nested bullets as nested lists', () => {
    const container = renderAssistant('- outer\n  - inner\n- second')
    const outer = container.querySelector('.oa-md > ul.oa-list')
    expect(outer.children.length).toBe(2)
    const inner = outer.querySelector('ul.oa-list')
    expect(inner).toBeTruthy()
    expect(inner.textContent).toContain('inner')
  })

  test('renders task list items as checkboxes reflecting their state', () => {
    const container = renderAssistant('- [x] shipped\n- [ ] pending')
    const boxes = container.querySelectorAll('.oa-list-task input[type="checkbox"]')
    expect(boxes.length).toBe(2)
    expect(boxes[0].checked).toBe(true)
    expect(boxes[1].checked).toBe(false)
    expect(container.querySelector('.oa-task-item.is-done')).toBeTruthy()
  })

  test('renders an inline image instead of leaking a stray exclamation mark', () => {
    const container = renderAssistant('![diagram](https://a.test/d.png)')
    const image = container.querySelector('img.oa-md-image')
    expect(image.getAttribute('src')).toBe('https://a.test/d.png')
    expect(image.getAttribute('alt')).toBe('diagram')
    expect(container.querySelector('.oa-md').textContent).not.toContain('!')
  })

  test('refuses a javascript: destination and keeps the label readable', () => {
    const container = renderAssistant('[tap](javascript:alert(1))')
    expect(container.querySelector('.oa-md a')).toBeNull()
    expect(container.querySelector('.oa-md').textContent).toContain('tap')
  })

  test('renders a table whose delimiter row is short of the header', () => {
    const container = renderAssistant('| a | b | c |\n| --- | --- |\n| 1 | 2 | 3 |')
    const table = container.querySelector('table.oa-md-table')
    expect(table).toBeTruthy()
    expect(table.querySelectorAll('thead th').length).toBe(3)
    expect(table.querySelectorAll('tbody td').length).toBe(3)
  })

  test('keeps a list whole across a blank line and marks it loose', () => {
    const container = renderAssistant('- first\n\n- second')
    const lists = container.querySelectorAll('.oa-md ul.oa-list')
    expect(lists.length).toBe(1)
    expect(lists[0].children.length).toBe(2)
    expect(lists[0].classList.contains('oa-list-loose')).toBe(true)
  })

  test('autolinks a bare url without swallowing trailing punctuation', () => {
    const container = renderAssistant('docs at https://a.test/guide.')
    const link = container.querySelector('.oa-md a')
    expect(link.getAttribute('href')).toBe('https://a.test/guide')
    expect(container.querySelector('.oa-md').textContent).toContain('guide.')
  })

  test('still renders fenced code as a code card with its language', () => {
    const container = renderAssistant('before\n\n```go\nfmt.Println("x")\n```\n\nafter')
    const card = container.querySelector('.oa-code-card')
    expect(card).toBeTruthy()
    expect(card.querySelector('.oa-code-head span').textContent).toBe('go')
    expect(card.querySelector('pre code').textContent).toContain('fmt.Println')
  })

  test('renders bracketed display math through KaTeX', () => {
    const formula = '\\text{tok/s}=\\frac{\\sum \\text{\\u5df2\\u6d4b\\u91cf\\u6b65\\u9aa4\\u7684 output\\_tokens}}{\\sum \\text{generation\\_ms}/1000}'
    const container = renderAssistant(`\\[ ${formula} \\]`)
    const math = container.querySelector('.oa-math-display .katex-display')
    expect(math).toBeTruthy()
    expect(math.querySelector('annotation[encoding="application/x-tex"]').textContent).toBe(formula)
    expect(container.querySelector('.oa-md').textContent).not.toContain('\\[')
  })

  test('renders inline dollar math without parsing prices or code spans', () => {
    const container = renderAssistant('Energy $E=mc^2$, price $5 and $10, code `$x$`.')
    const math = container.querySelectorAll('.oa-math-inline .katex')
    expect(math.length).toBe(1)
    expect(math[0].querySelector('annotation[encoding="application/x-tex"]').textContent).toBe('E=mc^2')
    expect(container.querySelector('code').textContent).toBe('$x$')
    expect(container.querySelector('.oa-md').textContent).toContain('$5 and $10')
  })

  test('still uses structured blocks when the text has no multi-turn protocol', () => {
    const container = renderAssistant('fallback text', {
      structured_content: [
        { type: 'tool_use', id: 'toolu_1', name: 'file_read', input: { path: 'README.md' } },
        { type: 'text', text: 'structured answer' },
      ],
    })

    expect(container.querySelector('.oa-turn-stack')).toBeNull()
    expect(container.textContent).toContain('structured answer')
    expect(container.textContent).not.toContain('fallback text')
  })

  test('keeps the multi-turn UI when the terminal message adds structured content', () => {
    const content = [
      'LLM Running (Turn 1)',
      '<summary>inspect stream</summary>',
      'first body',
      '',
      'LLM Running (Turn 2)',
      '<summary>finish work</summary>',
      'second body',
      '',
      '```',
      '[Info] Final response to user.',
      '```',
      'final answer',
    ].join('\n')
    const structuredContent = [
      { type: 'thinking', thinking: 'terminal-only reasoning' },
      { type: 'text', text: 'final answer' },
    ]

    const container = renderAssistant(content, { structured_content: structuredContent })

    expect(container.querySelector('.oa-turn-stack')).toBeTruthy()
    expect(container.querySelector('.oa-turn-stack-head b').textContent).toBe('2')
    expect(container.querySelector('.oa-turn-current-head').textContent).toContain('finish work')
    expect(container.querySelector('.oa-final-answer').textContent).toContain('final answer')
    expect(container.textContent).not.toContain('terminal-only reasoning')
  })

  test('keeps a heading, rule and paragraph rhythm', () => {
    const container = renderAssistant('# Title\n\nbody text\n\n---\n\n## Next')
    const md = container.querySelector('.oa-md')
    expect(md.querySelector('h1').textContent).toBe('Title')
    expect(md.querySelector('h2').textContent).toBe('Next')
    expect(md.querySelector('hr')).toBeTruthy()
    expect(md.querySelector('p').textContent).toBe('body text')
  })
})

describe('completion render identity', () => {
  test('keeps plain markdown mounted when pending ends and structured text arrives', () => {
    const content = '# Result\n\nFinished paragraph.\n\n```js\nconst answer = 42\n```'
    const message = { id: 'stable-id', role: 'assistant', content, files: [], created_at: 1 }
    const view = render(<ChatMessage message={message} pending />)
    const paragraph = view.container.querySelector('.oa-md p')
    const code = view.container.querySelector('.oa-md pre')
    expect(paragraph).not.toBeNull()
    expect(code).not.toBeNull()
    view.rerender(<ChatMessage message={{ ...message, structured_content: [{ type: 'text', text: content }] }} pending={false} />)
    expect(view.container.querySelector('.oa-md p')).toBe(paragraph)
    expect(view.container.querySelector('.oa-md pre')).toBe(code)
  })

  test('keeps the actual message row and markdown through terminal replay and history refresh', () => {
    const content = 'Finished paragraph.\n\n```js\nconst answer = 42\n```'
    const pending = { id: 'pending-a', role: 'assistant', content, files: [], created_at: 1 }
    const finalMessage = { ...pending, id: 'server-a', structured_content: [{ type: 'text', text: content }] }
    const frame = (messages, running) => <MessageList messages={messages} isCurrentRunning={running} onAskReply={vi.fn()} />
    const view = render(frame([pending], true))
    const row = view.container.querySelector('.oa-message')
    const paragraph = view.container.querySelector('.oa-md p')
    const code = view.container.querySelector('.oa-md pre')
    expect(row).not.toBeNull()
    expect(paragraph).not.toBeNull()
    expect(code).not.toBeNull()
    let messages = mergeStreamTerminalMessage([pending], pending.id, finalMessage)
    const assertMounted = () => {
      view.rerender(frame(messages, false))
      expect(view.container.querySelector('.oa-message')).toBe(row)
      expect(view.container.querySelector('.oa-md p')).toBe(paragraph)
      expect(view.container.querySelector('.oa-md pre')).toBe(code)
    }
    assertMounted()
    messages = mergeStreamTerminalMessage(messages, pending.id, finalMessage)
    assertMounted()
    for (const paged of [false, true]) {
      const latest = { messages: [finalMessage] }
      if (paged) latest.message_index = [{ id: finalMessage.id }]
      messages = reconcileHistoryPage(latest, { messages }).messages
      assertMounted()
    }
  })
})

describe('assistant pre-token feedback', () => {
  test('progresses from connection feedback to elapsed model generation, then yields to the first token', () => {
    const startedAt = 10_000
    const baseMessage = {
      id: 'a-pending', role: 'assistant', content: '', files: [], created_at: 10,
      run_started_at_ms: startedAt,
    }
    const view = render(
      <ChatMessage message={baseMessage} pending clockNow={startedAt} onAskReply={vi.fn()} />,
    )

    let indicator = view.container.querySelector('.oa-thinking')
    expect(indicator.getAttribute('role')).toBe('status')
    expect(indicator.getAttribute('data-stage')).toBe('connecting')
    expect(indicator.textContent).toContain('\u6b63\u5728\u8fde\u63a5\u6a21\u578b')
    expect(indicator.querySelector('.oa-thinking-time')).toBeNull()

    view.rerender(
      <ChatMessage message={baseMessage} pending clockNow={startedAt + 4_000} onAskReply={vi.fn()} />,
    )
    indicator = view.container.querySelector('.oa-thinking')
    expect(indicator.getAttribute('data-stage')).toBe('preparing')
    expect(indicator.textContent).toContain('\u6b63\u5728\u51c6\u5907\u56de\u590d')
    expect(indicator.querySelector('.oa-thinking-time').textContent).toBe('4s')
    expect(indicator.querySelector('.oa-thinking-model')).toBeNull()

    view.rerender(
      <ChatMessage message={baseMessage} pending clockNow={startedAt + 61_000} onAskReply={vi.fn()} />,
    )
    indicator = view.container.querySelector('.oa-thinking')
    expect(indicator.querySelector('.oa-thinking-time').textContent).toBe('1:01')

    view.rerender(
      <ChatMessage message={{ ...baseMessage, model_id: 'gpt-5.6-sol' }} pending clockNow={startedAt + 8_000} onAskReply={vi.fn()} />,
    )
    indicator = view.container.querySelector('.oa-thinking')
    expect(indicator.getAttribute('data-stage')).toBe('generating')
    expect(indicator.textContent).toContain('\u6a21\u578b\u5df2\u63a5\u5165\uff0c\u6b63\u5728\u751f\u6210')
    expect(indicator.querySelector('.oa-thinking-time').textContent).toBe('8s')
    expect(indicator.querySelector('.oa-thinking-model').textContent).toBe('gpt-5.6-sol')

    view.rerender(
      <ChatMessage message={{ ...baseMessage, content: '\u7b2c\u4e00\u4e2a token' }} pending clockNow={startedAt + 8_100} onAskReply={vi.fn()} />,
    )
    expect(view.container.querySelector('.oa-thinking')).toBeNull()
    expect(view.container.textContent).toContain('\u7b2c\u4e00\u4e2a token')
  })

  test('renders markdown image with Windows local path via /api/files/image endpoint', () => {
    const markdown = '![桌面截图](D:\\Program Files\\GenericAgent\\temp\\desktop_screenshot.png)'
    const container = renderAssistant(markdown)
    const img = container.querySelector('img.oa-md-image')
    expect(img).toBeTruthy()
    expect(img.getAttribute('alt')).toBe('桌面截图')
    expect(img.getAttribute('src')).toBe(
      '/api/files/image?path=' + encodeURIComponent('D:\\Program Files\\GenericAgent\\temp\\desktop_screenshot.png')
    )
    const actions = container.querySelectorAll('.oa-md-image-action')
    // 应当有 3 个操作按钮：下载、系统默认程序打开、在文件夹中显示
    expect(actions.length).toBe(3)
  })

  test('renders numeric markdown footnotes with matching scoped anchors', () => {
    const markdown = [
      '在此处引用了外部附件文件[^doc]以及相关图片资源[^img]。',
      '',
      '[^doc]: [test_render_doc.txt](file:///E:/Work/GenericAgent/temp/test_render_doc.txt) - 文本测试文件',
      '[^img]: ![测试图片](file:///E:/Work/GenericAgent/temp/test_render_image.png) - 尺寸 400x200 PNG',
    ].join('\n')
    const container = renderAssistant(markdown)

    const refs = container.querySelectorAll('.oa-footnote-ref')
    expect(refs.length).toBe(2)
    expect(refs[0].textContent).toBe('[1]')
    expect(refs[1].textContent).toBe('[2]')

    const fnList = container.querySelector('.oa-md-footnotes')
    expect(fnList).toBeTruthy()
    const items = fnList.querySelectorAll('.oa-md-footnote-item')
    expect(items.length).toBe(2)
    expect(refs[0].querySelector('a').getAttribute('href')).toBe(`#${items[0].id}`)
    expect(refs[1].querySelector('a').getAttribute('href')).toBe(`#${items[1].id}`)
    expect(items[0].id).not.toBe(items[1].id)

    const docLink = items[0].querySelector('a.oa-md-file-link')
    expect(docLink).toBeTruthy()
    expect(docLink.textContent).toBe('test_render_doc.txt')

    const imgNode = items[1].querySelector('img.oa-md-image')
    expect(imgNode).toBeTruthy()
  })

  test('collects footnotes after fenced code and gives repeated references distinct back links', () => {
    const markdown = [
      'First reference[^note].',
      '',
      '[^note]: Footnote **body**.',
      '',
      '```text',
      'literal [^note] inside code',
      '```',
      '',
      'Second reference[^note]. Missing[^missing].',
    ].join('\n')
    const container = renderAssistant(markdown)
    const markdownRoot = container.querySelector('.oa-md')
    const refs = [...container.querySelectorAll('.oa-footnote-ref')]
    const items = [...container.querySelectorAll('.oa-md-footnote-item')]

    expect(refs.map(ref => ref.textContent)).toEqual(['[1]', '[1]'])
    expect(new Set(refs.map(ref => ref.id)).size).toBe(2)
    expect(refs.map(ref => ref.querySelector('a').getAttribute('href'))).toEqual([`#${items[0].id}`, `#${items[0].id}`])
    expect(container.querySelector('.oa-md').textContent).toContain('Missing[^missing].')
    expect(items.length).toBe(1)
    expect(items[0].querySelector('strong').textContent).toBe('body')

    const backRefs = [...items[0].querySelectorAll('.oa-md-footnote-backref')]
    expect(backRefs.map(link => link.getAttribute('href'))).toEqual(refs.map(ref => `#${ref.id}`))
    expect(markdownRoot.lastElementChild).toBe(container.querySelector('.oa-md-footnotes'))
  })

  test('isolates footnote anchor ids between assistant messages', () => {
    const makeMessage = (id, content) => ({ id, role: 'assistant', content, files: [], created_at: 0 })
    const container = render(<div>
      <ChatMessage message={makeMessage('footnote-a', 'Alpha[^same].\n\n[^same]: First.')} pending={false} onAskReply={vi.fn()} />
      <ChatMessage message={makeMessage('footnote-b', 'Beta[^same].\n\n[^same]: Second.')} pending={false} onAskReply={vi.fn()} />
    </div>).container
    const refs = [...container.querySelectorAll('.oa-footnote-ref')]
    const items = [...container.querySelectorAll('.oa-md-footnote-item')]

    expect(refs.map(ref => ref.textContent)).toEqual(['[1]', '[1]'])
    expect(new Set(refs.map(ref => ref.id)).size).toBe(2)
    expect(new Set(items.map(item => item.id)).size).toBe(2)
    expect(refs.map(ref => ref.querySelector('a').getAttribute('href'))).toEqual(items.map(item => `#${item.id}`))
  })
})
