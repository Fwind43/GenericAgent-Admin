import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBlocks, parseInline, parseTableRows, resolveMarkdownImageUrl, safeUrl } from './markdown.js'

// Collapses an inline tree into a compact string so assertions stay readable.
const shape = (nodes) => nodes.map((n) => {
  if (n.type === 'text') return n.value
  if (n.type === 'code') return `code(${n.value})`
  if (n.type === 'math') return `math(${n.display ? 'display|' : ''}${n.value})`
  if (n.type === 'br') return 'br'
  if (n.type === 'image') return `img(${n.alt}|${n.src})`
  if (n.type === 'link') return `a(${shape(n.children)}|${n.href})`
  return `${n.type}(${shape(n.children)})`
}).join('')

const text = (value) => shape(parseInline(value))

test('emphasis supports both asterisk and underscore forms', () => {
  assert.equal(text('**bold**'), 'strong(bold)')
  assert.equal(text('__bold__'), 'strong(bold)')
  assert.equal(text('*em*'), 'em(em)')
  assert.equal(text('_em_'), 'em(em)')
  assert.equal(text('~~gone~~'), 'del(gone)')
  assert.equal(text('***both***'), 'strong(em(both))')
})

test('inline markup nests instead of flattening', () => {
  assert.equal(text('**bold `code` tail**'), 'strong(bold code(code) tail)')
  assert.equal(text('[**label**](https://a.test)'), 'a(strong(label)|https://a.test)')
  assert.equal(text('*outer **inner** outer*'), 'em(outer strong(inner) outer)')
})

test('underscores inside words stay literal', () => {
  assert.equal(text('snake_case_name'), 'snake_case_name')
  assert.equal(text('a_b_c and _real_'), 'a_b_c and em(real)')
})

test('emphasis delimiters must hug their content', () => {
  // Arithmetic and glob-ish prose must not turn into emphasis.
  assert.equal(text('2 * 3 * 4'), '2 * 3 * 4')
  assert.equal(text('a ** b ** c'), 'a ** b ** c')
})

test('code spans accept backticks via longer fences', () => {
  assert.equal(text('`` a ` b ``'), 'code(a ` b)')
  assert.equal(text('`plain`'), 'code(plain)')
  // Markup inside a code span is not interpreted.
  assert.equal(text('`**not bold**`'), 'code(**not bold**)')
})

test('backslash escapes render the literal character', () => {
  assert.equal(text('\\*not em\\*'), '*not em*')
  assert.equal(text('a \\| b'), 'a | b')
  assert.equal(text('\\`literal\\`'), '`literal`')
})

test('images are distinguished from links', () => {
  assert.equal(text('![alt](https://a.test/i.png)'), 'img(alt|https://a.test/i.png)')
  // Regression: the "!" used to leak out as text next to a link node.
  assert.equal(parseInline('![alt](https://a.test/i.png)').length, 1)
})

test('links accept relative, anchor and mail destinations', () => {
  assert.equal(text('[doc](./docs/a.md)'), 'a(doc|./docs/a.md)')
  assert.equal(text('[top](#section)'), 'a(top|#section)')
  assert.equal(text('[mail](mailto:a@b.test)'), 'a(mail|mailto:a@b.test)')
  assert.equal(text('[t](https://a.test/x_(y)_z)'), 'a(t|https://a.test/x_(y)_z)')
})

test('bare urls become links with sane boundaries', () => {
  assert.equal(text('see https://a.test/x now'), 'see a(https://a.test/x|https://a.test/x) now')
  // Trailing sentence punctuation is not part of the url.
  assert.equal(text('go to https://a.test/x.'), 'go to a(https://a.test/x|https://a.test/x).')
  assert.equal(text('(https://a.test/x)'), '(a(https://a.test/x|https://a.test/x))')
  assert.equal(text('www.a.test/x'), 'a(www.a.test/x|https://www.a.test/x)')
})

test('a bare url inside a link label does not nest anchors', () => {
  assert.equal(text('[https://a.test](https://b.test)'), 'a(https://a.test|https://b.test)')
})

test('dangerous url schemes are refused', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '')
  assert.equal(safeUrl('JaVaScRiPt:alert(1)'), '')
  assert.equal(safeUrl('java\tscript:alert(1)'), '')
  assert.equal(safeUrl('data:text/html;base64,AAAA'), '')
  assert.equal(safeUrl('vbscript:msgbox'), '')
  assert.equal(safeUrl('https://a.test'), 'https://a.test')
  assert.equal(safeUrl('/local/path'), '/local/path')
  assert.equal(safeUrl('D:\\Program Files\\GenericAgent\\temp\\desktop_screenshot.png'), 'D:\\Program Files\\GenericAgent\\temp\\desktop_screenshot.png')
  assert.equal(safeUrl('C:/Users/test/image.png'), 'C:/Users/test/image.png')
  assert.equal(safeUrl('file:///D:/Program%20Files/test.png'), 'file:///D:/Program%20Files/test.png')
})

