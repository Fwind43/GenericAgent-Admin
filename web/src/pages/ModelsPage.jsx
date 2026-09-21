import './models-workbench.css'
import { modelRiskView } from './modelsRiskView'
import { UiSurface } from '../ui/UiHost'
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
  Network,
  Building2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import Alert from 'antd/es/alert'
import Button from 'antd/es/button'
import Collapse from 'antd/es/collapse'
import Drawer from 'antd/es/drawer'
import Input from 'antd/es/input'
import Modal from 'antd/es/modal'
import Select from 'antd/es/select'
import Space from 'antd/es/space'
import Tag from 'antd/es/tag'
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS as DndCSS } from '@dnd-kit/utilities'
import { emptyProfile } from '../lib/format'
import {
  FAILOVER_VAR_PREFIX,
  failoverGroupSuffix,
  failoverGroupVarName,
  nextFailoverGroupName,
  API_MODE_OPTIONS,
  SERVICE_TIER_OPTIONS,
  THINKING_TYPE_OPTIONS,
  addModelConfigs,
  applyModelAndFailoverOrder,
  modelProtocolFields,
  moveOrderedItem,
  orderedModelAndFailoverRows,
  orderedModelRows,
  profileModelConfigs,
  reasoningEffortOptions,
  removeModelConfig,
  updateModelConfig,
} from '../lib/modelsEditor'
import {
  nextProviderVarName,
  providerDisplayName,
  providerVarNameOnProtocolChange,
} from '../lib/modelsProvider'
import { modelRiskCatalog, modelValidationSummary, validateModelProfiles } from '../lib/modelsValidation'
import { confirmDanger, showAppAlert } from '../lib/danger'

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
  // shortLabel stays the bare protocol name: it goes on chips and cards where
  // the parenthetical from the full label would not fit.
  return localized ? { ...meta, label: localized[0], help: localized[1] || meta.help } : meta
}
const protocolLabel = (value, t) => protocolMeta(value, t)?.shortLabel || value || 'Native OAI'
const supportsModelDiscovery = value => !!protocolMeta(value)?.discover
const providerName = profile => String(profile?.display_name || '').trim() || providerDisplayName(profile?.var_name)

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
const memberKeyOf = member => String(member?.instance_id || member?.instanceId || `${String(member?.provider_var_name || member?.providerVarName || '')}\u0000${String(member?.model || '')}`)
const providerState = result => (result?.errors?.length ? 'error' : result?.warnings?.length ? 'warning' : 'ready')

function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return undefined
  const parsed = Number(value)
  return Number.isNaN(parsed) ? value : parsed
}

// Reject nested/unexpected values at the display boundary. Validation remains host-owned.
const editorNumber = value => typeof value === 'number' || typeof value === 'string' ? value : ''
const editorBool = value => typeof value === 'boolean' ? value : undefined

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

