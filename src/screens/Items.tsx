import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { itemMargin, itemSalePrice, itemTaxablePrice } from '../lib/calc'
import { download, money, num, quantity, readFileAsText, round2 } from '../lib/format'
import { deleteItem, upsertItem } from '../lib/repo'
import { BarcodeScanner } from '../components/BarcodeScanner'
import { ChipRow, ConfirmDialog, EmptyState, SearchInput, Sheet, StatBox, toast } from '../components/ui'
import type { Business, Item } from '../lib/types'
import { GST_RATES, UNITS } from '../lib/types'
import { itemsTemplateCsv, itemsToCsv, parseItemsCsv } from '../lib/csvutil'

const emptyItem = (): Item => ({
  name: '',
  code: '',
  barcode: '',
  brand: '',
  category: 'CP',
  subcategory: '',
  hsn: '',
  unit: 'PCS',
  mrp: 0,
  discountPercent: 0,
  gstPercent: 18,
  purchasePrice: 0,
  stockQty: 0,
  lowStockAlert: 2,
  notes: '',
  updatedAt: Date.now(),
})

export function ItemsScreen({ business, focusLowStock }: { business: Business; focusLowStock?: boolean }) {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('ALL')
  const [lowOnly, setLowOnly] = useState(!!focusLowStock)
  const [editing, setEditing] = useState<Item | null>(null)
  const [searchScannerOpen, setSearchScannerOpen] = useState(false)
  const [toDelete, setToDelete] = useState<Item | null>(null)
  const [csvOpen, setCsvOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const items = useLiveQuery(() => db.items.orderBy('name').toArray(), [], [] as Item[])

  const categories = useMemo(() => {
    const set = new Set((items ?? []).map((i) => i.category).filter(Boolean))
    return ['ALL', ...[...set].sort()]
  }, [items])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (items ?? []).filter((i) => {
      if (category !== 'ALL' && i.category !== category) return false
      if (lowOnly && i.stockQty > i.lowStockAlert) return false
      if (!needle) return true
      return [i.name, i.code, i.barcode ?? '', i.brand, i.category, i.subcategory ?? ''].some((f) =>
        f.toLowerCase().includes(needle),
      )
    })
  }, [items, q, category, lowOnly])

  const stats = useMemo(() => {
    const list = items ?? []
    return {
      count: list.length,
      stockValue: round2(list.reduce((s, i) => s + i.purchasePrice * i.stockQty, 0)),
      saleValue: round2(list.reduce((s, i) => s + itemSalePrice(i.mrp, i.discountPercent, i.gstPercent) * i.stockQty, 0)),
      low: list.filter((i) => i.stockQty <= i.lowStockAlert).length,
    }
  }, [items])

  const importCsv = async (file: File) => {
    const text = await readFileAsText(file)
    const { items: parsed, warnings } = parseItemsCsv(text)
    if (!parsed.length) {
      toast(warnings[0] ?? 'File me data nahi mila', 'error')
      return
    }
    const existing = await db.items.toArray()
    let added = 0
    let updated = 0
    for (const it of parsed) {
      const found = existing.find((e) => e.code.toLowerCase() === it.code.toLowerCase())
      if (found?.id) {
        await upsertItem({ ...it, id: found.id, updatedAt: found.updatedAt })
        updated++
      } else {
        await upsertItem(it as Item)
        added++
      }
    }
    toast(`${added} naye item, ${updated} update ho gaye`, 'success')
    setCsvOpen(false)
  }

  return (
    <div className="screen-content flex-1 px-3 pb-28 pt-3">
      <SearchInput
        value={q}
        onChange={setQ}
        placeholder="Item ka naam, code ya brand…"
        onScan={() => setSearchScannerOpen(true)}
      />

      <div className="stats-grid mt-2 grid grid-cols-3 gap-2">
        <StatBox label="Items" value={num(stats.count, 0)} />
        <StatBox label="Stock (cost)" value={money(stats.stockValue)} />
        <StatBox label="Low stock" value={num(stats.low, 0)} tone={stats.low ? 'due' : 'default'} />
      </div>

      <div className="mt-2">
        <ChipRow>
          {categories.map((c) => (
            <button key={c} className="chip" data-active={category === c} onClick={() => setCategory(c)}>
              {c === 'ALL' ? 'Sab category' : c}
            </button>
          ))}
        </ChipRow>
      </div>

      <div className="mt-1 flex items-center justify-between">
        <button className="chip" data-active={lowOnly} onClick={() => setLowOnly(!lowOnly)}>
          ⚠️ Sirf low stock
        </button>
        <div className="flex gap-1">
          <button className="btn btn-ghost btn-sm" onClick={() => setCsvOpen(true)}>
            ⬆⬇ CSV
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              download('items-template.csv', itemsTemplateCsv())
              toast('Sample CSV download ho gayi', 'success')
            }}
          >
            Template
          </button>
        </div>
      </div>

      <div className="mt-2">
        {filtered.length === 0 ? (
          <EmptyState
            icon="📦"
            title="Koi item nahi mila"
            hint="➕ button se naya item jodein ya CSV import karein."
            action={
              <button className="btn btn-primary btn-sm mt-2" onClick={() => setEditing(emptyItem())}>
                ＋ Naya item
              </button>
            }
          />
        ) : null}
        <div className="item-grid card-flat overflow-hidden">
          {filtered.map((i) => {
            const sale = itemSalePrice(i.mrp, i.discountPercent, i.gstPercent)
            const margin = itemMargin(i.mrp, i.discountPercent, i.purchasePrice)
            return (
              <button key={i.id} className="list-row w-full text-left" onClick={() => setEditing(i)}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-slate-900">{i.name}</div>
                  <div className="truncate text-[11px] text-slate-500">
                    {i.code}
                    {i.brand ? ` • ${i.brand}` : ''} • {i.category}
                    {i.hsn ? ` • HSN ${i.hsn}` : ''}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] font-bold">
                    <span className="text-slate-500">MRP {money(i.mrp, 0)}</span>
                    <span className="text-slate-700">Sale {money(sale, 0)}</span>
                    <span className="text-warn">Margin {money(margin.amount, 0)} ({num(margin.percent, 0)}%)</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={`num rounded-lg px-2 py-0.5 text-[12px] font-extrabold ${
                      i.stockQty <= 0
                        ? 'bg-due-soft text-due'
                        : i.stockQty <= i.lowStockAlert
                          ? 'bg-warn-soft text-warn'
                          : 'bg-money-soft text-money'
                    }`}
                  >
                    {quantity(i.stockQty)}
                  </div>
                  <div className="mt-0.5 text-[9px] font-bold uppercase text-slate-400">stock</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void importCsv(f)
          e.target.value = ''
        }}
      />

      <BarcodeScanner open={searchScannerOpen} onClose={() => setSearchScannerOpen(false)} onDetect={(code) => { setQ(code); setSearchScannerOpen(false) }} />

      {editing ? (
      <ItemEditor
        item={editing}
        business={business}
        onClose={() => setEditing(null)}
        onDelete={(it) => {
          setEditing(null)
          setToDelete(it)
        }}
      />
      ) : null}

      <Sheet open={csvOpen} onClose={() => setCsvOpen(false)} title="CSV import / export" subtitle="Excel se items laayein ya bhejein">
        <div className="flex flex-col gap-2">
          <button className="btn btn-primary btn-block" onClick={() => fileRef.current?.click()}>
            ⬆ CSV file se items import karein
          </button>
          <button
            className="btn btn-outline btn-block"
            onClick={() => {
              download(`items-${new Date().toISOString().slice(0, 10)}.csv`, itemsToCsv(items ?? [], true))
              toast('Items CSV download ho gayi', 'success')
            }}
          >
            ⬇ Sab items CSV me export (cost ke saath)
          </button>
          <button
            className="btn btn-outline btn-block"
            onClick={() => {
              download(`items-price-list.csv`, itemsToCsv(items ?? [], false))
              toast('Price list download ho gayi', 'success')
            }}
          >
            ⬇ Price list export (bina cost)
          </button>
          <button
            className="btn btn-ghost btn-block"
            onClick={() => {
              download('items-template.csv', itemsTemplateCsv())
              toast('Template download ho gayi', 'success')
            }}
          >
            📄 Naya CSV template
          </button>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            CSV me columns: Code, Barcode, Name, Brand, Category, Subcategory, HSN, Unit, MRP, Discount %, GST %,
            Purchase Price, Stock, Low Stock Alert, Notes. Android app ki purani file bhi isi format me chalti hai.
            Same code wale item update ho jayenge.
          </p>
        </div>
      </Sheet>

      <ConfirmDialog
        open={!!toDelete}
        title="Item delete karein?"
        message={toDelete ? `${toDelete.name} — purane bills me naam jaisa tha waisa rahega.` : ''}
        confirmLabel="Delete"
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete?.id) await deleteItem(toDelete.id)
          setToDelete(null)
          toast('Item delete ho gaya')
        }}
      />
    </div>
  )
}

