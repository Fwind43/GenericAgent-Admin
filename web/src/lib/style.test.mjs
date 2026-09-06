import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../style.css'), 'utf8').replace(/\r\n?/g, '\n')
const mainSource = readFileSync(resolve(here, '../main.jsx'), 'utf8').replace(/\r\n?/g, '\n')
const chatSource = readFileSync(resolve(here, '../ChatApp.jsx'), 'utf8').replace(/\r\n?/g, '\n')

const ruleBodies = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  assert.ok(matches.length > 0, `missing CSS rule for ${selector}`)
  return matches.map(match => match[1])
}

test('chat topbar has no waiting-reply navigation or reserved layout', () => {
  const header = chatSource.match(/<header className="oa-topbar">([\s\S]*?)<\/header>/)?.[1]
  assert.ok(header, 'the topbar layout must not depend on waiting sessions')
  assert.doesNotMatch(chatSource, /ChatWaitingMenu/)
  assert.doesNotMatch(header, /waitingSessions|waitingSessionIds|oa-waiting-/)
  assert.doesNotMatch(css, /\.oa-waiting-|\.oa-topbar\.has-waiting/)
  assert.match(header, /oa-topbar-tools/)
  assert.match(chatSource, /waiting=\{waitingSessionIds\.has\(session\.id\)\}/)
})

test('all color themes share one product font stack', () => {
  const fontDeclarations = [...css.matchAll(/--font\s*:\s*([^;]+);/g)]
  assert.equal(fontDeclarations.length, 1, 'the product font must have a single source of truth')
  assert.match(fontDeclarations[0][1], /^\s*"MiSans VF"/i)
  assert.match(fontDeclarations[0][1], /"Microsoft YaHei UI"/i)

  const bodyRule = ruleBodies('body').join('\n')
  assert.match(bodyRule, /font-family\s*:\s*var\(--font\)/i)
  assert.match(bodyRule, /font-weight\s*:\s*450/i)
  const renderedCss = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const regularWeightRules = [...renderedCss.matchAll(/([^{}]+)\{([^{}]*font-weight\s*:\s*400(?:\D|$)[^{}]*)\}/gi)]
  assert.ok(
    regularWeightRules.every(([, selector]) => selector.trim() === '.oa-md'),
    '400 weight is reserved for full-size conversation text, not compact MiSans UI labels',
  )
  assert.equal(regularWeightRules.length, 1, 'conversation text should have one intentional 400-weight source')
  assert.doesNotMatch(renderedCss, /-webkit-font-smoothing\s*:/i, 'Windows ClearType must remain enabled')
  assert.doesNotMatch(renderedCss, /text-rendering\s*:\s*optimizeLegibility/i)
  assert.match(ruleBodies('.oa-session-menu button').join('\n'), /font-size\s*:\s*13px[\s\S]*font-weight\s*:\s*500/i)

  for (const selector of ['html[data-theme="warm"]', 'html[data-theme="light"]', 'html[data-theme="dark"]']) {
    assert.doesNotMatch(ruleBodies(selector).join('\n'), /--font\s*:/i, `${selector} must only change palette tokens`)
  }

  assert.match(mainSource, /fontFamily\s*:\s*['"]var\(--font\)['"]/)
  assert.doesNotMatch(mainSource, /fontFamily\s*:\s*['"]Inter\b/i)
})

test('chat markdown uses a scale-safe readable type hierarchy', () => {
  const prose = ruleBodies('.oa-md').join('\n')
  assert.match(prose, /font-size\s*:\s*16px/i)
  assert.match(prose, /line-height\s*:\s*28px/i)
  assert.match(prose, /font-weight\s*:\s*400/i)
  assert.match(prose, /letter-spacing\s*:\s*normal/i)

  const renderedCss = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const bareMarkdownRules = [...renderedCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some(selector => selector.trim() === '.oa-md'))
    .map(([, , body]) => body)
  const declaredValues = property => bareMarkdownRules.flatMap(body =>
    [...body.matchAll(new RegExp(`${property}\\s*:\\s*([^;]+)`, 'gi'))]
      .map(match => match[1].trim()),
  )
  assert.deepEqual(declaredValues('font-size'), ['16px'], 'bare .oa-md must have one font-size source')
  assert.deepEqual(declaredValues('line-height'), ['28px'], 'bare .oa-md must have one line-height source')

  const emphasis = ruleBodies('.oa-md strong,.oa-md b').join('\n')
  assert.match(emphasis, /font-weight\s*:\s*500/i)

  const headings = ruleBodies('.oa-md h1,.oa-md h2,.oa-md h3,.oa-md h4,.oa-md h5,.oa-md h6').join('\n')
  assert.match(headings, /font-weight\s*:\s*600/i)
  assert.doesNotMatch(headings, /font-weight\s*:\s*700/i)
})

test('model call rows stay inline until phone-width containers', () => {
  const inlineRule = ruleBodies('.models-page .model-call-main')
    .find(rule => /grid-template-columns\s*:\s*18px\s+42px\s+minmax\(0,\s*1fr\)\s+auto\s+auto/i.test(rule))
  assert.ok(inlineRule, 'model call rows need a five-column inline layout by default')
  assert.match(
    css,
    /@container\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.models-page \.model-call-main\s*\{[^}]*grid-template-areas\s*:[^}]*"handle slot copy"[^}]*"provider provider actions"/i,
  )
  assert.doesNotMatch(
    css,
    /@container\s*\(max-width:\s*860px\)\s*\{[\s\S]*?\.models-page \.model-call-main/i,
    'normal split-pane widths must not force model call rows onto two lines',
  )
})

test('log-view keeps a readable foreground over its forced dark background', () => {
  const sharedPanelRules = ruleBodies('.log-panel pre, .preview pre, .artifact-view, .json-editor, .file-editor')
  assert.ok(
    sharedPanelRules.some(rule => /color\s*:\s*var\(--text\)\s*!important/i.test(rule)),
    'expected a shared panel rule that can force dark text with !important',
  )

  const logViewRule = ruleBodies('.log-panel pre.log-view')
    .find(rule => /background\s*:\s*#0f1115\s*!important/i.test(rule))
  assert.ok(logViewRule, 'missing forced dark log-view background rule')
  assert.match(logViewRule, /color\s*:\s*#d7e1ea\s*!important/i)
})

test('shared status feedback stays keyboard-visible and readable at narrow widths', () => {
  const focusRule = ruleBodies('.ga-status-actions button:focus-visible').join('\n')
  assert.match(focusRule, /outline\s*:\s*2px\s+solid/i)
  assert.match(focusRule, /outline-offset\s*:\s*2px/i)

  assert.match(
    css,
    /@media\s*\(max-width:\s*620px\)[\s\S]*?\.ga-status-notice\s*\{[^}]*max-width\s*:\s*100%[^}]*\}/i,
  )
  assert.match(
    css,
    /@media\s*\(max-width:\s*620px\)[\s\S]*?\.ga-status-message\s*\{[^}]*white-space\s*:\s*normal[^}]*overflow-wrap\s*:\s*anywhere[^}]*\}/i,
  )
})

