// ---------- Core domain types (MyBillBook style GST billing) ----------

export type DocType =
  | 'TAX_INVOICE'
  | 'ESTIMATE'
  | 'PROFORMA'
  | 'DELIVERY_CHALLAN'
  | 'BILL_OF_SUPPLY'
  | 'CREDIT_NOTE'
  | 'PURCHASE'

export interface DocMeta {
  key: DocType
  label: string
  hi: string
  icon: string
  prefix: string
  /** Final/commercial document (counts in sales registers & party balance) */
  isSale: boolean
  /** Reduces stock on save */
  stockOut: boolean
  /** Adds stock back (returns) */
  stockIn: boolean
  /** No GST columns (Bill of Supply) */
  noTax: boolean
  /** Amount is subtracted in party balance / sales */
  negative: boolean
  /** Supplier bill — stock IN and payable to the supplier */
  isPurchase: boolean
  color: string
}

export const DOC_TYPES: DocMeta[] = [
  {
    key: 'TAX_INVOICE',
    label: 'Tax Invoice',
    hi: 'पक्का बिल (GST)',
    icon: '🧾',
    prefix: 'INV',
    isSale: true,
    stockOut: true,
    stockIn: false,
    noTax: false,
    negative: false,
    isPurchase: false,
    color: 'bg-brand-600',
  },
  {
    key: 'ESTIMATE',
    label: 'Estimate / Quotation',
    hi: 'कोटेशन / अनुमान',
    icon: '📝',
    prefix: 'EST',
    isSale: false,
    stockOut: false,
    stockIn: false,
    noTax: false,
    negative: false,
    isPurchase: false,
    color: 'bg-indigo-500',
  },
  {
    key: 'PROFORMA',
    label: 'Proforma Invoice',
    hi: 'प्रोफार्मा बिल',
    icon: '📄',
    prefix: 'PRO',
    isSale: false,
    stockOut: false,
    stockIn: false,
    noTax: false,
    negative: false,
    isPurchase: false,
    color: 'bg-sky-600',
  },
  {
    key: 'DELIVERY_CHALLAN',
    label: 'Delivery Challan',
    hi: 'डिलीवरी चालान',
    icon: '🚚',
    prefix: 'DC',
    isSale: false,
    stockOut: true,
    stockIn: false,
    noTax: false,
    negative: false,
    isPurchase: false,
    color: 'bg-teal-600',
  },
  {
    key: 'BILL_OF_SUPPLY',
    label: 'Bill of Supply',
    hi: 'बिल ऑफ़ सप्लाई (बिना GST)',
    icon: '🧮',
    prefix: 'BOS',
    isSale: true,
    stockOut: true,
    stockIn: false,
    noTax: true,
    negative: false,
    isPurchase: false,
    color: 'bg-slate-700',
  },
  {
    key: 'CREDIT_NOTE',
    label: 'Credit Note / Return',
    hi: 'क्रेडिट नोट / माल वापसी',
    icon: '↩️',
    prefix: 'CN',
    isSale: false,
    stockOut: false,
    stockIn: true,
    noTax: false,
    negative: true,
    isPurchase: false,
    color: 'bg-rose-600',
  },
  {
    key: 'PURCHASE',
    label: 'Purchase Bill',
    hi: 'खरीद बिल (supplier)',
    icon: '📥',
    prefix: 'PUR',
    isSale: false,
    stockOut: false,
    stockIn: true,
    noTax: false,
    negative: false,
    isPurchase: true,
    color: 'bg-emerald-700',
  },
]

export const docMeta = (t: DocType): DocMeta =>
  DOC_TYPES.find((d) => d.key === t) ?? DOC_TYPES[0]

export type PaymentMode = 'CASH' | 'UPI' | 'CARD' | 'BANK' | 'CHEQUE' | 'OTHER'

export const PAYMENT_MODES: { key: PaymentMode; label: string; hi: string }[] = [
  { key: 'CASH', label: 'Cash', hi: 'नकद' },
  { key: 'UPI', label: 'UPI', hi: 'यूपीआई' },
  { key: 'CARD', label: 'Card', hi: 'कार्ड' },
  { key: 'BANK', label: 'Bank Transfer', hi: 'बैंक' },
  { key: 'CHEQUE', label: 'Cheque', hi: 'चेक' },
  { key: 'OTHER', label: 'Other', hi: 'अन्य' },
]

export interface Business extends SyncRecord {
  isPlaceholder?: boolean
  id?: number
  name: string
  tagline?: string
  address: string
  phone: string
  email?: string
  gstin?: string
  /** GST state code of the shop, e.g. '08' = Rajasthan */
  stateCode: string
  stateName: string
  upiId?: string
  bankName?: string
  bankAccount?: string
  bankIfsc?: string
  logoDataUrl?: string
  signatureDataUrl?: string
  terms: string
}

export interface SyncRecord {
  syncId?: string
  updatedAt?: number
}