// Every model carries the same handful of transport settings; the rest depend
// on the provider's protocol, so they are kept in their own group instead of
// being mixed into one long grid.
function ModelParams({ config, protocol, onChange, t }) {
  const text = t.models
  const fields = modelProtocolFields(protocol)
  const extra = config.extra || {}
  const updateExtra = (key, value) => {
    const next = { ...extra }
    if (value === undefined || value === '') delete next[key]
    else next[key] = value
    onChange({ extra: next })
  }
  const hasProtocolFields = fields.userAgent || fields.apiMode || fields.serviceTier
    || fields.thinkingType || fields.reasoningFamily || fields.fakeClaudeCode

  return (
    <div className="model-row-body">
      <UiSurface name="admin.models.editor.common" viewProps={{
        // Deliberately project scalar values only; never spread config/extra here.
        model: {
          title: text.callParams, help: text.callParamsHelp, modelId: config.model,
          labels: { name: text.displayName, namePlaceholder: text.displayNamePlaceholder,
            stream: text.stream, maxRetries: text.maxRetries, readTimeout: text.readTimeout,
            connectTimeout: text.connectTimeout, inherit: text.inherit, enabled: t.enabled, disabled: t.disabled },
          values: {
            name: typeof config.name === 'string' ? config.name : '',
            temperature: editorNumber(extra.temperature), maxTokens: editorNumber(extra.max_tokens),
            maxRetryAfter: editorNumber(extra.max_retry_after), omitThinking: editorBool(extra.omit_thinking),
            stream: editorBool(config.stream), maxRetries: editorNumber(config.max_retries),
            readTimeout: editorNumber(config.read_timeout), connectTimeout: editorNumber(config.connect_timeout),
          },
        },
        actions: {
          setName: name => onChange({ name: String(name) }),
          setTemperature: value => updateExtra('temperature', optionalNumber(value)),
          setMaxTokens: value => updateExtra('max_tokens', optionalNumber(value)),
          setMaxRetryAfter: value => updateExtra('max_retry_after', optionalNumber(value)),
          setOmitThinking: value => updateExtra('omit_thinking', editorBool(value)),
          setStream: value => onChange({ stream: editorBool(value) }),
          setMaxRetries: value => onChange({ max_retries: optionalNumber(value) }),
          setReadTimeout: value => onChange({ read_timeout: optionalNumber(value) }),
          setConnectTimeout: value => onChange({ connect_timeout: optionalNumber(value) }),
        },
      }} />

      {hasProtocolFields && (
        <div className="model-subsection">
          <div className="model-subsection-head">
            <strong>{text.protocolParams}</strong>
            <span>{protocolLabel(protocol, t)}</span>
          </div>
          <div className="model-params-grid">
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
            {fields.serviceTier && (
              <label className="model-field">
                <span className="model-field-label">{text.serviceTier}</span>
                <Select allowClear value={config.service_tier || undefined} onChange={service_tier => onChange({ service_tier })} placeholder={text.inherit} options={SERVICE_TIER_OPTIONS} />
              </label>
            )}
            {fields.thinkingType && (
              <label className="model-field">
                <span className="model-field-label">{text.thinkingType}</span>
                <Select allowClear value={config.thinking_type || undefined} onChange={thinking_type => onChange({ thinking_type })} placeholder={text.inherit} options={THINKING_TYPE_OPTIONS} />
              </label>
            )}
            {fields.thinkingType && (
              <label className="model-field">
                <span className="model-field-label">thinking_budget_tokens</span>
                <Input type="number" min={1} step={1} disabled={config.thinking_type !== 'enabled'} value={extra.thinking_budget_tokens ?? ''} onChange={event => updateExtra('thinking_budget_tokens', optionalNumber(event.target.value))} placeholder={text.inherit} />
              </label>
            )}
            {protocol === 'native_claude' && (
              <label className="model-field">
                <span className="model-field-label">api_key_header</span>
                <Select allowClear value={extra.api_key_header || undefined} onChange={value => updateExtra('api_key_header', value)} placeholder={text.inherit} options={['auto', 'x-api-key', 'bearer'].map(value => ({ value, label: value }))} />
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
    </div>
  )
}

function SortableMemberRow({ member, memberIndex, groupIndex, groupLength, candidate, moveMember, removeMember, text }) {
  const key = memberKeyOf(member)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: key })
  const style = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    position: 'relative',
  }
  return (
    <div ref={setNodeRef} style={style} role="listitem" className={`model-failover-priority-row${isDragging ? ' is-dragging' : ''}${candidate ? '' : ' is-missing'}`}>
      <span {...attributes} {...listeners} className="model-drag-handle" aria-label={text.failoverPriority}>
        <GripVertical size={15} aria-hidden="true" />
      </span>
      <span className="model-failover-priority-index">{memberIndex + 1}</span>
      <span className="model-failover-priority-copy">
        <strong>{member.model || text.missingModelId}</strong>
        <small>{candidate?.providerName || providerDisplayName(member.provider_var_name) || member.provider_var_name || text.unnamed}</small>
      </span>
      {!candidate && <Tag color="error">{text.failoverMissingMember}</Tag>}
      <Space size={0}>
        <Button type="text" size="small" icon={<ArrowUp size={13} />} aria-label={text.moveUp} disabled={memberIndex === 0} onClick={() => moveMember(groupIndex, memberIndex, memberIndex - 1)} />
        <Button type="text" size="small" icon={<ArrowDown size={13} />} aria-label={text.moveDown} disabled={memberIndex === groupLength - 1} onClick={() => moveMember(groupIndex, memberIndex, memberIndex + 1)} />
        <Button danger type="text" size="small" icon={<Trash2 size={13} />} aria-label={text.failoverRemove} onClick={() => removeMember(groupIndex, memberIndex)} />
      </Space>
    </div>
  )
}

export function FailoverGroupBody({ group, groupIndex, candidates, candidateMap, sensors, patchGroup, toggleMember, moveMember, removeMember, text }) {
  const [expandedProviders, setExpandedProviders] = useState({})
  const providerGroups = Array.from(candidates.reduce((groups, candidate) => {
    const key = candidate.providerVarName
    if (!groups.has(key)) groups.set(key, { key, name: candidate.providerName || text.unnamed, candidates: [] })
    groups.get(key).candidates.push(candidate)
    return groups
  }, new Map()).values())
  const selectedKeys = new Set((group.members || []).map(memberKeyOf))
  const selectedFamilies = new Set((group.members || [])
    .map(member => candidateMap.get(memberKeyOf(member))?.family)
    .filter(Boolean))

  return (
    <div className="model-row-body">
      <label className="model-field">
        <span className="model-field-label">{text.displayName}</span>
        <Input value={group.display_name || ''} onChange={event => patchGroup(groupIndex, { display_name: event.target.value })} placeholder={group.var_name} />
      </label>
      <label className="model-field">
        <span className="model-field-label">{text.varName}</span>
        <Input
          addonBefore={FAILOVER_VAR_PREFIX}
          value={failoverGroupSuffix(group.var_name)}
          onChange={event => patchGroup(groupIndex, { var_name: failoverGroupVarName(event.target.value) })}
        />
      </label>

      <div className="model-subsection">
        <div className="model-subsection-head">
          <strong>{text.failoverCandidates}</strong>
          <span>{group.members?.length || 0} / {candidates.length}</span>
        </div>
        <p className="model-subsection-help">{text.failoverCandidatesHelp}</p>
        <div className="model-failover-providers">
          {providerGroups.length ? providerGroups.map(provider => (
            <section className="model-failover-provider" key={provider.key} aria-label={provider.name}>
              <button type="button" className="model-subsection-head model-failover-provider-toggle" aria-expanded={!!expandedProviders[provider.key]} onClick={() => setExpandedProviders(current => ({ ...current, [provider.key]: !current[provider.key] }))}>
                <strong><span aria-hidden="true">{expandedProviders[provider.key] ? '▾' : '▸'}</span><Building2 size={14} aria-hidden="true" /> {provider.name}</strong>
                <span>{provider.candidates.filter(candidate => selectedKeys.has(memberKeyOf({ instance_id: candidate.instanceId, provider_var_name: candidate.providerVarName, model: candidate.model }))).length} / {provider.candidates.length}</span>
              </button>
              {expandedProviders[provider.key] && <div className="model-failover-candidates">
          {provider.candidates.map(candidate => {
            const key = memberKeyOf({ instance_id: candidate.instanceId, provider_var_name: candidate.providerVarName, model: candidate.model })
            const selected = selectedKeys.has(key)
            const locked = selectedFamilies.size > 0 && !selectedFamilies.has(candidate.family)
            return (
              <button
                type="button"
                key={candidate.id}
                className={`model-failover-candidate${selected ? ' is-selected' : ''}`}
                disabled={locked && !selected}
                aria-pressed={selected}
                onClick={() => toggleMember(groupIndex, candidate)}
              >
                <span className="model-failover-check">{selected ? <CheckCircle2 size={15} /> : null}</span>
                <span><strong>{candidate.model || text.missingModelId}</strong><small>{candidate.providerName || text.unnamed} · {candidate.protocol}</small></span>
              </button>
            )
          })}
              </div>}
            </section>
          )) : <div className="model-hint-block">{text.failoverNoCandidates}</div>}
        </div>
      </div>

      <div className="model-subsection">
        <div className="model-subsection-head"><strong>{text.failoverPriority}</strong></div>
        <p className="model-subsection-help">{text.failoverPriorityHelp}</p>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (!over || active.id === over.id) return
            const members = group.members || []
            const from = members.findIndex(member => memberKeyOf(member) === active.id)
            const to = members.findIndex(member => memberKeyOf(member) === over.id)
            if (from !== -1 && to !== -1) moveMember(groupIndex, from, to)
          }}
        >
          <SortableContext items={(group.members || []).map(memberKeyOf)} strategy={verticalListSortingStrategy}>
            <div className="model-failover-priority" role="list" aria-label={text.failoverPriority}>
              {(group.members || []).map((member, memberIndex) => (
                <SortableMemberRow
                  key={memberKeyOf(member)}
                  member={member}
                  memberIndex={memberIndex}
                  groupIndex={groupIndex}
                  groupLength={group.members.length}
                  candidate={candidateMap.get(memberKeyOf(member))}
                  moveMember={moveMember}
                  removeMember={removeMember}
                  text={text}
                />
              ))}
              {!group.members?.length && <div className="model-hint-block">{text.failoverNeedsTwo}</div>}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="model-subsection">
        <div className="model-subsection-head"><strong>{text.failoverPolicy}</strong></div>
        <div className="model-params-grid">
          <label className="model-field">
            <span className="model-field-label">{text.failoverRetries}</span>
            <Input type="number" min="0" step="1" value={group.max_retries ?? 10} onChange={event => patchGroup(groupIndex, { max_retries: event.target.value })} />
            <small>{text.failoverRetriesHelp}</small>
          </label>
          <label className="model-field">
            <span className="model-field-label">{text.failoverDelay}</span>
            <Input type="number" min="0" step="0.1" value={group.base_delay ?? 0.5} onChange={event => patchGroup(groupIndex, { base_delay: event.target.value })} />
            <small>{text.failoverDelayHelp}</small>
          </label>
          <label className="model-field">
            <span className="model-field-label">{text.failoverSpring}</span>
            <Input type="number" min="1" step="1" value={group.spring_back ?? ''} placeholder={text.failoverSpringPlaceholder} onChange={event => patchGroup(groupIndex, { spring_back: event.target.value })} />
            <small>{text.failoverSpringHelp}</small>
          </label>
        </div>
      </div>
    </div>
  )
}

