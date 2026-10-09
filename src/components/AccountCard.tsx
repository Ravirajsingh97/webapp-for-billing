import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { activeCompany, activeCompanyId, listCompanies } from '../lib/company'
import { addUser, deleteUser, logout, setUserPin, userCount, currentUser, updateUser, type User, type UserRole } from '../lib/auth'
import { ConfirmDialog, Sheet, toast } from '../components/ui'
import { CompanySheet } from '../screens/Auth'

const initial = (name: string) => name.trim().slice(0, 1).toUpperCase() || '👤'

function defaultLogout() {
  try {
    window.location.reload()
  } catch {
    /* ignore */
  }
}

export function AccountCard({ onLogout = defaultLogout }: { onLogout?: () => void }) {
  const [companySheet, setCompanySheet] = useState(false)
  const [usersSheet, setUsersSheet] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState<User | null>(null)
  const [pinFor, setPinFor] = useState<User | null>(null)
  const [people, setPeople] = useState(0)
  const [companies, setCompanies] = useState(1)
  const [tick, setTick] = useState(0)

  const users = useLiveQuery(() => db.users.toArray(), [tick], [] as User[])
  const current = useLiveQuery(() => currentUser(), [tick, usersSheet])
  const canManage = (users?.length ?? 0) === 0 || current?.role === 'OWNER'
  const company = activeCompany()

  useEffect(() => {
    void userCount().then(setPeople)
    setCompanies(listCompanies().length)
  }, [tick, usersSheet])

  const activeCount = (users ?? []).filter((u) => u.active).length

  return (
    <>
      {/* Company / Firm */}
      <div className="card mt-3">
        <div className="text-[13px] font-bold text-slate-700">🏢 Company / Firm</div>
        <button className="list-row mt-2 w-full text-left" onClick={() => setCompanySheet(true)}>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-base">🏢</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-slate-900">{company.name}</div>
            <div className="text-[11px] text-slate-500">
              {companies > 1 ? `${companies} companies — switch karein` : 'Switch ya nayi company banayein'}
            </div>
          </div>
          <span className="text-slate-400">›</span>
        </button>
      </div>

      {/* Users + login */}
      <div className="card mt-3">
        <div className="text-[13px] font-bold text-slate-700">👤 Users & login</div>
        <div className="mt-1 text-[11px] text-slate-500">
          {activeCount === 0
            ? 'Abhi login band hai — user banate hi app PIN maangegi.'
            : `Login chalu hai · ${activeCount} active user${activeCount > 1 ? 's' : ''} · ${people} total`}
        </div>
        <div className="mt-2 flex gap-2">
          <button className="btn btn-outline flex-1" onClick={() => setUsersSheet(true)}>
            👥 Users dekhein / banayein
          </button>
          {activeCount > 0 ? (
            <button
              className="btn btn-ghost"
              onClick={() => {
                logout()
                onLogout()
              }}
            >
              🚪 Logout
            </button>
          ) : null}
        </div>
      </div>

      <CompanySheet open={companySheet} onClose={() => setCompanySheet(false)} onChanged={() => setTick((t) => t + 1)} />

      {/* Users sheet */}
      <Sheet
        open={usersSheet}
        onClose={() => setUsersSheet(false)}
        title="👥 Users"
        subtitle="Owner sab kuch kar sakta hai; staff billing + khata dekhta hai"
        footer={
          <button disabled={!canManage} className="btn btn-primary btn-block" onClick={() => setAddOpen(true)}>
            ＋ Naya user banayein
          </button>
        }
      >
        <div className="flex flex-col gap-2">
          {(users ?? []).map((u) => (
            <div key={u.id} className="list-row">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-indigo-100 text-[12px] font-bold text-indigo-800">
                {initial(u.name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-slate-900">
                  {u.name} {u.active ? '' : '(band)'}
                </div>
                <div className="text-[11px] text-slate-500">
                  {u.role === 'OWNER' ? 'Owner' : 'Staff'} · PIN {u.pinLength} ank
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!canManage}
                onClick={() => setPinFor(u)}
                aria-label="PIN badlein"
              >
                🔑
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!canManage}
                onClick={() => {
                  void updateUser(u.id!, { active: !u.active }).then(() => setTick((t) => t + 1)).catch((e) => toast(e.message, 'error'))
                }}
              >
                {u.active ? '⏸' : '▶'}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={!canManage}
                onClick={() => setConfirmDel(u)} aria-label="User hatayein">
                🗑
              </button>
            </div>
          ))}
          {(users ?? []).length === 0 ? (
            <div className="py-6 text-center text-[13px] text-slate-500">
              Abhi koi user nahi hai. App bina login khulti hai — user banate hi login chalu ho jayega.
            </div>
          ) : null}
        </div>
      </Sheet>

      <AddUserSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false)
          setTick((t) => t + 1)
        }}
      />

      <PinSheet
        user={pinFor}
        onClose={() => setPinFor(null)}
        onSaved={() => {
          setPinFor(null)
          setTick((t) => t + 1)
          toast('PIN badal gaya', 'success')
        }}
      />

      <ConfirmDialog
        open={!!confirmDel}
        title="User hata dein?"
        message={`${confirmDel?.name ?? ''} ab login nahi kar payega. Billing data par koi asar nahi padega.`}
        confirmLabel="Haan, hata dein"
        onCancel={() => setConfirmDel(null)}
        onConfirm={() => {
          if (confirmDel?.id) void deleteUser(confirmDel.id).then(() => setTick((t) => t + 1)).catch((e) => toast(e.message, 'error'))
          setConfirmDel(null)
        }}
      />
    </>
  )
}

function AddUserSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<UserRole>('STAFF')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [err, setErr] = useState('')

  const save = async () => {
    if (!name.trim()) return setErr('Naam likhein')
    if (!/^\d{4,6}$/.test(pin)) return setErr('PIN 4 se 6 ank ka rakhein')
    if (pin !== pin2) return setErr('Dono PIN ek jaise likhein')
    try {
      await addUser({ name, role, pin })
      setName('')
      setPin('')
      setPin2('')
      setErr('')
      toast(`${name.trim()} ban gaya — ab login chalu hai`, 'success')
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'User nahi ban paya')
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="＋ Naya user"
      subtitle="Naam, role aur 4-6 ank ka PIN. Pehla user hamesha owner banta hai."
      footer={
        <button className="btn btn-primary btn-block" onClick={save}>
          User banayein
        </button>
      }
    >
      <label className="text-[12px] font-semibold text-slate-600">Naam</label>
      <input className="input mb-3" placeholder="Jaise: Ravi (counter)" value={name} onChange={(e) => setName(e.target.value)} />

      <div className="text-[12px] font-semibold text-slate-600">Role</div>
      <div className="mb-3 mt-1 flex gap-2">
        {(['OWNER', 'STAFF'] as UserRole[]).map((r) => (
          <button
            key={r}
            className="chip"
            data-active={role === r}
            onClick={() => setRole(r)}
            type="button"
          >
            {r === 'OWNER' ? '👑 Owner (मालिक)' : '🙋 Staff (कर्मचारी)'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[12px] font-semibold text-slate-600">PIN</label>
          <input
            className="input num"
            inputMode="numeric"
            maxLength={6}
            placeholder="4-6 ank"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-slate-600">PIN dobara</label>
          <input
            className="input num"
            inputMode="numeric"
            maxLength={6}
            placeholder="wahi PIN"
            value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      </div>

      {err ? <div className="mt-2 text-[12px] font-semibold text-red-600">{err}</div> : null}
      <div className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Users aur PIN sirf aapke phone me rehte hain. PIN bhool jayein to owner login screen se naya bana sakta hai.
      </div>
    </Sheet>
  )
}

function PinSheet({
  user,
  onClose,
  onSaved,
}: {
  user: User | null
  onClose: () => void
  onSaved: () => void
}) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    setPin('')
    setErr('')
  }, [user])

  return (
    <Sheet
      open={!!user}
      onClose={onClose}
      title={`🔑 ${user?.name ?? ''} ka naya PIN`}
      subtitle="4 se 6 ank"
      footer={
        <button
          className="btn btn-primary btn-block"
          onClick={async () => {
            if (!user?.id) return
            if (!/^\d{4,6}$/.test(pin)) {
              setErr('PIN 4 se 6 ank ka rakhein')
              return
            }
            try {
              await setUserPin(user.id, pin)
              onSaved()
            } catch (e) { setErr(e instanceof Error ? e.message : 'PIN nahi badla') }
          }}
        >
          PIN badlein
        </button>
      }
    >
      <input
        className="input num"
        inputMode="numeric"
        maxLength={6}
        placeholder="Naya PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
      />
      {err ? <div className="mt-2 text-[12px] font-semibold text-red-600">{err}</div> : null}
      <div className="mt-2 text-[11px] text-slate-500">Active company: {activeCompanyId() === 'default' ? activeCompany().name : activeCompany().name}</div>
    </Sheet>
  )
}
