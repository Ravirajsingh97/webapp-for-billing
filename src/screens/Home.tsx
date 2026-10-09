import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { computeTotals, payStatus } from '../lib/calc'
import { fmtDate, lastNDays, money, monthStart, monthEnd, num, round2, todayISO } from '../lib/format'
import type { Business, DocType, Invoice } from '../lib/types'
import { docMeta } from '../lib/types'
import { EmptyState, StatBox } from '../components/ui'

export function HomeScreen({
  business,
  onNewBill,
  onOpenInvoice,
  onGoItems,
  onGoReports,
  onGoParties,
  onGoPayments,
  onGoExpenses,
  lowStockOnly,
}: {
  business: Business
  onNewBill: (docType: DocType) => void
  onOpenInvoice: (id: number) => void
  onGoItems: () => void
  onGoReports: () => void
  onGoParties: () => void
  onGoPayments: () => void
  onGoExpenses: () => void
  lowStockOnly?: boolean
}) {
  const invoices = useLiveQuery(() => db.invoices.orderBy('createdAt').reverse().toArray(), [], [] as Invoice[])
  const items = useLiveQuery(() => db.items.toArray(), [])
  const expenses = useLiveQuery(() => db.expenses.toArray(), [])

  const today = todayISO()
  const month = { from: monthStart(), to: monthEnd() }
  const week = lastNDays(7)

  const stats = useMemo(() => {
    let todaySale = 0
    let monthSale = 0
    let weekSale = 0
    let receivable = 0
    let payable = 0
    let purchaseMonth = 0
    let expenseMonth = 0
    let cashToday = 0
    let upiToday = 0
    let billsToday = 0
    invoices.forEach((inv) => {
      if (inv.status === 'CANCELLED') return
      const meta = docMeta(inv.docType)
      const t = computeTotals(inv, business.stateCode)
      if (meta.isSale) {
        if (inv.date === today) {
          todaySale += t.grandTotal
          billsToday += 1
        }
        if (inv.date >= month.from && inv.date <= month.to) monthSale += t.grandTotal
        if (inv.date >= week.from && inv.date <= week.to) weekSale += t.grandTotal
        receivable += t.due
      } else if (meta.isPurchase) {
        if (inv.date >= month.from && inv.date <= month.to) purchaseMonth += t.grandTotal
        payable += t.due
      } else if (meta.negative) {
        if (inv.date >= month.from && inv.date <= month.to) monthSale -= t.grandTotal
        receivable -= t.due
      }
      if (inv.date === today) {
        inv.payments.forEach((p) => {
          if (p.mode === 'CASH') cashToday += p.amount
          if (p.mode === 'UPI') upiToday += p.amount
        })
      }
    })
    ;(expenses ?? []).forEach((e) => {
      if (e.date >= month.from && e.date <= month.to) expenseMonth += e.amount
    })
    const lowStock = (items ?? []).filter((i) => i.stockQty <= i.lowStockAlert)
    const out = lowStock.filter((i) => i.stockQty <= 0)
    const stockValue = (items ?? []).reduce((s, i) => s + i.purchasePrice * i.stockQty, 0)
    return {
      todaySale: round2(todaySale),
      monthSale: round2(monthSale),
      weekSale: round2(weekSale),
      receivable: round2(receivable),
      payable: round2(payable),
      purchaseMonth: round2(purchaseMonth),
      expenseMonth: round2(expenseMonth),
      cashToday: round2(cashToday),
      upiToday: round2(upiToday),
      billsToday,
      lowStock,
      outOfStock: out.length,
      stockValue: round2(stockValue),
    }
  }, [invoices, items, expenses, business.stateCode, today, month.from, month.to, week.from, week.to])

  const recent = (invoices ?? []).slice(0, 6)
  const dueInvoices = (invoices ?? [])
    .filter((i) => i.status !== 'CANCELLED' && docMeta(i.docType).isSale && computeTotals(i, business.stateCode).due > 0.5)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4)

  const quick: { key: DocType; label: string; icon: string }[] = [
    { key: 'TAX_INVOICE', label: 'Tax Invoice', icon: '🧾' },
    { key: 'ESTIMATE', label: 'Estimate', icon: '📝' },
    { key: 'PROFORMA', label: 'Proforma', icon: '📄' },
    { key: 'DELIVERY_CHALLAN', label: 'Challan', icon: '🚚' },
    { key: 'BILL_OF_SUPPLY', label: 'Bill of Supply', icon: '🧮' },
    { key: 'CREDIT_NOTE', label: 'Credit Note', icon: '↩️' },
  ]

  return (
    <div className="screen-content flex-1 px-3 pb-28 pt-3">
      <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-4 text-white shadow-lg">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-200">Aaj ki sale</div>
        <div className="num mt-0.5 text-3xl font-extrabold">{money(stats.todaySale)}</div>
        <div className="mt-1 text-[11px] text-brand-100">
          {stats.billsToday} bill aaj • Cash {money(stats.cashToday)} • UPI {money(stats.upiToday)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="rounded-xl bg-white py-2.5 text-sm font-extrabold text-brand-800 active:scale-[0.98]" onClick={() => onNewBill('TAX_INVOICE')}>
            ＋ Naya Bill
          </button>
          <button className="rounded-xl bg-amber-400 py-2.5 text-sm font-extrabold text-brand-900 active:scale-[0.98]" onClick={() => onNewBill('ESTIMATE')}>
            📝 Estimate
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatBox label="Is mahine ki sale" value={money(stats.monthSale)} tone="money" sub={`7 din: ${money(stats.weekSale)}`} onClick={onGoReports} />
        <StatBox label="Udhaar (lena hai)" value={money(stats.receivable)} tone="due" icon="⏳" onClick={onGoParties} />
        <StatBox
          label="Supplier ko dena hai"
          value={money(stats.payable)}
          icon="📥"
          sub={`Purchase (mahina): ${money(stats.purchaseMonth, 0)}`}
          onClick={onGoPayments}
        />
        <StatBox
          label="Mahine ka kharcha"
          value={money(stats.expenseMonth)}
          icon="🧾"
          sub={stats.expenseMonth > 0 ? 'net profit ise ghatata hai' : 'abhi kuch nahi likha'}
          onClick={onGoExpenses}
        />
        <StatBox label="Stock value (cost)" value={money(stats.stockValue)} sub={`${num((items ?? []).length, 0)} items`} onClick={onGoItems} />
        <StatBox
          label="Low stock"
          value={num(stats.lowStock.length, 0)}
          sub={stats.outOfStock ? `${stats.outOfStock} khatam` : 'sab theek'}
          tone={stats.lowStock.length ? 'due' : 'default'}
          icon="⚠️"
          onClick={onGoItems}
        />
      </div>

      <div className="section-title mt-4">
        <span>Khata ka kaam (ek tap)</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <button
          className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200 bg-white px-1 py-2.5 shadow-sm active:scale-[0.97]"
          onClick={() => onNewBill('PURCHASE')}
        >
          <span className="text-lg">📥</span>
          <span className="text-[10px] font-bold text-slate-700">Purchase</span>
        </button>
        <button
          className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200 bg-white px-1 py-2.5 shadow-sm active:scale-[0.97]"
          onClick={onGoParties}
        >
          <span className="text-lg">👥</span>
          <span className="text-[10px] font-bold text-slate-700">Khata</span>
        </button>
        <button
          className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200 bg-white px-1 py-2.5 shadow-sm active:scale-[0.97]"
          onClick={onGoPayments}
        >
          <span className="text-lg">💸</span>
          <span className="text-[10px] font-bold text-slate-700">Payment</span>
        </button>
        <button
          className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200 bg-white px-1 py-2.5 shadow-sm active:scale-[0.97]"
          onClick={onGoExpenses}
        >
          <span className="text-lg">🧾</span>
          <span className="text-[10px] font-bold text-slate-700">Kharcha</span>
        </button>
      </div>

      <div className="section-title mt-4">
        <span>Naya bill / document</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {quick.map((d) => (
          <button
            key={d.key}
            className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200 bg-white px-2 py-3 shadow-sm active:scale-[0.97]"
            onClick={() => onNewBill(d.key)}
          >
            <span className="text-xl">{d.icon}</span>
            <span className="text-[11px] font-bold text-slate-700">{d.label}</span>
            <span className="text-[9px] text-slate-400">{docMeta(d.key).hi}</span>
          </button>
        ))}
      </div>

      {stats.lowStock.length && (lowStockOnly ?? false) ? (
        <button className="card mt-3 flex w-full items-center gap-2 border-due-soft bg-due-soft/40 text-left" onClick={onGoItems}>
          <span className="text-lg">⚠️</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold text-due">{stats.lowStock.length} item low stock me</div>
            <div className="truncate text-[11px] text-slate-600">
              {stats.lowStock.slice(0, 3).map((i) => `${i.name} (${i.stockQty})`).join(', ')}
            </div>
          </div>
          <span className="text-due">›</span>
        </button>
      ) : null}

      {dueInvoices.length ? (
        <>
          <div className="section-title mt-4">
            <span>Payment baaki (reminder bhejein)</span>
          </div>
          <div className="card-flat overflow-hidden">
            {dueInvoices.map((inv) => {
              const t = computeTotals(inv, business.stateCode)
              return (
                <button key={inv.id} className="list-row w-full text-left" onClick={() => onOpenInvoice(inv.id!)}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-slate-900">{inv.partyName || 'Cash Sale'}</div>
                    <div className="truncate text-[11px] text-slate-500">
                      {inv.number} • {fmtDate(inv.date)}
                    </div>
                  </div>
                  <div className="num text-[13px] font-extrabold text-due">{money(t.due)}</div>
                </button>
              )
            })}
          </div>
        </>
      ) : null}

      <div className="section-title mt-4">
        <span>Recent bills</span>
        <button className="text-[11px] font-bold text-brand-700" onClick={onGoReports}>
          Report dekhein ›
        </button>
      </div>
      {recent.length === 0 ? (
        <EmptyState icon="🧾" title="Abhi koi bill nahi banaya" hint="“＋ Naya Bill” dabakar pehla bill banayein — 30 second me ban jayega." />
      ) : (
        <div className="card-flat overflow-hidden">
          {recent.map((inv) => {
            const t = computeTotals(inv, business.stateCode)
            const meta = docMeta(inv.docType)
            const s = payStatus(t)
            return (
              <button key={inv.id} className="list-row w-full text-left" onClick={() => onOpenInvoice(inv.id!)}>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-sm">{meta.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-slate-900">{inv.partyName || 'Cash Sale'}</div>
                  <div className="truncate text-[11px] text-slate-500">
                    {inv.number} • {fmtDate(inv.date)} {inv.status === 'CANCELLED' ? '• cancelled' : ''}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-[13px] font-extrabold text-slate-900">{money(t.grandTotal)}</div>
                  <div className={`text-[10px] font-bold ${s === 'PAID' ? 'text-money' : s === 'PARTIAL' ? 'text-warn' : 'text-due'}`}>
                    {s === 'PAID' ? 'Paid' : s === 'PARTIAL' ? 'Partial' : 'Baki'}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-brand-200 bg-brand-50 p-3 text-[11px] leading-relaxed text-brand-900">
        <b>Tip:</b> Billing screen me item ka barcode scan karein ya naam likhkar tap karein — qty, discount aur GST
        pehle se bhar jayega. Bill ke baad “WhatsApp par image” se party ko turant bill bhejein.
      </div>
    </div>
  )
}
