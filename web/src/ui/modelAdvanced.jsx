import './modelAdvanced.css'

export function DefaultModelAdvanced({ model, actions }) {
  if (!model.controls.length) return null
  return <section className="model-advanced-default" aria-label={model.title} data-model-advanced="default">
    <div className="model-params-grid">{model.controls.map(control => <label className="model-field" key={control.key}>
      <span className="model-field-label">{control.label}</span>
      <select aria-label={control.label} value={control.value === '' ? '' : String(control.value)} onChange={event => {
        const option = control.options.find(item => String(item.value) === event.target.value)
        actions[control.action](option?.value)
      }}>
        <option value="">{model.inherit}</option>
        {control.options.map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
      </select>
    </label>)}</div>
  </section>
}

export function StudioModelAdvanced({ model, actions }) {
  if (!model.controls.length) return null
  return <section className="model-advanced-studio" aria-label={model.title} data-model-advanced="studio">
    {model.controls.map(control => <fieldset key={control.key}>
      <legend>{control.label}</legend>
      <div className="model-advanced-choices">
        <button type="button" aria-pressed={control.value === ''} onClick={() => actions[control.action](undefined)}>{model.inherit}</button>
        {control.options.map(option => <button type="button" key={String(option.value)} aria-pressed={control.value === option.value} onClick={() => actions[control.action](option.value)}>{option.label}</button>)}
      </div>
    </fieldset>)}
  </section>
}
