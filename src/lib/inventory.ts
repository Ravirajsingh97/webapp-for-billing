import type { ShowroomDB } from './db'
import type { Invoice, Item } from './types'
import { docMeta } from './types'

/** Stock supports fractional units independently of currency rounding. */
export const roundStock = (value: number): number => Math.round(value * 1_000_000) / 1_000_000

/** A converted challan and its invoice describe one physical delivery. */
export function stockContributions(invoices: Invoice[], includeConvertedChallans = false): Map<number, number> {
  const converted = new Set(invoices.filter(i => i.status === 'FINAL' && i.docType === 'TAX_INVOICE' && i.fromId).map(i => i.fromId))
  const totals = new Map<number, number>()
  for (const inv of invoices) {
    if (inv.status !== 'FINAL' || (!includeConvertedChallans && inv.docType === 'DELIVERY_CHALLAN' && converted.has(inv.id))) continue
    const meta = docMeta(inv.docType)
    const sign = meta.stockOut ? -1 : meta.stockIn ? 1 : 0
    for (const line of inv.items ?? []) {
      if (line.itemId && sign) totals.set(line.itemId, roundStock((totals.get(line.itemId) ?? 0) + sign * line.qty))
    }
  }
  return totals
}

/** Migrate legacy quantities without assuming that all stock came from purchases. */
export function initializeInventory(items: Item[], invoices: Invoice[]): void {
  const legacy = stockContributions(invoices, true)
  for (const item of items) {
    if (item.stockOpening === undefined) item.stockOpening = roundStock(item.stockQty - (legacy.get(item.id!) ?? 0))
    if (!Number.isFinite(item.stockOpening)) throw new Error('Invalid inventory opening quantity')
    if (item.stockAdjustments !== undefined && (!item.stockAdjustments || typeof item.stockAdjustments !== 'object' || Array.isArray(item.stockAdjustments) || Object.values(item.stockAdjustments).some(n => !Number.isFinite(n)))) throw new Error('Invalid inventory adjustments')
  }
}

/** Quantities are derived from merged invoice identities and immutable adjustments. */
export async function reconcileInventory(dbx: ShowroomDB): Promise<void> {
  const [items, invoices] = await Promise.all([dbx.items.toArray(), dbx.invoices.toArray()])
  const before = new Map(items.map(i => [i.id, JSON.stringify(i)]))
  initializeInventory(items, invoices)
  const contributions = stockContributions(invoices)
  for (const item of items) {
    const oldQty = item.stockQty
    item.stockQty = roundStock(item.stockOpening! + Object.values(item.stockAdjustments ?? {}).reduce((s, n) => s + n, 0) + (contributions.get(item.id!) ?? 0))
    if (oldQty !== item.stockQty) item.updatedAt = Math.max(Date.now(), (item.updatedAt ?? 0) + 1)
    if (JSON.stringify(item) !== before.get(item.id)) await dbx.items.put(item)
  }
}
