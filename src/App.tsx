import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { db, getBusiness } from './lib/db'
import { newInvoice } from './lib/repo'
import { fmtDate, todayISO } from './lib/format'
import type { Business, DocType, Invoice } from './lib/types'
import { Toaster, toast } from './components/ui'
import { checkLogin } from './lib/auth'
import { autoSyncEnabled, isCloudConfigured, isSignedIn, CLOUD_CHANGE_EVENT } from './lib/cloud'
import { syncNow } from './lib/sync'
import { LoginScreen } from './screens/Auth'
import { BootProblem } from './components/BootProblem'
import { isEmbedded, storageFixMessage } from './lib/env'
import { HomeScreen } from './screens/Home'
import { ItemsScreen } from './screens/Items'
import { InvoicesScreen } from './screens/Invoices'
import { ReportsScreen } from './screens/Reports'
import { SettingsScreen } from './screens/Settings'
import { PartiesScreen } from './screens/Parties'
import { PaymentsScreen } from './screens/Payments'
import { ExpensesScreen } from './screens/Expenses'
import { MoreScreen, type MoreTarget } from './screens/More'
import { BillingScreen } from './screens/Billing'
import { InvoiceView } from './screens/InvoiceView'
import { POSScreen } from './screens/POS'
import { OCRScreen } from './screens/OCR'
import { Onboarding } from './screens/Onboarding'

type SubRoute =
  | { name: 'none' }
  | { name: 'pos'; draft: Invoice }
  | { name: 'ocr' }
  | { name: 'billing'; draft: Invoice }
  | { name: 'view'; id: number }
  | { name: 'parties' }
  | { name: 'payments' }
  | { name: 'expenses' }
  | { name: 'settings' }

const TABS = [
  { icon: '🏠', label: 'Home' },
  { icon: '🧾', label: 'Bills' },
  { icon: '📦', label: 'Items' },
  { icon: '📊', label: 'Reports' },
  { icon: '☰', label: 'More' },
]

