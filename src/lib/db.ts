import { newSyncId, type Tombstone } from './syncIdentity'
import Dexie, { type Table } from 'dexie'
import type { User } from './auth'
import type {
  AppSetting,
  Business,
  DocSetting,
  DocType,
  Expense,
  Invoice,
  Item,
  Party,
  PartyPayment,
} from './types'
import { DOC_TYPES } from './types'
import { activeCompany, activeCompanyId, dbNameFor } from './company'

export class ShowroomDB extends Dexie {
  business!: Table<Business, number>
  items!: Table<Item, number>
  parties!: Table<Party, number>
  invoices!: Table<Invoice, number>
  docSettings!: Table<DocSetting, string>
  appSettings!: Table<AppSetting, string>
  payments!: Table<PartyPayment, number>
  expenses!: Table<Expense, number>
  users!: Table<User, number>
  tombstones!: Table<Tombstone, string>

  constructor(name: string = dbNameFor(activeCompanyId())) {
    // Har company ka apna database (firm switch = alag data)
    super(name)
    this.version(1).stores({
      business: '++id',
      items: '++id, name, code, barcode, brand, category, updatedAt',
      parties: '++id, name, phone, type, createdAt',
      invoices:
        '++id, docType, number, date, partyId, partyName, status, createdAt, [docType+date], [date+status]',
      docSettings: 'docType',
      appSettings: 'key',
    })
    // v2: khata payments (payment in/out) + expenses
    this.version(2).stores({
      payments: '++id, date, direction, partyId, mode, createdAt',
      expenses: '++id, date, category, mode, createdAt',
    })
    // v3: users + login (company ke apne staff)
    this.version(3).stores({
      users: '++id, name, role, createdAt',
    })
    this.version(4).stores({ tombstones: 'key, table, deletedAt' })
    // Preserve supplied identities on restore/sync; assign new identities to new local records.
    for (const name of ['items', 'parties', 'invoices', 'payments', 'expenses']) {
      this.table(name).hook('creating', (_key, row) => {
        if (!row.syncId) row.syncId = newSyncId()
      })
    }
  }
}

export const db = new ShowroomDB()

// Cloud sync me doosri companies ke database kholne padte hain
const dbCache = new Map<string, ShowroomDB>()

export function dbFor(companyId: string): ShowroomDB {
  const name = dbNameFor(companyId)
  if (name === db.name) return db
  let inst = dbCache.get(name)
  if (!inst) {
    inst = new ShowroomDB(name)
    dbCache.set(name, inst)
  }
  return inst
}

export const DEFAULT_TERMS =
  '1. Goods once sold will not be taken back or exchanged.\n2. Warranty as per manufacturer terms.\n3. Subject to local jurisdiction.'

export const DEFAULT_BUSINESS: Business = {
  name: 'My Showroom',
  tagline: 'Sanitaryware • CP Fittings • Tiles',
  address: 'Main Market, Jaipur, Rajasthan',
  phone: '',
  gstin: '',
  stateCode: '08',
  stateName: 'Rajasthan',
  upiId: '',
  terms: DEFAULT_TERMS,
}

const DEFAULT_DOC_SETTINGS: DocSetting[] = DOC_TYPES.map((d) => ({
  docType: d.key,
  prefix: d.prefix,
  includeFy: true,
  nextNumber: 1,
  digits: 3,
  terms: DEFAULT_TERMS,
  enabled: true,
}))

// ---------- Sample catalogue (first run only — mirrors the Android app seed) ----------

