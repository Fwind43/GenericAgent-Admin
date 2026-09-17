const JSON_CONTENT_TYPE = 'application/json'
const DANGEROUS_CONFIRM_HEADER = 'X-GA-Confirm'
const DANGEROUS_CONFIRM_VALUE = 'dangerous'

const isFormBody = (body) => typeof FormData !== 'undefined' && body instanceof FormData

export const apiHeaders = ({ dangerous = false, headers = {}, body } = {}) => {
  const normalized = { ...(dangerous ? { [DANGEROUS_CONFIRM_HEADER]: DANGEROUS_CONFIRM_VALUE } : {}), ...headers }
  if (!isFormBody(body) && !Object.keys(normalized).some(k => k.toLowerCase() === 'content-type')) {
    normalized['Content-Type'] = JSON_CONTENT_TYPE
  }
  return normalized
}

export const parseApiResponse = async (res, url = '') => {
  const text = await res.text()
  let body = null
  if (text) {
    try { body = JSON.parse(text) }
    catch {
      if (!res.ok) throw new Error(text.slice(0, 200) || `${res.status} ${res.statusText}`)
      throw new Error(`Expected JSON from ${url}, got ${text.slice(0, 40)}`)
    }
  }
  if (!res.ok) {
    const error = new Error(body?.detail || body?.error || text || `${res.status} ${res.statusText}`)
    error.status = res.status
    error.body = body
    throw error
  }
  return body
}

export const api = async (url, options = {}) => {
  const { dangerous = false, headers = {}, ...rest } = options
  const req = { ...rest, headers: apiHeaders({ dangerous, headers, body: rest.body }) }
  return parseApiResponse(await fetch(url, req), url)
}

export const apiStream = async (url, options = {}) => {
  const { dangerous = false, headers = {}, ...rest } = options
  const req = { ...rest, headers: apiHeaders({ dangerous, headers, body: rest.body }) }
  const res = await fetch(url, req)
  if (!res.ok) await parseApiResponse(res, url)
  return res
}
