import { createRoot } from 'react-dom/client'
import { GoogleSignInButton, loadGoogleIdentity } from '../src/components/GoogleSignInButton'

type Check = (name: string, ok: boolean) => void
const wait = () => new Promise(resolve => setTimeout(resolve, 30))

export async function runGoogleLoginRegressions(check: Check) {
  const browser = window as unknown as { google?: unknown }
  const originalGoogle = browser.google
  const originalObserver = globalThis.ResizeObserver
  const originalTimer = globalThis.setTimeout
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    delete browser.google
    const first = loadGoogleIdentity()
    const second = loadGoogleIdentity()
    const failure = Promise.allSettled([first, second])
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')
    check('Google: concurrent SDK loads share one script', first === second && scripts.length === 1)
    scripts[0].dispatchEvent(new Event('error'))
    const failed = await failure
    check('Google: blocked script rejects and removes failed script', failed.every(r => r.status === 'rejected') && !scripts[0].isConnected)

    let timeout: (() => void) | undefined
    globalThis.setTimeout = ((callback: () => void, delay?: number) => {
      if (delay === 15_000) { timeout = callback; return 0 }
      return originalTimer(callback, delay)
    }) as typeof setTimeout
    const retry = loadGoogleIdentity().then(() => false, () => true)
    check('Google: failed script load allows retry', document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]').length === 1)
    timeout!()
    check('Google: stalled SDK request times out', await retry)
    globalThis.setTimeout = originalTimer

    let credential: ((r: { credential?: string }) => void) | undefined
    let mode = '', renderedWidth = 0, width = 280, resize: (() => void) | undefined
    const delivered: string[] = [], errors: string[] = []
    browser.google = { accounts: { id: {
      initialize: (options: { ux_mode: string; callback: typeof credential }) => { mode = options.ux_mode; credential = options.callback },
      // Deliberately no prompt(): login must not require a One Tap session.
      renderButton: (parent: HTMLElement, options: { width: number }) => {
        renderedWidth = options.width
        Object.defineProperty(parent, 'clientWidth', { configurable: true, get: () => width })
        const button = document.createElement('button')
        button.textContent = 'Sign in with Google'
        button.onclick = () => credential?.({ credential: 'synthetic-id-token' })
        parent.appendChild(button)
      },
    } } }
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() { resize = undefined }
      unobserve() {}
    } as unknown as typeof ResizeObserver

    const render = (disabled = false, clientId = 'synthetic-client') => root.render(
      <GoogleSignInButton clientId={clientId} disabled={disabled} onCredential={token => delivered.push(token)} onError={message => errors.push(message)} />,
    )
    render(); await wait()
    check('Google: interactive popup button works without One Tap', mode === 'popup' && !!host.querySelector('button'))
    host.querySelector('button')!.click()
    check('Google: button returns credential to Firebase handler', delivered.join() === 'synthetic-id-token')
    width = 230; resize!()
    check('Google: button resizes for narrow screens', renderedWidth === 230)
    render(true); await wait()
    credential?.({ credential: 'blocked' })
    check('Google: busy button cannot start another login', delivered.length === 1 && host.querySelector('[inert]') !== null)
    render(); await wait()
    credential?.({})
    check('Google: empty credential reports an error', errors.length === 1)
    const stale = credential
    render(false, 'replacement-client'); await wait()
    stale?.({ credential: 'old-client' })
    check('Google: changed client ignores old credential callback', delivered.length === 1)
    const closed = credential
    root.unmount()
    closed?.({ credential: 'closed-dialog' })
    check('Google: closed dialog ignores late credentials', delivered.length === 1 && !resize)
  } finally {
    root.unmount()
    host.remove()
    globalThis.ResizeObserver = originalObserver
    globalThis.setTimeout = originalTimer
    if (originalGoogle === undefined) delete browser.google
    else browser.google = originalGoogle
    document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]').forEach(script => script.remove())
  }
}
