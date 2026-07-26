import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  FileCode2,
  GripVertical,
  Layers,
  ListOrdered,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Collapse, Drawer, Input, Modal, Select, Space, Tag } from 'antd'
import { emptyProfile } from '../lib/format'
import {
  API_MODE_OPTIONS,
  THINKING_TYPE_OPTIONS,
  addModelConfigs,
  modelProtocolFields,
  moveOrderedItem,
  orderedModelRows,
  profileModelConfigs,
  reasoningEffortOptions,
  removeModelConfig,
  updateModelConfig,
} from '../lib/modelsEditor'
import {
  nextProviderVarName,
  providerDisplayName,
  providerVarNameFromDisplayName,
  providerVarNameOnProtocolChange,
} from '../lib/modelsProvider'
import { modelRiskCatalog, modelValidationSummary, validateModelProfiles } from '../lib/modelsValidation'

const DEFAULT_PROTOCOL = 'native_oai'
const OFFICIAL_PROTOCOLS = [
  { value: 'native_oai', label: 'Native OAI（推荐 / OpenAI 兼容）', shortLabel: 'Native OAI', prefix: 'native_oai_config', discover: true, color: 'blue', help: '适合 OpenAI-compatible 接口，新配置优先使用。' },
  { value: 'native_claude', label: 'Native Claude（Anthropic 兼容）', shortLabel: 'Native Claude', prefix: 'native_claude_config', discover: true, color: 'purple', help: '适合 Anthropic-compatible 接口。' },
  { value: 'oai', label: 'OAI / LLMSession（旧协议）', shortLabel: 'OAI', prefix: 'oai_config', discover: true, color: 'cyan', help: 'GenericAgent 旧版 OpenAI 文本协议。' },
  { value: 'claude', label: 'ClaudeSession（旧协议）', shortLabel: 'Claude', prefix: 'claude_config', discover: true, color: 'magenta', help: 'GenericAgent 旧版 Claude 文本协议。' },
]
const LEGACY_PROTOCOLS = [
  ...OFFICIAL_PROTOCOLS,
  { value: 'openai', label: '兼容旧值：openai', shortLabel: 'OpenAI（旧值）', prefix: 'native_oai_config', discover: true, color: 'blue' },
  { value: 'openai-compatible', label: '兼容旧值：openai-compatible', shortLabel: 'OpenAI Compatible（旧值）', prefix: 'native_oai_config', discover: true, color: 'blue' },
  { value: 'chatgpt', label: '兼容旧值：chatgpt', shortLabel: 'ChatGPT（旧值）', prefix: 'oai_config', discover: true, color: 'cyan' },
]

const protocolMeta = (value, t) => {
  const meta = LEGACY_PROTOCOLS.find(item => item.value === value) || OFFICIAL_PROTOCOLS[0]
  const localized = t?.models?.protocols?.[meta.value]
  return localized ? { ...meta, label: localized[0], shortLabel: localized[0], help: localized[1] || meta.help } : meta
}
const protocolLabel = (value, t) => protocolMeta(value, t)?.shortLabel || value || 'Native OAI'
const supportsModelDiscovery = value => !!protocolMeta(value)?.discover
const nextVarName = (protocol, profiles = []) => nextProviderVarName(
  protocolMeta(protocol)?.prefix || 'native_oai_config',
  profiles,
)

const modelIdOf = value => String(value?.id || value?.name || value || '').trim()
const uniqueModels = values => {
  const seen = new Set()
  return (values || []).map(modelIdOf).filter(value => {
    if (!value || seen.has(value)) return false
    seen.add(value)
    return true
  })
}
const profileModels = profile => uniqueModels([...(Array.isArray(profile?.models) ? profile.models : []), profile?.model])
const isMaskedSecret = value => {
  const secret = String(value || '').trim()
  return /^\*{4,}$/.test(secret) || /\*{2,}/.test(secret)
}

function StatusTag({ result, t }) {
  const text = t.models
  if (!result) return null
  const errors = result.errors?.length || 0
  const warnings = result.warnings?.length || 0
  if (errors) return <Tag color="error">{text.blockItems(errors)}</Tag>
  if (warnings) return <Tag color="warning">{text.reminders(warnings)}</Tag>
  return <Tag color="success">{text.valid}</Tag>
}

function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return undefined
  const parsed = Number(value)
  return Number.isNaN(parsed) ? value : parsed
}

function OptionalBoolSelect({ value, onChange, t, trueLabel, falseLabel }) {
  return (
    <Select
      value={value === true || value === false ? value : 'inherit'}
      onChange={next => onChange(next === 'inherit' ? undefined : next)}
      options={[
        { value: 'inherit', label: t.models.inherit },
        { value: true, label: trueLabel || t.enabled },
        { value: false, label: falseLabel || t.disabled },
      ]}
    />
  )
}

