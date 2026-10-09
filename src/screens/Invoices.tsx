import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { computeTotals, payStatus, statusMeta } from '../lib/calc'
import { financialYear, fmtDate, lastNDays, money, monthStart, monthEnd, num, round2, todayISO, waLink } from '../lib/format'
import { invoiceText } from '../lib/doc'
import { invoicesToCsv } from '../lib/csvutil'
import { download } from '../lib/format'
import type { Business, DocType, Invoice } from '../lib/types'
import { DOC_TYPES, docMeta } from '../lib/types'
import { ChipRow, EmptyState, SearchInput, StatBox, toast } from '../components/ui'
import { recordPayment } from '../lib/repo'

type RangeKey = 'today' | 'week' | 'month' | 'fy' | 'all' | 'custom'
type StatusKey = 'ALL' | 'PAID' | 'DUE'

export function InvoicesScreen({
  business,
  onOpen,
  onNewBill,
}: {
  business: Business
  onOpen: (id: number) => void
  onNewBill: (docType: DocType) => void
}) {
  const [range, setRange] = useState<RangeKey>('month')
  const [custom, setCustom] = useState({ from: monthStart(), to: todayISO() })
  const [docFilter, setDocFilter] = useState<DocType | 'ALL'>('ALL')
  const [status, setStatus] = useState<StatusKey>('ALL')
  const [q, setQ] = useState('')

  const invoices = useLiveQuery(() => db.invoices.orderBy('date').reverse().toArray(), [], [] as Invoice[])

  const { from, to } = useMemo(() => {
    if (range === 'today') return { from: todayISO(), to: todayISO() }
    if (range === 'week') return lastNDays(7)
    if (range === 'month') return { from: monthStart(), to: monthEnd() }
    if (range === 'fy') {
      const fy = financialYear(todayISO())
      const startYear = Number('20' + fy.slice(0, 2))
      return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` }
    }
    if (range === 'all') return { from: '2000-01-01', to: '2099-12-31' }
    return custom
  }, [range, custom])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return invoices.filter((inv) => {
      if (inv.date < from || inv.date > to) return false
      if (docFilter !== 'ALL' && inv.docType !== docFilter) return false
      if (needle) {
        const hay = `${inv.number} ${inv.partyName} ${inv.partyPhone ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      if (status !== 'ALL') {
        const t = computeTotals(inv, business.stateCode)
        const s = payStatus(t)
        if (status === 'PAID' && s !== 'PAID') return false
        if (status === 'DUE' && s === 'PAID') return false
      }
      return true
    })
  }, [invoices, from, to, docFilter, q, status, business.stateCode])

  const totals = useMemo(() => {
    let sale = 0
    let due = 0
    let paid = 0
    filtered.forEach((inv) => {
      if (inv.status === 'CANCELLED') return
      const meta = docMeta(inv.docType)
      const t = computeTotals(inv, business.stateCode)
      if (meta.isSale) {
        sale += t.grandTotal
        due += t.due
        paid += t.paid
      } else if (meta.negative) {
        sale -= t.grandTotal
      }
    })
    return { sale: round2(sale), due: round2(due), paid: round2(paid) }
  }, [filtered, business.stateCode])

  const grouped = useMemo(() => {
    const map = new Map<string, Invoice[]>()
    filtered.forEach((inv) => {
      const list = map.get(inv.date) ?? []
      list.push(inv)
      map.set(inv.date, list)
    })
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  return (
    <div className="screen-content flex-1 px-3 pb-24 pt-3">
      <SearchInput value={q} onChange={setQ} placeholder="Bill number, party, mobile…" />

      <div className="mt-2">
        <ChipRow>
          <button className="chip" data-active={docFilter === 'ALL'} onClick={() => setDocFilter('ALL')}>
            Sab
          </button>
          {DOC_TYPES.map((d) => (
            <button key={d.key} className="chip" data-active={docFilter === d.key} onClick={() => setDocFilter(d.key)}>
              {d.icon} {d.label.split(' ')[0]}
            </button>
          ))}
        </ChipRow>
      </div>

      <div className="mt-1">
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
      </div>

      {range === 'custom' ? (
        <div className="responsive-form-grid mt-1 grid grid-cols-2 gap-2">
          <input type="date" className="input" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <input type="date" className="input" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </div>
      ) : null}

      <div className="stats-grid mt-2 grid grid-cols-3 gap-2">
        <StatBox label="Bills" value={num(filtered.length, 0)} sub={`${fmtDate(from)} – ${fmtDate(to)}`} />
        <StatBox label="Sale" value={money(totals.sale)} tone="money" />
        <StatBox label="Baki (lena)" value={money(totals.due)} tone="due" />
      </div>

      <div className="filter-toolbar mt-2 flex items-center justify-between">
        <div className="filter-actions flex gap-1.5">
          {(['ALL', 'PAID', 'DUE'] as StatusKey[]).map((s) => (
            <button key={s} className="chip" data-active={status === s} onClick={() => setStatus(s)}>
              {s === 'ALL' ? 'Sab' : s === 'PAID' ? 'Paid' : 'Baki wale'}
            </button>
          ))}
        </div>
        <button
          className="toolbar-export btn btn-ghost btn-sm"
          onClick={() => {
            if (!filtered.length) {
              toast('Export ke liye koi bill nahi', 'error')
              return
            }
            download(`bills-${from}-to-${to}.csv`, invoicesToCsv(filtered, business))
            toast('CSV download ho gayi', 'success')
          }}
        >
          ⬇ CSV
        </button>
      </div>

      <div className="mt-3">
        {grouped.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="Koi bill nahi mila"
            hint="Filter badlein ya naya bill banayein."
            action={
              <button className="btn btn-primary btn-sm mt-2" onClick={() => onNewBill('TAX_INVOICE')}>
                ＋ Naya bill banayein
              </button>
            }
          />
        ) : null}

        {grouped.map(([date, list]) => {
          const dayTotal = round2(
            list.reduce((s, inv) => (inv.status === 'CANCELLED' ? s : s + computeTotals(inv, business.stateCode).grandTotal), 0),
          )
          return (
            <div key={date} className="mb-3">
              <div className="flex items-center justify-between px-1 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <span>{fmtDate(date)}</span>
                <span className="num">{money(dayTotal)}</span>
              </div>
              <div className="card-flat overflow-hidden">
                {list.map((inv) => {
                  const t = computeTotals(inv, business.stateCode)
                  const meta = docMeta(inv.docType)
                  const st = statusMeta(payStatus(t))
                  return (
                    <div key={inv.id} className="border-b border-slate-100 last:border-0">
                      <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-slate-50" onClick={() => onOpen(inv.id!)}>
                        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm ${meta.noTax ? 'bg-slate-100' : 'bg-brand-50'}`}>
                          {meta.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-bold text-slate-900">{inv.partyName || 'Cash Sale'}</span>
                            {inv.status === 'CANCELLED' ? <span className="badge badge-neutral">Cancel</span> : null}
                          </div>
                          <div className="truncate text-[11px] text-slate-500">
                            {inv.number} • {meta.label}
                            {t.totalQty ? ` • ${num(t.totalQty, 0)} qty` : ''}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="num text-[13px] font-extrabold text-slate-900">{money(t.grandTotal)}</div>
                          {inv.status !== 'CANCELLED' ? (
                            <span className={`badge ${st.cls} mt-0.5`}>{st.label}</span>
                          ) : null}
                        </div>
                      </button>
                      {t.due > 0.5 && inv.status !== 'CANCELLED' ? (
                        <div className="flex gap-1.5 px-3 pb-2">
                          <button
                            className="btn btn-money btn-sm flex-1"
                            onClick={async () => {
                              await recordPayment(inv.id!, { amount: t.due, mode: 'CASH', date: todayISO() })
                              toast('Pura payment receive ho gaya', 'success')
                            }}
                          >
                            💰 Pura {money(t.due)} mila
                          </button>
                          <a
                            className="btn btn-outline btn-sm flex-1"
                            href={waLink(inv.partyPhone, invoiceText(inv, business, t) + '\n\n(Baki payment reminder 🙏)')}
                            target="_blank"
                            rel="noreferrer"
                          >
                            💬 Payment reminder
                          </a>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