const SAMPLE_ITEMS: Omit<Item, 'id'>[] = [
  ['HW-1234', 'Wall Mixer 3-in-1 with Overhead Shower Provision', 'Hindware', 'CP', 'Mixer', '8481', 10000, 35, 18, 5000, 24],
  ['HW-2201', 'Single Lever Basin Mixer — Contessa Chrome', 'Hindware', 'CP', 'Faucet', '8481', 6450, 32, 18, 3300, 18],
  ['HW-3310', 'Wall Hung EWC with Soft Close Seat Cover', 'Hindware', 'Sanitary', 'WC', '6910', 21500, 30, 18, 12500, 8],
  ['HW-4102', 'Table Top Wash Basin 20 inch', 'Hindware', 'Sanitary', 'Basin', '6910', 5400, 28, 18, 2900, 14],
  ['JQ-5560', 'Concealed Diverter 4-way with Trim', 'Jaquar', 'CP', 'Diverter', '8481', 12800, 30, 18, 7400, 10],
  ['JQ-6021', 'Rain Shower Arm & Head 200mm', 'Jaquar', 'CP', 'Shower', '8481', 7900, 33, 18, 4100, 16],
  ['JQ-7710', 'Health Faucet with 1m Hose & Hook', 'Jaquar', 'CP', 'Faucet', '8481', 2450, 30, 18, 1250, 40],
  ['CE-8801', 'Ceramic Wall Tile 300x600 Glossy (Box of 6)', 'Cera', 'Bath Fittings', 'Tile', '6907', 1150, 22, 18, 640, 55],
  ['CE-9012', 'Pedestal Wash Basin Pearl White', 'Cera', 'Sanitary', 'Basin', '6910', 4200, 25, 18, 2200, 12],
  ['AC-1010', 'Stainless Steel Towel Rail 24 inch', 'Local Supplier', 'Accessories', 'Towel Rail', '7324', 1650, 30, 18, 780, 30],
  ['AC-1120', 'Toilet Paper Holder with Cover', 'Local Supplier', 'Accessories', 'Paper Holder', '7324', 890, 28, 18, 410, 45],
  ['KT-2200', 'Kitchen Sink Single Bowl SS 304 (24x18)', 'Hindware', 'Kitchen', 'Kitchen Sink', '7324', 8900, 30, 18, 4600, 9],
  ['HD-3300', 'Stainless Steel Door Handle 8 inch (Pair)', 'Local Supplier', 'Hardware', 'Handle', '8302', 1250, 30, 18, 620, 60],
  ['EX-4400', 'Tile Adhesive 20 kg Bag', 'Local Supplier', 'Other', 'Tile Adhesive', '3506', 620, 12, 18, 430, 80],
  ['EX-4501', 'Teflon Tape (Pack of 10)', 'Local Supplier', 'Other', 'Teflon Tape', '3919', 150, 10, 18, 78, 120],
].map((r) => {
  const [code, name, brand, category, subcategory, hsn, mrp, discountPercent, gstPercent, purchasePrice, stockQty] =
    r as [string, string, string, string, string, string, number, number, number, number, number]
  return {
    code,
    name,
    brand,
    category,
    subcategory,
    hsn,
    unit: 'PCS',
    mrp,
    discountPercent,
    gstPercent,
    purchasePrice,
    stockQty,
    isPlaceholder: true,
    stockOpening: stockQty,
    syncId: `seed:${code}`,
    lowStockAlert: 5,
    barcode: '',
    notes: '',
    updatedAt: 0,
  } satisfies Omit<Item, 'id'>
})

export async function seedDatabase(): Promise<void> {
  await db.open()
  const company = activeCompany()
  const businessCount = await db.business.count()
  if (businessCount === 0) await db.business.add({ ...DEFAULT_BUSINESS, name: company.name, isPlaceholder: true, updatedAt: 0 })

  // make sure every document type has a number series (also adds newly introduced types)
  for (const def of DEFAULT_DOC_SETTINGS) {
    const existing = await db.docSettings.get(def.docType)
    if (!existing) await db.docSettings.put({ ...def })
  }

  // Sample items sirf pehli (default) company me — nayi company khaali shuru hoti hai
  const itemCount = await db.items.count()
  if (itemCount === 0 && company.id === 'default' && await db.tombstones.where('table').equals('items').count() === 0) await db.items.bulkAdd(SAMPLE_ITEMS as Item[])

  const defaults: AppSetting[] = [
    { key: 'onboarded', value: 'no' },
    { key: 'defaultDocType', value: 'TAX_INVOICE' },
    { key: 'autoRoundOff', value: 'yes' },
    { key: 'defaultGst', value: '18' },
    { key: 'printMode', value: 'a4' },
    { key: 'waGreeting', value: 'Namaste! Aapke bill ke liye dhanyavaad 🙏' },
    { key: 'lowStockOnly', value: 'no' },
  ]
  for (const d of defaults) {
    const existing = await db.appSettings.get(d.key)
    if (!existing) await db.appSettings.put(d)
  }
}

export const getSetting = async (key: string): Promise<string> => (await db.appSettings.get(key))?.value ?? ''
export const setSetting = (key: string, value: string) => db.appSettings.put({ key, value, updatedAt: Date.now() })

export const getBusiness = async (): Promise<Business> =>
  (await db.business.toCollection().first()) ?? { ...DEFAULT_BUSINESS }

export const getDocSetting = async (docType: DocType): Promise<DocSetting> =>
  (await db.docSettings.get(docType)) ??
  DEFAULT_DOC_SETTINGS.find((d) => d.docType === docType) ?? {
    docType,
    prefix: 'DOC',
    includeFy: true,
    nextNumber: 1,
    digits: 3,
    terms: DEFAULT_TERMS,
    enabled: true,
  }
