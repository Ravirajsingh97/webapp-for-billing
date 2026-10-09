import { useEffect, useState } from 'react'
import {
  autoSyncEnabled,
  getCloudConfig,
  isCloudConfigured,
  isSignedIn,
  logoutCloud,
  parseFirebaseConfig,
  sendPasswordReset,
  setAutoSync,
  setCloudConfig,
  signInEmail,
  signInWithGoogleIdToken,
  signUpEmail,
  signedInEmail,
} from '../lib/cloud'
import { lastSyncAt, syncNow, type SyncResult } from '../lib/sync'
import { activeCompanyId } from '../lib/company'
import { ConfirmDialog, Sheet, toast } from '../components/ui'

/** APK (WebView) me Google login Google khud block karta hai */
const inNativeApp = (): boolean => {
  try {
    return !!(window as unknown as { AndroidBridge?: unknown }).AndroidBridge
  } catch {
    return false
  }
}

function fmtWhen(ms: number): string {
  if (!ms) return 'abhi tak nahi'
  const d = new Date(ms)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? `aaj ${time}` : `${d.toLocaleDateString('en-IN')} ${time}`
}

async function googleIdToken(clientId: string): Promise<string> {
  const w = window as unknown as {
    google?: {
      accounts?: {
        id?: {
          initialize: (o: Record<string, unknown>) => void
          prompt: (cb?: (n: { isNotDisplayed?: () => boolean; isSkippedMoment?: () => boolean }) => void) => void
        }
      }
    }
  }
  if (!w.google?.accounts?.id) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Google login load nahi hua — internet check karein'))
      document.head.appendChild(s)
    })
  }
  const gsi = w.google?.accounts?.id
  if (!gsi) throw new Error('Google login available nahi hai is browser me')
  return new Promise<string>((resolve, reject) => {
    let done = false
    gsi.initialize({
      client_id: clientId,
      callback: (resp: { credential?: string }) => {
        done = true
        if (resp?.credential) resolve(resp.credential)
        else reject(new Error('Google se token nahi mila'))
      },
    })
    gsi.prompt((n) => {
      setTimeout(() => {
        if (done) return
        if (n?.isNotDisplayed?.() || n?.isSkippedMoment?.()) {
          reject(new Error('Google login window band ho gayi — dobara try karein'))
        }
      }, 800)
    })
  })
}

export function CloudCard() {
  const [configured, setConfigured] = useState(isCloudConfigured())
  const [signedIn, setSignedIn] = useState(isSignedIn())
  const [email, setEmail] = useState(signedInEmail())
  const [auto, setAuto] = useState(autoSyncEnabled())
  const [setupOpen, setSetupOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const [busy, setBusy] = useState('')
  const [tick, setTick] = useState(0)

  const cfg = getCloudConfig()
  const last = lastSyncAt(activeCompanyId())

  useEffect(() => {
    setSignedIn(isSignedIn())
    setEmail(signedInEmail())
    setConfigured(isCloudConfigured())
  }, [tick])

  const doSync = async (all: boolean) => {
    setBusy(all ? 'Saari companies sync ho rahi hain…' : 'Sync ho raha hai…')
    try {
      const r: SyncResult = await syncNow({ all })
      setTick((t) => t + 1)
      const changes = r.added + r.updated
      toast(
        changes > 0
          ? `Sync ho gaya — ${r.added} nayi, ${r.updated} update${r.companies > 1 ? ` · ${r.companies} companies` : ''}`
          : 'Sync ho gaya — sab pehle se updated hai ✅',
        'success',
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sync nahi ho paya', 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <div className="card mt-3">
        <div className="flex items-center gap-2">
          <span className="text-[15px]">☁️</span>
          <div className="text-[13px] font-bold text-slate-700">Cloud account (Google / Email)</div>
          {signedIn ? <span className="chip chip-green ml-auto">Connected</span> : null}
        </div>

        {!configured ? (
          <>
            <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Login karne par aapki company ka pura data (bills, items, khata, payments) cloud me sync ho jata hai —
              doosre phone me login karte hi sab wapas mil jata hai, MyBillBook jaisa.
            </div>
            <button className="btn btn-primary btn-block mt-2" onClick={() => setSetupOpen(true)}>
              ☁️ Cloud setup karein (5 minute)
            </button>
          </>
        ) : !signedIn ? (
          <>
            <div className="mt-1 text-[11px] text-slate-500">
              Project: <b>{cfg?.projectId}</b> · Login karke sync chalu karein
            </div>
            <div className="mt-2 flex gap-2">
              <button className="btn btn-primary flex-1" onClick={() => setAuthOpen(true)}>
                🔐 Login / Sign up
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setCloudConfig(null)
                  setTick((t) => t + 1)
                  toast('Cloud setup hata diya', 'success')
                }}
              >
                ⚙️
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-1 text-[12px] text-slate-600">
              👤 <b>{email}</b>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">Pichhli sync: {fmtWhen(last)}</div>
            <button
              className={`btn ${busy ? 'btn-outline' : 'btn-primary'} btn-block mt-2`}
              disabled={!!busy}
              onClick={() => void doSync(false)}
            >
              {busy ? `⏳ ${busy}` : '🔄 Abhi sync karein'}
            </button>
            <div className="mt-2 flex gap-2">
              <button className="btn btn-outline flex-1" disabled={!!busy} onClick={() => void doSync(true)}>
                🏢 Saari companies sync
              </button>
              <button className="btn btn-ghost" onClick={() => setLogoutConfirm(true)}>
                🚪 Logout
              </button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-[12px] text-slate-600">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => {
                  setAuto(e.target.checked)
                  setAutoSync(e.target.checked)
                }}
              />
              App khulte hi apne aap sync karein
            </label>
          </>
        )}
      </div>

      <CloudSetupSheet
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        onSaved={() => {
          setSetupOpen(false)
          setTick((t) => t + 1)
          setAuthOpen(true)
        }}
      />

      <AuthSheet
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onDone={() => {
          setAuthOpen(false)
          setTick((t) => t + 1)
          void doSync(true)
        }}
      />

      <ConfirmDialog
        open={logoutConfirm}
        title="Logout karein?"
        message="Aapka data phone me hi rahega. Dobara login karne par cloud se sync ho jayega."
        confirmLabel="Haan, logout"
        danger={false}
        onCancel={() => setLogoutConfirm(false)}
        onConfirm={() => {
          logoutCloud()
          setLogoutConfirm(false)
          setTick((t) => t + 1)
          toast('Logout ho gaya', 'success')
        }}
      />
    </>
  )
}

function CloudSetupSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState('')
  const [clientId, setClientId] = useState('')
  const [err, setErr] = useState('')

  const save = () => {
    try {
      const cfg = parseFirebaseConfig(text)
      cfg.googleClientId = clientId.trim() || undefined
      setCloudConfig(cfg)
      toast('Cloud setup save ho gaya', 'success')
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Config padha nahi ja saka')
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="☁️ Cloud setup (ek baar)"
      subtitle="Free Firebase project — 5 minute ka kaam"
      full
      footer={
        <button className="btn btn-primary btn-block" onClick={save}>
          Save karein
        </button>
      }
    >
      <ol className="ml-4 list-decimal text-[12px] leading-relaxed text-slate-700">
        <li>
          <a className="text-indigo-700 underline" href="https://console.firebase.google.com/" target="_blank" rel="noreferrer">
            console.firebase.google.com
          </a>{' '}
          par <b>Add project</b> (naam kuch bhi) → ban jaye
        </li>
        <li>
          <b>Build → Authentication → Get started</b> → Sign-in method me <b>Email/Password</b> enable karein
          <br />
          <span className="text-slate-500">(Google se login chahiye to <b>Google</b> bhi enable kar dein)</span>
        </li>
        <li>
          <b>Build → Firestore Database → Create database</b> → <i>Production mode</i> → location{' '}
          <b>asia-south1 (Mumbai)</b>
        </li>
        <li>
          Firestore → <b>Rules</b> tab me ye paste karke <b>Publish</b> karein:
          <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-2 text-[10px] leading-snug text-slate-100">{`rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /showroomUsers/{uid}/{doc=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == uid;
    }
  }
}`}</pre>
        </li>
        <li>
          <b>Project settings (⚙️) → Your apps → Web (&lt;/&gt;)</b> → app register karein → jo{' '}
          <code>firebaseConfig</code> dikhe, use neeche paste kar dein
        </li>
        <li>
          <b>Authentication → Settings → Authorized domains</b> me apni site ka domain add karein (jaise{' '}
          <code>kanishk2018singh-afk.github.io</code> ya <code>cdn.jsdelivr.net</code>)
        </li>
      </ol>

      <div className="mt-3 text-[12px] font-semibold text-slate-600">Firebase config paste karein</div>
      <textarea
        className="input mt-1 h-32 w-full font-mono text-[11px]"
        placeholder={`const firebaseConfig = {\n  apiKey: "AIza...",\n  authDomain: "my-shop.firebaseapp.com",\n  projectId: "my-shop",\n  appId: "1:1234:web:abcd"\n};`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="mt-3 text-[12px] font-semibold text-slate-600">Google OAuth Client ID (optional — Google login ke liye)</div>
      <input
        className="input mt-1"
        placeholder="1234-abc.apps.googleusercontent.com"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
      />
      <div className="mt-1 text-[11px] text-slate-500">
        Firebase console → Authentication → Google → Web SDK configuration me milta hai.
      </div>

      {err ? <div className="mt-2 text-[12px] font-semibold text-red-600">{err}</div> : null}
      <div className="mt-3 rounded-xl bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800">
        🔒 Ye config public hoti hai (Firebase me aisa hi hota hai) — aapka data sirf aapke account se khulta hai,
        kyunki Firestore rules sirf login kiye user ko uske hi data tak rok dete hain.
      </div>
    </Sheet>
  )
}

function AuthSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('signup')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const cfg = getCloudConfig()

  const submit = async () => {
    setErr('')
    if (!email.includes('@')) return setErr('Email theek se likhein')
    if (pass.length < 6) return setErr('Password kam se kam 6 characters ka rakhein')
    if (mode === 'signup' && pass !== pass2) return setErr('Dono password ek jaise likhein')
    setBusy('Ruko, ho raha hai…')
    try {
      if (mode === 'signup') await signUpEmail(email.trim(), pass)
      else await signInEmail(email.trim(), pass)
      toast(mode === 'signup' ? 'Account ban gaya 🎉' : 'Login ho gaya 🎉', 'success')
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Login nahi ho paya')
    } finally {
      setBusy('')
    }
  }

  const google = async () => {
    setErr('')
    if (!cfg?.googleClientId) {
      setErr('Google login ke liye pehle Cloud setup me Google Client ID daalein')
      return
    }
    setBusy('Google se login ho raha hai…')
    try {
      const idToken = await googleIdToken(cfg.googleClientId)
      await signInWithGoogleIdToken(idToken)
      toast('Google se login ho gaya 🎉', 'success')
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Google login nahi ho paya')
    } finally {
      setBusy('')
    }
  }

  const forgot = async () => {
    setErr('')
    if (!email.includes('@')) return setErr('Pehle apna email likhein, phir "Password bhool gaye" dabayein')
    try {
      await sendPasswordReset(email.trim())
      toast('Password reset ka email bhej diya 📧', 'success')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Email nahi ja paya')
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === 'signup' ? '🆕 Naya account banayein' : '🔐 Login karein'}
      subtitle="Isi account se doosre phone par data mil jayega"
      footer={
        <button className="btn btn-primary btn-block" disabled={!!busy} onClick={() => void submit()}>
          {busy ? `⏳ ${busy}` : mode === 'signup' ? 'Account banayein' : 'Login karein'}
        </button>
      }
    >
      <div className="mb-3 flex gap-2">
        <button className="chip flex-1" data-active={mode === 'signup'} onClick={() => setMode('signup')} type="button">
          Naya account
        </button>
        <button className="chip flex-1" data-active={mode === 'login'} onClick={() => setMode('login')} type="button">
          Login
        </button>
      </div>

      <label className="text-[12px] font-semibold text-slate-600">Email</label>
      <input
        className="input mb-3"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="aap@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label className="text-[12px] font-semibold text-slate-600">Password</label>
      <input
        className="input mb-3"
        type="password"
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        placeholder="kam se kam 6 characters"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
      />

      {mode === 'signup' ? (
        <>
          <label className="text-[12px] font-semibold text-slate-600">Password dobara</label>
          <input className="input mb-3" type="password" placeholder="wahi password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
        </>
      ) : null}

      {err ? <div className="mb-2 text-[12px] font-semibold text-red-600">{err}</div> : null}

      {inNativeApp() ? (
        <div className="rounded-xl bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800">
          📱 APK me Google login available nahi (Google WebView me block karta hai) — <b>email + password</b> se login
          karein. Google login web app me chalta hai.
        </div>
      ) : (
        <>
          <div className="my-3 flex items-center gap-2 text-[11px] text-slate-400">
            <span className="h-px flex-1 bg-slate-200" /> ya <span className="h-px flex-1 bg-slate-200" />
          </div>
          <button className="btn btn-outline btn-block" disabled={!!busy} onClick={() => void google()}>
            <span className="mr-1">🔵</span> Google se login karein
          </button>
        </>
      )}

      <div className="mt-3 text-center">
        <button className="btn btn-ghost btn-sm" onClick={() => void forgot()}>
          Password bhool gaye?
        </button>
      </div>
    </Sheet>
  )
}
