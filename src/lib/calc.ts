import type { Invoice, InvoiceTotals, LineItem, LineTotals } from './types'
import { docMeta } from './types'
import { clamp, round0, round2 } from './format'

export interface ComputedLine extends LineTotals {
  gstPercent: number
}

/** Line level maths: gross → discount → taxable → (bill discount share) → GST → total */
export const computeTotals = (
  inv: Pick<
    Invoice,
    | 'docType'
    | 'items'
    | 'billDiscountType'
    | 'billDiscountValue'
    | 'extraCharges'
    | 'roundOffEnabled'
    | 'placeOfSupply'
    | 'payments'
  >,
  shopStateCode = '08',
): InvoiceTotals => {
  const meta = docMeta(inv.docType)
  const items = inv.items ?? []

  const lines: ComputedLine[] = items.map((l) => {
    const gross = round2(l.rate * l.qty)
    const discount = round2(gross * (clamp(l.discountPercent || 0, 0, 100) / 100))
    const taxable = round2(gross - discount)
    const gstPercent = meta.noTax ? 0 : clamp(l.gstPercent || 0, 0, 100)
    return { gross, discount, taxable, gstPercent, taxableAfterBillDiscount: taxable, tax: 0, total: taxable }
  })

  const gross = round2(lines.reduce((s, l) => s + l.gross, 0))
  const lineDiscount = round2(lines.reduce((s, l) => s + l.discount, 0))
  const taxable = round2(lines.reduce((s, l) => s + l.taxable, 0))

  let billDiscount = 0
  if (taxable > 0) {
    if (inv.billDiscountType === 'PERCENT') {
      billDiscount = round2(taxable * (clamp(inv.billDiscountValue || 0, 0, 100) / 100))
    } else {
      billDiscount = Math.min(round2(inv.billDiscountValue || 0), taxable)
      billDiscount = Math.max(billDiscount, 0)
    }
  }

  const discountPaise = Math.round(billDiscount * 100)
  const shares = lines.map(l => taxable > 0 ? discountPaise * l.taxable / taxable : 0)
  const allocated = shares.map(Math.floor)
  let remainder = discountPaise - allocated.reduce((s, n) => s + n, 0)
  const order = shares.map((n, i) => ({ i, fraction: n - allocated[i] })).sort((a, b) => b.fraction - a.fraction || a.i - b.i)
  for (const { i } of order) {
    if (remainder <= 0) break
    allocated[i]++
    remainder--
  }
  lines.forEach((l, i) => {
    l.taxableAfterBillDiscount = round2(l.taxable - allocated[i] / 100)
    l.tax = round2((l.taxableAfterBillDiscount * l.gstPercent) / 100)
    l.total = round2(l.taxableAfterBillDiscount + l.tax)
  })

  const taxableNet = round2(lines.reduce((s, l) => s + l.taxableAfterBillDiscount, 0))
  const tax = round2(lines.reduce((s, l) => s + l.tax, 0))
  const interState = !!inv.placeOfSupply && inv.placeOfSupply !== shopStateCode
  const igst = interState ? tax : 0
  const cgst = interState ? 0 : round2(tax / 2)
  const sgst = interState ? 0 : round2(tax - cgst)

  const charges = round2((inv.extraCharges ?? []).reduce((s, c) => s + (c.amount || 0), 0))
  const beforeRound = round2(taxableNet + tax + charges)
  const grandTotal = inv.roundOffEnabled ? round0(beforeRound) : beforeRound
  const roundOff = round2(grandTotal - beforeRound)

  const totalQty = items.reduce((s, l) => s + (l.qty || 0), 0)
  const paid = round2((inv.payments ?? []).reduce((s, p) => s + (p.amount || 0), 0))
  const due = round2(grandTotal - paid)
  const costTotal = round2(items.reduce((s, l) => s + (l.costPrice || 0) * l.qty, 0))
  const profit = round2(taxableNet - costTotal)

  return {
    lines,
    gross,
    lineDiscount,
    taxable,
    billDiscount,
    taxableNet,
    tax,
    cgst,
    sgst,
    igst,
    interState,
    charges,
    beforeRound,
    roundOff,
    grandTotal,
    totalQty,
    paid,
    due,
    costTotal,
    profit,
  }
}

export type PayStatus = 'PAID' | 'PARTIAL' | 'DUE'

export const payStatus = (t: InvoiceTotals): PayStatus =>
  t.due <= 0.5 ? 'PAID' : t.paid > 0 ? 'PARTIAL' : 'DUE'

export const statusMeta = (s: PayStatus): { label: string; hi: string; cls: string } =>
  s === 'PAID'
    ? { label: 'Paid', hi: 'चुका हुआ', cls: 'badge-paid' }
    : s === 'PARTIAL'
      ? { label: 'Partial', hi: 'कुछ बाकी', cls: 'badge-partial' }
      : { label: 'Due', hi: 'बाकी', cls: 'badge-due' }

/** Item level: sale price inclusive of GST after discount */
export const itemSalePrice = (mrp: number, discountPercent: number, gstPercent: number): number =>
  round2(mrp * (1 - clamp(discountPercent, 0, 100) / 100) * (1 + gstPercent / 100))

export const itemTaxablePrice = (mrp: number, discountPercent: number): number =>
  round2(mrp * (1 - clamp(discountPercent, 0, 100) / 100))

export const itemMargin = (
  mrp: number,
  discountPercent: number,
  purchasePrice: number,
): { amount: number; percent: number } => {
  const taxable = itemTaxablePrice(mrp, discountPercent)
  const amount = round2(taxable - purchasePrice)
  return { amount, percent: taxable > 0 ? round2((amount / taxable) * 100) : 0 }
}

export const lineFromItem = (
  item: {
    id?: number
    name: string
    code: string
    barcode?: string
    brand: string
    hsn?: string
    unit: string
    mrp: number
    discountPercent: number
    gstPercent: number
    purchasePrice: number
  },
  qty = 1,
): LineItem => ({
  id: Math.random().toString(36).slice(2, 10),
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
})

/** Group by HSN for the HSN-wise GST summary (GSTR-1 style) */
export const hsnSummary = (inv: Invoice, t: InvoiceTotals) => {
  const map = new Map<string, { hsn: string; qty: number; taxable: number; tax: number; rate: number }>()
  inv.items.forEach((l, i) => {
    const hsn = l.hsn?.trim() || '-'
    const key = `${hsn}|${l.gstPercent}`
    const row = map.get(key) ?? { hsn, qty: 0, taxable: 0, tax: 0, rate: l.gstPercent }
    row.qty += l.qty
    row.taxable = round2(row.taxable + (t.lines[i]?.taxableAfterBillDiscount ?? 0))
    row.tax = round2(row.tax + (t.lines[i]?.tax ?? 0))
    row.rate = l.gstPercent
    map.set(key, row)
  })
  return [...map.values()].sort((a, b) => b.taxable - a.taxable)
}