export default function App() {
  const [business, setBusiness] = useState<Business | null>(null)
  const [onboarded, setOnboarded] = useState<boolean | null>(null)
  const [tab, setTab] = useState(0)
  const [route, setRoute] = useState<SubRoute>({ name: 'none' })
  const [lowStockFocus, setLowStockFocus] = useState(false)
  const [installEvt, setInstallEvt] = useState<{ prompt: () => Promise<void> } | null>(null)
  const [seeded, setSeeded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // login gate: 'off' = koi user nahi, 'login' = PIN chahiye, 'ok' = andar
  const [cloudRevision, setCloudRevision] = useState(0)
  useEffect(() => {
    const changed = () => setCloudRevision((n) => n + 1)
    window.addEventListener(CLOUD_CHANGE_EVENT, changed)
    window.addEventListener('storage', changed)
    return () => { window.removeEventListener(CLOUD_CHANGE_EVENT, changed); window.removeEventListener('storage', changed) }
  }, [])
  const [gate, setGate] = useState<'loading' | 'off' | 'login' | 'ok'>('loading')

  const refreshGate = useCallback(async () => {
    try {
      const g = await checkLogin()
      setGate(g === 'off' ? 'off' : g === 'ok' ? 'ok' : 'login')
    } catch (e) {
      console.error('[showroom] login check failed:', e)
      setGate('off')
    }
  }, [])

  const loadBusiness = useCallback(async () => {
    try {
      const [b, setting] = await Promise.all([getBusiness(), db.appSettings.get('onboarded')])
      setBusiness(b)
      setOnboarded(setting?.value === 'yes')
      setLoadError(null)
    } catch (e) {
      console.error('[showroom] business load failed:', e)
      setLoadError(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    }
  }, [])

  useEffect(() => {
    void loadBusiness()
    void db.items.count().then((c) => setSeeded(c > 0))
    void refreshGate()
  }, [loadBusiness, refreshGate])

  // Cloud sync: app khulte hi + har 3 minute me (agar login hai aur auto-sync on hai)
  useEffect(() => {
    if (gate !== 'ok' && gate !== 'off') return
    if (!isCloudConfigured() || !isSignedIn() || !autoSyncEnabled()) return
    let alive = true
    const run = async () => {
      if (!alive || !isSignedIn() || !autoSyncEnabled()) return
      try {
        const r = await syncNow()
        if (alive && r.added + r.updated > 0) {
          toast(`☁️ Cloud se ${r.added} nayi, ${r.updated} update aayi`, 'success')
        }
      } catch (e) {
        console.warn('[showroom] auto sync fail:', e)
      }
    }
    void run()
    const t = setInterval(() => void run(), 180_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [gate, cloudRevision])

  useEffect(() => {
    const onPop = () => setRoute((r) => (r.name === 'none' ? r : { name: 'none' }))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallEvt(e as unknown as { prompt: () => Promise<void> })
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const openRoute = (r: SubRoute) => {
    try {
      history.pushState({ sub: r.name }, '')
    } catch {
      /* ignore */
    }
    setRoute(r)
  }

  const openNewBill = async (docType: DocType) => {
    if (!business) return
    const draft = await newInvoice(docType)
    if (!draft.placeOfSupply) draft.placeOfSupply = business.stateCode
    openRoute({ name: 'billing', draft })
  }

  const openPOS = async () => {
    try {
      const draft = await newInvoice('TAX_INVOICE')
      draft.placeOfSupply = business?.stateCode ?? ''
      openRoute({ name: 'pos', draft })
    } catch (e) { toast(e instanceof Error ? e.message : 'POS nahi khula', 'error') }
  }

  const install = async () => {
    if (!installEvt) return
    await installEvt.prompt()
    setInstallEvt(null)
  }

  const handleMore = (target: MoreTarget) => {
    if (target === 'pos') void openPOS()
    else if (target === 'ocr') openRoute({ name: 'ocr' })
    else if (target === 'parties') openRoute({ name: 'parties' })
    else if (target === 'payments') openRoute({ name: 'payments' })
    else if (target === 'expenses') openRoute({ name: 'expenses' })
    else if (target === 'settings') openRoute({ name: 'settings' })
    else if (target === 'reports') setTab(3)
    else if (target === 'billing') void openNewBill('TAX_INVOICE')
  }

  if (loadError && !business) {
    return (
      <BootProblem
        title="App ka data khul nahi paya"
        message={storageFixMessage(isEmbedded())}
        detail={loadError}
        url={window.location.href}
      />
    )
  }

  if (!business || onboarded === null) {
    return (
      <div className="app-shell items-center justify-center">
        <div className="mt-24 text-center text-sm text-slate-500">Showroom Manager load ho raha hai…</div>
      </div>
    )
  }

  if (!onboarded) {
    return (
      <>
        <Onboarding business={business} onDone={() => void loadBusiness()} />
        <Toaster />
      </>
    )
  }

  if (gate === 'login') {
    return (
      <>
        <LoginScreen onLoggedIn={() => setGate('ok')} />
        <Toaster />
      </>
    )
  }

  if (gate === 'loading') {
    return (
      <div className="app-shell items-center justify-center">
        <div className="mt-24 text-center text-sm text-slate-500">Login taiyaar ho raha hai…</div>
      </div>
    )
  }

  if (route.name === 'pos') return <div className="app-shell"><POSScreen draft={route.draft} business={business} onBack={() => setRoute({ name: 'none' })} onEdit={draft => setRoute({ name: 'billing', draft })} onSaved={id => { setRoute({ name: 'view', id }); setTab(1) }} /><Toaster /></div>

  if (route.name === 'billing') {
    return (
      <div className="app-shell">
        <BillingScreen
          draft={route.draft}
          business={business}
          onBack={() => setRoute({ name: 'none' })}
          onSaved={(id) => {
            setRoute({ name: 'view', id })
            setTab(1)
          }}
        />
        <Toaster />
      </div>
    )
  }

  if (route.name === 'view') {
    return (
      <div className="app-shell">
        <InvoiceView
          invoiceId={route.id}
          business={business}
          onBack={() => setRoute({ name: 'none' })}
          onEdit={(inv) => setRoute({ name: 'billing', draft: inv })}
          onConverted={(draft) => {
            toast('Naya document banaya gaya — check karke save karein')
            setRoute({ name: 'billing', draft })
          }}
        />
        <Toaster />
      </div>
    )
  }

  if (route.name !== 'none') {
    const meta: Record<string, { title: string; subtitle: string }> = {
      ocr: { title: 'OCR / Bill scanner', subtitle: 'Photo se editable purchase draft' },
      parties: { title: 'Khata / Parties', subtitle: 'Customer & supplier udhaar' },
      payments: { title: 'Payments In / Out', subtitle: 'Paisa aaya ya diya — pura register' },
      expenses: { title: 'Dukaan ka kharcha', subtitle: 'Kiraya, salary, bijli, transport' },
      settings: { title: 'Settings', subtitle: 'Dukaan details, series, backup' },
    }
    const info = meta[route.name]
    return (
      <div className="app-shell">
        <div className="topbar">
          <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => setRoute({ name: 'none' })}>
            ←
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{info.title}</div>
            <div className="truncate text-[11px] text-brand-200">{info.subtitle}</div>
          </div>
        </div>
        {route.name === 'ocr' ? <OCRScreen business={business} onDraft={draft => setRoute({ name: 'billing', draft })} /> : null}
        {route.name === 'parties' ? (
          <PartiesScreen business={business} onOpenInvoice={(id) => openRoute({ name: 'view', id })} />
        ) : null}
        {route.name === 'payments' ? (
          <PaymentsScreen business={business} onOpenInvoice={(id) => openRoute({ name: 'view', id })} />
        ) : null}
        {route.name === 'expenses' ? <ExpensesScreen business={business} /> : null}
        {route.name === 'settings' ? (
          <SettingsScreen
            business={business}
            onBusinessChange={() => void loadBusiness()}
            onOpenParties={() => openRoute({ name: 'parties' })}
            installPrompt={installEvt}
            onInstall={() => void install()}
          />
        ) : null}
        <Toaster />
      </div>
    )
  }

  const title = tab === 0 ? business.name : tab === 1 ? 'Bills' : tab === 2 ? 'Items / Stock' : tab === 3 ? 'Reports' : 'More'

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 text-lg">🏪</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{title}</div>
          <div className="truncate text-[11px] text-brand-200">
            {seeded ? fmtDate(todayISO()) : 'Setup…'}
            {business.gstin ? ` • GSTIN ${business.gstin}` : ''}
          </div>
        </div>
        <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => void openNewBill('TAX_INVOICE')}>
          ＋ Bill
        </button>
        <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => openRoute({ name: 'settings' })}>
          ⚙️
        </button>
      </div>

      {tab === 0 ? <div className="quick-tools"><button className="btn btn-primary" onClick={() => void openPOS()}>🛒 Open POS</button><button className="btn btn-outline" onClick={() => openRoute({ name: 'ocr' })}>📷 Scan bill (OCR)</button></div> : null}
      {tab === 0 ? (
        <HomeScreen
          business={business}
          lowStockOnly
          onNewBill={(d) => void openNewBill(d)}
          onOpenInvoice={(id) => openRoute({ name: 'view', id })}
          onGoItems={() => {
            setLowStockFocus(true)
            setTab(2)
          }}
          onGoReports={() => setTab(3)}
          onGoParties={() => openRoute({ name: 'parties' })}
          onGoPayments={() => openRoute({ name: 'payments' })}
          onGoExpenses={() => openRoute({ name: 'expenses' })}
        />
      ) : null}

      {tab === 1 ? (
        <InvoicesScreen business={business} onOpen={(id) => openRoute({ name: 'view', id })} onNewBill={(d) => void openNewBill(d)} />
      ) : null}

      {tab === 2 ? <ItemsScreen business={business} focusLowStock={lowStockFocus} /> : null}

      {tab === 3 ? <ReportsScreen business={business} /> : null}

      {tab === 4 ? (
        <MoreScreen
          business={business}
          onNewBill={(d) => void openNewBill(d)}
          onOpen={handleMore}
          onOpenInvoice={(id) => openRoute({ name: 'view', id })}
          hasInstall={!!installEvt}
          onInstall={() => void install()}
        />
      ) : null}

      <nav className="tabbar no-print">
        {TABS.map((t, i) => (
          <button key={t.label} className="tab-item" aria-current={tab === i ? 'page' : undefined} data-active={tab === i} onClick={() => setTab(i)}>
            <span className="text-lg leading-none">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <Toaster />
    </div>
  )
}

export type { ReactNode }
