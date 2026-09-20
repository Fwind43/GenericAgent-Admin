import React, { useEffect, useState } from 'react'
import { FolderCog, Globe2, KeyRound, Palette, Power, Save, ShieldAlert, Wifi } from 'lucide-react'
import './general-workbench.css'
import { UiSurface } from '../ui/UiHost'
import { DefaultGeneralSettings } from '../ui/generalSettings.jsx'
import { generalSettingsModels } from '../ui/generalSettings.js'
import ThemeColorEditor from '../ThemeColorEditor'
import ThemePicker from '../ThemePicker'
import { api } from '../lib/api'
import { confirmDanger } from '../lib/danger'
import { SettingFooter, SettingNote, SettingRow, SettingToggle, SettingsPage, SettingsSection } from '../components/settings'

// Fields that belong to the config file this page edits. Everything else in the
// config object is owned by the backend and must survive a save untouched.
const CONFIG_FIELDS = ['ga_root', 'python_path', 'chat_data_dir', 'proxy_mode', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'github_mirror', 'remote_access', 'remote_allow_anonymous', 'port']

export const configDirty = (draft, saved) => {
  if (!draft || !saved) return false
  return CONFIG_FIELDS.some(field => String(draft[field] || '') !== String(saved[field] || ''))
}

const PROXY_MODES = ['off', 'system', 'custom']
const MIN_PASSWORD_LENGTH = 8

