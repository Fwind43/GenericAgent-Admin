let mermaidRenderSequence = 0

let mermaidRenderQueue = Promise.resolve()

export const renderMermaidSvg = (source, colorScheme) => {
  const render = async () => {
    const module = await import('mermaid')
    const mermaid = module.default || module
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: colorScheme === 'dark' ? 'dark' : 'neutral',
    })
    mermaidRenderSequence += 1
    return mermaid.render(`oa-mermaid-${Date.now().toString(36)}-${mermaidRenderSequence}`, source)
  }
  const pending = mermaidRenderQueue.then(render, render)
  mermaidRenderQueue = pending.then(() => undefined, () => undefined)
  return pending
}
