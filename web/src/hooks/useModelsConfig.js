import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { safeJson } from '../lib/format'
import {
  applyProviderOrder,
  draftChangeSummary,
  migrateFailoverGroupNames,
  normalizeFailoverGroups,
  orderedProviderProfiles,
  officialModelSlots,
} from '../lib/modelsEditor'

// mykey.py provider/model editor state.
//
// Everything the user changes — fields, models, provider order, call order,
// failover groups — lands in one draft and stays there until saveAll writes
// it. Nothing else touches the file, so there is exactly one moment where the
// page's contents become the file's contents, and "重新读取" is always a way
// back out.
export function useModelsConfig({ t, lang, setMsg, setBusy, active, onPersist }) {
  const [officialSlots, setOfficialSlots] = useState({})
  const [profiles, setProfiles] = useState([])
  const [failoverGroups, setFailoverGroups] = useState([])
  const [persistedProfiles, setPersistedProfiles] = useState([])
  const [persistedFailoverGroups, setPersistedFailoverGroups] = useState([])
  const [preview, setPreview] = useState('')
  const [saveState, setSaveState] = useState({ status: 'idle', error: '', savedAt: null })
  const [importLoading, setImportLoading] = useState(false)
  const [revealedKeys, setRevealedKeys] = useState({})
  const [keyBusy, setKeyBusy] = useState({})
  const [instance, setInstance] = useState(null)
  const importAttempted = useRef(false)
  const clientIdSeed = useRef(0)

  const instanceHeaders = () => (instance?.id ? { 'X-GA-Instance-ID': instance.id } : {})

  // A profile keeps one id for as long as the page is open, so revealed keys
  // and list animations survive renames and reordering.
  const withClientIds = list => list.map(profile => (
    profile.client_id ? profile : { ...profile, client_id: `provider-${++clientIdSeed.current}` }
  ))

  const getProfileKey = (idx, profile) => profile?.client_id || `provider-index-${idx}`

  const changes = useMemo(
    () => draftChangeSummary(profiles, persistedProfiles, failoverGroups, persistedFailoverGroups),
    [profiles, persistedProfiles, failoverGroups, persistedFailoverGroups],
  )

  const importModels = async ({ quiet = false } = {}) => {
    if (!quiet) setBusy(true)
    setImportLoading(true)
    try {
      const d = await api('/api/models/import-mykey', { method:'POST', headers: instanceHeaders(), body: JSON.stringify({ reveal:false, save:false }) })
      const nextProfiles = withClientIds(orderedProviderProfiles(d.profiles || []))
      const nextGroups = normalizeFailoverGroups(migrateFailoverGroupNames(d.failover_groups || []))
      let slots = {}
      try {
        const state = await api('/api/chat/state', { headers: instanceHeaders() })
        slots = officialModelSlots(nextProfiles, nextGroups, state.llms || [])
      } catch { /* Unavailable official list must not become invented indices. */ }
      setOfficialSlots(slots)
      setProfiles(nextProfiles)
      setPersistedProfiles(nextProfiles)
      setFailoverGroups(nextGroups)
      setPersistedFailoverGroups(nextGroups)
      setSaveState({ status: 'idle', error: '', savedAt: null })
      setRevealedKeys({})
      setKeyBusy({})
      setPreview(safeJson(d))
      setMsg(`Loaded ${nextProfiles.length} profiles`)
    } catch (e) { setMsg(e.message) } finally { setImportLoading(false); if (!quiet) setBusy(false) }
  }

  useEffect(() => {
    if (!active || importAttempted.current || profiles.length) return
    importAttempted.current = true
    importModels({ quiet: true })
  }, [active, profiles.length])

  const previewModels = async () => {
    setBusy(true)
    try {
      const d = await api('/api/models/preview', { method:'POST', body: JSON.stringify({ profiles, failover_groups: failoverGroups }) })
      setPreview(d.python || safeJson(d))
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const clearRevealedKey = (idx, profile) => {
    const key = getProfileKey(idx, profile || profiles[idx])
    setRevealedKeys(prev => { const next = { ...prev }; delete next[key]; return next })
    setKeyBusy(prev => { const next = { ...prev }; delete next[key]; return next })
  }

  const discoverModels = async ({ protocol, baseUrl, apiKey, varName } = {}) => {
    const params = new URLSearchParams()
    if (protocol) params.set('protocol', protocol)
    if (baseUrl) params.set('base_url', baseUrl)
    if (apiKey) params.set('api_key', apiKey)
    if (varName) params.set('var_name', varName)
    return api(`/api/models/discover?${params.toString()}`, { headers: instanceHeaders() })
  }

  const revealKey = async (idx, profile, refresh = false) => {
    const profileKey = getProfileKey(idx, profile || profiles[idx])
    if (!refresh && Object.prototype.hasOwnProperty.call(revealedKeys, profileKey)) {
      clearRevealedKey(idx, profile)
      return
    }
    setKeyBusy(prev => ({ ...prev, [profileKey]: true }))
    try {
      const d = await api('/api/models/raw', { dangerous: true, headers: instanceHeaders() })
      const rawProfiles = d?.profiles || []
      // A renamed provider is still stored under its saved name.
      const varName = String(profile?.previous_var_name || profile?.var_name || '').trim()
      const raw = (varName ? rawProfiles.find(p => String(p.var_name || '').trim() === varName) : null) || rawProfiles[idx]
      setRevealedKeys(prev => ({ ...prev, [profileKey]: String(raw?.apikey || profile?.apikey || '').trim() }))
    } catch (e) {
      setMsg(`Failed to reveal model key: ${e.message}`)
    } finally {
      setKeyBusy(prev => ({ ...prev, [profileKey]: false }))
    }
  }

  // saveAll is the only write. Provider order is stamped here because the
  // draft carries it as list position, which is what the user actually
  // dragged.
  const saveAll = async () => {
    if (!await confirmDanger('models-save', lang === 'zh' ? '保存模型配置会更新 mykey.py，并可能覆盖当前启用配置。确认继续？' : 'Saving model configuration updates mykey.py and may overwrite the active configuration. Continue?')) return false
    const nextProfiles = applyProviderOrder(profiles)
    const cleanGroups = normalizeFailoverGroups(failoverGroups)
    setSaveState({ status: 'saving', error: '', savedAt: null })
    setBusy(true)
    try {
      const payload = nextProfiles.map(({ client_id: _clientId, ...profile }) => (
        profile.previous_var_name === profile.var_name
          ? (({ previous_var_name: _renamed, ...rest }) => rest)(profile)
          : profile
      ))
      const d = await api('/api/models/export', { dangerous:true, method:'POST', headers: instanceHeaders(), body: JSON.stringify({ profiles: payload, failover_groups: cleanGroups, overwrite_active:true }) })
      // The saved name is now the stored name, so the rename hint is spent.
      const savedProfiles = nextProfiles.map(({ previous_var_name: _renamed, ...profile }) => profile)
      setProfiles(savedProfiles)
      setPersistedProfiles(savedProfiles)
      setFailoverGroups(cleanGroups)
      setPersistedFailoverGroups(cleanGroups)
      setPreview(safeJson(d))
      setSaveState({ status: 'saved', error: '', savedAt: d.updated_at || new Date().toISOString() })
      setMsg(t.hints.modelsSaved)
      await importModels({ quiet: true })
      onPersist?.()
      return true
    } catch (e) {
      setMsg(e.message)
      setSaveState({ status: 'error', error: e.message, savedAt: null })
      return false
    } finally { setBusy(false) }
  }

  const discardDraft = () => {
    setProfiles(persistedProfiles)
    setFailoverGroups(persistedFailoverGroups)
    setSaveState({ status: 'idle', error: '', savedAt: null })
    setRevealedKeys({})
  }

  const addProfiles = newProfiles => {
    const added = withClientIds(newProfiles)
    setProfiles(current => [...current, ...added])
    return added
  }

  const removeProfile = idx => {
    clearRevealedKey(idx, profiles[idx])
    setProfiles(current => current.filter((_, index) => index !== idx))
  }

  const patchProfile = (idx, patch) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'apikey') || Object.prototype.hasOwnProperty.call(patch, 'var_name')) {
      clearRevealedKey(idx, profiles[idx])
    }
    // Failover members name their provider, so a rename that did not follow
    // them would leave the chain pointing at a provider that no longer exists.
    const before = profiles[idx]?.var_name
    if (patch.var_name !== undefined && before && patch.var_name !== before) {
      setFailoverGroups(groups => groups.map(group => ({
        ...group,
        members: (group.members || []).map(member => (
          member.provider_var_name === before ? { ...member, provider_var_name: patch.var_name } : member
        )),
      })))
    }
    setProfiles(ps => ps.map((p, i) => {
      if (i !== idx) return p
      const next = { ...p, ...patch }
      // Remember the saved name the first time a provider is renamed: the
      // backend needs it to move the definition instead of writing a second
      // one beside it.
      if (patch.var_name !== undefined && patch.var_name !== p.var_name && next.previous_var_name === undefined && p.var_name) {
        next.previous_var_name = p.var_name
      }
      return next
    }))
  }

  // Opening the editor for another GA instance must not inherit the previous
  // instance's drafts or revealed keys.
  const openFor = (nextInstance = null) => {
    setOfficialSlots({})
    setInstance(nextInstance)
    setProfiles([])
    setPersistedProfiles([])
    setFailoverGroups([])
    setPersistedFailoverGroups([])
    setPreview('')
    setSaveState({ status: 'idle', error: '', savedAt: null })
    setRevealedKeys({})
    importAttempted.current = false
  }

  return {
    officialSlots, profiles, setProfiles, persistedProfiles, failoverGroups, setFailoverGroups, preview,
    changes, saveState, importLoading, revealedKeys, keyBusy, instance,
    getProfileKey, importModels, previewModels, discoverModels, revealKey, clearRevealedKey,
    saveAll, discardDraft, addProfiles, removeProfile, patchProfile,
    openFor,
  }
}