test('local absolute paths and file URLs are resolved for images', () => {
  assert.equal(
    resolveMarkdownImageUrl('D:\\Program Files\\GenericAgent\\temp\\desktop_screenshot.png'),
    '/api/files/image?path=' + encodeURIComponent('D:\\Program Files\\GenericAgent\\temp\\desktop_screenshot.png'),
  )
  assert.equal(
    resolveMarkdownImageUrl('C:/Users/test/image.png'),
    '/api/files/image?path=' + encodeURIComponent('C:/Users/test/image.png'),
  )
  assert.equal(
    resolveMarkdownImageUrl('/home/user/img.png'),
    '/api/files/image?path=' + encodeURIComponent('/home/user/img.png'),
  )
  assert.equal(
    resolveMarkdownImageUrl('file:///D:/temp/test.png'),
    '/api/files/image?path=' + encodeURIComponent('D:/temp/test.png'),
  )
  assert.equal(
    resolveMarkdownImageUrl('https://example.com/pic.png'),
    'https://example.com/pic.png',
  )
})

test('a blocked link destination degrades to its label text', () => {
  assert.equal(text('[click](javascript:alert(1))'), 'click')
  assert.equal(text('![x](javascript:alert(1))'), 'x')
})

test('hard breaks are honoured', () => {
  assert.equal(text('a<br>b'), 'abrb')
  assert.equal(text('a<br/>b'), 'abrb')
})

test('unmatched delimiters stay literal', () => {
  assert.equal(text('**unclosed'), '**unclosed')
  assert.equal(text('a `unclosed'), 'a `unclosed')
  assert.equal(text('[label](unclosed'), '[label](unclosed')
})

test('headings, rules and paragraphs are recognised', () => {
  const blocks = parseBlocks('# One\n\ntext\n\n---\n\n## Two')
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'hr', 'heading'])
  assert.equal(blocks[0].depth, 1)
  assert.equal(blocks[3].depth, 2)
})

test('a paragraph keeps its internal line breaks', () => {
  const [block] = parseBlocks('line one\nline two')
  assert.equal(block.type, 'paragraph')
  assert.equal(block.text, 'line one\nline two')
})

test('blockquotes parse nested block content', () => {
  const [quote] = parseBlocks('> **note**\n> more')
  assert.equal(quote.type, 'blockquote')
  assert.deepEqual(quote.blocks.map((b) => b.type), ['paragraph'])
  assert.equal(quote.blocks[0].text, '**note**\nmore')
})

test('blockquotes can hold lists and nest', () => {
  const [quote] = parseBlocks('> - a\n> - b')
  assert.equal(quote.blocks[0].type, 'list')
  assert.equal(quote.blocks[0].items.length, 2)
  const [outer] = parseBlocks('> level one\n> > level two')
  assert.equal(outer.blocks.at(-1).type, 'blockquote')
})

test('lists nest by indentation', () => {
  const [list] = parseBlocks('- a\n  - b\n    - c\n- d')
  assert.equal(list.type, 'list')
  assert.equal(list.ordered, false)
  assert.equal(list.items.length, 2)
  const nested = list.items[0].blocks.at(-1)
  assert.equal(nested.type, 'list')
  assert.equal(nested.items[0].blocks[0].text, 'b')
  assert.equal(nested.items[0].blocks.at(-1).type, 'list')
})

test('ordered lists keep their starting number and marker style', () => {
  const [list] = parseBlocks('3. three\n4. four')
  assert.equal(list.ordered, true)
  assert.equal(list.start, 3)
  assert.equal(list.items.length, 2)
  const [paren] = parseBlocks('1) one\n2) two')
  assert.equal(paren.ordered, true)
  assert.equal(paren.items.length, 2)
})

test('switching marker type starts a new list', () => {
  const blocks = parseBlocks('- bullet\n1. number')
  assert.deepEqual(blocks.map((b) => b.type), ['list', 'list'])
  assert.equal(blocks[0].ordered, false)
  assert.equal(blocks[1].ordered, true)
})

test('task list markers are extracted', () => {
  const [list] = parseBlocks('- [x] done\n- [ ] todo\n- plain')
  assert.deepEqual(list.items.map((i) => i.checked), [true, false, null])
  assert.equal(list.items[0].blocks[0].text, 'done')
})

test('a wrapped list item stays one item', () => {
  const [list] = parseBlocks('- first line\n  continued here\n- second')
  assert.equal(list.items.length, 2)
  assert.equal(list.items[0].blocks.length, 1)
  assert.equal(list.items[0].blocks[0].text, 'first line\ncontinued here')
})

test('a blank line between items marks the list loose but keeps it whole', () => {
  const [list] = parseBlocks('- a\n\n- b')
  assert.equal(list.items.length, 2)
  assert.equal(list.tight, false)
  const [tight] = parseBlocks('- a\n- b')
  assert.equal(tight.tight, true)
})

