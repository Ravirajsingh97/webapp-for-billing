import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { canUseStorage, isEmbedded, storageFixMessage } from './lib/env'
import { BootProblem } from './components/BootProblem'

// Hide the boot splash once React has painted.
function hideBoot() {
  const el = document.getElementById('boot')
  if (!el) return
  el.style.transition = 'opacity .25s ease'
  el.style.opacity = '0'
  setTimeout(() => el.remove(), 260)
}

const rootEl = document.getElementById('root')

if (!rootEl) {
  document.body.innerHTML = '<pre style="padding:20px">App root element nahi mila (#root).</pre>'
} else {
  const root = createRoot(rootEl)

  const showProblem = (title: string, message: string, detail?: string) => {
    root.render(
      <BootProblem title={title} message={message} detail={detail} url={window.location.href} />,
    )
    hideBoot()
  }

  // App ek baar render ho jaye to error-screen dikhana band — warna chhoti-moti
  // warnings (jaise iframe me service worker register na hona) app ko dhak deti hain.
  let appRendered = false

  // Aakhri safety net: koi bhi unexpected error user ko dikh jaye (blank screen ki jagah)
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '')
    console.error('[showroom] unhandled rejection:', e.reason)
    if (appRendered) return
    // service worker iframe/opaque origin me register nahi hota — ye app ka error nahi hai
    if (/service.?worker|sw\.js/i.test(msg)) return
    if (/indexeddb|storage|security/i.test(msg)) {
      showProblem('App ko storage nahi mila', storageFixMessage(isEmbedded()), msg)
    }
  })

  async function start() {
    try {
      // Step 1 — storage check. Preview iframe / incognito me browser IndexedDB block kar deta hai.
      // Aise me app ko band nahi karte: in-memory database par chala dete hain (Demo mode).
      let demo = false
      const storageOk = await canUseStorage()
      if (!storageOk) {
        try {
          // @ts-ignore -- "fake-indexeddb/auto" ka type mapping package ke exports me nahi hai
          await import('fake-indexeddb/auto')
          demo = true
          console.warn('[showroom] IndexedDB block hai — demo (in-memory) mode on')
        } catch (err) {
          console.error('Demo shim load nahi hua', err)
          showProblem(
            'App ko storage nahi mila',
            storageFixMessage(isEmbedded()),
            err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          )
          return
        }
      }

      // Step 2 — app + database (ye ab dynamic import hain, taaki demo shim pehle lag jaye)
      const [{ default: App }, { seedDatabase }, { DemoBanner }] = await Promise.all([
        import('./App'),
        import('./lib/db'),
        import('./components/DemoBanner'),
      ])

      try {
        await seedDatabase()
      } catch (err) {
        console.error('Seed error', err)
        showProblem(
          'App ka data khul nahi paya',
          'Browser ne app ke database ko kholne se rok diya. Neeche wale button se app ko naye tab me kholein — ' +
            'agar phir bhi na chale to browser me cookies/storage allow karein.',
          err instanceof Error ? err.message : String(err),
        )
        return
      }

      root.render(
        <StrictMode>
          <App />
          {demo ? <DemoBanner embedded={isEmbedded()} /> : null}
        </StrictMode>,
      )
      appRendered = true
      requestAnimationFrame(hideBoot)
    } catch (err) {
      console.error('Boot error', err)
      showProblem(
        'App load nahi ho paya',
        'Kuch technical dikkat aayi. App ko naye tab me kholkar dekhein.',
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      )
    }
  }

  void start()
}
