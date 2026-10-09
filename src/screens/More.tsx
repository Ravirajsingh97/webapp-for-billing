import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { computeTotals } from '../lib/calc'
import { lastNDays, money, monthStart, monthEnd, round2 } from '../lib/format'
import type { Business, DocType, Invoice } from '../lib/types'
import { DOC_TYPES, docMeta } from '../lib/types'
import { toast } from '../components/ui'

export type MoreTarget = 'pos' | 'ocr' | 'billing' | 'parties' | 'payments' | 'expenses' | 'reports' | 'settings'

export function MoreScreen({
  business,
  onNewBill,
  onOpen,
  onOpenInvoice,
  onInstall,
  hasInstall,
}: {
  business: Business
  onNewBill: (docType: DocType) => void
  onOpen: (target: MoreTarget) => void
  onOpenInvoice: (id: number) => void
  onInstall?: () => void
  hasInstall?: boolean
}) {
  const invoices = useLiveQuery(() => db.invoices.orderBy('createdAt').reverse().toArray(), [], [] as Invoice[])
  const items = useLiveQuery(() => db.items.toArray(), [])

  const week = lastNDays(7)
  const month = { from: monthStart(), to: monthEnd() }

  const stats = (() => {
    let receivable = 0
    let payable = 0
    let monthSale = 0
    let thisWeek = 0
    ;(invoices ?? []).forEach((inv) => {
      if (inv.status !== 'FINAL') return
      const meta = docMeta(inv.docType)
      const t = computeTotals(inv, business.stateCode)
      if (meta.isSale) {
        receivable += t.due
        if (inv.date >= month.from && inv.date <= month.to) monthSale += t.grandTotal
        if (inv.date >= week.from && inv.date <= week.to) thisWeek += t.grandTotal
      } else if (meta.isPurchase) {
        payable += t.due
      } else if (meta.negative) {
        receivable -= t.due
      }
    })
    const low = (items ?? []).filter((i) => i.stockQty <= i.lowStockAlert)
    return {
      receivable: round2(receivable),
      payable: round2(payable),
      monthSale: round2(monthSale),
      weekSale: round2(thisWeek),
      low: low.length,
    }
  })()

  const pendingBills = (invoices ?? [])
    .filter((i) => i.status === 'FINAL' && computeTotals(i, business.stateCode).due > 0.5)
    .slice(0, 5)

  const tiles: { key: MoreTarget; icon: string; label: string; hi: string; badge?: string }[] = [
    { key: 'pos', icon: '🛒', label: 'POS / Quick sale', hi: 'Fast checkout & receipt' },
    { key: 'ocr', icon: '📷', label: 'OCR / Bill scanner', hi: 'Photo → purchase draft' },
    { key: 'parties', icon: '👥', label: 'Khata / Parties', hi: 'Customer & supplier udhaar', badge: money(stats.receivable, 0) },
    { key: 'payments', icon: '💸', label: 'Payments In/Out', hi: 'Paisa aaya / diya' },
    { key: 'expenses', icon: '🧾', label: 'Expenses', hi: 'Kiraya, salary, bijli' },
    { key: 'reports', icon: '📊', label: 'Reports', hi: 'Sale, profit, GST, aging' },
    { key: 'settings', icon: '⚙️', label: 'Settings', hi: 'Dukaan details, backup' },
  ]

  return (
    <div className="screen-content flex-1 px-3 pb-28 pt-3">
      <div className="stats-grid grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="card text-[12px]">
          <div className="text-[10px] font-bold uppercase text-slate-500">Lena hai (receivable)</div>
          <div className="num text-lg font-extrabold text-due">{money(stats.receivable, 0)}</div>
        </div>
        <div className="card text-[12px]">
          <div className="text-[10px] font-bold uppercase text-slate-500">Dena hai (payable)</div>
          <div className="num text-lg font-extrabold text-warn">{money(stats.payable, 0)}</div>
        </div>
        <div className="card text-[12px]">
          <div className="text-[10px] font-bold uppercase text-slate-500">Is mahine sale</div>
          <div className="num text-lg font-extrabold text-money">{money(stats.monthSale, 0)}</div>
          <div className="text-[10px] text-slate-500">7 din: {money(stats.weekSale, 0)}</div>
        </div>
        <div className="card text-[12px]">
          <div className="text-[10px] font-bold uppercase text-slate-500">Low stock items</div>
          <div className={`num text-lg font-extrabold ${stats.low ? 'text-due' : 'text-slate-800'}`}>{stats.low}</div>
          <div className="text-[10px] text-slate-500">{(items ?? []).length} total items</div>
        </div>
      </div>

      {hasInstall && onInstall ? (
        <button className="btn btn-primary btn-block mt-3" onClick={onInstall}>
          ⬇ App ko home screen par install karein
        </button>
      ) : null}

      <div className="section-title mt-4">
        <span>Naya document banayein</span>
      </div>
      <div className="document-grid grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
        {DOC_TYPES.map((d) => (
          <button
            key={d.key}
            className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200 bg-white px-2 py-3 shadow-sm active:scale-[0.97]"
            onClick={() => {
              onNewBill(d.key)
              toast(`${d.label} khul raha hai…`)
            }}
          >
            <span className="text-xl">{d.icon}</span>
            <span className="text-[11px] font-bold text-slate-700">{d.label.split(' ')[0]}</span>
            <span className="text-[9px] text-slate-400">{d.hi.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      <div className="section-title mt-4">
        <span>Khata &amp; hisab</span>
      </div>
      <div className="card-flat overflow-hidden">
        {tiles.map((t) => (
          <button key={t.key} className="list-row w-full text-left" onClick={() => onOpen(t.key)}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-base">{t.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-slate-900">{t.label}</div>
              <div className="truncate text-[11px] text-slate-500">{t.hi}</div>
            </div>
            {t.badge && Number(t.badge.replace(/[^\d]/g, '')) > 0 ? (
              <span className="num shrink-0 text-[12px] font-bold text-due">{t.badge}</span>
            ) : null}
            <span className="text-slate-400">›</span>
          </button>
        ))}
      </div>

      {pendingBills.length ? (
        <>
          <div className="section-title mt-4">
            <span>Payment baaki wale bill</span>
          </div>
          <div className="card-flat overflow-hidden">
            {pendingBills.map((inv) => {
              const t = computeTotals(inv, business.stateCode)
              return (
                <button key={inv.id} className="list-row w-full text-left" onClick={() => onOpenInvoice(inv.id!)}>
                  <span className="text-base">{docMeta(inv.docType).icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-slate-900">{inv.partyName || 'Cash Sale'}</div>
                    <div className="truncate text-[11px] text-slate-500">
                      {inv.number} • {docMeta(inv.docType).label}
                    </div>
                  </div>
                  <span className="num text-[13px] font-extrabold text-due">{money(t.due, 0)}</span>
                </button>
              )
            })}
          </div>
        </>
      ) : null}

      <div className="mt-4 rounded-2xl border border-brand-200 bg-brand-50 p-3 text-[11px] leading-relaxed text-brand-900">
        <b>Roz ka kaam:</b> subah <b>Payments</b> me aaj ka cash likhein, din bhar bill banayein, raat ko{' '}
        <b>Reports</b> → day book dekhein. Mahine ke aad me <b>Settings → Backup</b> se file nikal lein.
      </div>
    </div>
  )
}
