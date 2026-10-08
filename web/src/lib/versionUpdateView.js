const TEXT = {
  zh: {
    title: '系统更新', subtitle: '检查发行版本，准备更新，并在确认后重启生效。', open: '管理更新',
    current: '当前运行', latest: '最新发行', pending: '待生效版本', notChecked: '尚未检查', noPending: '没有待生效更新',
    check: '检查更新', checking: '正在检查', prepare: '下载并准备更新', restart: '重启并生效', close: '关闭',
    idle: '尚未检查更新', available: '有可用更新', upToDate: '当前无可用更新', unsupported: '此运行方式不支持自动更新',
    ready: '更新已准备，等待重启', readyHint: '升级包已校验并准备好；当前进程仍运行旧版本。重启确认后才会替换并验证新版本。',
    preparingHint: '正在下载、校验并准备升级包。完成后需要单独确认重启，不会自动生效。',
    restartHint: '正在交接更新并验证新版本，服务可能暂时断开。请勿重复执行更新或重启。',
    doneHint: '更新事务已完成；以当前运行版本为准。', failedHint: '更新未完成。请先查看错误与回滚结果，确认运行状态后再重试。',
    checkFailed: '检查更新失败', connectionLost: '暂时无法读取更新状态', stale: '以下是最后读取的状态，恢复连接前暂停更新与重启。',
    stage: '更新状态', notes: '发布说明', noNotes: '此发行未提供说明，可前往发行页面查看。', notesUnchecked: '检查更新后显示发行说明。',
    release: '查看发行', log: '执行日志', noLog: '尚无执行日志。检查更新不会安装文件。', refresh: '刷新状态',
    checkedAt: '检查时间', published: '发布时间', build: '构建', platform: '平台', operation: '事务 ID', target: '目标版本',
    rollback: '回滚结果', confirmed: '已确认版本', assetsMissing: '此发行缺少当前平台的升级包或 SHA256 校验文件，无法自动更新。',
    manual: '请通过原安装方式更新；检查版本和查看发布说明仍然可用。', unknown: '未知',
    footer: '关闭面板不会取消后台更新。准备完成后，重启仍需单独确认。',
    operationChanged: '更新事务已变更，请重新查看状态后再授权重启。',
    conflict: '已有更新正在进行或等待重启，请先查看当前更新状态。',
    stages: { queued: '已排队', checking: '检查发行', checked: '发行已检查', downloading: '下载升级包', downloading_checksum: '下载校验文件', verifying: '校验 SHA256', extracting: '解包', preparing: '准备更新', prepared: '更新已暂存', ready: '等待重启', restarting: '重启已授权', starting_helper: '启动更新助手', waiting_for_exit: '等待旧进程退出', applying: '替换文件', starting_replacement: '启动新版本', replacement_ready: '验证新版本', rolling_back: '正在回滚', rolled_back: '已回滚', failed: '更新失败', done: '更新完成' },
  },
  en: {
    title: 'System update', subtitle: 'Check releases, prepare the update, then confirm a restart to apply it.', open: 'Manage update',
    current: 'Running version', latest: 'Latest release', pending: 'Pending version', notChecked: 'Not checked', noPending: 'No pending update',
    check: 'Check updates', checking: 'Checking', prepare: 'Download & prepare', restart: 'Restart & apply', close: 'Close',
    idle: 'Updates not checked', available: 'Update available', upToDate: 'No update available', unsupported: 'Automatic updates are unavailable in this runtime',
    ready: 'Update prepared · restart required', readyHint: 'The package is verified and staged; this process still runs the old version. Replacement and verification happen after you confirm a restart.',
    preparingHint: 'Downloading, verifying and staging the package. A separate restart confirmation is required; it will not apply automatically.',
    restartHint: 'Handing off the update and verifying the new version. The service may disconnect briefly. Do not start another update or restart.',
    doneHint: 'The update transaction is complete. The running version is authoritative.', failedHint: 'The update did not complete. Check the error and rollback result, then confirm the running state before retrying.',
    checkFailed: 'Update check failed', connectionLost: 'Update status is temporarily unavailable', stale: 'Showing the last known state. Update and restart are paused until the connection recovers.',
    stage: 'Update status', notes: 'Release notes', noNotes: 'No release notes provided. Open the release page for details.', notesUnchecked: 'Check updates to load release notes.',
    release: 'View release', log: 'Execution log', noLog: 'No execution log yet. Checking updates does not install files.', refresh: 'Refresh status',
    checkedAt: 'Last checked', published: 'Published', build: 'Build', platform: 'Platform', operation: 'Operation ID', target: 'Target version',
    rollback: 'Rollback result', confirmed: 'Confirmed version', assetsMissing: 'This release has no package or SHA256 checksum for this platform. Automatic updating is unavailable.',
    manual: 'Update using the original installation method. Version checks and release notes remain available.', unknown: 'Unknown',
    footer: 'Closing does not cancel a background update. Restarting requires a separate confirmation.',
    operationChanged: 'The update operation changed. Review its status before authorizing a restart again.',
    conflict: 'An update is already active or waiting for a restart. Review its status first.',
    stages: { queued: 'Queued', checking: 'Checking release', checked: 'Release checked', downloading: 'Downloading package', downloading_checksum: 'Downloading checksum', verifying: 'Verifying SHA256', extracting: 'Extracting', preparing: 'Preparing update', prepared: 'Update staged', ready: 'Waiting for restart', restarting: 'Restart authorized', starting_helper: 'Starting update helper', waiting_for_exit: 'Waiting for old process', applying: 'Replacing files', starting_replacement: 'Starting new version', replacement_ready: 'Verifying new version', rolling_back: 'Rolling back', rolled_back: 'Rolled back', failed: 'Update failed', done: 'Update complete' },
  },
}

