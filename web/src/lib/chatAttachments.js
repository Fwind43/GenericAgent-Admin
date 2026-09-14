// Canonical contract: dataURL is inline content; url is a remote resource.
// Legacy aliases are accepted only here, never by attachment renderers.
export function normalizeChatAttachment(file = {}) {
  const { data_url, DataURL, URL, Name, Type, ...rest } = file || {}
  return {
    ...rest,
    name: rest.name || Name || '',
    type: rest.type || Type || '',
    url: rest.url || URL || '',
    dataURL: rest.dataURL || data_url || DataURL || '',
  }
}

export function normalizeChatAttachments(files) {
  return Array.isArray(files) ? files.filter(Boolean).map(normalizeChatAttachment) : []
}

export function chatAttachmentSource(file) {
  return file.url || file.dataURL || ''
}
