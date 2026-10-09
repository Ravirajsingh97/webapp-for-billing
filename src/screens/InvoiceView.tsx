import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { QRCodeSVG } from 'qrcode.react'
import { db } from '../lib/db'
import { computeTotals, payStatus, statusMeta } from '../lib/calc'
import { amountInWords, cleanPhone, fmtDate, money, round2, todayISO, waLink } from '../lib/format'
import { cancelInvoice, convertInvoice, deleteInvoice, recordPayment, removePayment, restoreInvoice } from '../lib/repo'
import { fileBaseName, invoiceText, upiUri } from '../lib/doc'
import type { Business, DocType, Invoice, PaymentMode } from '../lib/types'
import { docMeta, PAYMENT_MODES } from '../lib/types'
import { A4_WIDTH, InvoicePaper, PaperScaler } from '../components/InvoicePaper'
import { PrintPortal } from '../components/PrintPortal'
import { ConfirmDialog, KeyValue, Segmented, Sheet, toast } from '../components/ui'
import { printPaper, shareNodeAsImage, shareText, copyText, type PrintMode } from '../lib/print'

export function InvoiceView({
  invoiceId,
  business,
  onBack,
  onEdit,
  onConverted,
}: {
  invoiceId: number
  business: Business
  onBack: () => void
  onEdit: (inv: Invoice) => void
  onConverted: (draft: Invoice) => void
}) {
  const invoice = useLiveQuery(() => db.invoices.get(invoiceId), [invoiceId])
  const [mode, setMode] = useState<PrintMode>('a4')
  const [printJob, setPrintJob] = useState<PrintMode | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [busy, setBusy] = useState(false)
  const shareRef = useRef<HTMLDivElement>(null)

  const t = useMemo(
    () => (invoice ? computeTotals(invoice, business.stateCode) : null),
    [invoice, business.stateCode],
  )

  // auto print / share right after saving from the billing screen
  useEffect(() => {
    if (!invoice) return
    let auto: string | null = null
    try {
      auto = sessionStorage.getItem('autoAfterView')
      if (auto) sessionStorage.removeItem('autoAfterView')
    } catch {
      auto = null
    }
    if (auto === 'print') setPrintJob(mode)
    if (auto === 'share') setTimeout(() => void shareBillImage(), 350)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice])

  // run the print dialog once the hidden print root is mounted
  useEffect(() => {
    if (!printJob) return
    const run = async () => {
      await printPaper(printJob)
      setPrintJob(null)
    }
    void run()
  }, [printJob])

  if (!invoice || !t) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        Bill load ho raha hai…
        <button className="btn btn-outline btn-block mt-4" onClick={onBack}>
          ← Peeche
        </button>
      </div>
    )
  }

  const meta = docMeta(invoice.docType)
  const isPurchase = meta.isPurchase
  const st = statusMeta(payStatus(t))
  const text = invoiceText(invoice, business, t)
  const base = fileBaseName(invoice, business)

  const shareBillImage = async () => {
    const node = shareRef.current
    if (!node) return
    setBusy(true)
    try {
      const res = await shareNodeAsImage(node, base)
      toast(res === 'shared' ? 'Bill bhej diya' : 'Bill ki image download ho gayi', 'success')
    } catch (e) {
      console.error(e)
      toast('Image share nahi ho payi', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="topbar no-print">
        <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={onBack}>
          ←
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{meta.label}</div>
          <div className="truncate text-[11px] text-brand-200">
            {invoice.number} • {fmtDate(invoice.date)} {invoice.status === 'CANCELLED' ? '• CANCELLED' : ''}
          </div>
        </div>
        <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => setMoreOpen(true)}>
          ⋯
        </button>
      </div>

      <div className="screen-content invoice-content no-print flex-1 px-3 pt-3">
        {/* Status summary */}
        <div className="card">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-900">{invoice.partyName || 'Cash Sale'}</div>
              <div className="truncate text-[11px] text-slate-500">
                {isPurchase ? '🏭 Supplier • ' : ''}
                {invoice.partyPhone || 'no mobile'} {invoice.partyGstin ? `• ${invoice.partyGstin}` : ''}
              </div>
            </div>
            <span className={`badge ${st.cls}`}>{st.label}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 py-2">
              <div className="text-[10px] font-bold uppercase text-slate-500">Total</div>
              <div className="num text-sm font-extrabold">{money(t.grandTotal)}</div>
            </div>
            <div className="rounded-xl bg-money-soft py-2">
              <div className="text-[10px] font-bold uppercase text-money">Paid</div>
              <div className="num text-sm font-extrabold text-money">{money(t.paid)}</div>
            </div>
            <div className={`rounded-xl py-2 ${t.due > 0.5 ? 'bg-due-soft' : 'bg-slate-50'}`}>
              <div className={`text-[10px] font-bold uppercase ${t.due > 0.5 ? 'text-due' : 'text-slate-500'}`}>
                {isPurchase ? 'Dena hai' : 'Baki'}
              </div>
              <div className={`num text-sm font-extrabold ${t.due > 0.5 ? 'text-due' : 'text-slate-600'}`}>{money(t.due)}</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] italic text-slate-500">{amountInWords(t.grandTotal)}</div>
        </div>

        {/* Actions */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="btn btn-primary" disabled={busy} onClick={() => setPrintJob(mode)}>
            🖨 Print / PDF
          </button>
          <button className="btn btn-money" disabled={busy} onClick={() => void shareBillImage()}>
            🖼 WhatsApp par image
          </button>
          <a
            className="btn btn-outline"
            href={waLink(invoice.partyPhone, text)}
            target="_blank"
            rel="noreferrer"
            onClick={() => toast('WhatsApp khul raha hai…')}
          >
            💬 WhatsApp text bill
          </a>
          <button
            className="btn btn-outline"
            onClick={async () => {
              const ok = await copyText(text)
              toast(ok ? 'Bill text copy ho gaya' : 'Copy nahi hua', ok ? 'success' : 'error')
            }}
          >
            📋 Copy bill text
          </button>
          {t.due > 0.5 && business.upiId && !isPurchase ? (
            <button className="btn btn-outline col-span-2" onClick={() => setQrOpen(true)}>
              📱 UPI QR dikhayein — {money(t.due)} lena hai
            </button>
          ) : null}
          {t.due > 0.5 ? (
            <button className="btn btn-dark col-span-2" onClick={() => setPayOpen(true)}>
              {isPurchase
                ? `📤 Supplier ko payment karein (baaki ${money(t.due)})`
                : `💰 Payment receive karein (baaki ${money(t.due)})`}
            </button>
          ) : null}
        </div>

        {/* Paper preview */}
        <div className="section-title mt-4">
          <span>Bill preview</span>
          <Segmented
            size="sm"
            value={mode}
            onChange={(v) => setMode(v)}
            options={[
              { value: 'a4', label: 'A4' },
              { value: 'thermal', label: 'Thermal 80mm' },
            ]}
          />
        </div>
        <div className="card-flat overflow-hidden bg-white p-2">
          <PaperScaler paperWidth={mode === 'a4' ? A4_WIDTH : 300}>
            <InvoicePaper invoice={invoice} business={business} mode={mode} />
          </PaperScaler>
        </div>

        {/* Payment history */}
        {invoice.payments.length ? (
          <div className="card mt-3">
            <div className="text-[13px] font-bold text-slate-700">
              {isPurchase ? 'Supplier ko kiye payment' : 'Payment history'}
            </div>
            <div className="mt-1">
              {invoice.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-slate-100 py-2 text-[13px] last:border-0">
                  <div>
                    <div className="font-semibold text-slate-800">{money(p.amount)} • {p.mode}</div>
                    <div className="text-[11px] text-slate-500">{fmtDate(p.date)} {p.note ? `• ${p.note}` : ''}</div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      void removePayment(invoice.id!, p.id)
                      toast('Payment hata diya')
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-3 flex gap-2">
          <button className="btn btn-outline flex-1" onClick={() => onEdit(invoice)}>
            ✏️ Edit
          </button>
          <button className="btn btn-outline flex-1" onClick={() => setConvertOpen(true)}>
            🔁 Convert / Copy
          </button>
        </div>
        <div className="h-8" />
      </div>

      {/* Hidden full-size paper for image sharing */}
      <div style={{ position: 'fixed', left: -10000, top: 0, zIndex: -1, pointerEvents: 'none' }}>
        <div ref={shareRef}>
          <InvoicePaper invoice={invoice} business={business} mode="a4" />
        </div>
      </div>

      {printJob ? (
        <PrintPortal>
          <InvoicePaper invoice={invoice} business={business} mode={printJob} />
        </PrintPortal>
      ) : null}

      {/* Payment sheet */}
      <PaymentSheet
        open={payOpen}
        due={t.due}
        isPurchase={isPurchase}
        onClose={() => setPayOpen(false)}
        onSave={async (amount, payMode, date, note) => {
          await recordPayment(invoice.id!, { amount, mode: payMode, date, note })
          setPayOpen(false)
          toast(`${money(amount)} payment record ho gaya`, 'success')
        }}
      />

      {/* UPI QR sheet */}
      <Sheet open={qrOpen} onClose={() => setQrOpen(false)} title="UPI se payment lein" subtitle={business.upiId}>
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="rounded-2xl border border-slate-200 p-3">
            <QRCodeSVG
              value={upiUri({ upiId: business.upiId ?? '', payeeName: business.name, amount: t.due, note: `Bill ${invoice.number}` })}
              size={210}
              level="M"
            />
          </div>
          <div className="text-center">
            <div className="text-lg font-extrabold">{money(t.due)}</div>
            <div className="text-xs text-slate-500">
              Party apne PhonePe / GPay / Paytm se ye QR scan kare (amount auto bhara aayega).
            </div>
            <div className="mt-1 text-sm font-bold">{business.upiId}</div>
          </div>
          <a
            className="btn btn-money btn-block"
            href={upiUri({ upiId: business.upiId ?? '', payeeName: business.name, amount: t.due, note: `Bill ${invoice.number}` })}
          >
            📱 Isi phone par UPI app kholen
          </a>
          <div className="text-[11px] text-slate-500">Payment milne par “Payment receive karein” dabakar likh lein.</div>
        </div>
      </Sheet>

      {/* More menu */}
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Bill options" subtitle={invoice.number}>
        <div className="flex flex-col gap-2">
          <button
            className="btn btn-outline btn-block"
            onClick={() => {
              setMoreOpen(false)
              setPrintJob('a4')
            }}
          >
            🖨 A4 print / PDF
          </button>
          <button
            className="btn btn-outline btn-block"
            onClick={() => {
              setMoreOpen(false)
              setPrintJob('thermal')
            }}
          >
            🧾 Thermal printer (80mm)
          </button>
          <button
            className="btn btn-outline btn-block"
            onClick={() => {
              setMoreOpen(false)
              void shareText(text, undefined, invoice.number)
            }}
          >
            📤 Baaki apps me share karein
          </button>
          {invoice.partyPhone ? (
            <a className="btn btn-outline btn-block" href={`tel:${cleanPhone(invoice.partyPhone)}`}>
              📞 {invoice.partyPhone} par call
            </a>
          ) : null}
          {['ESTIMATE', 'PROFORMA', 'DELIVERY_CHALLAN'].includes(invoice.docType) ? (
            <button
              className="btn btn-dark btn-block"
              onClick={async () => {
                const draft = await convertFor(invoice)
                setMoreOpen(false)
                onConverted(draft)
              }}
            >
              🧾 Pakka Tax Invoice banayein
            </button>
          ) : null}
          {invoice.status === 'FINAL' ? (
            <button
              className="btn btn-danger-soft btn-block"
              onClick={() => {
                setMoreOpen(false)
                setConfirmCancel(true)
              }}
            >
              🚫 Bill cancel karein (stock wapas)
            </button>
          ) : (
            <button
              className="btn btn-outline btn-block"
              onClick={async () => {
                await restoreInvoice(invoice.id!)
                setMoreOpen(false)
                toast('Bill wapas active kar diya', 'success')
              }}
            >
              ♻️ Cancel hatayein
            </button>
          )}
          <button
            className="btn btn-danger btn-block"
            onClick={() => {
              setMoreOpen(false)
              setConfirmDelete(true)
            }}
          >
            🗑 Bill delete karein
          </button>
        </div>
      </Sheet>

      {/* Convert sheet */}
      <Sheet open={convertOpen} onClose={() => setConvertOpen(false)} title="Convert ya copy karein" subtitle={invoice.number}>
        <div className="flex flex-col gap-2">
          {(invoice.docType === 'ESTIMATE' || invoice.docType === 'PROFORMA' || invoice.docType === 'DELIVERY_CHALLAN') && (
            <button
              className="btn btn-primary btn-block"
              onClick={async () => {
                const draft = await convertFor(invoice)
                setConvertOpen(false)
                onConverted(draft)
              }}
            >
              🧾 Tax Invoice banayein (estimate se pakka bill)
            </button>
          )}
          {invoice.docType === 'TAX_INVOICE' ? (
            <button
              className="btn btn-outline btn-block"
              onClick={async () => {
                const draft = await convertInvoice(invoice, 'CREDIT_NOTE')
                setConvertOpen(false)
                onConverted(draft)
              }}
            >
              ↩️ Credit note / sales return banayein
            </button>
          ) : null}
          <button
            className="btn btn-outline btn-block"
            onClick={async () => {
              const draft = await convertInvoice(invoice, invoice.docType)
              setConvertOpen(false)
              onConverted(draft)
            }}
          >
            📄 Isi ki copy banayein (naya number)
          </button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        title="Bill delete karein?"
        message="Ye bill hamesha ke liye hat jayega aur stock wapas adjust hoga. Cancel karna behtar hai."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await deleteInvoice(invoice.id!)
          setConfirmDelete(false)
          toast('Bill delete ho gaya')
          onBack()
        }}
      />
      <ConfirmDialog
        open={confirmCancel}
        title="Bill cancel karein?"
        message="Bill record me rahega par sales report aur stock se hat jayega."
        confirmLabel="Cancel bill"
        onCancel={() => setConfirmCancel(false)}
        onConfirm={async () => {
          await cancelInvoice(invoice.id!)
          setConfirmCancel(false)
          toast('Bill cancel ho gaya')
        }}
      />
    </div>
  )
}

async function convertFor(inv: Invoice): Promise<Invoice> {
  const target: DocType = 'TAX_INVOICE'
  return convertInvoice(inv, target)
}

function PaymentSheet({
  open,
  due,
  isPurchase = false,
  onClose,
  onSave,
}: {
  open: boolean
  due: number
  isPurchase?: boolean
  onClose: () => void
  onSave: (amount: number, mode: PaymentMode, date: string, note: string) => Promise<void>
}) {
  const [amount, setAmount] = useState(String(round2(due)))
  const [mode, setMode] = useState<PaymentMode>('CASH')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setAmount(String(round2(due)))
      setNote('')
      setDate(todayISO())
    }
  }, [open, due])

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isPurchase ? 'Supplier ko payment' : 'Payment receive karein'}
      subtitle={isPurchase ? `Dena baaki: ${money(due)}` : `Baaki: ${money(due)}`}
      footer={
        <button
          className="btn btn-money btn-block"
          disabled={busy}
          onClick={async () => {
            const amt = round2(Number(amount) || 0)
            if (amt <= 0) {
              toast('Amount likhein', 'error')
              return
            }
            setBusy(true)
            await onSave(amt, mode, date, note.trim())
            setBusy(false)
          }}
        >
          {isPurchase ? '✅ Payment save karein (Out)' : '✅ Payment save karein'}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="field">
          <label className="label">Amount (₹)</label>
          <input
            className="input input-lg"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex gap-1.5">
          <button className="chip" onClick={() => setAmount(String(round2(due)))}>
            Pura {money(due)}
          </button>
          <button className="chip" onClick={() => setAmount(String(round2(due / 2)))}>
            Aadha
          </button>
        </div>
        <div className="field">
          <label className="label">Payment mode</label>
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
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. UPI ref" />
          </div>
        </div>
        <div className="text-[11px] text-slate-500">
          <KeyValue k="Amount" v={money(Number(amount) || 0)} />
          <KeyValue k="Baki rah jayega" v={money(Math.max(0, round2(due - (Number(amount) || 0))))} strong />
        </div>
      </div>
    </Sheet>
  )
}