test('a thematic break ends a list rather than becoming an item', () => {
  const blocks = parseBlocks('- a\n\n---\n\ntail')
  assert.deepEqual(blocks.map((b) => b.type), ['list', 'hr', 'paragraph'])
})

test('tables tolerate a ragged delimiter row', () => {
  // A delimiter row short of the header used to reject the table outright.
  const [table] = parseBlocks('| a | b | c |\n| --- | --- |\n| 1 | 2 | 3 |')
  assert.equal(table.type, 'table')
  assert.deepEqual(table.head, ['a', 'b', 'c'])
  assert.deepEqual(table.aligns, ['left', 'left', 'left'])
  assert.deepEqual(table.rows, [['1', '2', '3']])
})

test('table alignment and short delimiters are parsed', () => {
  const [table] = parseBlocks('| l | c | r |\n|:-|:-:|-:|\n| 1 | 2 | 3 |')
  assert.deepEqual(table.aligns, ['left', 'center', 'right'])
})

test('tables without outer pipes and with escaped pipes work', () => {
  const [table] = parseBlocks('a | b\n--- | ---\n1 \\| x | 2')
  assert.deepEqual(table.head, ['a', 'b'])
  assert.deepEqual(table.rows, [['1 | x', '2']])
})

test('a pipe-bearing paragraph is not mistaken for a table', () => {
  const blocks = parseBlocks('use a | b for choice\nand keep going')
  assert.deepEqual(blocks.map((b) => b.type), ['paragraph'])
  assert.equal(parseTableRows(['a | b', 'not | a delimiter']), null)
})

test('a table directly after a paragraph is still detected', () => {
  const blocks = parseBlocks('intro\n| a | b |\n| - | - |\n| 1 | 2 |')
  assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'table'])
})

test('tabs indent list content correctly', () => {
  const [list] = parseBlocks('-\ta\n\t- b')
  assert.equal(list.items.length, 1)
  assert.equal(list.items[0].blocks.at(-1).type, 'list')
})

test('crlf input is normalised', () => {
  const blocks = parseBlocks('# t\r\n\r\nbody\r\n')
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph'])
})

test('inline math recognises dollar and escaped delimiters', () => {
  assert.equal(text('rate $x^2 + y^2$ and \\(z_1\\)'), 'rate math(x^2 + y^2) and math(z_1)')
})

test('math parsing leaves prices, code, double dollars and streaming delimiters intact', () => {
  assert.equal(text('amounts $5 and $10 stay plain'), 'amounts $5 and $10 stay plain')
  assert.equal(text('price $5 then energy $E=mc^2$'), 'price $5 then energy math(E=mc^2)')
  assert.equal(text('prices $5 and $10, then $x+1$'), 'prices $5 and $10, then math(x+1)')
  assert.equal(text('formula $2x+1$ stays math'), 'formula math(2x+1) stays math')
  assert.equal(text('`$x$`'), 'code($x$)')
  assert.equal(text('$$x$$'), '$$x$$')
  assert.equal(text('\\(x + 1'), '\\(x + 1')
})

test('display math blocks support bracket and double-dollar delimiters', () => {
  const formula = '\\text{tok/s}=\\frac{\\sum \\text{\\u5df2\\u6d4b\\u91cf\\u6b65\\u9aa4\\u7684 output\\_tokens}}{\\sum \\text{generation\\_ms}/1000}'
  const bracketed = parseBlocks(`before\n\n\\[ ${formula} \\]\n\nafter`)
  assert.deepEqual(bracketed.map((b) => b.type), ['paragraph', 'math', 'paragraph'])
  assert.equal(bracketed[1].value, formula)
  assert.equal(bracketed[1].display, true)

  const [dollars] = parseBlocks('$$\nx^2 + y^2\n$$')
  assert.deepEqual(dollars, { type: 'math', value: 'x^2 + y^2', display: true })
})

test('an unclosed display delimiter remains paragraph source while streaming', () => {
  const [block] = parseBlocks('\\[\nx + 1')
  assert.deepEqual(block, { type: 'paragraph', text: '\\[\nx + 1' })
})

test('deeply nested emphasis degrades to text instead of recursing forever', () => {
  const deep = `${'*'.repeat(40)}x${'*'.repeat(40)}`
  assert.doesNotThrow(() => parseInline(deep))
  assert.ok(parseInline(deep).length >= 1)
})

test('pathological block nesting terminates', () => {
  const deep = `${'> '.repeat(40)}text`
  assert.doesNotThrow(() => parseBlocks(deep))
  const wide = Array.from({ length: 400 }, (_, i) => `${'  '.repeat(i % 8)}- item ${i}`).join('\n')
  assert.doesNotThrow(() => parseBlocks(wide))
})

test('empty and whitespace input produce no blocks', () => {
  assert.deepEqual(parseBlocks(''), [])
  assert.deepEqual(parseBlocks('\n\n   \n'), [])
  assert.deepEqual(parseInline(''), [])
})
