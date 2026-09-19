// Saving providers in Admin rewrites the shared runtime model list, so the chat
// composer refetches it and keeps the current pick when it still exists.
// The chat state endpoint is shared when no session is open, per-session otherwise.
export const runtimeStateUrl = sid => (sid ? `/api/chat/state/${sid}` : '/api/chat/state')

export const selectRuntimeLlms = (nextLlms, currentIndex) => {
  const llms = Array.isArray(nextLlms) ? nextLlms : []
  if (!llms.length) return null
  const keep = llms.some(model => model.index === currentIndex)
  return { llms, index: keep ? currentIndex : (llms[0]?.index ?? 0) }
}

export const refreshRuntimeModels = async ({ fetchState, sid = '', setLlms, setLlmNo }) => {
  try {
    const state = await fetchState(runtimeStateUrl(sid))
    const llms = Array.isArray(state?.llms) ? state.llms : []
    if (!llms.length) return null
    setLlms(llms)
    setLlmNo(current => {
      const picked = selectRuntimeLlms(llms, current)
      return picked.index
    })
    return llms
  } catch {
    return null
  }
}
