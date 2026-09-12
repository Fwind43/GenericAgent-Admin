// Only application-owned, same-origin download URLs may use authenticated fetch.
export function fileDownloadTarget(href, base = globalThis.location?.href) {
  try {
    const url = new URL(href, base)
    if (url.origin !== new URL(base).origin || url.pathname !== '/api/files/download' || url.username || url.password) return null
    const path = url.searchParams.get('path')
    if (!path) return null
    return { href: url.pathname + url.search, name: path.split(/[\\/]/).filter(Boolean).pop() || 'download' }
  } catch { return null }
}

export async function downloadFile(href, name) {
  const target = fileDownloadTarget(href)
  if (!target) throw new Error('Invalid file download URL')
  // Fetch in the logged-in page rather than handing a protected URL to a
  // mobile download manager, which may not share the browser's Basic auth.
  const response = await fetch(target.href, { credentials: 'same-origin', redirect: 'error' })
  if (!response.ok) {
    const text = await response.text()
    let detail = text.slice(0, 200)
    try { const body = JSON.parse(text); detail = body.detail || body.error || detail } catch { /* plain-text auth errors */ }
    throw new Error(`HTTP ${response.status}: ${detail || response.statusText}`)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = name || target.name
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    // Mobile browsers may consume the blob asynchronously after click returns.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
