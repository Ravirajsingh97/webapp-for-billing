// ---------- Formatting helpers (Indian money, dates, words) ----------

const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const quantity = (n: number): string => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 6 }).format(Number.isFinite(n) ? n : 0)

/** 12500.5 → ₹12,500.50 */
export const money = (n: number, decimals = 2): string => {
  const v = Number.isFinite(n) ? n : 0
  return (v < 0 ? '-₹' : '₹') + (decimals === 0 ? inr0.format(Math.abs(v)) : inr2.format(Math.abs(v)))
}

/** plain number without rupee symbol */
export const num = (n: number, decimals = 2): string => {
  const v = Number.isFinite(n) ? n : 0
  return decimals === 0 ? inr0.format(Math.round(v)) : inr2.format(v)
}

export const round2 = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
export const round0 = (n: number): number => Math.round(Number.isFinite(n) ? n : 0)

export const uid = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 9)

// ---------- Dates (stored as yyyy-mm-dd strings) ----------

export const todayISO = (d: Date = new Date()): string => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return z.toISOString().slice(0, 10)
}

export const parseISO = (iso: string): Date => {
  const [y, m, d] = (iso || todayISO()).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** '2026-10-02' → '02 Oct 2026' */
export const fmtDate = (iso: string, style: 'short' | 'long' | 'num' = 'short'): string => {
  if (!iso) return ''
  const d = parseISO(iso)
  if (style === 'num') return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
  const month = d.toLocaleString('en-IN', { month: style === 'long' ? 'long' : 'short' })
  return `${String(d.getDate()).padStart(2, '0')} ${month} ${d.getFullYear()}`
}

export const addDays = (iso: string, days: number): string => {
  const d = parseISO(iso)
  d.setDate(d.getDate() + days)
  return todayISO(d)
}

export const monthStart = (d: Date = new Date()): string => todayISO(new Date(d.getFullYear(), d.getMonth(), 1))
export const monthEnd = (d: Date = new Date()): string => todayISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))

/** Indian financial year label for a date: 2026-10-02 → '26-27' */
export const financialYear = (iso: string): string => {
  const d = parseISO(iso)
  const y = d.getFullYear()
  const startYear = d.getMonth() >= 3 ? y : y - 1
  return `${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`
}

export const fyRange = (iso: string): { from: string; to: string } => {
  const d = parseISO(iso)
  const y = d.getFullYear()
  const startYear = d.getMonth() >= 3 ? y : y - 1
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` }
}

export const lastNDays = (n: number): { from: string; to: string } => {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - (n - 1))
  return { from: todayISO(from), to: todayISO(to) }
}

export const daysBetween = (a: string, b: string): number =>
  Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000)

// ---------- Phone / WhatsApp ----------

export const cleanPhone = (raw?: string): string => {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (digits.length === 10) return '91' + digits
  if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1)
  if (digits.length === 12 && digits.startsWith('91')) return digits
  return digits
}

export const waLink = (phone: string | undefined, text: string): string => {
  const p = cleanPhone(phone)
  const q = encodeURIComponent(text)
  return p ? `https://wa.me/${p}?text=${q}` : `https://wa.me/?text=${q}`
}

// ---------- Amount in words (Indian system) ----------

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

/** 430 → "Four Hundred and Thirty", 45 → "Forty Five", 7 → "Seven" */
const under1000 = (n: number): string => {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  const restWords =
    rest === 0 ? '' : rest < 20 ? ONES[rest] : TENS[Math.floor(rest / 10)] + (rest % 10 ? ' ' + ONES[rest % 10] : '')
  if (hundreds && restWords) return `${ONES[hundreds]} Hundred and ${restWords}`
  if (hundreds) return `${ONES[hundreds]} Hundred`
  return restWords
}

export const amountInWords = (amount: number): string => {
  const rupees = Math.floor(Math.abs(amount))
  const paise = Math.round((Math.abs(amount) - rupees) * 100)
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only'
  let n = rupees
  const parts: string[] = []
  const crore = Math.floor(n / 10000000)
  n %= 10000000
  const lakh = Math.floor(n / 100000)
  n %= 100000
  const thousand = Math.floor(n / 1000)
  n %= 1000
  if (crore) parts.push(under1000(crore) + ' Crore')
  if (lakh) parts.push(under1000(lakh) + ' Lakh')
  if (thousand) parts.push(under1000(thousand) + ' Thousand')
  if (n) parts.push(under1000(n))
  const words = parts.join(' ').replace(/\s+/g, ' ').trim()
  let out = 'Rupees ' + words
  if (paise > 0) out += ' and ' + under1000(paise) + ' Paise'
  return out + ' Only'
}

// ---------- Misc ----------

export const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max)

export const pct = (n: number): string => `${round2(n)}%`

export const download = (filename: string, content: string, type = 'text/csv;charset=utf-8'): void => {
  const blob = new Blob(['\ufeff' + content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(r.error)
    r.readAsText(file)
  })

export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
