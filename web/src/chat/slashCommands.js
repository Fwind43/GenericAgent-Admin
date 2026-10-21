import { REASONING_EFFORT_LEVELS } from '../lib/reasoningEffort'
import { ct } from './chatFormat.js'

export const BUILTIN_SLASH_COMMANDS = [
	{ cmd: '/project', key: '/project', insert: '/project', desc: '列出项目并查看或切换 Project Mode', builtIn: true },
  { cmd: '/continue', key: '/continue', insert: '/continue', desc: '列出可恢复的官方 GA 会话', builtIn: true },
  { cmd: '/continue <编号>', key: '/continue', insert: '/continue ', desc: '恢复第 N 个官方 GA 会话，可继续对话', builtIn: true },
  { cmd: '/review <自然语言请求>', key: '/review', insert: '/review ', desc: '审阅当前改动；可继续输入范围或关注点', builtIn: true },
  { cmd: '/review help', key: '/review help', insert: '/review help', desc: '显示 /review 帮助，不启动审阅', builtIn: true },
  { cmd: '/ultraplan <目标>', key: '/ultraplan', insert: '/ultraplan ', desc: '显式进入 UltraPlan 规划模式，并生成本地 run 目录', builtIn: true },
  { cmd: '/improve', key: '/improve', insert: '/improve', desc: '发送记忆提炼请求（L3 skill + L1 索引）', builtIn: true },
  { cmd: '/effort', key: '/effort', insert: '/effort', desc: '查看当前 reasoning effort', builtIn: true },
  ...REASONING_EFFORT_LEVELS.map(level => ({
    cmd: `/effort ${level}`,
    key: `/effort ${level}`,
    insert: `/effort ${level}`,
    desc: level === 'off' ? ct('清除 reasoning effort', 'Clear reasoning effort') : ct(`设置 reasoning effort 为 ${level}`, `Set reasoning effort to ${level}`),
    builtIn: true,
  })),
  { cmd: '/workspace <path>', key: '/workspace', insert: '/workspace ', desc: ct('为当前会话绑定项目目录', 'Bind a project directory to the current session'), builtIn: true },
  { cmd: '/workspace off', key: '/workspace off', insert: '/workspace off', desc: ct('关闭当前会话 workspace', 'Disable the current session workspace'), builtIn: true },
]

export const builtinSlashKey = (cmd = '') => String(cmd || '').trim().toLowerCase()

export const builtinSlashCommandKey = (c) => builtinSlashKey(c?.key || c?.cmd)

// 参数式命令：裸根命令（/goal）或以 <参数>/[参数] 占位结尾（/goal [goal]、/continue <编号>、/rewind [n]）。
// 这类命令后面的自由文本必须保留，禁止被 insert 模板覆盖（否则会清空用户已输入的内容）。
export const SLASH_ARG_SUFFIX_RE = /\s(?:<[^>]+>|\[[^\]]+\])$/

export const isArgumentStyleSlashCmd = (cmd = '') => {
  const s = String(cmd || '')
  if (!s) return false
  const root = s.split(/\s+/, 1)[0]
  return s === root || SLASH_ARG_SUFFIX_RE.test(s)
}

export const slashCommandInsertText = (c, current = '') => {
  if (!c) return current || ''
  const text = String(current || '')
  const cmd = String(c.cmd || '')
  const root = cmd.split(/\s+/, 1)[0]
  const isArgumentFallback = isArgumentStyleSlashCmd(cmd)
  if (isArgumentFallback && new RegExp(`^\\s*${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`).test(text)) {
    return text
  }
  return c?.insert ?? `${c?.cmd || ''} `
}

const slashCommandProgressiveFilter = (c, nextText = '') => {
  if (c?.cmd === '/review <request>') return 'review '
  if (c?.cmd === '/continue') return 'continue '
  if (c?.cmd === '/improve') return 'improve '
  if (c?.cmd === '/effort') return 'effort '
  if (c?.cmd === '/workspace <path>') return 'workspace '
  if (c?.cmd === '/ultraplan <goal>') return 'ultraplan '
  const text = String(nextText || '').trimStart()
  if (text === '/review') return 'review '
  if (text === '/continue') return 'continue '
  if (text === '/improve') return 'improve '
  if (text === '/effort') return 'effort '
  if (text === '/workspace') return 'workspace '
  if (text === '/ultraplan') return 'ultraplan '
  return ''
}

export const slashCommandNextDrawer = (c, nextText = '') => {
  const filter = slashCommandProgressiveFilter(c, nextText)
  return filter ? { open:true, filter, selectedIdx:0 } : { open:false, filter:'', selectedIdx:0 }
}
