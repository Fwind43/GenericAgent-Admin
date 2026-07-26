import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Col, Descriptions, Divider, Input, Row, Space, Steps, Tag, Typography } from 'antd'
import { Bot, CheckCircle2, Download, GitPullRequest, Play, RefreshCw, Terminal, Wand2 } from 'lucide-react'
import { api, apiStream } from '../lib/api.js'
import { confirmDanger } from '../lib/danger.js'

const { Paragraph, Text, Title } = Typography

const normalizeRoot = (value) => (value || '').trim()

function toolByName(tools, name) {
  return (Array.isArray(tools) ? tools : []).find(tool => tool?.name === name) || {}
}

function normalizeSetupEnv(payload = {}) {
  const tools = Array.isArray(payload.tools) ? payload.tools : []
  return {
    ...payload,
    python: payload.python || toolByName(tools, 'python'),
    git: payload.git || toolByName(tools, 'git'),
    uv: payload.uv || toolByName(tools, 'uv'),
    npm: payload.npm || toolByName(tools, 'npm'),
    can_auto_install_python: Boolean(payload.can_auto_install_python ?? payload.python_installer),
  }
}

function setupEnvError(error, english) {
  return normalizeSetupEnv({ ok: false, error: error?.message || String(error || (english ? 'Environment check failed' : '环境检测失败')), tools: [] })
}

function pythonDisplay(pythonPath, pythonInfo, english) {
  return pythonPath || pythonInfo.version || pythonInfo.path || pythonInfo.error || (english ? 'Not selected' : '未选择')
}

function statusText(state, english) {
  if (!state) return english ? 'Loading' : '读取中'
  if (state.bootstrap_done) return english ? 'Complete' : '已完成'
  if (state.ga_root) return english ? 'GA selected' : '已选择 GA'
  return english ? 'First-time setup' : '首次配置'
}

function isErrorMessage(message) {
  return /失败|错误|error|ERROR/i.test(message || '')
}