function ModelConfigRow({ config, index, protocol, onChange, onRemove, t }) {
  const text = t.models
  const [configOpen, setConfigOpen] = useState(false)
  const fields = modelProtocolFields(protocol)
  const configSummary = [config.api_mode, config.thinking_type, config.reasoning_effort]
    .filter(Boolean)
    .join(' · ') || text.defaultParams

  return (
    <article className={`model-config-row${configOpen ? ' is-open' : ''}`}>
      <div className="model-config-main">
        <div className="model-config-identity">
          <span className="model-config-index" aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className="model-config-copy">
            <span className="model-config-id" title={config.model || ''}>
              {config.model || text.unnamedModel}
            </span>
            <span className="model-config-summary">{configSummary}</span>
          </div>
        </div>
        <Button
          type="text"
          className="model-config-action model-config-toggle"
          onClick={() => setConfigOpen(open => !open)}
          aria-expanded={configOpen}
        >
          <span>{configOpen ? text.collapse : text.configure}</span>
          <ChevronDown size={13} className="model-config-chevron" aria-hidden="true" />
        </Button>
        <Button
          danger
          type="text"
          className="model-config-action model-config-delete"
          icon={<Trash2 size={13} />}
          onClick={onRemove}
          aria-label={text.deleteModel(config.model || index + 1)}
        >
          {t.delete}
        </Button>
      </div>

      {configOpen && (
        <div className="model-row-advanced">
          <div className="model-row-advanced-grid">
            <label className="model-field">
              <span className="model-field-label">{text.stream}</span>
              <OptionalBoolSelect value={config.stream} onChange={stream => onChange({ stream })} t={t} />
            </label>
            <label className="model-field">
              <span className="model-field-label">{text.maxRetries}</span>
              <Input type="number" min={0} value={config.max_retries ?? ''} onChange={event => onChange({ max_retries: optionalNumber(event.target.value) })} placeholder={text.inherit} />
            </label>
            <label className="model-field">
              <span className="model-field-label">{text.readTimeout}</span>
              <Input type="number" min={1} value={config.read_timeout ?? ''} onChange={event => onChange({ read_timeout: optionalNumber(event.target.value) })} placeholder={text.inherit} />
            </label>
            <label className="model-field">
              <span className="model-field-label">{text.connectTimeout}</span>
              <Input type="number" min={1} value={config.connect_timeout ?? ''} onChange={event => onChange({ connect_timeout: optionalNumber(event.target.value) })} placeholder={text.inherit} />
            </label>
            {fields.userAgent && (
              <label className="model-field">
                <span className="model-field-label">User-Agent</span>
                <Input value={config.user_agent || ''} onChange={event => onChange({ user_agent: event.target.value || undefined })} placeholder={text.optional} />
              </label>
            )}
            {fields.apiMode && (
              <label className="model-field">
                <span className="model-field-label">{text.apiMode}</span>
                <Select allowClear value={config.api_mode || undefined} onChange={api_mode => onChange({ api_mode })} placeholder={text.inherit} options={API_MODE_OPTIONS} />
              </label>
            )}
            {fields.thinkingType && (
              <label className="model-field">
                <span className="model-field-label">{text.thinkingType}</span>
                <Select allowClear value={config.thinking_type || undefined} onChange={thinking_type => onChange({ thinking_type })} placeholder={text.inherit} options={THINKING_TYPE_OPTIONS} />
              </label>
            )}
            {fields.reasoningFamily && (
              <label className="model-field">
                <span className="model-field-label">{text.reasoningEffort}</span>
                <Select allowClear value={config.reasoning_effort || undefined} onChange={reasoning_effort => onChange({ reasoning_effort })} placeholder={text.inherit} options={reasoningEffortOptions(protocol)} />
              </label>
            )}
            {fields.fakeClaudeCode && (
              <label className="model-field">
                <span className="model-field-label">{text.fakeClaude}</span>
                <OptionalBoolSelect value={config.fake_cc_system_prompt} onChange={fake_cc_system_prompt => onChange({ fake_cc_system_prompt })} t={t} />
              </label>
            )}
          </div>
        </div>
      )}
    </article>
  )
}

function ModelConfigEditor({ profile, discovered = [], onChange, onDiscover, busy, disabled, discoveryError = '', t }) {
  const text = t.models
  const [draft, setDraft] = useState('')
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const configs = profileModelConfigs(profile)
  const existing = new Set(configs.map(config => modelIdOf(config)))
  const candidates = uniqueModels(discovered).filter(model => !existing.has(model))

  const addModels = values => onChange(addModelConfigs(profile, values))
  const addDraft = () => {
    const model = draft.trim()
    if (!model) return
    addModels([model])
    setDraft('')
  }
  const openDiscover = () => {
    setDiscoverOpen(true)
    onDiscover?.()
  }
  const addCandidates = values => {
    addModels(values)
    if (values.length === candidates.length) setDiscoverOpen(false)
  }

  return (
    <section className="model-config-editor">
      <div className="model-config-toolbar">
        <div className="model-workflow-heading">
          <strong><span>2</span> {text.addModelsStep}</strong>
          <small>{text.addModelsHelp}</small>
        </div>
        <Button onClick={openDiscover} disabled={disabled} loading={busy} icon={<RefreshCw size={14} />}>
          {text.fetchModels}
        </Button>
      </div>

      <div className="model-config-table">
        <div className="model-config-table-head" aria-hidden="true">
          <span>{text.modelId}</span>
          <span>{text.configuration}</span>
          <span>{t.delete}</span>
        </div>
        <div className="model-config-list">
          {configs.length > 0 ? configs.map((config, index) => (
            <ModelConfigRow
              key={index}
              config={config}
              index={index}
              protocol={profile.type || DEFAULT_PROTOCOL}
              onChange={patch => onChange(updateModelConfig(profile, index, patch))}
              onRemove={() => onChange(removeModelConfig(profile, index))}
              t={t}
            />
          )) : <div className="model-config-empty">{text.noModels}</div>}
        </div>
      </div>

      <div className="model-quick-add">
        <Input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onPressEnter={addDraft}
          placeholder={text.manualModel}
          aria-label={text.manualModel}
        />
        <Button icon={<Plus size={14} />} onClick={addDraft} disabled={!draft.trim()}>{text.addModel}</Button>
      </div>

      <Modal
        className="model-discover-modal"
        title={text.fetchModels}
        open={discoverOpen}
        onCancel={() => setDiscoverOpen(false)}
        footer={null}
        width={620}
        destroyOnHidden
      >
        <div className="model-discover-modal-head">
          <span>{busy ? text.fetchingModels : discoveryError ? text.fetchFailed : text.discovered(candidates.length)}</span>
          <Button size="small" type="primary" onClick={() => addCandidates(candidates)} disabled={busy || !!discoveryError || !candidates.length}>
            {text.addAll}
          </Button>
        </div>
        {busy ? (
          <div className="model-discover-modal-state" role="status"><RefreshCw size={18} className="is-spinning" />{text.fetching}</div>
        ) : discoveryError ? (
          <Alert
            type="error"
            showIcon
            message={text.cannotFetch}
            description={discoveryError}
            action={<Button size="small" onClick={onDiscover}>{t.retry}</Button>}
          />
        ) : candidates.length > 0 ? (
          <div className="model-candidate-list">
            {candidates.map(model => (
              <button key={model} type="button" className="model-candidate-item" onClick={() => addCandidates([model])} aria-label={text.addModelAria(model)}>
                <span title={model}>{model}</span>
                <Plus size={14} />
              </button>
            ))}
          </div>
        ) : (
          <div className="model-discover-modal-state" role="status">
            <span>{text.noNewModels}</span>
            <Button size="small" onClick={onDiscover}>{text.refetch}</Button>
          </div>
        )}
      </Modal>
    </section>
  )
}