// ---------------- Item editor ----------------

function ItemEditor({
  item,
  business,
  onClose,
  onDelete,
}: {
  item: Item | null
  business: Business
  onClose: () => void
  onDelete: (item: Item) => void
}) {
  const [draft, setDraft] = useState<Item | null>(item)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [brands, setBrands] = useState<string[]>([])
  const [cats, setCats] = useState<string[]>([])
  const loadedRef = useRef<number | null>(null)

  if (item && loadedRef.current !== (item.id ?? -1)) {
    loadedRef.current = item.id ?? -1
    setDraft(item)
    void (async () => {
      const all = await db.items.toArray()
      setBrands([...new Set(all.map((i) => i.brand).filter(Boolean))].sort())
      setCats([...new Set(all.map((i) => i.category).filter(Boolean))].sort())
    })()
  }

  if (!draft) return null
  void business

  const sale = itemSalePrice(draft.mrp, draft.discountPercent, draft.gstPercent)
  const taxable = itemTaxablePrice(draft.mrp, draft.discountPercent)
  const margin = itemMargin(draft.mrp, draft.discountPercent, draft.purchasePrice)

  const save = async () => {
    if (!draft.name.trim()) {
      toast('Item ka naam likhein', 'error')
      return
    }
    try {
      await upsertItem({
        ...draft,
        name: draft.name.trim(),
        code: draft.code.trim() || `ITEM-${Date.now().toString(36).slice(-5).toUpperCase()}`,
        brand: draft.brand.trim() || 'Local',
        category: draft.category.trim() || 'Other',
      })
      toast('Item save ho gaya', 'success')
      onClose()
    } catch (e) { toast(e instanceof Error ? e.message : 'Item save nahi hua', 'error') }
  }

  return (
    <Sheet
      open={!!item}
      onClose={onClose}
      title={draft.id ? 'Item edit karein' : 'Naya item jodein'}
      subtitle={draft.id ? draft.code : 'Naam, MRP aur stock zaroori hai'}
      full
      footer={
        <div className="flex gap-2">
          {draft.id ? (
            <button className="btn btn-danger-soft" onClick={() => onDelete(draft)}>
              🗑
            </button>
          ) : null}
          <button className="btn btn-primary flex-1" onClick={save}>
            💾 Save karein
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="field">
          <label className="label">Item ka naam *</label>
          <textarea
            className="textarea"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g. Wall Mixer 3-in-1 Chrome"
            autoFocus
          />
        </div>

        <div className="responsive-form-grid grid grid-cols-2 gap-3">
          <div className="field">
            <label className="label">Item code</label>
            <input className="input" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="HW-1234" />
          </div>
          <div className="field">
            <label className="label">Barcode</label>
            <div className="flex gap-1">
              <input className="input" value={draft.barcode ?? ''} onChange={(e) => setDraft({ ...draft, barcode: e.target.value })} inputMode="numeric" />
              <button className="btn btn-outline px-3" onClick={() => setScannerOpen(true)}>
                ▮▯
              </button>
            </div>
          </div>
        </div>

        <div className="responsive-form-grid grid grid-cols-2 gap-3">
          <div className="field">
            <label className="label">Brand / company</label>
            <input className="input" list="brand-list" value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} />
            <datalist id="brand-list">
              {brands.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label className="label">Category</label>
            <input className="input" list="cat-list" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
            <datalist id="cat-list">
              {cats.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label className="label">Sub-category</label>
            <input className="input" value={draft.subcategory ?? ''} onChange={(e) => setDraft({ ...draft, subcategory: e.target.value })} />
          </div>
          <div className="field">
            <label className="label">HSN / SAC</label>
            <input className="input" value={draft.hsn ?? ''} onChange={(e) => setDraft({ ...draft, hsn: e.target.value })} placeholder="8481" />
          </div>
        </div>

        <div className="responsive-form-grid grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="field">
            <label className="label">Unit</label>
            <select className="select" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">MRP</label>
            <input
              className="input text-right font-bold"
              inputMode="decimal"
              value={draft.mrp}
              onChange={(e) => setDraft({ ...draft, mrp: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="field">
            <label className="label">Disc %</label>
            <input
              className="input text-right"
              inputMode="decimal"
              value={draft.discountPercent}
              onChange={(e) => setDraft({ ...draft, discountPercent: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="field">
            <label className="label">GST %</label>
            <select
              className="select text-right"
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

        <div className="responsive-form-grid grid grid-cols-3 gap-3">
          <div className="field">
            <label className="label">Purchase rate</label>
            <input
              className="input text-right"
              inputMode="decimal"
              value={draft.purchasePrice}
              onChange={(e) => setDraft({ ...draft, purchasePrice: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="field">
            <label className="label">Stock qty</label>
            <input
              className="input text-right font-bold"
              inputMode="decimal"
              value={draft.stockQty}
              onChange={(e) => setDraft({ ...draft, stockQty: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="field">
            <label className="label">Low stock alert</label>
            <input
              className="input text-right"
              inputMode="numeric"
              value={draft.lowStockAlert}
              onChange={(e) => setDraft({ ...draft, lowStockAlert: Math.round(Number(e.target.value) || 0) })}
            />
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 p-3 text-[12px]">
          <div className="flex justify-between"><span className="text-slate-500">Taxable (MRP − disc)</span><span className="num font-semibold">{money(taxable)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Grahak ko sale price (GST sahit)</span><span className="num font-bold text-slate-900">{money(sale)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Margin per piece</span><span className="num font-semibold text-warn">{money(margin.amount)} ({num(margin.percent, 0)}%)</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Is stock ka margin</span><span className="num font-semibold">{money(round2(margin.amount * draft.stockQty))}</span></div>
        </div>

        <div className="field">
          <label className="label">Notes</label>
          <textarea className="textarea" value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        </div>
      </div>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetect={(code) => setDraft((d) => (d ? { ...d, barcode: code } : d))}
      />
    </Sheet>
  )
}
