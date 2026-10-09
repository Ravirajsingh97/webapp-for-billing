import html2canvas from 'html2canvas-pro'

export type PrintMode = 'a4' | 'thermal'

/** Injects the @page rule for the chosen paper size, then opens the print dialog. */
export function setPageRule(mode: PrintMode): void {
  const id = 'print-page-rule'
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  el.textContent =
    mode === 'thermal'
      ? '@page { size: 80mm auto; margin: 2mm; }'
      : '@page { size: A4 portrait; margin: 8mm; }'
}

export async function printPaper(mode: PrintMode): Promise<void> {
  setPageRule(mode)
  await new Promise((r) => setTimeout(r, 120))
  window.print()
}

/** Render any DOM node to a PNG blob (for WhatsApp bill image). */
export async function nodeToBlob(node: HTMLElement, scale = 2): Promise<Blob> {
  const canvas = await html2canvas(node, {
    scale,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  })
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image banane me dikkat aayi'))), 'image/png', 0.95)
  })
}

export type ShareResult = 'shared' | 'downloaded' | 'cancelled'

export async function shareNodeAsImage(node: HTMLElement, filename: string): Promise<ShareResult> {
  const blob = await nodeToBlob(node)
  const file = new File([blob], `${filename}.png`, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: filename, text: 'Bill' })
      return 'shared'
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled'
    }
  }
  downloadBlob(blob, `${filename}.png`)
  return 'downloaded'
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

/** Native share sheet where available, else copy to clipboard */
export async function shareText(text: string, url?: string, title = 'Bill'): Promise<'shared' | 'copied' | 'cancelled'> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
  if (nav.share) {
    try {
      await nav.share({ title, text, url })
      return 'shared'
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled'
    }
  }
  await copyText(text)
  return 'copied'
}
