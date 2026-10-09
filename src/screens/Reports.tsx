import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { computeTotals, itemMargin } from '../lib/calc'
import { agingReport, expensesBetween, paymentRegister, type AgingReport } from '../lib/repo'
import { download, financialYear, fmtDate, lastNDays, money, monthEnd, monthStart, num, round2, todayISO } from '../lib/format'
import { csvEscape, invoicesToCsv } from '../lib/csvutil'
import type { Business, Expense, Invoice, Item } from '../lib/types'
import { EXPENSE_CATEGORIES } from '../lib/types'
import { DOC_TYPES, PAYMENT_MODES, docMeta } from '../lib/types'
import { ChipRow, EmptyState, Segmented, StatBox, toast } from '../components/ui'
import { fmtDate as fmtDay } from '../lib/format'

type RangeKey = 'today' | 'week' | 'month' | 'fy' | 'all' | 'custom'

export function ReportsScreen({ business }: { business: Business }) {
  const [range, setRange] = useState<RangeKey>('month')
  const [custom, setCustom] = useState({ from: monthStart(), to: todayISO() })

  const invoices = useLiveQuery(() => db.invoices.orderBy('date').toArray(), [], [] as Invoice[])
  const items = useLiveQuery(() => db.items.toArray(), [], [] as Item[])

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

  const report = useMemo(() => {
    const inRange = invoices.filter((i) => i.date >= from && i.date <= to && i.status === 'FINAL')
    let sale = 0
    let taxable = 0
    let tax = 0
    let discount = 0
    let profit = 0
    let qty = 0
    let bills = 0
    let returned = 0
    const dayMap = new Map<string, number>()
    const itemMap = new Map<string, { name: string; qty: number; amount: number; profit: number }>()
    const partyMap = new Map<string, { name: string; amount: number; due: number; bills: number }>()
    const modeMap = new Map<string, number>()
    const docMap = new Map<string, { count: number; amount: number }>()
    const hsnMap = new Map<string, { hsn: string; taxable: number; tax: number; rate: number; qty: number }>()

    inRange.forEach((inv) => {
      const meta = docMeta(inv.docType)
      const t = computeTotals(inv, business.stateCode)
      const docRow = docMap.get(meta.label) ?? { count: 0, amount: 0 }
      docRow.count += 1
      docRow.amount = round2(docRow.amount + t.grandTotal)
      docMap.set(meta.label, docRow)

      inv.payments.forEach((p) => modeMap.set(p.mode, round2((modeMap.get(p.mode) ?? 0) + p.amount)))

      if (!meta.isSale && !meta.negative) return

      const sign = meta.negative ? -1 : 1
      sale += sign * t.grandTotal
      taxable += sign * t.taxableNet
      tax += sign * t.tax
      discount += sign * (t.lineDiscount + t.billDiscount)
      profit += sign * t.profit
      qty += sign * t.totalQty
      bills += 1
      if (meta.negative) returned += t.grandTotal

      const dayKey = inv.date
      dayMap.set(dayKey, round2((dayMap.get(dayKey) ?? 0) + sign * t.grandTotal))

      inv.items.forEach((l, i) => {
        const key = l.code || l.name
        const row = itemMap.get(key) ?? { name: l.name, qty: 0, amount: 0, profit: 0 }
        row.qty += sign * l.qty
        row.amount = round2(row.amount + sign * (t.lines[i]?.total ?? 0))
        row.profit = round2(row.profit + sign * ((t.lines[i]?.taxableAfterBillDiscount ?? 0) - l.costPrice * l.qty))
        itemMap.set(key, row)

        if (!meta.noTax) {
          const hsnKey = `${l.hsn || '-'}|${l.gstPercent}`
          const h = hsnMap.get(hsnKey) ?? { hsn: l.hsn || '-', taxable: 0, tax: 0, rate: l.gstPercent, qty: 0 }
          h.taxable = round2(h.taxable + sign * (t.lines[i]?.taxableAfterBillDiscount ?? 0))
          h.tax = round2(h.tax + sign * (t.lines[i]?.tax ?? 0))
          h.qty += sign * l.qty
          hsnMap.set(hsnKey, h)
        }
      })

      const pKey = inv.partyName || 'Cash Sale'
      const pRow = partyMap.get(pKey) ?? { name: pKey, amount: 0, due: 0, bills: 0 }
      pRow.amount = round2(pRow.amount + sign * t.grandTotal)
      pRow.due = round2(pRow.due + sign * t.due)
      pRow.bills += 1
      partyMap.set(pKey, pRow)
    })

    const days = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const maxDay = Math.max(1, ...days.map(([, v]) => v))
    const stockValue = items.reduce((s, i) => s + i.purchasePrice * i.stockQty, 0)
    const saleValue = items.reduce(
      (s, i) => s + i.mrp * (1 - i.discountPercent / 100) * (1 + i.gstPercent / 100) * i.stockQty,
      0,
    )

    return {
      sale: round2(sale),
      taxable: round2(taxable),
      tax: round2(tax),
      discount: round2(discount),
      profit: round2(profit),
      qty: round2(qty),
      bills,
      returned: round2(returned),
      avg: bills ? round2(sale / bills) : 0,
      days,
      maxDay,
      topItems: [...itemMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 12),
      topParties: [...partyMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 12),
      modes: PAYMENT_MODES.map((m) => ({ ...m, amount: round2(modeMap.get(m.key) ?? 0) })).filter((m) => m.amount > 0),
      docs: [...docMap.entries()],
      hsn: [...hsnMap.values()].sort((a, b) => b.taxable - a.taxable),
      stockValue: round2(stockValue),
      stockSaleValue: round2(saleValue),
      lowStock: items.filter((i) => i.stockQty <= i.lowStockAlert),
      marginItems: items
        .map((i) => ({ item: i, margin: itemMargin(i.mrp, i.discountPercent, i.purchasePrice) }))
        .sort((a, b) => b.margin.percent - a.margin.percent),
    }
  }, [invoices, items, from, to, business.stateCode])

  const rangeInvoices = invoices.filter((i) => i.date >= from && i.date <= to)

  const aging = useLiveQuery(
    () => agingReport(business.stateCode),
    [business.stateCode, invoices.length],
    { receivables: [], payables: [], totalReceivable: 0, totalPayable: 0, overdueReceivable: 0, overduePayable: 0 } as AgingReport,
  )
  const rangeExpenses = useLiveQuery(() => expensesBetween(from, to), [from, to], [] as Expense[])
  const [dayBookDate, setDayBookDate] = useState(todayISO())
  const dayBook = useLiveQuery(() => paymentRegister(dayBookDate, dayBookDate), [dayBookDate], [])
  const [agingTab, setAgingTab] = useState<'RECEIVABLE' | 'PAYABLE'>('RECEIVABLE')

  // purchase + expense + monthly trend over the selected range
  const extra = useMemo(() => {
    let purchase = 0
    let purchaseBills = 0
    let purchaseTax = 0
    const monthMap = new Map<string, { sale: number; purchase: number; expense: number }>()
    const bucket = (key: string) => {
      const row = monthMap.get(key) ?? { sale: 0, purchase: 0, expense: 0 }
      monthMap.set(key, row)
      return row
    }
    rangeInvoices.forEach((inv) => {
      if (inv.status !== 'FINAL') return
      const t = computeTotals(inv, business.stateCode)
      const mk = inv.date.slice(0, 7)
      const meta = docMeta(inv.docType)
      if (meta.isPurchase) {
        purchase += t.grandTotal
        purchaseTax += t.tax
        purchaseBills += 1
        bucket(mk).purchase += t.grandTotal
      } else if (meta.isSale) {
        bucket(mk).sale += t.grandTotal
      } else if (meta.negative) {
        bucket(mk).sale -= t.grandTotal
      }
    })
    const expenseByCat = new Map<string, number>()
    let expense = 0
    rangeExpenses.forEach((e) => {
      expense += e.amount
      expenseByCat.set(e.category, round2((expenseByCat.get(e.category) ?? 0) + e.amount))
      bucket(e.date.slice(0, 7)).expense += e.amount
    })
    const months = [...monthMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({
        month,
        sale: round2(v.sale),
        purchase: round2(v.purchase),
        expense: round2(v.expense),
      }))
    return {
      purchase: round2(purchase),
      purchaseTax: round2(purchaseTax),
      purchaseBills,
      expense: round2(expense),
      expenseByCat: [...expenseByCat.entries()].sort((a, b) => b[1] - a[1]),
      netProfit: round2(report.profit - expense),
      months,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeInvoices, rangeExpenses, business.stateCode, report.profit])

  const maxMonth = Math.max(1, ...extra.months.map((m) => Math.max(m.sale, m.purchase)))

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
        <div className="responsive-form-grid mt-1 grid grid-cols-2 gap-2">
          <input type="date" className="input" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <input type="date" className="input" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </div>
      ) : null}

      <div className="mt-2 rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-4 text-white shadow-lg">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-200">
          Net sale ({fmtDate(from)} – {fmtDate(to)})
        </div>
        <div className="num mt-0.5 text-3xl font-extrabold">{money(report.sale)}</div>
        <div className="mt-1 flex gap-3 text-[11px] text-brand-100">
          <span>{num(report.bills, 0)} bills</span>
          <span>Avg {money(report.avg, 0)}</span>
          <span>{num(report.qty, 0)} qty</span>
          {report.returned ? <span>Return {money(report.returned, 0)}</span> : null}
        </div>
      </div>

      <div className="stats-grid mt-2 grid grid-cols-2 gap-2">
        <StatBox label="Taxable value" value={money(report.taxable)} />
        <StatBox label="GST collect hua" value={money(report.tax)} tone="brand" />
        <StatBox label="Discount diya" value={money(report.discount)} tone="due" />
        <StatBox label="Anumanit profit" value={money(report.profit)} tone="money" sub="taxable − purchase cost" />
      </div>

      {/* Day wise */}
      <div className="section-title mt-4">
        <span>Din-wise sale</span>
      </div>
      {report.days.length === 0 ? (
        <EmptyState icon="📊" title="Is period me koi sale nahi" hint="Range badalkar dekhein ya naya bill banayein." />
      ) : (
        <div className="card">
          <div className="flex h-36 items-end gap-1">
            {report.days.slice(-30).map(([d, v]) => (
              <div key={d} className="group flex flex-1 flex-col items-center justify-end gap-1">
                <div className="num text-[8px] font-bold text-slate-500">{v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}</div>
                <div
                  className="w-full rounded-t bg-brand-500"
                  style={{ height: `${Math.max(4, (v / report.maxDay) * 100)}%` }}
                  title={`${fmtDate(d)} • ${money(v)}`}
                />
                <div className="text-[8px] text-slate-400">{d.slice(8)}</div>
              </div>
            ))}
          </div>
          <div className="mt-1 text-center text-[10px] text-slate-400">Aakhri {Math.min(30, report.days.length)} din</div>
        </div>
      )}

      {/* Doc type + payments */}
      <div className="section-title mt-4">
        <span>Document type</span>
      </div>
      <div className="card-flat overflow-hidden">
        {DOC_TYPES.map((d) => {
          const row = report.docs.find(([label]) => label === d.label)
          return (
            <div key={d.key} className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-[13px] last:border-0">
              <span className="font-semibold text-slate-700">
                {d.icon} {d.label}
              </span>
              <span className="num text-slate-600">
                {num(row?.[1].count ?? 0, 0)} • {money(row?.[1].amount ?? 0, 0)}
              </span>
            </div>
          )
        })}
      </div>

      <div className="section-title mt-4">
        <span>Payment mode</span>
      </div>
      <div className="card-flat overflow-hidden">
        {report.modes.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-slate-500">Is period me koi payment record nahi hua.</div>
        ) : (
          report.modes.map((m) => (
            <div key={m.key} className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-[13px] last:border-0">
              <span className="font-semibold text-slate-700">
                {m.label} <span className="text-slate-400">({m.hi})</span>
              </span>
              <span className="num font-bold">{money(m.amount)}</span>
            </div>
          ))
        )}
      </div>

      {/* Top items */}
      <div className="section-title mt-4">
        <span>Top items (sale ke hisab se)</span>
      </div>
      <div className="card-flat overflow-hidden">
        {report.topItems.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-slate-500">Data nahi hai.</div>
        ) : (
          report.topItems.map((it, idx) => (
            <div key={idx} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0">
              <span className="w-5 text-[11px] font-bold text-slate-400">{idx + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-800">{it.name}</span>
              <span className="num text-[11px] text-slate-500">{num(it.qty, 0)} qty</span>
              <span className="num w-20 text-right text-[13px] font-bold">{money(it.amount, 0)}</span>
            </div>
          ))
        )}
      </div>

      {/* Top parties */}
      <div className="section-title mt-4">
        <span>Top parties</span>
      </div>
      <div className="card-flat overflow-hidden">
        {report.topParties.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-slate-500">Data nahi hai.</div>
        ) : (
          report.topParties.map((p, idx) => (
            <div key={idx} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-800">{p.name}</span>
              <span className="num text-[11px] text-slate-500">{num(p.bills, 0)} bills</span>
              {p.due > 0.5 ? <span className="num w-20 text-right text-[12px] font-bold text-due">Baki {money(p.due, 0)}</span> : null}
              <span className="num w-20 text-right text-[13px] font-bold">{money(p.amount, 0)}</span>
            </div>
          ))
        )}
      </div>

      {/* GST / HSN */}
      <div className="section-title mt-4">
        <span>GST / HSN summary (GSTR-1 jaisa)</span>
      </div>
      <div className="card-flat table-scroll overflow-auto">
        {report.hsn.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-slate-500">Is period me koi taxable sale nahi.</div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left">HSN</th>
                <th className="px-2 py-1.5 text-right">Qty</th>
                <th className="px-2 py-1.5 text-right">Taxable</th>
                <th className="px-2 py-1.5 text-right">GST%</th>
                <th className="px-2 py-1.5 text-right">CGST</th>
                <th className="px-2 py-1.5 text-right">SGST</th>
              </tr>
            </thead>
            <tbody>
              {report.hsn.map((h, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 font-semibold">{h.hsn}</td>
                  <td className="num px-2 py-1.5 text-right">{num(h.qty, 0)}</td>
                  <td className="num px-2 py-1.5 text-right">{num(h.taxable)}</td>
                  <td className="num px-2 py-1.5 text-right">{num(h.rate, 0)}%</td>
                  <td className="num px-2 py-1.5 text-right">{num(round2(h.tax / 2))}</td>
                  <td className="num px-2 py-1.5 text-right">{num(round2(h.tax - h.tax / 2))}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 font-bold">
                <td className="px-2 py-1.5" colSpan={2}>
                  Total
                </td>
                <td className="num px-2 py-1.5 text-right">{num(report.taxable)}</td>
                <td />
                <td className="num px-2 py-1.5 text-right">{num(round2(report.tax / 2))}</td>
                <td className="num px-2 py-1.5 text-right">{num(round2(report.tax / 2))}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Stock */}
      <div className="section-title mt-4">
        <span>Stock summary</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatBox label="Stock value (cost)" value={money(report.stockValue)} />
        <StatBox label="Stock sale value" value={money(report.stockSaleValue)} tone="money" />
      </div>
      {report.lowStock.length ? (
        <div className="card mt-2">
          <div className="text-[13px] font-bold text-due">⚠️ {report.lowStock.length} item low/out of stock</div>
          <div className="mt-1 text-[11px] text-slate-600">
            {report.lowStock.slice(0, 8).map((i) => `${i.name} (${i.stockQty})`).join(', ')}
            {report.lowStock.length > 8 ? ' …' : ''}
          </div>
        </div>
      ) : null}

      {/* Purchase / Expense / Net profit */}
      <div className="section-title mt-4">
        <span>Purchase, kharcha aur net profit</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatBox label="Purchase (supplier)" value={money(extra.purchase)} sub={`${num(extra.purchaseBills, 0)} bills • GST ${money(extra.purchaseTax, 0)}`} />
        <StatBox label="Dukan ka kharcha" value={money(extra.expense)} tone="due" sub={`${num(rangeExpenses.length, 0)} entries`} />
        <StatBox label="Sale profit (gross)" value={money(report.profit)} tone="money" />
        <StatBox
          label="Net profit (kharcha ke baad)"
          value={money(extra.netProfit)}
          tone={extra.netProfit >= 0 ? 'money' : 'due'}
          sub="sale profit − kharcha"
        />
      </div>

      {extra.expenseByCat.length ? (
        <div className="card mt-2">
          <div className="text-[12px] font-bold text-slate-700">Kharcha — category wise</div>
          {extra.expenseByCat.slice(0, 6).map(([cat, amount]) => (
            <div key={cat} className="flex items-center justify-between py-1 text-[12px]">
              <span className="text-slate-600">
                {EXPENSE_CATEGORIES.find((c) => c.key === cat)?.icon ?? '🧾'} {cat}
              </span>
              <span className="num font-bold text-slate-700">{money(amount, 0)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Monthly trend */}
      <div className="section-title mt-4">
        <span>Mahine-wise sale vs purchase</span>
      </div>
      {extra.months.length === 0 ? (
        <div className="card text-[12px] text-slate-500">Is period me data nahi hai.</div>
      ) : (
        <div className="card">
          <div className="flex h-32 items-end gap-2">
            {extra.months.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center justify-end gap-1">
                <div className="flex h-24 w-full items-end justify-center gap-0.5">
                  <div
                    className="w-1/2 rounded-t bg-money"
                    style={{ height: `${Math.max(3, (m.sale / maxMonth) * 100)}%` }}
                    title={`Sale ${money(m.sale)}`}
                  />
                  <div
                    className="w-1/2 rounded-t bg-brand-500"
                    style={{ height: `${Math.max(3, (m.purchase / maxMonth) * 100)}%` }}
                    title={`Purchase ${money(m.purchase)}`}
                  />
                </div>
                <div className="text-[9px] text-slate-500">{m.month.slice(5)}/{m.month.slice(2, 4)}</div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-center gap-3 text-[10px] text-slate-500">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-money" />Sale</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-brand-500" />Purchase</span>
          </div>
        </div>
      )}

      {/* Party-wise aging */}
      <div className="section-title mt-4">
        <span>Udhaar aging (30/60/90 din)</span>
      </div>
      <Segmented
        value={agingTab}
        onChange={(v) => setAgingTab(v)}
        options={[
          { value: 'RECEIVABLE', label: `⬇ Lena hai ${money(aging.totalReceivable, 0)}` },
          { value: 'PAYABLE', label: `⬆ Dena hai ${money(aging.totalPayable, 0)}` },
        ]}
      />
      <div className="stats-grid mt-2 grid grid-cols-2 gap-2">
        <StatBox
          label="0–30 din"
          value={money(
            (agingTab === 'RECEIVABLE' ? aging.receivables : aging.payables).reduce((s, r) => s + r.d0_30, 0),
          )}
        />
        <StatBox
          label="30 din se purana"
          value={money(
            agingTab === 'RECEIVABLE' ? aging.overdueReceivable : aging.overduePayable,
          )}
          tone="due"
          icon="⚠️"
        />
      </div>
      <div className="card-flat table-scroll mt-2 overflow-auto">
        {(() => {
          const rows = agingTab === 'RECEIVABLE' ? aging.receivables : aging.payables
          if (!rows.length) {
            return <div className="px-3 py-3 text-[12px] text-slate-500">Sab hisab clear hai 👍</div>
          }
          return (
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 text-[9px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 text-left">Party</th>
                  <th className="px-2 py-1.5 text-right">0–30</th>
                  <th className="px-2 py-1.5 text-right">31–60</th>
                  <th className="px-2 py-1.5 text-right">61–90</th>
                  <th className="px-2 py-1.5 text-right">90+</th>
                  <th className="px-2 py-1.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 25).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="max-w-[130px] truncate px-2 py-1.5 font-semibold">
                      {r.partyName}
                      {r.oldestDays > 60 ? <span className="ml-1 text-[9px] font-bold text-due">{r.oldestDays}d</span> : null}
                    </td>
                    <td className="num px-2 py-1.5 text-right">{num(r.d0_30, 0)}</td>
                    <td className="num px-2 py-1.5 text-right">{num(r.d31_60, 0)}</td>
                    <td className="num px-2 py-1.5 text-right">{num(r.d61_90, 0)}</td>
                    <td className="num px-2 py-1.5 text-right text-due">{num(r.d90plus, 0)}</td>
                    <td className="num px-2 py-1.5 text-right font-bold">{num(r.total, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        })()}
      </div>
      <button
        className="btn btn-outline btn-block mt-2"
        onClick={() => {
          const rows = agingTab === 'RECEIVABLE' ? aging.receivables : aging.payables
          if (!rows.length) return toast('Export ke liye data nahi', 'error')
          const head = ['Party', 'Phone', '0-30', '31-60', '61-90', '90+', 'Total', 'Oldest days']
          const body = rows.map((r) => [
            r.partyName,
            r.phone ?? '',
            r.d0_30.toFixed(2),
            r.d31_60.toFixed(2),
            r.d61_90.toFixed(2),
            r.d90plus.toFixed(2),
            r.total.toFixed(2),
            String(r.oldestDays),
          ])
          download(
            `${agingTab === 'RECEIVABLE' ? 'receivable' : 'payable'}-aging-${todayISO()}.csv`,
            [head, ...body].map((r) => r.map(csvEscape).join(',')).join('\n'),
          )
          toast('Aging report download ho gayi', 'success')
        }}
      >
        ⬇ Aging report CSV
      </button>

      {/* Day book */}
      <div className="section-title mt-4">
        <span>Day book (ek din ka hisab)</span>
      </div>
      <input
        type="date"
        className="input"
        value={dayBookDate}
        onChange={(e) => setDayBookDate(e.target.value || todayISO())}
      />
      {(() => {
        const dayInvoices = invoices.filter((i) => i.date === dayBookDate)
        let daySale = 0
        let dayPurchase = 0
        dayInvoices.forEach((inv) => {
          if (inv.status !== 'FINAL') return
          const t = computeTotals(inv, business.stateCode)
          const meta = docMeta(inv.docType)
          if (meta.isSale) daySale += t.grandTotal
          else if (meta.isPurchase) dayPurchase += t.grandTotal
          else if (meta.negative) daySale -= t.grandTotal
        })
        const dayExpense = rangeExpenses.filter((e) => e.date === dayBookDate).reduce((s, e) => s + e.amount, 0)
        const cashIn = (dayBook ?? []).filter((r) => r.direction === 'IN').reduce((s, r) => s + r.amount, 0)
        const cashOut = (dayBook ?? []).filter((r) => r.direction === 'OUT').reduce((s, r) => s + r.amount, 0)
        return (
          <>
            <div className="stats-grid mt-2 grid grid-cols-2 gap-2">
              <StatBox label="Us din ki sale" value={money(round2(daySale))} tone="money" />
              <StatBox label="Us din ki purchase" value={money(round2(dayPurchase))} />
              <StatBox label="Paisa aaya" value={money(round2(cashIn))} tone="money" />
              <StatBox label="Paisa diya (payment + kharcha)" value={money(round2(cashOut + dayExpense))} tone="due" />
            </div>
            <div className="card-flat mt-2 overflow-hidden">
              {dayInvoices.length === 0 && (dayBook ?? []).length === 0 && dayExpense === 0 ? (
                <div className="px-3 py-3 text-[12px] text-slate-500">Us din koi entry nahi hai.</div>
              ) : null}
              {dayInvoices.map((inv) => {
                const t = computeTotals(inv, business.stateCode)
                const meta = docMeta(inv.docType)
                return (
                  <div key={inv.id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0">
                    <span className="text-base">{meta.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold">{inv.partyName || 'Cash Sale'}</div>
                      <div className="truncate text-[10px] text-slate-500">
                        {inv.number} • {meta.label}
                      </div>
                    </div>
                    <span className={`num text-[12px] font-bold ${meta.isPurchase ? 'text-brand-700' : meta.negative ? 'text-due' : ''}`}>
                      {money(t.grandTotal, 0)}
                    </span>
                  </div>
                )
              })}
              {(dayBook ?? []).map((r) => (
                <div key={r.key} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0">
                  <span className={`text-base ${r.direction === 'IN' ? 'text-money' : 'text-due'}`}>{r.direction === 'IN' ? '⬇' : '⬆'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold">{r.partyName}</div>
                    <div className="truncate text-[10px] text-slate-500">{r.mode} • {r.invoiceNumber ?? 'khata'}</div>
                  </div>
                  <span className={`num text-[12px] font-bold ${r.direction === 'IN' ? 'text-money' : 'text-due'}`}>
                    {money(r.amount, 0)}
                  </span>
                </div>
              ))}
              {rangeExpenses
                .filter((e) => e.date === dayBookDate)
                .map((e) => (
                  <div key={`exp-${e.id}`} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0">
                    <span className="text-base">🧾</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold">{e.category}</div>
                      <div className="truncate text-[10px] text-slate-500">kharcha • {e.mode}</div>
                    </div>
                    <span className="num text-[12px] font-bold text-due">{money(e.amount, 0)}</span>
                  </div>
                ))}
            </div>
            <button
              className="btn btn-outline btn-block mt-2"
              onClick={() => {
                const head = ['Type', 'Ref', 'Party', 'Mode', 'Amount']
                const body: string[][] = [
                  ...dayInvoices.map((inv) => [
                    docMeta(inv.docType).label,
                    inv.number,
                    inv.partyName || 'Cash Sale',
                    inv.status === 'CANCELLED' ? 'CANCELLED' : '',
                    computeTotals(inv, business.stateCode).grandTotal.toFixed(2),
                  ]),
                  ...(dayBook ?? []).map((r) => [
                    r.direction === 'IN' ? 'Payment In' : 'Payment Out',
                    r.invoiceNumber ?? 'khata',
                    r.partyName,
                    r.mode,
                    r.amount.toFixed(2),
                  ]),
                  ...rangeExpenses
                    .filter((e) => e.date === dayBookDate)
                    .map((e) => ['Expense', e.category, e.paidTo ?? '', e.mode, e.amount.toFixed(2)]),
                ]
                if (!body.length) return toast('Us din ka data nahi', 'error')
                download(
                  `daybook-${dayBookDate}.csv`,
                  [head, ...body].map((r) => r.map(csvEscape).join(',')).join('\n'),
                )
                toast('Day book CSV download ho gaya', 'success')
              }}
            >
              ⬇ Day book CSV ({fmtDay(dayBookDate)})
            </button>
          </>
        )
      })()}

      {/* Exports */}
      <div className="section-title mt-4">
        <span>Report export</span>
      </div>
      <div className="flex flex-col gap-2">
        <button
          className="btn btn-outline btn-block"
          onClick={() => {
            if (!rangeInvoices.length) return toast('Is period me koi bill nahi', 'error')
            download(`sales-register-${from}-to-${to}.csv`, invoicesToCsv(rangeInvoices, business))
            toast('Sales register CSV download ho gaya', 'success')
          }}
        >
          ⬇ Sales register (sab bills) CSV
        </button>
        <button
          className="btn btn-outline btn-block"
          onClick={() => {
            const rows = [
              ['HSN', 'Qty', 'Taxable', 'GST %', 'CGST', 'SGST'],
              ...report.hsn.map((h) => [h.hsn, String(h.qty), h.taxable.toFixed(2), String(h.rate), (h.tax / 2).toFixed(2), (h.tax / 2).toFixed(2)]),
            ]
            download(`gst-hsn-summary-${from}-to-${to}.csv`, rows.map((r) => r.map(csvEscape).join(',')).join('\n'))
            toast('GST summary download ho gayi', 'success')
          }}
        >
          ⬇ GST / HSN summary CSV
        </button>
        <button
          className="btn btn-outline btn-block"
          onClick={() => {
            const rows = [
              ['Item', 'Qty', 'Sale amount', 'Profit'],
              ...report.topItems.map((i) => [i.name, String(i.qty), i.amount.toFixed(2), i.profit.toFixed(2)]),
            ]
            download(`item-wise-sale-${from}-to-${to}.csv`, rows.map((r) => r.map(csvEscape).join(',')).join('\n'))
            toast('Item-wise report download ho gayi', 'success')
          }}
        >
          ⬇ Item-wise sale CSV
        </button>
        <button
          className="btn btn-outline btn-block"
          onClick={() => {
            const rows = [
              ['Party', 'Bills', 'Sale amount', 'Baki'],
              ...report.topParties.map((p) => [p.name, String(p.bills), p.amount.toFixed(2), p.due.toFixed(2)]),
            ]
            download(`party-wise-${from}-to-${to}.csv`, rows.map((r) => r.map(csvEscape).join(',')).join('\n'))
            toast('Party-wise report download ho gayi', 'success')
          }}
        >
          ⬇ Party-wise sale & baki CSV
        </button>
      </div>
      <div className="h-6" />
    </div>
  )
}
