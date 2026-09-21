import React, { Suspense, lazy } from 'react'
import Modal from 'antd/es/modal'
import { ErrorBoundary, RouteFallback } from './feedback'
import './settings-modal.css'

const AdminSettings = lazy(() => import('../App'))

export default function SettingsModal({ open, onClose, lang = 'zh' }) {
  const zh = lang === 'zh'
  return <Modal
    open={open}
    onCancel={onClose}
    title={zh ? '\u8bbe\u7f6e' : 'Settings'}
    footer={null}
    width="min(1200px, calc(100vw - 48px))"
    className="settings-modal"
    zIndex={900}
    keyboard={false}
    mask={{ closable: false }}
    destroyOnHidden={false}
  >
    <p className="settings-modal-hint">{zh
      ? '\u5173\u95ed\u540e\u4fdd\u7559\u672c\u6b21\u8349\u7a3f\uff0c\u4e0d\u4f1a\u81ea\u52a8\u4fdd\u5b58\uff1b\u5237\u65b0\u6216\u79bb\u5f00\u9875\u9762\u4f1a\u4e22\u5931\u672a\u4fdd\u5b58\u5185\u5bb9\u3002'
      : 'Closing keeps this draft without saving. Refreshing or leaving the page loses unsaved changes.'}</p>
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback label={zh ? '\u52a0\u8f7d\u4e2d' : 'Loading'} />}>
        <AdminSettings embedded active={open} onClose={onClose}/>
      </Suspense>
    </ErrorBoundary>
  </Modal>
}
