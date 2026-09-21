import React, { useEffect, useRef, useState } from 'react'
import './general-workbench.css'
import { UiSurface } from '../ui/UiHost'
import { DefaultGeneralSettings } from '../ui/generalSettings.jsx'
import { generalSettingsModels } from '../ui/generalSettings.js'
import { useThemeColorController } from '../ThemeColorEditor'
import { THEMES } from '../themes'
import { DefaultAppearanceSettings } from '../ui/appearanceSettings'
import { DefaultRemoteSettings } from '../ui/remoteSettings'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { SettingsPage } from '../components/settings'

// Fields that belong to the config file this page edits. Everything else in the
// config object is owned by the backend and must survive a save untouched.
const CONFIG_FIELDS = ['ga_root', 'python_path', 'chat_data_dir', 'proxy_mode', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'github_mirror', 'remote_access', 'remote_allow_anonymous', 'port']

export const configDirty = (draft, saved) => {
  if (!draft || !saved) return false
  return CONFIG_FIELDS.some(field => String(draft[field] || '') !== String(saved[field] || ''))
}

const MIN_PASSWORD_LENGTH = 8

// RemoteAccessSection owns the auth status and password form so the rest of
// the settings page stays a pure config editor. Listen-address and password
// state come from their own endpoints, not from the config draft.
function RemoteAccessSection({ text, t, cfg, patch, dirty, onSave, busy, hidden }) {
  const [auth, setAuth] = useState(null)
  const [listen, setListen] = useState(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [note, setNote] = useState(null)
  const pending = useRef(false)

  useEffect(() => {
    let cancelled = false
    api('/api/auth/status').then(data => { if (!cancelled) setAuth(data) }).catch(() => {})
    api('/api/health').then(data => { if (!cancelled) setListen(data?.listen || null) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const remoteOn = !!cfg?.remote_access
  const passwordRequired = !cfg?.remote_allow_anonymous
  const managed = !!auth?.managedByEnvironment
  const passwordSet = !!auth?.passwordSet

  const clearPasswordForm = () => { setCurrentPassword(''); setNewPassword(''); setConfirmPassword('') }

  const submitPassword = async () => {
    if (busy || pending.current || !auth || managed || !newPassword || !confirmPassword || (passwordSet && !currentPassword)) return
    setNote(null)
    if (newPassword !== confirmPassword) { setNote({ tone: 'warn', message: text.remote.passwordMismatch }); return }
    if (newPassword.length < MIN_PASSWORD_LENGTH) { setNote({ tone: 'warn', message: text.remote.passwordTooShort }); return }
    pending.current = true
    setPasswordBusy(true)
    try {
      if (!await confirmDanger('auth-password', text.remote.confirmSet)) return
      await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword, confirmPassword }) })
      setAuth(previous => ({ ...(previous || {}), passwordSet: true }))
      clearPasswordForm()
      setNote({ tone: 'info', message: text.remote.passwordSaved })
    } catch (e) { setNote({ tone: 'warn', message: e.message }) } finally { pending.current = false; setPasswordBusy(false) }
  }

  const removePassword = async () => {
    if (busy || pending.current || !auth || managed || !passwordSet) return
    pending.current = true
    setNote(null)
    setPasswordBusy(true)
    try {
      if (!await confirmDanger('auth-password-remove', text.remote.confirmRemove)) return
      await api('/api/auth/password', { method: 'DELETE' })
      setAuth(previous => ({ ...(previous || {}), passwordSet: false }))
      clearPasswordForm()
      setNote({ tone: 'info', message: text.remote.passwordRemoved })
    } catch (e) { setNote({ tone: 'warn', message: e.message }) } finally { pending.current = false; setPasswordBusy(false) }
  }

  const passwordHint = managed ? text.remote.passwordManagedByEnv : (passwordSet ? text.remote.passwordSet : text.remote.passwordNotSet)

  const disabled = busy || passwordBusy
  const canSubmitPassword = !!auth && !managed && !disabled && !!newPassword && !!confirmPassword && (!passwordSet || !!currentPassword)
  const model = { text: { remote: { ...text.remote }, confirmNote: text.confirmNote, unsaved: text.unsaved, saved: text.saved, saveChanges: text.saveChanges }, t: { busy: t.busy },
    remoteOn, passwordRequired, managed, passwordSet, passwordHint, authLoaded: !!auth,
    listenAddress: listen?.address || '', username: auth?.username || 'admin', port: cfg?.port || '',
    currentPassword, newPassword, confirmPassword, note, dirty, busy, disabled,
    canSave: !disabled && !!cfg && dirty, canSubmitPassword, canRemovePassword: !!auth && !managed && passwordSet && !disabled }
  const editable = () => !busy && !pending.current
  const actions = {
    changeRemote: value => { if (editable() && typeof value === 'boolean') patch('remote_access', value) },
    changePort: value => { if (editable() && (value === '' || /^\d+$/.test(String(value)))) patch('port', value === '' ? 0 : Number(value)) },
    requirePassword: value => { if (editable() && typeof value === 'boolean') patch('remote_allow_anonymous', !value) },
    changeCurrentPassword: value => { if (editable() && !managed && typeof value === 'string') setCurrentPassword(value) },
    changeNewPassword: value => { if (editable() && !managed && typeof value === 'string') setNewPassword(value) },
    changeConfirmPassword: value => { if (editable() && !managed && typeof value === 'string') setConfirmPassword(value) },
    submitPassword, removePassword, save: () => { if (editable() && cfg && dirty) return onSave() },
  }
  const viewProps = { model, actions, hidden }
  return <UiSurface name="admin.settings.remote" viewProps={viewProps} fallback={<DefaultRemoteSettings {...viewProps}/>}/>
}

export function GeneralPage({
  t, lang, text, cfg, setCfg, root, setRoot, savedCfg, onSave, busy,
  theme, setTheme, onLanguage, autostart, onToggleAutostart,
}) {
  const dirty = configDirty({ ...(cfg || {}), ga_root: root }, savedCfg)
  const patch = (field, value) => setCfg({ ...(cfg || {}), [field]: value })

  const models = generalSettingsModels({ cfg, root, text, t, dirty, busy, autostart })
  const edit = (field, value) => { if (!busy) patch(field, value) }
  const save = () => { if (!busy && cfg && dirty) return onSave() }
  const actions = {
    paths: { save, changeRoot: value => { if (!busy) setRoot(value) }, changePython: value => edit('python_path', value), changeChatData: value => edit('chat_data_dir', value) },
    network: { save, changeProxyMode: value => { if (['off', 'system', 'custom'].includes(value)) edit('proxy_mode', value) }, changeHttpProxy: value => edit('http_proxy', value), changeHttpsProxy: value => edit('https_proxy', value), changeAllProxy: value => edit('all_proxy', value), changeNoProxy: value => edit('no_proxy', value), changeMirror: value => edit('github_mirror', value) },
    startup: { save, toggleAutostart: () => { if (!busy && autostart?.supported) return onToggleAutostart() } },
  }
  const [group, setGroup] = useState('appearance')
  const colors = useThemeColorController({ theme, lang, active: group === 'appearance', disabled: busy })
  const appearanceProps = {
    hidden: group !== 'appearance',
    model: { text: { ...text.appearance }, lang, theme, disabled: busy || colors.model.busy, colors: colors.model,
      themes: THEMES.map(item => ({ id: item.id, label: item.label[lang] || item.label.en, description: item.description[lang] || item.description.en, preview: [...item.preview] })),
      confirmNote: text.confirmNote, status: dirty ? text.unsaved : text.saved,
      canSave: !busy && !!cfg && dirty, saveLabel: busy ? t.busy : text.saveChanges },
    actions: { colors: colors.actions, save,
      changeLanguage: value => { if (!busy && !colors.model.busy && ['zh', 'en'].includes(value)) onLanguage(value) },
      changeTheme: value => { if (!busy && !colors.model.busy && THEMES.some(item => item.id === value)) setTheme(value) } },
  }
  const groups = ['appearance', 'paths', 'network', 'remote', 'startup']
  return <SettingsPage className="general-workbench">
    <nav className="general-index" aria-label={lang === 'zh' ? '设置分组' : 'Settings groups'}>
      {groups.map(id => <button key={id} type="button" aria-current={group === id ? 'true' : undefined} aria-controls={`general-${id}`} onClick={() => setGroup(id)}>{text[id].title}</button>)}
      <p role="status">{dirty ? text.unsaved : text.saved}</p>
    </nav>
    <div className="general-detail">
    <UiSurface name="admin.settings.appearance" viewProps={appearanceProps} fallback={<DefaultAppearanceSettings {...appearanceProps}/>}/>

    {['paths', 'network', 'startup'].map(id => {
      const viewProps = { model: models[id], actions: actions[id], hidden: group !== id }
      return <UiSurface key={id} name={`admin.settings.${id}`} viewProps={viewProps} fallback={<DefaultGeneralSettings {...viewProps}/>}/>
    })}

    <RemoteAccessSection hidden={group !== 'remote'} text={text} t={t} cfg={cfg} patch={patch} dirty={dirty} onSave={onSave} busy={busy}/>
  </div>
  </SettingsPage>
}

export default GeneralPage
