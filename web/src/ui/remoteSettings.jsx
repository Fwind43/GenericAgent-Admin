import React from 'react'
import { KeyRound, Save, ShieldAlert, Wifi } from 'lucide-react'
import { SettingFooter, SettingNote, SettingRow, SettingToggle, SettingsSection } from '../components/settings'

export function DefaultRemoteSettings({ model, actions, hidden }) {
  const { text, t, remoteOn, passwordRequired, managed, passwordSet, passwordHint, currentPassword, newPassword, confirmPassword, note, dirty, busy } = model
  return <SettingsSection id="general-remote" hidden={hidden} title={text.remote.title} description={text.remote.desc} icon={<Wifi size={17}/>}>
    {model.listenAddress && <p className="set-path">{text.remote.listening}<code>{model.listenAddress}</code></p>}
    <fieldset disabled={model.disabled}>
    <SettingToggle
      id="settings-remote-access"
      checked={remoteOn}
      onChange={value => actions.changeRemote(value)}
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
          value={model.port}
          onChange={e => actions.changePort(e.target.value)}
        />
      </SettingRow>
      <SettingToggle
        id="settings-remote-password-required"
        checked={passwordRequired}
        onChange={value => actions.requirePassword(value)}
        label={text.remote.passwordRequired}
        hint={text.remote.passwordRequiredHelp}
        onText={text.remote.on}
        offText={text.remote.off}
      />
      {!passwordRequired && <SettingNote tone="warn" icon={<ShieldAlert size={14}/>}>{text.remote.anonymousWarning}</SettingNote>}
      {passwordRequired && model.authLoaded && !passwordSet && !managed && <SettingNote tone="warn" icon={<KeyRound size={14}/>}>{text.remote.needPasswordFirst}</SettingNote>}
    </>}

    <SettingRow label={text.remote.password} hint={passwordHint} stacked>
      {!managed && <div className="set-password-form">
        {passwordSet && <span className="set-password-user">{text.remote.username}: <code>{model.username}</code></span>}
        {passwordSet && <input type="password" autoComplete="current-password" placeholder={text.remote.currentPassword} value={currentPassword} onChange={e => actions.changeCurrentPassword(e.target.value)}/>}
        <input type="password" autoComplete="new-password" placeholder={text.remote.newPassword} value={newPassword} onChange={e => actions.changeNewPassword(e.target.value)}/>
        <input type="password" autoComplete="new-password" placeholder={text.remote.confirmPassword} value={confirmPassword} onChange={e => actions.changeConfirmPassword(e.target.value)}/>
        <div className="set-password-actions">
          <button type="button" className="primary" onClick={actions.submitPassword} disabled={!model.canSubmitPassword}>
            <KeyRound size={15}/>{passwordSet ? text.remote.changePassword : text.remote.setPassword}
          </button>
          {passwordSet && <button type="button" onClick={actions.removePassword} disabled={!model.canRemovePassword}>{text.remote.removePassword}</button>}
        </div>
      </div>}
    </SettingRow>
    </fieldset>
    {note && <SettingNote tone={note.tone}>{note.message}</SettingNote>}

    <SettingFooter>
      <SettingNote tone="muted" icon={<ShieldAlert size={14}/>}>{text.remote.restartNote}</SettingNote>
      <span role="status" aria-live="polite" className={`set-dirty ${dirty ? 'is-dirty' : ''}`}>{dirty ? text.unsaved : text.saved}</span>
      <button className="primary" type="button" onClick={actions.save} disabled={!model.canSave}><Save size={15}/>{busy ? t.busy : text.saveChanges}</button>
    </SettingFooter>
  </SettingsSection>
}

export function StudioRemoteSettings({ model, actions, hidden }) {
  const text = model.text.remote
  return <section id="general-remote" hidden={hidden} className="ui-studio-settings">
    <header><small>STUDIO / REMOTE ACCESS</small><h3>{text.title}</h3><p>{text.desc}</p></header>
    {model.listenAddress && <p>{text.listening}<code>{model.listenAddress}</code></p>}
    <form onSubmit={e => { e.preventDefault(); actions.save() }}>
      <fieldset disabled={model.disabled}>
        <label><input id="settings-remote-access" type="checkbox" checked={model.remoteOn} onChange={e => actions.changeRemote(e.target.checked)}/>{text.toggle}</label><small>{text.toggleHelp}</small>
        {model.remoteOn && <>
          <label htmlFor="settings-remote-port">{text.port}</label><input id="settings-remote-port" type="number" min="1" max="65535" value={model.port} onChange={e => actions.changePort(e.target.value)}/><small>{text.portHelp}</small>
          <label><input id="settings-remote-password-required" type="checkbox" checked={model.passwordRequired} onChange={e => actions.requirePassword(e.target.checked)}/>{text.passwordRequired}</label><small>{text.passwordRequiredHelp}</small>
          {!model.passwordRequired && <p role="note">{text.anonymousWarning}</p>}
          {model.passwordRequired && model.authLoaded && !model.passwordSet && !model.managed && <p role="note">{text.needPasswordFirst}</p>}
        </>}
      </fieldset>
      <footer><small>{text.restartNote}</small><span role="status">{model.dirty ? model.text.unsaved : model.text.saved}</span><button className="primary" disabled={!model.canSave}>{model.busy ? model.t.busy : model.text.saveChanges}</button></footer>
    </form>
    <h4>{text.password}</h4><p>{model.passwordHint}</p>
    {!model.managed && <form onSubmit={e => { e.preventDefault(); actions.submitPassword() }}>
      <fieldset disabled={model.disabled}>
        {model.passwordSet && <><p>{text.username}: <code>{model.username}</code></p><label>{text.currentPassword}<input type="password" autoComplete="current-password" placeholder={text.currentPassword} value={model.currentPassword} onChange={e => actions.changeCurrentPassword(e.target.value)}/></label></>}
        <label>{text.newPassword}<input type="password" autoComplete="new-password" placeholder={text.newPassword} value={model.newPassword} onChange={e => actions.changeNewPassword(e.target.value)}/></label>
        <label>{text.confirmPassword}<input type="password" autoComplete="new-password" placeholder={text.confirmPassword} value={model.confirmPassword} onChange={e => actions.changeConfirmPassword(e.target.value)}/></label>
      </fieldset>
      <footer><button className="primary" disabled={!model.canSubmitPassword}>{model.passwordSet ? text.changePassword : text.setPassword}</button>{model.passwordSet && <button type="button" disabled={!model.canRemovePassword} onClick={actions.removePassword}>{text.removePassword}</button>}</footer>
    </form>}
    {model.note && <p role={model.note.tone === 'warn' ? 'alert' : 'status'}>{model.note.message}</p>}
  </section>
}