function ProfileCard({
  profile: p,
  idx,
  profileKey,
  result,
  profiles,
  patchProfile,
  removeProfile,
  discoverModels,
  revealedKey,
  revealBusy,
  onRevealKey,
  onClearRevealedKey,
  onSave,
  saveState,
  t,
}) {
  const text = t.models
  const [discoverBusy, setDiscoverBusy] = useState(false)
  const [discoverError, setDiscoverError] = useState('')
  const [discovered, setDiscovered] = useState([])
  const [dirty, setDirty] = useState(false)
  const selectedModels = profileModels(p)
  const meta = protocolMeta(p.type || DEFAULT_PROTOCOL, t)
  const revealed = revealedKey != null && String(revealedKey).trim() !== '' && !isMaskedSecret(revealedKey)
  const shownApiKey = revealed ? revealedKey : (p.apikey ?? '')
  const saveBusy = saveState?.status === 'saving'
  const saveOk = saveState?.status === 'saved'
  const saveError = saveState?.status === 'error'

  const patch = next => {
    setDirty(true)
    patchProfile(idx, next)
  }

  useEffect(() => {
    if (saveState?.status === 'saved') setDirty(false)
  }, [saveState?.status, saveState?.savedAt])

  const save = async () => {
    const ok = await onSave?.(idx, profileKey)
    if (ok !== false) setDirty(false)
  }

  const discover = async () => {
    if (!supportsModelDiscovery(p.type || DEFAULT_PROTOCOL)) return
    setDiscoverBusy(true)
    setDiscoverError('')
    try {
      const configuredKey = String(p.apikey || '').trim()
      const response = await discoverModels({
        protocol: p.type || DEFAULT_PROTOCOL,
        baseUrl: p.apibase,
        apiKey: configuredKey && !isMaskedSecret(configuredKey) ? configuredKey : undefined,
        varName: p.var_name,
      })
      setDiscovered(response?.models || [])
    } catch (error) {
      setDiscoverError(String(error?.message || error))
    } finally {
      setDiscoverBusy(false)
    }
  }

  return (
    <article className={`model-source-card${dirty ? ' is-dirty' : ''}${result?.errors?.length ? ' has-error' : ''}`}>
      <header className="model-source-head">
        <div className="model-source-identity">
          <span className="model-source-index">{String(idx + 1).padStart(2, '0')}</span>
          <div>
            <div className="model-source-title-row">
              <strong>{providerDisplayName(p.var_name) || text.provider(idx + 1)}</strong>
              <Tag color={meta.color}>{protocolLabel(p.type || DEFAULT_PROTOCOL, t)}</Tag>
              <span className="model-count-badge">{text.modelCount(selectedModels.length)}</span>
            </div>
            <span className="model-source-base">{p.apibase || text.baseMissing}</span>
          </div>
        </div>
        <Space size={8} className="model-source-actions">
          <StatusTag result={result} t={t} />
          {dirty && <span className="model-save-state is-dirty">{text.unsaved}</span>}
          {!dirty && saveOk && <span className="model-save-state is-saved">{text.saved}</span>}
          {saveError && <span className="model-save-state is-error">{text.saveFailed}</span>}
          <Button
            type="primary"
            icon={<CheckCircle2 size={14} />}
            loading={saveBusy}
            disabled={saveBusy || result?.errors?.length > 0}
            onClick={save}
          >
            {t.save}
          </Button>
          <Button danger type="text" icon={<Trash2 size={15} />} onClick={() => removeProfile(idx)} title={text.deleteProviderTitle} />
        </Space>
      </header>

      <div className="model-source-body">
        <div className="model-workflow-heading model-workflow-heading--fields">
          <strong><span>1</span> {text.connectStep}</strong>
          <small>{text.connectHelp}</small>
        </div>
        <div className="model-primary-grid">
          <label className="model-field model-field--provider">
            <span className="model-field-label">{text.name}</span>
            <Input
              value={providerDisplayName(p.var_name)}
              onChange={event => patch({
                var_name: providerVarNameFromDisplayName(
                  event.target.value,
                  meta.prefix,
                  p.var_name,
                ),
              })}
              placeholder={text.nameExample}
            />
            <small>{text.nameHelp}</small>
          </label>
          <label className="model-field">
            <span className="model-field-label">{text.protocol}</span>
            <Select
              value={p.type || DEFAULT_PROTOCOL}
              onChange={value => patch({
                type: value,
                var_name: providerVarNameOnProtocolChange(
                  p.var_name,
                  protocolMeta(value)?.prefix,
                  profiles,
                  idx,
                ),
              })}
              options={OFFICIAL_PROTOCOLS.map(item => protocolMeta(item.value, t))}
            />
          </label>
          <label className="model-field model-field--base">
            <span className="model-field-label">BaseURL</span>
            <Input value={p.apibase || ''} onChange={event => patch({ apibase: event.target.value })} placeholder="https://api.example.com/v1" />
          </label>
          <label className="model-field model-field--key">
            <span className="model-field-label">API Key <em>{revealed ? text.tempShown : text.hiddenByDefault}</em></span>
            <Input
              type={revealed ? 'text' : 'password'}
              value={shownApiKey}
              onChange={event => {
                onClearRevealedKey?.(idx, p, profileKey)
                patch({ apikey: event.target.value })
              }}
              placeholder={text.keyPlaceholder}
              addonAfter={revealed ? (
                <Space size={2}>
                  <Button size="small" type="text" icon={<EyeOff size={14} />} loading={revealBusy} onClick={() => onRevealKey?.(idx, p, false, profileKey)}>{t.hide}</Button>
                  <Button size="small" type="text" icon={<RefreshCw size={13} />} loading={revealBusy} onClick={() => onRevealKey?.(idx, p, true, profileKey)} title={text.reread} aria-label={`${text.reread} API Key`} />
                </Space>
              ) : (
                <Button size="small" type="text" icon={<Eye size={14} />} loading={revealBusy} onClick={() => onRevealKey?.(idx, p, false, profileKey)}>{t.show}</Button>
              )}
            />
          </label>
        </div>

        <ModelConfigEditor
          profile={p}
          discovered={discovered}
          onChange={patch}
          onDiscover={discover}
          busy={discoverBusy}
          disabled={discoverBusy || !p.apibase || !supportsModelDiscovery(p.type || DEFAULT_PROTOCOL)}
          discoveryError={discoverError}
          t={t}
        />

        <div className="model-workflow-heading model-workflow-heading--save">
          <strong><span>3</span> {text.saveStep}</strong>
          <small>{result?.errors?.length ? text.fixBlocks : dirty ? text.dirtyHelp : text.savedHelp}</small>
        </div>
        {saveBusy && <Alert type="info" showIcon message={text.savingProvider} description={text.savingDescription} className="model-inline-alert" />}
        {saveOk && !dirty && <Alert type="success" showIcon message={text.savedMykey} description={text.savedDescription} className="model-inline-alert" />}
        {saveError && (
          <Alert
            type="error"
            showIcon
            message={text.providerSaveFailed}
            description={saveState?.error || text.unknownError}
            action={<Button size="small" onClick={save} disabled={!!result?.errors?.length} loading={saveBusy}>{text.retrySave}</Button>}
            className="model-inline-alert"
          />
        )}
        {result?.errors?.length > 0 && (
          <Alert
            type="error"
            showIcon
            message={text.cannotSave}
            description={<ul>{result.errors.map(key => <li key={key}>{text.errors[key] || key}</li>)}</ul>}
            className="model-inline-alert"
          />
        )}
        {result?.warnings?.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={text.beforeSave}
            description={<ul>{result.warnings.map(key => <li key={key}>{text.errors[key] || key}</li>)}</ul>}
            className="model-inline-alert"
          />
        )}
      </div>
    </article>
  )
}

