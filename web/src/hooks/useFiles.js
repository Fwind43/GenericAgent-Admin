import { useState } from 'react'
import { api } from '../lib/api'
import { downloadFile as fetchDownload } from '../lib/fileDownload.js'
import { confirmDanger } from '../lib/danger'
import { clampTailLines, dirnameForPath, fileEditorDirty } from '../lib/filesSafety'

// GA-root file browser state. Every action reports through fileStatus so the
// page can show a pending/success/error line with a retry for the exact action.
export function useFiles({ t, setMsg, setBusy, onOpen }) {
  const [path, setPath] = useState('memory')
  const [loadedPath, setLoadedPath] = useState('')
  const [list, setList] = useState([])
  const [content, setContent] = useState('')
  const [loadedContent, setLoadedContent] = useState('')
  const [search, setSearch] = useState('')
  const [searchHits, setSearchHits] = useState([])
  const [tailLines, setTailLinesRaw] = useState(200)
  const [status, setStatus] = useState({})

  const setTailLines = (value) => setTailLinesRaw(clampTailLines(value))

  const loadFiles = async (target = '', { quiet = false } = {}) => {
    const next = target || ''
    if (!quiet) {
      setBusy(true)
      setStatus({ kind: 'pending', action: 'browse', message: `Loading files from ${next || 'GA root'}...` })
    }
    try {
      const d = await api(`/api/files/list?path=${encodeURIComponent(next)}`)
      const items = d.items || d.entries || []
      setList(items)
      setPath(next)
      if (!quiet) setStatus({ kind: 'success', action: 'browse', message: `Loaded ${items.length} file entries from ${next || 'GA root'}.` })
      return d
    } catch (e) {
      setList([])
      setMsg(e.message)
      if (!quiet) setStatus({ kind: 'error', action: 'browse', message: `Could not load files: ${e.message}`, onRetry: () => loadFiles(next) })
      throw e
    } finally {
      if (!quiet) setBusy(false)
    }
  }

  const readFile = async (target = path) => {
    if (!target) return
    setBusy(true)
    setStatus({ kind: 'pending', action: 'read', message: `Reading ${target}...` })
    try {
      const d = await api(`/api/files/read?path=${encodeURIComponent(target)}`)
      const text = d.content || ''
      setContent(text)
      setLoadedContent(text)
      setLoadedPath(target)
      setPath(target)
      onOpen?.()
      setStatus({ kind: 'success', action: 'read', message: `Loaded ${target}. You can now edit, review, and save it.` })
    } catch (e) {
      setMsg(e.message)
      setStatus({ kind: 'error', action: 'read', message: `Could not read ${target}: ${e.message}`, onRetry: () => readFile(target) })
    } finally {
      setBusy(false)
    }
  }

  const tailFile = async (target = path) => {
    if (!target) return
    const safeLines = clampTailLines(tailLines)
    setBusy(true)
    setStatus({ kind: 'pending', action: 'tail', message: `Reading the last ${safeLines} lines of ${target}...` })
    try {
      const d = await api(`/api/files/tail?path=${encodeURIComponent(target)}&lines=${safeLines}`)
      const text = d.content || ''
      setContent(text)
      setLoadedContent(text)
      setLoadedPath(target)
      setTailLinesRaw(safeLines)
      setPath(target)
      onOpen?.()
      setStatus({ kind: 'success', action: 'tail', message: `Loaded the last ${safeLines} lines of ${target}.` })
    } catch (e) {
      setMsg(e.message)
      setStatus({ kind: 'error', action: 'tail', message: `Could not tail ${target}: ${e.message}`, onRetry: () => tailFile(target) })
    } finally {
      setBusy(false)
    }
  }

  const saveFile = async () => {
    if (!loadedPath || !path || !fileEditorDirty(content, loadedContent)) return
    if (path !== loadedPath && !await confirmDanger('files-retarget', `Editor content was loaded from ${loadedPath}, but will be saved to ${path}. Continue?`)) return
    if (!await confirmDanger('files-write', `Write file ${path}? This overwrites content and the backend will create a backup.`)) return
    setBusy(true)
    setStatus({ kind: 'pending', action: 'save', message: `Saving ${path}...` })
    try {
      const d = await api('/api/files/write', { dangerous:true, method:'POST', body: JSON.stringify({ path, content }) })
      const savedContent = d.content || content
      const savedPath = path
      setContent(savedContent)
      setLoadedContent(savedContent)
      setLoadedPath(savedPath)
      setMsg(t.hints.fileSaved || 'Saved')
      let refreshWarning = ''
      try { await loadFiles(dirnameForPath(savedPath), { quiet: true }) }
      catch (e) { refreshWarning = ` The file was saved, but the folder list could not refresh: ${e.message}` }
      setPath(savedPath)
      setStatus({ kind: 'success', action: 'save', message: `Saved ${savedPath}.${refreshWarning}` })
    } catch (e) {
      setMsg(e.message)
      setStatus({ kind: 'error', action: 'save', message: `Could not save ${path}: ${e.message}. Your editor changes are still available.`, onRetry: saveFile })
    } finally {
      setBusy(false)
    }
  }

  const discardChanges = () => {
    if (!loadedPath) return
    setContent(loadedContent)
    setPath(loadedPath)
    setStatus({ kind: 'success', action: 'discard', message: `Discarded unsaved editor changes. ${loadedPath} was not modified.` })
  }

  const deleteFile = async (target = path) => {
    if (!target) return
    if (!await confirmDanger('files-delete', `Delete ${target}? This removes the file or directory under GA root.`)) return
    setBusy(true)
    try {
      await api('/api/files/delete', { dangerous:true, method:'POST', body: JSON.stringify({ path: target }) })
      if (target === loadedPath) { setContent(''); setLoadedContent(''); setLoadedPath('') }
      setMsg('Deleted')
      await loadFiles(dirnameForPath(target), { quiet: true })
      setStatus({ kind: 'success', action: 'delete', message: `Deleted ${target}.` })
    } catch (e) {
      setMsg(e.message)
      setStatus({ kind: 'error', action: 'delete', message: `Could not delete ${target}: ${e.message}`, onRetry: () => deleteFile(target) })
    } finally { setBusy(false) }
  }

  const downloadFile = async (target = path) => {
    if (!target) return
    try {
      await fetchDownload(`/api/files/download?path=${encodeURIComponent(target)}`)
    } catch (e) {
      setMsg(e.message)
      setStatus({ kind: 'error', action: 'download', message: e.message, onRetry: () => downloadFile(target) })
    }
  }

  const runSearch = async () => {
    const query = String(search || '').trim()
    if (!query) return
    setBusy(true)
    setStatus({ kind: 'pending', action: 'search', message: `Searching for "${query}"...` })
    try {
      const d = await api(`/api/files/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(query)}&limit=80`)
      const hits = d.hits || []
      setSearchHits(hits)
      setStatus({ kind: 'success', action: 'search', message: hits.length ? `Found ${hits.length} matches for "${query}".` : `No matches found for "${query}".` })
    } catch (e) {
      setMsg(e.message)
      setStatus({ kind: 'error', action: 'search', message: `Search failed: ${e.message}`, onRetry: runSearch })
    } finally {
      setBusy(false)
    }
  }

  return {
    path, setPath, loadedPath, list, content, setContent, loadedContent,
    search, setSearch, searchHits, tailLines, setTailLines,
    status, dismissStatus: () => setStatus({}),
    loadFiles, readFile, tailFile, saveFile, discardChanges, deleteFile, downloadFile, runSearch,
  }
}
