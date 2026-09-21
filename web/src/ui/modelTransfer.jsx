import React from 'react'
import Alert from 'antd/es/alert'
import Button from 'antd/es/button'
import { FileCode2, RefreshCw, RotateCcw, Save, UploadCloud } from 'lucide-react'
import './modelTransfer.css'

// Display-only contracts: no profiles, raw preview, catalog, auth or HTTP access.
export function DefaultModelTransfer({ transfer: m, actions }) {
  return <div className="model-save-actions" data-model-transfer="default">
    <span className={`model-draft-state${m.dirty ? ' is-dirty' : ''}`}>{m.draftLabel}</span>
    <Button className="model-utility-action" title={m.labels.reread} aria-label={m.labels.reread} icon={<UploadCloud size={14} />} onClick={actions.reread} loading={m.importing} />
    <Button className="model-utility-action" title={m.labels.preview} aria-label={m.labels.preview} icon={<FileCode2 size={14} />} onClick={actions.openPreview} />
    <Button className="model-utility-action" danger title={m.labels.discard} aria-label={m.labels.discard} icon={<RotateCcw size={14} />} disabled={m.discardDisabled} onClick={actions.discard} />
    <Button className="model-save-action" type="primary" title={m.saveTitle} icon={<Save size={14} />} loading={m.saving} disabled={m.saveDisabled} onClick={actions.save}><span>{m.labels.save}</span></Button>
  </div>
}

export function StudioModelTransfer({ transfer: m, actions }) {
  return <section className="studio-model-transfer" data-model-transfer="studio" aria-label={m.draftLabel}>
    <div className="studio-model-transfer-read">
      <button type="button" disabled={m.importing} aria-busy={m.importing} onClick={actions.reread}><UploadCloud size={15} />{m.labels.reread}</button>
      <button type="button" onClick={actions.openPreview}><FileCode2 size={15} />{m.labels.preview}</button>
    </div>
    <div className="studio-model-transfer-commit">
      <output className={m.dirty ? 'is-dirty' : ''}>{m.draftLabel}</output>
      <div>
        <button type="button" className="is-discard" disabled={m.discardDisabled} onClick={actions.discard}>{m.labels.discard}</button>
        <button type="button" className="is-save" title={m.saveTitle} aria-busy={m.saving} disabled={m.saveDisabled || m.saving} onClick={actions.save}><Save size={15} />{m.labels.save}</button>
      </div>
    </div>
  </section>
}

export function DefaultModelPreviewControls({ preview, actions }) {
  return <div className="model-preview-controls" data-model-preview-controls="default">
    <Alert type="info" showIcon message={preview.notice} />
    <Button icon={<RefreshCw size={14} />} onClick={actions.refresh}>{preview.refreshLabel}</Button>
  </div>
}

export function StudioModelPreviewControls({ preview, actions }) {
  return <aside className="studio-model-preview-controls" data-model-preview-controls="studio">
    <FileCode2 size={22} aria-hidden="true" />
    <div><p role="note">{preview.notice}</p><button type="button" onClick={actions.refresh}><RefreshCw size={14} />{preview.refreshLabel}</button></div>
  </aside>
}
