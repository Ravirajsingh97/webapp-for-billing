import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { activeCompany, activeCompanyId, createCompany, listCompanies, switchCompany, renameCompany } from '../lib/company'
import { tryLogin, type User } from '../lib/auth'
import { Sheet, toast } from '../components/ui'

const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '👤'

function PinPad({
  pin,
  length,
  onKey,
  onBack,
}: {
  pin: string
  length: number
  onKey: (d: string) => void
  onBack: () => void
}) {
  return (
    <div className="mt-4">
      <div className="flex justify-center gap-2">
        {Array.from({ length }).map((_, i) => (
          <span
            key={i}
            className={`h-3.5 w-3.5 rounded-full ${i < pin.length ? 'bg-indigo-700' : 'bg-slate-300'}`}
          />
        ))}
      </div>
      <div className="mx-auto mt-5 grid max-w-[260px] grid-cols-3 gap-2.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="pin-key" onClick={() => onKey(d)}>
            {d}
          </button>
        ))}
        <button className="pin-key text-slate-400" onClick={onBack} aria-label="Mitayein">
          ⌫
        </button>
        <button className="pin-key" onClick={() => onKey('0')}>
          0
        </button>
        <span />
      </div>
    </div>
  )
}

/** Login screen — company ke users + PIN */
export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const company = activeCompany()
  const [selected, setSelected] = useState<User | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [companySheet, setCompanySheet] = useState(false)

  const actives = (users ?? []).filter((u) => u.active && u.pinHash)

  // agar sab users hat gaye to login ki zarurat nahi
  useEffect(() => {
    if (users.length > 0 && actives.length === 0) onLoggedIn()
  }, [users, actives.length, onLoggedIn])

  const submit = async (value: string) => {
    if (!selected?.id) return
    setBusy(true)
    const ok = await tryLogin(selected.id, value)
    setBusy(false)
    if (ok) {
      toast(`Namaste, ${selected.name}! 🙏`, 'success')
      onLoggedIn()
    } else {
      setError('PIN galat hai — dobara koshish karein')
      setPin('')
      setTimeout(() => setError(''), 2500)
    }
  }

  const press = (d: string) => {
    if (!selected || busy) return
    const next = (pin + d).slice(0, selected.pinLength)
    setPin(next)
    setError('')
    if (next.length === selected.pinLength) void submit(next)
  }

  return (
    <div className="app-shell auth-shell">
      <div className="mx-auto w-full max-w-[430px] px-5 pt-10 pb-8">
        <div className="text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-900 text-3xl text-white shadow-lg">
            🏪
          </div>
          <div className="mt-3 text-lg font-extrabold text-slate-900">Showroom Manager</div>
          <button
            className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[12px] font-semibold text-slate-700"
            onClick={() => setCompanySheet(true)}
          >
            🏢 {company.name} <span className="text-slate-400">·</span> <span className="text-indigo-700">badlein</span>
          </button>
        </div>

        {!selected ? (
          <div className="card mt-6">
            <div className="text-[13px] font-bold text-slate-700">Kaun login kar raha hai?</div>
            <div className="mt-2 flex flex-col gap-2">
              {actives.map((u) => (
                <button
                  key={u.id}
                  className="list-row w-full text-left"
                  onClick={() => {
                    setSelected(u)
                    setPin('')
                    setError('')
                  }}
                >
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-indigo-100 text-[13px] font-bold text-indigo-800">
                    {initials(u.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-slate-900">{u.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {u.role === 'OWNER' ? 'Owner / मालिक' : 'Staff / कर्मचारी'}
                    </div>
                  </div>
                  <span className="text-slate-400">›</span>
                </button>
              ))}
              {actives.length === 0 ? (
                <div className="py-6 text-center text-[13px] text-slate-500">Koi user nahi mila…</div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="card mt-6">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-indigo-100 text-[14px] font-bold text-indigo-800">
                {initials(selected.name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-bold text-slate-900">{selected.name}</div>
                <div className="text-[11px] text-slate-500">
                  {selected.role === 'OWNER' ? 'Owner' : 'Staff'} · PIN daalein
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSelected(null)
                  setPin('')
                  setError('')
                }}
              >
                ← badlein
              </button>
            </div>

            <PinPad pin={pin} length={selected.pinLength} onKey={press} onBack={() => setPin(pin.slice(0, -1))} />
            {error ? <div className="mt-3 text-center text-[12px] font-semibold text-red-600">{error}</div> : null}
            {busy ? <div className="mt-2 text-center text-[12px] text-slate-500">Check kar rahe hain…</div> : null}
            <div className="mt-4 text-center text-[11px] text-slate-500">
              PIN bhool gaye? Kisi logged-in owner se Settings mein naya PIN banwayein.
            </div>
          </div>
        )}

        <div className="mt-4 text-center text-[11px] leading-relaxed text-slate-500">
          Login aur users aapke phone me hi rehte hain — internet ki zarurat nahi.
        </div>
      </div>

      <CompanySheet open={companySheet} onClose={() => setCompanySheet(false)} />
    </div>
  )
}

/** Company switch / create sheet — login screen aur settings dono me */
export function CompanySheet({
  open,
  onClose,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  onChanged?: () => void
}) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const companies = open ? listCompanies() : []
  const activeId = activeCompanyId()

  const create = () => {
    const name = newName.trim()
    if (!name) {
      toast('Company ka naam likhein', 'error')
      return
    }
    const c = createCompany(name)
    setNewName('')
    toast(`"${c.name}" ban gayi — switch kar rahe hain…`, 'success')
    onChanged?.()
    switchCompany(c.id)
  }

  return (
    <Sheet open={open} onClose={onClose} title="🏢 Company / Firm" subtitle="Har company ka data alag rehta hai">
      <div className="flex flex-col gap-2">
        {companies.map((c) => (
          <div key={c.id} className="list-row">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-base">🏢</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-slate-900">{c.name}</div>
              <div className="text-[11px] text-slate-500">
                {c.id === activeId ? 'Abhi khuli hai' : 'Switch karne ke liye dabayein'}
              </div>
            </div>
            {editing === c.id ? (
              <div className="flex items-center gap-1">
                <input
                  className="input !w-32 !py-1 text-[12px]"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    renameCompany(c.id, editName)
                    setEditing(null)
                    onChanged?.()
                    toast('Naam badal gaya', 'success')
                  }}
                >
                  ✓
                </button>
              </div>
            ) : (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEditing(c.id)
                    setEditName(c.name)
                  }}
                  aria-label="Naam badlein"
                >
                  ✏️
                </button>
                {c.id === activeId ? (
                  <span className="chip chip-green">Active</span>
                ) : (
                  <button className="btn btn-outline btn-sm" onClick={() => switchCompany(c.id)}>
                    Switch
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-2xl bg-slate-50 p-3">
        <div className="text-[13px] font-bold text-slate-700">＋ Nayi company banayein</div>
        <div className="mt-1 text-[11px] text-slate-500">
          Nayi company khaali shuru hoti hai (alag items, bills, khata). Dukaan ki details baad me Settings me bhar lein.
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className="input flex-1"
            placeholder="Jaise: Sharma Sanitary — Sikar Road"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn btn-primary" onClick={create}>
            Banayein
          </button>
        </div>
      </div>
    </Sheet>
  )
}
