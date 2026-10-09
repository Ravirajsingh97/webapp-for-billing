import { uid } from './format'
import type { LineItem } from './types'

/** Conservative suggestions only: name, quantity, rate, matching pre-tax amount. */
export function suggestPurchaseLines(text: string): LineItem[] {
  const amount = '(\\d[\\d,]*(?:\\.\\d{1,2})?)'
  const row = new RegExp(`^(.+?)\\s+${amount}\\s+(?:[x×]\\s*)?${amount}\\s+${amount}$`, 'i')
  return text.split(/\r?\n/).flatMap(raw => {
    const match = raw.trim().match(row)
    if (!match || /\b(total|tax|gst|balance|discount|paid|invoice|bill|date|round|amount|shipping|freight)\b/i.test(match[1])) return []
    const [qty, rate, sum] = match.slice(2).map(v => Number(v.replaceAll(',', '')))
    if (![qty, rate, sum].every(Number.isFinite) || qty <= 0 || rate < 0 || Math.abs(qty * rate - sum) > 0.02) return []
    return [{ id: uid(), name: match[1].trim(), code: '', unit: 'PCS', qty, rate, discountPercent: 0, gstPercent: 0, costPrice: rate }]
  })
}
