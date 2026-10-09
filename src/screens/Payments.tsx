import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { computeTotals } from '../lib/calc'
import { financialYear, fmtDate, lastNDays, money, monthEnd, monthStart, round2, todayISO, uid } from '../lib/format'
import { addPayment, deletePayment, paymentRegister, removePayment } from '../lib/repo'
import type { Business, DocType, Invoice, Party, PaymentDirection, PaymentMode } from '../lib/types'
import { PAYMENT_MODES, docMeta } from '../lib/types'
import { PartyPickerSheet } from '../components/PartyPickerSheet'
import { ChipRow, ConfirmDialog, EmptyState, Segmented, Sheet, StatBox, toast } from '../components/ui'

type RangeKey = 'today' | 'week' | 'month' | 'fy' | 'all' | 'custom'
type DirFilter = 'ALL' | 'IN' | 'OUT'

export function PaymentsScreen({ business, onOpenInvoice }: { business: Business; onOpenInvoice: (id: number) => void }) {
  const [range, setRange] = useState<RangeKey>('month')
  const [custom, setCustom] = useState({ from: monthStart(), to: todayISO() })
  const [dir, setDir] = useState<DirFilter>('ALL')
  const [addOpen, setAddOpen] = useState(false)
  const [toDelete, setToDelete] = useState<{ source: 'BILL' | 'PARTY'; invoiceId?: number; entryId?: string; label: string } | null>(null)

  const { from, to } = useMemo(() => {
    if (range === 'today') return { from: todayISO(), to: todayISO() }
    if (range === 'week') return lastNDays(7)
    if (range === 'month') return { from: monthStart(), to: monthEnd() }
    if (range === 'fy') {
      const startYear = Number('20' + financialYear(todayISO()).slice(0, 2))
      return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` }
    }
    if (range === 'all') return { from: '2000-01-01', to: '2099-12-31' }
    return custom
  }, [range, custom])

  const rows = useLiveQuery(() => paymentRegister(from, to), [from, to], [])

  const filtered = useMemo(
    () => (rows ?? []).filter((r) => dir === 'ALL' || r.direction === dir),
    [rows, dir],
  )

  const totals = useMemo(() => {
    let incoming = 0
    let outgoing = 0
    const byMode = new Map<PaymentMode, number>()
    filtered.forEach((r) => {
      if (r.direction === 'IN') incoming += r.amount
      else outgoing += r.amount
      byMode.set(r.mode, round2((byMode.get(r.mode) ?? 0) + r.amount))
    })
    return { incoming: round2(incoming), outgoing: round2(outgoing), byMode }
  }, [filtered])

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>()
    filtered.forEach((r) => {
      const list = map.get(r.date) ?? []
      list.push(r)
      map.set(r.date, list)
    })
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  // khata balance helpers for the "kis bill ke against" question
  const pendingBills = useLiveQuery(async () => {
    const invoices = await db.invoices.where('date').between(from, to, true, true).toArray()
    return invoices.filter((inv) => {
      if (inv.status !== 'FINAL') return false
      const meta = docMeta(inv.docType)
      if (!meta.isSale && !meta.isPurchase) return false
      return computeTotals(inv, business.stateCode).due > 0.5
    })
  }, [from, to, business.stateCode], [] as Invoice[])

  return (
    <div className="screen-content flex-1 px-3 pb-24 pt-3">
      <ChipRow>
        {(
          [
            ['today', 'Aaj'],
            ['week', '7 din'],
            ['month', 'Is mahine'],
            ['fy', 'Is saal (FY)'],
            ['all', 'Sab'],
            ['custom', 'Custom'],
          ] as [RangeKey, string][]
        ).map(([k, label]) => (
          <button key={k} className="chip" data-active={range === k} onClick={() => setRange(k)}>
            {label}
          </button>
        ))}
      </ChipRow>
      {range === 'custom' ? (
        <div className="mt-1 grid grid-cols-2 gap-2">
          <input type="date" className="input" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <input type="date" className="input" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </div>
      ) : null}

      <div className="mt-2 grid grid-cols-3 gap-2">
        <StatBox label="Paisa aaya" value={money(totals.incoming)} tone="money" icon="⬇" />
        <StatBox label="Paisa diya" value={money(totals.outgoing)} tone="due" icon="⬆" />
        <StatBox label="Net" value={money(round2(totals.incoming - totals.outgoing))} sub={`${filtered.length} entry`} />
      </div>

      <button className="btn btn-primary btn-block mt-2" onClick={() => setAddOpen(true)}>
        ＋ Payment likhein (aaya / diya)
      </button>

      <div className="mt-3">
        <Segmented
          value={dir}
          onChange={(v) => setDir(v)}
          options={[
            { value: 'ALL', label: 'Sab' },
            { value: 'IN', label: '⬇ Aaya (In)' },
            { value: 'OUT', label: '⬆ Diya (Out)' },
          ]}
        />
      </div>

      {totals.byMode.size ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[...totals.byMode.entries()].map(([mode, amount]) => (
            <span key={mode} className="badge badge-neutral">
              {PAYMENT_MODES.find((m) => m.key === mode)?.label ?? mode}: {money(amount, 0)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3">
        {filtered.length === 0 ? (
          <EmptyState
            icon="💸"
            title="Is period me koi payment nahi"
            hint="Bill ke andar se bhi payment likh sakte hain, ya upar wale button se seedha entry karein."
          />
        ) : null}

        {grouped.map(([date, list]) => (
          <div key={date} className="mb-3">
            <div className="flex items-center justify-between px-1 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <span>{fmtDate(date)}</span>
              <span className="num">
                {money(
                  round2(list.reduce((s, r) => s + (r.direction === 'IN' ? r.amount : -r.amount), 0)),
                )}
              </span>
            </div>
            <div className="card-flat overflow-hidden">
              {list.map((r) => (
                <div key={r.key} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 last:border-0">
                  <div
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-bold ${
                      r.direction === 'IN' ? 'bg-money-soft text-money' : 'bg-due-soft text-due'
                    }`}
                  >
                    {r.direction === 'IN' ? '⬇' : '⬆'}
                  </div>
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => (r.source === 'BILL' && r.invoiceId ? onOpenInvoice(r.invoiceId) : undefined)}
                  >
                    <div className="truncate text-[13px] font-semibold text-slate-900">{r.partyName}</div>
                    <div className="truncate text-[11px] text-slate-500">
                      {r.mode}
                      {r.docType ? ` • ${docMeta(r.docType as DocType).label}` : ' • Khata (on account)'}
                      {r.invoiceNumber ? ` • ${r.invoiceNumber}` : ''}
                      {r.note ? ` • ${r.note}` : ''}
                    </div>
                  </button>
                  <div className={`num shrink-0 text-[13px] font-extrabold ${r.direction === 'IN' ? 'text-money' : 'text-due'}`}>
                    {r.direction === 'IN' ? '+' : '−'}
                    {money(r.amount)}
                  </div>
                  <button
                    className="shrink-0 px-1 text-slate-400"
                    onClick={() =>
                      setToDelete({
                        source: r.source,
                        invoiceId: r.invoiceId,
                        entryId: r.entryId,
                        label: `${money(r.amount)} • ${r.partyName}`,
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <AddPaymentSheet
        open={addOpen}
        business={business}
        pendingBills={pendingBills ?? []}
        onClose={() => setAddOpen(false)}
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Payment entry hatayein?"
        message={toDelete?.label}
        confirmLabel="Hatayein"
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return
          if (toDelete.source === 'BILL' && toDelete.invoiceId && toDelete.entryId) {
            await removePayment(toDelete.invoiceId, toDelete.entryId)
          } else if (toDelete.source === 'PARTY' && toDelete.entryId) {
            await deletePayment(Number(toDelete.entryId))
          }
          setToDelete(null)
          toast('Payment entry hat gayi')
        }}
      />
    </div>
  )
}

// ---------------- Add payment ----------------

function AddPaymentSheet({
  open,
  business,
  pendingBills,
  onClose,
}: {
  open: boolean
  business: Business
  pendingBills: Invoice[]
  onClose: () => void
}) {
  const [direction, setDirection] = useState<PaymentDirection>('IN')
  const [party, setParty] = useState<Party | null>(null)
  const [partyOpen, setPartyOpen] = useState(false)
  const [billId, setBillId] = useState<'NONE' | number>('NONE')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<PaymentMode>('CASH')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const relevantBills = useMemo(() => {
    if (!party) return []
    return pendingBills.filter((inv) => {
      if (inv.partyId ? inv.partyId !== party.id : inv.partyName !== party.name) return false
      const meta = docMeta(inv.docType)
      return direction === 'IN' ? meta.isSale : meta.isPurchase
    })
  }, [pendingBills, party, direction])

  useEffect(() => {
    if (!open) return
    setParty(null)
    setBillId('NONE')
    setAmount('')
    setNote('')
    setDate(todayISO())
  }, [open])

  const selectedBill = relevantBills.find((b) => b.id === billId)
  const selectedDue = selectedBill ? computeTotals(selectedBill, business.stateCode).due : 0

  const save = async () => {
    const amt = round2(Number(amount) || 0)
    if (amt <= 0) {
      toast('Amount likhein', 'error')
      return
    }
    if (!party && !selectedBill) {
      toast('Party chunein (ya bill ke against likhein)', 'error')
      return
    }
    setBusy(true)
    try {
      if (selectedBill?.id) {
        const { recordPayment } = await import('../lib/repo')
        await recordPayment(selectedBill.id, {
          amount: amt,
          mode,
          date,
          note: note.trim() || undefined,
        })
        toast(`${money(amt)} ${direction === 'IN' ? 'received' : 'paid'} — bill me jud gaya`, 'success')
      } else {
        await addPayment({
          date,
          direction,
          partyId: party?.id,
          partyName: party?.name ?? 'Cash',
          amount: amt,
          mode,
          note: note.trim(),
          createdAt: Date.now(),
        })
        toast(`${money(amt)} khata me likh liya`, 'success')
      }
      onClose()
    } catch {
      toast('Save nahi hua', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Payment entry"
        subtitle="Customer se paisa aaya ya supplier ko diya — dono yahan likhein"
        footer={
          <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
            💾 Save karein
          </button>
        }
      >
        <div className="flex flex-col gap-3">
          <Segmented
            value={direction}
            onChange={(v) => {
              setDirection(v)
              setBillId('NONE')
            }}
            options={[
              { value: 'IN', label: '⬇ Paisa aaya (customer)' },
              { value: 'OUT', label: '⬆ Paisa diya (supplier)' },
            ]}
          />

          <button className="card flex w-full items-center gap-3 text-left" onClick={() => setPartyOpen(true)}>
            <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-lg">👤</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{party?.name ?? 'Party chunein'}</div>
              <div className="truncate text-[11px] text-slate-500">
                {party ? party.phone || 'no mobile' : direction === 'IN' ? 'Customer chunein' : 'Supplier chunein'}
              </div>
            </div>
            <span className="text-slate-400">›</span>
          </button>

          {relevantBills.length ? (
            <div className="field">
              <label className="label">Kis bill ke against? (optional)</label>
              <select className="select" value={String(billId)} onChange={(e) => {
                const v = e.target.value
                setBillId(v === 'NONE' ? 'NONE' : Number(v))
                if (v !== 'NONE') {
                  const b = relevantBills.find((x) => x.id === Number(v))
                  if (b) setAmount(String(round2(computeTotals(b, business.stateCode).due)))
                }
              }}>
                <option value="NONE">On account / advance (kisi bill ke against nahi)</option>
                {relevantBills.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.number} • {b.partyName} • baki {money(computeTotals(b, business.stateCode).due, 0)}
                  </option>
                ))}
              </select>
              {selectedBill ? (
                <div className="mt-1 text-[11px] text-slate-500">
                  Is bill me {money(selectedDue)} baaki hai.
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="field">
            <label className="label">Amount (₹)</label>
            <input
              className="input input-lg"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>
          {selectedBill ? (
            <div className="flex gap-1.5">
              <button className="chip" onClick={() => setAmount(String(round2(selectedDue)))}>
                Pura baki {money(selectedDue, 0)}
              </button>
              <button className="chip" onClick={() => setAmount(String(round2(selectedDue / 2)))}>
                Aadha
              </button>
            </div>
          ) : null}

          <div className="field">
            <label className="label">Mode</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PAYMENT_MODES.map((m) => (
                <button key={m.key} className="chip justify-center" data-active={mode === m.key} onClick={() => setMode(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label">Date</label>
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Note</label>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="UPI ref / cheque no." />
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            {direction === 'IN'
              ? 'Paisa aaya = customer ka udhaar kam hoga. Bill ke against likhne se us bill ka "baki" bhi update ho jayega.'
              : 'Paisa diya = supplier ko payable kam hoga.'}
          </p>
        </div>
      </Sheet>

      <PartyPickerSheet
        open={partyOpen}
        onClose={() => setPartyOpen(false)}
        shopStateCode={business.stateCode}
        partyType={direction === 'IN' ? 'CUSTOMER' : 'SUPPLIER'}
        allowCash={false}
        onPick={(p) => {
          setParty(p)
          setBillId('NONE')
        }}
      />
    </>
  )
}

/** Unique id helper kept for callers that pre-build entries */
export const newPaymentId = (): string => uid()
