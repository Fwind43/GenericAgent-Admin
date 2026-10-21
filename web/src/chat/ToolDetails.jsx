import { parseToolResultDetails, toolResultState } from './toolArgs.js'
import { ct } from './chatFormat.js'

export const ToolResultDetails = ({ body = '', live = false }) => {
  const sections = parseToolResultDetails(body)
  if (!sections) return <pre className="ga-fold-pre">{body}</pre>
  const state = live ? 'live' : toolResultState(sections)

  return (
    <div className={`ga-tool-result is-${state}`}>
      {sections.map((section, index) => (
        <div className={`ga-tool-result-row is-${section.kind}`} key={`${section.kind}-${index}`}>
          <div className="ga-tool-result-key">{section.kind}</div>
          {section.kind === 'status'
            ? <div className="ga-tool-result-status">{section.content || (live ? ct('\u6267\u884c\u4e2d', 'Running') : '\u2014')}</div>
            : <pre className="ga-tool-result-value">{section.content || ct('\u65e0\u8f93\u51fa', 'No output')}</pre>}
        </div>
      ))}
    </div>
  )
}
