import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { upsertParty } from '../lib/repo'
import { cleanPhone, money } from '../lib/format'
import { SearchInput, Sheet, toast } from './ui'
import type { Party, PartyType } from '../lib/types'
import { STATES } from '../lib/types'

export function PartyPickerSheet({
  open,
  onClose,
  onPick,
  shopStateCode = '08',
  partyType = 'ALL',
  allowCash = true,
}: {
  open: boolean
  onClose: () => void
  onPick: (party: Party | null) => void
  shopStateCode?: string
  partyType?: PartyType | 'ALL'
  allowCash?: boolean
}) {
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<{ name: string; phone: string; gstin: string; address: string; state: string; type: PartyType; openingBalance: string }>({
    name: '',
    phone: '',
    gstin: '',
    address: '',
    state: shopStateCode,
    type: partyType === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER',
    openingBalance: '',
  })

  const parties = useLiveQuery(() => db.parties.orderBy('name').toArray(), [], [] as Party[])

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    const scoped = partyType === 'ALL' ? parties : parties.filter((p) => p.type === partyType)
    const list = n
      ? scoped.filter((p) => p.name.toLowerCase().includes(n) || (p.phone ?? '').includes(n))
      : scoped
    return list.slice(0, 150)
  }, [parties, q, partyType])

  const save = async () => {
    if (!form.name.trim()) {
      toast('Party ka naam likhein', 'error')
      return
    }
    const party: Party = {
      type: form.type,
      name: form.name.trim(),
      phone: cleanPhone(form.phone).replace(/^91/, ''),
      gstin: form.gstin.trim().toUpperCase(),
      address: form.address.trim(),
      state: form.state,
      openingBalance: Number(form.openingBalance) || 0,
      createdAt: Date.now(),
    }
    await upsertParty(party)
    toast('Party save ho gaya', 'success')
    setCreating(false)
    setForm({ ...form, name: '', phone: '', gstin: '', address: '', openingBalance: '' })
    const saved = (await db.parties.toArray()).find((p) => p.name === party.name && p.phone === party.phone)
    if (saved) {
      onPick(saved)
      onClose()
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={creating ? 'Naya party / customer' : 'Party chunein'}
      subtitle={
        creating
          ? 'Naam zaroori hai, baaki optional'
          : `${filtered.length} ${partyType === 'SUPPLIER' ? 'supplier' : 'party'}`
      }
      full
    >
      {creating ? (
        <div className="flex flex-col gap-3">
          <div className="field">
            <label className="label">Naam *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sharma Ji / Gupta Builders" autoFocus />
          </div>
          <div className="responsive-form-grid grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label">Mobile</label>
              <input className="input" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="98765 43210" />
            </div>
            <div className="field">
              <label className="label">GSTIN</label>
              <input className="input uppercase" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="08ABCDE1234F1Z5" />
            </div>
          </div>
          <div className="field">
            <label className="label">Address</label>
            <textarea className="textarea" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="responsive-form-grid grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label">State (GST)</label>
              <select className="select" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                {STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">Purana bakaya (opening)</label>
              <input className="input" inputMode="decimal" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} placeholder="0" />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-outline flex-1" onClick={() => setCreating(false)}>
              Peeche
            </button>
            <button className="btn btn-primary flex-1" onClick={save}>
              Save karein
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="sticky -top-3 z-10 -mx-4 -mt-3 mb-2 bg-white px-4 pb-2 pt-3">
            <SearchInput value={q} onChange={setQ} placeholder="Party ka naam ya mobile…" />
            <div className="mt-2 flex gap-2">
              {allowCash ? (
                <button className="btn btn-outline btn-sm flex-1" onClick={() => { onPick(null); onClose() }}>
                  🧍 Cash Sale (bina party)
                </button>
              ) : null}
              <button className="btn btn-primary btn-sm flex-1" onClick={() => setCreating(true)}>
                ＋ Naya {partyType === 'SUPPLIER' ? 'supplier' : 'party'}
              </button>
            </div>
          </div>
          <div className="-mx-4">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">
                Koi party nahi mili. “Naya party” se jodein.
              </div>
            ) : null}
            {filtered.map((p) => (
              <button
                key={p.id}
                className="list-row w-full text-left"
                onClick={() => {
                  onPick(p)
                  onClose()
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-slate-900">{p.name}</div>
                  <div className="truncate text-[11px] text-slate-500">
                    {p.phone || 'no mobile'}
                    {p.gstin ? ` • ${p.gstin}` : ''} • {p.type === 'SUPPLIER' ? 'Supplier' : 'Customer'}
                  </div>
                </div>
                <div className="shrink-0 text-right text-[11px] font-semibold text-slate-500">
                  {p.openingBalance ? <span className="text-warn">Opening {money(p.openingBalance)}</span> : null}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  )
}
