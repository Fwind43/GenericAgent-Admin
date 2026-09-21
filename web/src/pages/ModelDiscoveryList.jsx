import { useState } from 'react'
import { Button, Input } from 'antd'
import './model-discovery.css'

export function partitionDiscoveredModels(candidates, existing) {
  const ids = new Set(existing.map(value => String(value || '').trim()).filter(Boolean))
  const unique = [...new Set(candidates.map(value => String(value || '').trim()).filter(Boolean))]
  return { pending: unique.filter(id => !ids.has(id)), added: unique.filter(id => ids.has(id)) }
}

export default function ModelDiscoveryList({ candidates, existing, onAdd, english = false }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('pending')
  const groups = partitionDiscoveredModels(candidates, existing)
  const match = id => id.toLowerCase().includes(query.trim().toLowerCase())
  const visible = groups[category].filter(match)
  const pending = groups.pending.filter(match)
  const label = (zh, en) => english ? en : zh
  return <section className="model-discovery">
    <div className="model-discovery-toolbar">
      <div role="group" aria-label={label('添加状态', 'Addition status')} className="model-discovery-tabs">
        {['pending', 'added'].map(key => <button key={key} type="button" aria-pressed={category === key} onClick={() => setCategory(key)}>
          {key === 'pending' ? label('未添加', 'Not added') : label('已添加', 'Added')} <span>{groups[key].length}</span>
        </button>)}
      </div>
      <Button type="primary" disabled={!pending.length || category !== 'pending'} onClick={() => onAdd(pending)}>
        {query.trim() ? label('添加筛选结果', 'Add filtered') : label('一键添加未添加模型', 'Add all missing')} ({pending.length})
      </Button>
    </div>
    <Input allowClear value={query} onChange={event => setQuery(event.target.value)} placeholder={label('搜索模型 ID', 'Search model IDs')} aria-label={label('搜索模型 ID', 'Search model IDs')} />
    <div className="model-discovery-results">
      {visible.map(model => <div className="model-discovery-row" key={model}>
        <span title={model}>{model}</span>
        {category === 'added' ? <small>{label('已添加', 'Added')}</small> : <Button size="small" onClick={() => onAdd([model])} aria-label={label(`添加 ${model}`, `Add ${model}`)}>{label('添加', 'Add')}</Button>}
      </div>)}
      {!visible.length && <p className="model-discovery-empty" role="status">{query.trim() ? label('没有匹配的模型', 'No matching models') : category === 'pending' && candidates.length ? label('该服务商的模型已全部添加', 'All provider models have been added') : label('暂无模型', 'No models')}</p>}
    </div>
    <small className="model-discovery-note">{label('按当前服务商区分已添加模型；添加后仍是草稿，保存后生效。需要重复实例时可手动填写模型 ID。', 'Status is scoped to this provider. Additions remain drafts until saved. Enter an ID manually to add another instance.')}</small>
  </section>
}
