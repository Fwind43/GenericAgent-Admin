import React, { useState } from 'react'
import { Dropdown } from 'antd'
import { CircleAlert } from 'lucide-react'

const ct = (zh, en) => typeof localStorage !== 'undefined' && localStorage.getItem('ga-admin-lang') === 'en' ? en : zh

export default function ChatWaitingMenu({ sessions, sid, onOpen }) {
  const [open, setOpen] = useState(false)
  const label = ct('\u7b49\u5f85\u56de\u590d', 'Waiting for reply')
  const items = sessions.map(session => {
    const title = session.title || ct('\u65b0\u4f1a\u8bdd', 'New chat')
    return {
      key: session.id,
      label: <span className="oa-waiting-menu-copy">
        <b title={title}>{title}</b>
        {session.project_mode && <small title={session.project_mode}>{session.project_mode}</small>}
      </span>,
    }
  })
  return <Dropdown
    trigger={['click']}
    placement="bottomRight"
    open={open}
    onOpenChange={setOpen}
    classNames={{ root: 'oa-waiting-menu' }}
    menu={{ items, selectedKeys: [sid], onClick: ({ key }) => { setOpen(false); onOpen(key) } }}
  >
    <button className="oa-waiting-trigger" type="button" title={label}
      aria-label={`${label} (${sessions.length})`} aria-haspopup="menu" aria-expanded={open}>
      <CircleAlert size={16} aria-hidden="true"/>
      <span>{ct('\u5f85\u56de\u590d', 'Waiting')}</span>
      <strong>{sessions.length}</strong>
    </button>
  </Dropdown>
}
