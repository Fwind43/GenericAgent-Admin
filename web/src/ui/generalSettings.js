// Deliberately project only editable display fields, never forward config/auth/API.
export function generalSettingsModels({ cfg, root, text, t, dirty, busy, autostart }) {
  const field = (id, label, value, action, hint = '', placeholder = '', type = 'text') => ({ id, label, value: value || '', action, hint, placeholder, type })
  const common = { dirty, busy: !!busy, canSave: !!cfg && dirty && !busy, saveLabel: busy ? t.busy : text.saveChanges, status: dirty ? text.unsaved : text.saved, confirmNote: text.confirmNote }
  const section = (id, fields) => ({ ...common, id, title: text[id].title, description: text[id].desc, fields })
  const mode = cfg?.proxy_mode || 'off'
  return {
    paths: section('paths', [
      field('settings-ga-root', t.root, root, 'changeRoot', text.paths.rootHelp),
      field('settings-python-path', t.fields.pythonPath, cfg?.python_path, 'changePython', text.paths.pythonHelp, t.fields.pythonAuto),
      field('settings-chat-data', t.fields.chatDataDir, cfg?.chat_data_dir, 'changeChatData', text.paths.dataHelp, t.fields.chatDataAuto),
    ]),
    network: section('network', [
      { ...field('settings-proxy-mode', text.network.mode, mode, 'changeProxyMode', text.network[`${mode}Help`], '', 'select'), options: ['off', 'system', 'custom'].map(value => ({ value, label: text.network[value] })) },
      ...(mode === 'custom' ? [
        field('settings-http-proxy', 'HTTP_PROXY', cfg?.http_proxy, 'changeHttpProxy', '', 'http://127.0.0.1:7890'),
        field('settings-https-proxy', 'HTTPS_PROXY', cfg?.https_proxy, 'changeHttpsProxy', '', 'http://127.0.0.1:7890'),
        field('settings-all-proxy', 'ALL_PROXY', cfg?.all_proxy, 'changeAllProxy', '', 'socks5://127.0.0.1:7890'),
        field('settings-no-proxy', 'NO_PROXY', cfg?.no_proxy, 'changeNoProxy', '', 'localhost,127.0.0.1'),
      ] : []),
      field('settings-github-mirror', text.network.githubMirror, cfg?.github_mirror, 'changeMirror', text.network.githubMirrorHelp, text.network.githubMirrorPlaceholder, 'url'),
    ]),
    startup: { ...section('startup', []), startup: {
      enabled: !!autostart?.enabled, supported: !!autostart?.supported,
      label: t.autostart, hint: autostart?.supported ? text.startup.autostartHelp : t.hints.autostartUnsupported,
      state: autostart?.enabled ? t.enabled : (autostart?.supported ? t.disabled : t.unsupported), path: autostart?.path || '',
    } },
  }
}