// RemoteAccessSection owns the auth status and password form so the rest of
// the settings page stays a pure config editor. Listen-address and password
// state come from their own endpoints, not from the config draft.
function RemoteAccessSection({ text, t, cfg, patch, dirty, onSave, busy }) {
  const [auth, setAuth] = useState(null)
  const [listen, setListen] = useState(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [note, setNote] = useState(null)

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
    setNote(null)
    if (newPassword !== confirmPassword) { setNote({ tone: 'warn', message: text.remote.passwordMismatch }); return }
    if (newPassword.length < MIN_PASSWORD_LENGTH) { setNote({ tone: 'warn', message: text.remote.passwordTooShort }); return }
    if (!await confirmDanger('auth-password', text.remote.confirmSet)) return
    setPasswordBusy(true)
    try {
      await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword, confirmPassword }) })
      setAuth(previous => ({ ...(previous || {}), passwordSet: true }))
      clearPasswordForm()
      setNote({ tone: 'info', message: text.remote.passwordSaved })
    } catch (e) { setNote({ tone: 'warn', message: e.message }) } finally { setPasswordBusy(false) }
  }

  const removePassword = async () => {
    setNote(null)
    if (!await confirmDanger('auth-password-remove', text.remote.confirmRemove)) return
    setPasswordBusy(true)
    try {
      await api('/api/auth/password', { method: 'DELETE' })
      setAuth(previous => ({ ...(previous || {}), passwordSet: false }))
      clearPasswordForm()
      setNote({ tone: 'info', message: text.remote.passwordRemoved })
    } catch (e) { setNote({ tone: 'warn', message: e.message }) } finally { setPasswordBusy(false) }
  }

  const passwordHint = managed ? text.remote.passwordManagedByEnv : (passwordSet ? text.remote.passwordSet : text.remote.passwordNotSet)

  return <SettingsSection title={text.remote.title} description={text.remote.desc} icon={<Wifi size={17}/>}>
    {listen?.address && <p className="set-path">{text.remote.listening}<code>{listen.address}</code></p>}
    <SettingToggle
      id="settings-remote-access"
      checked={remoteOn}
      onChange={value => patch('remote_access', value)}
      label={text.remote.toggle}
      hint={text.remote.toggleHelp}
      onText={text.remote.on}
      offText={text.remote.off}
    />
    {remoteOn && <>
      <SettingRow label={text.remote.port} hint={text.remote.portHelp} htmlFor="settings-remote-port">
        <input
          id="settings-remote-port"
          type="number"
          min="1"
          max="65535"
          value={cfg?.port || ''}
          onChange={e => patch('port', e.target.value === '' ? 0 : (Number(e.target.value) || 0))}
        />
      </SettingRow>
      <SettingToggle
        id="settings-remote-password-required"
        checked={passwordRequired}
        onChange={value => patch('remote_allow_anonymous', !value)}
        label={text.remote.passwordRequired}
        hint={text.remote.passwordRequiredHelp}
        onText={text.remote.on}
        offText={text.remote.off}
      />
      {!passwordRequired && <SettingNote tone="warn" icon={<ShieldAlert size={14}/>}>{text.remote.anonymousWarning}</SettingNote>}
      {passwordRequired && auth && !passwordSet && !managed && <SettingNote tone="warn" icon={<KeyRound size={14}/>}>{text.remote.needPasswordFirst}</SettingNote>}
    </>}

    <SettingRow label={text.remote.password} hint={passwordHint} stacked>
      {!managed && <div className="set-password-form">
        {passwordSet && <span className="set-password-user">{text.remote.username}: <code>{auth?.username || 'admin'}</code></span>}
        {passwordSet && <input type="password" autoComplete="current-password" placeholder={text.remote.currentPassword} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}/>}
        <input type="password" autoComplete="new-password" placeholder={text.remote.newPassword} value={newPassword} onChange={e => setNewPassword(e.target.value)}/>
        <input type="password" autoComplete="new-password" placeholder={text.remote.confirmPassword} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}/>
        <div className="set-password-actions">
          <button type="button" className="primary" onClick={submitPassword} disabled={passwordBusy || !newPassword || !confirmPassword || (passwordSet && !currentPassword)}>
            <KeyRound size={15}/>{passwordSet ? text.remote.changePassword : text.remote.setPassword}
          </button>
          {passwordSet && <button type="button" onClick={removePassword} disabled={passwordBusy}>{text.remote.removePassword}</button>}
        </div>
      </div>}
    </SettingRow>
    {note && <SettingNote tone={note.tone}>{note.message}</SettingNote>}

    <SettingFooter>
      <SettingNote tone="muted" icon={<ShieldAlert size={14}/>}>{text.remote.restartNote}</SettingNote>
      <span role="status" aria-live="polite" className={`set-dirty ${dirty ? 'is-dirty' : ''}`}>{dirty ? text.unsaved : text.saved}</span>
      <button className="primary" type="button" onClick={onSave} disabled={busy || !cfg || !dirty}><Save size={15}/>{busy ? t.busy : text.saveChanges}</button>
    </SettingFooter>
  </SettingsSection>
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
  const groups = ['appearance', 'paths', 'network', 'remote', 'startup']
  return <SettingsPage className="general-workbench">
    <nav className="general-index" aria-label={lang === 'zh' ? '设置分组' : 'Settings groups'}>
      {groups.map(id => <button key={id} type="button" aria-current={group === id ? 'true' : undefined} aria-controls={`general-${id}`} onClick={() => setGroup(id)}>{text[id].title}</button>)}
      <p role="status">{dirty ? text.unsaved : text.saved}</p>
    </nav>
    <div className="general-detail">
    <SettingsSection id="general-appearance" hidden={group !== 'appearance'} title={text.appearance.title} description={`${text.appearance.desc} ${lang === 'en' ? 'Changes apply immediately.' : '更改立即生效。'}`} icon={<Palette size={17}/>}>
      <SettingRow label={text.appearance.language} hint={text.appearance.languageHelp}>
        <div className="set-segmented" role="group" aria-label={t.language}>
          <button type="button" aria-pressed={lang === 'zh'} className={lang === 'zh' ? 'is-active' : ''} onClick={()=>onLanguage('zh')}>中文</button>
          <button type="button" aria-pressed={lang === 'en'} className={lang === 'en' ? 'is-active' : ''} onClick={()=>onLanguage('en')}>English</button>
        </div>
      </SettingRow>
      <SettingRow label={text.appearance.theme} hint={text.appearance.themeHelp}>
        <ThemePicker value={theme} onChange={setTheme} lang={lang}/>
      </SettingRow>
      <ThemeColorEditor theme={theme} lang={lang} active={group === 'appearance'} />
      <SettingFooter>
        <SettingNote tone="muted">
          {text.appearance.fontAttribution}{' '}
          <a href="/fonts/misans/MiSans-License.pdf" target="_blank" rel="noreferrer">{text.appearance.fontLicense}</a>
        </SettingNote>
      </SettingFooter>
    </SettingsSection>

    {['paths', 'network', 'startup'].map(id => {
      const viewProps = { model: models[id], actions: actions[id], hidden: group !== id }
      return <UiSurface key={id} name={`admin.settings.${id}`} viewProps={viewProps} fallback={<DefaultGeneralSettings {...viewProps}/>}/>
    })}

    <div id="general-remote" hidden={group !== 'remote'}><RemoteAccessSection text={text} t={t} cfg={cfg} patch={patch} dirty={dirty} onSave={onSave} busy={busy}/></div>


    <div hidden={group !== 'appearance'}>
      <SettingFooter>
        <SettingNote tone="muted" icon={<ShieldAlert size={14}/>}>{text.confirmNote}</SettingNote>
        <span role="status" aria-live="polite" className={`set-dirty ${dirty ? 'is-dirty' : ''}`}>{dirty ? text.unsaved : text.saved}</span>
        <button className="primary" type="button" onClick={onSave} disabled={busy || !cfg || !dirty}><Save size={15}/>{busy ? t.busy : text.saveChanges}</button>
      </SettingFooter>
    </div>
  </div>
  </SettingsPage>
}

export default GeneralPage
