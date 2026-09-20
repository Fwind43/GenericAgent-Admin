import { Input, Select } from 'antd'
import './modelEditorCommon.css'

const fields = [
  ['name', 'setName', 'name'],
  ['temperature', 'setTemperature', 'temperature', 'number', 0, 'any'],
  ['maxTokens', 'setMaxTokens', 'max_tokens', 'number', 1, 1],
  ['maxRetryAfter', 'setMaxRetryAfter', 'max_retry_after', 'number', 0, 'any'],
  ['omitThinking', 'setOmitThinking', 'omit_thinking', 'boolean'],
  ['stream', 'setStream', 'stream', 'boolean'],
  ['maxRetries', 'setMaxRetries', 'maxRetries', 'number', 0],
  ['readTimeout', 'setReadTimeout', 'readTimeout', 'number', 1],
  ['connectTimeout', 'setConnectTimeout', 'connectTimeout', 'number', 1],
]
function Field({ field: [key, action, label, type, min, step], model, actions }) {
  const title = model.labels[label] || label
  return <label className="model-field">
    <span className="model-field-label">{title}</span>
    {type === 'boolean'
      ? <Select aria-label={title} value={model.values[key] ?? 'inherit'}
          options={[{ value: 'inherit', label: model.labels.inherit }, { value: true, label: model.labels.enabled }, { value: false, label: model.labels.disabled }]}
          onChange={value => actions[action](value === 'inherit' ? undefined : value)} />
      : <Input aria-label={title} type={type || 'text'} min={min} step={step}
          value={model.values[key]} placeholder={key === 'name' ? model.labels.namePlaceholder : model.labels.inherit}
          onChange={event => actions[action](event.target.value)} />}
  </label>
}
export function DefaultModelEditorCommon({ model, actions }) {
  return <section className="model-subsection model-editor-common" data-model-editor-common="default" aria-label={model.title}>
    <div className="model-subsection-head"><strong>{model.title}</strong><span>{model.modelId}</span></div>
    <p className="model-subsection-help">{model.help}</p>
    <div className="model-params-grid">{fields.map(field => <Field key={field[0]} field={field} model={model} actions={actions} />)}</div>
  </section>
}
export function StudioModelEditorCommon({ model, actions }) {
  const groups = [fields.slice(0, 1), fields.slice(1, 5), fields.slice(5)]
  return <section className="model-subsection model-editor-common model-editor-common-studio" data-model-editor-common="studio" aria-label={model.title}>
    <header><strong>{model.title}</strong><code>{model.modelId}</code><p className="model-subsection-help">{model.help}</p></header>
    <div className="model-editor-common-panels">{groups.map((group, index) => <fieldset key={index}>
      <legend>{index === 0 ? model.labels.name : index === 1 ? 'temperature / tokens' : model.labels.stream}</legend>
      <div className="model-params-grid">{group.map(field => <Field key={field[0]} field={field} model={model} actions={actions} />)}</div>
    </fieldset>)}</div>
  </section>
}