export const updateText = lang => TEXT[lang === 'en' ? 'en' : 'zh']

const PREPARING = new Set(['queued', 'checking', 'checked', 'downloading', 'downloading_checksum', 'verifying', 'extracting', 'preparing'])
const HANDOFF = new Set(['prepared', 'restarting', 'starting_helper', 'waiting_for_exit', 'applying', 'starting_replacement', 'replacement_ready', 'rolling_back'])
export const updateOperationLocked = status => Boolean(status?.running || status?.stage === 'ready' || PREPARING.has(status?.stage) || HANDOFF.has(status?.stage))

export function versionUpdateView({ info, check, status, busy, checking, checkError, statusError, actionError }, lang = 'zh') {
  const text = updateText(lang)
  const stage = status?.stage || ''
  const failed = Boolean(status?.error || stage === 'failed' || stage === 'error' || stage === 'rolled_back')
  const locked = updateOperationLocked(status)
  let label = check ? (check.update ? text.available : text.upToDate) : text.idle
  let tone = check?.update ? 'notice' : 'neutral'
  let hint = ''
  if (stage) {
    label = text.stages[stage] || status.message || stage
    tone = failed ? 'error' : (stage === 'done' ? 'success' : 'notice')
    hint = failed ? text.failedHint : stage === 'ready' ? text.readyHint : PREPARING.has(stage) ? text.preparingHint : HANDOFF.has(stage) ? text.restartHint : stage === 'done' ? text.doneHint : ''
  }
  if (checking) { label = text.checking; tone = 'neutral' }
  if (checkError) { label = text.checkFailed; tone = 'error' }
  if (actionError) tone = 'error'
  if (statusError) { label = text.connectionLost; tone = 'error' }
  return {
    label, tone, hint, locked, failed,
    error: status?.error || actionError || '',
    pending: locked ? (status?.target_version || status?.check?.latest?.tag_name || '') : '',
    progress: Math.min(100, Math.max(0, Number(status?.progress) || 0)),
    canCheck: !busy && !checking && !locked,
    canPrepare: Boolean(info?.update_supported && check?.update && check.asset && check.checksum && !busy && !checking && !checkError && !statusError && !locked),
    canRestart: Boolean(status?.id && stage === 'ready' && status.running && !busy && !checking && !statusError),
    showPrepare: Boolean(check?.update && !locked),
    showRestart: stage === 'ready',
  }
}
