import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { computeTotals } from '../lib/calc'
import { money, num, round2, todayISO, uid, clamp } from '../lib/format'
import { peekNumber, saveInvoice } from '../lib/repo'
import { docMeta, DOC_TYPES, GST_RATES, PAYMENT_MODES, STATES, UNITS } from '../lib/types'
import type { Business, DocType, Invoice, Item, LineItem, Party, PaymentMode } from '../lib/types'
import { BarcodeScanner } from '../components/BarcodeScanner'
import { ItemPickerSheet } from '../components/ItemPickerSheet'
import { PartyPickerSheet } from '../components/PartyPickerSheet'
import { ChipRow, Segmented, Sheet, toast } from '../components/ui'
import { A4_WIDTH, InvoicePaper, PaperScaler } from '../components/InvoicePaper'
import { PrintPortal } from '../components/PrintPortal'
import { printPaper, shareNodeAsImage, type PrintMode } from '../lib/print'
import { fileBaseName } from '../lib/doc'

export function BillingScreen({
  draft,
  business,
  onSaved,
  onBack,
}: {
  draft: Invoice
  business: Business
  onSaved: (id: number) => void
  onBack: () => void
}) {
  const [inv, setInv] = useState<Invoice>(draft)
  const [numberPreview, setNumberPreview] = useState(draft.number || '')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [partyOpen, setPartyOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [editLine, setEditLine] = useState<LineItem | null>(null)
  const [chargesOpen, setChargesOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [paidInput, setPaidInput] = useState('')
  const [payMode, setPayMode] = useState<PaymentMode>('CASH')
  const [saving, setSaving] = useState(false)
  const [previewMode, setPreviewMode] = useState<PrintMode | null>(null)
  const [printJob, setPrintJob] = useState<PrintMode | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  const t = useMemo(() => computeTotals(inv, business.stateCode), [inv, business.stateCode])
  const meta = docMeta(inv.docType)

  useEffect(() => {
    if (inv.number) return
    let alive = true
    peekNumber(inv.docType, inv.date).then((n) => alive && setNumberPreview(n))
    return () => {
      alive = false
    }
  }, [inv.docType, inv.date, inv.number])

  useEffect(() => {
    // pre-fill paid amount when the user changes the bill total
    if (paidInput === '') return
    const n = Number(paidInput)
    if (Number.isFinite(n) && n > t.grandTotal) setPaidInput(String(t.grandTotal))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.grandTotal])

  useEffect(() => {
    if (!printJob) return
    const run = async () => {
      await printPaper(printJob)
      setPrintJob(null)
    }
    void run()
  }, [printJob])

  const patch = (p: Partial<Invoice>) => setInv((prev) => ({ ...prev, ...p }))

  const isPurchase = inv.docType === 'PURCHASE'

  const addItem = (item: Item, qty = 1) => {
    setInv((prev) => {
      const existing = prev.items.find((l) => l.itemId === item.id)
      if (existing) {
        return {
          ...prev,
          items: prev.items.map((l) => (l.id === existing.id ? { ...l, qty: round2(l.qty + qty) } : l)),
        }
      }
      const line: LineItem = isPurchase
        ? {
            id: uid(),
            itemId: item.id,
            name: item.name,
            code: item.code,
            barcode: item.barcode,
            brand: item.brand,
            hsn: item.hsn,
            unit: item.unit,
            qty,
            rate: item.purchasePrice || item.mrp,
            discountPercent: 0,
            gstPercent: item.gstPercent,
            costPrice: item.purchasePrice,
          }
        : {
            id: uid(),
            itemId: item.id,
            name: item.name,
            code: item.code,
            barcode: item.barcode,
            brand: item.brand,
            hsn: item.hsn,
            unit: item.unit,
            qty,
            rate: item.mrp,
            discountPercent: item.discountPercent,
            gstPercent: item.gstPercent,
            costPrice: item.purchasePrice,
          }
      return { ...prev, items: [...prev.items, line] }
    })
    toast(`${item.name.slice(0, 26)} add ho gaya`, 'success')
  }

  const addCustomLine = (name: string, rate: number) => {
    const line: LineItem = {
      id: uid(),
      name,
      code: '',
      unit: 'PCS',
      qty: 1,
      rate,
      discountPercent: 0,
      gstPercent: 18,
      costPrice: 0,
    }
    setInv((prev) => ({ ...prev, items: [...prev.items, line] }))
    setEditLine(line)
  }

  const scanAdd = async (code: string) => {
    const c = code.trim().toLowerCase()
    const found = await db.items.toArray().then((all) =>
      all.find((i) => i.code.toLowerCase() === c || (i.barcode ?? '').toLowerCase() === c),
    )
    if (found) addItem(found)
    else {
      toast(`Code ${code} kisi item se match nahi hua`, 'error')
      setPickerOpen(true)
    }
  }

  const saveLine = (line: LineItem) => {
    setInv((prev) => ({ ...prev, items: prev.items.map((l) => (l.id === line.id ? line : l)) }))
    setEditLine(null)
  }
  const removeLine = (id: string) => {
    setInv((prev) => ({ ...prev, items: prev.items.filter((l) => l.id !== id) }))
    setEditLine(null)
  }
  const bumpQty = (id: string, delta: number) =>
    setInv((prev) => ({
      ...prev,
      items: prev.items.map((l) => (l.id === id ? { ...l, qty: Math.max(0, round2(l.qty + delta)) } : l)),
    }))

  const setDocType = (docType: DocType) => {
    if (inv.items.length && inv.docType !== docType) {
      const target = docMeta(docType)
      if (target.noTax) patch({ docType, items: inv.items.map((l) => ({ ...l, gstPercent: 0 })) })
      else patch({ docType, number: '', items: inv.items.map((l) => ({ ...l, gstPercent: l.gstPercent || 18 })) })
    } else {
      patch({ docType, number: '' })
    }
  }

  const paidAmount = round2(Number(paidInput) || 0)

  const doSave = async (after?: 'print' | 'share' | 'view') => {
    if (!inv.items.length) {
      toast('Pehle ek item jodein', 'error')
      return
    }
    setSaving(true)
    try {
      const payments =
        paidAmount > 0
          ? [...inv.payments, { id: uid(), date: inv.date, amount: paidAmount, mode: payMode }]
          : inv.payments
      const toSave: Invoice = {
        ...inv,
        number: inv.number.trim(),
        payments,
      }
      const id = await saveInvoice(toSave, business.stateCode)
      const saved = (await db.invoices.get(id)) ?? toSave
      toast(`${saved.number} save ho gaya`, 'success')
      if (after === 'print' || after === 'share') {
        try {
          sessionStorage.setItem('autoAfterView', after)
        } catch {
          /* ignore */
        }
      }
      onSaved(id)
    } catch (e) {
      console.error(e)
      toast(e instanceof Error && e.message.trim() ? e.message : 'Save nahi hua — dobara koshish karein', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar */}
      <div className="topbar">
        <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={onBack}>
          ←
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{meta.label}</div>
          <div className="truncate text-[11px] text-brand-200">
            {inv.number || numberPreview} • {inv.items.length} item
          </div>
        </div>
        <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => setPreviewMode('a4')}>
          👁 Preview
        </button>
        <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => setMoreOpen(true)}>
          ⋯
        </button>
      </div>

      <div className="screen-content billing-content flex-1 px-3 pb-40">
        {/* Doc type + date */}
        <div className="mt-3 card">
          <ChipRow>
            {DOC_TYPES.map((d) => (
              <button
                key={d.key}
                className="chip"
                data-active={inv.docType === d.key}
                onClick={() => setDocType(d.key)}
              >
                {d.icon} {d.label}
              </button>
            ))}
          </ChipRow>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="field">
              <label className="label">Date</label>
              <input
                type="date"
                className="input"
                value={inv.date}
                onChange={(e) => patch({ date: e.target.value || todayISO() })}
              />
            </div>
            <div className="field">
              <label className="label">Bill number</label>
              <input
                className="input"
                value={inv.number}
                placeholder={numberPreview}
                onChange={(e) => patch({ number: e.target.value })}
              />
            </div>
          </div>
          {(meta.key === 'TAX_INVOICE' || meta.key === 'PROFORMA') && (
            <div className="mt-2 field">
              <label className="label">Payment due date (optional)</label>
              <input type="date" className="input" value={inv.dueDate ?? ''} onChange={(e) => patch({ dueDate: e.target.value })} />
            </div>
          )}
        </div>

        {/* Party */}
        <button className="card mt-3 flex w-full items-center gap-3 text-left" onClick={() => setPartyOpen(true)}>
          <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-lg">{isPurchase ? '🏭' : '👤'}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-slate-900">
              {inv.partyName || (isPurchase ? 'Supplier chunein' : 'Cash Sale / Walk-in Customer')}
            </div>
            <div className="truncate text-[11px] text-slate-500">
              {inv.partyPhone ? `${inv.partyPhone} • ` : ''}
              {isPurchase ? 'Supplier bill — stock badhega, payable banega' : 'Tap karke party chunein ya naya jodein'}
            </div>
          </div>
          <span className="text-slate-400">›</span>
        </button>

        {/* Items */}
        <div className="mt-3 card billing-items">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-bold text-slate-700">Items ({inv.items.length})</div>
            <div className="flex gap-1.5">
              <button className="btn btn-outline btn-sm" onClick={() => setScannerOpen(true)}>
                ▮▯ Scan
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setPickerOpen(true)}>
                ＋ Item
              </button>
            </div>
          </div>

          <div className="mt-1">
            {inv.items.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                Abhi koi item nahi. “＋ Item” dabakar ya barcode scan karke jodein.
              </div>
            ) : null}
            {inv.items.map((l, i) => {
              const lt = t.lines[i]
              return (
                <div key={l.id} className="cart-line">
                  <div className="billing-line-layout">
                    <button className="min-w-0 flex-1 text-left" onClick={() => setEditLine(l)}>
                      <div className="truncate text-[13px] font-semibold text-slate-900">{l.name}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {num(l.qty, 0)} {l.unit} × {num(l.rate)}
                        {l.discountPercent ? ` − ${num(l.discountPercent, 0)}%` : ''}
                        {l.gstPercent ? ` + GST ${num(l.gstPercent, 0)}%` : ''}
                      </div>
                    </button>
                    <div className="flex items-center gap-1">
                      <button className="qty-btn" onClick={() => bumpQty(l.id, -1)}>
                        −
                      </button>
                      <span className="num w-8 text-center text-sm font-bold">{num(l.qty, 0)}</span>
                      <button className="qty-btn" onClick={() => bumpQty(l.id, 1)}>
                        +
                      </button>
                    </div>
                    <div className="num w-[74px] shrink-0 text-right text-[13px] font-bold text-slate-900">
                      {money(lt?.total ?? 0)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Discounts & charges */}
        <div className="mt-3 card">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-bold text-slate-700">Bill discount</div>
            <div className="flex items-center gap-1.5">
              <Segmented
                size="sm"
                value={inv.billDiscountType}
                onChange={(v) => patch({ billDiscountType: v as 'PERCENT' | 'AMOUNT' })}
                options={[
                  { value: 'PERCENT', label: '%' },
                  { value: 'AMOUNT', label: '₹' },
                ]}
              />
              <input
                className="input w-20 py-1.5 text-right text-sm font-bold"
                inputMode="decimal"
                value={inv.billDiscountValue || ''}
                placeholder="0"
                onChange={(e) => patch({ billDiscountValue: clamp(Number(e.target.value) || 0, 0, 100000) })}
              />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
            <button className="text-[13px] font-semibold text-slate-700" onClick={() => setChargesOpen(true)}>
              ＋ Extra charges (freight, hamali)
            </button>
            <span className="num text-[13px] font-bold text-slate-700">{money(t.charges)}</span>
          </div>
          <label className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[13px] font-semibold text-slate-700">
            <span>Round off total</span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-brand-600"
              checked={inv.roundOffEnabled}
              onChange={(e) => patch({ roundOffEnabled: e.target.checked })}
            />
          </label>
        </div>

        {/* Payment */}
        <div className="mt-3 card">
          <div className="text-[13px] font-bold text-slate-700">Payment</div>
          <div className="mt-2 flex gap-1.5">
            <button className="chip" onClick={() => setPaidInput(String(t.grandTotal))}>
              Full paid
            </button>
            <button className="chip" onClick={() => setPaidInput(String(round2(t.grandTotal / 2)))}>
              Half
            </button>
            <button className="chip" onClick={() => setPaidInput('0')}>
              {isPurchase ? 'Udhaar (payable)' : 'Udhaar (credit)'}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="field">
              <label className="label">{isPurchase ? 'Paid to supplier (₹)' : 'Received (₹)'}</label>
              <input
                className="input input-lg"
                inputMode="decimal"
                value={paidInput}
                placeholder="0"
                onChange={(e) => setPaidInput(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="label">Mode</label>
              <select className="select" value={payMode} onChange={(e) => setPayMode(e.target.value as PaymentMode)}>
                {PAYMENT_MODES.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} ({m.hi})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="num mt-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-[13px] font-bold">
            <span className="text-slate-600">{isPurchase ? 'Supplier ko dena baki' : 'Baki (due)'}</span>
            <span className={t.grandTotal - paidAmount > 0.5 ? 'text-due' : 'text-money'}>
              {money(Math.max(0, round2(t.grandTotal - paidAmount)))}
            </span>
          </div>
        </div>

        <button className="btn btn-outline btn-block mt-3" onClick={() => setDetailsOpen(true)}>
          📝 Notes, transport & terms
        </button>
      </div>

      {/* Sticky total bar */}
      <div className="sticky-total no-print">
        <div className="mb-2 flex items-end justify-between">
          <div className="text-[11px] font-semibold text-slate-500">
            Qty {num(t.totalQty, 0)} • Taxable {money(t.taxableNet)} • GST {money(t.tax)}
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase text-slate-500">Grand total</div>
            <div className="num text-lg font-extrabold text-slate-900">{money(t.grandTotal)}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-outline flex-1" disabled={saving} onClick={() => void doSave('view')}>
            Save
          </button>
          <button className="btn btn-dark flex-1" disabled={saving} onClick={() => void doSave('print')}>
            🖨 Save + Print
          </button>
          <button className="btn btn-money flex-1" disabled={saving} onClick={() => void doSave('share')}>
            Share
          </button>
        </div>
      </div>

      {/* Sheets */}
      <ItemPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={isPurchase ? 'Purchase item chunein' : 'Item chunein'}
        showPurchaseRate={isPurchase}
        onPick={(item) => addItem(item)}
        onQuickAdd={(name, rate) => addCustomLine(name, rate)}
      />
      <PartyPickerSheet
        open={partyOpen}
        onClose={() => setPartyOpen(false)}
        shopStateCode={business.stateCode}
        partyType={isPurchase ? 'SUPPLIER' : 'ALL'}
        onPick={(p: Party | null) => {
          if (!p) {
            patch({ partyId: undefined, partyName: '', partyPhone: '', partyGstin: '', partyAddress: '', placeOfSupply: '' })
            return
          }
          patch({
            partyId: p.id,
            partyName: p.name,
            partyPhone: p.phone ?? '',
            partyGstin: p.gstin ?? '',
            partyAddress: p.address ?? '',
            placeOfSupply: p.state || business.stateCode,
          })
        }}
      />
      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetect={(c) => void scanAdd(c)} />

      <LineEditor line={editLine} onClose={() => setEditLine(null)} onSave={saveLine} onDelete={removeLine} />

      <ChargesSheet
        open={chargesOpen}
        onClose={() => setChargesOpen(false)}
        value={inv.extraCharges}
        onChange={(list) => patch({ extraCharges: list })}
      />

      <Sheet
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Notes, transport & terms"
        footer={
          <button className="btn btn-primary btn-block" onClick={() => setDetailsOpen(false)}>
            Ho gaya
          </button>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label">Transport name</label>
              <input className="input" value={inv.transportName ?? ''} onChange={(e) => patch({ transportName: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Vehicle no.</label>
              <input className="input" value={inv.vehicleNo ?? ''} onChange={(e) => patch({ vehicleNo: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">E-way bill</label>
              <input className="input" value={inv.eWayBill ?? ''} onChange={(e) => patch({ eWayBill: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">PO / Reference</label>
              <input className="input" value={inv.poNumber ?? ''} onChange={(e) => patch({ poNumber: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label className="label">Place of supply (GST state)</label>
            <select
              className="select"
              value={inv.placeOfSupply || business.stateCode}
              onChange={(e) => patch({ placeOfSupply: e.target.value })}
            >
              <option value={business.stateCode}>{business.stateCode} — {business.stateName} (same state)</option>
              {STATES.filter((s) => s.code !== business.stateCode).map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name} (IGST)
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Note (bill par chhapega)</label>
            <textarea className="textarea" value={inv.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} placeholder="e.g. Delivery 5 din me, 50% advance liya gaya" />
          </div>
          <div className="field">
            <label className="label">Terms & conditions</label>
            <textarea className="textarea" value={inv.terms ?? business.terms} onChange={(e) => patch({ terms: e.target.value })} />
          </div>
        </div>
      </Sheet>

      <Sheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="Bill options"
        subtitle={inv.number || numberPreview}
      >
        <div className="flex flex-col gap-2">
          <button
            className="btn btn-outline btn-block"
            onClick={() => {
              setMoreOpen(false)
              void doSave('view')
            }}
          >
            💾 Save karein
          </button>
          <button
            className="btn btn-outline btn-block"
            onClick={() => {
              setMoreOpen(false)
              void doSave('share')
            }}
          >
            💬 Save + WhatsApp share
          </button>
          <button
            className="btn btn-outline btn-block"
            onClick={() => {
              setMoreOpen(false)
              setPreviewMode('a4')
            }}
          >
            👁 Bill ka preview dekhein
          </button>
          <button
            className="btn btn-danger-soft btn-block"
            onClick={() => {
              setInv({
                ...inv,
                items: [],
                billDiscountValue: 0,
                extraCharges: [],
                payments: [],
                partyId: undefined,
                partyName: '',
                partyPhone: '',
                partyGstin: '',
                partyAddress: '',
                notes: '',
              })
              setPaidInput('')
              setMoreOpen(false)
              toast('Bill khaali kar diya')
            }}
          >
            🗑 Items hataakar naya bill shuru karein
          </button>
        </div>
      </Sheet>
      {/* Preview sheet (save se pehle bill dikhega) */}
      <Sheet
        open={previewMode !== null}
        onClose={() => setPreviewMode(null)}
        title="Bill preview"
        subtitle={`${inv.number || numberPreview} • ${money(t.grandTotal)}`}
        full
        footer={
          <div className="flex gap-2">
            <button className="btn btn-outline flex-1" onClick={() => setPrintJob(previewMode ?? 'a4')}>
              🖨 Print / PDF
            </button>
            <button
              className="btn btn-money flex-1"
              onClick={async () => {
                if (!previewRef.current) return
                try {
                  const res = await shareNodeAsImage(previewRef.current, fileBaseName({ ...inv, number: inv.number || numberPreview }, business))
                  toast(res === 'shared' ? 'Bill bhej diya' : 'Image download ho gayi', 'success')
                } catch {
                  toast('Image nahi ban payi', 'error')
                }
              }}
            >
              🖼 Share image
            </button>
            <button className="btn btn-primary flex-1" onClick={() => void doSave('view')}>
              💾 Save
            </button>
          </div>
        }
      >
        <div className="mb-2">
          <Segmented
            value={previewMode ?? 'a4'}
            onChange={(v) => setPreviewMode(v)}
            options={[
              { value: 'a4', label: 'A4' },
              { value: 'thermal', label: 'Thermal 80mm' },
            ]}
          />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-2">
          <div ref={previewRef}>
            <PaperScaler paperWidth={(previewMode ?? 'a4') === 'a4' ? A4_WIDTH : 300}>
              <InvoicePaper
                invoice={{ ...inv, number: inv.number || numberPreview }}
                business={business}
                mode={previewMode ?? 'a4'}
              />
            </PaperScaler>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Preview me hi save kar sakte hain. Print dabane par A4 ya thermal printer dialog khulega — wahan se PDF bhi save hota hai.
        </p>
      </Sheet>

      {printJob ? (
        <PrintPortal>
          <InvoicePaper invoice={{ ...inv, number: inv.number || numberPreview }} business={business} mode={printJob} />
        </PrintPortal>
      ) : null}


    </div>
  )
}

// ---------------- Line editor ----------------

function LineEditor({
  line,
  onClose,
  onSave,
  onDelete,
}: {
  line: LineItem | null
  onClose: () => void
  onSave: (l: LineItem) => void
  onDelete: (id: string) => void
}) {
  const [draft, setDraft] = useState<LineItem | null>(line)
  const items = useLiveQuery(() => db.items.orderBy('name').toArray(), [], [] as Item[])

  useEffect(() => setDraft(line), [line])
  if (!draft) return null

  const gross = round2(draft.rate * draft.qty)
  const taxable = round2(gross * (1 - clamp(draft.discountPercent, 0, 100) / 100))
  const tax = round2(taxable * (draft.gstPercent / 100))

  const linkItem = (itemId: number) => {
    const it = items.find((i) => i.id === itemId)
    if (!it) return
    setDraft({
      ...draft,
      itemId: it.id,
      name: it.name,
      code: it.code,
      barcode: it.barcode,
      brand: it.brand,
      hsn: it.hsn,
      unit: it.unit,
      rate: it.mrp,
      discountPercent: it.discountPercent,
      gstPercent: it.gstPercent,
      costPrice: it.purchasePrice,
      qty: draft.qty,
    })
  }

  return (
    <Sheet
      open={!!line}
      onClose={onClose}
      title="Item edit karein"
      subtitle={draft.code || draft.name}
      footer={
        <div className="flex gap-2">
          <button className="btn btn-danger-soft" onClick={() => onDelete(draft.id)}>
            🗑
          </button>
          <button className="btn btn-primary flex-1" onClick={() => onSave(draft)}>
            Line update karein
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="field">
          <label className="label">Item name</label>
          <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="field">
          <label className="label">Stock item se link karein (optional)</label>
          <select className="select" value={draft.itemId ?? ''} onChange={(e) => linkItem(Number(e.target.value))}>
            <option value="">— Bina link (custom line) —</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} • {i.code} • Stk {i.stockQty}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="field">
            <label className="label">Qty</label>
            <input
              className="input text-right font-bold"
              inputMode="decimal"
              value={draft.qty}
              onChange={(e) => setDraft({ ...draft, qty: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="field">
            <label className="label">Unit</label>
            <select className="select" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">HSN</label>
            <input className="input" value={draft.hsn ?? ''} onChange={(e) => setDraft({ ...draft, hsn: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="field">
            <label className="label">Rate / MRP</label>
            <input
              className="input text-right font-bold"
              inputMode="decimal"
              value={draft.rate}
              onChange={(e) => setDraft({ ...draft, rate: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="field">
            <label className="label">Disc %</label>
            <input
              className="input text-right font-bold"
              inputMode="decimal"
              value={draft.discountPercent}
              onChange={(e) => setDraft({ ...draft, discountPercent: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="field">
            <label className="label">GST %</label>
            <select
              className="select text-right font-bold"
              value={draft.gstPercent}
              onChange={(e) => setDraft({ ...draft, gstPercent: Number(e.target.value) })}
            >
              {GST_RATES.map((g) => (
                <option key={g} value={g}>
                  {g}%
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-[13px]">
          <div className="flex justify-between"><span className="text-slate-500">Taxable</span><span className="num font-semibold">{money(taxable)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">GST</span><span className="num font-semibold">{money(tax)}</span></div>
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-bold"><span>Line total</span><span className="num">{money(round2(taxable + tax))}</span></div>
        </div>
      </div>
    </Sheet>
  )
}

// ---------------- Extra charges ----------------

function ChargesSheet({
  open,
  onClose,
  value,
  onChange,
}: {
  open: boolean
  onClose: () => void
  value: { label: string; amount: number }[]
  onChange: (v: { label: string; amount: number }[]) => void
}) {
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Extra charges"
      subtitle="Freight, hamali, packing — GST ke baad jodenge"
      footer={
        <button className="btn btn-primary btn-block" onClick={onClose}>
          Ho gaya
        </button>
      }
    >
      {value.length ? (
        <div className="mb-3">
          {value.map((c, i) => (
            <div key={i} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm">
              <span className="font-semibold text-slate-700">{c.label || 'Charge'}</span>
              <span className="flex items-center gap-2">
                <span className="num font-bold">{money(c.amount)}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Koi extra charge nahi joda gaya.</div>
      )}
      <div className="grid grid-cols-[1fr_110px_auto] gap-2">
        <input className="input" placeholder="e.g. Freight" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="input text-right" inputMode="decimal" placeholder="₹ 0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button
          className="btn btn-primary"
          onClick={() => {
            const amt = Number(amount) || 0
            if (!amt) return
            onChange([...value, { label: label.trim() || 'Charge', amount: amt }])
            setLabel('')
            setAmount('')
          }}
        >
          ＋
        </button>
      </div>
    </Sheet>
  )
}