function AddProfileForm({ profiles, addModelProfiles, t, onClose, onAdded }) {
  const text = t.models
  const [form, setForm] = useState(() => ({
    protocol: DEFAULT_PROTOCOL,
    providerVar: nextVarName(DEFAULT_PROTOCOL, profiles),
    baseUrl: '',
    apiKey: '',
  }))
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const meta = protocolMeta(form.protocol, t)
  const patchForm = next => setForm(current => ({ ...current, ...next }))
  const changeProtocol = protocol => setForm(current => ({
    ...current,
    protocol,
    providerVar: providerVarNameOnProtocolChange(
      current.providerVar,
      protocolMeta(protocol)?.prefix,
      profiles,
    ),
  }))

  const add = async () => {
    const varName = form.providerVar.trim()
    if (!providerDisplayName(varName)) {
      setError(text.nameRequired)
      return
    }
    if (!form.baseUrl.trim()) {
      setError(text.baseRequired)
      return
    }
    setAdding(true)
    setError('')
    try {
      const profile = {
        ...emptyProfile(profiles.length, form.protocol),
        var_name: varName,
        type: form.protocol,
        apibase: form.baseUrl.trim(),
        apikey: form.apiKey,
        model: '',
        models: [],
        model_configs: [],
      }
      const ok = await addModelProfiles([profile])
      if (!ok) return
      setForm({
        protocol: DEFAULT_PROTOCOL,
        providerVar: nextProviderVarName(
          protocolMeta(DEFAULT_PROTOCOL)?.prefix || 'native_oai_config',
          [...profiles, profile],
        ),
        baseUrl: '',
        apiKey: '',
      })
      onAdded?.()
    } finally {
      setAdding(false)
    }
  }

  return (
    <section className="model-add-panel">
      <header className="model-add-head">
        <div>
          <strong>{text.addProvider}</strong>
          <span>{text.addProviderHelp}</span>
        </div>
        <Button type="text" icon={<X size={16} />} onClick={onClose} aria-label={text.closeAdd} />
      </header>
      <div className="model-add-grid">
        <label className="model-field">
          <span className="model-field-label">{text.name}</span>
          <Input
            value={providerDisplayName(form.providerVar)}
            onChange={event => patchForm({
              providerVar: providerVarNameFromDisplayName(
                event.target.value,
                meta.prefix,
                form.providerVar,
              ),
            })}
            placeholder={text.nameExample}
          />
          <small>{text.nameHelp}</small>
        </label>
        <label className="model-field">
          <span className="model-field-label">{text.protocol}</span>
          <Select value={form.protocol} onChange={changeProtocol} options={OFFICIAL_PROTOCOLS.map(item => protocolMeta(item.value, t))} />
          <small>{meta.help}</small>
        </label>
        <label className="model-field model-field--base">
          <span className="model-field-label">BaseURL</span>
          <Input value={form.baseUrl} onChange={event => patchForm({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
        </label>
        <label className="model-field model-field--key">
          <span className="model-field-label">API Key <em>{text.optionalKey}</em></span>
          <Input type="password" value={form.apiKey} onChange={event => patchForm({ apiKey: event.target.value })} placeholder={t.hints?.savedSecret || '填写密钥'} />
        </label>
      </div>
      {error && <Alert className="model-inline-alert" type="error" showIcon message={error} />}
      <footer className="model-add-footer">
        <span>{text.addProviderFooter}</span>
        <Space>
          <Button onClick={onClose}>{t.cancel}</Button>
          <Button type="primary" icon={<Plus size={14} />} loading={adding} onClick={add}>{text.addAndSave}</Button>
        </Space>
      </footer>
    </section>
  )
}

export function Models({
  t,
  profiles,
  persistedProfiles = [],
  setProfiles,
  patchProfile,
  addModelProfiles,
  deleteModelProfile,
  importModels,
  previewModels,
  saveModelProfile,
  onSaveModelOrder,
  onSaveProviderOrder,
  discoverModels,
  modelPreview,
  modelSaveStatus = {},
  importLoading = false,
  riskCatalog,
  riskCatalogError,
  revealedKeys = {},
  revealBusy = {},
  getProfileKey,
  onRevealKey,
  onClearRevealedKey,
}) {
  const text = t.models
  const [addOpen, setAddOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [orderOpen, setOrderOpen] = useState(false)
  const [orderRows, setOrderRows] = useState([])
  const [orderSaving, setOrderSaving] = useState(false)
  const [orderError, setOrderError] = useState('')
  const [dragIndex, setDragIndex] = useState(null)
  const [providerHoldIndex, setProviderHoldIndex] = useState(null)
  const [providerDrag, setProviderDrag] = useState(null)
  const [providerOrderError, setProviderOrderError] = useState('')
  const providerNavRef = useRef(null)
  const providerInteractionRef = useRef(null)
  const providerHoldTimerRef = useRef(null)
  const providerOrderBusyRef = useRef(false)
  const providerProfilesRef = useRef(profiles)
  const saveProviderOrderRef = useRef(onSaveProviderOrder)
  const suppressProviderClickUntilRef = useRef(0)
  const providerMotionKeysRef = useRef(new WeakMap())
  const providerMotionKeySeedRef = useRef(0)
  const providerFlipRectsRef = useRef(null)
  const providerMotionKey = profile => {
    if (profile?.client_id) return `client:${profile.client_id}`
    if (!profile || typeof profile !== 'object') return `provider:${String(profile)}`
    if (!providerMotionKeysRef.current.has(profile)) {
      providerMotionKeySeedRef.current += 1
      providerMotionKeysRef.current.set(profile, `local:${providerMotionKeySeedRef.current}`)
    }
    return providerMotionKeysRef.current.get(profile)
  }
  providerProfilesRef.current = profiles
  saveProviderOrderRef.current = onSaveProviderOrder
  const validation = validateModelProfiles(profiles)
  const summary = modelValidationSummary(validation)
  const risk = modelRiskCatalog(riskCatalog, riskCatalogError)
  const hasErrors = summary.errors > 0
  const totalModels = profiles.reduce((count, profile) => count + profileModels(profile).length, 0)
  const profileKeyId = (idx, profile) => getProfileKey?.(idx, profile)
    || profile?.client_id
    || `${profile?.var_name || nextVarName(profile?.type || DEFAULT_PROTOCOL, profiles)}:${profile?.type || DEFAULT_PROTOCOL}:${profile?.apibase || ''}:${idx}`

  useEffect(() => {
    setActiveIndex(current => Math.min(Math.max(current, 0), Math.max(profiles.length - 1, 0)))
  }, [profiles.length])

  useLayoutEffect(() => {
    const previousRects = providerFlipRectsRef.current
    providerFlipRectsRef.current = null
    if (!previousRects || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const entries = Array.from(providerNavRef.current?.querySelectorAll('[data-provider-motion-key]') || [])
    entries.forEach(entry => {
      const key = entry.dataset.providerMotionKey
      if (key === providerInteractionRef.current?.dragKey) return
      const previous = previousRects.get(key)
      if (!previous) return
      const current = entry.getBoundingClientRect()
      const deltaX = previous.left - current.left
      const deltaY = previous.top - current.top
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return
      entry.getAnimations?.().forEach(animation => animation.cancel())
      entry.animate(
        [
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' },
      )
    })
  }, [profiles])

  const removeProfile = async idx => {
    const profile = profiles[idx]
    const name = profile?.var_name || text.provider(idx + 1)
    if (!window.confirm(text.deleteConfirm(name, profileModels(profile).length))) return
    onClearRevealedKey?.(idx, profile, profileKeyId(idx, profile))
    const nextProfiles = profiles.filter((_, index) => index !== idx)
    setActiveIndex(current => current > idx ? current - 1 : Math.min(current, Math.max(nextProfiles.length - 1, 0)))
    if (deleteModelProfile) await deleteModelProfile(nextProfiles)
    else setProfiles(nextProfiles)
  }

  const openPreview = async () => {
    setPreviewOpen(true)
    await previewModels()
  }

  const openProfile = idx => {
    setAddOpen(false)
    setActiveIndex(idx)
  }

  const clearProviderHold = () => {
    if (providerHoldTimerRef.current) {
      window.clearTimeout(providerHoldTimerRef.current)
      providerHoldTimerRef.current = null
    }
    setProviderHoldIndex(null)
  }

  const releaseProviderPointer = interaction => {
    const target = interaction?.captureTarget
    const pointerId = interaction?.pointerId
    if (target?.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId)
  }

  const finishProviderDrag = async (interaction = providerInteractionRef.current) => {
    const wasActive = Boolean(interaction?.active)
    clearProviderHold()
    setProviderDrag(null)
    providerInteractionRef.current = null
    releaseProviderPointer(interaction)
    if (!wasActive) return
    suppressProviderClickUntilRef.current = Date.now() + 300
    if (interaction.fromIndex === interaction.currentIndex || providerOrderBusyRef.current) return
    const orderedProfiles = providerProfilesRef.current
    if (!saveProviderOrderRef.current) {
      setProviderOrderError('当前页面未提供服务商顺序保存能力，请刷新后重试。')
      return
    }
    providerOrderBusyRef.current = true
    setProviderOrderError('')
    try {
      const ok = await saveProviderOrderRef.current(orderedProfiles)
      if (!ok) setProviderOrderError('服务商顺序保存失败，当前排序草稿已保留，请检查页面提示后重试。')
    } catch (error) {
      setProviderOrderError(error?.message || '服务商顺序保存失败，当前排序草稿已保留。')
    } finally {
      providerOrderBusyRef.current = false
    }
  }

  const cancelProviderDrag = (event, suppressClick = false) => {
    const interaction = providerInteractionRef.current
    clearProviderHold()
    setProviderDrag(null)
    providerInteractionRef.current = null
    releaseProviderPointer(interaction)
    if (suppressClick && interaction) suppressProviderClickUntilRef.current = Date.now() + 300
  }

  const moveProviderPreview = (clientY, interaction = providerInteractionRef.current) => {
    if (!interaction?.active) return
    const items = Array.from(providerNavRef.current?.querySelectorAll('[data-provider-index]') || [])
    const overIndex = items.findIndex(item => {
      const box = item.getBoundingClientRect()
      return clientY >= box.top && clientY <= box.bottom
    })
    const previousIndex = interaction.currentIndex
    if (overIndex < 0 || overIndex === previousIndex) return
    providerFlipRectsRef.current = new Map(items.map(item => [
      item.dataset.providerMotionKey,
      item.getBoundingClientRect(),
    ]))
    interaction.currentIndex = overIndex
    setProfiles(current => {
      const next = moveOrderedItem(current, previousIndex, overIndex)
      interaction.previewProfiles = next
      providerProfilesRef.current = next
      return next
    })
    setActiveIndex(current => {
      if (current === previousIndex) return overIndex
      if (previousIndex < overIndex && current > previousIndex && current <= overIndex) return current - 1
      if (previousIndex > overIndex && current >= overIndex && current < previousIndex) return current + 1
      return current
    })
    setProviderDrag(current => ({ ...current, index: overIndex }))
    setProviderOrderError('')
  }

  const startProviderHold = (idx, event) => {
    if (providerOrderBusyRef.current || (event.pointerType === 'mouse' && event.button !== 0)) return
    clearProviderHold()
    const captureTarget = event.currentTarget
    try {
      captureTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Pointer capture may be unavailable in synthetic/browser compatibility events.
    }
    providerInteractionRef.current = {
      active: false,
      captureTarget,
      currentIndex: idx,
      fromIndex: idx,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    }
    setProviderHoldIndex(idx)
    providerHoldTimerRef.current = window.setTimeout(() => {
      providerHoldTimerRef.current = null
      const interaction = providerInteractionRef.current
      if (!interaction || interaction.fromIndex !== idx) return
      interaction.active = true
      const rect = interaction.captureTarget.getBoundingClientRect()
      interaction.dragKey = providerMotionKey(providerProfilesRef.current[interaction.currentIndex])
      interaction.grabX = interaction.startX - rect.left
      interaction.grabY = interaction.startY - rect.top
      interaction.width = rect.width
      interaction.height = rect.height
      setProviderHoldIndex(null)
      setProviderDrag({
        index: interaction.currentIndex,
        key: interaction.dragKey,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      })
      setProviderOrderError('')
    }, 350)
  }

  const moveProviderHold = event => {
    const interaction = providerInteractionRef.current
    if (!interaction || event.pointerId !== interaction.pointerId) return
    const deltaX = Math.abs(event.clientX - interaction.startX)
    const deltaY = Math.abs(event.clientY - interaction.startY)
    if (!interaction.active && Math.max(deltaX, deltaY) > 8) {
      cancelProviderDrag(event, true)
      return
    }
    if (!interaction.active) return
    event.preventDefault?.()
    setProviderDrag(current => ({
      ...current,
      left: event.clientX - interaction.grabX,
      top: event.clientY - interaction.grabY,
    }))
    moveProviderPreview(event.clientY, interaction)
  }

  const endProviderHold = event => {
    const interaction = providerInteractionRef.current
    if (!interaction || event.pointerId !== interaction.pointerId) return
    if (interaction.active) event.preventDefault?.()
    void finishProviderDrag(interaction)
  }

  const openAdd = () => setAddOpen(true)

  useEffect(() => () => {
    if (providerHoldTimerRef.current) window.clearTimeout(providerHoldTimerRef.current)
    providerInteractionRef.current = null
  }, [])

  const persistedOrderCount = orderedModelRows(persistedProfiles).length
  const openModelOrder = () => {
    setOrderRows(orderedModelRows(persistedProfiles))
    setOrderError('')
    setDragIndex(null)
    setOrderOpen(true)
  }
  const closeModelOrder = () => {
    if (orderSaving) return
    setOrderOpen(false)
    setOrderRows([])
    setOrderError('')
    setDragIndex(null)
  }
  const moveModelOrder = (fromIndex, toIndex) => {
    setOrderRows(current => moveOrderedItem(current, fromIndex, toIndex))
    setOrderError('')
  }
  const dropModelOrder = toIndex => {
    if (Number.isInteger(dragIndex)) moveModelOrder(dragIndex, toIndex)
    setDragIndex(null)
  }
  const saveModelOrder = async () => {
    if (!onSaveModelOrder) {
      setOrderError(text.orderMissing)
      return
    }
    setOrderSaving(true)
    setOrderError('')
    try {
      const ok = await onSaveModelOrder(orderRows)
      if (!ok) {
        setOrderError(text.orderSaveFailed)
        return
      }
      setOrderOpen(false)
      setOrderRows([])
      setDragIndex(null)
    } catch (error) {
      setOrderError(error?.message || text.orderSaveFailedShort)
    } finally {
      setOrderSaving(false)
    }
  }

  const riskItems = [{
    key: 'risk',
    label: <Space size={7}><AlertTriangle size={14} />{text.riskTitle}</Space>,
    children: (
      <div className="model-risk-content">
        <Alert
          type={risk.status === 'error' ? 'error' : 'info'}
          message={risk.status === 'ready' ? text.riskReady : risk.status === 'error' ? text.riskUnavailable : text.riskEmpty}
          description={risk.status === 'error' ? risk.error : text.riskHelp}
        />
        {risk.items.length > 0 && (
          <div className="model-risk-grid">
            {risk.items.map(item => (
              <div key={`${item.method}-${item.route}`}>
                <b>{item.method} {item.route}</b>
                <small>{item.action || item.reason}</small>
              </div>
            ))}
          </div>
        )}
        {risk.missingConfirmedWriteRoutes.length > 0 && (
          <Alert type="warning" message={text.missingGates(risk.missingConfirmedWriteRoutes.join(', '))} />
        )}
      </div>
    ),
  }]

  return (
    <section className="models-page">
      <header className="model-page-head model-page-head--actions-only">
        <div className="model-page-actions">
          <Button icon={<UploadCloud size={14} />} onClick={() => importModels()} loading={importLoading}>{text.rereadConfig}</Button>
          <Button
            icon={<ListOrdered size={14} />}
            onClick={openModelOrder}
            disabled={!persistedOrderCount}
            title={persistedOrderCount ? text.orderAvailable : text.orderUnavailable}
          >
            {text.modelOrder}
          </Button>
          <Button icon={<FileCode2 size={14} />} onClick={openPreview}>{text.configPreview}</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={openAdd}>{text.addProvider}</Button>
        </div>
      </header>

      <div className="model-summary-line" aria-label={text.configSummary}>
        <div className="model-summary-status">
          <span className={`model-summary-dot${hasErrors ? ' is-error' : ''}`} />
          <strong>{text.providers(summary.total)}</strong>
          <span>{text.models(totalModels)}</span>
          {summary.errors > 0 && <span className="is-error">{text.blockItems(summary.errors)}</span>}
          {summary.warnings > 0 && <span className="is-warning">{text.reminders(summary.warnings)}</span>}
        </div>
        <div className="model-summary-source"><FileCode2 size={13} /><span>{text.configSource}</span><code>mykey.py</code></div>
      </div>

      {hasErrors && <Alert type="error" showIcon message={text.pageHasErrors} className="model-page-alert" />}

      <div className="model-workbench">
        <aside className="model-provider-rail">
          <header className="model-rail-head">
            <div><strong>{text.providerDirectory}</strong><span>{text.chooseProvider}</span></div>
            <b>{profiles.length}</b>
          </header>

          <div ref={providerNavRef} className="model-provider-nav" role="navigation" aria-label={text.providerNav}>
            {profiles.map((profile, idx) => {
              const result = validation[idx]
              const count = profileModels(profile).length
              const meta = protocolMeta(profile.type || DEFAULT_PROTOCOL, t)
              const state = result?.errors?.length ? 'error' : result?.warnings?.length ? 'warning' : 'ready'
              const motionKey = providerMotionKey(profile)
              const isProviderDragging = providerDrag?.key === motionKey
              return (
                <div
                  className={`model-provider-entry${isProviderDragging ? ' is-drag-placeholder' : ''}`}
                  key={motionKey}
                  data-provider-index={idx}
                  data-provider-motion-key={motionKey}
                  style={isProviderDragging ? { height: providerDrag.height } : undefined}
                >
                  <button
                    type="button"
                    className={`model-provider-item${!addOpen && activeIndex === idx ? ' is-active' : ''}${providerHoldIndex === idx ? ' is-holding' : ''}${isProviderDragging ? ' is-dragging' : ''}`}
                    style={isProviderDragging ? {
                      left: providerDrag.left,
                      top: providerDrag.top,
                      width: providerDrag.width,
                      height: providerDrag.height,
                    } : undefined}
                    onClick={() => {
                      if (Date.now() < suppressProviderClickUntilRef.current) return
                      openProfile(idx)
                    }}
                    onPointerDown={event => startProviderHold(idx, event)}
                    onPointerMove={moveProviderHold}
                    onPointerUp={endProviderHold}
                    onPointerCancel={cancelProviderDrag}
                    onPointerLeave={moveProviderHold}
                    aria-current={!addOpen && activeIndex === idx ? 'true' : undefined}
                    aria-label={text.providerDragLabel(providerDisplayName(profile.var_name) || text.provider(idx + 1))}
                  >
                    <span className="model-provider-item-top">
                      <strong>{providerDisplayName(profile.var_name) || text.provider(idx + 1)}</strong>
                      <i className={`is-${state}`} title={state === 'error' ? text.stateError : state === 'warning' ? text.stateWarning : text.stateReady} />
                    </span>
                    <span className="model-provider-base">{profile.apibase || text.baseMissing}</span>
                    <span className="model-provider-meta"><em>{meta?.shortLabel || protocolLabel(profile.type, t)}</em><b>{text.modelCount(count)}</b></span>
                  </button>
                </div>
              )
            })}
          </div>

          {providerOrderError && (
            <Alert type="error" showIcon message={providerOrderError} className="model-provider-order-alert" />
          )}

          <button type="button" className={`model-provider-add${addOpen ? ' is-active' : ''}`} onClick={openAdd}>
            <Plus size={15} /><span>{text.addProvider}</span>
          </button>

          <footer className="model-rail-foot">
            <CheckCircle2 size={13} />
            <span>{text.singleSaveHint}</span>
          </footer>
        </aside>

        <section className="model-editor-workspace" aria-label={addOpen ? text.addProvider : text.providerEditor}>
          {addOpen && (
            <AddProfileForm
              profiles={profiles}
              addModelProfiles={addModelProfiles}
              t={t}
              onClose={() => setAddOpen(false)}
              onAdded={() => {
                setActiveIndex(profiles.length)
                setAddOpen(false)
              }}
            />
          )}

          {profiles.map((profile, idx) => {
            const key = profileKeyId(idx, profile)
            return (
              <div key={profile.client_id || `provider-${idx}`} className="model-editor-slot" hidden={addOpen || activeIndex !== idx}>
                <ProfileCard
                  profile={profile}
                  idx={idx}
                  profileKey={key}
                  result={validation[idx]}
                  profiles={profiles}
                  patchProfile={patchProfile}
                  removeProfile={removeProfile}
                  discoverModels={discoverModels}
                  revealedKey={revealedKeys[key]}
                  revealBusy={!!revealBusy[key]}
                  onRevealKey={onRevealKey}
                  onClearRevealedKey={onClearRevealedKey}
                  onSave={saveModelProfile}
                  saveState={modelSaveStatus[key] || modelSaveStatus[idx]}
                  t={t}
                />
              </div>
            )
          })}

          {!profiles.length && !addOpen && (
            <div className="model-empty-state">
              <Layers size={36} strokeWidth={1.2} className="model-empty-icon" />
              <strong>{importLoading ? text.loadingMykey : text.noProviders}</strong>
              <span>{importLoading ? text.loadingHelp : text.noProvidersHelp}</span>
              {!importLoading && <Button type="primary" icon={<Plus size={15} />} onClick={openAdd}>{text.addProvider}</Button>}
            </div>
          )}
        </section>
      </div>

      <Collapse ghost items={riskItems} className="model-risk-collapse" />

      <Drawer
        title={text.orderTitle}
        placement="right"
        width={620}
        open={orderOpen}
        onClose={closeModelOrder}
        closable={!orderSaving}
        maskClosable={!orderSaving}
        className="model-order-drawer"
        footer={(
          <div className="model-order-footer">
            <span>{text.discardOrder}</span>
            <Space>
              <Button onClick={closeModelOrder} disabled={orderSaving}>{t.cancel}</Button>
              <Button type="primary" onClick={saveModelOrder} loading={orderSaving} disabled={!orderRows.length}>{text.confirmSave}</Button>
            </Space>
          </div>
        )}
      >
        <Alert
          type="info"
          showIcon
          message={text.orderInfo}
          description={text.orderDescription}
        />
        {orderError && <Alert type="error" showIcon message={orderError} className="model-order-error" />}
        <div className="model-order-list" role="list" aria-label={text.savedOrder}>
          {orderRows.map((row, index) => (
            <div
              key={row.id}
              role="listitem"
              className={`model-order-row${dragIndex === index ? ' is-dragging' : ''}`}
              draggable={!orderSaving}
              onDragStart={event => {
                setDragIndex(index)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', row.id)
              }}
              onDragOver={event => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={event => {
                event.preventDefault()
                dropModelOrder(index)
              }}
              onDragEnd={() => setDragIndex(null)}
            >
              <GripVertical size={17} className="model-order-grip" aria-hidden="true" />
              <div className="model-order-index" aria-label={`--llm-no ${index}`}>
                <strong>{index}</strong>
                <span>--llm-no</span>
              </div>
              <div className="model-order-copy">
                <code>{row.variableName}</code>
                <strong title={row.model}>{row.model || text.missingModelId}</strong>
                <span>{text.providerName}: {providerDisplayName(row.providerVarName) || text.unnamed}</span>
              </div>
              <div className="model-order-actions">
                <Button
                  type="text"
                  size="small"
                  icon={<ArrowUp size={15} />}
                  aria-label={`${text.moveUp} ${row.model || row.variableName}`}
                  title={text.moveUp}
                  disabled={orderSaving || index === 0}
                  onClick={() => moveModelOrder(index, index - 1)}
                />
                <Button
                  type="text"
                  size="small"
                  icon={<ArrowDown size={15} />}
                  aria-label={`${text.moveDown} ${row.model || row.variableName}`}
                  title={text.moveDown}
                  disabled={orderSaving || index === orderRows.length - 1}
                  onClick={() => moveModelOrder(index, index + 1)}
                />
              </div>
            </div>
          ))}
        </div>
      </Drawer>

      <Drawer
        title={text.previewTitle}
        placement="right"
        width={680}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        className="model-preview-drawer"
        extra={<Button icon={<RefreshCw size={14} />} onClick={previewModels}>{text.refreshPreview}</Button>}
      >
        <Alert type="info" showIcon message={text.previewSecret} />
        <pre className="model-preview-pre">{modelPreview || (profiles.length ? text.generatingPreview : text.previewNeedsProvider)}</pre>
      </Drawer>
    </section>
  )
}
