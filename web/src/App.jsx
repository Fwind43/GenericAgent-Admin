import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { Activity, Bot, Brain, BarChart3, CalendarClock, CheckCircle2, Code2, Copy, Eye, FileCode2, FolderCog, Globe2, GitPullRequest, MessageSquare, Play, RefreshCw, Save, Server, ShieldAlert, Power, SlidersHorizontal, Square, Target, Terminal, Trash2, UploadCloud, XCircle, Download, Moon, Sun } from 'lucide-react'
import { api } from './lib/api'
import { buildObservabilitySnapshot, observabilityRequest } from './lib/observability'
import { confirmDanger } from './lib/danger'
import { clampTailLines, dirnameForPath, fileEditorDirty } from './lib/filesSafety'
import { DEFAULT_SCHEDULE_TASK, buildScheduleCreateRequest, normalizeScheduleTasksPayload } from './lib/schedule'
import { modelValidationSummary, validateModelProfiles } from './lib/modelsValidation'
import { applyModelOrder, applyProviderOrder, mergePersistedModelOrder, orderedProviderProfiles } from './lib/modelsEditor'
import { NAV_ITEMS, TASK_SUB_TABS, parseRoute, buildRoute } from './lib/routing'
import {
  VERSION_RELOAD_DELAY_MS,
  VERSION_RELOAD_RETRY_MS,
  beginVersionRestartGrace,
  shouldReloadAfterVersionUpdate,
  shouldReportVersionPollError,
  versionMatchesExpectedRelease,
} from './lib/versionUpdatePolling'
import { emptyProfile, formatBytes, formatDuration, formatGoalTime, group, modelLabel, outputLineCount, safeJson } from './lib/format'
import { ChannelServiceTable, EntryList, ObservabilityCard, Panel, SecretInput, ServiceRow, Stat } from './components/common'
import { TurnList } from './components/turns'
import { TaskRow } from './components/schedule'
import { ErrorBoundary, RouteFallback, StatusNotice } from './components/feedback'
import { ProcessGuard } from './components/ProcessGuard'
import SetupWizard from './components/SetupWizard.jsx'
// 页面级代码分割：各 tab 页面按需懒加载，首屏只下载概览/日志所需代码。
const ChatPage = lazy(() => import('./pages/ChatPage').then(m => ({ default: m.ChatPage })))
const GoalsPage = lazy(() => import('./pages/GoalsPage').then(m => ({ default: m.GoalsPage })))
const UsagePage = lazy(() => import('./pages/UsagePage').then(m => ({ default: m.UsagePage })))
const Models = lazy(() => import('./pages/ModelsPage').then(m => ({ default: m.Models })))
const FilesPage = lazy(() => import('./pages/FilesPage').then(m => ({ default: m.FilesPage })))

