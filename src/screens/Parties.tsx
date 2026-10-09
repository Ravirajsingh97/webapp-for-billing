import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { computeTotals } from '../lib/calc'
import { allBalances, balanceOf, deleteParty, partyInvoices, upsertParty } from '../lib/repo'
import { cleanPhone, fmtDate, money, round2, todayISO, waLink } from '../lib/format'
import { ConfirmDialog, EmptyState, SearchInput, Segmented, Sheet, toast } from '../components/ui'
import type { Business, Invoice, Party, PartyType } from '../lib/types'
import { STATES, docMeta } from '../lib/types'

export function PartiesScreen({ business, onOpenInvoice }: { business: Business; onOpenInvoice: (id: number) => void }) {
  const [tab, setTab] = useState<PartyType>('CUSTOMER')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Party | null>(null)
  const [ledger, setLedger] = useState<Party | null>(null)
  const [toDelete, setToDelete] = useState<Party | null>(null)

  const parties = useLiveQuery(() => db.parties.orderBy('name').toArray(), [], [] as Party[])
  const balances = useLiveQuery(() => allBalances(business.stateCode), [business.stateCode, parties.length], new Map<number, number>())

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return parties
      .filter((p) => p.type === tab)
      .filter((p) => !needle || `${p.name} ${p.phone ?? ''} ${p.gstin ?? ''}`.toLowerCase().includes(needle))
  }, [parties, tab, q])

  const totals = useMemo(() => {
    let receivable = 0
    let advance = 0
    let payable = 0
    let supplierAdvance = 0
    parties.forEach((p) => {
      const b = balances.get(p.id!) ?? 0
      if (p.type === 'SUPPLIER') {
        if (b < 0) payable += -b
        else supplierAdvance += b
      } else {
        if (b > 0) receivable += b
        else advance += -b
      }
    })
    return {
      receivable: round2(receivable),
      advance: round2(advance),
      payable: round2(payable),
      supplierAdvance: round2(supplierAdvance),
    }
  }, [parties, balances])

  const newParty = (): Party => ({
    type: tab,
    name: '',
    phone: '',
    gstin: '',
    address: '',
    state: business.stateCode,
    openingBalance: 0,
    createdAt: Date.now(),
  })

  return (
    <div className="screen-content flex-1 px-3 pb-24 pt-3">
      <Segmented
        value={tab}
        onChange={(v) => setTab(v)}
        options={[
          { value: 'CUSTOMER', label: '👤 Customer (grahak)' },
          { value: 'SUPPLIER', label: '🏭 Supplier' },
        ]}
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        {tab === 'CUSTOMER' ? (
          <>
            <div className="stat-box">
              <div className="text-[10px] font-bold uppercase text-slate-500">Inse lena hai (udhaar)</div>
              <div className="num text-[15px] font-extrabold text-due">{money(totals.receivable)}</div>
            </div>
            <div className="stat-box">
              <div className="text-[10px] font-bold uppercase text-slate-500">Advance jama (unka paisa)</div>
              <div className="num text-[15px] font-extrabold text-money">{money(totals.advance)}</div>
            </div>
          </>
        ) : (
          <>
            <div className="stat-box">
              <div className="text-[10px] font-bold uppercase text-slate-500">Inko dena hai (payable)</div>
              <div className="num text-[15px] font-extrabold text-warn">{money(totals.payable)}</div>
            </div>
            <div className="stat-box">
              <div className="text-[10px] font-bold uppercase text-slate-500">Advance diya hua</div>
              <div className="num text-[15px] font-extrabold text-money">{money(totals.supplierAdvance)}</div>
            </div>
          </>
        )}
      </div>

      <div className="mt-3">
        <SearchInput value={q} onChange={setQ} placeholder="Party ka naam, mobile ya GSTIN…" />
      </div>

      <button className="btn btn-primary btn-block mt-2" onClick={() => setEditing(newParty())}>
        ＋ Naya {tab === 'CUSTOMER' ? 'customer' : 'supplier'} jodein
      </button>

      <div className="mt-3">
        {filtered.length === 0 ? (
          <EmptyState
            icon="👥"
            title={tab === 'CUSTOMER' ? 'Koi customer nahi' : 'Koi supplier nahi'}
            hint="Party jodne se udhaar khata aur payment reminder aasan ho jata hai."
          />
        ) : (
          <div className="card-flat overflow-hidden">
            {filtered.map((p) => {
              const bal = balances.get(p.id!) ?? 0
              return (
                <button key={p.id} className="list-row w-full text-left" onClick={() => setLedger(p)}>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                    {p.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-slate-900">{p.name}</div>
                    <div className="truncate text-[11px] text-slate-500">
                      {p.phone || 'no mobile'}
                      {p.gstin ? ` • ${p.gstin}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={`num text-[13px] font-extrabold ${
                        bal > 0.5
                          ? p.type === 'SUPPLIER'
                            ? 'text-money'
                            : 'text-due'
                          : bal < -0.5
                            ? p.type === 'SUPPLIER'
                              ? 'text-warn'
                              : 'text-money'
                            : 'text-slate-400'
                      }`}
                    >
                      {money(Math.abs(bal))}
                    </div>
                    <div className="text-[9px] font-bold uppercase text-slate-400">
                      {bal > 0.5
                        ? p.type === 'SUPPLIER'
                          ? 'advance diya'
                          : 'lena hai'
                        : bal < -0.5
                          ? p.type === 'SUPPLIER'
                            ? 'dena hai'
                            : 'advance jama'
                          : 'hisab clear'}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {editing ? (
      <PartyEditor
        party={editing}
        business={business}
        onClose={() => setEditing(null)}
        onDelete={(p) => {
          setEditing(null)
          setToDelete(p)
        }}
      />
      ) : null}

      <LedgerSheet
        party={ledger}
        business={business}
        onClose={() => setLedger(null)}
        onEdit={(p) => {
          setLedger(null)
          setEditing(p)
        }}
        onOpenInvoice={(id) => {
          setLedger(null)
          onOpenInvoice(id)
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Party delete karein?"
        message="Purane bills me party ka naam waise hi rahega, sirf khata hat jayega."
        confirmLabel="Delete"
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete?.id) await deleteParty(toDelete.id)
          setToDelete(null)
          toast('Party delete ho gayi')
        }}
      />
    </div>
  )
}

function PartyEditor({
  party,
  business,
  onClose,
  onDelete,
}: {
  party: Party | null
  business: Business
  onClose: () => void
  onDelete: (p: Party) => void
}) {
  const [draft, setDraft] = useState<Party | null>(party)
  const [key, setKey] = useState<number | null>(null)

  if (party && key !== (party.id ?? -1)) {
    setKey(party.id ?? -1)
    setDraft(party)
  }
  if (!draft) return null

  const save = async () => {
    if (!draft.name.trim()) {
      toast('Naam likhein', 'error')
      return
    }
    await upsertParty({
      ...draft,
      name: draft.name.trim(),
      phone: cleanPhone(draft.phone).replace(/^91/, ''),
      gstin: (draft.gstin ?? '').toUpperCase(),
    })
    toast('Party save ho gayi', 'success')
    onClose()
  }

  return (
    <Sheet
      open={!!party}
      onClose={onClose}
      title={draft.id ? 'Party edit karein' : 'Nayi party'}
      subtitle={draft.id ? draft.name : 'Naam zaroori hai'}
      footer={
        <div className="flex gap-2">
          {draft.id ? (
            <button className="btn btn-danger-soft" onClick={() => onDelete(draft)}>
              🗑
            </button>
          ) : null}
          <button className="btn btn-primary flex-1" onClick={save}>
            💾 Save
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented
          value={draft.type}
          onChange={(v) => setDraft({ ...draft, type: v })}
          options={[
            { value: 'CUSTOMER', label: 'Customer' },
            { value: 'SUPPLIER', label: 'Supplier' },
          ]}
        />
        <div className="field">
          <label className="label">Naam *</label>
          <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="field">
            <label className="label">Mobile</label>
            <input className="input" inputMode="tel" value={draft.phone ?? ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          </div>
          <div className="field">
            <label className="label">GSTIN</label>
            <input className="input uppercase" value={draft.gstin ?? ''} onChange={(e) => setDraft({ ...draft, gstin: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label className="label">Address</label>
          <textarea className="textarea" value={draft.address ?? ''} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="field">
            <label className="label">State</label>
            <select className="select" value={draft.state ?? business.stateCode} onChange={(e) => setDraft({ ...draft, state: e.target.value })}>
              {STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Purana bakaya</label>
            <input
              className="input text-right"
              inputMode="decimal"
              value={draft.openingBalance}
              onChange={(e) => setDraft({ ...draft, openingBalance: Number(e.target.value) || 0 })}
            />
          </div>
        </div>
      </div>
    </Sheet>
  )
}

function LedgerSheet({
  party,
  business,
  onClose,
  onEdit,
  onOpenInvoice,
}: {
  party: Party | null
  business: Business
  onClose: () => void
  onEdit: (p: Party) => void
  onOpenInvoice: (id: number) => void
}) {
  const invoices = useLiveQuery(
    () => (party?.id ? partyInvoices(party.id) : Promise.resolve([] as Invoice[])),
    [party?.id],
    [] as Invoice[],
  )
  const balance = useLiveQuery(
    () => (party?.id ? balanceOf(party.id, business.stateCode) : Promise.resolve(0)),
    [party?.id, business.stateCode],
    0,
  )

  if (!party) return null

  let totalBusiness = 0
  let totalPaid = 0
  invoices.forEach((inv) => {
    const t = computeTotals(inv, business.stateCode)
    if (inv.status !== 'FINAL') return
    if (docMeta(inv.docType).isSale) {
      totalBusiness += t.grandTotal
      totalPaid += t.paid
    }
  })

  const reminderText =
    party.type === 'SUPPLIER' || balance < 0
      ? `${party.name} ji 🙏\n${business.name} ki taraf se — humara ₹${round2(Math.abs(balance)).toFixed(0)} aapke paas baaki hai.${
          business.upiId ? `\nUPI: ${business.upiId}` : ''
        }\nKripya hisab clear kar dijiye. Dhanyavaad!`
      : `Namaste ${party.name} ji 🙏\n${business.name} ki taraf se yaad dilana — aapka ₹${round2(balance).toFixed(0)} baaki hai${
          business.upiId ? `.\nUPI: ${business.upiId}` : ''
        }.\nKripya payment kar dijiye. Dhanyavaad!`

  return (
    <Sheet
      open={!!party}
      onClose={onClose}
      title={party.name}
      subtitle={`${party.type === 'SUPPLIER' ? 'Supplier' : 'Customer'} • ${party.phone || 'no mobile'}`}
      full
      footer={
        <div className="flex gap-2">
          <button className="btn btn-outline flex-1" onClick={() => onEdit(party)}>
            ✏️ Edit
          </button>
          {party.phone ? (
            <a
              className="btn btn-money flex-1"
              href={waLink(party.phone, reminderText)}
              target="_blank"
              rel="noreferrer"
            >
              💬 Reminder bhejein
            </a>
          ) : null}
        </div>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <div className="stat-box">
          <div className="text-[10px] font-bold uppercase text-slate-500">Total business</div>
          <div className="num text-[14px] font-extrabold">{money(totalBusiness, 0)}</div>
        </div>
        <div className="stat-box">
          <div className="text-[10px] font-bold uppercase text-slate-500">Paid</div>
          <div className="num text-[14px] font-extrabold text-money">{money(totalPaid, 0)}</div>
        </div>
        <div className={`stat-box ${balance > 0.5 ? 'border-due-soft bg-due-soft/40' : ''}`}>
          <div className="text-[10px] font-bold uppercase text-slate-500">
            {balance > 0.5 ? (party.type === 'SUPPLIER' ? 'Advance diya' : 'Lena hai') : balance < -0.5 ? (party.type === 'SUPPLIER' ? 'Dena hai' : 'Advance jama') : 'Hisab clear'}
          </div>
          <div
            className={`num text-[14px] font-extrabold ${
              balance > 0.5 ? (party.type === 'SUPPLIER' ? 'text-money' : 'text-due') : 'text-money'
            }`}
          >
            {money(Math.abs(balance), 0)}
          </div>
        </div>
      </div>

      {party.address || party.gstin ? (
        <div className="mt-2 rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600">
          {party.address}
          {party.gstin ? <div>GSTIN: {party.gstin}</div> : null}
        </div>
      ) : null}

      <div className="section-title mt-4">
        <span>Khata (ledger)</span>
        <span className="text-[11px] font-normal text-slate-500">{invoices.length} bill</span>
      </div>
      {invoices.length === 0 ? (
        <div className="rounded-xl bg-slate-50 p-4 text-center text-[12px] text-slate-500">
          Is party ka koi bill nahi hai.
        </div>
      ) : (
        <div className="card-flat overflow-hidden">
          {invoices.slice(0, 60).map((inv) => {
            const t = computeTotals(inv, business.stateCode)
            const meta = docMeta(inv.docType)
            return (
              <button key={inv.id} className="list-row w-full text-left" onClick={() => onOpenInvoice(inv.id!)}>
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-[12px]">{meta.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-slate-800">{inv.number}</div>
                  <div className="truncate text-[10px] text-slate-500">
                    {fmtDate(inv.date, 'num')} • {meta.label}
                    {inv.status === 'CANCELLED' ? ' • cancelled' : ''}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-[12px] font-bold">{money(t.grandTotal)}</div>
                  {t.due > 0.5 ? <div className="num text-[10px] font-bold text-due">baki {money(t.due, 0)}</div> : <div className="text-[10px] font-bold text-money">paid</div>}
                </div>
              </button>
            )
          })}
        </div>
      )}
      <div className="mt-3 text-[10px] text-slate-400">Aaj: {fmtDate(todayISO())}</div>
    </Sheet>
  )
}