test('sidebar status notice fits its compact rail without hiding actions', () => {
  const noticeRule = ruleBodies('.ga-status-notice').join('\n')
  assert.match(noticeRule, /display\s*:\s*inline-grid/i)
  assert.match(noticeRule, /grid-template-columns\s*:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/i)
  assert.match(noticeRule, /min-width\s*:\s*0/i)
  assert.match(noticeRule, /box-sizing\s*:\s*border-box/i)

  const sidebarRule = ruleBodies('.sidebar > .ga-status-notice').join('\n')
  assert.match(sidebarRule, /width\s*:\s*100%/i)
  assert.match(sidebarRule, /grid-template-columns\s*:\s*auto\s+minmax\(0,\s*1fr\)/i)

  const messageRule = ruleBodies('.sidebar > .ga-status-notice .ga-status-message').join('\n')
  assert.match(messageRule, /white-space\s*:\s*normal/i)
  assert.match(messageRule, /overflow-wrap\s*:\s*anywhere/i)

  const actionsRule = ruleBodies('.sidebar > .ga-status-notice .ga-status-actions').join('\n')
  assert.match(actionsRule, /width\s*:\s*100%/i)
})

test('language controls reserve stable space for translated labels', () => {
  const segmented = ruleBodies('.set-segmented button').join('\n')
  assert.match(segmented, /min-width\s*:\s*74px/i)
  assert.match(segmented, /white-space\s*:\s*nowrap/i)
  assert.match(
    css,
    /html\[data-color-scheme="dark"\] \.app \.sidebar nav button\.active,[\s\S]*?\{[^}]*background:\s*var\(--surface-muted\)\s*!important[^}]*color:\s*var\(--text\)\s*!important/s,
  )
})