gsap.registerPlugin(useGSAP)

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const I18N = {
  zh: {
    appName: 'GA Admin', tagline: 'GenericAgent 本地管理面板', root: 'GenericAgent 根目录', setupTitle: '首次配置 GenericAgent', setupDesc: '请选择已有 GA 根目录，或一键安装到新目录。', validateRoot: '验证并使用', installGA: '安装 GA', installPath: '安装目录', setupOk: 'GA 路径已配置', installDone: 'GA 已安装并配置', browse: '选择目录', checkEnv: '检查 Python / Git', envReady: '环境已就绪', envMissing: '环境缺失', save: '保存', refresh: '刷新', busy: '执行中', ready: '就绪', error: '错误', empty: '暂无', enabled: '启用', disabled: '停用', start: '启动', stop: '停止', running: '运行中', stopped: '已停止', language: '语言', copy: '复制', clear: '清空', delete: '删除', show: '显示', hide: '隐藏', search: '搜索', read: '读取', tail: '尾读', download: '下载', create: '创建', remove: '删除', backup: '写操作会自动备份', autostart: '开机自启', autostartService: '自启动', logs: '日志', enableAutostart: '开启自启', disableAutostart: '关闭自启', unsupported: '不支持', close: '关闭', cancel: '取消', retry: '重试', loading: '加载中…', mainNavigation: '主导航', switchToLight: '切换到浅色模式', switchToDark: '切换到深色模式',
    serviceDesc: { scheduler: '定时任务调度器：每 120 秒扫描 sche_tasks/ 中的任务，按 once/daily/weekly/every_Nh 等周期到期触发，并归档 L4 会话记录。', autonomous: '自主待机驱动：每 30 分钟检测一次，当用户离开超过 30 分钟，便提示智能体按自动化 SOP 自行推进任务。' },
    nav: { overview: '总览', chat: '对话', files: '文件', tasks: '任务', memory: '记忆', channels: '通道', autonomous: '自主进化', usage: '用量总览', schedule: '定时', goals: 'Goal 模式', models: '模型', settings: '配置', logs: '日志' },
    desc: { overview: '从 GA 的功能域理解并接管生命周期。', chat: '迁移自 reactapp 的 GA 原生对话、文件上传和流式聊天界面。', files: '安全浏览 GA 根目录内文本文件，支持 tail 与搜索。', tasks: '普通会话、任务文件、批处理入口、任务型服务与 sche_tasks 定时任务。', memory: '分层记忆、SOP 与工具能力索引。', channels: '桌面、TUI、Web、IM Bot 等前端入口。', autonomous: '反思、自主运行、Goal Mode 与团队 Worker。', schedule: 'sche_tasks JSON 定时任务详情、编辑、创建与删除。', goals: '复用 GA Goal Mode SOP 与 reflect/goal_mode.py 的持续目标控制台。', models: '按服务商读取、预览和保存 GA mykey.py 中的模型配置。', settings: '配置 GA 根目录、Python、聊天数据目录与 Chat Python 代理。', logs: '进程状态与输出日志。' },
    cards: { processes: '进程', running: '运行中', stopped: '已停止', memoryLayers: '记忆层', sopTools: 'SOP/工具', schedule: '定时任务', enabledTasks: '已启用', reports: '报告', coreFiles: '核心文件', reflect: '反思脚本', health: 'GA 健康', capabilities: '能力', risks: '风险', version: '版本管理' },
    overview: {
      observability: '只读观测', healthChecks: '健康检查', coreFiles: '核心文件', memorySops: '记忆 SOP', riskRules: '风险规则', healthy: '健康端点报告正常', needsAttention: '健康端点需要关注', awaitingSnapshot: '等待只读快照', generatedAt: '生成时间', missingCore: '核心文件缺失',
      updateAvailable: '有更新', current: '已是最新', commit: '提交', unknown: '未知', runtime: '运行时', executable: '程序', updateUnavailable: '一键升级不可用', platformUnsupported: '当前平台暂不支持', latestVersion: '最新版本', updateRunning: '升级中', updateFailed: '升级失败', updateStatus: '升级状态', updateQueued: '升级任务已启动', checkUpdate: '检查更新', oneClickUpdate: '一键升级', refreshProgress: '刷新进度',
      sourceTitle: 'GA 源代码更新', gitUpdate: 'Git 更新', checkFailed: '检查失败', upstreamMissing: '未配置上游', notChecked: '未检查', sourceDescription: '自动 fetch 后对比上游分支；更新只执行 git pull --ff-only。', branch: '分支', upstream: '上游', ahead: '领先', behind: '落后', dirty: '工作区有未提交修改', upstreamHelp: '当前分支没有 tracking 分支，请先在 GA 仓库中配置上游。', checkLatest: '检查是否最新', updateSource: '更新 GA 源代码',
      refreshing: '正在刷新运行状态…', refreshed: '运行状态已刷新', refreshFailed: error => `刷新失败：${error}`, sourceMissingMessage: '当前 GA 分支未配置上游，无法判断是否最新', sourceCurrentMessage: 'GA 源代码已是最新', sourceBehindMessage: count => `GA 源代码落后 ${count} 个提交`, sourceUpdatedMessage: (before, after) => `GA 源代码已更新：${before} → ${after}`, sourceCheckConfirm: '使用 git pull --ff-only 更新当前 GA 源代码？请确保本地修改已提交或可快进。', sourceStatusBehind: count => `落后 ${count} 个提交`,
      versionFound: version => `发现新版本 ${version}`, versionCurrent: '已是最新版本', versionUpdateConfirm: '下载并重启 GA Admin 以完成升级？页面可刷新，进度会自动恢复。', updateReconnectFailed: '升级后服务未能恢复，请手动刷新页面',
    },
    service: {
      model: '模型', defaultModel: '默认（启动时选择）', returnCode: '返回码', startedAt: '启动时间', workdir: '工作目录', command: '命令', log: '日志',
      invalidModel: '请选择有效的模型编号', chooseReflectModel: '选择反思模型', aboutToStart: name => `即将启动反思服务：${name}`, noModelsDefault: '未发现模型，使用默认 0',
      confirmAction: (action, name) => `${action === 'start' ? '启动' : '停止'}服务 ${name}？`, pending: (action, name) => `${action === 'start' ? '正在启动' : '正在停止'} ${name}`, success: (action, name) => `${name} 已${action === 'start' ? '启动' : '停止'}`, failed: (action, name, error) => `${name} ${action === 'start' ? '启动' : '停止'}失败：${error}`,
      autostartConfirm: (name, enabled) => `${enabled ? '启用' : '停用'}服务 ${name} 的自启动？`, modelUpdated: '反思模型已更新',
    },
    channels: {
      title: '通道与前端服务', summary: '集中管理 GA 的模型通道密钥和上层前端进程。Secret 不回显，留空会保留现有值。', services: '服务', running: '运行中', keyConfig: '密钥配置', configFile: '配置文件', loadingConfig: '正在读取配置…', noConfigPath: '未读取到配置路径', refreshing: '刷新中…',
      loadFailed: error => `读取通道配置失败：${error}`, saveConfirm: '写入通道配置会更新 GA mykey.py；Secret 留空将保留原值。确认继续？', saving: '正在写入 GA mykey.py…', saved: path => `已保存通道配置：${path}`, saveFailed: error => `保存失败：${error}`,
      testing: name => `正在测试 ${name} 凭据…`, testPassed: name => `${name}：测试通过`, testFailed: (name, error = '') => `${name}：测试失败${error ? ` · ${error}` : ''}`, testConnection: '测试连接', testingButton: '测试中…', savedField: '已保存', allowedUsersPlaceholder: 'user1,user2 或留空',
      profileNames: { feishu: '飞书 / Lark', lark: '飞书 / Lark', wecom: '企业微信', dingtalk: '钉钉' },
      profileDescriptions: { feishu: '机器人应用凭据、用户白名单与公开访问开关。', lark: '机器人应用凭据、用户白名单与公开访问开关。', wecom: '企业微信机器人/应用通道凭据与允许用户。', dingtalk: '钉钉机器人/应用通道 client 凭据与允许用户。' },
      fieldLabels: { fs_app_id: 'App ID', fs_app_secret: 'App Secret', fs_allowed_users: '允许用户', fs_public_access: '公开访问', wecom_bot_id: 'Bot ID / Agent ID', wecom_secret: 'Secret', wecom_allowed_users: '允许用户', dingtalk_client_id: 'Client ID', dingtalk_client_secret: 'Client Secret', dingtalk_allowed_users: '允许用户' },
    },
    tasks: { form: '表单编辑', json: 'JSON 编辑', formHelp: '表单编辑定时任务核心字段，修改实时同步到 JSON；保存/删除会生成 .bak 时间戳。', parseFailed: 'JSON 解析失败，回退到文本编辑', enabledLabel: 'enabled（是否启用定时任务）', maxDelay: 'max_delay_hours（最大延迟小时数）', repeat: 'repeat（执行频率：每日/每周/每N小时/手动/单次）', choose: '-- 选择 --', schedule: 'schedule（定时执行时间，如 06:00）', schedulePlaceholder: '如 06:00', prompt: 'prompt（定时任务的提示词内容）', promptPlaceholder: '定时任务的提示词内容', extraFields: '额外字段', unnamed: '未命名任务', unscheduled: '未排程', manual: '手动', explicitEnable: '需显式启用后才会运行', report: '报告' },
    files: { workflow: '文件工作流', chooseFile: '选择文件', readFile: '读取文件', editContent: '编辑内容', reviewTarget: '核对目标', saveOrDiscard: '保存或放弃', retryAction: '重试文件操作', readOnlyDownload: '只读：下载选中的文件，不会修改内容。', destructiveDelete: '破坏性操作：确认后删除选中的文件。', safetyNote: '读取、尾读、搜索和下载都是安全的只读操作。保存会把当前编辑器文本写入目标路径；删除是破坏性操作，只能在确认选中路径后使用。', folderEmpty: '文件夹为空或不可用', chooseRoot: '选择 GA 根目录以浏览文件', noMatches: '未找到匹配项', broaderSearch: '请检查所选路径，或尝试更宽泛的搜索词。', searchSelected: '运行搜索以查找所选路径中的匹配文本。', searchPrompt: '输入搜索文本，然后运行搜索。', noFilesPath: '此路径未返回文件。请确认 GA 根目录，或选择文件夹后重新读取。', noRootPath: '尚未选择 GA 根目录。请输入项目根目录或文件夹路径，然后点击读取。', dirty: '有未保存更改', clean: '已保存/干净', loaded: '已加载', targetChanged: '保存目标已更改', discard: '放弃更改', noFileLoaded: '尚未加载文件', noFileLoadedHelp: '请先从列表选择文件、尾读日志，或输入路径并读取后再编辑。', editorLabel: '文件内容编辑器', readFirst: '保存前请先读取文件，编辑器当前没有加载目标。', chooseSaveTarget: '保存前请选择目标路径。', noChanges: path => `${path} 没有未保存更改，因此无法保存。`, readyToSave: path => `可以将编辑器内容保存到 ${path}。`, chooseBeforeSave: '保存前请选择文件。', reviewRetargeted: (loaded, path) => `请核对目标：将从 ${loaded} 加载的编辑器内容保存到 ${path}。`, reviewDirty: path => `请核对目标：保存对 ${path} 的更改。`, reviewClean: path => `${path} 没有未保存更改。` },
    models: {
      protocols: { native_oai: ['Native OAI（推荐 / OpenAI 兼容）', '适合 OpenAI-compatible 接口，新配置优先使用。'], native_claude: ['Native Claude（Anthropic 兼容）', '适合 Anthropic-compatible 接口。'], oai: ['OAI / LLMSession（旧协议）', 'GenericAgent 旧版 OpenAI 文本协议。'], claude: ['ClaudeSession（旧协议）', 'GenericAgent 旧版 Claude 文本协议。'], openai: ['兼容旧值：openai', '旧配置兼容值。'], 'openai-compatible': ['兼容旧值：openai-compatible', '旧配置兼容值。'], chatgpt: ['兼容旧值：chatgpt', '旧配置兼容值。'] },
      errors: { varNameRequired: '必须填写变量名', varNameInvalid: '变量名须为 Python 标识符', varNameDiscoveryToken: '变量名须含 api / config / cookie，或使用官方命名', varNameDuplicate: '变量名重复', modelRequired: '至少选择一个模型', apiBaseRequired: '必须填写 API Base', apiBaseProtocol: 'API Base 须以 http:// 或 https:// 开头', maxRetriesInvalid: '重试次数须 ≥ 0', readTimeoutInvalid: '超时须 > 0', apiKeyEmpty: 'API Key 为空（仅适用于本地或无认证端点）' },
      blockItems: n => `${n} 个阻断项`, reminders: n => `${n} 个提醒`, valid: '配置有效', inherit: '使用默认值', defaultParams: '默认参数', unnamedModel: '未命名模型', collapse: '收起', configure: '配置', deleteModel: name => `删除模型 ${name}`, stream: '流式输出', maxRetries: '最大重试次数', readTimeout: '读取超时（秒）', connectTimeout: '连接超时（秒）', optional: '可选', apiMode: 'API 模式', thinkingType: '思考类型', reasoningEffort: '推理强度', fakeClaude: '模拟 Claude Code 系统提示',
      addModelsStep: '获取或添加模型', addModelsHelp: '先从服务商获取候选；也可以直接填写已知模型 ID。', fetchModels: '获取模型', modelId: '模型 ID', configuration: '配置', noModels: '还没有模型。手动输入模型 ID，或先从接口获取。', manualModel: '手动输入模型 ID', addModel: '添加模型', fetchingModels: '正在从服务商接口获取模型…', fetchFailed: '获取模型失败', discovered: n => `发现 ${n} 个未添加模型`, addAll: '全部添加', fetching: '正在获取模型', cannotFetch: '无法获取候选模型', noNewModels: '没有发现新的模型，可重试或直接填写模型 ID。', refetch: '重新获取', addModelAria: model => `添加模型 ${model}`,
      provider: n => `服务商 ${n}`, modelCount: n => `${n} 个模型`, baseMissing: '尚未填写 BaseURL', unsaved: '未保存', saved: '已保存', saveFailed: '保存失败', deleteProviderTitle: '删除此服务商', connectStep: '连接服务商', connectHelp: '确认名称、官方协议和 BaseURL；API Key 可保留已保存值。', name: '名称', protocol: '官方协议', nameExample: '例如 gpt55_medium', nameHelp: '用于区分服务商；内部协议前缀会自动维护。', tempShown: '临时显示', hiddenByDefault: '默认隐藏', keyPlaceholder: '保留掩码表示不覆盖已保存密钥', reread: '重新读取', saveStep: '检查并保存', fixBlocks: '先修复下方阻断项，再保存此服务商。', dirtyHelp: '当前修改尚未保存；确认提醒后保存。', savedHelp: '配置修改后，使用卡片右上角的保存按钮单独保存。', savingProvider: '正在保存此服务商', savingDescription: '请稍候，完成前不会重复提交。', savedMykey: '已保存到 mykey.py', savedDescription: '此服务商配置已保存，可继续配置其他服务商。', providerSaveFailed: '此服务商保存失败', unknownError: '未知错误', retrySave: '重试保存', cannotSave: '此服务商暂时不能保存', beforeSave: '保存前请留意',
      addProvider: '新增服务商', addProviderHelp: '一个服务商可同时管理多个模型，只需配置一次协议、BaseURL 和密钥。', closeAdd: '关闭新增面板', nameRequired: '请填写名称。', baseRequired: '请填写 BaseURL。', optionalKey: '可选', addProviderFooter: '添加后会立即保存到 mykey.py；后续修改仍需在卡片中点击“保存”。', addAndSave: '添加并保存', rereadConfig: '重新读取', modelOrder: '模型顺序', orderTitle: '调整模型顺序', orderAvailable: '调整已保存模型的全局顺序', orderUnavailable: '保存模型后才能调整顺序', configPreview: '配置预览', configSummary: '配置概况', providers: n => `${n} 个服务商`, models: n => `${n} 个模型`, configSource: '配置来源', pageHasErrors: '存在不能保存的服务商，请在目录中选择异常项并修复。', providerDirectory: '服务商目录', chooseProvider: '选择一项进行编辑', providerNav: '模型服务商', stateError: '存在阻断项', stateWarning: '存在提醒', stateReady: '配置正常', singleSaveHint: '单项保存，密钥不会出现在预览中', providerEditor: '服务商编辑器', loadingMykey: '正在读取 mykey.py…', noProviders: '还没有服务商', loadingHelp: '请稍候，配置加载后会显示在这里。', noProvidersHelp: '创建第一个服务商，将同源模型集中管理。',
      riskTitle: '模型路由与保存安全', riskReady: '风险目录已加载', riskUnavailable: '风险目录不可用', riskEmpty: '暂无目录条目', riskHelp: '获取模型是只读操作；新增、删除与每张卡片的“保存”才会更新 mykey.py。', missingGates: routes => `目录缺少已确认写入门禁：${routes}`, deleteConfirm: (name, count) => `删除“${name}”及其中 ${count} 个模型？\n\n此操作会立即保存到 mykey.py。`, orderMissing: '当前页面未提供顺序保存能力，请刷新后重试。', orderSaveFailed: '保存失败，当前排序草稿已保留，请检查页面提示后重试。', orderSaveFailedShort: '保存失败，当前排序草稿已保留。', discardOrder: '关闭会丢弃未保存的顺序调整', confirmSave: '确认并保存', orderInfo: '列表顺序就是 --llm-no 的取值', orderDescription: '编号从 0 开始。保存后，mykey.py 中展开的模型变量会按此顺序声明；页面中尚未保存的模型不会出现在这里。', savedOrder: '已保存模型的全局顺序', missingModelId: '未填写模型 ID', providerName: '服务商名称', unnamed: '未命名', moveUp: '上移', moveDown: '下移', previewTitle: 'mykey.py 配置预览', refreshPreview: '刷新预览', previewSecret: '预览不会读取或显示已保存的明文密钥。', generatingPreview: '正在生成预览…', previewNeedsProvider: '添加至少一个服务商后显示预览。',
    },
    lists: { serviceGroups: '服务域', coreFiles: '核心文件', reflect: 'Reflect / Autonomous', frontends: '前端 / 通道', memory: '记忆层级', sop: 'SOP 与工具', taskServices: '任务服务', frontendServices: '前端服务', reflectServices: '反思服务', reflectScripts: '反思脚本', scheduledTasks: '定时任务', recentReports: '最近报告', processes: '进程', generatedPreview: '生成预览', riskHints: '接管提示', autostart: '开机自启', capabilities: '能力地图', readiness: '运行前检查', fileList: '文件列表', filePreview: '文件预览', searchResults: '搜索结果', editor: '编辑器' },
    hints: { rootSaved: 'GA 根目录已保存', fileSaved: '文件已保存并备份旧文件', taskSaved: '任务已保存并备份旧文件', taskDeleted: '任务已删除并备份', taskToggled: '任务状态已更新', modelsSaved: 'mykey.py 已备份并保存', savedSecret: '已保存；输入新值可替换', secret: 'API Key / Token', noFrontend: '未发现前端服务', noReflect: '未发现 reflect 服务', noTasks: '暂无 sche_tasks/*.json', noLogs: '暂无日志', previewHelp: '点击“预览”查看配置；点击“保存”会先备份再更新 GA 的 mykey.py。', modelSource: '来源', secretHidden: '已隐藏真实密钥', addProfile: '新增 Profile', preview: '预览', writeMykey: '保存 mykey.py', filePath: '相对路径', searchText: '搜索文本', tailLines: '尾部行数', newTaskId: 'new_task', jsonHelp: 'JSON 需为对象；保存/删除会生成 .bak 时间戳。', autostartEnabled: '已开启：用户登录后自动启动 GA Admin。', autostartDisabled: '未开启：需要手动启动 GA Admin。', autostartUnsupported: '当前平台暂不支持自动注册。', autostartChanged: '开机自启状态已更新', goalObjectiveRequired: '目标不能为空', goalObjectiveTooLarge: '目标超过 16384 字节', goalBudgetInteger: '预算分钟必须是整数', goalBudgetPositive: '预算分钟必须大于 0', goalBudgetTooLarge: '预算分钟不能超过 43200', goalTurnsInteger: '最大轮次必须是整数', goalTurnsNonNegative: '最大轮次不能为负数', goalTurnsTooLarge: '最大轮次不能超过 10000', goalLLMInteger: 'LLM # 必须是整数', goalLLMNonNegative: 'LLM # 不能为负数', goalPythonHelp: 'Python 留空时自动选择：GA 根目录 .venv、venv、uv 缓存解释器、PATH python/python3；填写后按该路径启动并记录到 Goal 状态。', goalHiveHelp: 'Hive 模式会按 GA 官方逻辑启动 Goal Master、临时 BBS 与一个 worker；GA Admin 只做上层管理。', goalStarted: 'Goal 已启动', goalStopped: 'Goal 已停止', goalDeleted: 'Goal 已删除', goalDeleteConfirm: '确定删除 Goal {id}？会删除状态和日志文件；运行中的目标请先停止。', goalDeleteRunning: '运行中的 Goal 不能删除，请先停止。', goalStopConfirm: '确认停止 Goal {id}？将按可用控制级别停止。', goalStopExactConfirm: '确认停止 Admin Goal {id}？将仅终止该 Goal 记录的精确 PID {pid}。', goalStopSoftConfirm: '确认软停止外部 Goal {id}？不会杀进程，只写入状态文件 stopped_by_admin，让 Goal 循环自行退出。', goalOutputTruncated: '仅显示输出尾部，前面内容已截断', goalOutputCapped: '请求字节数超过后端上限，已按上限读取', goalOutputDefault: '未指定读取字节数，已使用默认值', goalOutputBytesInteger: '输出字节数必须是整数', goalOutputBytesNonNegative: '输出字节数不能为负数', goalOutputBytesTooLarge: '输出字节数不能超过 1048576', goalOutputCopied: '输出已复制', goalOutputCleared: '输出已清空', goalOutputLogMissing: '日志文件尚未创建，当前无可读取输出' },
    goalOutputStatus: { full: '完整', tail_truncated: '尾部截断', empty_log: '空日志', missing_log: '日志缺失', model_responses_full: 'model_responses 完整', model_responses_tail_truncated: 'model_responses 尾部截断', model_responses_empty_log: 'model_responses 空文件' },
    goalOrigins: { admin: 'Admin 启动', external: '外部自启' },
    goalStopLevels: { exact_pid: '精确 PID', soft_state: '状态软停止', unsupported: '不可停止', none: '不可停止' },
    goalTrust: { trusted: 'PID 可信', untrusted: 'PID 不可信' },
    fields: { varName: '变量名', type: '类型', name: '名称', model: '模型', apiBase: 'API 基址', apiKey: 'API Key', stream: '流式', maxRetries: '重试', readTimeout: '超时', reasoningEffort: '推理强度', editor: 'JSON 内容', objective: '目标', budgetMinutes: '预算分钟', maxTurns: '最大轮次', llmNo: 'LLM #（可选）', pythonPath: 'Python 解释器（可选）', pythonAuto: '留空自动选择', chatDataDir: '聊天数据目录（可选）', chatDataAuto: '留空使用 %APPDATA%\\GenericAgent-Admin', goalRuns: 'Goal 运行', outputTail: '输出尾部', maxBytes: '最大字节', outputPreset64k: '64K', outputPreset256k: '256K', outputPreset1m: '1M', outputDefault: '默认64K', outputShown: '已显示', outputLines: '行数', outputLimit: '读取上限', autoRefresh: '自动刷新', notRunning: '未运行', startGoalMode: '启动 Goal Mode', goalHive: 'Hive 模式', hiveBoard: 'Hive 看板', hiveWorker: 'Hive Worker', hiveCwd: 'Hive 工作目录', goalPlaceholder: '描述要让 GA Goal Mode 持续推进的目标', pid: 'PID', turn: '轮次', remaining: '剩余', elapsed: '已用', started: '开始', ended: '结束', updated: '更新', stateFile: '状态', logFile: '日志', logMissing: '日志未创建', logReady: '日志就绪', outputStatus: '输出状态', source: '来源', control: '控制', trust: '信任', rawStatus: '原始状态', lastEvent: '最近事件', errorClass: '错误类型' }
  },
  en: {
    appName: 'GA Admin', tagline: 'GenericAgent local management workspace', root: 'GenericAgent root', setupTitle: 'First-time GenericAgent setup', setupDesc: 'Select an existing GA root, or install GA into a new directory.', validateRoot: 'Validate & use', installGA: 'Install GA', installPath: 'Install path', setupOk: 'GA root configured', installDone: 'GA installed and configured', browse: 'Choose directory', checkEnv: 'Check Python / Git', envReady: 'Environment ready', envMissing: 'Environment missing', save: 'Save', refresh: 'Refresh', busy: 'Busy', ready: 'Ready', error: 'Error', empty: 'Empty', enabled: 'Enabled', disabled: 'Disabled', start: 'Start', stop: 'Stop', running: 'Running', stopped: 'Stopped', language: 'Language', copy: 'Copy', clear: 'Clear', delete: 'Delete', show: 'Show', hide: 'Hide', search: 'Search', read: 'Read', tail: 'Tail', download: 'Download', create: 'Create', remove: 'Delete', backup: 'writes create backups', autostart: 'Autostart', autostartService: 'Autostart', logs: 'Logs', enableAutostart: 'Enable autostart', disableAutostart: 'Disable autostart', unsupported: 'Unsupported', close: 'Close', cancel: 'Cancel', retry: 'Retry', loading: 'Loading…', mainNavigation: 'Main navigation', switchToLight: 'Switch to light theme', switchToDark: 'Switch to dark theme',
    serviceDesc: { scheduler: 'Scheduled-task runner: scans sche_tasks/ every 120s and fires tasks when their once/daily/weekly/every_Nh cadence is due, also archiving L4 session logs.', autonomous: 'Idle autonomy driver: checks every 30 min and, once the user has been away for over 30 min, prompts the agent to advance tasks on its own per the automation SOP.' },
    nav: { overview: 'Overview', chat: 'Chat', files: 'Files', tasks: 'Tasks', memory: 'Memory', channels: 'Channels', autonomous: 'Autonomous', usage: 'Usage', schedule: 'Schedule', goals: 'Hive Mode', models: 'Models', settings: 'Settings', logs: 'Logs' },
    desc: { overview: 'Understand and take over GA lifecycle by native domains.', chat: 'GA native conversation, uploads and streaming UI migrated from reactapp.', files: 'Safely browse text files inside GA root with tail and search.', tasks: 'Conversations, task files, batch entrypoints and task services.', memory: 'Layered memory, SOPs and utility indexes.', channels: 'Desktop, TUI, Web and IM Bot entrypoints.', autonomous: 'Reflection, autonomous runs, Goal Mode and team workers.', schedule: 'View, edit, create and delete sche_tasks JSON jobs.', goals: 'Continuous objective control console backed by GA Goal Mode SOP and reflect/goal_mode.py.', models: 'Import, preview and write GA mykey.py model config.', settings: 'Configure GA root, Python, chat data directory, and Chat Python proxy.', logs: 'Process state and output logs.' },
    cards: { processes: 'Processes', running: 'Running', stopped: 'Stopped', memoryLayers: 'Memory layers', sopTools: 'SOP/tools', schedule: 'Scheduled jobs', enabledTasks: 'Enabled', reports: 'Reports', coreFiles: 'Core files', reflect: 'Reflect scripts', health: 'GA health', capabilities: 'Capabilities', risks: 'Risks', version: 'Version management' },
    overview: {
      observability: 'Read-only observability', healthChecks: 'Health checks', coreFiles: 'Core files', memorySops: 'Memory SOPs', riskRules: 'Risk rules', healthy: 'Health endpoints are reporting normally', needsAttention: 'Health endpoints need attention', awaitingSnapshot: 'Waiting for a read-only snapshot', generatedAt: 'Generated', missingCore: 'Missing core files',
      updateAvailable: 'Update available', current: 'Up to date', commit: 'Commit', unknown: 'Unknown', runtime: 'Runtime', executable: 'Executable', updateUnavailable: 'One-click update unavailable', platformUnsupported: 'Not supported on this platform', latestVersion: 'Latest version', updateRunning: 'Updating', updateFailed: 'Update failed', updateStatus: 'Update status', updateQueued: 'Update task started', checkUpdate: 'Check for updates', oneClickUpdate: 'Update now', refreshProgress: 'Refresh progress',
      sourceTitle: 'GA source update', gitUpdate: 'Git update', checkFailed: 'Check failed', upstreamMissing: 'No upstream', notChecked: 'Not checked', sourceDescription: 'Fetches remotes before comparing the tracking branch; updates use git pull --ff-only.', branch: 'Branch', upstream: 'Upstream', ahead: 'Ahead', behind: 'Behind', dirty: 'The working tree has uncommitted changes', upstreamHelp: 'This branch has no tracking branch. Configure an upstream in the GA repository first.', checkLatest: 'Check source', updateSource: 'Update GA source',
      refreshing: 'Refreshing runtime status…', refreshed: 'Runtime status refreshed', refreshFailed: error => `Refresh failed: ${error}`, sourceMissingMessage: 'The current GA branch has no upstream, so its update status cannot be determined', sourceCurrentMessage: 'GA source is up to date', sourceBehindMessage: count => `GA source is behind by ${count} commit${count === 1 ? '' : 's'}`, sourceUpdatedMessage: (before, after) => `GA source updated: ${before} → ${after}`, sourceCheckConfirm: 'Update the current GA source with git pull --ff-only? Commit or preserve local changes first.', sourceStatusBehind: count => `Behind by ${count} commit${count === 1 ? '' : 's'}`,
      versionFound: version => `New version found: ${version}`, versionCurrent: 'GA Admin is up to date', versionUpdateConfirm: 'Download and restart GA Admin to finish the update? Progress is restored after refresh.', updateReconnectFailed: 'The updated service did not recover; refresh the page manually',
    },
    service: {
      model: 'Model', defaultModel: 'Default (choose at startup)', returnCode: 'Return code', startedAt: 'Started', workdir: 'Working directory', command: 'Command', log: 'Log',
      invalidModel: 'Choose a valid model number', chooseReflectModel: 'Choose reflection model', aboutToStart: name => `Reflection service to start: ${name}`, noModelsDefault: 'No models found; use default 0',
      confirmAction: (action, name) => `${action === 'start' ? 'Start' : 'Stop'} service ${name}?`, pending: (action, name) => `${action === 'start' ? 'Starting' : 'Stopping'} ${name}`, success: (action, name) => `${name} ${action === 'start' ? 'started' : 'stopped'}`, failed: (action, name, error) => `Failed to ${action} ${name}: ${error}`,
      autostartConfirm: (name, enabled) => `${enabled ? 'Enable' : 'Disable'} autostart for ${name}?`, modelUpdated: 'Reflection model updated',
    },
    channels: {
      title: 'Channels and frontend services', summary: 'Manage GA channel credentials and frontend processes in one place. Secrets are never echoed; leave them empty to preserve saved values.', services: 'Services', running: 'Running', keyConfig: 'Credentials', configFile: 'Configuration file', loadingConfig: 'Loading configuration…', noConfigPath: 'No configuration path available', refreshing: 'Refreshing…',
      loadFailed: error => `Failed to load channel configuration: ${error}`, saveConfirm: 'Writing channel configuration updates GA mykey.py. Empty secrets preserve their saved values. Continue?', saving: 'Writing GA mykey.py…', saved: path => `Channel configuration saved: ${path}`, saveFailed: error => `Save failed: ${error}`,
      testing: name => `Testing ${name} credentials…`, testPassed: name => `${name}: connection test passed`, testFailed: (name, error = '') => `${name}: connection test failed${error ? ` · ${error}` : ''}`, testConnection: 'Test connection', testingButton: 'Testing…', savedField: 'Saved', allowedUsersPlaceholder: 'user1,user2 or leave empty',
      profileNames: { feishu: 'Lark', lark: 'Lark', wecom: 'WeCom', dingtalk: 'DingTalk' },
      profileDescriptions: { feishu: 'Bot application credentials, user allowlist, and public-access control.', lark: 'Bot application credentials, user allowlist, and public-access control.', wecom: 'WeCom bot/application credentials and allowed users.', dingtalk: 'DingTalk bot/application client credentials and allowed users.' },
      fieldLabels: { fs_app_id: 'App ID', fs_app_secret: 'App Secret', fs_allowed_users: 'Allowed Users', fs_public_access: 'Public Access', wecom_bot_id: 'Bot ID / Agent ID', wecom_secret: 'Secret', wecom_allowed_users: 'Allowed Users', dingtalk_client_id: 'Client ID', dingtalk_client_secret: 'Client Secret', dingtalk_allowed_users: 'Allowed Users' },
    },
    tasks: { form: 'Form editor', json: 'JSON editor', formHelp: 'Edit the core scheduled-task fields in a form. Changes sync to JSON; save/delete creates a timestamped .bak.', parseFailed: 'JSON parsing failed; using the text editor', enabledLabel: 'enabled (run this scheduled task)', maxDelay: 'max_delay_hours (maximum delay in hours)', repeat: 'repeat (daily, weekly, every N hours, manual, or once)', choose: '-- Select --', schedule: 'schedule (execution time, for example 06:00)', schedulePlaceholder: 'For example 06:00', prompt: 'prompt (scheduled-task instructions)', promptPlaceholder: 'Scheduled-task instructions', extraFields: 'Additional fields', unnamed: 'Unnamed task', unscheduled: 'Not scheduled', manual: 'Manual', explicitEnable: 'Explicitly enable this task before it can run', report: 'Report' },
    files: { workflow: 'File workflow', chooseFile: 'Choose a file', readFile: 'Read it', editContent: 'Edit content', reviewTarget: 'Review target', saveOrDiscard: 'Save or discard', retryAction: 'Retry file action', readOnlyDownload: 'Read-only: downloads the selected file without changing it.', destructiveDelete: 'Destructive: removes the selected file after confirmation.', safetyNote: 'Read, tail, search, and download are safe read-only actions. Save writes the editor text to the selected path; delete is destructive and requires confirmation.', folderEmpty: 'Folder is empty or unavailable', chooseRoot: 'Choose a GA root to browse files', noMatches: 'No matches found', broaderSearch: 'Check the selected path or try a broader search term.', searchSelected: 'Run search to find matching text in the selected path.', searchPrompt: 'Enter search text, then run search.', noFilesPath: 'No files returned for this path. Confirm the GA root or choose a folder and read again.', noRootPath: 'No GA root selected yet. Paste the project root or a folder path, then click Read.', dirty: 'Unsaved changes', clean: 'Saved / clean', loaded: 'Loaded', targetChanged: 'Save target changed', discard: 'Discard changes', noFileLoaded: 'No file loaded', noFileLoadedHelp: 'Choose a file, tail a log, or enter a path and read it before editing.', editorLabel: 'File content editor', readFirst: 'Read a file before saving. The editor has no loaded target.', chooseSaveTarget: 'Choose a save target before saving.', noChanges: path => `Save is disabled because ${path} has no unsaved changes.`, readyToSave: path => `Ready to save editor content to ${path}.`, chooseBeforeSave: 'Choose a file before saving.', reviewRetargeted: (loaded, path) => `Review target: saving editor content loaded from ${loaded} to ${path}.`, reviewDirty: path => `Review target: saving changes to ${path}.`, reviewClean: path => `No unsaved changes for ${path}.` },
    models: {
      protocols: { native_oai: ['Native OAI (recommended / OpenAI compatible)', 'Best for OpenAI-compatible APIs and recommended for new configurations.'], native_claude: ['Native Claude (Anthropic compatible)', 'For Anthropic-compatible APIs.'], oai: ['OAI / LLMSession (legacy)', 'GenericAgent legacy OpenAI text protocol.'], claude: ['ClaudeSession (legacy)', 'GenericAgent legacy Claude text protocol.'], openai: ['Legacy value: openai', 'Compatibility value for an older configuration.'], 'openai-compatible': ['Legacy value: openai-compatible', 'Compatibility value for an older configuration.'], chatgpt: ['Legacy value: chatgpt', 'Compatibility value for an older configuration.'] },
      errors: { varNameRequired: 'Variable name is required', varNameInvalid: 'Variable name must be a valid Python identifier', varNameDiscoveryToken: 'Variable name must contain api, config, or cookie, or use an official name', varNameDuplicate: 'Variable name is duplicated', modelRequired: 'Select at least one model', apiBaseRequired: 'API Base is required', apiBaseProtocol: 'API Base must start with http:// or https://', maxRetriesInvalid: 'Retries must be 0 or greater', readTimeoutInvalid: 'Timeout must be greater than 0', apiKeyEmpty: 'API Key is empty (only suitable for local or unauthenticated endpoints)' },
      blockItems: n => `${n} blocking item${n === 1 ? '' : 's'}`, reminders: n => `${n} reminder${n === 1 ? '' : 's'}`, valid: 'Configuration valid', inherit: 'Use default', defaultParams: 'Default parameters', unnamedModel: 'Unnamed model', collapse: 'Collapse', configure: 'Configure', deleteModel: name => `Delete model ${name}`, stream: 'Streaming output', maxRetries: 'Maximum retries', readTimeout: 'Read timeout (seconds)', connectTimeout: 'Connection timeout (seconds)', optional: 'Optional', apiMode: 'API mode', thinkingType: 'Thinking type', reasoningEffort: 'Reasoning effort', fakeClaude: 'Emulate Claude Code system prompt',
      addModelsStep: 'Fetch or add models', addModelsHelp: 'Fetch candidates from the provider, or enter a known model ID directly.', fetchModels: 'Fetch models', modelId: 'Model ID', configuration: 'Configuration', noModels: 'No models yet. Enter a model ID or fetch models from the API.', manualModel: 'Enter model ID manually', addModel: 'Add model', fetchingModels: 'Fetching models from the provider API…', fetchFailed: 'Model fetch failed', discovered: n => `${n} unadded model${n === 1 ? '' : 's'} found`, addAll: 'Add all', fetching: 'Fetching models', cannotFetch: 'Unable to fetch candidate models', noNewModels: 'No new models found. Retry or enter a model ID directly.', refetch: 'Fetch again', addModelAria: model => `Add model ${model}`,
      provider: n => `Provider ${n}`, modelCount: n => `${n} model${n === 1 ? '' : 's'}`, baseMissing: 'BaseURL not configured', unsaved: 'Unsaved', saved: 'Saved', saveFailed: 'Save failed', deleteProviderTitle: 'Delete this provider', connectStep: 'Connect provider', connectHelp: 'Confirm the name, official protocol, and BaseURL. A saved API Key can be preserved.', name: 'Name', protocol: 'Official protocol', nameExample: 'For example gpt55_medium', nameHelp: 'Identifies the provider; the internal protocol prefix is maintained automatically.', tempShown: 'Temporarily visible', hiddenByDefault: 'Hidden by default', keyPlaceholder: 'Keep the masked value to preserve the saved key', reread: 'Read again', saveStep: 'Review and save', fixBlocks: 'Resolve the blocking items below before saving this provider.', dirtyHelp: 'These changes are not saved yet. Review the notices, then save.', savedHelp: 'After editing, use the Save button in the card header to save this provider.', savingProvider: 'Saving this provider', savingDescription: 'Please wait; duplicate submissions are disabled until this completes.', savedMykey: 'Saved to mykey.py', savedDescription: 'This provider is saved. You can continue configuring other providers.', providerSaveFailed: 'Provider save failed', unknownError: 'Unknown error', retrySave: 'Retry save', cannotSave: 'This provider cannot be saved yet', beforeSave: 'Review before saving',
      addProvider: 'Add provider', addProviderHelp: 'One provider can manage multiple models with one protocol, BaseURL, and key.', closeAdd: 'Close add-provider panel', nameRequired: 'Enter a name.', baseRequired: 'Enter a BaseURL.', optionalKey: 'Optional', addProviderFooter: 'The provider is written to mykey.py immediately. Later edits still require Save in its card.', addAndSave: 'Add and save', rereadConfig: 'Reload', modelOrder: 'Model order', orderTitle: 'Adjust model order', orderAvailable: 'Adjust the global order of saved models', orderUnavailable: 'Save models before adjusting their order', configPreview: 'Configuration preview', configSummary: 'Configuration summary', providers: n => `${n} provider${n === 1 ? '' : 's'}`, models: n => `${n} model${n === 1 ? '' : 's'}`, configSource: 'Configuration source', pageHasErrors: 'Some providers cannot be saved. Select each flagged item and resolve it.', providerDirectory: 'Provider directory', chooseProvider: 'Select an item to edit', providerNav: 'Model providers', stateError: 'Has blocking items', stateWarning: 'Has reminders', stateReady: 'Configuration ready', singleSaveHint: 'Save providers individually; keys never appear in previews', providerEditor: 'Provider editor', loadingMykey: 'Loading mykey.py…', noProviders: 'No providers yet', loadingHelp: 'Please wait; configuration will appear here after loading.', noProvidersHelp: 'Create the first provider to manage models from the same source together.',
      riskTitle: 'Model routing and save safety', riskReady: 'Risk catalog loaded', riskUnavailable: 'Risk catalog unavailable', riskEmpty: 'No catalog entries', riskHelp: 'Fetching models is read-only. Adding, deleting, and each card’s Save action update mykey.py.', missingGates: routes => `Confirmed write gates missing from catalog: ${routes}`, deleteConfirm: (name, count) => `Delete “${name}” and its ${count} model${count === 1 ? '' : 's'}?\n\nThis immediately writes mykey.py.`, orderMissing: 'Model-order saving is unavailable. Refresh and try again.', orderSaveFailed: 'Save failed. The current ordering draft is preserved; review the page notice and retry.', orderSaveFailedShort: 'Save failed. The current ordering draft is preserved.', discardOrder: 'Closing discards unsaved ordering changes', confirmSave: 'Confirm and save', orderInfo: 'List positions are the --llm-no values', orderDescription: 'Numbering starts at 0. Saving declares expanded model variables in this order in mykey.py; unsaved page models are not included.', savedOrder: 'Global order of saved models', missingModelId: 'Model ID not set', providerName: 'Provider name', unnamed: 'Unnamed', moveUp: 'Move up', moveDown: 'Move down', previewTitle: 'mykey.py configuration preview', refreshPreview: 'Refresh preview', previewSecret: 'The preview never reads or displays saved plaintext keys.', generatingPreview: 'Generating preview…', previewNeedsProvider: 'Add at least one provider to generate a preview.',
    },
    lists: { serviceGroups: 'Service domains', coreFiles: 'Core files', reflect: 'Reflect / Autonomous', frontends: 'Frontends / Channels', memory: 'Memory layers', sop: 'SOPs and tools', taskServices: 'Task services', frontendServices: 'Frontend services', reflectServices: 'Reflect services', reflectScripts: 'Reflect scripts', scheduledTasks: 'Scheduled jobs', recentReports: 'Recent reports', processes: 'Processes', generatedPreview: 'Generated preview', riskHints: 'Takeover hints', autostart: 'Autostart', capabilities: 'Capability map', readiness: 'Readiness', fileList: 'Files', filePreview: 'Preview', searchResults: 'Search results', editor: 'Editor' },
    hints: { rootSaved: 'GA root saved', fileSaved: 'File saved with backup', taskSaved: 'Task saved with backup', taskDeleted: 'Task deleted with backup', taskToggled: 'Task state updated', modelsSaved: 'mykey.py backed up and written', savedSecret: 'Saved; type a new value to replace', secret: 'API Key / Token', noFrontend: 'No frontend service found', noReflect: 'No reflect service found', noTasks: 'No sche_tasks/*.json', noLogs: 'No logs', previewHelp: 'Preview generated config; writing mykey.py backs up first.', modelSource: 'Source', secretHidden: 'Real secret hidden', addProfile: 'Add profile', preview: 'Preview', writeMykey: 'Write mykey.py', filePath: 'relative path', searchText: 'search text', tailLines: 'tail lines', newTaskId: 'new_task', jsonHelp: 'JSON must be an object; save/delete creates timestamped .bak.', autostartEnabled: 'Enabled: GA Admin starts automatically after user login.', autostartDisabled: 'Disabled: GA Admin must be started manually.', autostartUnsupported: 'Autostart registration is not supported on this platform.', autostartChanged: 'Autostart status updated', goalObjectiveRequired: 'Objective is required', goalObjectiveTooLarge: 'Objective exceeds 16384 bytes', goalBudgetInteger: 'Budget minutes must be an integer', goalBudgetPositive: 'Budget minutes must be positive', goalBudgetTooLarge: 'Budget minutes exceeds 43200', goalTurnsInteger: 'Max turns must be an integer', goalTurnsNonNegative: 'Max turns must be non-negative', goalTurnsTooLarge: 'Max turns cannot exceed 10000', goalLLMInteger: 'LLM # must be an integer', goalLLMNonNegative: 'LLM # cannot be negative', goalPythonHelp: 'Leave Python empty to auto-select GA root .venv, venv, uv cached interpreter, then PATH python/python3; a custom path is used for launch and recorded in Goal state.', goalHiveHelp: 'Hive mode starts the Goal Master, a temporary BBS, and one worker using the official GA flow; GA Admin only manages it from above.', goalStarted: 'Goal started', goalStopped: 'Goal stopped', goalDeleted: 'Goal deleted', goalDeleteConfirm: 'Delete Goal {id}? This removes state and log files; stop running goals first.', goalDeleteRunning: 'Running goals cannot be deleted; stop it first.', goalStopConfirm: 'Stop Goal {id}? GA Admin will use the available control level.', goalStopExactConfirm: 'Stop Admin Goal {id}? Only the exact PID {pid} recorded for this Goal will be terminated.', goalStopSoftConfirm: 'Soft-stop external Goal {id}? This will not kill the process; it only writes stopped_by_admin to the state file so the Goal loop can exit itself.', goalOutputTruncated: 'Showing tail only; earlier output was truncated', goalOutputCapped: 'Requested bytes exceeded backend limit; reading at the cap', goalOutputDefault: 'No byte limit specified; using default', goalOutputBytesInteger: 'Output bytes must be an integer', goalOutputBytesNonNegative: 'Output bytes cannot be negative', goalOutputBytesTooLarge: 'Output bytes cannot exceed 1048576', goalOutputCopied: 'Output copied', goalOutputCleared: 'Output cleared', goalOutputLogMissing: 'Log file has not been created yet; no output is available' },
    goalOutputStatus: { full: 'full', tail_truncated: 'tail truncated', empty_log: 'empty log', missing_log: 'missing log', model_responses_full: 'model_responses full', model_responses_tail_truncated: 'model_responses tail truncated', model_responses_empty_log: 'model_responses empty' },
    goalOrigins: { admin: 'Admin started', external: 'External/self-started' },
    goalStopLevels: { exact_pid: 'Exact PID', soft_state: 'State soft-stop', unsupported: 'Not stoppable', none: 'Not stoppable' },
    goalTrust: { trusted: 'PID trusted', untrusted: 'PID untrusted' },
    fields: { varName: 'Var name', type: 'Type', name: 'Name', model: 'Model', apiBase: 'API base URL', apiKey: 'API Key', stream: 'Stream', maxRetries: 'Retries', readTimeout: 'Timeout', reasoningEffort: 'Reasoning effort', editor: 'JSON content', objective: 'Objective', budgetMinutes: 'Budget minutes', maxTurns: 'Max turns', llmNo: 'LLM # (optional)', pythonPath: 'Python interpreter (optional)', pythonAuto: 'leave empty for auto', chatDataDir: 'Chat data directory (optional)', chatDataAuto: 'empty = %APPDATA%\\GenericAgent-Admin', goalRuns: 'Goal runs', goalHive: 'Hive mode', hiveBoard: 'Hive board', hiveWorker: 'Hive worker', hiveCwd: 'Hive cwd', outputTail: 'Output tail', maxBytes: 'Max bytes', outputPreset64k: '64K', outputPreset256k: '256K', outputPreset1m: '1M', outputDefault: 'Default 64K', outputShown: 'Shown', outputLines: 'Lines', outputLimit: 'Limit', autoRefresh: 'Auto refresh', notRunning: 'not running', startGoalMode: 'Start Goal Mode', goalPlaceholder: 'Describe the sustained objective for GA Goal Mode', pid: 'PID', turn: 'turn', remaining: 'remaining', elapsed: 'elapsed', started: 'started', ended: 'ended', updated: 'updated', stateFile: 'state', logFile: 'log', logMissing: 'log not created', logReady: 'log ready', outputStatus: 'output status', source: 'source', control: 'control', trust: 'trust', rawStatus: 'raw status', lastEvent: 'last event', errorClass: 'error class' }
  }
}

