const tokenCount = (value) => {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? count : 0
}

// cache_read_tokens is canonical. cached_tokens is retained only for sessions
// persisted by older workers, which also stored a zero-valued canonical field.
export const cacheReadTokens = (usage) => {
  const canonical = tokenCount(usage?.cache_read_tokens)
  return canonical > 0 ? canonical : tokenCount(usage?.cached_tokens)
}

// Cache hit rate is the share of prompt input served from cache. Providers
// expose incompatible input counters: OpenAI includes cache reads in
// input_tokens, while Claude reports input/creation/read as disjoint buckets.
// New workers persist an explicit integer flag. Old normalized sessions can
// only be recovered heuristically from their counters.
export const cacheHitPercent = (usages) => {
  if (!Array.isArray(usages)) return 0
  const totals = usages.reduce((acc, usage) => {
    const input = tokenCount(usage?.input_tokens)
    const creation = tokenCount(usage?.cache_creation_tokens)
    const canonicalRead = tokenCount(usage?.cache_read_tokens)
    const legacyCached = tokenCount(usage?.cached_tokens)
    const read = canonicalRead > 0 ? canonicalRead : legacyCached
    const rawFlag = usage?.input_tokens_include_cache_read
    const hasFlag = rawFlag === 0 || rawFlag === 1
    const inputIncludesRead = hasFlag
      ? rawFlag === 1
      : legacyCached > 0 || (canonicalRead > 0 && creation === 0 && canonicalRead <= input)

    acc.read += read
    acc.promptInput += inputIncludesRead ? input : input + creation + read
    return acc
  }, { read: 0, promptInput: 0 })

  return totals.promptInput > 0
    ? Math.round(totals.read / totals.promptInput * 100)
    : 0
}

// Provider output_tokens can include hidden reasoning and tool arguments that
// never appear in raw_ask text chunks. Only full per-attempt request time has
// matching coverage. This is observed request-average throughput (includes
// TTFT/network), not decoder-only speed; tool execution is outside the attempt.
// Old generation_ms-only records are intentionally not used to invent a rate.
export const measuredOutputRate = (usages) => {
  if (!Array.isArray(usages)) return 0
  const measured = usages.reduce((acc, usage) => {
    const requestMs = tokenCount(usage?.request_elapsed_ms)
    const outputTokens = tokenCount(usage?.output_tokens)
    if (requestMs <= 0 || outputTokens <= 0) return acc
    acc.requestMs += requestMs
    acc.outputTokens += outputTokens
    return acc
  }, { requestMs: 0, outputTokens: 0 })
  return measured.requestMs > 0
    ? measured.outputTokens / (measured.requestMs / 1000)
    : 0
}
