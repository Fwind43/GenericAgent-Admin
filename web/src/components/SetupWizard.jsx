import React, { useEffect, useRef } from 'react'
import Alert from 'antd/es/alert'
import Button from 'antd/es/button'
import Input from 'antd/es/input'
import Typography from 'antd/es/typography'
import { Check, CheckCircle2, Download, FolderOpen, GitPullRequest, Play, RefreshCw, Terminal, Wand2 } from 'lucide-react'
import {
  installTargetPath,
  normalizeRootPath,
} from '../lib/setupWizard.js'
import { SETUP_TEXT } from '../lib/i18n.js'
import { useSetupWizard } from '../hooks/useSetupWizard.js'

const { Paragraph, Text, Title } = Typography

const TOOL_ORDER = ['python', 'git', 'uv', 'npm']
const TOOL_LABELS = { python: 'Python', git: 'Git', uv: 'uv', npm: 'npm' }
// Python is the only tool the wizard cannot work around.
const REQUIRED_TOOLS = new Set(['python'])

function ToolStatus({ tool, label, required, probed, text }) {
  const state = !probed ? 'idle' : tool.ok ? 'ok' : required ? 'error' : 'optional'
  const status = !probed
    ? text.env.checking
    : tool.ok
      ? (tool.version || text.env.available)
      : (tool.error || text.env.missing)

  return <div className={`setup-console-tool is-${state}`}>
    <span className="setup-console-tool-dot" aria-hidden="true" />
    <span className="setup-console-tool-name">{label}</span>
    <span className="setup-console-tool-value" title={status}>{status}</span>
    {!required && <span className="setup-console-tool-optional">{text.env.optional}</span>}
  </div>
}

function SectionHeading({ icon: Icon, title, status, ready }) {
  return <header className="setup-console-section-heading">
    <span className="setup-console-section-icon" aria-hidden="true"><Icon size={17} /></span>
    <h2>{title}</h2>
    {status && <span className={`setup-console-section-state${ready ? ' is-ready' : ''}`}>
      {ready && <Check size={13} aria-hidden="true" />}{status}
    </span>}
  </header>
}