test('sent-message editor exposes keyboard focus and a narrow action layout', () => {
  const focusRule = ruleBodies('.oa-message-editor-actions button:focus-visible').join('\n')
  assert.match(focusRule, /outline\s*:\s*2px\s+solid/i)
  assert.match(focusRule, /outline-offset\s*:\s*2px/i)

  assert.match(
    css,
    /@media\s*\(max-width:\s*520px\)[^{]*\{[\s\S]*?\.oa-message-editor-hint\s*\{[^}]*white-space\s*:\s*normal[^}]*\}/i,
  )
})

test('model discovery keeps focus, responsive controls, and reduced-motion meaning', () => {
  const focusRule = ruleBodies('.model-discover-modal .model-candidate-item:focus-visible').join('\n')
  assert.match(focusRule, /outline\s*:\s*2px\s+solid/i)

  assert.match(
    css,
    /@media\s*\(max-width:\s*620px\)[\s\S]*?\.models-page \.model-discover-row\s*\{[^}]*flex-direction\s*:\s*column[^}]*\}/i,
  )
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.model-discover-modal \.is-spinning\s*\{[^}]*animation\s*:\s*none[^}]*\}/i,
  )
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.ga-status-pending \.ga-status-mark\s*\{[^}]*animation\s*:\s*none[^}]*\}/i,
  )
})

test('settings rows render a real switch, a state pill, and stack on narrow screens', () => {
  assert.match(ruleBodies('.set-toggle-track').join('\n'), /border-radius\s*:\s*999px/i)
  assert.match(css, /\.set-toggle input:checked \+ \.set-toggle-track \.set-toggle-knob\s*\{[^}]*transform\s*:\s*translateX/i)
  const stateRule = ruleBodies('.settings-toggle-state').join('\n')
  assert.match(stateRule, /border-radius\s*:\s*999px/i)
  assert.match(stateRule, /font-weight\s*:\s*700/i)
  assert.match(ruleBodies('.set-card-footer').join('\n'), /justify-content\s*:\s*flex-end/i)
  assert.match(
    css,
    /\.settings-toggle-state\.is-on\s*\{[^}]*color\s*:\s*var\(--settings-success-ink\)[^}]*\}/i,
  )
  assert.match(
    css,
    /@media\s*\(max-width:\s*720px\)[\s\S]*?\.set-row\s*\{[^}]*flex-direction\s*:\s*column[^}]*\}/i,
  )
})