export default function SetupWizard({ initialRoot = '', onComplete, t }) {
  const english = t?.language === 'Language'
  const tr = (zh, en) => english ? en : zh
  const steps = [
    { key: 'root', title: tr('选择 GenericAgent', 'Choose GenericAgent'), desc: tr('接管已有源码目录，或安装到新目录。', 'Use an existing source directory or install into a new one.') },
    { key: 'venv', title: tr('创建 Python venv', 'Create Python venv'), desc: tr('在 GA 根目录下创建隔离虚拟环境。', 'Create an isolated environment inside the GA root.') },
    { key: 'deps', title: tr('安装依赖', 'Install dependencies'), desc: tr('执行 pip install -r requirements.txt，并显示实时日志。', 'Run pip install -r requirements.txt with live output.') },
    { key: 'smoke', title: tr('冒烟验证', 'Smoke test'), desc: tr('确认后端可用 Python 启动并识别 GA。', 'Verify the backend can start and recognize GA with Python.') },
    { key: 'complete', title: tr('完成接管', 'Finish setup'), desc: tr('写入 bootstrap_done，进入 GA Admin。', 'Write bootstrap_done and enter GA Admin.') }
  ]
  const [state, setState] = useState(null)
  const [root, setRoot] = useState(initialRoot || '')
  const [installPath, setInstallPath] = useState(initialRoot || '')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [logLines, setLogLines] = useState([])
  const [lastSmoke, setLastSmoke] = useState(null)
  const logRef = useRef(null)

  const effectiveRoot = normalizeRoot(root || state?.ga_root)
  const currentIndex = useMemo(() => {
    if (!effectiveRoot) return 0
    if (!state?.venv?.ok) return 1
    if (!lastSmoke?.ok) return 2
    return 4
  }, [effectiveRoot, state?.venv?.ok, lastSmoke?.ok])

  const reload = async () => {
    const [next, envResult] = await Promise.all([
      api('/api/setup/state'),
      api('/api/setup/env').catch(error => setupEnvError(error, english)),
    ])
    const merged = { ...next, env: normalizeSetupEnv(envResult) }
    setState(merged)
    if (merged?.ga_root && !root) setRoot(merged.ga_root)
    if (merged?.ga_root && !installPath) setInstallPath(merged.ga_root)
    return merged
  }

  const refresh = async () => {
    setBusy('setup-refresh')
    setMessage('')
    try {
      await reload()
      setMessage(tr('环境检测已刷新。', 'Environment check refreshed.'))
    } catch (e) {
      setMessage(e.message)
    } finally {
      setBusy('')
    }
  }

  useEffect(() => { reload().catch(e => setMessage(e.message)) }, [])
  useEffect(() => {
    if (!logRef.current) return
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines])

  const env = state?.env || {}
  const pythonInfo = env.python || {}
  const gitInfo = env.git || {}
  const osInfo = env.os || {}
  const pythonOk = Boolean(state?.python || pythonInfo.ok)
  const gitOk = Boolean(gitInfo.ok)
  const canInstallPython = Boolean(env.can_auto_install_python)
  const pythonStatus = pythonDisplay(state?.python, pythonInfo, english)
  const selectedPython = pythonDisplay(state?.python, pythonInfo, english)
  const gitStatus = gitInfo.version || gitInfo.path || gitInfo.error || tr('未检测到 Git，将使用 ZIP 归档安装', 'Git was not detected; installation will use a ZIP archive')
  const installSourceCopy = gitOk
    ? tr('优先使用 Git clone；如网络或 Git 异常，将自动回退到 GitHub ZIP 归档。', 'Git clone is preferred. Network or Git failures automatically fall back to a GitHub ZIP archive.')
    : tr('未检测到 Git，将直接下载 GitHub ZIP 归档安装 GenericAgent。', 'Git was not detected, so GenericAgent will be installed directly from a GitHub ZIP archive.')

  const runJson = async (operation, text, url, body = {}) => {
    if (!confirmDanger(operation, text)) return null
    setBusy(operation)
    setMessage('')
    try {
      const result = await api(url, { dangerous: true, method: 'POST', body: JSON.stringify(body) })
      if (result?.root) setRoot(result.root)
      if (result?.health || result?.venv || result?.config) await reload()
      return result
    } catch (e) {
      setMessage(e.message)
      return null
    } finally {
      setBusy('')
    }
  }

  const validateRoot = async () => {
    const target = normalizeRoot(root)
    if (!target) { setMessage(tr('请先填写 GenericAgent 根目录。', 'Enter the GenericAgent root first.')); return }
    const result = await runJson('setup-validate', tr(`验证并保存 GA 根目录：${target}？`, `Validate and save this GA root: ${target}?`), '/api/setup/validate', { path: target })
    if (!result) return
    setMessage(result.ok ? tr('GA 根目录验证通过。', 'GA root validation passed.') : tr('目录未通过 GA 健康检查，请确认包含 GenericAgent 源码。', 'The directory failed the GA health check. Confirm that it contains the GenericAgent source.'))
  }

  const installGA = async () => {
    const installDir = normalizeRoot(installPath || root)
    if (!installDir) { setMessage(tr('请填写安装父目录。', 'Enter the parent installation directory.')); return }
    const trimmedInstallDir = installDir.replace(/[\\/]+$/, '')
    const separator = trimmedInstallDir.includes('\\') ? '\\' : '/'
    const finalTarget = `${trimmedInstallDir}${separator}GenericAgent`
    const result = await runJson('setup-install', tr(`${installSourceCopy}\n安装父目录：${installDir}\n将生成 GA 根目录：${finalTarget}。继续？`, `${installSourceCopy}\nParent directory: ${installDir}\nGA root to create: ${finalTarget}. Continue?`), '/api/setup/install', { path: installDir })
    if (!result) return
    setMessage(result.ok ? tr(`GenericAgent 已通过 ${result.method === 'archive' ? 'ZIP 归档' : 'Git'} 安装/接管。`, `GenericAgent was installed and configured using ${result.method === 'archive' ? 'a ZIP archive' : 'Git'}.`) : tr('安装完成但健康检查未通过。', 'Installation completed, but the health check failed.'))
  }

  const installPython = async () => {
    if (!canInstallPython) {
      setMessage(tr('当前系统不支持内置 Python 安装器，请先手动安装 Python 3.11+ 后刷新环境。', 'The built-in Python installer is unavailable on this system. Install Python 3.11+ manually, then refresh the environment.'))
      return
    }
    const result = await runJson('setup-python-install', tr('将下载并静默安装 Python，然后写入 GA Admin 配置。继续？', 'Download and silently install Python, then update the GA Admin configuration?'), '/api/setup/python/install', {})
    if (!result) return
    setMessage(tr(`Python 已安装并写入配置：${result.version || result.python || 'Python OK'}`, `Python was installed and configured: ${result.version || result.python || 'Python OK'}`))
  }

  const createVenv = async () => {
    const target = effectiveRoot
    if (!target) { setMessage(tr('请先完成 GA 根目录验证。', 'Validate the GA root first.')); return }
    const result = await runJson('setup-venv-create', tr(`将在 ${target} 下创建或更新 .venv。继续？`, `Create or update .venv under ${target}?`), '/api/setup/venv/create', { root: target })
    if (!result) return
    setMessage(tr('虚拟环境已创建，GA Admin 已切换到 venv Python。', 'The virtual environment was created and GA Admin is now using its Python.'))
  }

  const installDeps = async () => {
    const target = effectiveRoot
    if (!target) { setMessage(tr('请先完成 GA 根目录验证。', 'Validate the GA root first.')); return }
    if (!confirmDanger('setup-deps-install', tr(`将在 ${target} 执行 pip install -r requirements.txt。继续？`, `Run pip install -r requirements.txt in ${target}?`))) return
    setBusy('setup-deps-install')
    setMessage(tr('正在安装依赖…', 'Installing dependencies…'))
    setLogLines([])
    try {
      const res = await apiStream('/api/setup/deps/install', { dangerous: true, method: 'POST', body: JSON.stringify({ root: target }) })
      const reader = res.body?.getReader()
      if (!reader) throw new Error(tr('当前浏览器不支持流式读取依赖安装输出', 'This browser cannot stream dependency installation output'))
      const decoder = new TextDecoder()
      let buf = ''
      let doneEvent = null
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n')
        buf = parts.pop() || ''
        for (const part of parts) {
          if (!part.trim()) continue
          const ev = JSON.parse(part)
          if (ev.line) setLogLines(lines => [...lines, ev.line].slice(-600))
          if (ev.error) setLogLines(lines => [...lines, `ERROR: ${ev.error}`].slice(-600))
          if (ev.type === 'done') doneEvent = ev
        }
      }
      if (buf.trim()) {
        const ev = JSON.parse(buf)
        if (ev.line) setLogLines(lines => [...lines, ev.line].slice(-600))
        if (ev.error) setLogLines(lines => [...lines, `ERROR: ${ev.error}`].slice(-600))
        if (ev.type === 'done') doneEvent = ev
      }
      if (!doneEvent?.ok) throw new Error(doneEvent?.error || tr('依赖安装失败', 'Dependency installation failed'))
      setMessage(tr('依赖安装完成。', 'Dependencies installed.'))
    } catch (e) {
      setMessage(e.message)
    } finally {
      setBusy('')
    }
  }

  const smoke = async () => {
    const target = effectiveRoot
    if (!target) { setMessage(tr('请先完成 GA 根目录验证。', 'Validate the GA root first.')); return }
    const result = await runJson('setup-smoke', tr(`使用当前 Python 对 ${target} 执行冒烟验证。继续？`, `Run the smoke test for ${target} with the current Python?`), '/api/setup/smoke', { root: target })
    if (!result) return
    setLastSmoke(result)
    setMessage(tr(`冒烟验证通过：${result.python || 'Python OK'}`, `Smoke test passed: ${result.python || 'Python OK'}`))
  }

  const complete = async () => {
    const target = effectiveRoot
    if (!target) { setMessage(tr('请先完成 GA 根目录验证。', 'Validate the GA root first.')); return }
    const result = await runJson('setup-complete', tr('确认完成首次配置并进入 GA Admin？', 'Finish first-time setup and enter GA Admin?'), '/api/setup/complete', { root: target })
    if (!result) return
    setMessage(tr('首次配置完成，正在进入 GA Admin…', 'Setup complete. Entering GA Admin…'))
    onComplete?.(result)
  }

  const isBusy = Boolean(busy)
  const smokeReady = lastSmoke?.ok
  const stepItems = steps.map((step, index) => ({
    key: step.key,
    title: step.title,
    description: step.desc,
    status: index < currentIndex || (step.key === 'smoke' && smokeReady) ? 'finish' : index === currentIndex ? 'process' : 'wait'
  }))

  return <div className="setup-wizard-shell">
    <div className="setup-wizard-bg" />
    <Card className="setup-wizard-card" bordered={false}>
      <div className="setup-wizard-hero">
        <div className="setup-wizard-copy">
          <Text className="eyebrow">GA Admin Bootstrap</Text>
          <Title level={1}>{tr('首次启动配置', 'First-time setup')}</Title>
          <Paragraph>
            {tr('按顺序接管 GenericAgent、创建 Python 隔离环境、安装依赖并完成冒烟验证。每个会修改本机状态的动作都会先弹出危险确认。', 'Configure GenericAgent, create an isolated Python environment, install dependencies, and run a smoke test. Every action that changes local state requires confirmation.')}
          </Paragraph>
        </div>
        <Space className="setup-wizard-status" size={8}>
          <Bot size={18}/>
          <span>{statusText(state, english)}</span>
        </Space>
      </div>

      <Steps className="setup-ant-steps" current={currentIndex} responsive items={stepItems} />

      <Card className="setup-env-card" size="small" title={<Space><Wand2 size={16}/>{tr('本机环境预检', 'Local environment check')}</Space>}>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={12}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="Python">
                <Space wrap>
                  <Tag color={pythonOk ? 'green' : 'orange'}>{pythonOk ? tr('可用', 'Available') : tr('缺失', 'Missing')}</Tag>
                  <Text type={pythonOk ? undefined : 'warning'}>{pythonStatus}</Text>
                </Space>
              </Descriptions.Item>
            </Descriptions>
          </Col>
          <Col xs={24} md={12}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="Git">
                <Space wrap>
                  <Tag color={gitOk ? 'green' : 'blue'}>{gitOk ? tr('可用', 'Available') : tr('可选', 'Optional')}</Tag>
                  <Text type={gitOk ? undefined : 'secondary'}>{gitStatus}</Text>
                </Space>
              </Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
        <Space wrap>
          <Button icon={<RefreshCw size={15}/>} onClick={refresh} disabled={isBusy}>{tr('重新检测环境', 'Check again')}</Button>
          {!pythonOk && (
            <Button type="primary" icon={<Download size={15}/>} onClick={installPython} disabled={isBusy || !canInstallPython} loading={busy === 'setup-python-install'}>
              {tr('自动安装 Python', 'Install Python automatically')}
            </Button>
          )}
        </Space>
        <Paragraph type="secondary" className="setup-env-hint">
          {tr('Git 不再是首次配置的硬依赖；缺少 Git 时会下载 GitHub ZIP 归档。缺少 Python 时，可在 Windows 上直接触发内置安装器。', 'Git is optional during setup; without it, GA Admin downloads a GitHub ZIP archive. On Windows, the built-in installer can add Python when it is missing.')}
        </Paragraph>
      </Card>

      <Row className="setup-grid" gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card className="setup-panel" title={<Space><GitPullRequest size={18}/>{tr('接管或安装 GenericAgent', 'Use or install GenericAgent')}</Space>} extra={<Tag color={effectiveRoot ? 'green' : 'default'}>{effectiveRoot ? tr('已选择', 'Selected') : tr('待选择', 'Not selected')}</Tag>}>
            <Space direction="vertical" size={14} className="setup-stack">
              <div className="setup-field">
                <Text strong>{tr('已有 GA 根目录', 'Existing GA root')}</Text>
                <Input
                  value={root}
                  onChange={e => setRoot(e.target.value)}
                  placeholder={tr('例如 C:\\Users\\you\\Desktop\\code\\GenericAgent', 'For example C:\\Users\\you\\Desktop\\code\\GenericAgent')}
                  disabled={isBusy}
                  allowClear
                />
                <Button type="primary" icon={<CheckCircle2 size={15}/>} onClick={validateRoot} disabled={isBusy || !normalizeRoot(root)} loading={busy === 'setup-validate'}>
                  {tr('验证并使用', 'Validate and use')}
                </Button>
              </div>

              <Divider plain>{tr('或', 'or')}</Divider>

              <div className="setup-field">
                <Text strong>{tr('安装父目录', 'Parent installation directory')}</Text>
                <Input
                  value={installPath}
                  onChange={e => setInstallPath(e.target.value)}
                  placeholder={tr('例如 C:\\Users\\you\\Desktop\\code（将在其下创建 GenericAgent）', 'For example C:\\Users\\you\\Desktop\\code (GenericAgent will be created inside it)')}
                  disabled={isBusy}
                  allowClear
                />
                <Button icon={<Wand2 size={15}/>} onClick={installGA} disabled={isBusy || !normalizeRoot(installPath || root)} loading={busy === 'setup-install'}>
                  {tr('安装 GA', 'Install GA')}
                </Button>
                <Text type="secondary" className="setup-install-hint">{installSourceCopy}</Text>
              </div>

              {state?.ga_root && <Alert
                type="success"
                showIcon
                message={tr('当前 GA Root', 'Current GA root')}
                description={<Text code copyable>{state.ga_root}</Text>}
              />}
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card className="setup-panel" title={<Space><Play size={18}/>{tr('Python / 依赖 / 验证', 'Python / dependencies / validation')}</Space>} extra={<Tag color={smokeReady ? 'green' : 'blue'}>{smokeReady ? tr('验证通过', 'Validated') : tr('待验证', 'Not validated')}</Tag>}>
            <Space direction="vertical" size={14} className="setup-stack">
              <Descriptions size="small" column={1} bordered className="setup-descriptions">
                <Descriptions.Item label="Python"><Text code>{selectedPython}</Text></Descriptions.Item>
                <Descriptions.Item label="venv"><Text code>{state?.venv?.ok ? state.venv.path : tr('未创建', 'Not created')}</Text></Descriptions.Item>
              </Descriptions>

              <Space wrap className="setup-actions-stack">
                <Button icon={<RefreshCw size={15}/>} onClick={createVenv} disabled={isBusy || !effectiveRoot} loading={busy === 'setup-venv-create'}>
                  {tr('创建 venv', 'Create venv')}
                </Button>
                <Button icon={<Terminal size={15}/>} onClick={installDeps} disabled={isBusy || !effectiveRoot} loading={busy === 'setup-deps-install'}>
                  {tr('安装依赖', 'Install dependencies')}
                </Button>
                <Button icon={<CheckCircle2 size={15}/>} onClick={smoke} disabled={isBusy || !effectiveRoot} loading={busy === 'setup-smoke'}>
                  {tr('冒烟验证', 'Run smoke test')}
                </Button>
                <Button type="primary" onClick={complete} disabled={isBusy || !effectiveRoot || !smokeReady} loading={busy === 'setup-complete'}>
                  {tr('完成并进入', 'Finish and enter')}
                </Button>
              </Space>
            </Space>
          </Card>
        </Col>
      </Row>

      {message && <Alert className="setup-message" type={isErrorMessage(message) ? 'error' : 'success'} showIcon message={message} />}

      <Card className="setup-log-card" title={<Space><Terminal size={16}/>{tr('依赖安装日志', 'Dependency installation log')}</Space>} size="small">
        <pre className="setup-log" ref={logRef}>{logLines.join('\n') || tr('依赖安装日志会显示在这里。', 'Dependency installation output will appear here.')}</pre>
      </Card>
    </Card>
  </div>
}