// Draft position is not a live GA slot. Only official indices are shown.
// The provider form is shared by create and edit modes; only the modal footer
// differs.
function ProviderForm({ draft, profiles, editingIndex, onChange, t }) {
  const text = t.models
  const meta = protocolMeta(draft.type || DEFAULT_PROTOCOL, t)
  return (
    <>
      <label className="model-field model-field--provider">
        <span className="model-field-label">{text.name}</span>
        <Input
          value={draft.display_name ?? providerDisplayName(draft.var_name)}
          onChange={event => onChange({ display_name: event.target.value })}
          placeholder={text.nameExample}
        />
        <small>{text.nameHelp}</small>
      </label>
      <label className="model-field">
        <span className="model-field-label">{text.protocol}</span>
        <Select
          value={draft.type || DEFAULT_PROTOCOL}
          onChange={value => onChange({
            type: value,
            var_name: providerVarNameOnProtocolChange(draft.var_name, protocolMeta(value)?.prefix, profiles, editingIndex),
          })}
          options={OFFICIAL_PROTOCOLS.map(item => protocolMeta(item.value, t))}
        />
        <small>{meta.help}</small>
      </label>
      <label className="model-field">
        <span className="model-field-label">BaseURL</span>
        <Input value={draft.apibase || ''} onChange={event => onChange({ apibase: event.target.value })} placeholder="https://api.example.com/v1" />
      </label>
    </>
  )
}

