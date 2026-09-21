import React, { lazy, Suspense } from 'react'

// Keep settings and administration modules out of the chat startup graph.
export function lazySurface(load, name) {
  const View = lazy(() => load().then(module => ({ default: module[name] })))
  return function LazySurface(props) {
    return <Suspense fallback={<div role="status" aria-busy="true">Loading...</div>}><View {...props}/></Suspense>
  }
}
