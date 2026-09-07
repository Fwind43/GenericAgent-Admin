import React from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import { parseInline } from './lib/markdown.js'
import './ThinkingBlock.css'

const inlineText = nodes => nodes.map(node => node.children ? inlineText(node.children) : (node.value || node.alt || '')).join('')

export default function ThinkingBlock({ body, label, live = false, children }) {
  const firstLine = body.split('\n').find(line => line.trim()) || ''
  const preview = inlineText(parseInline(firstLine.replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/, '')))
  return (
    <details className="ga-fold fold-thinking" data-fold-type="thinking" data-live={live || undefined}>
      <summary>
        <ChevronRight className="ga-thinking-chevron" size={14} aria-hidden="true" />
        <Brain className="ga-thinking-icon" size={15} aria-hidden="true" />
        <span className="ga-thinking-label">{label}</span>
        <span className="ga-thinking-preview" aria-hidden="true">{preview}</span>
      </summary>
      <div className="ga-thinking-body">{children}</div>
    </details>
  )
}
