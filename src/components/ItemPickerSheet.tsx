import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { itemSalePrice } from '../lib/calc'
import { money, num } from '../lib/format'
import { SearchInput, Sheet } from './ui'
import { BarcodeScanner } from './BarcodeScanner'
import type { Item } from '../lib/types'

export function ItemPickerSheet({
  open,
  onClose,
  onPick,
  onQuickAdd,
  title = 'Item chunein',
  showPurchaseRate = false,
}: {
  open: boolean
  onClose: () => void
  onPick: (item: Item) => void
  onQuickAdd?: (name: string, rate: number) => void
  title?: string
  showPurchaseRate?: boolean
}) {
  const [q, setQ] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const items = useLiveQuery(() => db.items.orderBy('name').toArray(), [], [] as Item[])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items.slice(0, 200)
    return items
      .filter((i) =>
        [i.name, i.code, i.barcode ?? '', i.brand, i.category].some((f) =>
          f.toLowerCase().includes(needle),
        ),
      )
      .slice(0, 200)
  }, [items, q])

  const handleScan = (code: string) => {
    const found = items.find(
      (i) => i.code.toLowerCase() === code.toLowerCase() || (i.barcode ?? '') === code,
    )
    if (found) {
      onPick(found)
      onClose()
    } else {
      setQ(code)
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title={title} subtitle={`${filtered.length} item`} full>
        <div className="sticky -top-3 z-10 -mx-4 -mt-3 mb-2 bg-white px-4 pb-2 pt-3">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Naam, code ya barcode…"
            onScan={() => setScannerOpen(true)}
            autoFocus
          />
          {onQuickAdd && q.trim() ? (
            <button
              className="btn btn-outline btn-sm mt-2 w-full"
              onClick={() => {
                onQuickAdd(q.trim(), 0)
                setQ('')
                onClose()
              }}
            >
              ＋ “{q.trim()}” ko bina item banaye bill me jodein (custom line)
            </button>
          ) : null}
        </div>

        <div className="-mx-4">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              Koi item nahi hai. “Items” tab me jaakar naya item jodein ya CSV import karein.
            </div>
          ) : null}
          {filtered.map((i) => {
            const sale = itemSalePrice(i.mrp, i.discountPercent, i.gstPercent)
            return (
              <button
                key={i.id}
                className="list-row w-full text-left"
                onClick={() => {
                  onPick(i)
                  onClose()
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-slate-900">{i.name}</div>
                  <div className="truncate text-[11px] text-slate-500">
                    {i.code}
                    {i.brand ? ` • ${i.brand}` : ''} • GST {num(i.gstPercent, 0)}%
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-[13px] font-bold text-slate-900">
                    {money(showPurchaseRate ? i.purchasePrice : sale)}
                  </div>
                  {showPurchaseRate ? <div className="text-[9px] font-bold uppercase text-slate-400">cost</div> : null}
                  <div
                    className={`text-[10px] font-bold ${
                      i.stockQty <= 0 ? 'text-due' : i.stockQty <= i.lowStockAlert ? 'text-warn' : 'text-money'
                    }`}
                  >
                    Stk {num(i.stockQty, 0)}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </Sheet>
      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetect={handleScan} />
    </>
  )
}