function ProviderModal({
  open,
  mode,
  profile,
  index,
  profiles,
  result,
  onClose,
  onChange,
  onCreate,
  onRemove,
  onAddModels,
  onRemoveModel,
  revealedKey,
  revealBusy,
  onRevealKey,
  onClearRevealedKey,
  t,
}) {
  const text = t.models
  const creating = mode === 'create'
  const [expandedModel, setExpandedModel] = useState(null)
  const revealed = !creating && revealedKey != null && String(revealedKey).trim() !== '' && !isMaskedSecret(revealedKey)
  const configs = creating ? [] : profileModelConfigs(profile || {})

  useEffect(() => {
    setExpandedModel(null)
  }, [open, mode, index])

  const patchModel = (configIndex, patch) => {
    const next = updateModelConfig(profile || {}, configIndex, patch)
    onChange({ model: next.model, models: next.models, model_configs: next.model_configs })
  }

  return (
    <Modal
      title={creating ? text.addProvider : (providerName(profile) || text.providerEditor)}
      width={920}
      centered
      open={open}
      onCancel={onClose}
      className="model-provider-modal"
      footer={creating ? (
        <div className="model-drawer-footer">
          <span>{text.addProviderFooter}</span>
          <Space>
            <Button onClick={onClose}>{t.cancel}</Button>
            <Button type="primary" icon={<Plus size={14} />} onClick={onCreate}>{text.addProviderAction}</Button>
          </Space>
        </div>
      ) : (
        <div className="model-drawer-footer">
          <Button danger icon={<Trash2 size={14} />} onClick={onRemove}>{text.deleteProviderTitle}</Button>
          <Button onClick={onClose}>{t.close}</Button>
        </div>
      )}
    >
      <div className="model-drawer-body">
        <ProviderForm draft={profile || {}} profiles={profiles} editingIndex={creating ? undefined : index} onChange={onChange} t={t} />

        <label className="model-field">
          <span className="model-field-label">API Key <em>{creating ? text.optionalKey : revealed ? text.tempShown : text.hiddenByDefault}</em></span>
          <Input
            type={creating || revealed ? 'text' : 'password'}
            value={profile?.apikey ?? ''}
            onChange={event => {
              if (!creating) onClearRevealedKey?.(index, profile)
              onChange({ apikey: event.target.value })
            }}
            placeholder={creating ? (t.hints?.savedSecret || '') : text.keyPlaceholder}
            addonAfter={creating ? undefined : revealed ? (
              <Space size={2}>
                <Button size="small" type="text" icon={<EyeOff size={14} />} loading={revealBusy} onClick={() => onRevealKey?.(index, profile, false)}>{t.hide}</Button>
                <Button size="small" type="text" icon={<RefreshCw size={13} />} loading={revealBusy} onClick={() => onRevealKey?.(index, profile, true)} title={text.reread} aria-label={`${text.reread} API Key`} />
              </Space>
            ) : (
              <Button size="small" type="text" icon={<Eye size={14} />} loading={revealBusy} onClick={() => onRevealKey?.(index, profile, false)}>{t.show}</Button>
            )}
          />
        </label>

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

        {!creating && (
          <div className="model-subsection">
            <div className="model-subsection-head">
              <strong>{text.providerModels}</strong>
              <Button size="small" icon={<Plus size={13} />} onClick={onAddModels}>{text.addModel}</Button>
            </div>
            {configs.length ? (
              <div className="model-provider-models">
                {configs.map((config, configIndex) => {
                  const expanded = expandedModel === configIndex
                  const panelId = `provider-model-config-${index}-${configIndex}`
                  return (
                    <article
                      key={config.instance_id || `provider-model-${configIndex}`}
                      className={`model-provider-model-card${expanded ? ' is-expanded' : ''}`}
                    >
                      <div className="model-provider-model-summary-row">
                        <button
                          type="button"
                          className="model-provider-model-toggle"
                          aria-expanded={expanded}
                          aria-controls={panelId}
                          onClick={() => setExpandedModel(current => current === configIndex ? null : configIndex)}
                        >
                          <span className="model-provider-model-summary">
                            <strong>{config.name || config.model || text.model}</strong>
                          </span>
                          <span className="model-provider-model-action">
                            {expanded ? text.collapse : text.configure}
                            <ChevronDown size={15} aria-hidden="true" />
                          </span>
                        </button>
                        <Button
                          danger
                          type="text"
                          icon={<Trash2 size={14} />}
                          aria-label={`${t.delete} ${config.model}`}
                          onClick={() => {
                            setExpandedModel(null)
                            onRemoveModel?.(configIndex, config)
                          }}
                        />
                      </div>
                      {expanded && (
                        <div id={panelId} className="model-provider-model-config">
                          <label className="model-field model-field--wide">
                            <span className="model-field-label">{text.modelId}</span>
                            <Input
                              value={config.model || ''}
                              onChange={event => patchModel(configIndex, { model: event.target.value })}
                              placeholder={text.modelIdPlaceholder}
                            />
                            <small>{text.modelIdHelp}</small>
                          </label>
                          <ModelParams
                            config={config}
                            protocol={profile?.type || DEFAULT_PROTOCOL}
                            onChange={patch => patchModel(configIndex, patch)}
                            t={t}
                          />
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            ) : <div className="model-hint-block">{text.providerNoModels}</div>}
          </div>
        )}
      </div>
    </Modal>
  )
}

// Adding a model is one flow: pick the provider, then take model IDs from the
// provider's own catalog or type them in. Every pick lands in the draft
// immediately, so the list behind the dialog grows as you work.
function AddModelModal({ open, profiles, initialIndex, onClose, onAdd, discoverModels, onCreateProvider, t }) {
  const text = t.models
  const [providerIndex, setProviderIndex] = useState(initialIndex ?? 0)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fetched, setFetched] = useState(false)
  const [discovered, setDiscovered] = useState([])
  const [added, setAdded] = useState([])

  const profile = profiles[providerIndex]
  const candidates = uniqueModels(discovered)

  const selectProvider = index => {
    setProviderIndex(index)
    setDiscovered([])
    setFetched(false)
    setError('')
    setAdded([])
  }

  const add = values => {
    const models = uniqueModels(values)
    if (!models.length) return
    onAdd(providerIndex, models)
    setAdded(current => [...current, ...models])
  }

  const addDraft = () => {
    const model = draft.trim()
    if (!model) return
    add([model])
    setDraft('')
  }

  const discover = async () => {
    if (!profile) return
    setBusy(true)
    setError('')
    try {
      const key = String(profile.apikey || '').trim()
      const response = await discoverModels({
        protocol: profile.type || DEFAULT_PROTOCOL,
        baseUrl: profile.apibase,
        apiKey: key && !isMaskedSecret(key) ? key : undefined,
        varName: profile.var_name,
      })
      setDiscovered(response?.models || [])
      setFetched(true)
    } catch (failure) {
      setError(String(failure?.message || failure))
    } finally {
      setBusy(false)
    }
  }

  const canDiscover = Boolean(profile?.apibase) && supportsModelDiscovery(profile?.type || DEFAULT_PROTOCOL)

  return (
    <Modal
      className="model-add-modal"
      title={text.addModel}
      open={open}
      onCancel={onClose}
      width={640}
      destroyOnHidden
      footer={<Button onClick={onClose}>{t.close}</Button>}
    >
      <div className="model-add-body">
        <label className="model-field">
          <span className="model-field-label">{text.chooseProvider}</span>
          <Select
            value={profiles.length ? providerIndex : undefined}
            onChange={selectProvider}
            placeholder={text.noProviders}
            popupRender={menu => (
              <>
                {menu}
                <div className="model-select-footer">
                  <Button type="text" size="small" icon={<Plus size={13} />} onClick={onCreateProvider}>{text.addProvider}</Button>
                </div>
              </>
            )}
            options={profiles.map((item, index) => ({
              value: index,
              label: `${providerName(item) || text.provider(index + 1)} · ${protocolLabel(item.type, t)}`,
            }))}
          />
          {profile && <small>{profile.apibase || text.baseMissing}</small>}
        </label>

        <div className="model-add-actions">
          <Input
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onPressEnter={addDraft}
            placeholder={text.manualModel}
            aria-label={text.manualModel}
            disabled={!profile}
          />
          <Button icon={<Plus size={14} />} onClick={addDraft} disabled={!profile || !draft.trim()}>{text.addModelAction}</Button>
          <Button onClick={discover} loading={busy} disabled={!canDiscover} icon={<RefreshCw size={14} />}>{text.fetchModels}</Button>
        </div>

        {error ? (
          <Alert
            type="error"
            showIcon
            message={text.cannotFetch}
            description={error}
            action={<Button size="small" onClick={discover}>{t.retry}</Button>}
          />
        ) : busy ? (
          <div className="model-hint-block" role="status">{text.fetching}</div>
        ) : fetched ? (
          <div className="model-subsection">
            <div className="model-subsection-head">
              <strong>{text.discovered(candidates.length)}</strong>
              <Button size="small" type="primary" onClick={() => add(candidates)} disabled={!candidates.length}>{text.addAll}</Button>
            </div>
            <div className="model-candidate-list">
              {candidates.length ? candidates.map(model => (
                <button key={model} type="button" className="model-candidate-item" onClick={() => add([model])} aria-label={text.addModelAria(model)}>
                  <span title={model}>{model}</span>
                  <Plus size={14} />
                </button>
              )) : <div className="model-hint-block">{text.noNewModels}</div>}
            </div>
          </div>
        ) : null}

        {added.length > 0 && (
          <Alert type="success" showIcon message={text.addedModels(added.length)} description={added.join('、')} />
        )}
      </div>
    </Modal>
  )
}

export function Models({
  officialSlots = {},
  t,
  profiles,
  setProfiles,
  patchProfile,
  addModelProfiles,
  removeModelProfile,
  importModels,
  previewModels,
  failoverGroups = [],
  setFailoverGroups,
  discoverModels,
  modelPreview,
  changes = { total: 0 },
  saveState = {},
  saveAll,
  discardDraft,
  importLoading = false,
  riskCatalog,
  riskCatalogError,
  revealedKeys = {},
  revealBusy = {},
  getProfileKey,
  onRevealKey,
  onClearRevealedKey,
  modelInstance,
  modelInstanceLabel,
}) {
  const text = t.models
  const [expanded, setExpanded] = useState(() => new Set())
  const [workspace, setWorkspace] = useState('models')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [providerDrawer, setProviderDrawer] = useState(null)
  const [providerDraft, setProviderDraft] = useState(null)
  const [addModelIndex, setAddModelIndex] = useState(null)
  const closingDrawer = useRef(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const profileKeyId = (idx, profile) => getProfileKey?.(idx, profile) || profile?.client_id || `provider-index-${idx}`
  const validation = validateModelProfiles(profiles)
  const summary = modelValidationSummary(validation)
  const risk = modelRiskCatalog(riskCatalog, riskCatalogError)
  const totalModels = profiles.reduce((count, profile) => count + profileModels(profile).length, 0)

  const rows = useMemo(() => orderedModelAndFailoverRows(profiles, failoverGroups).map(row => (
    row.type === 'failover' ? row : {
      ...row,
      displayName: profileModelConfigs(profiles[row.profileIndex] || {})[row.configIndex]?.name || '',
      providerName: providerName(profiles[row.profileIndex]),
    }
  )).map(row => ({ ...row, officialIndex: changes.total ? null : officialSlots[row.id] })).sort((a, b) =>
    changes.total ? 0 : (a.officialIndex ?? Infinity) - (b.officialIndex ?? Infinity)
  ), [profiles, failoverGroups, officialSlots, changes.total])

  const candidates = useMemo(() => orderedModelRows(profiles).map(row => {
    const protocol = String(profiles[row.profileIndex]?.type || DEFAULT_PROTOCOL)
    return {
      ...row,
      providerName: providerName(profiles[row.profileIndex]),
      protocol,
      family: protocol.startsWith('native_') ? 'native' : 'legacy',
    }
  }), [profiles])
  const candidateMap = useMemo(
    () => new Map(candidates.map(candidate => [
      memberKeyOf({ instance_id: candidate.instanceId, provider_var_name: candidate.providerVarName, model: candidate.model }),
      candidate,
    ])),
    [candidates],
  )

  // Failover groups are checked here rather than in modelsValidation because
  // they are only meaningful against the models the draft currently has.
  const failoverError = (() => {
    const names = new Set()
    for (let groupIndex = 0; groupIndex < failoverGroups.length; groupIndex += 1) {
      const group = failoverGroups[groupIndex]
      const suffix = failoverGroupSuffix(group.var_name).trim()
      const name = failoverGroupVarName(suffix)
      if (!/^[A-Za-z0-9_]+$/.test(suffix)) return `${text.failoverGroup} ${groupIndex + 1}: ${text.errors.varNameInvalid}`
      if (names.has(name)) return `${text.failoverGroup} ${groupIndex + 1}: ${text.errors.varNameDuplicate}`
      names.add(name)
      const members = Array.isArray(group.members) ? group.members : []
      if (members.length < 2) return `${name}: ${text.failoverNeedsTwo}`
      const families = new Set()
      for (const member of members) {
        const candidate = candidateMap.get(memberKeyOf(member))
        if (!candidate) return `${name}: ${text.failoverMissingMember}`
        families.add(candidate.family)
      }
      if (families.size > 1) return `${name}: ${text.failoverSameFamily}`
      const retries = Number(group.max_retries)
      if (!Number.isInteger(retries) || retries < 0) return `${name}: ${text.failoverRetriesInvalid}`
      const delay = Number(group.base_delay)
      if (!Number.isFinite(delay) || delay < 0) return `${name}: ${text.failoverDelayInvalid}`
      if (group.spring_back !== '' && group.spring_back !== undefined && group.spring_back !== null) {
        const springBack = Number(group.spring_back)
        if (!Number.isInteger(springBack) || springBack <= 0) return `${name}: ${text.failoverSpringInvalid}`
      }
    }
    return ''
  })()

  const blocked = summary.errors > 0 || Boolean(failoverError)
  const saving = saveState.status === 'saving'

  const toggleRow = id => setExpanded(current => {
    return current.has(id) ? new Set() : new Set([id])
  })

  const applyRowOrder = (nextProfiles, nextGroups, orderedRows) => {
    const next = applyModelAndFailoverOrder(nextProfiles, nextGroups, orderedRows)
    setProfiles(next.profiles)
    setFailoverGroups(next.failoverGroups)
  }
  const moveRow = (from, to) => applyRowOrder(profiles, failoverGroups, moveOrderedItem(rows, from, to))
  const dragRow = ({ active, over }) => {
    if (!over || active.id === over.id) return
    const from = rows.findIndex(row => row.id === active.id)
    const to = rows.findIndex(row => row.id === over.id)
    if (from === -1 || to === -1) return
    applyRowOrder(profiles, failoverGroups, arrayMove(rows, from, to))
  }

  // Whatever is added lands at the end of the call list, so an existing
  // --llm-no never shifts under the operator.
  const appendRows = (nextProfiles, nextGroups) => {
    const known = new Set(rows.map(row => row.id))
    const fresh = orderedModelAndFailoverRows(nextProfiles, nextGroups).filter(row => !known.has(row.id))
    applyRowOrder(nextProfiles, nextGroups, [...rows, ...fresh])
  }

  const patchModelConfigs = (profileIndex, nextProfile) => patchProfile(profileIndex, {
    model: nextProfile.model,
    models: nextProfile.models,
    model_configs: nextProfile.model_configs,
  })

  const addModels = (profileIndex, models) => {
    const profile = profiles[profileIndex]
    if (!profile) return
    const next = addModelConfigs(profile, models)
    appendRows(profiles.map((item, index) => index === profileIndex ? next : item), failoverGroups)
  }

  const removeModel = async row => {
    const profile = profiles[row.profileIndex]
    const config = profileModelConfigs(profile || {})[row.configIndex]
    if (!await confirmDanger('model-remove', text.removeModelConfirm(config?.model || row.variableName))) return
    const key = memberKeyOf({ provider_var_name: profile?.var_name, model: config?.model })
    setFailoverGroups(groups => groups.map(group => ({
      ...group,
      members: (group.members || []).filter(member => memberKeyOf(member) !== key),
    })))
    patchModelConfigs(row.profileIndex, removeModelConfig(profile, row.configIndex))
  }

  const addGroup = () => {
    const group = { var_name: nextFailoverGroupName(failoverGroups), members: [], max_retries: 10, base_delay: 0.5 }
    const nextGroups = [...failoverGroups, group]
    appendRows(profiles, nextGroups)
    setExpanded(new Set([`failover:${failoverGroups.length}`]))
  }
  const patchGroup = (groupIndex, patch) => setFailoverGroups(current => current.map(
    (group, index) => index === groupIndex ? { ...group, ...patch } : group,
  ))
  const removeGroup = async groupIndex => {
    if (!await confirmDanger('model-failover-group-remove', text.removeGroupConfirm(failoverGroups[groupIndex]?.var_name || ''))) return
    setFailoverGroups(current => current.filter((_, index) => index !== groupIndex))
  }
  const toggleMember = (groupIndex, candidate) => {
    const candidateMember = {
      provider_var_name: candidate.providerVarName,
      model: candidate.model,
      ...(candidate.instanceId ? { instance_id: candidate.instanceId } : {}),
    }
    const key = memberKeyOf(candidateMember)
    setFailoverGroups(current => current.map((group, index) => {
      if (index !== groupIndex) return group
      const members = Array.isArray(group.members) ? group.members : []
      return {
        ...group,
        members: members.some(member => memberKeyOf(member) === key)
          ? members.filter(member => memberKeyOf(member) !== key)
          : [...members, candidateMember],
      }
    }))
  }
  const moveMember = (groupIndex, from, to) => patchGroup(groupIndex, {
    members: moveOrderedItem(failoverGroups[groupIndex]?.members || [], from, to),
  })
  const removeMember = (groupIndex, memberIndex) => patchGroup(groupIndex, {
    members: (failoverGroups[groupIndex]?.members || []).filter((_, index) => index !== memberIndex),
  })

  const openProvider = index => {
    setProviderDrawer({ mode: 'edit', index })
    setProviderDraft(null)
  }
  const closeProvider = async () => {
    if (providerDrawer?.mode === 'create' && providerDraft &&
      [providerDraft.display_name, providerDraft.apibase, providerDraft.apikey].some(value => String(value || '').trim()) &&
      !await confirmDanger('discard_new_provider', /[\u3400-\u9fff]/.test(text.saveAll) ? '\u653e\u5f03\u672a\u6dfb\u52a0\u7684\u670d\u52a1\u5546\uff1f' : 'Discard the new provider draft?')) return
    setProviderDrawer(null)
  }
  const openNewProvider = () => {
    setWorkspace('providers')
    setAddModelIndex(null)
    setProviderDraft({
      ...emptyProfile(profiles.length, DEFAULT_PROTOCOL),
      var_name: nextProviderVarName(protocolMeta(DEFAULT_PROTOCOL)?.prefix, profiles),
      display_name: '',
      type: DEFAULT_PROTOCOL,
      apibase: '',
      apikey: '',
      model: '',
      models: [],
      model_configs: [],
    })
    setProviderDrawer({ mode: 'create' })
  }
  const createProvider = async () => {
    if (!String(providerDraft?.display_name || '').trim() || !String(providerDraft?.apibase || '').trim()) {
      await showAppAlert(text.providerFormIncomplete, { operation: 'model-provider-create' })
      return
    }
    addModelProfiles([{ ...providerDraft, apibase: providerDraft.apibase.trim() }])
    setProviderDrawer(null)
    setWorkspace('models')
    // A provider only matters once it has models, so keep the flow going.
    setAddModelIndex(profiles.length)
  }
  const removeProvider = async index => {
    const profile = profiles[index]
    const name = providerName(profile) || text.provider(index + 1)
    if (!await confirmDanger('model-provider-remove', text.deleteConfirm(name, profileModels(profile).length))) return
    setFailoverGroups(groups => groups.map(group => ({
      ...group,
      members: (group.members || []).filter(member => member.provider_var_name !== profile?.var_name),
    })))
    removeModelProfile(index)
    setProviderDrawer(null)
  }

  // The drawer keeps rendering its last subject while it slides shut, so the
  // form does not blank out on the way out.
  if (providerDrawer) closingDrawer.current = providerDrawer
  const shownDrawer = providerDrawer || closingDrawer.current
  const drawerIndex = shownDrawer?.mode === 'edit' ? shownDrawer.index : undefined
  const drawerProfile = shownDrawer?.mode === 'create' ? providerDraft : profiles[drawerIndex]
  const drawerKey = drawerProfile && drawerIndex !== undefined ? profileKeyId(drawerIndex, drawerProfile) : ''

  const { view: riskView, retained: retainedRisks } = modelRiskView(risk, summary, text)
  const riskItems = [{
    key: 'risk',
    label: <Space size={7}><AlertTriangle size={14} />{text.riskTitle}</Space>,
    children: (
      <div className="model-risk-content">
        <UiSurface name="admin.models.risks" viewProps={{ view: riskView }} />
        {/* Dynamic catalog fields and server errors may contain credentials.
            Keep them outside all UI-package props, including children/slots. */}
        <div data-model-risk-host-details="">
          {risk.error && <Alert type="error" showIcon message={text.riskUnavailable} description={risk.error} />}
          {retainedRisks.map(({ index, item }) => (
            <div className="model-risk-row" key={index}>
              <div className="model-risk-route"><code>{item.method} {item.route}</code><Tag color={item.level === 'dangerous' ? 'red' : 'gold'}>{item.level}</Tag></div>
              <strong>{item.action}</strong><p>{item.reason}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  }]

  return (
    <section className="models-page">
      <p className="model-workbench-scope">{/[\u3400-\u9fff]/.test(text.saveAll) ? '编辑仅更新当前草稿；发现模型会请求服务商，但不会保存配置。请检查校验提示，再使用页面保存统一提交。' : 'Edits update this draft only. Discovery queries the provider without saving configuration. Review validation messages, then save all changes from this page.'}</p>
      <header className="model-save-bar">
        <div className="model-toolbar-main">
          <nav className="model-workspace-tabs" aria-label={text.configSummary}>
            <button
              type="button"
              className={workspace === 'models' ? 'is-active' : ''}
              aria-pressed={workspace === 'models'}
              onClick={() => setWorkspace('models')}
            >
              <Layers size={14} />
              <span>{text.callListTitle}</span>
              <b>{rows.length}</b>
            </button>
            <button
              type="button"
              className={workspace === 'providers' ? 'is-active' : ''}
              aria-pressed={workspace === 'providers'}
              onClick={() => setWorkspace('providers')}
            >
              <Network size={14} />
              <span>{text.connections}</span>
              <b className={summary.errors ? 'is-error' : ''}>{summary.total}</b>
            </button>
          </nav>
          <div className="model-save-summary" aria-label={text.configSummary}>
            <span className={`model-summary-dot${blocked ? ' is-error' : changes.total ? ' is-dirty' : ''}`} />
            <strong>{text.models(totalModels)}</strong>
            <span>{text.providers(summary.total)}</span>
            {summary.errors > 0 && <span className="is-error">{text.blockItems(summary.errors)}</span>}
            {summary.warnings > 0 && <span className="is-warning">{text.reminders(summary.warnings)}</span>}
            <span className="model-save-source"><FileCode2 size={13} /><code>mykey.py</code></span>
          </div>
        </div>
        <UiSurface name="admin.models.transfer" viewProps={{
          transfer: {
            labels: { reread: text.rereadConfig, preview: text.configPreview, discard: text.discard, save: text.saveAll },
            draftLabel: changes.total ? text.unsavedChanges(changes.total) : text.inSync,
            dirty: Boolean(changes.total), importing: Boolean(importLoading), saving,
            discardDisabled: !changes.total || saving,
            saveDisabled: blocked || !changes.total,
            saveTitle: blocked ? text.saveBlocked : text.saveAll,
          },
          actions: {
            reread: () => { if (!importLoading) return importModels() },
            openPreview: async () => { setPreviewOpen(true); await previewModels() },
            discard: async () => {
              if (!changes.total || saving) return
              if (await confirmDanger('models-discard', text.discardConfirm)) discardDraft()
            },
            save: () => { if (!blocked && changes.total && !saving) return saveAll() },
          },
        }} />
      </header>

      {modelInstance && <Alert
        type="info"
        showIcon
        message={`${modelInstanceLabel}: ${modelInstance.name || modelInstance.id} (${modelInstance.id})`}
        className="model-page-alert"
      />}
      {summary.errors > 0 && <Alert type="error" showIcon message={text.pageHasErrors} className="model-page-alert" />}
      {failoverError && <Alert type="error" showIcon message={failoverError} className="model-page-alert" />}
      {saveState.status === 'error' && <Alert type="error" showIcon message={text.saveFailed} description={saveState.error} className="model-page-alert" />}

      <section
        className={`model-call-list${workspace !== 'models' ? ' is-workspace-hidden' : ''}`}
        aria-label={text.callListTitle}
        aria-hidden={workspace !== 'models'}
      >
        <UiSurface name="admin.models.calls" viewProps={{
          model: {
            title: text.callListTitle, help: text.callListIntro,
            addLabel: text.addModel, addGroupLabel: text.addFailoverGroup,
            canAdd: Boolean(profiles.length), canGroup: candidates.length >= 2,
            groupHelp: candidates.length < 2 ? text.failoverNeedsTwo : '',
            emptyTitle: importLoading ? text.loadingMykey : profiles.length ? text.callListEmpty : text.noProviders,
            emptyHelp: importLoading ? text.loadingHelp : profiles.length ? text.callListEmptyHelp : text.noProvidersHelp,
            emptyAction: profiles.length ? text.addModel : text.addProvider, loading: importLoading,
            labels: { reorder: text.reorderRow, configure: text.configure, collapse: text.collapse,
              up: text.moveUp, down: text.moveDown, remove: t.delete, provider: text.openProvider,
              group: text.failoverGroup, removeGroup: text.removeGroup, removeModel: text.removeModel },
            rows: rows.map((row, index) => {
              const group = row.type === 'failover'
              const actionName = group ? row.varName : (row.model || row.variableName)
              return {
                id: row.id, group, actionName, title: row.displayName || actionName || text.missingModelId,
                variable: group ? row.varName : row.variableName,
                detail: group ? text.failoverMembersCount(row.members?.length || 0) : row.displayName ? row.model : '',
                provider: group ? '' : row.providerName || text.unnamed,
                slot: row.officialIndex ?? '?', expanded: expanded.has(row.id),
                canMoveUp: index > 0, canMoveDown: index < rows.length - 1,
              }
            }),
          },
          actions: {
            addModel: () => setAddModelIndex(0), addGroup, addProvider: openNewProvider,
            toggle: id => { if (rows.some(row => row.id === id)) toggleRow(id) },
            openProvider: id => { const row = rows.find(item => item.id === id); if (row?.type !== 'failover' && row) openProvider(row.profileIndex) },
            remove: id => { const row = rows.find(item => item.id === id); if (row) return row.type === 'failover' ? removeGroup(row.groupIndex) : removeModel(row) },
            moveUp: id => { const index = rows.findIndex(row => row.id === id); if (index > 0) moveRow(index, index - 1) },
            moveDown: id => { const index = rows.findIndex(row => row.id === id); if (index >= 0 && index < rows.length - 1) moveRow(index, index + 1) },
            reorder: (activeId, overId) => dragRow({ active: { id: activeId }, over: { id: overId } }),
          },
        }}/>
        {/* Editors remain mounted in the stable host, outside package boundaries. */}
        {rows.map(row => (
          <Drawer key={row.id} open={expanded.has(row.id)} onClose={() => toggleRow(row.id)} width={720}
            title={row.displayName || (row.type === 'failover' ? row.varName : row.model || row.variableName)} rootClassName="model-row-detail-drawer">
            <p className="model-detail-scope">{/[\u3400-\u9fff]/.test(text.configure) ? '\u4fee\u6539\u4fdd\u7559\u5728\u9875\u9762\u8349\u7a3f\uff0c\u5173\u95ed\u4e0d\u4f1a\u4fdd\u5b58\u5230 GA\u3002' : 'Changes stay in the page draft. Closing does not save to GA.'}</p>
                    {row.type === 'failover' ? (
                      <FailoverGroupBody
                        group={failoverGroups[row.groupIndex] || {}}
                        groupIndex={row.groupIndex}
                        candidates={candidates}
                        candidateMap={candidateMap}
                        sensors={sensors}
                        patchGroup={patchGroup}
                        toggleMember={toggleMember}
                        moveMember={moveMember}
                        removeMember={removeMember}
                        text={text}
                      />
                    ) : (
                      <ModelParams
                        config={profileModelConfigs(profiles[row.profileIndex] || {})[row.configIndex] || {}}
                        protocol={profiles[row.profileIndex]?.type || DEFAULT_PROTOCOL}
                        onChange={patch => patchModelConfigs(
                          row.profileIndex,
                          updateModelConfig(profiles[row.profileIndex], row.configIndex, patch),
                        )}
                        t={t}
                      />
                    )}
          </Drawer>
        ))}
      </section>

      <section
        className={`model-connections${workspace !== 'providers' ? ' is-workspace-hidden' : ''}`}
        aria-label={text.connections}
        aria-hidden={workspace !== 'providers'}
      >
        <UiSurface name="admin.models.providers" viewProps={{
          model: {
            title: text.connections, help: text.connectionsHelp,
            addLabel: text.addProvider, emptyLabel: text.noProvidersHelp,
            editLabel: text.configure, addModelLabel: text.addModel, deleteLabel: t.delete,
            columns: { name: text.name, endpoint: 'BaseURL', protocol: text.protocol, models: text.model },
            providers: profiles.map((profile, index) => {
              const state = providerState(validation[index])
              // Display-only origin: never pass credentials, URL paths/query,
              // model configs, revealed keys or raw profiles to a UI package.
              let endpoint = text.baseMissing
              try {
                const url = new URL(profile.apibase)
                if (['https:', 'http:'].includes(url.protocol)) endpoint = url.origin
              } catch { /* Invalid URLs remain editable in the host form. */ }
              return {
                id: index, name: providerName(profile) || text.provider(index + 1),
                endpoint, protocol: protocolLabel(profile.type || DEFAULT_PROTOCOL, t),
                modelCount: text.modelCount(profileModels(profile).length), state,
                stateLabel: state === 'error' ? text.stateError : state === 'warning' ? text.stateWarning : text.stateReady,
              }
            }),
          },
          actions: {
            addProvider: openNewProvider,
            openProvider: index => { if (Number.isInteger(index) && profiles[index]) openProvider(index) },
            addModel: index => { if (Number.isInteger(index) && profiles[index]) setAddModelIndex(index) },
            removeProvider: index => { if (Number.isInteger(index) && profiles[index]) return removeProvider(index) },
          },
        }}/>
      </section>

      <Collapse ghost items={riskItems} className="model-risk-collapse" />

      <ProviderModal
        open={Boolean(providerDrawer)}
        mode={shownDrawer?.mode}
        profile={drawerProfile}
        index={drawerIndex}
        profiles={profiles}
        result={drawerIndex === undefined ? null : validation[drawerIndex]}
        onClose={closeProvider}
        onChange={patch => shownDrawer?.mode === 'create'
          ? setProviderDraft(current => ({ ...current, ...patch }))
          : patchProfile(drawerIndex, patch)}
        onCreate={createProvider}
        onRemove={() => removeProvider(drawerIndex)}
        onAddModels={() => setAddModelIndex(drawerIndex)}
        onRemoveModel={(configIndex, config) => removeModel({
          profileIndex: drawerIndex,
          configIndex,
          variableName: config?.model,
        })}
        revealedKey={revealedKeys[drawerKey]}
        revealBusy={!!revealBusy[drawerKey]}
        onRevealKey={onRevealKey}
        onClearRevealedKey={onClearRevealedKey}
        t={t}
      />

      <AddModelModal
        key={`add-model-${addModelIndex}`}
        open={addModelIndex !== null}
        profiles={profiles}
        initialIndex={addModelIndex ?? 0}
        onClose={() => setAddModelIndex(null)}
        onAdd={addModels}
        discoverModels={discoverModels}
        onCreateProvider={openNewProvider}
        t={t}
      />

      <Drawer
        title={text.previewTitle}
        placement="right"
        width={680}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        className="model-preview-drawer"
      >
        <UiSurface name="admin.models.preview.controls" viewProps={{
          preview: { notice: text.previewSecret, refreshLabel: text.refreshPreview },
          actions: { refresh: () => previewModels() },
        }} />
        <pre className="model-preview-pre">{modelPreview || (profiles.length ? text.generatingPreview : text.previewNeedsProvider)}</pre>
      </Drawer>
    </section>
  )
}
