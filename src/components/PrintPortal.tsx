import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Renders children into #print-root (outside the app shell) so print CSS can isolate them. */
export function PrintPortal({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let el = document.getElementById('print-root')
    if (!el) {
      el = document.createElement('div')
      el.id = 'print-root'
      document.body.appendChild(el)
    }
    setNode(el)
  }, [])

  if (!node) return null
  return createPortal(children, node)
}
