import type { Business, DocType, Invoice, InvoiceTotals } from './types'
import { docMeta } from './types'
import { amountInWords, fmtDate, money, num, round2, todayISO } from './format'

/** UPI deep link / QR payload for "Scan & Pay" */
export const upiUri = (opts: {
  upiId: string
  payeeName: string
  amount: number
  note?: string
}): string => {
  const params = new URLSearchParams()
  params.set('pa', opts.upiId)
  params.set('pn', opts.payeeName)
  if (opts.amount > 0) params.set('am', opts.amount.toFixed(2))
  params.set('cu', 'INR')
  if (opts.note) params.set('tn', opts.note)
  return `upi://pay?${params.toString()}`
}

export const invoiceLabel = (inv: Pick<Invoice, 'docType'>): string => docMeta(inv.docType).label

export const shortDocName = (docType: DocType): string =>
  ({
    TAX_INVOICE: 'Invoice',
    ESTIMATE: 'Estimate',
    PROFORMA: 'Proforma',
    DELIVERY_CHALLAN: 'Challan',
    BILL_OF_SUPPLY: 'Bill of Supply',
    CREDIT_NOTE: 'Credit Note',
    PURCHASE: 'Purchase',
  })[docType]

/** WhatsApp / SMS friendly bill message */
export function invoiceText(inv: Invoice, biz: Business, t: InvoiceTotals): string {
  const meta = docMeta(inv.docType)
  const lines: string[] = []
  lines.push(`*${biz.name.toUpperCase()}*`)
  if (biz.address) lines.push(`📍 ${biz.address}`)
  if (biz.phone) lines.push(`📞 ${biz.phone}`)
  if (biz.gstin) lines.push(`🧾 GSTIN: ${biz.gstin}`)
  lines.push('━━━━━━━━━━━━━━━━')
  lines.push(`*${meta.label.toUpperCase()}*`)
  lines.push(`No: *${inv.number}*`)
  lines.push(`Date: ${fmtDate(inv.date)}`)
  if (inv.partyName) lines.push(`Party: *${inv.partyName}*`)
  if (inv.partyPhone) lines.push(`Phone: ${inv.partyPhone}`)
  lines.push('━━━━━━━━━━━━━━━━')
  inv.items.forEach((l, i) => {
    lines.push(`${i + 1}. *${l.name}*`)
    lines.push(
      `   ${num(l.qty, 0)} ${l.unit} × ${money(l.rate)}${l.discountPercent ? `  (-${num(l.discountPercent, 0)}%)` : ''} = *${money(t.lines[i]?.total ?? 0)}*`,
    )
  })
  lines.push('━━━━━━━━━━━━━━━━')
  if (t.lineDiscount + t.billDiscount > 0) {
    lines.push(`Discount: -${money(round2(t.lineDiscount + t.billDiscount))}`)
  }
  lines.push(`Taxable: ${money(t.taxableNet)}`)
  if (t.tax > 0) {
    lines.push(
      t.interState
        ? `IGST: ${money(t.igst)}`
        : `CGST: ${money(t.cgst)} + SGST: ${money(t.sgst)}`,
    )
  }
  if (Math.abs(t.roundOff) >= 0.01) lines.push(`Round off: ${t.roundOff > 0 ? '+' : ''}${money(t.roundOff)}`)
  lines.push(`⭐ *TOTAL: ${money(t.grandTotal)}*`)
  lines.push(`_( ${amountInWords(t.grandTotal)} )_`)
  if (t.paid > 0) lines.push(`✅ Paid: ${money(t.paid)}`)
  if (t.due > 0.5) lines.push(`🔴 *Baki (Due): ${money(t.due)}*`)
  if (t.due > 0.5 && biz.upiId) lines.push(`💳 UPI: ${biz.upiId}`)
  if (inv.notes) lines.push(`📝 ${inv.notes}`)
  lines.push('')
  lines.push('Dhanyavaad! 🙏')
  return lines.join('\n')
}

/** Short 1-line summary used in lists and reminders */
export const invoiceSummary = (inv: Invoice, t: InvoiceTotals): string =>
  `${inv.partyName || 'Cash Sale'} • ${money(t.grandTotal)}${t.due > 0.5 ? ` • Baki ${money(t.due)}` : ''}`

export const fileBaseName = (inv: Invoice, biz: Business): string =>
  `${biz.name.replace(/[^\w]+/g, '-').slice(0, 18)}-${inv.number.replace(/[^\w-]+/g, '-')}-${inv.partyName.replace(/[^\w]+/g, '').slice(0, 12) || 'Cash'}`

export const dueLabel = (inv: Invoice): string => {
  if (!inv.dueDate) return ''
  const d = inv.dueDate
  return d < todayISO() ? `Overdue • ${fmtDate(d)}` : `Due ${fmtDate(d)}`
}
