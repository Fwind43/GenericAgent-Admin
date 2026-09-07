import React from 'react'
import { TextQuote } from 'lucide-react'
import './SummaryBlock.css'

export default function SummaryBlock({ label, children }) {
  return <aside className="ga-summary-block" role="note" aria-label={label}>
    <TextQuote className="ga-summary-icon" size={12} aria-hidden="true" />
    <div className="ga-summary-body">{children}</div>
  </aside>
}
