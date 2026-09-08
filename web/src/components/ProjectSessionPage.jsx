import React, { useState } from 'react'

export default function ProjectSessionPage({ items, renderItem, ct }) {
  const [limit, setLimit] = useState(10)
  const remaining = Math.max(0, items.length - limit)
  return <>
    {items.slice(0, limit).map(renderItem)}
    {remaining > 0 && <button type="button" className="oa-project-load-more"
      onClick={() => setLimit(Infinity)}>
      {ct(`加载更多${remaining}个...`, `Load more (${remaining} remaining)...`)}
    </button>}
  </>
}
