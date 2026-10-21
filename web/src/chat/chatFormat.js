export const chatLanguage = () => typeof localStorage !== 'undefined' && localStorage.getItem('ga-admin-lang') === 'en' ? 'en' : 'zh'

export const ct = (zh, en) => chatLanguage() === 'en' ? en : zh

export const chatLocale = () => chatLanguage() === 'en' ? 'en-US' : 'zh-CN'

export const loopStopReasonText = reason => {
  const raw = String(reason || '').trim()
  if (!raw) return ''
  const separator = raw.indexOf(':')
  const code = separator >= 0 ? raw.slice(0, separator).trim() : raw
  const detail = separator >= 0 ? raw.slice(separator + 1).trim() : ''
  const labels = {
    max_rounds: ct('已达到最大轮数', 'Maximum rounds reached'),
    user: ct('\u5df2\u624b\u52a8\u505c\u6b62', 'Stopped manually'),
    controller_complete: ct('\u63a7\u5236\u6a21\u578b\u5224\u5b9a\u76ee\u6807\u5df2\u5b8c\u6210', 'Controller marked the objective complete'),
    controller_no_action: ct('\u63a7\u5236\u6a21\u578b\u672a\u7ed9\u51fa\u53ef\u6267\u884c\u7684\u4e0b\u4e00\u6b65', 'Controller returned no actionable next step'),
    server_restart: ct('\u670d\u52a1\u91cd\u542f\u540e\u5df2\u6682\u505c', 'Paused after a server restart'),
    controller_error: ct('\u63a7\u5236\u6a21\u578b\u8c03\u7528\u5931\u8d25', 'Controller request failed'),
    controller_protocol_error: ct('\u63a7\u5236\u6a21\u578b\u8fd4\u56de\u683c\u5f0f\u5f02\u5e38', 'Controller returned an invalid decision format'),
    controller_stalled: ct('\u63a7\u5236\u6a21\u578b\u91cd\u590d\u540c\u4e00\u6b65\uff0c\u5df2\u505c\u6b62\u7a7a\u8f6c', 'Controller repeated the same step; stopped to avoid spinning'),
    persist_error: ct('\u4fdd\u5b58 Loop \u72b6\u6001\u5931\u8d25', 'Failed to persist Loop state'),
  }
  const label = labels[code]
  if (!label) return raw
  return detail ? `${label}\uff1a${detail}` : label
}

export const loopPhaseLabel = phase => ({
  started: ct('已启动', 'Started'),
  checking: ct('检查中', 'Checking'),
  retry: ct('重新询问', 'Re-asking'),
  continue: ct('继续推进', 'Continuing'),
  complete: ct('已完成', 'Completed'),
  error: ct('异常', 'Error'),
  paused: ct('已暂停', 'Paused'),
  stalled: ct('空转已停', 'Stopped spinning'),
  stopped: ct('已停止', 'Stopped'),
}[phase] || ct('活动', 'Activity'))

const timestampMs = (v) => {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return Number.isFinite(v) ? (Math.abs(v) < 1e12 ? v * 1000 : v) : NaN
  if (typeof v === 'string') {
    const raw = v.trim()
    if (!raw) return NaN
    const numeric = Number(raw)
    if (Number.isFinite(numeric)) return Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric
  }
  return new Date(v).getTime()
}

export const dateFromTimestamp = (v) => {
  const ms = timestampMs(v)
  return Number.isFinite(ms) ? new Date(ms) : null
}

export const fmtTime = (v) => dateFromTimestamp(v)?.toLocaleString(chatLocale()) || ''

const fmtTimelineDate = (v) => {
  if (!v) return ct('今天', 'Today')
  const d = dateFromTimestamp(v)
  if (!d) return ''
  const now = new Date()
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diff = Math.round((today - day) / 86400000)
  if (diff === 0) return ct('今天', 'Today')
  if (diff === 1) return ct('昨天', 'Yesterday')
  return d.toLocaleDateString(chatLocale(), { year:'numeric', month:'long', day:'numeric' })
}

const timelineKey = (v) => {
  if (!v) return 'today'
  const d = dateFromTimestamp(v)
  return d ? `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}` : 'unknown'
}