const TaskFormEditor = ({ value, onChange, t }) => {
  const text = t.tasks
  let data
  try { data = JSON.parse(value) } catch {}
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return <textarea className="json-editor compact-editor" value={value} placeholder={text.parseFailed} onChange={e=>onChange(e.target.value)}/>
  }
  const updateField = (key, val) => {
    const next = { ...data, [key]: val }
    onChange(JSON.stringify(next, null, 2))
  }
  const extraKeys = Object.keys(data).filter(k => !['enabled','max_delay_hours','repeat','schedule','prompt'].includes(k))
  const repeatOptions = ['manual','daily','weekly','every_2h','every_4h','every_6h','every_8h','every_12h','once']

  return <div className="schedule-form-editor">
    <div className="form-field">
      <label>{text.enabledLabel}</label>
      <label className="toggle-switch">
        <input type="checkbox" checked={!!data.enabled} onChange={e => updateField('enabled', e.target.checked)} />
        <span className="toggle-slider"></span>
        <span className="toggle-label">{data.enabled ? t.enabled : t.disabled}</span>
      </label>
    </div>
    <div className="form-field">
      <label>{text.maxDelay}</label>
      <input type="number" value={data.max_delay_hours ?? ''} onChange={e => updateField('max_delay_hours', e.target.value ? parseInt(e.target.value, 10) : 0)} />
    </div>
    <div className="form-field">
      <label>{text.repeat}</label>
      <select value={data.repeat || ''} onChange={e => updateField('repeat', e.target.value)}>
        <option value="">{text.choose}</option>
        {repeatOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
    <div className="form-field">
      <label>{text.schedule}</label>
      <input type="text" value={data.schedule || ''} onChange={e => updateField('schedule', e.target.value)} placeholder={text.schedulePlaceholder}/>
    </div>
    <div className="form-field">
      <label>{text.prompt}</label>
      <textarea value={data.prompt || ''} onChange={e => updateField('prompt', e.target.value)} placeholder={text.promptPlaceholder}/>
    </div>
    {extraKeys.length > 0 && <details className="extra-fields">
      <summary>{text.extraFields} ({extraKeys.length})</summary>
      <pre>{JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k]) => !['enabled','max_delay_hours','repeat','schedule','prompt'].includes(k))), null, 2)}</pre>
    </details>}
  </div>
}

