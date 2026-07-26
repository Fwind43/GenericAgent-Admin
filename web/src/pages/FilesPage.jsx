import { Download, RotateCcw, Save, Search, Trash2 } from 'lucide-react'
import { Panel } from '../components/common'
import { StatusNotice } from '../components/feedback'
import { fileEditorDirty } from '../lib/filesSafety'

export function FilesPage({
  t,
  filePath,
  setFilePath,
  fileList,
  fileContent,
  loadedFileContent = '',
  loadedFilePath = '',
  setFileContent,
  fileSearch,
  setFileSearch,
  searchHits,
  tailLines,
  setTailLines,
  loadFiles,
  readFile,
  tailFile,
  saveFile,
  deleteFile,
  downloadFile,
  runSearch,
  discardChanges,
  fileStatus = {},
  dismissFileStatus,
  busy = false,
}) {
  const dirty = fileEditorDirty(fileContent, loadedFileContent)
  const text = t.files
  const retargeted = Boolean(loadedFilePath && filePath && loadedFilePath !== filePath)
  const saveReview = !filePath ? text.chooseBeforeSave : retargeted ? text.reviewRetargeted(loadedFilePath, filePath) : dirty ? text.reviewDirty(filePath) : text.reviewClean(filePath)
  const hasLoadedTarget = Boolean(String(loadedFilePath || '').trim())
  const saveDisabled = !hasLoadedTarget || !filePath || !dirty
  const saveDisabledReason = !hasLoadedTarget
    ? text.readFirst
    : !filePath
      ? text.chooseSaveTarget
      : !dirty
        ? text.noChanges(loadedFilePath)
        : ''
  const fileListEmpty = !fileList?.length
  const searchEmpty = !searchHits?.length
  const hasFilePath = Boolean(String(filePath || '').trim())
  const searchAttempted = fileStatus?.action === 'search' && fileStatus?.kind === 'success'
  const searchHint = fileSearch ? text.searchSelected : text.searchPrompt
  const fileListHint = hasFilePath
    ? text.noFilesPath
    : text.noRootPath
  return (
    <section className="file-workflow-page">
      <ol className="file-workflow-steps" aria-label={text.workflow}>
        <li><b>1</b><span>{text.chooseFile}</span></li>
        <li><b>2</b><span>{text.readFile}</span></li>
        <li><b>3</b><span>{text.editContent}</span></li>
        <li><b>4</b><span>{text.reviewTarget}</span></li>
        <li><b>5</b><span>{text.saveOrDiscard}</span></li>
      </ol>
      <StatusNotice
        kind={fileStatus?.kind}
        message={fileStatus?.message}
        onRetry={fileStatus?.onRetry}
        onDismiss={dismissFileStatus}
        retryLabel={text.retryAction}
      />
      <div className="workspace">
        <Panel title={t.lists.fileList}>
          <div className="inline-form">
            <input value={filePath} onChange={e => setFilePath(e.target.value)} placeholder={t.hints.filePath}/>
            <button onClick={() => loadFiles(filePath)} disabled={busy || !hasFilePath}>{t.read}</button>
          </div>
          <div className="inline-form">
            <input value={fileSearch} onChange={e => setFileSearch(e.target.value)} placeholder={t.hints.searchText}/>
            <button onClick={runSearch} disabled={busy || !String(fileSearch || '').trim()}><Search size={14} aria-hidden="true"/>{t.search}</button>
          </div>
          <div className="inline-form">
            <input type="number" value={tailLines} onChange={e => setTailLines(Number(e.target.value))}/>
            <span>{t.hints.tailLines}</span>
            <button onClick={() => tailFile(filePath)} disabled={!filePath || busy}>{t.tail}</button>
            <button onClick={() => downloadFile(filePath)} disabled={!filePath || busy} title={text.readOnlyDownload}><Download size={14} aria-hidden="true"/>{t.download}</button>
            <button onClick={() => deleteFile(filePath)} disabled={!filePath || busy} title={text.destructiveDelete}><Trash2 size={14} aria-hidden="true"/>{t.delete}</button>
          </div>
          <p className="operation-note" role="note">{text.safetyNote}</p>
          <div className="file-list">
            {fileListEmpty && <div className="empty-card" role="status"><b>{hasFilePath ? text.folderEmpty : text.chooseRoot}</b><span>{t.hints?.fileListEmpty || fileListHint}</span></div>}
            {fileList.map(e => <button key={e.path} onClick={() => e.kind === 'dir' ? loadFiles(e.path) : readFile(e.path)}>{e.kind === 'dir' ? '📁' : '📄'} {e.path}</button>)}
          </div>
          <h4>{t.lists.searchResults}</h4>
          {searchEmpty && (searchAttempted
            ? <div className="empty-card file-search-empty" role="status"><b>{text.noMatches}</b><span>{text.broaderSearch}</span></div>
            : <p className="muted">{t.hints?.searchEmpty || searchHint}</p>)}
          {searchHits.map(h => <button className="hit" key={`${h.path}:${h.line}`} onClick={() => readFile(h.path)}>{h.path}:{h.line} · {h.preview}</button>)}
        </Panel>
        <Panel title={t.lists.filePreview} className="log-panel">
          <div className="file-editor-toolbar">
            <span className={dirty ? 'status-pill warn' : 'status-pill ok'}>{dirty ? text.dirty : text.clean}</span>
            {loadedFilePath && <span className="muted">{text.loaded}: {loadedFilePath}</span>}
            {retargeted && <span className="status-pill bad">{text.targetChanged}</span>}
          </div>
          <div className={`file-save-review ${retargeted ? 'bad' : dirty ? 'warn' : 'ok'}`} role="status" aria-live="polite">
            {saveReview}
          </div>
          <div className="file-editor-actions">
            <button type="button" className="primary-action" onClick={saveFile} disabled={saveDisabled || busy} aria-describedby="file-save-reason">
              <Save size={14} aria-hidden="true"/>{t.save}
            </button>
            <button type="button" onClick={discardChanges} disabled={!hasLoadedTarget || !dirty || busy}>
              <RotateCcw size={14} aria-hidden="true"/>{text.discard}
            </button>
            <span id="file-save-reason" className="file-save-reason" role="note">
              {saveDisabledReason || text.readyToSave(filePath)}
            </span>
          </div>
          {!loadedFilePath && !fileContent && <div className="empty-card" role="status"><b>{text.noFileLoaded}</b><span>{text.noFileLoadedHelp}</span></div>}
          <textarea className="file-editor" value={fileContent} onChange={e => setFileContent(e.target.value)} placeholder={t.empty} aria-label={text.editorLabel}/>
        </Panel>
      </div>
    </section>
  )
}
