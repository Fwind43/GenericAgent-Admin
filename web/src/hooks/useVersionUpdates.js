import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import {
  VERSION_RELOAD_DELAY_MS,
  VERSION_RELOAD_RETRY_MS,
  beginVersionRestartGrace,
  shouldAdoptStatusCheck,
  shouldReloadAfterVersionUpdate,
  shouldReportVersionPollError,
  versionMatchesExpectedRelease,
} from '../lib/versionUpdatePolling'

// GA Admin releases, GA source status, and the login autostart entry. These
// three all answer "is this install current and how does it come up". Pulling
// the GA source is deliberately absent: GA updates itself from `/update`.
export function useVersionUpdates({ t, lang, setMsg, setBusy, active = true }) {
  const [info, setInfo] = useState(null)
  const [check, setCheck] = useState(null)
  const [status, setStatus] = useState(null)
  const [busy, setVersionBusy] = useState(false)
  const [gitBusy, setGitBusy] = useState(false)
  const [gitStatus, setGitStatus] = useState(null)
  const [autostart, setAutostart] = useState(null)
  const restartGraceUntil = useRef(0)
  const needsReload = useRef(false)
  const observedRunning = useRef(false)

  const refreshStatus = async () => {
    const d = await api('/api/version/status')
    setStatus(d)
    if (shouldAdoptStatusCheck(d)) setCheck(d.check)
    if (d?.running) observedRunning.current = true
    return d
  }

  // Loaded alongside the workspace boot sequence so the shell can render the
  // version card without a second round trip. The local git status comes along
  // because it decides whether the GA source card applies at all.
  const loadSnapshot = async () => {
    const [auto, ver, stat, git] = await Promise.all([
      api('/api/autostart/status').catch(e => ({ supported:false, enabled:false, error:e.message })),
      api('/api/version/info').catch(e => ({ error:e.message })),
      api('/api/version/status').catch(() => null),
      api('/api/ga/git-status').catch(() => ({ available: false, reason: 'unreachable' })),
    ])
    setAutostart(auto)
    setInfo(ver)
    setGitStatus(git)
    if (stat?.id || stat?.stage) setStatus(stat)
    return { autostart: auto, info: ver, status: stat, gitStatus: git }
  }

  useEffect(() => {
    if (!active) return undefined
    let stopped = false
    const tick = async () => {
      try {
        const d = await refreshStatus()
        if (needsReload.current && shouldReloadAfterVersionUpdate(d, observedRunning.current)) {
          const current = await api('/api/version/info')
          const expected = d?.check?.latest?.tag_name || check?.latest?.tag_name || ''
          if (versionMatchesExpectedRelease(current?.version, expected)) {
            needsReload.current = false
            setTimeout(() => window.location.reload(), VERSION_RELOAD_DELAY_MS)
            return
          }
        }
        if (!stopped && (d?.running || needsReload.current)) setTimeout(tick, VERSION_RELOAD_RETRY_MS)
      } catch (err) {
        if (shouldReportVersionPollError(restartGraceUntil.current)) console.error('Version status poll error:', err)
        if (!stopped) setTimeout(tick, VERSION_RELOAD_RETRY_MS)
      }
    }
    tick()
    return () => { stopped = true }
  }, [check, status?.running, active])

  useEffect(() => {
    if (!active || !status?.running) return undefined
    const timer = setInterval(() => refreshStatus().catch(e => {
      if (shouldReportVersionPollError(restartGraceUntil.current)) setMsg(e.message)
    }), VERSION_RELOAD_RETRY_MS)
    return () => clearInterval(timer)
  }, [status?.running, active])

  const checkVersion = async () => {
    setVersionBusy(true)
    try {
      const d = await api('/api/version/check')
      setCheck(d)
      setMsg(d.update ? t.overview.versionFound(d.latest?.tag_name || '') : t.overview.versionCurrent)
    } catch (e) { setMsg(e.message) } finally { setVersionBusy(false) }
  }

  const updateVersion = async () => {
    if (!await confirmDanger('version-update', t.overview.versionUpdateConfirm)) return
    setVersionBusy(true)
    try {
      const d = await api('/api/version/update', { dangerous:true, method:'POST', body:'{}' })
      setStatus(d)
      setMsg(t.overview.updateQueued)
    } catch (e) {
      setMsg(e.message)
    } finally { setVersionBusy(false) }
  }

  const restartVersion = async () => {
    if (!status?.id || status?.stage !== 'ready') return
    if (!await confirmDanger('version-restart', t.overview.versionRestartConfirm)) return
    setVersionBusy(true)
    try {
      restartGraceUntil.current = beginVersionRestartGrace()
      needsReload.current = true
      const d = await api('/api/version/restart', {
        dangerous: true,
        method: 'POST',
        body: JSON.stringify({ operation_id: status.id }),
      })
      setStatus(d)
      setMsg(t.overview.versionRestarting)
    } catch (e) {
      restartGraceUntil.current = 0
      needsReload.current = false
      setMsg(e.message)
    } finally { setVersionBusy(false) }
  }

  const checkSource = async () => {
    setGitBusy(true); setMsg('')
    try {
      const d = await api('/api/ga/git-status?remote=1')
      setGitStatus(d)
      setMsg(d.available === false
        ? t.overview.sourceUnavailableMessage
        : (d.upstream_configured === false
            ? t.overview.sourceMissingMessage
            : (d.latest ? t.overview.sourceCurrentMessage : t.overview.sourceBehindMessage(d.behind || 0))))
    } catch (e) { setGitStatus({ ok:false, error:e.message }); setMsg(e.message) } finally { setGitBusy(false) }
  }

  const toggleAutostart = async () => {
    const next = !autostart?.enabled
    const prompt = lang === 'zh'
      ? (next ? '启用 GA Admin 开机自启动？' : '禁用 GA Admin 开机自启动？')
      : (next ? 'Enable GA Admin at login?' : 'Disable GA Admin at login?')
    if (!await confirmDanger('admin-autostart', prompt)) return
    setBusy(true); setMsg('')
    try {
      const d = await api(next ? '/api/autostart/enable' : '/api/autostart/disable', { dangerous:true, method:'POST' })
      setAutostart(d)
      setMsg(t.hints.autostartChanged)
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  return {
    info, check, status, busy, gitBusy, gitStatus, autostart,
    loadSnapshot, refreshStatus, checkVersion, updateVersion, restartVersion, checkSource, toggleAutostart,
  }
}
