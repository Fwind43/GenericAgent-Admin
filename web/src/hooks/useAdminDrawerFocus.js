import { useEffect } from 'react'

// The standalone mobile drawer is modal; embedded settings use their own navigation.
export function useAdminDrawerFocus({ open, embedded, sidebarRef, toggleRef, mainRef, close }) {
  useEffect(() => {
    if (!open || embedded) return
    const media = window.matchMedia('(max-width: 900px)')
    if (!media.matches) { close(); return }
    const sidebar = sidebarRef.current
    const main = mainRef.current
    const trigger = toggleRef.current
    if (!sidebar) return
    const previousInert = main?.inert
    if (main) main.inert = true
    const controls = () => [...sidebar.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')]
      .filter(node => !node.hidden && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden')
    sidebar.querySelector('[aria-current="page"]')?.focus()
    if (!sidebar.contains(document.activeElement)) controls()[0]?.focus()
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return }
      if (event.key !== 'Tab') return
      const items = controls()
      const index = items.indexOf(document.activeElement)
      if (!items.length) return
      if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1).focus() }
      else if (!event.shiftKey && (index < 0 || index === items.length - 1)) { event.preventDefault(); items[0].focus() }
    }
    const onResize = () => { if (!media.matches) close() }
    document.addEventListener('keydown', onKeyDown)
    media.addEventListener('change', onResize)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      media.removeEventListener('change', onResize)
      if (main) main.inert = previousInert
      trigger?.focus()
    }
  }, [open, embedded, sidebarRef, toggleRef, mainRef, close])
}
