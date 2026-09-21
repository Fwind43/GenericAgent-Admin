import React, { useCallback, useEffect, useRef, useState } from 'react'
import Modal from 'antd/es/modal'
import { AlertTriangle, Info } from 'lucide-react'
import { registerDialogAdapter } from '../lib/danger'

const FALLBACK_COPY = {
  zh: {
    confirmTitle: '\u786e\u8ba4\u64cd\u4f5c',
    alertTitle: '\u63d0\u793a',
    confirm: '\u786e\u8ba4',
    cancel: '\u53d6\u6d88',
    close: '\u77e5\u9053\u4e86',
  },
  en: {
    confirmTitle: 'Confirm action',
    alertTitle: 'Notice',
    confirm: 'Confirm',
    cancel: 'Cancel',
    close: 'Got it',
  },
}

export function AppDialogHost() {
  const [queue, setQueue] = useState([])
  const settledItems = useRef(new WeakSet())
  const present = useCallback(request => new Promise(resolve => {
    setQueue(current => [...current, { request, resolve }])
  }), [])

  useEffect(() => registerDialogAdapter(present), [present])

  const item = queue[0]
  if (!item) return null

  const { request, resolve } = item
  const locale = request.locale === 'en' ? 'en' : 'zh'
  const copy = FALLBACK_COPY[locale]
  const isAlert = request.kind === 'alert'
  const settle = result => {
    if (settledItems.current.has(item)) return
    settledItems.current.add(item)
    resolve(result)
    setQueue(current => current[0] === item ? current.slice(1) : current)
  }
  const icon = isAlert
    ? <Info size={20} aria-hidden="true" />
    : <AlertTriangle size={20} aria-hidden="true" />

  return <Modal
    open
    centered
    width={480}
    className={`app-dialog app-dialog-${isAlert ? 'alert' : 'confirm'}`}
    title={<span className="app-dialog-title">{icon}{request.title || (isAlert ? copy.alertTitle : copy.confirmTitle)}</span>}
    okText={request.confirmLabel || (isAlert ? copy.close : copy.confirm)}
    cancelText={request.cancelLabel || copy.cancel}
    cancelButtonProps={{ className: isAlert ? 'app-dialog-cancel-hidden' : '' }}
    okButtonProps={{ danger: !isAlert }}
    mask={{ closable: false }}
    keyboard
    onOk={() => settle(true)}
    onCancel={() => settle(isAlert)}
  >
    <div className="app-dialog-body">
      {request.operation && <code className="app-dialog-operation">{request.operation}</code>}
      <p>{request.message}</p>
    </div>
  </Modal>
}
