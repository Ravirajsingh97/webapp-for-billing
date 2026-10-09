import type { Business, Invoice, Item } from './types'
import { docMeta } from './types'
import { computeTotals, itemMargin, itemSalePrice } from './calc'
import { fmtDate, num, round2 } from './format'

// ---------------- Low level CSV ----------------

export function parseCsvText(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',' || ch === '\t' || ch === ';') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export const csvEscape = (v: unknown): string => {
  const s = String(v ?? '')
  return /[",;\t\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const toNum = (v: string | undefined, fallback = 0): number => {
  if (v == null) return fallback
  const n = Number(String(v).replace(/[₹,\s]/g, '').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : fallback
}

// ---------------- Items export (Android compatible + extra columns) ----------------

export function itemsToCsv(items: Item[], includeInternal = true): string {
  const head = includeInternal
    ? ['Code', 'Barcode', 'Name', 'Brand', 'Category', 'Subcategory', 'HSN', 'Unit', 'MRP', 'Discount %', 'Taxable Price', 'GST %', 'Sale Price', 'Purchase Price', 'Margin ₹', 'Margin %', 'Stock', 'Low Stock Alert', 'Notes']
    : ['Code', 'Barcode', 'Name', 'Brand', 'Category', 'Subcategory', 'HSN', 'Unit', 'MRP', 'Discount %', 'GST %', 'Sale Price', 'Stock', 'Notes']
  const rows = items.map((i) => {
    const m = itemMargin(i.mrp, i.discountPercent, i.purchasePrice)
    const base = [
      i.code, i.barcode ?? '', i.name, i.brand, i.category, i.subcategory ?? '', i.hsn ?? '', i.unit,
      i.mrp.toFixed(2), String(i.discountPercent), i.gstPercent.toFixed(2), itemSalePrice(i.mrp, i.discountPercent, i.gstPercent).toFixed(2),
    ]
    return includeInternal
      ? [...base.slice(0, 10), itemSalePrice(i.mrp, i.discountPercent, 0).toFixed(2), base[10], base[11], i.purchasePrice.toFixed(2), m.amount.toFixed(2), m.percent.toFixed(1), String(i.stockQty), String(i.lowStockAlert), i.notes ?? '']
      : [i.code, i.barcode ?? '', i.name, i.brand, i.category, i.subcategory ?? '', i.hsn ?? '', i.unit, i.mrp.toFixed(2), String(i.discountPercent), i.gstPercent.toFixed(2), base[11], String(i.stockQty), i.notes ?? '']
  })
  return [head, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n')
}

export interface ParsedItems {
  items: Omit<Item, 'id'>[]
  warnings: string[]
}

const ALIASES: Record<string, string[]> = {
  code: ['code', 'item code', 'itemcode', 'sku', 'product code', 'item'],
  barcode: ['barcode', 'bar code', 'ean', 'upc'],
  name: ['name', 'item name', 'product', 'product name', 'description', 'particulars', 'goods'],
  brand: ['brand', 'company', 'make'],
  category: ['category', 'group', 'type'],
  subcategory: ['subcategory', 'sub category', 'sub-category'],
  hsn: ['hsn', 'hsn code', 'hsn/sac', 'sac'],
  unit: ['unit', 'uom'],
  mrp: ['mrp', 'rate', 'list price', 'price', 'm.r.p'],
  discountPercent: ['discount %', 'discount', 'disc', 'disc%', 'discount%', 'discount percent'],
  gstPercent: ['gst %', 'gst', 'tax', 'gst%', 'gst rate', 'tax %'],
  purchasePrice: ['purchase price', 'purchase rate', 'cost', 'cost price', 'buy price', 'purchase'],
  stockQty: ['stock', 'qty', 'quantity', 'stock qty', 'opening stock', 'closing stock'],
  lowStockAlert: ['low stock alert', 'min stock', 'alert qty', 'reorder'],
  notes: ['notes', 'note', 'remark', 'remarks'],
}

class ItemIndex {
  private rows: string[][] = []
  private map = new Map<string, number>()

  setRows(rows: string[][]): void {
    this.rows = rows
  }

  setHeader(cells: string[]): void {
    cells.forEach((c, idx) => {
      const key = c.trim().toLowerCase().replace(/\s+/g, ' ')
      this.map.set(key, idx)
      Object.entries(ALIASES).forEach(([field, list]) => {
        if (list.includes(key)) this.map.set('$' + field, idx)
      })
    })
  }

  value(row: string[], field: string): string {
    const idx = this.map.get('$' + field)
    return idx == null ? '' : (row[idx] ?? '').trim()
  }

  hasHeader(): boolean {
    return this.map.has('$code') || this.map.has('$name') || this.map.has('$mrp')
  }

  positional(row: string[], field: string): string {
    // Code,Name,Brand,Category,Subcategory,MRP,Discount,GST,SalePrice,Notes (Android app order)
    const order = ['code', 'name', 'brand', 'category', 'subcategory', 'mrp', 'discountPercent', 'gstPercent', 'salePrice', 'notes']
    const idx = order.indexOf(field)
    return idx >= 0 ? (row[idx] ?? '').trim() : ''
  }

  all(): string[][] {
    return this.rows
  }
}

export function parseItemsCsv(text: string): ParsedItems {
  const rows = parseCsvText(text)
  const warnings: string[] = []
  const items: Omit<Item, 'id'>[] = []
  if (!rows.length) return { items, warnings: ['File khaali hai / file is empty'] }

  const idx = new ItemIndex()
  const headerRow = rows[0].map((c) => c.trim().toLowerCase())
  const looksLikeHeader = headerRow.some((c) => /^(code|name|item|product|particulars|mrp|rate)/.test(c))
  if (looksLikeHeader) {
    idx.setHeader(rows[0])
    idx.setRows(rows.slice(1))
  } else {
    idx.setRows(rows)
  }
  const usingHeader = idx.hasHeader()

  idx.all().forEach((row, i) => {
    const get = (f: string) => (usingHeader ? idx.value(row, f) : idx.positional(row, f))
    const name = get('name')
    const code = get('code') || (name ? name.slice(0, 10).toUpperCase().replace(/\s+/g, '-') : '')
    if (!name && !code) return
    const mrp = toNum(get('mrp'))
    if (mrp <= 0 && !usingHeader) warnings.push(`Row ${i + 1}: MRP missing`)
    items.push({
      name: name || code,
      code: code || `ITEM-${Date.now().toString(36).slice(-5)}-${i}`,
      barcode: get('barcode'),
      brand: get('brand') || 'Local',
      category: get('category') || 'Other',
      subcategory: get('subcategory'),
      hsn: get('hsn'),
      unit: (get('unit') || 'PCS').toUpperCase(),
      mrp: round2(mrp),
      discountPercent: round2(toNum(get('discountPercent'))),
      gstPercent: get('gstPercent') ? round2(toNum(get('gstPercent'))) : 18,
      purchasePrice: round2(toNum(get('purchasePrice'))),
      stockQty: Math.round(toNum(get('stockQty'), 0) * 1_000_000) / 1_000_000,
      lowStockAlert: Math.round(toNum(get('lowStockAlert'), 5)),
      notes: get('notes'),
      updatedAt: Date.now(),
    })
  })

  if (!items.length) warnings.push('Ek bhi valid row nahi mili / no valid rows found')
  return { items, warnings }
}

// ---------------- Invoices export ----------------

export function invoicesToCsv(invoices: Invoice[], biz: Business): string {
  const head = [
    'Doc Type', 'Number', 'Date', 'Party', 'Phone', 'GSTIN', 'Place of Supply',
    'Items', 'Qty', 'Taxable', 'CGST', 'SGST', 'IGST', 'Round Off', 'Total',
    'Paid', 'Due', 'Status', 'Profit',
  ]
  const rows = invoices.map((inv) => {
    const t = computeTotals(inv, biz.stateCode)
    return [
      docMeta(inv.docType).label,
      inv.number,
      fmtDate(inv.date),
      inv.partyName || 'Cash Sale',
      inv.partyPhone ?? '',
      inv.partyGstin ?? '',
      inv.placeOfSupply ?? '',
      String(inv.items.length),
      num(t.totalQty, 0),
      t.taxableNet.toFixed(2),
      t.cgst.toFixed(2),
      t.sgst.toFixed(2),
      t.igst.toFixed(2),
      t.roundOff.toFixed(2),
      t.grandTotal.toFixed(2),
      t.paid.toFixed(2),
      t.due.toFixed(2),
      inv.status === 'CANCELLED' ? 'CANCELLED' : t.due <= 0.5 ? 'PAID' : t.paid > 0 ? 'PARTIAL' : 'DUE',
      t.profit.toFixed(2),
    ]
  })
  return [head, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n')
}

export const itemsTemplateCsv = (): string =>
  [
    ['Code', 'Barcode', 'Name', 'Brand', 'Category', 'Subcategory', 'HSN', 'Unit', 'MRP', 'Discount %', 'GST %', 'Purchase Price', 'Stock', 'Low Stock Alert', 'Notes'],
    ['HW-1001', '8901234567890', 'Wall Mixer 3-in-1', 'Hindware', 'CP', 'Mixer', '8481', 'PCS', '10000', '35', '18', '5000', '10', '2', 'Chrome finish'],
  ]
    .map((r) => r.map(csvEscape).join(','))
    .join('\n')
