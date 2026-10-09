import { useEffect, useRef, useState } from 'react'

interface GoogleIdentity {
  initialize: (options: { client_id: string; ux_mode: 'popup'; callback: (response: { credential?: string }) => void }) => void
  renderButton: (parent: HTMLElement, options: { type: 'standard'; theme: 'outline'; size: 'large'; text: 'signin_with'; width: number }) => void
}

const identity = () => (window as unknown as { google?: { accounts?: { id?: GoogleIdentity } } }).google?.accounts?.id
let loading: Promise<GoogleIdentity> | undefined

export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const ready = identity()
  if (ready) return Promise.resolve(ready)
  if (loading) return loading
  loading = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script')
    const finish = (error?: Error) => {
      clearTimeout(timer)
      script.onload = script.onerror = null
      const api = identity()
      if (error || !api) {
        script.remove()
        reject(error ?? new Error('Google login load nahi hua'))
      } else resolve(api)
    }
    const timer = setTimeout(() => finish(new Error('Google login load nahi hua — internet check karke retry karein')), 15_000)
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => finish()
    script.onerror = () => finish(new Error('Google login load nahi hua — internet check karke retry karein'))
    document.head.appendChild(script)
  }).catch(error => {
    loading = undefined
    throw error
  })
  return loading
}

/** The official button opens interactive sign-in even when One Tap is unavailable. */
export function GoogleSignInButton({ clientId, disabled, onCredential, onError }: {
  clientId: string
  disabled: boolean
  onCredential: (credential: string) => void
  onError: (message: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const current = useRef({ disabled, onCredential, onError })
  current.current = { disabled, onCredential, onError }
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let observer: ResizeObserver | undefined
    const container = host.current!
    setState('loading')
    void loadGoogleIdentity().then(api => {
      if (cancelled) return
      api.initialize({
        client_id: clientId,
        ux_mode: 'popup',
        callback: response => {
          if (cancelled || current.current.disabled) return
          if (response.credential) current.current.onCredential(response.credential)
          else current.current.onError('Google se token nahi mila — dobara sign in karein')
        },
      })
      let previousWidth = 0
      const render = () => {
        const width = Math.min(400, Math.max(200, Math.floor(container.clientWidth || 240)))
        if (width === previousWidth) return
        previousWidth = width
        container.replaceChildren()
        api.renderButton(container, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', width })
      }
      render()
      observer = new ResizeObserver(render)
      observer.observe(container)
      setState('ready')
    }).catch(error => {
      if (cancelled) return
      setState('error')
      current.current.onError(error instanceof Error ? error.message : 'Google login load nahi hua')
    })
    return () => {
      cancelled = true
      observer?.disconnect()
      container.replaceChildren()
    }
  }, [clientId, attempt])

  return (
    <div>
      <div ref={host} inert={disabled} aria-disabled={disabled} className={`w-full overflow-hidden ${disabled ? 'opacity-50' : ''}`} />
      {state === 'loading' ? <p role="status" className="text-center text-xs text-slate-500">Google login load ho raha hai…</p> : null}
      {state === 'error' ? <button type="button" className="btn btn-outline btn-block" disabled={disabled} onClick={() => setAttempt(n => n + 1)}>Google login dobara load karein</button> : null}
    </div>
  )
}