const OverviewPage = ({
  t, services, schedule, observability, observabilityError, refreshObservability,
  versionInfo, versionCheck, versionStatus, versionBusy, checkVersion, updateVersion,
  refreshVersionStatus, setMsg, gitStatus, gitResult, gitBusy, busy, checkGASource,
  updateGASource, autostart, toggleAutostart, root,
}) => {
  const text = t.overview
  const versionMessage = versionStatus?.error || (versionStatus?.stage === 'queued'
    ? text.updateQueued
    : (versionStatus?.message || versionStatus?.stage))
  const sourceStatus = gitStatus?.error
    ? text.checkFailed
    : (gitStatus
        ? (gitStatus.upstream_configured === false
            ? text.upstreamMissing
            : (gitStatus.latest ? text.current : text.sourceStatusBehind(gitStatus.behind || 0)))
        : text.notChecked)

  return <section className="overview-page">
    <div className="stats overview-stats">
      <Stat label={t.cards.processes} value={services.length} icon={<Server/>}/>
      <Stat label={t.cards.running} value={services.filter(service => service.running).length} icon={<Activity/>}/>
      <Stat label={t.cards.schedule} value={schedule.task_count || 0} icon={<CalendarClock/>}/>
      <Stat label={t.cards.enabledTasks} value={schedule.enabled || 0} icon={<CheckCircle2/>}/>
    </div>

    <ObservabilityCard
      snapshot={observability}
      error={observabilityError}
      onRefresh={refreshObservability}
      labels={{ ...text, refresh: t.refresh }}
    />

    <div className="overview-operations">
      <Panel title={t.cards.version} className="overview-panel overview-panel-updates">
        <div className="version-card">
          <div className="autostart-head">
            <Download size={18}/>
            <strong>GA Admin {versionInfo?.version || 'dev'}</strong>
            <span className={versionCheck?.update ? 'err' : 'ok'}>
              {versionCheck ? (versionCheck.update ? text.updateAvailable : text.current) : (versionInfo?.goos ? `${versionInfo.goos}/${versionInfo.goarch}` : t.empty)}
            </span>
          </div>
          <p className="muted">{text.commit} {versionInfo?.commit || text.unknown} · {versionInfo?.date || text.unknown}</p>
          <p className="muted">{text.runtime} {versionInfo?.runtime || '-'} · {text.executable} {versionInfo?.exe || '-'}</p>
          {versionInfo && !versionInfo.update_supported && <p className="warn">{text.updateUnavailable}: {versionInfo.update_unsupported_reason || text.platformUnsupported}</p>}
          {versionCheck?.latest && <p>{text.latestVersion}: <a href={versionCheck.latest.html_url} target="_blank" rel="noreferrer">{versionCheck.latest.tag_name}</a></p>}
          {versionCheck?.asset && <code>{versionCheck.asset.name}</code>}
          {versionStatus?.stage && <div className="update-progress">
            <div className="update-progress-head">
              <span>{versionStatus.running ? text.updateRunning : (versionStatus.error ? text.updateFailed : text.updateStatus)}</span>
              <b>{versionStatus.progress || 0}%</b>
            </div>
            <div className="progress-bar"><span style={{width:`${Math.max(0, Math.min(100, versionStatus.progress || 0))}%`}}/></div>
            <p className={versionStatus.error ? 'err' : 'muted'}>{versionMessage}</p>
            <code>{versionStatus.stage}</code>
          </div>}
          <div className="actions">
            <button onClick={checkVersion} disabled={versionBusy || versionStatus?.running}>{versionBusy ? t.busy : text.checkUpdate}</button>
            <button onClick={updateVersion} disabled={versionBusy || versionStatus?.running || !versionCheck?.update}>{versionStatus?.running ? `${text.updateRunning}…` : text.oneClickUpdate}</button>
            <button className="secondary" onClick={() => refreshVersionStatus().catch(error => setMsg(error.message))}>{text.refreshProgress}</button>
          </div>
        </div>
      </Panel>

      <Panel title={text.sourceTitle} className="overview-panel overview-panel-source">
        <div className="version-card">
          <div className="version-head">
            <GitPullRequest size={18}/>
            <strong>{text.gitUpdate}</strong>
            <span className={gitStatus?.error ? 'err' : (gitStatus?.latest ? 'ok' : 'warn')}>{sourceStatus}</span>
          </div>
          <p className="muted">{text.sourceDescription}</p>
          {gitStatus?.root && <code>{gitStatus.root}</code>}
          <p>{text.branch}: {gitStatus?.branch || '-'}　HEAD: {gitStatus?.commit || gitResult?.after || '-'}</p>
          {gitStatus?.upstream && <p>{text.upstream}: {gitStatus.upstream}　{text.ahead} {gitStatus.ahead || 0} / {text.behind} {gitStatus.behind || 0}</p>}
          {gitStatus?.upstream_configured === false && <p className="warn">{text.upstreamHelp}</p>}
          {gitStatus?.dirty && <p className="warn">{text.dirty}</p>}
          {gitStatus?.error && <p className="err">{gitStatus.error}</p>}
          {gitStatus?.fetch_error && <pre className="mini-log">{gitStatus.fetch_error}</pre>}
          {gitResult?.pull && <pre className="mini-log">{gitResult.pull}</pre>}
          <div className="actions">
            <button className="secondary" onClick={checkGASource} disabled={gitBusy || busy}>{gitBusy ? t.busy : text.checkLatest}</button>
            <button onClick={updateGASource} disabled={gitBusy || busy || gitStatus?.latest || gitStatus?.upstream_configured === false}>{gitBusy ? t.busy : text.updateSource}</button>
          </div>
        </div>
      </Panel>

      <Panel title={t.lists.autostart} className="overview-panel overview-panel-autostart">
        <div className="autostart-card">
          <div className="autostart-head"><Power size={18}/><strong>{t.autostart}</strong><span className={autostart?.enabled ? 'ok' : 'muted'}>{autostart?.supported ? (autostart?.enabled ? t.enabled : t.disabled) : t.unsupported}</span></div>
          <p>{!autostart?.supported ? t.hints.autostartUnsupported : (autostart?.enabled ? t.hints.autostartEnabled : t.hints.autostartDisabled)}</p>
          {autostart?.path && <code>{autostart.path}</code>}
          <button onClick={toggleAutostart} disabled={busy || !autostart?.supported}>{autostart?.enabled ? t.disableAutostart : t.enableAutostart}</button>
        </div>
      </Panel>

      <Panel title={t.lists.riskHints} className="overview-panel overview-panel-risk">
        <ul className="risk"><li>{t.root}: {root}</li><li>sche_tasks JSON: {t.backup}</li><li>mykey.py: {t.backup}</li></ul>
      </Panel>
    </div>
  </section>
}

