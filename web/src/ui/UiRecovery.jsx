import React, { useState } from 'react'
import { writeSelection, browserStorage } from './selection'
import './host.css'
// No registry or candidate imports; no business root mounts here.
export default function UiRecovery() {
  const [result, setResult] = useState('')
  return <main style={{maxWidth:680,margin:'10vh auto',padding:24}}><h1>Interface recovery / 界面恢复</h1><p>This entry does not load a candidate package or business APIs. / 此入口不加载候选界面包或业务 API。</p><p>Reloading disconnects this tab's client streams; server tasks are not stopped. / 整页重载会断开本页客户端连接，不停止服务端任务。</p><button onClick={async () => { try { if (!writeSelection(browserStorage(), 'default')) throw new Error('Selection storage unavailable'); setResult('Default saved') } catch (e) { setResult(e.message) } }}>Restore default / 恢复默认</button><p role="status">{result}</p><a href="/admin/overview">Return to Overview / 返回概览</a><p>Shared entry/runtime failures are outside this recovery boundary. / 共用入口或运行时损坏不在本恢复边界内。</p></main>
}
