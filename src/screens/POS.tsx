import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { computeTotals, lineFromItem } from '../lib/calc'
import { clamp, money, todayISO, uid } from '../lib/format'
import { saveInvoice } from '../lib/repo'
import { PAYMENT_MODES, type Business, type Invoice, type Item, type PaymentMode } from '../lib/types'
import { BarcodeScanner } from '../components/BarcodeScanner'
import { PartyPickerSheet } from '../components/PartyPickerSheet'
import { toast } from '../components/ui'

export function POSScreen({ draft, business, onBack, onEdit, onSaved }: {
  draft: Invoice; business: Business; onBack: () => void; onEdit: (draft: Invoice) => void; onSaved: (id: number) => void
}) {
  const [cart, setCart] = useState(() => ({ ...draft, billDiscountValue: 0 }))
  const [query, setQuery] = useState('')
  const [scanner, setScanner] = useState(false)
  const [party, setParty] = useState(false)
  const [mode, setMode] = useState<PaymentMode>('CASH')
  const [paid, setPaid] = useState(true)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const items = useLiveQuery(() => db.items.orderBy('name').toArray(), [], [] as Item[])
  const total = computeTotals(cart, business.stateCode)
  const filtered = items.filter(i => `${i.name} ${i.code} ${i.barcode ?? ''} ${i.brand}`.toLowerCase().includes(query.trim().toLowerCase()))
  const add = (item: Item) => setCart(prev => {
    const existing = prev.items.find(l => l.itemId === item.id)
    return { ...prev, items: existing ? prev.items.map(l => l === existing ? { ...l, qty: l.qty + 1 } : l) : [...prev.items, { ...lineFromItem(item), discountPercent: 0 }] }
  })
  const scan = (code: string) => {
    const item = items.find(i => i.barcode === code.trim() || i.code.toLowerCase() === code.trim().toLowerCase())
    if (item) { add(item); setQuery(''); toast(`${item.name} added`, 'success') }
    else { setQuery(code); toast('Item nahi mila — naam ya code check karein', 'error') }
    setScanner(false)
  }
  const checkout = async () => {
    if (savingRef.current || !cart.items.length) return
    if (!paid && !cart.partyId) { toast('Udhaar ke liye customer chunein', 'error'); setParty(true); return }
    savingRef.current = true
    setSaving(true)
    try {
      const id = await saveInvoice({ ...cart, payments: paid && total.grandTotal > 0 ? [{ id: uid(), date: todayISO(), amount: total.grandTotal, mode }] : [] }, business.stateCode)
      onSaved(id)
    } catch (e) { toast(e instanceof Error ? e.message : 'Checkout save nahi hua', 'error') }
    finally { savingRef.current = false; setSaving(false) }
  }
  return <div className="flex min-h-dvh flex-col">
    <header className="topbar">
      <button className="btn btn-sm bg-white/10" aria-label="Back" onClick={onBack} disabled={saving}>←</button>
      <div className="min-w-0 flex-1"><h1 className="font-bold">POS / Quick sale</h1><p className="text-xs text-brand-200">Items chunein → payment → receipt</p></div>
      <button className="btn btn-sm bg-white/10 pos-cart-jump" onClick={() => document.getElementById('pos-cart')?.scrollIntoView({ behavior: 'smooth' })}>Cart ({cart.items.length})</button>
    </header>
    <main className="pos-layout screen-content">
      <section className="min-w-0" aria-label="Product catalogue">
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); scan(query) }}>
          <input className="input" aria-label="Search POS items" placeholder="Search item / scan barcode + Enter" value={query} onChange={e => setQuery(e.target.value)} />
          <button type="button" className="btn btn-outline shrink-0" onClick={() => setScanner(true)}>Scan</button>
        </form>
        <p className="my-3 text-sm text-slate-500">{filtered.length} items • Tap to add</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.slice(0, 120).map(i => <button key={i.id} className="card flex min-w-0 flex-col gap-2 text-left hover:border-brand-500" onClick={() => add(i)} disabled={saving}>
            <span className="text-2xl" aria-hidden="true">📦</span><span className="break-words text-sm font-bold">{i.name}</span>
            <span className="break-words text-xs text-slate-500">{i.code} • {i.unit}</span>
            <span className="mt-auto font-bold text-brand-700">MRP {money(i.mrp)}</span>
            <span className="text-xs text-slate-500">+ {i.gstPercent}% GST • Stock: {i.stockQty}</span>
          </button>)}
        </div>
        {!filtered.length && <p className="card mt-3">No items found. Items tab se stock add karein.</p>}
        {filtered.length > 120 && <p className="mt-3 text-sm">Showing 120 items — search to narrow results.</p>}
      </section>
      <section id="pos-cart" className="card pos-cart scroll-mt-20" aria-label="Sale cart">
        <h2 className="text-lg font-bold">Current sale</h2>
        <button className="btn btn-outline my-3 w-full" disabled={saving} onClick={() => setParty(true)}>{cart.partyName || 'Cash Sale'} • Change customer</button>
        {!cart.items.length && <p className="py-8 text-center text-slate-500">Cart khaali hai. Item add karein.</p>}
        {cart.items.map((line, index) => <div className="border-b border-slate-100 py-3" key={line.id}>
          <div className="flex items-start justify-between gap-2"><span className="min-w-0 break-words text-sm font-semibold">{line.name}</span><strong className="shrink-0 text-sm">{money(total.lines[index].total)}</strong></div>
          <div className="mt-2 grid grid-cols-2 items-end gap-3">
            <div className="text-xs text-slate-500">Rate {money(line.rate)} / {line.unit}<br />Item discount: {money(total.lines[index].discount)}</div>
            <label className="field"><span className="label">Item discount %</span>
              <DiscountInput label={`Discount percent for ${line.name}`} value={line.discountPercent} disabled={saving} onChange={value => setCart(p => ({ ...p, items: p.items.map(l => l.id === line.id ? { ...l, discountPercent: value } : l) }))} />
            </label>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button className="qty-btn" aria-label={`Decrease ${line.name}`} disabled={saving} onClick={() => setCart(p => ({ ...p, items: p.items.map(l => l.id === line.id ? { ...l, qty: l.qty - 1 } : l).filter(l => l.qty > 0) }))}>−</button>
            <span className="num min-w-8 text-center">{line.qty}</span>
            <button className="qty-btn" aria-label={`Increase ${line.name}`} disabled={saving} onClick={() => setCart(p => ({ ...p, items: p.items.map(l => l.id === line.id ? { ...l, qty: l.qty + 1 } : l) }))}>+</button>
            <button className="btn btn-sm btn-ghost ml-auto" disabled={saving} onClick={() => setCart(p => ({ ...p, items: p.items.filter(l => l.id !== line.id) }))}>Remove</button>
          </div>
        </div>)}
        <div className="mt-3 flex justify-between text-sm"><span>Subtotal (before discounts)</span><span>{money(total.gross)}</span></div>
        <div className="mt-2 flex justify-between text-sm"><span>Item discounts</span><span>−{money(total.lineDiscount)}</span></div>
        <div className="my-3 flex justify-between text-sm"><span>GST included below</span><span>{money(total.tax)}</span></div>
        <div className="flex justify-between text-xl font-extrabold"><span>Total</span><span>{money(total.grandTotal)}</span></div>
        <label className="my-4 flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={paid} disabled={saving} onChange={e => setPaid(e.target.checked)} /> Full payment received</label>
        {paid ? <label className="field"><span className="label">Payment mode</span><select className="select" value={mode} disabled={saving} onChange={e => setMode(e.target.value as PaymentMode)}>{PAYMENT_MODES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label> : <p className="text-sm text-warn">Unpaid sale will be added to the customer’s khata.</p>}
        <button className="btn btn-money mt-4 w-full" disabled={saving || !cart.items.length} onClick={() => void checkout()}>{saving ? 'Saving…' : 'Checkout & receipt'}</button>
        <button className="btn btn-ghost mt-2 w-full" disabled={saving} onClick={() => onEdit(cart)}>Edit rates / partial payment</button>
      </section>
    </main>
    <BarcodeScanner open={scanner} onClose={() => setScanner(false)} onDetect={scan} />
    <PartyPickerSheet open={party} onClose={() => setParty(false)} shopStateCode={business.stateCode} partyType="CUSTOMER" onPick={p => { setCart(c => ({ ...c, partyId: p?.id, partyName: p?.name ?? '', partyPhone: p?.phone, partyGstin: p?.gstin, partyAddress: p?.address, placeOfSupply: p?.state || business.stateCode })); setParty(false) }} />
  </div>
}

/** Keep an empty field editable while the live calculation uses zero. */
function DiscountInput({ label, value, max = 100, disabled, onChange }: {
  label: string; value: number; max?: number; disabled: boolean; onChange: (value: number) => void
}) {
  const [text, setText] = useState<string | null>(null)
  return <input className="input" aria-label={label} type="number" inputMode="decimal" min="0" max={max} step="0.01" value={text ?? (value === 0 ? '' : value)} disabled={disabled} onBlur={() => setText(null)} onChange={e => {
    const raw = e.target.value
    const number = Number(raw)
    if (!Number.isFinite(number)) return
    const bounded = clamp(number, 0, max)
    setText(number === bounded ? raw : String(bounded))
    onChange(bounded)
  }} />
}