export default function App() {
  const defaultLang = 'zh'
  const [lang, setLang] = useState(() => localStorage.getItem('ga-admin-lang-explicit') === '1' ? (localStorage.getItem('ga-admin-lang') || defaultLang) : defaultLang)
  const chooseLang = (nextLang) => {
    localStorage.setItem('ga-admin-lang-explicit', '1')
    localStorage.setItem('ga-admin-lang', nextLang)
    setNotice(null)
    setLang(nextLang)
    window.dispatchEvent(new CustomEvent('ga-admin-language-change', { detail: nextLang }))
  }
  const [theme, setTheme] = useState(() => localStorage.getItem('ga-admin-theme') || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('ga-admin-theme', theme) }, [theme])
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en' }, [lang])
  const t = I18N[lang] || I18N.en
  const settingsText = lang === 'zh' ? {
    title: '运行环境', summary: '集中管理 GA Admin 的本地路径与 Chat Python 网络环境。', configured: '配置已载入', unsavedHint: '修改后统一保存，写入前仍会二次确认。',
    paths: '基础路径', pathsDesc: '确定 GenericAgent 与 Chat 运行时从哪里读取程序和会话数据。', rootHelp: 'GenericAgent 项目根目录，保存后会重新载入工作区。', pythonHelp: '留空时自动检测；仅在需要固定解释器时填写。', dataHelp: '留空时使用默认目录；可指定独立的 Chat 会话存储位置。',
    network: '网络代理', networkDesc: '仅影响 Chat Python 子进程，不会更改系统全局代理。', proxyMode: '代理模式', proxyOff: '关闭', proxySystem: '跟随系统', proxyCustom: '自定义', proxyOffHelp: 'Chat Python 直接连接网络。', proxySystemHelp: '继承当前系统与进程环境中的代理配置。', proxyCustomHelp: '使用下方环境变量启动 Chat Python。',
    saveAll: '保存全部配置'
  } : {
    title: 'Runtime environment', summary: 'Manage local paths and the Chat Python network environment in one place.', configured: 'Configuration loaded', unsavedHint: 'Save all changes together. A confirmation is still required before writing.',
    paths: 'Base paths', pathsDesc: 'Define where GenericAgent and Chat load programs and conversation data.', rootHelp: 'GenericAgent project root. The workspace reloads after saving.', pythonHelp: 'Leave blank for automatic detection; set only when pinning an interpreter.', dataHelp: 'Leave blank for the default location, or use a dedicated Chat data directory.',
    network: 'Network proxy', networkDesc: 'Applies only to Chat Python subprocesses and does not change the system-wide proxy.', proxyMode: 'Proxy mode', proxyOff: 'Off', proxySystem: 'Use system', proxyCustom: 'Custom', proxyOffHelp: 'Chat Python connects directly.', proxySystemHelp: 'Inherit proxy settings from the current system and process environment.', proxyCustomHelp: 'Launch Chat Python with the environment variables below.',
    saveAll: 'Save all settings'
  }
  const initialRoute = useMemo(() => parseRoute(), [])
  const [tab, setTab] = useState(initialRoute.tab)
  const [cfg, setCfg] = useState(null), [health, setHealth] = useState(null), [services, setServices] = useState([]), [logs, setLogs] = useState([])
  const [root, setRoot] = useState(''), [installRoot, setInstallRoot] = useState(''), [busy, setBusy] = useState(false), [booting, setBooting] = useState(true), [notice, setNotice] = useState(null), [selected, setSelected] = useState('')
  const msg = notice?.message || ''
  const setMsg = (message, kind) => {
    const value = String(message || '')
    const inferredKind = /(?:失败|错误|无效|error|failed|invalid)/i.test(value) ? 'error' : (/^(?:正在|加载|保存中|启动中)/.test(value) ? 'pending' : 'success')
    setNotice(value ? { message: value, kind: kind || inferredKind } : null)
  }
  const [logStreamState, setLogStreamState] = useState('idle'), [logStreamNonce, setLogStreamNonce] = useState(0), [followLogs, setFollowLogs] = useState(true)
  const [serviceActionStates, setServiceActionStates] = useState({})
  const logViewRef = useRef(null)
  const [setupEnv, setSetupEnv] = useState(null)
  const [autostart, setAutostart] = useState(null)
  const [versionInfo, setVersionInfo] = useState(null), [versionCheck, setVersionCheck] = useState(null), [versionStatus, setVersionStatus] = useState(null), [versionBusy, setVersionBusy] = useState(false), [gitBusy, setGitBusy] = useState(false), [gitResult, setGitResult] = useState(null), [gitStatus, setGitStatus] = useState(null)
  const [tmwdStatus, setTmwdStatus] = useState(null)
  const [observability, setObservability] = useState(null), [observabilityError, setObservabilityError] = useState('')
  const [profiles, setProfiles] = useState([]), [modelPreview, setModelPreview] = useState('')
  const [persistedModelProfiles, setPersistedModelProfiles] = useState([])
  const [modelSaveStatus, setModelSaveStatus] = useState({})
  const [modelImportLoading, setModelImportLoading] = useState(false)
  const [modelRevealedKeys, setModelRevealedKeys] = useState({}), [modelKeyBusy, setModelKeyBusy] = useState({})
  const [filePath, setFilePath] = useState('memory'), [loadedFilePath, setLoadedFilePath] = useState(''), [fileList, setFileList] = useState([]), [fileContent, setFileContent] = useState(''), [loadedFileContent, setLoadedFileContent] = useState(''), [fileSearch, setFileSearch] = useState(''), [searchHits, setSearchHits] = useState([]), [tailLines, setTailLinesRaw] = useState(200)
  const [fileStatus, setFileStatus] = useState({})
  const [taskId, setTaskId] = useState(''), [taskEditor, setTaskEditor] = useState('{}'), [newTaskId, setNewTaskId] = useState('new_task')
  const [editorMode, setEditorMode] = useState('form')
  const [scheduleData, setScheduleData] = useState(null), [scheduleLoading, setScheduleLoading] = useState(false), [scheduleError, setScheduleError] = useState('')
  const [taskSubTab, setTaskSubTab] = useState(initialRoute.taskSubTab)
  const [scheduleArtifactTitle, setScheduleArtifactTitle] = useState(''), [scheduleArtifact, setScheduleArtifact] = useState('')
  const [goals, setGoals] = useState([]), [goalObjective, setGoalObjective] = useState(''), [goalBudget, setGoalBudget] = useState(480), [goalMaxTurns, setGoalMaxTurns] = useState(200), [goalLLMNo, setGoalLLMNo] = useState(''), [goalHive, setGoalHive] = useState(false), [selectedGoal, setSelectedGoal] = useState(''), [goalOutput, setGoalOutput] = useState(''), [goalOutputMeta, setGoalOutputMeta] = useState(null)
  const [goalOutputBytes, setGoalOutputBytes] = useState(() => localStorage.getItem('ga-admin-goal-output-bytes') || '120000')
  const [goalAutoRefresh, setGoalAutoRefresh] = useState(() => localStorage.getItem('ga-admin-goal-auto-refresh') !== 'false')
  const goalOutputSeq = useRef(0), goalRefreshBusy = useRef(false)
  const modelImportAttempted = useRef(false)
  const versionRestartGraceUntil = useRef(0)
  const versionUpdateNeedsReload = useRef(false)
  const [llms, setLLMs] = useState([]), [reflectLLMNo, setReflectLLMNo] = useState(''), [showLLMPicker, setShowLLMPicker] = useState(false), [pendingServiceName, setPendingServiceName] = useState('')
  const appScope = useRef(null)

  useGSAP(() => {
    if (tab === 'chat' || prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(appScope)
      let tl
      const play = () => {
        tl = gsap.timeline({ defaults: { ease: 'power2.out', duration: 0.28 } })
        tl.from(q('.main > header'), { y: 8, autoAlpha: 0, clearProps: 'transform,opacity,visibility' })
          .from(q('.stats .stat, .panel, .workspace, .logs-layout, .goals-page, .settings-page'), { y: 10, autoAlpha: 0, stagger: 0.025, clearProps: 'transform,opacity,visibility' }, '-=0.12')
      }
      const raf = window.requestAnimationFrame(play)
      const guard = window.setTimeout(() => {
        gsap.set(q('.main > header, .stats .stat, .panel, .workspace, .logs-layout, .goals-page, .settings-page'), { autoAlpha: 1, clearProps: 'transform,opacity,visibility' })
      }, 900)
      return () => { window.cancelAnimationFrame(raf); window.clearTimeout(guard); tl?.kill() }
    }, appScope)
    return () => ctx.revert()
  }, { scope: appScope, dependencies: [tab, lang] })

  const inv = health?.inventory || {}
  const schedule = scheduleData || inv.schedule || {}
  const tasks = normalizeScheduleTasksPayload(schedule).tasks
  const taskSvcs = useMemo(() => group(services, s => s.kind === 'task' || s.name?.includes('task') || s.name?.includes('scheduler')), [services])
  const frontendSvcs = useMemo(() => group(services, s => s.kind === 'frontend'), [services])
  const reflectSvcs = useMemo(() => group(services, s => s.name?.includes('scheduler') || s.name?.includes('autonomous')), [services])

  const loadScheduleTasks = async ({ quiet = false } = {}) => {
    if (!quiet) setScheduleLoading(true)
    setScheduleError('')
    try {
      const d = await api('/api/schedule/tasks')
      const normalized = normalizeScheduleTasksPayload(d)
      setScheduleData(normalized)
      return normalized
    } catch (e) {
      setScheduleData({ enabled: false, version: 'unknown', tasks: [] })
      setScheduleError(e.message)
      if (!quiet) setMsg(e.message)
      throw e
    } finally {
      if (!quiet) setScheduleLoading(false)
    }
  }

  const loadLLMs = async () => { try { const d = await api('/api/chat/state'); setLLMs(d.llms || []) } catch(e){ console.error('加载模型列表失败:', e) } }
  const refreshTMWebDriverStatus = async () => {
    const d = await api('/api/tmwebdriver/status')
    setTmwdStatus(d)
    return d
  }
  const repairTMWebDriver = async () => {
    if (!confirmDanger('tmwebdriver-repair', lang === 'zh' ? '启动或修复 TMWebDriver master 进程？' : 'Start or repair the TMWebDriver master process?')) return
    setBusy(true); setMsg('正在启动 TMWebDriver master…')
    try {
      const d = await api('/api/tmwebdriver/repair', { dangerous:true, method:'POST', body: '{}' })
      setTmwdStatus(d.status)
      setMsg(d.message || (d.started ? `已启动 TMWebDriver master PID ${d.pid}` : 'TMWebDriver master 已在运行'))
    } catch(e){ setMsg(`TMWebDriver 修复失败：${e.message}`) } finally{ setBusy(false) }
  }

  const readObservability = async () => {
    const request = (endpoint) => {
      const req = observabilityRequest(endpoint)
      return api(req.url, req.options)
    }
    const [apiHealth, inventory, risks] = await Promise.all([
      request('/api/health'),
      request('/api/ga/inventory'),
      request('/api/risk/catalog')
    ])
    const snapshot = buildObservabilitySnapshot({ health: apiHealth, inventory, risks })
    setObservability(snapshot)
    setObservabilityError('')
    return snapshot
  }

  const load = async () => {
    setBooting(true)
    setNotice({ kind: 'pending', message: t.overview.refreshing })
    try {
      const [c, h, auto, ver, vstat] = await Promise.all([
        api('/api/config'),
        api('/api/ga/health'),
        api('/api/autostart/status').catch(e => ({ supported:false, enabled:false, error:e.message })),
        api('/api/version/info').catch(e => ({ error:e.message })),
        api('/api/version/status').catch(() => null)
      ])
      setCfg(c); setRoot(c.ga_root || ''); setHealth(h); setAutostart(auto); setVersionInfo(ver); if (vstat?.id || vstat?.stage) setVersionStatus(vstat)
      await readObservability().catch(e => { setObservability(null); setObservabilityError(e.message) })
      if (!h?.ok) {
        setServices([]); setLogs([]); setFileList([])
        return
      }
      const svc = await api('/api/services')
      const serviceList = Array.isArray(svc) ? svc : (svc.services || [])
      setServices(serviceList)
      if (selected && !serviceList.some(service => service.name === selected)) setSelected('')
      if (tab === 'goals') {
        const goalData = await api('/api/goals/list').catch(() => ({ goals: [] }))
        const goalItems = goalData.goals || []
        setGoals(goalItems)
        const firstGoal = pickGoalId(goalItems, selectedGoal)
        if (!selectedGoal && firstGoal) setSelectedGoal(firstGoal)
      }
      if (tab === 'files') loadFiles(filePath).catch(e => setMsg(e.message))
      if (tab === 'tasks') loadScheduleTasks({ quiet:true }).catch(e => setScheduleError(e.message))
      if (tab === 'setup') refreshTMWebDriverStatus().catch(e => setTmwdStatus({ ok:false, error:e.message }))
      setNotice({ kind: 'success', message: t.overview.refreshed })
    } catch (e) {
      setNotice({ kind: 'error', message: t.overview.refreshFailed(e.message) })
    } finally { setBooting(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (tab === 'goals' && health?.ok) { loadGoals().catch(e => setMsg(e.message)); loadLLMs() }
    if (tab === 'autonomous' && health?.ok && !llms.length) loadLLMs()
    if (tab === 'files' && health?.ok && !fileList.length) loadFiles(filePath).catch(e => setMsg(e.message))
    if (tab === 'setup' && health?.ok && !tmwdStatus) refreshTMWebDriverStatus().catch(e => setTmwdStatus({ ok:false, error:e.message }))
  }, [tab, health?.ok])
  const toggleAutostart = async () => { const next = !autostart?.enabled; if (!confirmDanger('admin-autostart', lang === 'zh' ? (next ? '启用 GA Admin 开机自启动？' : '禁用 GA Admin 开机自启动？') : (next ? 'Enable GA Admin at login?' : 'Disable GA Admin at login?'))) return; setBusy(true); setMsg(''); try { const d = await api(next ? '/api/autostart/enable' : '/api/autostart/disable', { dangerous:true, method:'POST' }); setAutostart(d); setMsg(t.hints.autostartChanged) } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const checkGASource = async () => { setGitBusy(true); setMsg(''); try { const d = await api('/api/ga/git-status?remote=1'); setGitStatus(d); setMsg(d.upstream_configured === false ? t.overview.sourceMissingMessage : (d.latest ? t.overview.sourceCurrentMessage : t.overview.sourceBehindMessage(d.behind || 0))) } catch(e){ setGitStatus({ ok:false, error:e.message }); setMsg(e.message) } finally{ setGitBusy(false) } }
  const updateGASource = async () => { if (!confirmDanger('ga-git-update', t.overview.sourceCheckConfirm)) return; setGitBusy(true); setMsg(''); try { const d = await api('/api/ga/git-update', { dangerous:true, method:'POST', body: '{}' }); setGitResult(d); setMsg(d.changed ? t.overview.sourceUpdatedMessage(d.before, d.after) : t.overview.sourceCurrentMessage); setGitStatus(await api('/api/ga/git-status')); await load() } catch(e){ setMsg(e.message) } finally{ setGitBusy(false) } }
  const saveConfig = async () => { if (!confirmDanger('config-save', lang === 'zh' ? '保存 GA Admin 配置？会写入配置文件并可能切换 GA 根目录。' : 'Save the GA Admin configuration? This writes the configuration file and may switch the GA root.')) return; setBusy(true); try { const c = await api('/api/config', { dangerous:true, method: 'PUT', body: JSON.stringify({ ...cfg, ga_root: root }) }); setCfg(c); setMsg(t.hints.rootSaved); await load() } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const checkSetupEnv = async () => { setBusy(true); try { const d = await api('/api/setup/env'); setSetupEnv(d); setMsg(d.ok ? t.envReady : t.envMissing) } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const browseSetupDir = async (target = 'root') => { setBusy(true); try { const base = target === 'install' ? installRoot : root; const d = await api('/api/setup/browse', { method:'POST', body: JSON.stringify({ path: base }) }); if (d.path) { target === 'install' ? setInstallRoot(d.path) : setRoot(d.path) } } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const validateSetupRoot = async () => { if (!confirmDanger('setup-validate-root', lang === 'zh' ? '验证并保存当前 GA 根目录？' : 'Validate and save the current GA root?')) return; setBusy(true); try { const d = await api('/api/setup/validate', { dangerous:true, method:'POST', body: JSON.stringify({ path: root }) }); if (!d.ok) throw new Error('GenericAgent health check failed'); const c = await api('/api/config', { dangerous:true, method:'PUT', body: JSON.stringify({ ...cfg, ga_root: d.root }) }); setCfg(c); setRoot(d.root); setMsg(t.setupOk); await load() } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const installGA = async () => { if (!confirmDanger('setup-install-ga', lang === 'zh' ? '安装/克隆 GenericAgent 到目标目录？会写入本地文件。' : 'Install or clone GenericAgent into the target directory? This writes local files.')) return; setBusy(true); try { const env = setupEnv || await api('/api/setup/env'); setSetupEnv(env); if (!env.ok) throw new Error(t.envMissing); const d = await api('/api/setup/install', { dangerous:true, method:'POST', body: JSON.stringify({ path: installRoot || root }) }); setRoot(d.root); setMsg(t.installDone); await load() } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const startReflectService = (name) => {
    const fallbackModel = llms.find(m => m?.index !== undefined && m?.index !== null)
    setReflectLLMNo(current => current !== '' ? current : (fallbackModel?.index?.toString() || '0'))
    setPendingServiceName(name)
    setShowLLMPicker(true)
  }
  const confirmReflectStart = async () => {
    const selectedLLMNo = String(reflectLLMNo || '').trim()
    if (!/^\d+$/.test(selectedLLMNo)) {
      setMsg(t.service.invalidModel)
      return
    }
    setShowLLMPicker(false)
    await serviceAction(pendingServiceName, 'start', { llm_no: selectedLLMNo })
    setPendingServiceName('')
  }

  const serviceAction = async (name, action, params = null) => {
    if (!confirmDanger(`service-${action}`, t.service.confirmAction(action, name))) return
    const pendingMessage = t.service.pending(action, name)
    setServiceActionStates(current => ({ ...current, [name]: { status: 'pending', action, message: pendingMessage } }))
    try {
      const body = { name }
      if (params) body.params = params
      await api(`/api/services/${action}`, { dangerous:true, method:'POST', body: JSON.stringify(body) })
      await load()
      setServiceActionStates(current => ({ ...current, [name]: { status: 'success', action, message: t.service.success(action, name) } }))
      if (selected === name) setLogStreamNonce(value => value + 1)
    } catch (e) {
      setServiceActionStates(current => ({ ...current, [name]: { status: 'error', action, message: t.service.failed(action, name, e.message) } }))
    }
  }
  const toggleServiceAutostart = async (name, enabled) => { if (!confirmDanger('service-autostart', t.service.autostartConfirm(name, enabled))) return; setBusy(true); try { const d = await api('/api/services/autostart', { dangerous:true, method:'POST', body: JSON.stringify({ name, enabled }) }); setServices(d.services || []); setMsg(enabled ? t.enabled : t.disabled) } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const setServiceModel = async (name, llm_no) => { setBusy(true); try { const d = await api('/api/services/model', { dangerous:true, method:'POST', body: JSON.stringify({ name, llm_no }) }); setServices(d.services || []); setMsg(t.service.modelUpdated) } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const loadServiceLogs = (name = selected) => {
    if (!name) return
    setSelected(name)
    setFollowLogs(true)
    setLogStreamNonce(value => value + 1)
  }
  const viewServiceLogs = (name) => { setTab('logs'); loadServiceLogs(name) }

  useEffect(() => {
    if (tab !== 'logs' || !selected) {
      setLogStreamState('idle')
      return undefined
    }
    const maxLines = clampTailLines(tailLines, 20, 2000)
    const source = new EventSource(`/api/logs/${encodeURIComponent(selected)}/stream?lines=${maxLines}`)
    const readPayload = (event) => {
      try { return JSON.parse(event.data) } catch { return null }
    }
    setLogs([])
    setLogStreamState('connecting')
    source.onopen = () => setLogStreamState('live')
    source.addEventListener('snapshot', (event) => {
      const payload = readPayload(event)
      setLogs(Array.isArray(payload?.lines) ? payload.lines.map(String).slice(-maxLines) : [])
    })
    source.addEventListener('reset', (event) => {
      const payload = readPayload(event)
      setLogs(Array.isArray(payload?.lines) ? payload.lines.map(String).slice(-maxLines) : [])
    })
    source.addEventListener('log', (event) => {
      const payload = readPayload(event)
      if (payload?.line === undefined) return
      setLogs(current => [...current, String(payload.line)].slice(-maxLines))
    })
    source.onerror = () => setLogStreamState('reconnecting')
    return () => {
      source.close()
      setLogStreamState('idle')
    }
  }, [tab, selected, tailLines, logStreamNonce])

  useEffect(() => {
    if (!followLogs || tab !== 'logs') return undefined
    const frame = window.requestAnimationFrame(() => {
      const view = logViewRef.current
      if (view) view.scrollTop = view.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [logs, followLogs, tab])

  const handleLogScroll = (event) => {
    const view = event.currentTarget
    setFollowLogs(view.scrollHeight - view.scrollTop - view.clientHeight < 48)
  }
  const pickGoalId = (items = [], preferred = '') => {
    if (preferred && items.some(g => g.id === preferred)) return preferred
    return items.find(g => g.running)?.id || items[0]?.id || ''
  }
  const loadGoals = async () => { const d = await api('/api/goals/list'); const items = d.goals || []; setGoals(items); return items }
  const startGoal = async () => {
    setBusy(true); setMsg('')
    try {
      const objective = goalObjective.trim()
      const budgetMinutes = Number(goalBudget)
      const maxTurns = Number(goalMaxTurns)
      const llmNo = goalLLMNo === '' ? null : Number(goalLLMNo)
      if (!objective) throw new Error(t.hints.goalObjectiveRequired)
      if (new TextEncoder().encode(objective).length > 16384) throw new Error(t.hints.goalObjectiveTooLarge)
      if (!Number.isInteger(budgetMinutes)) throw new Error(t.hints.goalBudgetInteger)
      if (budgetMinutes <= 0) throw new Error(t.hints.goalBudgetPositive)
      if (budgetMinutes > 43200) throw new Error(t.hints.goalBudgetTooLarge)
      if (!Number.isInteger(maxTurns)) throw new Error(t.hints.goalTurnsInteger)
      if (maxTurns < 0) throw new Error(t.hints.goalTurnsNonNegative)
      if (maxTurns > 10000) throw new Error(t.hints.goalTurnsTooLarge)
      if (llmNo !== null && !Number.isInteger(llmNo)) throw new Error(t.hints.goalLLMInteger)
      if (llmNo !== null && llmNo < 0) throw new Error(t.hints.goalLLMNonNegative)
      const body = { objective, budget_minutes: budgetMinutes, max_turns: maxTurns, hive: !!goalHive }
      if (llmNo !== null) body.llm_no = llmNo
      if (!confirmDanger('goals-start', lang === 'zh' ? `启动${goalHive ? ' Hive' : ''}自主目标？预算 ${budgetMinutes} 分钟，最大轮次 ${maxTurns || '不限'}。` : `Start${goalHive ? ' a Hive' : ' an'} autonomous goal? Budget: ${budgetMinutes} minutes. Maximum turns: ${maxTurns || 'unlimited'}.`)) return
      const d = await api('/api/goals/start', { dangerous:true, method:'POST', body: JSON.stringify(body) })
      setMsg(`${t.hints.goalStarted}: ${d.goal?.id || ''}`); setGoalObjective(''); setSelectedGoal(d.goal?.id || selectedGoal); await loadGoals(); if (d.goal?.id) await loadGoalOutput(d.goal.id)
    } catch(e){ setMsg(e.message) } finally{ setBusy(false) }
  }
  const stopGoal = async (g) => {
    if (!g) return
    const exact = !!g.managed
    const tpl = exact ? (t.hints.goalStopExactConfirm || t.hints.goalStopConfirm) : (t.hints.goalStopSoftConfirm || t.hints.goalStopConfirm)
    const confirmText = tpl.replace('{id}', g.id || '-').replace('{pid}', g.pid || '-')
    if (!confirmDanger('goals-stop', confirmText)) return
    setBusy(true); setMsg('')
    try {
      const body = { id: g.id }
      if (g.pid) body.pid = g.pid
      await api('/api/goals/stop', { dangerous:true, method:'POST', body: JSON.stringify(body) })
      setMsg(`${t.hints.goalStopped}: ${g.id}`); await loadGoals(); if (selectedGoal === g.id) await loadGoalOutput(g.id)
    } catch(e){ setMsg(e.message) } finally{ setBusy(false) }
  }
  const deleteGoal = async (g) => { if (!g) return; const confirmText = t.hints.goalDeleteConfirm.replace('{id}', g.id || '-'); if (!confirmDanger('goals-delete', confirmText)) return; setBusy(true); setMsg(''); try { await api('/api/goals/delete', { dangerous:true, method:'POST', body: JSON.stringify({ id: g.id }) }); setMsg(`${t.hints.goalDeleted}: ${g.id}`); const gs = await loadGoals(); if (selectedGoal === g.id) { const next = pickGoalId(gs, ''); setSelectedGoal(next); setGoalOutput(''); setGoalOutputMeta({}); if (next) await loadGoalOutput(next) } } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const loadGoalOutput = async (id = selectedGoal) => {
    if (!id) return
    setSelectedGoal(id)
    const seq = ++goalOutputSeq.current
    try {
      const maxBytes = Number(goalOutputBytes || 0)
      if (!Number.isInteger(maxBytes)) throw new Error(t.hints.goalOutputBytesInteger)
      if (maxBytes < 0) throw new Error(t.hints.goalOutputBytesNonNegative)
      if (maxBytes > 1048576) throw new Error(t.hints.goalOutputBytesTooLarge)
      const d = await api(`/api/goals/output?id=${encodeURIComponent(id)}&max_bytes=${encodeURIComponent(maxBytes)}`)
      if (seq !== goalOutputSeq.current) return
      setGoalOutput(d.output || '')
      setGoalOutputMeta({
        truncated: !!d.truncated,
        totalBytes: d.total_bytes || 0,
        bytesReturned: d.bytes_returned || 0,
        linesReturned: d.lines_returned || 0,
        totalLines: d.total_lines || 0,
        requestedBytes: d.requested_bytes || 0,
        maxBytes: d.max_bytes || 0,
        defaultBytes: d.default_bytes || 0,
        defaultBytesUsed: !!d.default_bytes_used,
        maxBytesCapped: !!d.max_bytes_capped,
        outputStatus: d.output_status || '',
        goal: d.goal || null,
      })
      if (d.goal) setGoals(gs => gs.map(g => g.id === d.goal.id ? d.goal : g))
    } catch (e) {
      if (seq !== goalOutputSeq.current) return
      setMsg(e.message)
      setGoalOutput(e.message)
      setGoalOutputMeta({
        error: e.message,
        bytesReturned: new Blob([e.message || '']).size,
        totalBytes: new Blob([e.message || '']).size,
        requestedBytes: Number(goalOutputBytes || 0),
        maxBytes: Number(goalOutputBytes || 0),
      })
    }
  }
  useEffect(() => {
    if (tab !== 'goals') return
    const refreshGoals = async () => {
      if (goalRefreshBusy.current) return
      goalRefreshBusy.current = true
      try {
        const gs = await loadGoals()
        const active = pickGoalId(gs, selectedGoal)
        if (active) await loadGoalOutput(active)
      } catch (e) {
        setMsg(e.message)
      } finally {
        goalRefreshBusy.current = false
      }
    }
    refreshGoals()
    if (!goalAutoRefresh) return
    const timer = setInterval(refreshGoals, 3000)
    return () => clearInterval(timer)
  }, [tab, selectedGoal, goalOutputBytes, goalAutoRefresh])
  const toggleTask = async (id, enabled) => {
    if (!confirmDanger('schedule-toggle', lang === 'zh' ? `${enabled ? '启用' : '停用'}计划任务 ${id}？` : `${enabled ? 'Enable' : 'Disable'} scheduled task ${id}?`)) return
    setBusy(true)
    try { await api('/api/schedule/toggle', { dangerous:true, method:'POST', body: JSON.stringify({ id, enabled }) }); setMsg(t.hints.taskToggled); await load() } catch(e){ setMsg(e.message) } finally{ setBusy(false) }
  }

  const setTailLines = (value) => setTailLinesRaw(clampTailLines(value))
  const loadFiles = async (path = '', { quiet = false } = {}) => {
    const target = path || ''
    if (!quiet) {
      setBusy(true)
      setFileStatus({ kind: 'pending', action: 'browse', message: `Loading files from ${target || 'GA root'}...` })
    }
    try {
      const d = await api(`/api/files/list?path=${encodeURIComponent(target)}`)
      const items = d.items || d.entries || []
      setFileList(items)
      setFilePath(target)
      if (!quiet) setFileStatus({ kind: 'success', action: 'browse', message: `Loaded ${items.length} file entries from ${target || 'GA root'}.` })
      return d
    } catch (e) {
      setFileList([])
      setMsg(e.message)
      if (!quiet) setFileStatus({ kind: 'error', action: 'browse', message: `Could not load files: ${e.message}`, onRetry: () => loadFiles(target) })
      throw e
    } finally {
      if (!quiet) setBusy(false)
    }
  }
  const readFile = async (path = filePath) => {
    if (!path) return
    setBusy(true)
    setFileStatus({ kind: 'pending', action: 'read', message: `Reading ${path}...` })
    try {
      const d = await api(`/api/files/read?path=${encodeURIComponent(path)}`)
      const content = d.content || ''
      setFileContent(content)
      setLoadedFileContent(content)
      setLoadedFilePath(path)
      setFilePath(path)
      setTab('files')
      setFileStatus({ kind: 'success', action: 'read', message: `Loaded ${path}. You can now edit, review, and save it.` })
    } catch (e) {
      setMsg(e.message)
      setFileStatus({ kind: 'error', action: 'read', message: `Could not read ${path}: ${e.message}`, onRetry: () => readFile(path) })
    } finally {
      setBusy(false)
    }
  }
  const tailFile = async (path = filePath) => {
    if (!path) return
    const safeLines = clampTailLines(tailLines)
    setBusy(true)
    setFileStatus({ kind: 'pending', action: 'tail', message: `Reading the last ${safeLines} lines of ${path}...` })
    try {
      const d = await api(`/api/files/tail?path=${encodeURIComponent(path)}&lines=${safeLines}`)
      const content = d.content || ''
      setFileContent(content)
      setLoadedFileContent(content)
      setLoadedFilePath(path)
      setTailLinesRaw(safeLines)
      setFilePath(path)
      setTab('files')
      setFileStatus({ kind: 'success', action: 'tail', message: `Loaded the last ${safeLines} lines of ${path}.` })
    } catch (e) {
      setMsg(e.message)
      setFileStatus({ kind: 'error', action: 'tail', message: `Could not tail ${path}: ${e.message}`, onRetry: () => tailFile(path) })
    } finally {
      setBusy(false)
    }
  }
  const saveFile = async () => {
    if (!loadedFilePath || !filePath || !fileEditorDirty(fileContent, loadedFileContent)) return
    if (filePath !== loadedFilePath && !confirmDanger('files-retarget', `Editor content was loaded from ${loadedFilePath}, but will be saved to ${filePath}. Continue?`)) return
    if (!confirmDanger('files-write', `Write file ${filePath}? This overwrites content and the backend will create a backup.`)) return
    setBusy(true)
    setFileStatus({ kind: 'pending', action: 'save', message: `Saving ${filePath}...` })
    try {
      const d = await api('/api/files/write', { dangerous:true, method:'POST', body: JSON.stringify({ path:filePath, content:fileContent }) })
      const savedContent = d.content || fileContent
      const savedPath = filePath
      setFileContent(savedContent)
      setLoadedFileContent(savedContent)
      setLoadedFilePath(savedPath)
      setMsg(t.hints.fileSaved || t.saved || 'Saved')
      let refreshWarning = ''
      try { await loadFiles(dirnameForPath(savedPath), { quiet: true }) }
      catch (e) { refreshWarning = ` The file was saved, but the folder list could not refresh: ${e.message}` }
      setFilePath(savedPath)
      setFileStatus({ kind: 'success', action: 'save', message: `Saved ${savedPath}.${refreshWarning}` })
    } catch (e) {
      setMsg(e.message)
      setFileStatus({ kind: 'error', action: 'save', message: `Could not save ${filePath}: ${e.message}. Your editor changes are still available.`, onRetry: saveFile })
    } finally {
      setBusy(false)
    }
  }
  const discardFileChanges = () => {
    if (!loadedFilePath) return
    setFileContent(loadedFileContent)
    setFilePath(loadedFilePath)
    setFileStatus({ kind: 'success', action: 'discard', message: `Discarded unsaved editor changes. ${loadedFilePath} was not modified.` })
  }
  const deleteFile = async (path = filePath) => { if (!path) return; if (!confirmDanger('files-delete', `Delete ${path}? This removes the file or directory under GA root.`)) return; setBusy(true); try { await api('/api/files/delete', { dangerous:true, method:'POST', body: JSON.stringify({ path }) }); if (path === loadedFilePath) { setFileContent(''); setLoadedFileContent(''); setLoadedFilePath('') } setMsg(t.deleted || 'Deleted'); await loadFiles(dirnameForPath(path), { quiet: true }); setFileStatus({ kind: 'success', action: 'delete', message: `Deleted ${path}.` }) } catch(e){ setMsg(e.message); setFileStatus({ kind: 'error', action: 'delete', message: `Could not delete ${path}: ${e.message}`, onRetry: () => deleteFile(path) }) } finally{ setBusy(false) } }
  const downloadFile = (path = filePath) => { if (!path) return; window.open(`/api/files/download?path=${encodeURIComponent(path)}`, '_blank', 'noopener,noreferrer') }



  const refreshVersionStatus = async () => {
    const d = await api('/api/version/status')
    if (d?.running) versionRestartGraceUntil.current = beginVersionRestartGrace()
    setVersionStatus(d)
    if (d?.check) setVersionCheck(d.check)
    return d
  }
  useEffect(() => {
    refreshVersionStatus().catch(() => {})
  }, [])
  useEffect(() => {
    if (!versionStatus?.running) return
    versionUpdateNeedsReload.current = true
    const timer = setInterval(() => refreshVersionStatus().catch(error => {
      if (shouldReportVersionPollError(versionRestartGraceUntil.current)) setMsg(error.message)
    }), 1500)
    return () => clearInterval(timer)
  }, [versionStatus?.running])
  useEffect(() => {
    if (!shouldReloadAfterVersionUpdate(versionStatus, versionUpdateNeedsReload.current)) return
    versionRestartGraceUntil.current = beginVersionRestartGrace()
    let cancelled = false
    let timer
    const expectedVersion = versionStatus?.check?.latest?.tag_name || ''
    const reloadWhenReady = async () => {
      try {
        const info = await api('/api/version')
        if (!versionMatchesExpectedRelease(info?.version, expectedVersion)) throw new Error('updated service is not ready')
        if (!cancelled) window.location.reload()
      } catch (_) {
        if (cancelled) return
        if (shouldReportVersionPollError(versionRestartGraceUntil.current)) {
          setMsg(t.overview.updateReconnectFailed)
          return
        }
        timer = setTimeout(reloadWhenReady, VERSION_RELOAD_RETRY_MS)
      }
    }
    timer = setTimeout(reloadWhenReady, VERSION_RELOAD_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [versionStatus?.running, versionStatus?.stage])
  const checkVersion = async () => {
    setVersionBusy(true)
    try { const d = await api('/api/version/check'); setVersionCheck(d); setMsg(d.update ? t.overview.versionFound(d.latest?.tag_name || '') : t.overview.versionCurrent) }
    catch(e){ setMsg(e.message) }
    finally{ setVersionBusy(false) }
  }
  const updateVersion = async () => {
    if (!confirmDanger('version-update', t.overview.versionUpdateConfirm)) return
    versionRestartGraceUntil.current = beginVersionRestartGrace()
    versionUpdateNeedsReload.current = true
    setVersionBusy(true)
    try { const d = await api('/api/version/update', { dangerous:true, method:'POST', body:'{}' }); setVersionStatus(d); setMsg(t.overview.updateQueued) }
    catch(e){ versionRestartGraceUntil.current = 0; versionUpdateNeedsReload.current = false; setMsg(e.message) }
    finally{ setVersionBusy(false) }
  }
  const installTMWebDriverDeps = async () => {
    if (!confirmDanger('tmwebdriver-install-deps', lang === 'zh' ? '将使用当前 GA Python 执行 pip install requests bottle simple-websocket-server（清华源）。继续？' : 'Use the current GA Python to install requests, bottle, and simple-websocket-server?')) return
    setBusy(true)
    try { const d = await api('/api/tmwebdriver/install-deps', { dangerous:true, method:'POST', body:'{}' }); setTmwdStatus(d.status || d); setMsg(d.ok ? (lang === 'zh' ? 'TMWebDriver 依赖安装完成' : 'TMWebDriver dependencies installed') : (d.error || (lang === 'zh' ? '依赖安装失败，请查看输出' : 'Dependency installation failed; review the output'))) }
    catch(e){ setMsg(e.message) }
    finally{ setBusy(false) }
  }
  const configureGitMirror = async (enabled) => {
    if (!confirmDanger('git-mirror', lang === 'zh' ? (enabled ? '将写入全局 git GitHub 镜像 insteadOf 配置。继续？' : '将移除默认 GitHub 镜像 insteadOf 配置。继续？') : (enabled ? 'Write the global GitHub mirror insteadOf setting to Git configuration?' : 'Remove the default GitHub mirror insteadOf setting from Git configuration?'))) return
    setGitBusy(true)
    try { const d = await api('/api/ga/git-mirror', { dangerous:true, method:'POST', body: JSON.stringify({ enabled }) }); setGitResult(d); setMsg(d.ok ? (enabled ? 'GitHub 镜像已启用' : 'GitHub 镜像已关闭') : (d.error || 'Git 镜像配置失败')) }
    catch(e){ setMsg(e.message) }
    finally{ setGitBusy(false) }
  }
  const runSearch = async () => {
    const path = filePath
    const query = String(fileSearch || '').trim()
    if (!query) return
    setBusy(true)
    setFileStatus({ kind: 'pending', action: 'search', message: `Searching for "${query}"...` })
    try {
      const d = await api(`/api/files/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(query)}&limit=80`)
      const hits = d.hits || []
      setSearchHits(hits)
      setFileStatus({ kind: 'success', action: 'search', message: hits.length ? `Found ${hits.length} matches for "${query}".` : `No matches found for "${query}".` })
    } catch (e) {
      setMsg(e.message)
      setFileStatus({ kind: 'error', action: 'search', message: `Search failed: ${e.message}`, onRetry: runSearch })
    } finally {
      setBusy(false)
    }
  }

  const loadTask = async (id) => { setBusy(true); try { const d = await api(`/api/schedule/task?id=${encodeURIComponent(id)}`); setTaskId(d.id || id); setTaskEditor(safeJson(d.raw)); setTab('tasks'); setTaskSubTab('scheduled') } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const saveTask = async () => { const id = taskId || newTaskId; if (!confirmDanger('schedule-save', lang === 'zh' ? `保存定时任务 ${id}？后端会写入 JSON 并生成备份。` : `Save scheduled task ${id}? The backend writes JSON and creates a backup.`)) return; setBusy(true); try { let raw = JSON.parse(taskEditor); if (editorMode==='form') { const known = ['enabled','max_delay_hours','repeat','schedule','prompt']; const filtered = {}; for (const k of known) if (k in raw && raw[k] !== undefined && raw[k] !== null && raw[k] !== '') filtered[k] = raw[k]; raw = filtered; } await api('/api/schedule/task', { dangerous:true, method:'PUT', body: JSON.stringify({ id, raw }) }); setMsg(t.hints.taskSaved); await load(); setTaskSubTab('scheduled') } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const createTask = async () => { const id = newTaskId.trim(); if (!id) { setMsg('Schedule task id is required'); return }; if (!confirmDanger('schedule-create', `Create schedule task ${id}? This writes a sche_tasks JSON file.`)) return; setBusy(true); try { const payload = buildScheduleCreateRequest(id, DEFAULT_SCHEDULE_TASK); const d = await api('/api/schedule/create', { dangerous:true, method:'POST', body: JSON.stringify(payload) }); const created = d.task || DEFAULT_SCHEDULE_TASK; setTaskId(created.id || id); setTaskEditor(safeJson(created.raw || payload.task)); setMsg(t.hints.taskSaved); await loadScheduleTasks(); setTaskSubTab('scheduled') } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const deleteTask = async () => { if (!taskId) return; if (!confirmDanger('schedule-delete', lang === 'zh' ? `删除定时任务 ${taskId}？后端会先生成备份。` : `Delete scheduled task ${taskId}? The backend creates a backup first.`)) return; setBusy(true); try { await api('/api/schedule/delete', { dangerous:true, method:'POST', body: JSON.stringify({ id: taskId }) }); setMsg(t.hints.taskDeleted); setTaskId(''); setTaskEditor('{}'); await load(); setTaskSubTab('scheduled') } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const readScheduleArtifact = async (path, targetTab = 'tasks') => { setBusy(true); try { const d = await api(`/api/schedule/artifact?path=${encodeURIComponent(path)}`); setScheduleArtifactTitle(path); setScheduleArtifact(d.content || ''); setTab(targetTab); setTaskSubTab('reports') } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }

  const importModels = async ({ quiet = false } = {}) => {
    if (!quiet) setBusy(true)
    setModelImportLoading(true)
    try {
      const d = await api('/api/models/import-mykey', { method:'POST', body: JSON.stringify({ reveal:false, save:false }) })
      const nextProfiles = orderedProviderProfiles(d.profiles || [])
      setProfiles(nextProfiles)
      setPersistedModelProfiles(nextProfiles)
      setModelSaveStatus({})
      setModelRevealedKeys({})
      setModelKeyBusy({})
      setModelPreview(safeJson(d))
      setMsg(`Loaded ${nextProfiles.length} profiles`)
    } catch(e) { setMsg(e.message) } finally { setModelImportLoading(false); if (!quiet) setBusy(false) }
  }
  useEffect(() => {
    if (tab !== 'models' || modelImportAttempted.current || profiles.length) return
    modelImportAttempted.current = true
    importModels({ quiet: true })
  }, [tab, profiles.length])
  const previewModels = async () => { setBusy(true); try { const d = await api('/api/models/preview', { method:'POST', body: JSON.stringify({ profiles }) }); setModelPreview(d.python || safeJson(d)) } catch(e){ setMsg(e.message) } finally{ setBusy(false) } }
  const isMaskedModelSecret = (value) => String(value || '').trim() === '******'
  const getModelProfileKey = (idx, profile) => profile?.client_id || `${profile?.var_name || `profile_${idx + 1}`}:${profile?.type || 'native_oai'}:${profile?.apibase || ''}:${idx}`
  const clearRevealedModelKey = (idx, profile) => {
    const key = getModelProfileKey(idx, profile || profiles[idx])
    setModelRevealedKeys(prev => {
      const next = { ...prev }
      delete next[key]
      delete next[idx]
      return next
    })
    setModelKeyBusy(prev => {
      const next = { ...prev }
      delete next[key]
      delete next[idx]
      return next
    })
  }
  const discoverModels = async ({ protocol, baseUrl, apiKey, varName } = {}) => {
    const params = new URLSearchParams()
    if (protocol) params.set('protocol', protocol)
    if (baseUrl) params.set('base_url', baseUrl)
    if (apiKey) params.set('api_key', apiKey)
    if (varName) params.set('var_name', varName)
    return api(`/api/models/discover?${params.toString()}`)
  }
  const revealModelKey = async (idx, profile, refresh = false) => {
    const profileKey = getModelProfileKey(idx, profile || profiles[idx])
    if (!refresh && Object.prototype.hasOwnProperty.call(modelRevealedKeys, profileKey)) {
      clearRevealedModelKey(idx, profile)
      return
    }
    setModelKeyBusy(prev => ({ ...prev, [profileKey]: true }))
    try {
      const d = await api('/api/models/raw', { dangerous: true })
      const rawProfiles = d?.profiles || []
      const varName = String(profile?.var_name || '').trim()
      const raw = (varName ? rawProfiles.find(p => String(p.var_name || '').trim() === varName) : null) || rawProfiles[idx]
      const key = String(raw?.apikey || profile?.apikey || '').trim()
      setModelRevealedKeys(prev => ({ ...prev, [profileKey]: key }))
    } catch (e) {
      setMsg(`Failed to reveal model key: ${e.message}`)
    } finally {
      setModelKeyBusy(prev => ({ ...prev, [profileKey]: false }))
    }
  }

  const persistModelProfiles = async (nextProfiles, { confirm = true, statusKeys = [] } = {}) => {
    if (confirm && !confirmDanger('models-save', lang === 'zh' ? '保存模型配置会更新 mykey.py，并可能覆盖当前启用配置。确认继续？' : 'Saving model configuration updates mykey.py and may overwrite the active configuration. Continue?')) return false
    const saving = Object.fromEntries(statusKeys.map(k => [k, { status: 'saving', error: '', savedAt: null }]))
    if (statusKeys.length) setModelSaveStatus(current => ({ ...current, ...saving }))
    setBusy(true)
    try {
      const d = await api('/api/models/export', { dangerous:true, method:'POST', body: JSON.stringify({ profiles: nextProfiles, overwrite_active:true }) })
      const cleanProfiles = nextProfiles.map(({ previous_var_name: _previousVarName, ...profile }) => profile)
      setPersistedModelProfiles(cleanProfiles)
      setModelPreview(safeJson(d))
      if (statusKeys.length) {
        const saved = Object.fromEntries(statusKeys.map(k => [k, { status: 'saved', error: '', savedAt: d.updated_at || new Date().toISOString() }]))
        setModelSaveStatus(current => ({ ...current, ...saved }))
      }
      setMsg(t.hints.modelsSaved)
      return true
    } catch(e) {
      setMsg(e.message)
      if (statusKeys.length) {
        const failed = Object.fromEntries(statusKeys.map(k => [k, { status: 'error', error: e.message, savedAt: null }]))
        setModelSaveStatus(current => ({ ...current, ...failed }))
      }
      return false
    } finally { setBusy(false) }
  }

  const saveModelProfile = async (idx, profileKeyOverride, profileOverride) => {
    const profile = profileOverride || profiles[idx]
    if (!profile) return
    const profileKey = profileKeyOverride || getModelProfileKey(idx, profile)
    const nextPersisted = (persistedModelProfiles.length ? persistedModelProfiles : profiles).map(p => ({ ...p }))
    while (nextPersisted.length < profiles.length) nextPersisted.push({ ...profiles[nextPersisted.length] })
    const previousVarName = String(persistedModelProfiles[idx]?.var_name || '').trim()
    nextPersisted[idx] = previousVarName && previousVarName !== String(profile.var_name || '').trim()
      ? { ...profile, previous_var_name: previousVarName }
      : { ...profile }
    return await persistModelProfiles(nextPersisted, { confirm: false, statusKeys: [profileKey] })
  }

  const saveModelOrder = async (orderedRows) => {
    const nextPersisted = applyModelOrder(persistedModelProfiles, orderedRows)
    const ok = await persistModelProfiles(nextPersisted, { confirm: false })
    if (!ok) return false
    setProfiles(current => mergePersistedModelOrder(current, nextPersisted))
    return true
  }

  const saveProviderOrder = async (orderedProfiles) => {
    const nextProfiles = applyProviderOrder(orderedProfiles)
    const ok = await persistModelProfiles(nextProfiles, { confirm: false })
    if (!ok) return false
    setProfiles(nextProfiles)
    return true
  }

  const addModelProfiles = async (newProfiles) => {
    const nextProfiles = [...profiles, ...newProfiles]
    const statusKeys = newProfiles.map((profile, i) => getModelProfileKey(profiles.length + i, profile))
    setProfiles(nextProfiles)
    const ok = await persistModelProfiles(nextProfiles, { confirm: false, statusKeys })
    if (!ok) setProfiles(profiles)
    return ok
  }
  const deleteModelProfile = async (nextProfiles) => {
    setProfiles(nextProfiles)
    const ok = await persistModelProfiles(nextProfiles, { confirm: false, statusKeys: [] })
    if (!ok) setProfiles(profiles)
    return ok
  }
  const patchProfile = (idx, patch) => {
    const shouldClearSecret = Object.prototype.hasOwnProperty.call(patch, 'apikey') || Object.prototype.hasOwnProperty.call(patch, 'var_name')
    if (shouldClearSecret) clearRevealedModelKey(idx, profiles[idx])
    setProfiles(ps => ps.map((p, i) => i === idx ? { ...p, ...patch } : p))
  }

  const nav = NAV_ITEMS

  const needsSetup = !!health && !health?.ok
  if (needsSetup) {
    return <SetupWizard initialRoot={root} t={t} onComplete={(nextCfg) => {
      if (nextCfg?.ga_root) setRoot(nextCfg.ga_root)
      load()
    }} />
  }

  const overviewPage = <OverviewPage
    t={t}
    services={services}
    schedule={schedule}
    observability={observability}
    observabilityError={observabilityError}
    refreshObservability={() => readObservability().catch(error => { setObservability(null); setObservabilityError(error.message) })}
    versionInfo={versionInfo}
    versionCheck={versionCheck}
    versionStatus={versionStatus}
    versionBusy={versionBusy}
    checkVersion={checkVersion}
    updateVersion={updateVersion}
    refreshVersionStatus={refreshVersionStatus}
    setMsg={setMsg}
    gitStatus={gitStatus}
    gitResult={gitResult}
    gitBusy={gitBusy}
    busy={busy}
    checkGASource={checkGASource}
    updateGASource={updateGASource}
    autostart={autostart}
    toggleAutostart={toggleAutostart}
    root={root}
  />

  return <>
    {showLLMPicker && <div className="modal-overlay" onClick={() => setShowLLMPicker(false)}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3>{t.service.chooseReflectModel}</h3><button className="modal-close" aria-label={t.close} onClick={() => setShowLLMPicker(false)}>✕</button></div>
        <p className="muted">{t.service.aboutToStart(pendingServiceName)}</p>
        <select value={reflectLLMNo} onChange={e => setReflectLLMNo(e.target.value)}>
          {llms.length ? llms.map(m => <option key={m.index} value={m.index}>{modelLabel(m)}</option>) : <option value="0">{t.service.noModelsDefault}</option>}
        </select>
        <div className="modal-actions">
          <button onClick={confirmReflectStart}><Play size={14}/>{t.start}</button>
          <button onClick={() => setShowLLMPicker(false)}>{t.cancel}</button>
        </div>
      </div>
    </div>}
    <div ref={appScope} className={`app app-tab-${tab}`}>
    <aside className="sidebar"><div className="brand"><Bot aria-hidden="true"/><div><h1>{t.appName}</h1><p>{t.tagline}</p></div></div><div className="lang-switch"><div className="lang-switch-label"><Globe2 size={15} aria-hidden="true"/><span>{t.language}</span></div><div className="lang-options" role="group" aria-label={t.language}><button type="button" aria-pressed={lang === 'zh'} className={lang === 'zh' ? 'active' : ''} onClick={()=>chooseLang('zh')}>中</button><button type="button" aria-pressed={lang === 'en'} className={lang === 'en' ? 'active' : ''} onClick={()=>chooseLang('en')}>EN</button></div><button type="button" className="theme-toggle" title={theme === 'dark' ? t.switchToLight : t.switchToDark} onClick={()=>setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? t.switchToLight : t.switchToDark}>{theme === 'dark' ? <Sun size={15} aria-hidden="true"/> : <Moon size={15} aria-hidden="true"/>}</button></div><nav aria-label={t.mainNavigation}>{nav.map(n => <button key={n} type="button" aria-current={tab===n ? 'page' : undefined} className={tab===n?'active':''} onClick={()=>{ if (n === 'chat') window.location.href = buildRoute('chat'); else setTab(n) }}>{icon(n)}{t.nav[n]}</button>)}</nav><button type="button" className="refresh" onClick={load} disabled={booting}><RefreshCw size={15} aria-hidden="true"/>{booting ? t.busy : t.refresh}</button><StatusNotice kind={notice?.kind} message={notice?.message} retryLabel={t.retry} dismissLabel={t.close} onRetry={notice?.kind === 'error' ? load : undefined} onDismiss={notice?.kind === 'success' ? ()=>setNotice(null) : undefined}/></aside>
    <main className="main"><header><div><h2>{t.nav[tab]}</h2><p>{t.desc[tab]}</p></div><div className="badges"><span>{cfg?.host}:{cfg?.port}</span><span role="status" aria-live="polite" className={health?.ok?'ok':'err'}>{health?.ok ? t.ready : t.error}</span></div></header>
      <ErrorBoundary resetKey={tab}>
        <Suspense fallback={<RouteFallback label={t.loading} />}>
      {tab==='overview' && overviewPage}
      {tab==='chat' && <ChatPage t={t} slashCommands={cfg?.slash_commands}/>}
      {tab==='files' && <FilesPage t={t} filePath={filePath} setFilePath={setFilePath} fileList={fileList} fileContent={fileContent} loadedFileContent={loadedFileContent} loadedFilePath={loadedFilePath} setFileContent={setFileContent} fileSearch={fileSearch} setFileSearch={setFileSearch} searchHits={searchHits} tailLines={tailLines} setTailLines={setTailLines} loadFiles={loadFiles} readFile={readFile} tailFile={tailFile} saveFile={saveFile} discardChanges={discardFileChanges} deleteFile={deleteFile} downloadFile={downloadFile} runSearch={runSearch} fileStatus={fileStatus} dismissFileStatus={() => setFileStatus({})} busy={busy}/>}

      {tab==='tasks' && <section className="tasks-page">
        <div className="stats schedule-stats">
          <div className="stat"><Activity/><span>{t.lists.taskServices}</span><b>{taskSvcs.length}</b></div>
          <div className="stat"><CalendarClock/><span>{t.cards.enabledTasks || t.enabled}</span><b>{schedule.enabled || 0}</b></div>
          <div className="stat"><FolderCog/><span>{t.cards.reports || '报告'}</span><b>{schedule.done_count || 0}</b></div>
          <div className="stat"><Target/><span>{t.nav.goals}</span><b>{goals.filter(g=>g.running).length}/{goals.length}</b></div>
          <div className="stat"><ShieldAlert/><span>{t.error}</span><b>{schedule.errors || 0}</b></div>
        </div>

        <div className="subtabs task-subtabs" role="navigation" aria-label={lang === 'zh' ? '任务分类' : 'Task sections'}>
          <button type="button" aria-current={taskSubTab==='services' ? 'page' : undefined} className={taskSubTab==='services' ? 'active' : ''} onClick={()=>setTaskSubTab('services')}><Server size={14}/>{t.lists.taskServices}</button>
          <button type="button" aria-current={taskSubTab==='scheduled' ? 'page' : undefined} className={taskSubTab==='scheduled' ? 'active' : ''} onClick={()=>setTaskSubTab('scheduled')}><CalendarClock size={14}/>{t.lists.scheduledTasks}</button>
          <button type="button" aria-current={taskSubTab==='runs' ? 'page' : undefined} className={taskSubTab==='runs' ? 'active' : ''} onClick={()=>setTaskSubTab('runs')}><Target size={14}/>{t.nav.goals} / {t.nav.autonomous}</button>
          <button type="button" aria-current={taskSubTab==='reports' ? 'page' : undefined} className={taskSubTab==='reports' ? 'active' : ''} onClick={()=>setTaskSubTab('reports')}><FolderCog size={14}/>{t.lists.recentReports}</button>
        </div>

        {taskSubTab==='services' && <div className="single-panel">
          <Panel title={t.lists.taskServices}>
            <p className="muted">{t.desc.tasks}</p>
            <div className="service-list clean-list">
              {taskSvcs.length
                ? taskSvcs.map(svc => <ServiceRow key={svc.name} svc={svc} t={t} actionState={serviceActionStates[svc.name]} onStart={n=>serviceAction(n,'start')} onStop={n=>serviceAction(n,'stop')} onLogs={viewServiceLogs} onAutostart={toggleServiceAutostart}/>)
                : <p className="muted">{t.hints.noTasks}</p>}
            </div>
          </Panel>
        </div>}

        {taskSubTab==='scheduled' && <div className="workspace tasks-workspace">
          <Panel title={t.lists.scheduledTasks}>
            <div className="task-create">
              <div className="task-create-input-row">
                <input value={newTaskId} onChange={e=>setNewTaskId(e.target.value)} placeholder={t.hints.newTaskId}/>
              </div>
              <div className="task-create-btn-row">
                <button onClick={createTask} disabled={busy || !newTaskId.trim()}><FileCode2 size={14}/>{t.create}</button>
                <button onClick={()=>loadScheduleTasks()} disabled={scheduleLoading}><RefreshCw size={14}/>{t.refresh}</button>
                {schedule.log?.exists && <button onClick={()=>readScheduleArtifact('sche_tasks/scheduler.log')}><Terminal size={14}/>{t.nav.logs}</button>}
              </div>
            </div>
            {scheduleError && <p className="err-text">{scheduleError}</p>}
            <div className="task-list clean-list" aria-busy={scheduleLoading}>
              {scheduleLoading
                ? <p className="muted">{t.busy}</p>
                : tasks.length
                  ? tasks.map((task, idx) => <TaskRow key={task.id || task.name || idx} task={task} t={t} onToggle={toggleTask} onEdit={loadTask} onArtifact={readScheduleArtifact}/>)
                  : <p className="muted">{t.hints.noTasks}</p>}
            </div>
          </Panel>
          <Panel title={`${t.lists.editor} · ${taskId || t.empty}`}>
            <div className="editor-mode-toggle">
              <button className={editorMode==='form' ? 'active' : ''} onClick={()=>setEditorMode('form')}><SlidersHorizontal size={14}/>{t.tasks.form}</button>
              <button className={editorMode==='json' ? 'active' : ''} onClick={()=>setEditorMode('json')}><Code2 size={14}/>{t.tasks.json}</button>
            </div>
            <p className="muted">{editorMode==='json' ? t.hints.jsonHelp : t.tasks.formHelp}</p>
            {editorMode==='json'
              ? <textarea className="json-editor compact-editor" value={taskEditor} onChange={e=>setTaskEditor(e.target.value)}/>
              : <TaskFormEditor value={taskEditor} onChange={setTaskEditor} t={t}/>}
            <div className="actions">
              <button onClick={saveTask} disabled={!taskId && !newTaskId}><Save size={14}/>{t.save}</button>
              <button onClick={deleteTask} disabled={!taskId}><XCircle size={14}/>{t.remove}</button>
            </div>
          </Panel>
        </div>}


        {taskSubTab==='runs' && <div className="workspace tasks-workspace">
          <Panel title={`${t.nav.goals} · ${goals.filter(g=>g.running).length}/${goals.length}`}>
            <div className="actions"><button onClick={()=>setTab('goals')}><Target size={14}/>{t.nav.goals}</button><button onClick={loadGoals}><RefreshCw size={14}/>{t.refresh}</button></div>
            <div className="goal-list compact-goals">
              {goals.length
                ? goals.map(g => <button className="goal-row" key={g.id} onClick={()=>{ setTab('goals'); setSelectedGoal(g.id) }}><div><b>{g.objective || g.id}</b><span>{g.status || '-'} · {g.running ? `${t.fields.pid} ${g.pid}` : t.fields.notRunning}</span></div><small>{t.fields.turn} {g.turns_used || 0}/{g.max_turns || '-'}</small></button>)
                : <p className="muted">{t.empty}</p>}
            </div>
          </Panel>
          <Panel title={t.nav.autonomous}>
            <div className="actions"><button onClick={()=>setTab('autonomous')}><Bot size={14}/>{t.nav.autonomous}</button></div>
            <EntryList items={[...(reflectSvcs || []).map(s=>({ name:s.name, path:s.running ? `${t.running}${s.pid ? ` · PID ${s.pid}` : ''}` : t.stopped, kind:s.kind || 'reflect' })), ...((inv.autonomous_reports || []).slice(0, 8).map(r=>({ name:r.name, path:new Date(r.mod_time).toLocaleString(), kind:'report' })))]} empty={t.empty}/>
          </Panel>
        </div>}

        {taskSubTab==='reports' && <div className="workspace tasks-workspace">
          <Panel title={t.lists.recentReports}>
            <div className="report-list clean-list">
              {(schedule.done_recent || []).length
                ? (schedule.done_recent || []).map(r => <button key={r.path} className={scheduleArtifactTitle===r.path ? 'active' : ''} onClick={()=>readScheduleArtifact(r.path)}>{r.name}<small>{new Date(r.mod_time).toLocaleString()}</small></button>)
                : <p className="muted">{t.empty}</p>}
            </div>
          </Panel>
          <Panel title={scheduleArtifactTitle || t.lists.generatedPreview}>
            <pre className="artifact-view">{scheduleArtifact || t.empty}</pre>
          </Panel>
        </div>}
      </section>}
      {tab==='memory' && <section><div className="grid2"><Panel title={t.lists.memory}><EntryList items={[inv.memory?.insight, inv.memory?.facts].filter(Boolean)} empty={t.empty}/></Panel><Panel title={t.lists.sop}><EntryList items={[...(inv.memory?.sops||[]), ...(inv.memory?.utils||[])]} empty={t.empty}/></Panel></div></section>}
      {tab==='channels' && <ChannelsPage frontendSvcs={frontendSvcs} t={t} actionStates={serviceActionStates} onStart={n=>serviceAction(n,'start')} onStop={n=>serviceAction(n,'stop')} onLogs={viewServiceLogs} onAutostart={toggleServiceAutostart} onReflectStart={startReflectService}/>}
      {tab==='autonomous' && <section><Panel title={t.lists.reflectServices}>{reflectSvcs.length ? reflectSvcs.map(s=><ServiceRow key={s.name} svc={s} t={t} llms={llms} actionState={serviceActionStates[s.name]} onStart={n=>serviceAction(n,'start')} onStop={n=>serviceAction(n,'stop')} onLogs={viewServiceLogs} onAutostart={toggleServiceAutostart} onModel={setServiceModel}/>) : <p className="muted">{t.hints.noReflect}</p>}</Panel><Panel title={t.lists.recentReports}><div className="report-list">{(inv.autonomous_reports || []).map(r=><button key={r.path} className={scheduleArtifactTitle===r.path ? 'active' : ''} onClick={()=>readScheduleArtifact(r.path, 'autonomous')}>{r.name}<small>{new Date(r.mod_time).toLocaleString()}</small></button>)}</div><pre className="artifact-view">{scheduleArtifactTitle?.includes('autonomous_reports') ? (scheduleArtifact || t.empty) : t.empty}</pre></Panel></section>}
      {tab==='usage' && <UsagePage lang={lang}/>}
      {tab==='goals' && <GoalsPage t={t} goals={goals} objective={goalObjective} setObjective={setGoalObjective} budget={goalBudget} setBudget={setGoalBudget} maxTurns={goalMaxTurns} setMaxTurns={setGoalMaxTurns} llmNo={goalLLMNo} setLLMNo={setGoalLLMNo} hive={goalHive} setHive={setGoalHive} outputBytes={goalOutputBytes} setOutputBytes={setGoalOutputBytes} autoRefresh={goalAutoRefresh} setAutoRefresh={setGoalAutoRefresh} selected={selectedGoal} output={goalOutput} outputMeta={goalOutputMeta} busy={busy} onStart={startGoal} onStop={stopGoal} onDelete={deleteGoal} onRefresh={loadGoals} onOutput={loadGoalOutput} onClearOutput={()=>{ goalOutputSeq.current += 1; setGoalOutput(''); setGoalOutputMeta(null); setMsg(t.hints.goalOutputCleared) }} setMsg={setMsg}/>}
      {tab==='settings' && <section className="settings-page">
        <div className="settings-console">
          <div className="settings-intro">
            <div className="settings-intro-copy">
              <span className="settings-eyebrow"><SlidersHorizontal size={14}/>{t.nav.settings}</span>
              <h2>{settingsText.title}</h2>
              <p>{settingsText.summary}</p>
            </div>
            <div className="settings-save-area">
              <span className={`settings-config-status${cfg ? ' ready' : ''}`}><CheckCircle2 size={14}/>{cfg ? settingsText.configured : t.busy}</span>
              <button className="primary settings-save" type="button" onClick={saveConfig} disabled={busy || !cfg}><Save size={15}/>{busy ? t.busy : settingsText.saveAll}</button>
            </div>
          </div>
          <div className="settings-save-note"><ShieldAlert size={14}/><span>{settingsText.unsavedHint}</span></div>

          <div className="settings-section-grid">
            <section className="settings-card settings-card-paths">
              <header className="settings-card-head">
                <span className="settings-card-icon"><FolderCog size={18}/></span>
                <span><strong>{settingsText.paths}</strong><small>{settingsText.pathsDesc}</small></span>
              </header>
              <div className="settings-fields">
                <label className="settings-field" htmlFor="settings-ga-root">
                  <span>{t.root}</span><small>{settingsText.rootHelp}</small>
                  <input id="settings-ga-root" value={root} onChange={e=>setRoot(e.target.value)}/>
                </label>
                <label className="settings-field" htmlFor="settings-python-path">
                  <span>{t.fields.pythonPath}</span><small>{settingsText.pythonHelp}</small>
                  <input id="settings-python-path" value={cfg?.python_path || ''} onChange={e=>setCfg({...cfg, python_path:e.target.value})} placeholder={t.fields.pythonAuto}/>
                </label>
                <label className="settings-field" htmlFor="settings-chat-data">
                  <span>{t.fields.chatDataDir}</span><small>{settingsText.dataHelp}</small>
                  <input id="settings-chat-data" value={cfg?.chat_data_dir || ''} onChange={e=>setCfg({...cfg, chat_data_dir:e.target.value})} placeholder={t.fields.chatDataAuto}/>
                </label>
              </div>
            </section>

            <section className="settings-card settings-card-network">
              <header className="settings-card-head">
                <span className="settings-card-icon"><Globe2 size={18}/></span>
                <span><strong>{settingsText.network}</strong><small>{settingsText.networkDesc}</small></span>
              </header>
              <div className="settings-fields">
                <label className="settings-field" htmlFor="settings-proxy-mode">
                  <span>{settingsText.proxyMode}</span>
                  <select id="settings-proxy-mode" value={cfg?.proxy_mode || 'off'} onChange={e=>setCfg({...cfg, proxy_mode:e.target.value})}>
                    <option value="off">{settingsText.proxyOff}</option>
                    <option value="system">{settingsText.proxySystem}</option>
                    <option value="custom">{settingsText.proxyCustom}</option>
                  </select>
                  <small className="settings-mode-help">{(cfg?.proxy_mode || 'off') === 'custom' ? settingsText.proxyCustomHelp : (cfg?.proxy_mode || 'off') === 'system' ? settingsText.proxySystemHelp : settingsText.proxyOffHelp}</small>
                </label>
                {(cfg?.proxy_mode || 'off') === 'custom' && <div className="settings-proxy-grid">
                  <label className="settings-field" htmlFor="settings-http-proxy"><span>HTTP_PROXY</span><input id="settings-http-proxy" value={cfg?.http_proxy || ''} onChange={e=>setCfg({...cfg, http_proxy:e.target.value})} placeholder="http://127.0.0.1:7890"/></label>
                  <label className="settings-field" htmlFor="settings-https-proxy"><span>HTTPS_PROXY</span><input id="settings-https-proxy" value={cfg?.https_proxy || ''} onChange={e=>setCfg({...cfg, https_proxy:e.target.value})} placeholder="http://127.0.0.1:7890"/></label>
                  <label className="settings-field" htmlFor="settings-all-proxy"><span>ALL_PROXY</span><input id="settings-all-proxy" value={cfg?.all_proxy || ''} onChange={e=>setCfg({...cfg, all_proxy:e.target.value})} placeholder="socks5://127.0.0.1:7890"/></label>
                  <label className="settings-field" htmlFor="settings-no-proxy"><span>NO_PROXY</span><input id="settings-no-proxy" value={cfg?.no_proxy || ''} onChange={e=>setCfg({...cfg, no_proxy:e.target.value})} placeholder="localhost,127.0.0.1"/></label>
                </div>}
              </div>
            </section>
          </div>

        </div>
      </section>}
      {tab==='models' && <Models t={t} profiles={profiles} persistedProfiles={persistedModelProfiles} setProfiles={setProfiles} patchProfile={patchProfile} addModelProfiles={addModelProfiles} importModels={importModels} previewModels={previewModels} saveModelProfile={saveModelProfile} onSaveModelOrder={saveModelOrder} onSaveProviderOrder={saveProviderOrder} deleteModelProfile={deleteModelProfile} discoverModels={discoverModels} modelPreview={modelPreview} modelSaveStatus={modelSaveStatus} importLoading={modelImportLoading} riskCatalog={observability?.riskItems || []} riskCatalogError={observabilityError} revealedKeys={modelRevealedKeys} revealBusy={modelKeyBusy} getProfileKey={getModelProfileKey} onRevealKey={revealModelKey} onClearRevealedKey={clearRevealedModelKey}/>}
      {tab==='logs' && <section className="logs-page">
        <div className="logs-layout">
          <Panel title={t.lists.processes} className="logs-side">
            <div className="logs-toolbar">
              <label>{t.hints.tailLines}<input type="number" min="20" max="2000" value={tailLines} onChange={e=>setTailLines(Number(e.target.value) || 200)}/></label>
              <button disabled={!selected} onClick={()=>loadServiceLogs(selected)}><RefreshCw size={14}/>{t.refresh}</button>
            </div>
            <div className="logs-service-list">
              {services.map(s => <button className={selected===s.name?'log-service active':'log-service'} key={s.name} onClick={()=>loadServiceLogs(s.name)}>
                <span className={s.running?'dot running':'dot'}></span>
                <span className="log-service-copy"><span className="log-service-name">{s.name}</span><small>{s.kind}{s.pid ? ` · PID ${s.pid}` : ''}</small></span>
              </button>)}
            </div>
          </Panel>
          <Panel title={`Logs · ${selected || '-'}`} className="log-panel">
            <div className="log-head">
              <div className="log-meta">
                <div className={`stream-state ${logStreamState}`}><span></span>{logStreamState === 'live' ? (lang === 'zh' ? '实时传输' : 'Live') : logStreamState === 'reconnecting' ? (lang === 'zh' ? '正在重连' : 'Reconnecting') : logStreamState === 'connecting' ? (lang === 'zh' ? '正在连接' : 'Connecting') : (lang === 'zh' ? '未连接' : 'Idle')}</div>
                <span className="log-count">{logs.length} lines · UTF-8</span>
                {selected && <p className="muted log-command" title={services.find(s=>s.name===selected)?.command?.join(' ')}>{services.find(s=>s.name===selected)?.command?.join(' ')}</p>}
              </div>
              <div className="actions log-actions">
                <button className={followLogs ? 'active' : ''} disabled={!selected} aria-pressed={followLogs} onClick={()=>setFollowLogs(value=>!value)}><Activity size={14}/>{lang === 'zh' ? '跟随' : 'Follow'}</button>
                <button disabled={!logs.length} onClick={()=>setLogs([])}><Trash2 size={14}/>{t.clear}</button>
                <button disabled={!selected || services.find(s=>s.name===selected)?.running} onClick={()=>serviceAction(selected,'start')}><Play size={14}/>{t.start}</button>
                <button disabled={!selected || !services.find(s=>s.name===selected)?.running} onClick={()=>serviceAction(selected,'stop')}><Square size={14}/>{t.stop}</button>
              </div>
            </div>
            {!selected ? <div className="log-selection-empty">{lang === 'zh' ? '选择一个服务以查看日志' : 'Select a service to view logs'}</div> : <>
              <div className="log-stream-controls">
                <span className={`stream-state ${logStreamState}`} role="status">
                  {logStreamState === 'connecting' ? (lang === 'zh' ? '正在连接日志流' : 'Connecting to log stream') :
                    logStreamState === 'live' ? (lang === 'zh' ? '日志流已连接' : 'Log stream live') :
                    logStreamState === 'reconnecting' ? (lang === 'zh' ? '日志流连接中断' : 'Log stream interrupted') :
                    (lang === 'zh' ? '日志流空闲' : 'Log stream idle')}
                </span>
                <span className={`log-follow-status ${followLogs ? 'following' : 'paused'}`}>{followLogs ? (lang === 'zh' ? '自动跟随' : 'Following') : (lang === 'zh' ? '已暂停跟随' : 'Follow paused')}</span>
              </div>
              {logStreamState === 'reconnecting' && <div className="log-stream-error" role="alert">
                <span>{lang === 'zh' ? '日志流连接已中断，可重试。' : 'The log stream was interrupted. You can retry.'}</span>
                <button type="button" onClick={() => setLogStreamNonce(value => value + 1)}>{t.retry || (lang === 'zh' ? '重试' : 'Retry')}</button>
              </div>}
              {!logs.length && logStreamState === 'live' && <p className="log-output-empty">{lang === 'zh' ? '当前没有日志输出' : 'No log output yet'}</p>}
              <pre ref={logViewRef} onScroll={handleLogScroll} className="log-view">{logs.join('\n')}</pre>
            </>}
          </Panel>
        </div>
      </section>}        </Suspense>
      </ErrorBoundary>
    </main>
  </div>
      </>}



export function ChannelsPage({ frontendSvcs, t, actionStates = {}, onStart, onStop, onLogs, onAutostart, onReflectStart }) {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState('')
  const [msg, setMsg] = useState(null)
  const text = t.channels
  const profileName = profile => text.profileNames?.[profile.id] || profile.name
  const profileDescription = profile => text.profileDescriptions?.[profile.id] || profile.description
  const fieldLabel = field => text.fieldLabels?.[field.name] || field.label || field.name
  const fieldPlaceholder = field => field.name?.endsWith('_allowed_users') ? text.allowedUsersPlaceholder : (field.placeholder || '')
  const load = async () => {
    setLoading(true)
    try {
      const d = await api('/api/channels')
      setConfig(d)
      return d
    } catch (e) {
      setMsg({ kind: 'error', text: text.loadFailed(e.message) })
      return null
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { setMsg(null) }, [text])
  const patchField = (profileId, fieldName, value) => {
    setConfig(prev => ({
      ...(prev || {}),
      profiles: (prev?.profiles || []).map(p => p.id === profileId ? {
        ...p,
        fields: (p.fields || []).map(f => f.name === fieldName ? { ...f, value } : f)
      } : p)
    }))
  }
  const save = async () => {
    if (!confirmDanger('channels-save', text.saveConfirm)) return
    setSaving(true); setMsg({ kind: 'pending', text: text.saving })
    try {
      const d = await api('/api/channels', { dangerous:true, method:'PUT', body: JSON.stringify({ profiles: config?.profiles || [] }) })
      setConfig(d)
      setMsg({ kind: 'success', text: text.saved(d.path) })
    } catch (e) { setMsg({ kind: 'error', text: text.saveFailed(e.message) }) } finally { setSaving(false) }
  }
  const testProfile = async (profile) => {
    const name = profileName(profile)
    setTesting(profile.id); setMsg({ kind: 'pending', text: text.testing(name) })
    try {
      const d = await api('/api/channels/test', { method:'POST', body: JSON.stringify({ profile_id: profile.id, fields: profile.fields || [] }) })
      const detail = /[一-龥]/.test(d.message || '') && document.documentElement.lang === 'en' ? '' : (d.message || '')
      setMsg({ kind: d.ok ? 'success' : 'error', text: d.ok ? `${text.testPassed(name)}${detail ? ` · ${detail}` : ''}` : text.testFailed(name, detail) })
    } catch (e) { setMsg({ kind: 'error', text: text.testFailed(name, e.message) }) } finally { setTesting('') }
  }
  const runningCount = frontendSvcs.filter(s => s.running).length
  return <section className="channels-page">
    <div className="channel-hero">
      <div>
        <span className="eyebrow">Channels</span>
        <h2>{text.title}</h2>
        <p>{text.summary}</p>
      </div>
      <div className="channel-hero-stats">
        <span><b>{frontendSvcs.length}</b> {text.services}</span>
        <span><b>{runningCount}</b> {text.running}</span>
      </div>
    </div>
    <div className="channels-layout">
      <Panel title={text.keyConfig} className="channels-panel channel-key-panel">
        <div className="channel-toolbar">
          <div>{config?.path ? <span>{text.configFile}: <code>{config.path}</code></span> : <span>{loading ? text.loadingConfig : text.noConfigPath}</span>}</div>
          <div className="actions"><button onClick={load} disabled={loading || saving}>{loading ? text.refreshing : t.refresh}</button><button onClick={save} disabled={saving || loading || !config}>{saving ? t.busy : t.save}</button></div>
        </div>
        {msg && <p className={`${msg.kind === 'error' ? 'err' : 'ok'} channel-message`}>{msg.text}</p>}
        <div className="channel-config-list">
          {(config?.profiles || []).map(profile => <article className="channel-config-card" key={profile.id}>
            <div className="channel-config-head">
              <div><h3>{profileName(profile)}</h3><p>{profileDescription(profile)}</p></div>
              <button onClick={()=>testProfile(profile)} disabled={saving || testing === profile.id}>{testing === profile.id ? text.testingButton : text.testConnection}</button>
            </div>
            <div className="channel-fields">
              {(profile.fields || []).map(field => <label key={field.name}>
                <span>{fieldLabel(field)}<small>{field.name}{field.secret && field.has_value ? ` · ${text.savedField}` : ''}</small></span>
                {field.secret
                  ? <SecretInput value={field.value || ''} onChange={v=>patchField(profile.id, field.name, v)} t={t}/>
                  : field.type === 'bool'
                    ? <select value={String(field.value || 'false').toLowerCase()} onChange={e=>patchField(profile.id, field.name, e.target.value)}><option value="false">False</option><option value="true">True</option></select>
                    : <input value={field.value || ''} placeholder={fieldPlaceholder(field)} onChange={e=>patchField(profile.id, field.name, e.target.value)}/>}
              </label>)}
            </div>
          </article>)}
          {!loading && !config?.profiles?.length && <p className="empty-cell">{t.empty}</p>}
        </div>
      </Panel>
      <Panel title={t.lists.frontendServices} className="channels-panel channel-services-panel">
        <p className="muted">{t.desc.channels}</p>
        <ChannelServiceTable services={frontendSvcs} t={t} actionState={actionStates} onStart={onStart} onStop={onStop} onLogs={onLogs} onAutostart={onAutostart} onReflectStart={onReflectStart}/>
      </Panel>
    </div>
  </section>
}

function icon(n) { const m = { overview:<Activity size={16}/>, chat:<MessageSquare size={16}/>, files:<FileCode2 size={16}/>, tasks:<Terminal size={16}/>, memory:<Brain size={16}/>, channels:<Globe2 size={16}/>, autonomous:<Bot size={16}/>, usage:<BarChart3 size={16}/>, schedule:<CalendarClock size={16}/>, goals:<Target size={16}/>, models:<SlidersHorizontal size={16}/>, settings:<FolderCog size={16}/>, logs:<FolderCog size={16}/> }; return m[n] }