export default function SetupWizard({ initialRoot = '', lang = 'zh', text, onComplete }) {
  const copy = text || SETUP_TEXT[lang] || SETUP_TEXT.zh
  const wizard = useSetupWizard({ text: copy, initialRoot, onComplete })
  const {
    env, progress, steps, currentStep, blockReason, busy, notice, logLines,
    rootDraft, setRootDraft, installDraft, setInstallDraft, installTarget,
    pythonDraft, setPythonDraft,
  } = wizard
  const logRef = useRef(null)
  const working = Boolean(busy)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines])

  return <div className="setup-console-shell">
    <div className="setup-console-frame">
      <aside className="setup-console-rail">
        <div className="setup-console-brand">
          <span className="setup-console-brand-mark" aria-hidden="true">GA</span>
          <Text>{copy.eyebrow}</Text>
        </div>
        <div className="setup-console-rail-copy">
          <Title level={1}>{copy.title}</Title>
          <Paragraph>{copy.intro}</Paragraph>
        </div>

        <nav className="setup-console-steps" aria-label={copy.title}>
          {steps.map((step, index) => {
            const active = index === currentStep
            const done = step.status === 'finish'
            const failed = step.status === 'error'
            return <div
              key={step.key}
              className={`setup-console-step${active ? ' is-active' : ''}${done ? ' is-done' : ''}${failed ? ' is-error' : ''}`}
              aria-current={active ? 'step' : undefined}
            >
              <span className="setup-console-step-marker" aria-hidden="true">
                {done ? <Check size={14} /> : index + 1}
              </span>
              <span className="setup-console-step-copy">
                <strong>{copy.steps[step.key].title}</strong>
                {active && <small>{copy.steps[step.key].desc}</small>}
              </span>
            </div>
          })}
        </nav>

        <div className={`setup-console-overall is-${wizard.statusTone}`}>
          <span className="setup-console-overall-dot" aria-hidden="true" />
          {copy.statusLabels[wizard.statusTone]}
        </div>
      </aside>

      <main className="setup-console-main">
        <section className="setup-console-section setup-console-environment">
          <SectionHeading icon={Wand2} title={copy.env.title} />
          <div className="setup-console-tools">
            {TOOL_ORDER.map(name => <ToolStatus
              key={name}
              tool={env[name]}
              label={TOOL_LABELS[name]}
              required={REQUIRED_TOOLS.has(name)}
              probed={env.probed}
              text={copy}
            />)}
          </div>

          <div className="setup-console-python">
            <div className="setup-console-field-copy">
              <Text strong>{copy.env.pythonPathLabel}</Text>
              <Text type="secondary">{copy.env.pythonPathHint}</Text>
            </div>
            <div className="setup-console-input-action">
              <Input value={pythonDraft} onChange={event => setPythonDraft(event.target.value)}
                placeholder={copy.env.pythonPathPlaceholder} disabled={working} allowClear />
              <Button type="primary" icon={<CheckCircle2 size={15}/>} onClick={wizard.validatePython}
                disabled={working || !pythonDraft.trim()} loading={busy === 'setup-python-validate'}>
                {copy.env.usePythonPath}
              </Button>
            </div>
            {env.python.ok && env.python.path && <Text type="success" className="setup-console-active-python">
              {copy.env.pythonActive(env.python.path)}
            </Text>}
          </div>

          <div className="setup-console-inline-actions">
            <Button icon={<RefreshCw size={15}/>} onClick={wizard.refresh} disabled={working} loading={busy === 'setup-refresh'}>
              {copy.env.recheck}
            </Button>
            {env.probed && !env.python.ok && <Button type="primary" icon={<Download size={15}/>} onClick={wizard.installPython}
              disabled={working || !env.canInstallPython} loading={busy === 'setup-python-install'}>
              {copy.env.installPython}
            </Button>}
            {env.checked && <Text type="secondary" className="setup-console-checked">{copy.env.checkedAt(env.checked)}</Text>}
          </div>
          <Paragraph type="secondary" className="setup-console-hint">
            {env.error || (env.probed && !env.python.ok && !env.canInstallPython ? copy.env.pythonInstallerUnavailable : copy.env.hint)}
          </Paragraph>
        </section>

        <div className="setup-console-divider" />

        <div className="setup-console-columns">
          <section className="setup-console-section">
            <SectionHeading
              icon={GitPullRequest}
              title={copy.root.title}
              status={progress.rootReady ? copy.root.selected : copy.root.unselected}
              ready={progress.rootReady}
            />

            <div className="setup-console-field">
              <Text strong>{copy.root.existingLabel}</Text>
              <div className="setup-console-input-action">
                <Input value={rootDraft} onChange={event => setRootDraft(event.target.value)}
                  placeholder={copy.root.existingPlaceholder} disabled={working} allowClear />
                <Button icon={<FolderOpen size={15}/>} onClick={() => wizard.browse('root')}
                  disabled={working} loading={busy === 'setup-browse-root'}>{copy.root.browse}</Button>
                <Button onClick={wizard.readClipboard}
                  disabled={working} loading={busy === 'setup-clipboard'}>{copy.root.clipboard}</Button>
              </div>
              <Button type="primary" icon={<CheckCircle2 size={15}/>} onClick={wizard.validateRoot}
                disabled={working || !normalizeRootPath(rootDraft)} loading={busy === 'setup-validate'}>
                {copy.root.validate}
              </Button>
            </div>

            <div className="setup-console-or"><span>{copy.root.or}</span></div>

            <div className="setup-console-field">
              <Text strong>{copy.root.installLabel}</Text>
              <div className="setup-console-input-action">
                <Input value={installDraft} onChange={event => setInstallDraft(event.target.value)}
                  placeholder={copy.root.installPlaceholder} disabled={working} allowClear />
                <Button icon={<FolderOpen size={15}/>} onClick={() => wizard.browse('install')}
                  disabled={working} loading={busy === 'setup-browse-install'}>{copy.root.browse}</Button>
              </div>
              <Button icon={<Wand2 size={15}/>} onClick={wizard.installGA}
                disabled={working || !installDraft.trim()} loading={busy === 'setup-install'}>
                {copy.root.install}
              </Button>
              {installTarget && <Text code className="setup-console-install-target">{installTarget}</Text>}
              <Text type="secondary" className="setup-console-note">{env.git.ok ? copy.root.sourceGit : copy.root.sourceArchive}</Text>
            </div>

            {progress.savedRoot && <Alert
              className="setup-console-alert"
              type={progress.rootReady ? 'success' : 'warning'}
              showIcon
              title={copy.root.currentRoot}
              description={<>
                <Text code copyable>{progress.savedRoot}</Text>
                {!progress.rootReady && <div className="setup-console-root-warning">{copy.root.unhealthy}</div>}
              </>}
            />}
          </section>

          <section className="setup-console-section setup-console-runtime">
            <SectionHeading
              icon={Play}
              title={copy.runtime.title}
              status={progress.smokeReady ? copy.runtime.validated : copy.runtime.unvalidated}
              ready={progress.smokeReady}
            />

            <dl className="setup-console-runtime-facts">
              <div>
                <dt>{copy.runtime.python}</dt>
                <dd><code>{progress.python || env.effectivePython || copy.env.notSelected}</code></dd>
              </div>
              <div>
                <dt>{copy.runtime.venv}</dt>
                <dd><code>{progress.venv?.ok ? progress.venv.path : copy.runtime.venvMissing}</code></dd>
              </div>
            </dl>

            <div className="setup-console-runtime-actions">
              <Button icon={<RefreshCw size={15}/>} onClick={wizard.createVenv}
                disabled={working || !progress.rootReady} loading={busy === 'setup-venv-create'}>
                {copy.runtime.createVenv}
              </Button>
              <Button icon={<Terminal size={15}/>} onClick={wizard.installDeps}
                disabled={working || !progress.rootReady} loading={busy === 'setup-deps-install'}>
                {copy.runtime.installDeps}
              </Button>
              <Button icon={<CheckCircle2 size={15}/>} onClick={wizard.runSmoke}
                disabled={working || !progress.rootReady} loading={busy === 'setup-smoke'}>
                {copy.runtime.smoke}
              </Button>
            </div>

            <div className="setup-console-finish">
              <Button type="primary" size="large" onClick={wizard.finish}
                disabled={working || Boolean(blockReason)} loading={busy === 'setup-complete'}>
                {copy.runtime.finish}
              </Button>
              {(blockReason || !progress.depsReady) && <Text type="secondary" className="setup-console-block-reason">
                {blockReason ? copy.runtime.blocked[blockReason] : copy.runtime.depsUnconfirmed}
              </Text>}
            </div>
          </section>
        </div>

        {notice && <Alert className="setup-console-message" type={notice.tone} showIcon title={notice.text} />}

        <details className="setup-console-log">
          <summary>
            <span><Terminal size={15} aria-hidden="true" />{copy.log.title}</span>
            {logLines.length > 0 && <span className="setup-console-log-count">{logLines.length}</span>}
          </summary>
          <pre ref={logRef}>{logLines.join('\n') || copy.log.empty}</pre>
        </details>
      </main>
    </div>
  </div>
}