export interface Item extends SyncRecord {
  isPlaceholder?: boolean
  id?: number
  name: string
  code: string
  barcode?: string
  brand: string
  category: string
  subcategory?: string
  hsn?: string
  unit: string
  mrp: number
  discountPercent: number
  gstPercent: number
  purchasePrice: number
  stockQty: number
  stockOpening?: number
  stockAdjustments?: Record<string, number>
  lowStockAlert: number
  notes?: string
  updatedAt: number
}

export interface LineItem {
  id: string
  itemId?: number
  name: string
  code: string
  barcode?: string
  brand?: string
  hsn?: string
  unit: string
  qty: number
  /** List rate / MRP */
  rate: number
  discountPercent: number
  gstPercent: number
  /** cost snapshot, used for profit reports */
  costPrice: number
}

export interface PaymentEntry {
  id: string
  date: string
  amount: number
  mode: PaymentMode
  note?: string
}

export interface ExtraCharge {
  label: string
  amount: number
}

export type PartyType = 'CUSTOMER' | 'SUPPLIER'

export interface Party extends SyncRecord {
  id?: number
  type: PartyType
  name: string
  phone?: string
  gstin?: string
  address?: string
  state?: string
  /** Positive = party owes the shop (receivable) */
  openingBalance: number
  createdAt: number
}

export interface Invoice extends SyncRecord {
  id?: number
  docType: DocType
  number: string
  date: string
  dueDate?: string
  partyId?: number
  partyName: string
  partyPhone?: string
  partyGstin?: string
  partyAddress?: string
  placeOfSupply: string
  items: LineItem[]
  billDiscountType: 'PERCENT' | 'AMOUNT'
  billDiscountValue: number
  extraCharges: ExtraCharge[]
  roundOffEnabled: boolean
  transportName?: string
  vehicleNo?: string
  eWayBill?: string
  poNumber?: string
  notes?: string
  /** Terms printed at the bottom of the bill */
  terms?: string
  status: 'FINAL' | 'CANCELLED'
  payments: PaymentEntry[]
  removedPaymentIds?: string[]
  /** Documents created from this one (e.g. estimate → tax invoice) */
  convertedToId?: number
  /** Source document this was created from */
  fromId?: number
  createdAt: number
  updatedAt: number
}

export interface DocSetting extends SyncRecord {
  docType: DocType
  prefix: string
  /** include financial year in the number: INV/25-26/001 */
  includeFy: boolean
  nextNumber: number
  digits: number
  terms: string
  enabled: boolean
}

export interface AppSetting extends SyncRecord {
  key: string
  value: string
}

// ---------- Invoice computed totals ----------

export interface LineTotals {
  gross: number
  discount: number
  taxable: number
  taxableAfterBillDiscount: number
  tax: number
  total: number
}

export interface InvoiceTotals {
  lines: LineTotals[]
  gross: number
  lineDiscount: number
  taxable: number
  billDiscount: number
  taxableNet: number
  tax: number
  cgst: number
  sgst: number
  igst: number
  interState: boolean
  charges: number
  beforeRound: number
  roundOff: number
  grandTotal: number
  totalQty: number
  paid: number
  due: number
  costTotal: number
  profit: number
}

// ---------- GST state codes ----------

export const STATES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
]

export const stateName = (code?: string): string =>
  STATES.find((s) => s.code === code)?.name ?? ''

export const UNITS = ['PCS', 'NOS', 'SET', 'BOX', 'KG', 'MTR', 'LTR', 'SQFT', 'PKT', 'BAG', 'BUNDLE', 'PAIR']
export const GST_RATES = [0, 5, 12, 18, 28]

// ---------- Khata / payments / expenses ----------

export type PaymentDirection = 'IN' | 'OUT'

/** Standalone party payment (advance / on-account / supplier payment) */
export interface PartyPayment extends SyncRecord {
  id?: number
  date: string
  /** IN = paisa aaya (customer se), OUT = paisa diya (supplier ko) */
  direction: PaymentDirection
  partyId?: number
  partyName: string
  amount: number
  mode: PaymentMode
  note?: string
  createdAt: number
}

export interface Expense extends SyncRecord {
  id?: number
  date: string
  category: string
  amount: number
  mode: PaymentMode
  paidTo?: string
  note?: string
  createdAt: number
}

export const EXPENSE_CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: 'Rent', label: 'Dukan ka kiraya', icon: '🏠' },
  { key: 'Salary', label: 'Staff / salary', icon: '👷' },
  { key: 'Bijli/Mobile', label: 'Bijli, mobile, internet', icon: '💡' },
  { key: 'Transport', label: 'Transport / bhada', icon: '🚚' },
  { key: 'Packing', label: 'Packing material', icon: '📦' },
  { key: 'Marketing', label: 'Marketing / banner', icon: '📣' },
  { key: 'Repair', label: 'Repair / maintenance', icon: '🔧' },
  { key: 'Tea/Other', label: 'Chai-paani, misc', icon: '☕' },
  { key: 'Other', label: 'Other kharcha', icon: '🧾' },
]

export interface AgingBucket {
  partyId?: number
  partyName: string
  phone?: string
  d0_30: number
  d31_60: number
  d61_90: number
  d90plus: number
  total: number
  oldestDays: number
}