// The first-run screen is a purpose-built setup console. Its structural rules
// must exist at desktop widths rather than leaning on component-library defaults.
test('first-run setup console carries its own responsive two-pane layout', () => {
  const shell = ruleBodies('.setup-console-shell').join('\n')
  assert.match(shell, /min-height\s*:\s*100(?:s)?vh/i)
  assert.match(shell, /place-items\s*:\s*center/i)

  const frame = ruleBodies('.setup-console-frame').join('\n')
  assert.match(frame, /width\s*:\s*min\(/i)
  assert.match(frame, /height\s*:\s*auto/i)
  assert.match(frame, /min-height\s*:\s*min\(\s*680px\s*,\s*calc\(\s*100svh\s*-\s*56px\s*\)\s*\)/i)
  assert.doesNotMatch(frame, /(?:^|\n)\s*height\s*:\s*min\(/i)
  assert.match(frame, /grid-template-columns\s*:/i)
  assert.match(frame, /overflow\s*:\s*hidden/i)

  const rail = ruleBodies('.setup-console-rail').join('\n')
  assert.match(rail, /display\s*:\s*flex/i)
  assert.match(rail, /flex-direction\s*:\s*column/i)
  assert.match(rail, /border-right\s*:/i)

  const main = ruleBodies('.setup-console-main').join('\n')
  assert.match(main, /overflow\s*:\s*visible/i)
  assert.doesNotMatch(main, /overflow-y\s*:\s*auto/i)
  assert.match(ruleBodies('.setup-console-columns').join('\n'), /grid-template-columns\s*:/i)
  assert.match(ruleBodies('.setup-console-log').join('\n'), /border-top\s*:/i)

  // The dark palette owns both setup surfaces instead of leaving a light shell
  // behind dark controls.
  assert.match(css, /html\[data-color-scheme="dark"\] \.setup-console-shell\s*\{/i)
  assert.match(css, /html\[data-color-scheme="dark"\] \.setup-console-rail\s*\{/i)

  // Mobile collapses the workspace to one column and removes the rail divider.
  assert.match(
    css,
    /@media\s*\(max-width:\s*900px\)[\s\S]*?\.setup-console-frame\s*\{[^}]*grid-template-columns\s*:\s*1fr/i,
  )

  // The removed Card/Steps implementation must not leave competing selectors.
  for (const dead of [/\.setup-wizard-/, /\.setup-ant-steps/, /\.setup-env-card/, /\.setup-panel\b/]) {
    assert.doesNotMatch(css, dead, `dead setup rule still present: ${dead}`)
  }
})

test('theme IDs only select token scopes while color schemes own shared compatibility', () => {
  assert.match(css, /html\[data-color-scheme="light"\]\s*\{\s*color-scheme:\s*light;\s*\}/i)
  assert.match(css, /html\[data-color-scheme="dark"\]\s*\{\s*color-scheme:\s*dark;\s*\}/i)

  const themeRules = [...css.matchAll(/([^{}]*\[data-theme="(?:light|warm|dark)"\][^{}]*)\{([^{}]*)\}/g)]
  assert.ok(themeRules.length >= 3, 'expected a token scope for every registered theme')

  for (const [, selector, body] of themeRules) {
    const declarations = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(';')
      .map(value => value.trim())
      .filter(Boolean)
    assert.ok(declarations.length > 0, `empty theme token scope: ${selector.trim()}`)
    assert.ok(
      declarations.every(declaration => declaration.startsWith('--')),
      `theme scope contains a structural declaration: ${selector.trim()}`,
    )
  }

  assert.equal((css.match(/\[data-theme="dark"\]/g) || []).length, 1)
  assert.ok((css.match(/\[data-color-scheme="dark"\]/g) || []).length > 1)
})

test('chat layout is shared instead of being coupled to the light palette', () => {
  const lightChatRule = ruleBodies('html[data-theme="light"] .oa-chat').join('\n')
  assert.doesNotMatch(lightChatRule, /(?:height|display|grid-template-columns|overflow|transition)\s*:/i)

  const sharedChatRule = ruleBodies('.oa-chat')
    .find(rule => /grid-template-columns\s*:\s*320px\s+minmax\(0,\s*1fr\)/i.test(rule))
  assert.ok(sharedChatRule, 'missing shared 320px chat layout')
  assert.match(sharedChatRule, /height\s*:\s*100vh/i)
  assert.match(sharedChatRule, /overflow\s*:\s*hidden/i)
})

test('theme-specific metadata and settings actions keep readable foregrounds', () => {
  const warmChatRule = ruleBodies('.oa-chat').join('\n')
  const lightChatRule = ruleBodies('html[data-theme="light"] .oa-chat').join('\n')
  const darkChatRule = ruleBodies('html[data-color-scheme="dark"] .oa-chat').join('\n')
  assert.match(warmChatRule, /--oa-faint\s*:\s*#756f66/i)
  assert.match(lightChatRule, /--oa-faint\s*:\s*#737373/i)
  assert.match(darkChatRule, /--oa-faint\s*:\s*#9299a4/i)
  assert.doesNotMatch(css, /--oa-faint\s*:\s*#[0-9a-f]{7}(?![0-9a-f])/i)

  const usageInlineRule = ruleBodies('.oa-usage.oa-usage-inline').join('\n')
  const usageTotalRule = ruleBodies('.oa-usage.oa-usage-total').join('\n')
  assert.match(usageInlineRule, /opacity\s*:\s*1/i)
  assert.match(usageTotalRule, /opacity\s*:\s*1/i)
  assert.match(usageTotalRule, /min-width\s*:\s*0/i)
  assert.match(usageTotalRule, /max-width\s*:\s*100%/i)
  assert.match(usageTotalRule, /flex-wrap\s*:\s*nowrap/i)
  assert.match(usageTotalRule, /overflow-x\s*:\s*auto/i)
  assert.match(usageTotalRule, /white-space\s*:\s*nowrap/i)
  assert.match(ruleBodies('.oa-message.assistant .oa-msg-footer > .oa-usage.oa-usage-total').join('\n'), /flex\s*:\s*1\s+1\s+0/i)
  assert.match(ruleBodies('.oa-usage.oa-usage-total > *').join('\n'), /flex\s*:\s*0\s+0\s+auto/i)
  assert.match(css, /\.oa-usage\.oa-usage-total::-webkit-scrollbar\s*\{[^}]*display\s*:\s*none/i)
  assert.match(css, /\.oa-turn-toggle:hover \.oa-usage-inline,\s*\.oa-turn-current-head:hover \.oa-usage-inline\s*\{[^}]*opacity\s*:\s*1/i)
  assert.match(ruleBodies('.oa-usage.oa-usage-total:hover').join('\n'), /opacity\s*:\s*1/i)
  assert.match(ruleBodies('.oa-message.user .oa-msg-meta').join('\n'), /color\s*:\s*var\(--oa-faint\)/i)

  const settingsRules = ruleBodies('.settings-page').join('\n')
  const darkSettingsRules = ruleBodies('html[data-color-scheme="dark"] .settings-page').join('\n')
  assert.match(settingsRules, /--settings-success-ink\s*:\s*#176b3c/i)
  assert.match(darkSettingsRules, /--settings-success-ink\s*:\s*#84e1c0/i)
  assert.match(ruleBodies('.set-state.is-on').join('\n'), /color\s*:\s*var\(--settings-success-ink/i)
  assert.match(ruleBodies('.settings-toggle-state.is-on').join('\n'), /color\s*:\s*var\(--settings-success-ink\)/i)

  const darkSettingsPrimary = ruleBodies('html[data-color-scheme="dark"] .settings-page button.primary').join('\n')
  assert.match(darkSettingsPrimary, /color\s*:\s*#062e25/i)
})

test('turn toggles stay left aligned when usage metadata is absent', () => {
  const toggleRules = ruleBodies('.oa-turn-toggle').join('\n')
  assert.match(toggleRules, /justify-content\s*:\s*flex-start/i)
})

test('mobile turn headers hide token metadata while keeping the current status readable', () => {
  assert.match(
    css,
    /@media\s*\(max-width:\s*900px\)[\s\S]*?\.oa-turn-toggle \.oa-usage-inline,\s*\.oa-turn-current-head \.oa-usage-inline\s*\{\s*display\s*:\s*none\s*;\s*\}/i,
  )
  assert.match(
    css,
    /\.oa-turn-current-head \.oa-usage-inline \+ em\s*\{\s*margin-left\s*:\s*auto\s*;\s*\}/i,
  )
  const inlineBaseIndex = css.indexOf('.oa-usage.oa-usage-inline {')
  const mobileHideIndex = css.indexOf('.oa-turn-toggle .oa-usage-inline,\n  .oa-turn-current-head .oa-usage-inline { display:none; }')
  assert.ok(inlineBaseIndex >= 0, 'missing inline usage base rule')
  assert.ok(mobileHideIndex > inlineBaseIndex, 'mobile hide rule must follow inline usage base styles')
})

test('chat markdown tables stay readable, scannable, and horizontally usable', () => {
  for (const selector of ['html[data-theme="warm"]', 'html[data-theme="light"]', 'html[data-theme="dark"]']) {
    const themeRules = ruleBodies(selector).filter(rule => /--chat-table-border\s*:/i.test(rule))
    assert.ok(themeRules.length > 0, `missing chat table tokens for ${selector}`)
    const palette = themeRules.join('\n')
    assert.match(palette, /--chat-table-header-bg\s*:/i)
    assert.match(palette, /--chat-table-row-alt\s*:/i)
    assert.match(palette, /--chat-table-row-hover\s*:/i)
  }

  const wrapRule = ruleBodies('.oa-table-wrap').join('\n')
  const tableRule = ruleBodies('.oa-md-table').join('\n')
  const cellRule = ruleBodies('.oa-md-table th,.oa-md-table td').join('\n')
  const headerRule = ruleBodies('.oa-md-table th').join('\n')
  const stripeRule = ruleBodies('.oa-md-table tbody tr:nth-child(even) td').join('\n')
  const hoverRule = ruleBodies('.oa-md-table tbody tr:hover td').join('\n')
  assert.match(wrapRule, /border\s*:\s*1px\s+solid\s+var\(--chat-table-border\)/i)
  assert.match(wrapRule, /overscroll-behavior-inline\s*:\s*contain/i)
  assert.match(wrapRule, /scrollbar-width\s*:\s*thin/i)
  assert.match(tableRule, /min-width\s*:\s*max\(100%,\s*520px\)/i)
  assert.match(tableRule, /font-variant-numeric\s*:\s*tabular-nums/i)
  assert.doesNotMatch(cellRule, /border-right\s*:/i)
  assert.match(cellRule, /overflow-wrap\s*:\s*break-word/i)
  assert.match(headerRule, /background\s*:\s*var\(--chat-table-header-bg\)/i)
  assert.match(stripeRule, /background\s*:\s*var\(--chat-table-row-alt\)/i)
  assert.match(hoverRule, /background\s*:\s*var\(--chat-table-row-hover\)/i)
  assert.match(css, /@media\s*\(max-width:\s*620px\)[\s\S]*?\.oa-md-table\s*\{[^}]*min-width\s*:\s*480px/i)
})

test('warm chat metadata clears AA contrast on translucent panels', () => {
  const declaration = (body, name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = body.match(new RegExp(`${escaped}\\s*:\\s*([^;]+)`, 'i'))
    assert.ok(match, `missing ${name} declaration`)
    return match[1].trim()
  }
  const color = (value) => {
    const hex = value.match(/^#([0-9a-f]{6})$/i)
    if (hex) {
      const packed = Number.parseInt(hex[1], 16)
      return { rgb: [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255], alpha: 1 }
    }
    const rgba = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i)
    assert.ok(rgba, `unsupported CSS color: ${value}`)
    return { rgb: rgba.slice(1, 4).map(Number), alpha: Number(rgba[4]) }
  }
  const over = (foreground, background) => ({
    rgb: foreground.rgb.map((channel, index) => (
      channel * foreground.alpha + background.rgb[index] * (1 - foreground.alpha)
    )),
    alpha: 1,
  })
  const luminance = ({ rgb }) => rgb
    .map(channel => channel / 255)
    .map(channel => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  const contrast = (first, second) => {
    const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
    return (values[0] + 0.05) / (values[1] + 0.05)
  }

  const warmThemeRule = ruleBodies('html[data-theme="warm"]')
    .find(rule => /--surface-strong\s*:/i.test(rule))
  const warmChatRule = ruleBodies('.oa-chat')
    .find(rule => /--oa-muted\s*:/i.test(rule))
  const rootPaletteRule = ruleBodies(':root')
    .find(rule => /--g-ffffffa78\s*:/i.test(rule))
  assert.ok(warmThemeRule, 'missing warm theme surface tokens')
  assert.ok(warmChatRule, 'missing warm chat color tokens')
  assert.ok(rootPaletteRule, 'missing shared light alpha palette')

  const resolveColor = (value) => {
    const reference = value.match(/^var\((--[\w-]+)\)$/i)
    return color(reference ? declaration(rootPaletteRule, reference[1]) : value)
  }
  const worldlineKindRule = ruleBodies('.oa-worldline-kind').join('\n')
  assert.match(worldlineKindRule, /background\s*:\s*var\(--oa-hover\)/i)
  assert.match(worldlineKindRule, /color\s*:\s*var\(--oa-muted\)/i)

  const page = resolveColor(declaration(warmThemeRule, '--surface-strong'))
  const drawer = over(resolveColor(declaration(warmChatRule, '--oa-panel')), page)
  const badge = over(resolveColor(declaration(warmChatRule, '--oa-hover')), drawer)
  const muted = resolveColor(declaration(warmChatRule, '--oa-muted'))
  const ratio = contrast(muted, badge)

  assert.ok(ratio >= 4.5, `warm muted contrast ${ratio.toFixed(2)} is below WCAG AA`)
})

test('chat topbar separates conversation views from the appearance control', () => {
  const cluster = ruleBodies('.oa-topbar-tools').join('\n')
  const group = ruleBodies('.oa-topbar-view-tools').join('\n')
  const theme = ruleBodies('.oa-topbar-tools .oa-topbar-theme .theme-picker-trigger').join('\n')
  const base = ruleBodies('.oa-topbar-view-tools > .oa-context-btn').join('\n')
  const divider = ruleBodies('.oa-topbar-view-tools > .oa-context-btn + .oa-context-btn').join('\n')
  const badge = ruleBodies('.oa-topbar-view-tools .oa-context-btn span').join('\n')
  const hover = ruleBodies('.oa-topbar-view-tools .oa-context-btn:hover:not(:disabled)').join('\n')
  const open = ruleBodies('.oa-topbar-view-tools .oa-context-btn.is-open').join('\n')
  const openBadge = ruleBodies('.oa-topbar-view-tools .oa-context-btn.is-open span').join('\n')
  const focus = ruleBodies('.oa-topbar-view-tools .oa-context-btn:focus-visible').join('\n')
  const disabled = ruleBodies('.oa-topbar-view-tools .oa-context-btn:disabled').join('\n')

  assert.match(cluster, /gap\s*:\s*8px/i)
  assert.match(group, /background\s*:\s*color-mix\([^;]*var\(--oa-panel\)/i)
  assert.match(group, /border\s*:\s*1px\s+solid\s+var\(--oa-line-strong\)/i)
  assert.match(theme, /width\s*:\s*36px/i)
  assert.match(theme, /border\s*:\s*1px\s+solid\s+var\(--oa-line-strong\)/i)
  assert.match(base, /background\s*:\s*transparent/i)
  assert.match(base, /border\s*:\s*0/i)
  assert.match(base, /color\s*:\s*var\(--oa-text\)/i)
  assert.match(divider, /border-left\s*:\s*1px\s+solid\s+var\(--oa-line\)/i)
  assert.match(badge, /background\s*:\s*var\(--oa-hover\)/i)
  assert.match(badge, /color\s*:\s*var\(--oa-muted\)/i)
  assert.match(hover, /background\s*:\s*var\(--oa-hover\)/i)
  assert.match(open, /background\s*:\s*var\(--oa-hover\)/i)
  assert.match(open, /color\s*:\s*var\(--oa-text\)/i)
  assert.match(open, /box-shadow\s*:\s*inset\s+0\s+-2px\s+var\(--oa-green\)\s*!important/i)
  assert.match(openBadge, /background\s*:\s*var\(--oa-panel\)/i)
  assert.match(openBadge, /color\s*:\s*var\(--oa-text\)/i)
  assert.match(focus, /box-shadow\s*:\s*inset\s+0\s+0\s+0\s+2px\s+var\(--oa-green\)\s*!important/i)
  assert.match(disabled, /opacity\s*:/i)

  const componentRules = [cluster, group, theme, base, divider, badge, hover, open, openBadge, focus, disabled].join('\n')
  assert.doesNotMatch(componentRules, /(?:#(?:000|111|fff)(?:fff)?\b|var\(--(?:d-|n-ffffff|i-111111|i-222222))/i)
  assert.doesNotMatch(css, /html\[data-color-scheme="dark"\][^{]*\.oa-context-btn/i)
})

test('project badge stays compact, semantic, and readable under title pressure', () => {
  const badge = ruleBodies('.oa-title .oa-project-badge').join('\n')
  const label = ruleBodies('.oa-title .oa-project-badge > span').join('\n')
  const collapsed = ruleBodies('.oa-chat.is-collapsed .oa-title .oa-project-badge').join('\n')

  assert.match(chatSource, /className="oa-project-badge"[^>]*><FolderOpen size=\{12\} aria-hidden="true"\/><span>\{current\.project_mode\}<\/span>/)
  assert.doesNotMatch(chatSource, /className="oa-project-badge"[^>]*>Project:/)
  assert.match(badge, /flex\s*:\s*0\s+0\s+auto/i)
  assert.match(badge, /max-width\s*:\s*min\(240px,calc\(100vw\s*-\s*360px\)\)/i)
  assert.match(label, /overflow\s*:\s*hidden/i)
  assert.match(label, /text-overflow\s*:\s*ellipsis/i)
  assert.match(collapsed, /max-width\s*:\s*min\(180px,50%\)/i)
})
