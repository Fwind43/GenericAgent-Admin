import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Paperclip, Play, RefreshCw, Square, X } from 'lucide-react'
import { api, apiStream } from '../lib/api'
import { fuzzyMatch } from '../lib/format'
import { createStreamDeltaBatcher } from '../lib/chatStream.js'
import { isComposingKeyboardEvent, isPromptSendShortcut } from '../lib/chatComposerKeyboard.js'
import { pollGeneratedChatTitle, shouldPollGeneratedTitle } from '../lib/chatTitlePolling.js'
import { TurnList } from '../components/turns'

const readFileDataURL = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve({ name: file.name, type: file.type || 'application/octet-stream', dataURL: reader.result })
  reader.onerror = () => reject(reader.error || new Error('读取附件失败'))
  reader.readAsDataURL(file)
})

const compactFileSize = (size = 0) => {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`
  return `${size} B`
}

export function ChatPage({ t, slashCommands }) {
  const allCommands = slashCommands || []
  const [sessions, setSessions] = useState([]), [sid, setSid] = useState(''), [messages, setMessages] = useState([])
  const [prompt, setPrompt] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const [files, setFiles] = useState([])
  const [settings, setSettings] = useState({ llm_no: 0 })
  const activeSidRef = useRef('')
  const fileInputRef = useRef(null)
  const promptRef = useRef(null)
  const cmdDrawerRef = useRef(null)
  const selectedCmdRef = useRef(null)
  const [cmdDrawer, setCmdDrawer] = useState({ open: false, filter: '', selectedIdx: 0 })
  const filteredCmds = cmdDrawer.open
    ? allCommands.filter(c => {
      const cmd = String(c.cmd || '').trim()
      return cmd && !cmd.includes(' ') && fuzzyMatch(cmd.slice(1), cmdDrawer.filter)
    })
    : []
  const closeCmdDrawer = () => setCmdDrawer({ open: false, filter: '', selectedIdx: 0 })
  const applyCmd = (cmd, current = prompt) => {
    const raw = String(current || '')
    const rest = raw.startsWith('/') ? raw.replace(/^\/\S*/, '').replace(/^\s+/, '') : raw.trim()
    const next = rest ? `${cmd} ${rest}` : `${cmd} `
    setPrompt(next)
    closeCmdDrawer()
    setTimeout(() => promptRef.current?.focus(), 0)
    return next
  }
  const selectCmd = (cmd) => applyCmd(cmd)

  const loadSessions = async () => {
    const d = await api('/api/chat/sessions')
    const list = d.sessions || []
    setSessions(list)
    if (!activeSidRef.current && d.sessions?.[0]) await openSession(d.sessions[0].id)
    return list
  }
  const openSession = async (id) => {
    const d = await api(`/api/chat/session/${id}`)
    activeSidRef.current = d.id
    setSid(d.id)
    setMessages(d.messages || [])
    setSettings({ llm_no: d.settings?.llm_no || 0 })
  }
  const newSession = async () => {
    if (busy) { setErr('当前正在执行，完成后可创建新会话'); return }
    const d = await api('/api/chat/session/new', { method:'POST', body:'{}' })
    activeSidRef.current = d.id
    setSid(d.id)
    setMessages([])
    setFiles([])
    setSettings({ llm_no: d.settings?.llm_no || 0 })
  }
  useEffect(()=>{ loadSessions().catch(e=>setErr(e.message)) }, [])
  useEffect(() => {
    if (!cmdDrawer.open) return
    const handler = (e) => { if (cmdDrawerRef.current && !cmdDrawerRef.current.contains(e.target)) closeCmdDrawer() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [cmdDrawer.open])
  useLayoutEffect(() => {
    if (!cmdDrawer.open) return
    selectedCmdRef.current?.scrollIntoView({ block: 'nearest' })
  }, [cmdDrawer.open, cmdDrawer.selectedIdx, filteredCmds.length])

  const encodedFiles = useMemo(() => files.map(f => ({ name: f.name, type: f.type, dataURL: f.dataURL })), [files])
  const addFiles = async (list) => {
    const picked = Array.from(list || [])
    if (!picked.length) return
    try {
      const converted = await Promise.all(picked.map(async f => ({ ...(await readFileDataURL(f)), size: f.size })))
      setFiles(fs => [...fs, ...converted].slice(0, 8))
    } catch (e) {
      setErr(e.message || '读取附件失败')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }
  const removeFile = (idx) => setFiles(fs => fs.filter((_, i) => i !== idx))

  const stop = async () => {
    const cur = activeSidRef.current || sid
    if (!cur) return
    try { await api(`/api/chat/${cur}/cancel`, { method:'POST', body:'{}' }) } catch(e) { setErr(e.message) }
  }

  const send = async () => {
    const text = prompt.trim()
    if (text === '/new') {
      setPrompt('')
      await newSession()
      return
    }
    if ((!text && files.length === 0) || busy) return
    let cur = activeSidRef.current || sid
    if (!cur) {
      const d = await api('/api/chat/session/new', { method:'POST', body:'{}' })
      cur = d.id
      activeSidRef.current = d.id
      setSid(cur)
    }
    setPrompt(''); setErr(''); setBusy(true)
    const user = { id: `u-${Date.now()}`, role:'user', content: text || '[附件]', files: files.map(({ dataURL, ...meta }) => meta), created_at: Math.floor(Date.now()/1000) }
    const assistant = { id: `a-${Date.now()}`, role:'assistant', content:'', created_at: Math.floor(Date.now()/1000) }
    setMessages(ms => [...ms, user, assistant])
    const sendFiles = encodedFiles
    setFiles([])
    try {
      const res = await apiStream(`/api/chat/${cur}`, {
        method:'POST',
        body: JSON.stringify({ prompt: text, files: sendFiles, settings, client_user_id: user.id })
      })
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      const supportsAnimationFrame = typeof window.requestAnimationFrame === 'function'
      const deltaBatcher = createStreamDeltaBatcher({
        onFlush: chunk => setMessages(ms => ms.map(m => m.id === assistant.id ? {...m, content:(m.content || '') + chunk} : m)),
        schedule: callback => supportsAnimationFrame ? window.requestAnimationFrame(callback) : window.setTimeout(callback, 16),
        cancel: handle => supportsAnimationFrame ? window.cancelAnimationFrame(handle) : window.clearTimeout(handle),
      })
      let terminalEvent = null
      const consumeEvent = (ev) => {
        if (ev.type === 'delta') deltaBatcher.push(ev.delta || '')
        if (ev.type === 'ultraplan_event') { setMessages(ms => ms.map(m => m.id === assistant.id ? {...m, ultraplan: ev.state} : m)) }
        if (ev.type === 'ultraplan_output') {
          setMessages(ms => ms.map(m => {
            if (m.id !== assistant.id) return m
            const taskOutputs = m.task_outputs || {}
            const existing = taskOutputs[ev.task_id] || []
            return {...m, task_outputs: {...taskOutputs, [ev.task_id]: [...existing, ...(ev.lines || [])]}}
          }))
        }
        if (ev.type === 'notice') setErr(ev.message?.message || ev.message || 'notice')
        if (ev.type === 'done' || ev.type === 'error') terminalEvent = ev
      }
      try {
        while (true) {
          const {value, done} = await reader.read(); if (done) break
          buf += dec.decode(value, {stream:true})
          let idx
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim(); buf = buf.slice(idx+1)
            if (line) consumeEvent(JSON.parse(line))
          }
        }
        buf += dec.decode()
        if (buf.trim()) consumeEvent(JSON.parse(buf.trim()))
        await deltaBatcher.drain()
        if (terminalEvent) {
          setMessages(ms => ms.map(m => {
            if (m.id !== assistant.id) return m
            const nextUltraPlan = terminalEvent.message?.ultraplan || terminalEvent.message?.ultraplan_state || terminalEvent.message?.ultraPlanState || m.ultraplan
            return {...m, ...terminalEvent.message, ultraplan: nextUltraPlan}
          }))
          if (terminalEvent.type === 'error') setErr(terminalEvent.message?.content || 'error')
        }
      } catch (error) {
        deltaBatcher.flushNow()
        throw error
      }
      const refreshedSessions = await loadSessions()
      const refreshedSession = refreshedSessions.find(session => session.id === cur)
      if (shouldPollGeneratedTitle(refreshedSession)) {
        void pollGeneratedChatTitle({
          sessionId:cur,
          loadSessions,
          isActive:sessionId => activeSidRef.current === sessionId,
        }).catch(()=>{})
      }
    } catch(e) {
      setErr(e.message)
      setMessages(ms => ms.map(m => m.id === assistant.id ? {...m, content:`失败：${e.message}`, error:true} : m))
    } finally { setBusy(false) }
  }

  const handlePromptKeyDown = (e) => {
    if (isComposingKeyboardEvent(e)) return
    if (isPromptSendShortcut(e)) {
      e.preventDefault()
      closeCmdDrawer()
      send()
      return
    }
    if (!cmdDrawer.open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCmdDrawer(d => ({ ...d, selectedIdx:Math.min(d.selectedIdx + 1, filteredCmds.length - 1) }))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCmdDrawer(d => ({ ...d, selectedIdx:Math.max(d.selectedIdx - 1, 0) }))
    } else if ((e.key === 'Enter' || e.key === 'Tab') && filteredCmds[cmdDrawer.selectedIdx]) {
      e.preventDefault()
      applyCmd(filteredCmds[cmdDrawer.selectedIdx].cmd, e.currentTarget.value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeCmdDrawer()
    }
  }

  return <section className="chat-shell native-chat">
    <div className="chat-top"><div><h3>{t.nav.chat}</h3><p>Admin 原生对话：由 Go API 管理会话，按需启动 Python GA Worker。</p></div><div className="actions"><button onClick={loadSessions}><RefreshCw size={14}/>{t.refresh}</button><button onClick={newSession}><Play size={14}/>新会话</button><span className="ok">Native</span></div></div>
    {err && <div className="message">{err}</div>}
    <div className="chat-grid"><aside className="chat-sessions"><button className="primary" onClick={newSession}>+ 新会话</button>{sessions.map(s => <button key={s.id} className={s.id===sid?'active':''} onClick={()=>openSession(s.id)}><b>{s.title || '新会话'}</b><small>{s.count || 0} 条</small></button>)}</aside>
      <main className="chat-main"><TurnList messages={messages} empty="选择或创建会话后开始对话"/>
        <div className="chat-settings"><label>LLM <input type="number" min="0" value={settings.llm_no} onChange={e=>setSettings(v => ({...v, llm_no:Number(e.target.value)||0}))}/></label></div>
        {files.length > 0 && <div className="chat-attachments">{files.map((f, i) => <span key={`${f.name}-${i}`}><Paperclip size={13}/>{f.name}<small>{compactFileSize(f.size)}</small><button type="button" onClick={()=>removeFile(i)}><X size={12}/></button></span>)}</div>}
        {cmdDrawer.open && <div className="chat-cmd-drawer" ref={cmdDrawerRef}>{filteredCmds.length === 0 ? <div className="chat-cmd-empty">无匹配命令</div> : filteredCmds.map((c, i) => <div key={c.cmd} ref={i === cmdDrawer.selectedIdx ? selectedCmdRef : null} className={`chat-cmd-item${i === cmdDrawer.selectedIdx ? ' selected' : ''}`} onMouseDown={() => applyCmd(c.cmd, promptRef.current?.value ?? prompt)} onMouseEnter={() => setCmdDrawer(d => ({...d, selectedIdx: i}))}><span className="chat-cmd-name">{c.cmd}</span><span className="chat-cmd-desc">{c.desc}</span></div>)}</div>}
        <div className="chat-compose"><input ref={fileInputRef} type="file" multiple hidden onChange={e=>addFiles(e.target.files)}/><button className="icon" type="button" onClick={()=>fileInputRef.current?.click()} disabled={busy}><Paperclip size={16}/></button><textarea ref={promptRef} value={prompt} onChange={e => { const v = e.target.value; setPrompt(v); if (v.startsWith('/')) { const after = v.slice(1).split(' ')[0]; setCmdDrawer(d => ({ open: true, filter: after, selectedIdx: 0 })); } else if (cmdDrawer.open) closeCmdDrawer() }} onKeyDown={handlePromptKeyDown} placeholder="输入给 GenericAgent 的任务，Enter 换行，Ctrl/⌘+Enter 发送；可附加图片/文件"/><button disabled={busy || (!prompt.trim() && files.length===0)} onClick={send}>{busy?'执行中...':'发送'}</button>{busy && <button className="danger" type="button" onClick={stop}><Square size={14}/>停止</button>}</div>
      </main></div>
  </section>
}
