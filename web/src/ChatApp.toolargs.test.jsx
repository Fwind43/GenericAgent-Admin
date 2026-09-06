import React from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ChatMessage, parseToolReceiptArgs, parseToolResultDetails } from './ChatApp.jsx'

afterEach(() => cleanup())

const reportScript = [
  'import json',
  '',
  String.raw`report_path = r"E:\Work\GenericAgent\temp\projects\licai\daily_reports\portfolio_metrics_2026-09-04.json"`,
  'with open(report_path, "r", encoding="utf-8") as f:',
  '    data = json.load(f)',
  '',
  'print("Funds type:", type(data.get("funds")))',
  'print("Funds keys or contents:")',
  'if isinstance(data.get("funds"), dict):',
  '    for code, info in data["funds"].items():',
  '        print(code, info)',
  'elif isinstance(data.get("funds"), list):',
  '    for f in data["funds"][:3]:',
  '        print(f)',
  '',
].join('\n')

const reportArgs = literalNewlines => {
  const lines = reportScript.split('\n').map(line => JSON.stringify(line).slice(1, -1))
  return `{"script":"${lines.join(literalNewlines ? '\n' : '\\n')}"}`
}

describe('tool receipt argument parsing', () => {
  test('parses valid JSON without changing typed values or escaped code', () => {
    expect(parseToolReceiptArgs('{"script":"print(\\"ok\\")\\nnext","count":2,"inline_eval":false}')).toEqual({
      script: 'print("ok")\nnext',
      count: 2,
      inline_eval: false,
    })
  })

  test('repairs literal control characters inside JSON strings', () => {
    const body = '{"script":"import time\ntime.sleep(15)\nprint(\\"done\\")","content":"a\tb\rc"}'
    expect(parseToolReceiptArgs(body)).toEqual({
      script: 'import time\ntime.sleep(15)\nprint("done")',
      content: 'a\tb\rc',
    })
  })

  test('preserves Windows paths whose backslashes were not JSON-escaped', () => {
    expect(parseToolReceiptArgs(String.raw`{"path":"E:\temp\new.txt"}`)).toEqual({
      path: String.raw`E:\temp\new.txt`,
    })
    expect(parseToolReceiptArgs(String.raw`{"path":"E:\\temp\\new.txt"}`)).toEqual({
      path: String.raw`E:\temp\new.txt`,
    })
  })

  test.each(['E:\\', 'E:\\temp\\', 'E:\\temp\\folder name\\'])('preserves trailing separators in path %s', path => {
    for (const value of [JSON.stringify(path), `"${path}"`]) {
      const script = 'print("ok")'
      expect(parseToolReceiptArgs(`{"path":${value}}`)).toEqual({ path })
      expect(parseToolReceiptArgs(`{"before":true,"path":${value},"script":${JSON.stringify(script)}}`)).toEqual({ before: true, path, script })
    }
  })

  test.each(['E:\\temp"}', 'E:\\temp", another', 'E:\\temp":1', 'E:\\temp"]'])('preserves escaped quotes next to JSON punctuation in %s', script => {
    expect(parseToolReceiptArgs(JSON.stringify({ script }))).toEqual({ script })
  })

  test.each([false, true])('preserves quoted paths inside scripts with literal newlines=%s', literalNewlines => {
    expect(parseToolReceiptArgs(reportArgs(literalNewlines))).toEqual({ script: reportScript })
  })

  test('preserves embedded paths and escapes when repairing a separate path argument', () => {
    const script = String.raw`print("E:\temp\new.txt", "\\n", "\\t")`
    const body = `{"cwd":"E:\\temp\\new","script":${JSON.stringify(script)}}`
    expect(parseToolReceiptArgs(body)).toEqual({ cwd: String.raw`E:\temp\new`, script })
  })

  test.each([false, true])('renders script fields instead of raw argument JSON with literal newlines=%s', literalNewlines => {
    const content = [
      '\u{1F6E0}\uFE0F Tool: `code_run`',
      '```text',
      reportArgs(literalNewlines),
      '```',
    ].join('\n')
    const { container } = render(
      <ChatMessage message={{ id: 'script-receipt', role: 'assistant', content, files: [], created_at: 0 }} pending={false} />,
    )
    const args = container.querySelector('.ga-tool-pair-call')
    expect(args?.querySelector('.ga-tool-arg dt')?.textContent).toBe('script')
    expect(args.querySelector('.ga-tool-arg dd')?.textContent).toBe(reportScript)
    expect(args.querySelector('.ga-fold-pre')).toBeNull()
  })

  test('falls back for malformed or non-object JSON', () => {
    expect(parseToolReceiptArgs('{"script":')).toEqual({})
    expect(parseToolReceiptArgs('[1,2]')).toEqual({})
  })
})

describe('tool receipt result parsing', () => {
  test('splits action, status and output while preserving multiline content', () => {
    expect(parseToolResultDetails('[Action] Running python in temp: import time\r\ntime.sleep(15)\r\nprint("done")\r\n[Status] \u2705 Exit Code: 0\r\n[Stdout]\r\ndone\r\n')).toEqual([
      { kind: 'action', content: 'Running python in temp: import time\ntime.sleep(15)\nprint("done")' },
      { kind: 'status', content: '\u2705 Exit Code: 0' },
      { kind: 'stdout', content: 'done' },
    ])
  })

  test('keeps stderr and empty stdout sections in protocol order', () => {
    expect(parseToolResultDetails('[Action] run\n[Status] \u274c Exit Code: 1\n[Stdout]\n[Stderr]\nboom')).toEqual([
      { kind: 'action', content: 'run' },
      { kind: 'status', content: '\u274c Exit Code: 1' },
      { kind: 'stdout', content: '' },
      { kind: 'stderr', content: 'boom' },
    ])
  })

  test('falls back when text does not use recognized result markers', () => {
    expect(parseToolResultDetails('plain tool output')).toBeNull()
    expect(parseToolResultDetails('[Stdout]\nonly output')).toBeNull()
    expect(parseToolResultDetails('prefix\n[Status] ok')).toBeNull()
  })
})
