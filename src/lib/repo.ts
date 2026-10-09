import { requireOwnerIfConfigured, requireUnlocked } from './auth'
import { initializeInventory, reconcileInventory, roundStock } from './inventory'
import { mergeSnapshot } from './sync'
import type { Table } from 'dexie'
import { SYNC_TABLES, detachMissingReferences, normalizeTombstone, newSyncId, recordIdentity, tombstoneKey, type SyncTableName, type SyncRow } from './syncIdentity'
import { db, DEFAULT_TERMS, getBusiness, getDocSetting, setSetting } from './db'
import { computeTotals } from './calc'
import { daysBetween, financialYear, round2, todayISO, uid } from './format'
import type {
  AgingBucket,
  DocSetting,
  DocType,
  Expense,
  Invoice,
  Item,
  LineItem,
  Party,
  PartyPayment,
  PaymentDirection,
  PaymentEntry,
  PaymentMode,
} from './types'
import { docMeta } from './types'

// ---------------- Numbering ----------------

export const formatDocNumber = (s: DocSetting, date: string, n: number): string => {
  const serial = String(n).padStart(Math.max(1, s.digits), '0')
  return s.includeFy ? `${s.prefix}/${financialYear(date)}/${serial}` : `${s.prefix}/${serial}`
}

/** Preview of the next number (does not consume it) */
export async function peekNumber(docType: DocType, date: string): Promise<string> {
  const s = await getDocSetting(docType)
  return formatDocNumber(s, date, s.nextNumber)
}

async function allocateNumber(docType: DocType, date: string): Promise<string> {
  const s = await db.docSettings.get(docType)
  const setting: DocSetting = s ?? (await getDocSetting(docType))
  let nextNumber = setting.nextNumber
  let number = formatDocNumber(setting, date, nextNumber)
  while (await db.invoices.where('number').equals(number).filter((inv) => inv.docType === docType).count()) {
    number = formatDocNumber(setting, date, ++nextNumber)
  }
  await db.docSettings.put({ ...setting, nextNumber: nextNumber + 1, updatedAt: Date.now() })
  return number
}

// ---------------- Items ----------------

export const listItems = () => db.items.orderBy('name').toArray()

const nextStamp = (previous = 0) => Math.max(Date.now(), previous + 1)
const staleMessage = 'Ye record doosre tab/device par badal gaya hai. Band karke dobara kholein; aapke changes save nahi hue.'
const validNumber = (n: number, label: string, minimum = 0): void => {
  if (!Number.isFinite(n) || n < minimum) throw new Error(`${label}: valid amount/quantity likhein`)
}

export async function upsertItem(item: Item): Promise<number> {
  await requireUnlocked()
  for (const [label, value] of Object.entries({ MRP: item.mrp, Discount: item.discountPercent, GST: item.gstPercent, Cost: item.purchasePrice, Alert: item.lowStockAlert })) validNumber(value, label)
  validNumber(item.stockQty, 'Stock', -Infinity)
  if (item.discountPercent > 100 || item.gstPercent > 100) throw new Error('Percentage 0–100 honi chahiye')
  return db.transaction('rw', db.items, db.invoices, db.users, async () => {
    await requireUnlocked()
    const previous = item.id ? await db.items.get(item.id) : undefined
    if (item.id && !previous) throw new Error(staleMessage)
    if (previous && item.updatedAt !== previous.updatedAt) throw new Error(staleMessage)
    await reconcileInventory(db)
    const current = item.id ? await db.items.get(item.id) : undefined
    const rec: Item = { ...item, isPlaceholder: false, syncId: current?.syncId ?? item.syncId, updatedAt: nextStamp(current?.updatedAt) }
    if (current) {
      rec.stockOpening = current.stockOpening
      rec.stockAdjustments = { ...current.stockAdjustments }
      const delta = roundStock(item.stockQty - current.stockQty)
      if (delta) rec.stockAdjustments[newSyncId()] = delta
      await db.items.put(rec)
      return current.id!
    }
    rec.stockOpening = item.stockQty
    rec.stockAdjustments = {}
    const { id: _drop, ...rest } = rec
    void _drop
    return db.items.add(rest as Item)
  })
}

export const deleteItem = (id: number): Promise<void> => deleteRecord('items', id)

export async function adjustStock(itemId: number, delta: number): Promise<void> {
  await requireUnlocked()
  validNumber(delta, 'Stock adjustment', -Infinity)
  await db.transaction('rw', db.items, db.invoices, db.users, async () => {
    await requireUnlocked()
    await reconcileInventory(db)
    const item = await db.items.get(itemId)
    if (!item) return
    await db.items.update(itemId, { stockAdjustments: { ...item.stockAdjustments, [newSyncId()]: delta }, updatedAt: nextStamp(item.updatedAt) })
    await reconcileInventory(db)
  })
}

export async function findItemByCode(code: string): Promise<Item | undefined> {
  const c = code.trim().toLowerCase()
  if (!c) return undefined
  const items = await db.items.toArray()
  return items.find(
    (i) => i.code.toLowerCase() === c || (i.barcode ?? '').toLowerCase() === c,
  )
}

// ---------------- Parties ----------------

export const listParties = () => db.parties.orderBy('name').toArray()

export async function upsertParty(p: Party): Promise<number> {
  await requireUnlocked()
  const previous = p.id ? await db.parties.get(p.id) : undefined
  p = { ...p, syncId: previous?.syncId ?? p.syncId, updatedAt: Date.now() }
  if (p.id) {
    await db.parties.put(p)
    return p.id
  }
  const { id: _drop, ...rest } = p
  void _drop
  return db.parties.add(rest as Party)
}

export const deleteParty = (id: number): Promise<void> => deleteRecord('parties', id)

/** All invoices (final) of a party + outstanding balance */
export async function partyInvoices(partyId: number): Promise<Invoice[]> {
  const list = await db.invoices.where('partyId').equals(partyId).toArray()
  return list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
}

export async function balanceOf(
  partyId: number,
  shopState = '08',
): Promise<number> {
  const [party, invoices, payments] = await Promise.all([
    db.parties.get(partyId),
    db.invoices.where('partyId').equals(partyId).toArray(),
    db.payments.where('partyId').equals(partyId).toArray(),
  ])
  let bal = party?.openingBalance ?? 0
  for (const inv of invoices) {
    if (inv.status !== 'FINAL') continue
    const meta = docMeta(inv.docType)
    const net = computeTotals(inv, shopState).grandTotal - computeTotals(inv, shopState).paid
    if (meta.isSale) bal += net
    else if (meta.negative) bal -= net
    else if (meta.isPurchase) bal -= net
  }
  for (const p of payments) bal += p.direction === 'OUT' ? p.amount : -p.amount
  return round2(bal)
}

export async function allBalances(shopState = '08'): Promise<Map<number, number>> {
  const [parties, invoices, payments] = await Promise.all([
    db.parties.toArray(),
    db.invoices.toArray(),
    db.payments.toArray(),
  ])
  const map = new Map<number, number>()
  parties.forEach((p) => p.id && map.set(p.id, p.openingBalance || 0))
  invoices.forEach((inv) => {
    if (inv.status !== 'FINAL' || !inv.partyId || !map.has(inv.partyId)) return
    const meta = docMeta(inv.docType)
    const t = computeTotals(inv, shopState)
    const net = t.grandTotal - t.paid
    if (meta.isSale) map.set(inv.partyId, round2((map.get(inv.partyId) ?? 0) + net))
    else if (meta.negative) map.set(inv.partyId, round2((map.get(inv.partyId) ?? 0) - net))
    else if (meta.isPurchase) map.set(inv.partyId, round2((map.get(inv.partyId) ?? 0) - net))
  })
  payments.forEach((p) => {
    if (!p.partyId || !map.has(p.partyId)) return
    const delta = p.direction === 'OUT' ? p.amount : -p.amount
    map.set(p.partyId, round2((map.get(p.partyId) ?? 0) + delta))
  })
  return map
}

// ---------------- Invoices ----------------

const validDate = (value: string): void => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Valid date likhein')
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Valid date likhein')
}

export function validateInvoice(inv: Invoice): void {
  if (!inv.items?.length) throw new Error('Pehle ek item jodein')
  validDate(inv.date)
  for (const line of inv.items) {
    if (!line.name?.trim()) throw new Error('Item name likhein')
    validNumber(line.qty, 'Qty', Number.MIN_VALUE)
    for (const [label, value] of Object.entries({ Rate: line.rate, Discount: line.discountPercent, GST: line.gstPercent, Cost: line.costPrice })) validNumber(value, label)
    if (line.discountPercent > 100 || line.gstPercent > 100) throw new Error('Percentage 0–100 honi chahiye')
  }
  validNumber(inv.billDiscountValue, 'Bill discount')
  if (inv.billDiscountType === 'PERCENT' && inv.billDiscountValue > 100) throw new Error('Discount 0–100 honi chahiye')
  for (const charge of inv.extraCharges ?? []) validNumber(charge.amount, 'Extra charge')
  for (const payment of inv.payments ?? []) { validNumber(payment.amount, 'Payment', Number.MIN_VALUE); validDate(payment.date) }
}

export async function saveInvoice(inv: Invoice, shopState = '08'): Promise<number> {
  await requireUnlocked()
  void shopState
  validateInvoice(inv)
  return db.transaction('rw', db.invoices, db.docSettings, db.items, db.users, async () => {
    await requireUnlocked()
    let id = inv.id
    const existing = id ? await db.invoices.get(id) : undefined
    if (id && !existing) throw new Error(staleMessage)
    if (existing && existing.updatedAt !== inv.updatedAt) throw new Error(staleMessage)
    const now = nextStamp(existing?.updatedAt)
    await reconcileInventory(db)

    const number = inv.number?.trim() ? inv.number.trim() : await allocateNumber(inv.docType, inv.date)
    if (!existing || existing.number !== number || existing.docType !== inv.docType) {
      const duplicate = await db.invoices.where('number').equals(number).filter((other) => other.docType === inv.docType && other.id !== id).first()
      if (duplicate) throw new Error('Ye bill number pehle se hai; doosra number likhein')
    }
    const rec: Invoice = {
      ...inv,
      syncId: existing?.syncId ?? inv.syncId,
      number,
      status: inv.status ?? 'FINAL',
      createdAt: existing?.createdAt ?? inv.createdAt ?? now,
      updatedAt: now,
    }
    if (existing?.id) {
      await db.invoices.put({ ...rec, id: existing.id })
      id = existing.id
    } else {
      const { id: _drop, ...rest } = rec
      void _drop
      id = await db.invoices.add(rest as Invoice)
    }

    const saved = await db.invoices.get(id)
    if (saved) await reconcileInventory(db)

    // link converted document
    if (inv.fromId) {
      const source = await db.invoices.get(inv.fromId)
      if (!source || source.status !== 'FINAL') throw new Error('Source bill active nahi hai')
      if (source.docType === 'DELIVERY_CHALLAN' && inv.docType === 'TAX_INVOICE') {
        const conversions = await db.invoices.filter(i => i.fromId === inv.fromId && i.docType === 'TAX_INVOICE' && i.status === 'FINAL' && i.id !== id).count()
        if (conversions) throw new Error('Is challan ka invoice pehle se hai')
      }
      await db.invoices.update(inv.fromId, { convertedToId: id, updatedAt: nextStamp(source.updatedAt) })
    }
    return id
  })
}

export async function deleteInvoice(id: number): Promise<void> {
  await requireUnlocked()
  await db.transaction('rw', db.invoices, db.items, db.tombstones, db.users, async () => {
    await requireUnlocked()
    await reconcileInventory(db)
    await deleteRecord('invoices', id)
    await reconcileInventory(db)
  })
}

export async function cancelInvoice(id: number): Promise<void> {
  await requireUnlocked()
  await db.transaction('rw', db.invoices, db.items, db.users, async () => {
    await requireUnlocked()
    await reconcileInventory(db)
    const inv = await db.invoices.get(id)
    if (!inv) return
    await db.invoices.update(id, { status: 'CANCELLED', updatedAt: nextStamp(inv.updatedAt) })
    await reconcileInventory(db)
  })
}

export async function restoreInvoice(id: number): Promise<void> {
  await requireUnlocked()
  await db.transaction('rw', db.invoices, db.items, db.users, async () => {
    await requireUnlocked()
    await reconcileInventory(db)
    const inv = await db.invoices.get(id)
    if (!inv) return
    if (inv.fromId && inv.docType === 'TAX_INVOICE') {
      const source = await db.invoices.get(inv.fromId)
      if (source?.docType === 'DELIVERY_CHALLAN') {
        const duplicate = await db.invoices.filter(other => other.id !== id && other.fromId === inv.fromId && other.docType === 'TAX_INVOICE' && other.status === 'FINAL').count()
        if (duplicate) throw new Error('Is challan ka invoice pehle se hai')
      }
    }
    await db.invoices.update(id, { status: 'FINAL', updatedAt: nextStamp(inv.updatedAt) })
    await reconcileInventory(db)
  })
}

export async function recordPayment(invoiceId: number, payment: Omit<PaymentEntry, 'id'>): Promise<void> {
  await requireUnlocked()
  validNumber(payment.amount, 'Payment', Number.MIN_VALUE)
  validDate(payment.date)
  await db.transaction('rw', db.invoices, db.users, async () => {
    await requireUnlocked()
    const inv = await db.invoices.get(invoiceId)
    if (!inv || inv.status !== 'FINAL') throw new Error('Bill active nahi hai')
    await db.invoices.update(invoiceId, { payments: [...(inv.payments ?? []), { ...payment, id: uid() }], updatedAt: nextStamp(inv.updatedAt) })
  })
}

export async function removePayment(invoiceId: number, paymentId: string): Promise<void> {
  await requireUnlocked()
  await db.transaction('rw', db.invoices, db.users, async () => {
    await requireUnlocked()
    const inv = await db.invoices.get(invoiceId)
    if (!inv) throw new Error('Bill nahi mila')
    await db.invoices.update(invoiceId, {
      payments: (inv.payments ?? []).filter(p => p.id !== paymentId),
      removedPaymentIds: [...new Set([...(inv.removedPaymentIds ?? []), paymentId])],
      updatedAt: nextStamp(inv.updatedAt),
    })
  })
}

export const listInvoices = (): Promise<Invoice[]> =>
  db.invoices.orderBy('createdAt').reverse().toArray()

export const invoicesBetween = (from: string, to: string): Promise<Invoice[]> =>
  db.invoices
    .where('date')
    .between(from, to, true, true)
    .toArray()
    .then((list) => list.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt))

/** Build a fresh draft invoice (also used for "convert to" and "duplicate") */
export async function newInvoice(docType: DocType, date = todayISO()): Promise<Invoice> {
  const setting = await getDocSetting(docType)
  return {
    docType,
    number: '',
    date,
    partyName: '',
    placeOfSupply: '',
    items: [],
    billDiscountType: 'PERCENT',
    billDiscountValue: 0,
    extraCharges: [],
    roundOffEnabled: true,
    notes: '',
    status: 'FINAL',
    payments: [],
    terms: setting.terms || DEFAULT_TERMS,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export async function duplicateInvoice(inv: Invoice, date = todayISO()): Promise<Invoice> {
  const draft = await newInvoice(inv.docType, date)
  return {
    ...draft,
    partyId: inv.partyId,
    partyName: inv.partyName,
    partyPhone: inv.partyPhone,
    partyGstin: inv.partyGstin,
    partyAddress: inv.partyAddress,
    placeOfSupply: inv.placeOfSupply,
    items: inv.items.map((l) => ({ ...l, id: uid() })),
    billDiscountType: inv.billDiscountType,
    billDiscountValue: inv.billDiscountValue,
    extraCharges: inv.extraCharges.map((c) => ({ ...c })),
    roundOffEnabled: inv.roundOffEnabled,
    notes: inv.notes,
    terms: inv.terms,
  }
}

export async function convertInvoice(inv: Invoice, to: DocType): Promise<Invoice> {
  const draft = await newInvoice(to)
  return {
    ...draft,
    fromId: inv.id,
    partyId: inv.partyId,
    partyName: inv.partyName,
    partyPhone: inv.partyPhone,
    partyGstin: inv.partyGstin,
    partyAddress: inv.partyAddress,
    placeOfSupply: inv.placeOfSupply || '',
    items: inv.items.map((l: LineItem) => ({ ...l, id: uid() })),
    billDiscountType: inv.billDiscountType,
    billDiscountValue: inv.billDiscountValue,
    extraCharges: inv.extraCharges.map((c) => ({ ...c })),
    roundOffEnabled: inv.roundOffEnabled,
    notes: inv.notes,
    terms: inv.terms,
  }
}

// ---------------- Payments (khata: in / out) ----------------

export const listPayments = (): Promise<PartyPayment[]> =>
  db.payments.orderBy('date').reverse().toArray()

export async function addPayment(p: Omit<PartyPayment, 'id'>): Promise<number> {
  await requireUnlocked()
  validNumber(p.amount, 'Payment', Number.MIN_VALUE)
  validDate(p.date)
  const { id: _drop, ...rest } = p as PartyPayment
  void _drop
  return db.payments.add(rest as PartyPayment)
}

export const deletePayment = (id: number): Promise<void> => deleteRecord('payments', id)

export interface PaymentRow {
  key: string
  date: string
  direction: PaymentDirection
  partyName: string
  amount: number
  mode: PaymentMode
  note?: string
  source: 'BILL' | 'PARTY'
  invoiceId?: number
  invoiceNumber?: string
  docType?: DocType
  entryId?: string
}

/** Everything that moved money: bill-wise payments + standalone khata payments */
export async function paymentRegister(from: string, to: string): Promise<PaymentRow[]> {
  const [invoices, payments] = await Promise.all([
    db.invoices.toArray(),
    db.payments.where('date').between(from, to, true, true).toArray(),
  ])
  const rows: PaymentRow[] = []
  invoices.forEach((inv) => {
    const meta = docMeta(inv.docType)
    const direction: PaymentDirection = meta.isPurchase || meta.negative ? 'OUT' : 'IN'
    ;(inv.payments ?? []).forEach((p) => {
      const date = p.date || inv.date
      if (date < from || date > to) return
      rows.push({
        key: `bill-${inv.id}-${p.id}`,
        date: p.date || inv.date,
        direction,
        partyName: inv.partyName || 'Cash Sale',
        amount: p.amount,
        mode: p.mode,
        note: p.note,
        source: 'BILL',
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        docType: inv.docType,
        entryId: p.id,
      })
    })
  })
  payments.forEach((p) => {
    rows.push({
      key: `party-${p.id}`,
      date: p.date,
      direction: p.direction,
      partyName: p.partyName || '—',
      amount: p.amount,
      mode: p.mode,
      note: p.note,
      source: 'PARTY',
      invoiceId: p.id,
      entryId: String(p.id),
      docType: undefined,
    })
  })
  return rows.sort((a, b) => b.date.localeCompare(a.date))
}

// ---------------- Expenses ----------------

export const listExpenses = (): Promise<Expense[]> => db.expenses.orderBy('date').reverse().toArray()

export async function upsertExpense(e: Expense): Promise<number> {
  await requireUnlocked()
  validNumber(e.amount, 'Expense', Number.MIN_VALUE)
  validDate(e.date)
  const previous = e.id ? await db.expenses.get(e.id) : undefined
  e = { ...e, syncId: previous?.syncId ?? e.syncId, updatedAt: Date.now() }
  if (e.id) {
    await db.expenses.put(e)
    return e.id
  }
  const { id: _drop, ...rest } = e
  void _drop
  return db.expenses.add(rest as Expense)
}

export const deleteExpense = (id: number): Promise<void> => deleteRecord('expenses', id)

export const expensesBetween = (from: string, to: string): Promise<Expense[]> =>
  db.expenses.where('date').between(from, to, true, true).toArray()

// ---------------- Party-wise aging (receivable / payable) ----------------

export interface AgingReport {
  receivables: AgingBucket[]
  payables: AgingBucket[]
  totalReceivable: number
  totalPayable: number
  overdueReceivable: number
  overduePayable: number
}

/** Shared ledger including cash/unlinked parties; each obligation has a signed amount. */
async function ledgerEntries(shopState: string, asOf = '9999-12-31') {
  const [invoices, parties, payments] = await Promise.all([db.invoices.toArray(), db.parties.toArray(), db.payments.toArray()])
  const groups = new Map<string, { partyId?: number; partyName: string; phone?: string; type: 'CUSTOMER' | 'SUPPLIER'; entries: { amount: number; date?: string }[] }>()
  const partyMap = new Map(parties.map(p => [p.id, p]))
  const get = (partyId: number | undefined, name: string, supplier = false) => {
    const key = partyId ? `id:${partyId}` : `name:${name || 'Cash Sale'}`
    let group = groups.get(key)
    if (!group) {
      const p = partyMap.get(partyId)
      group = { partyId, partyName: p?.name || name || 'Cash Sale', phone: p?.phone, type: p?.type ?? (supplier ? 'SUPPLIER' : 'CUSTOMER'), entries: [] }
      groups.set(key, group)
    }
    return group
  }
  for (const party of parties) get(party.id, party.name, party.type === 'SUPPLIER').entries.push({ amount: party.openingBalance || 0 })
  for (const inv of invoices) {
    if (inv.status !== 'FINAL' || inv.date > asOf) continue
    const meta = docMeta(inv.docType)
    if (!meta.isSale && !meta.isPurchase && !meta.negative) continue
    // Only payments already made at the requested date reduce this obligation.
    const t = computeTotals({ ...inv, payments: (inv.payments ?? []).filter(p => (p.date || inv.date) <= asOf) }, shopState)
    get(inv.partyId, inv.partyName, meta.isPurchase).entries.push({ amount: (meta.isPurchase || meta.negative ? -1 : 1) * t.due, date: inv.date })
  }
  for (const payment of payments) {
    if (payment.date <= asOf) get(payment.partyId, payment.partyName, payment.direction === 'OUT').entries.push({ amount: payment.direction === 'IN' ? -payment.amount : payment.amount, date: payment.date })
  }
  return [...groups.values()]
}

export async function balanceSummary(shopState = '08'): Promise<{ receivable: number; payable: number }> {
  let receivable = 0, payable = 0
  for (const group of await ledgerEntries(shopState)) {
    const balance = round2(group.entries.reduce((s, entry) => s + entry.amount, 0))
    if (group.type === 'CUSTOMER') receivable += Math.max(0, balance)
    else payable += Math.max(0, -balance)
  }
  return { receivable: round2(receivable), payable: round2(payable) }
}

export async function agingReport(shopState = '08', today = todayISO()): Promise<AgingReport> {
  const receivables: AgingBucket[] = [], payables: AgingBucket[] = []
  for (const group of await ledgerEntries(shopState, today)) {
    const sign = group.type === 'SUPPLIER' ? -1 : 1
    const row: AgingBucket = { partyId: group.partyId, partyName: group.partyName, phone: group.phone, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0, oldestDays: 0 }
    let credit = 0
    const dated: { amount: number; age: number }[] = []
    for (const entry of group.entries) {
      const amount = round2(sign * entry.amount)
      if (amount < 0) { credit -= amount; continue }
      // Opening balances have no historical due date: conservatively age them at 90+.
      if (amount > 0) dated.push({ amount, age: entry.date ? Math.max(0, daysBetween(entry.date, today)) : 91 })
    }
    for (const entry of dated.sort((a, b) => b.age - a.age)) {
      const offset = Math.min(credit, entry.amount)
      credit = round2(credit - offset)
      const amount = round2(entry.amount - offset)
      if (!amount) continue
      const key = entry.age <= 30 ? 'd0_30' : entry.age <= 60 ? 'd31_60' : entry.age <= 90 ? 'd61_90' : 'd90plus'
      row[key] = round2(row[key] + amount)
      row.total = round2(row.total + amount)
      row.oldestDays = Math.max(row.oldestDays, entry.age)
    }
    if (row.total > 0.5) (sign > 0 ? receivables : payables).push(row)
  }
  for (const rows of [receivables, payables]) rows.sort((a, b) => b.total - a.total)
  const sum = (rows: AgingBucket[]) => round2(rows.reduce((s, r) => s + r.total, 0))
  const overdue = (rows: AgingBucket[]) => round2(rows.reduce((s, r) => s + r.d31_60 + r.d61_90 + r.d90plus, 0))
  return { receivables, payables, totalReceivable: sum(receivables), totalPayable: sum(payables), overdueReceivable: overdue(receivables), overduePayable: overdue(payables) }
}

/** Purchase bill ke rate se item ka purchase price update karein */
export async function applyPurchaseRates(inv: Invoice): Promise<number> {
  await requireUnlocked()
  return db.transaction('rw', db.items, db.users, async () => {
    await requireUnlocked()
    let updated = 0
    for (const line of inv.items) {
      if (!line.itemId) continue
      const item = await db.items.get(line.itemId)
      if (!item?.id) continue
      const newCost = round2(line.rate * (1 - (line.discountPercent || 0) / 100))
      if (newCost > 0 && Math.abs((item.purchasePrice || 0) - newCost) > 0.01) {
        await db.items.update(item.id, { purchasePrice: newCost, updatedAt: nextStamp(item.updatedAt) })
        updated++
      }
    }
    return updated
  })
}

// ---------------- Backup ----------------

const syncTable = (name: SyncTableName): Table<SyncRow, number | string> => db.table(name)

async function markDeleted(name: SyncTableName, row: SyncRow): Promise<void> {
  if (name === 'business' || name === 'docSettings' || name === 'appSettings') return
  const identity = recordIdentity(name, row)
  await db.tombstones.put({ key: tombstoneKey(name, identity), table: name, identity, deletedAt: Date.now() })
}

async function deleteRecord(name: SyncTableName, id: number): Promise<void> {
  await requireUnlocked()
  const table = syncTable(name)
  await db.transaction('rw', table, db.tombstones, db.users, async () => {
    await requireUnlocked()
    const row = await table.get(id)
    if (row) await markDeleted(name, row)
    await table.delete(id)
  })
}

export async function exportBackup(): Promise<string> {
  await requireOwnerIfConfigured()
  return db.transaction('r', [...SYNC_TABLES.map(syncTable), db.tombstones, db.users], async () => {
    await requireOwnerIfConfigured()
    const data: Record<string, unknown> = { app: 'showroom-manager', version: 3, exportedAt: new Date().toISOString() }
    for (const name of SYNC_TABLES) data[name] = await syncTable(name).toArray()
    data.tombstones = await db.tombstones.toArray()
    initializeInventory(data.items as Item[], data.invoices as Invoice[])
    detachMissingReferences(data)
    return JSON.stringify(data, null, 2)
  })
}

export async function importBackup(json: string, mode: 'replace' | 'merge' = 'merge'): Promise<void> {
  await requireOwnerIfConfigured()
  const data = JSON.parse(json)
  if (!data || data.app !== 'showroom-manager' || !Array.isArray(data.items) || !Array.isArray(data.invoices)) {
    throw new Error('Invalid showroom backup')
  }
  for (const name of [...SYNC_TABLES, 'tombstones']) {
    if (data[name] !== undefined && (!Array.isArray(data[name]) || data[name].some((r: unknown) => !r || typeof r !== 'object' || Array.isArray(r)))) {
      throw new Error(`Invalid backup table: ${name}`)
    }
  }
  initializeInventory(data.items, data.invoices)
  const markers = (data.tombstones ?? []).map(normalizeTombstone)
  await db.transaction('rw', [...SYNC_TABLES.map(syncTable), db.tombstones, db.users], async () => {
    await requireOwnerIfConfigured()
    if (mode === 'merge') {
      const incoming: Record<string, unknown> = { ...data, tombstones: markers }
      for (const name of SYNC_TABLES) {
        const rows: SyncRow[] = []
        for (const row of data[name] ?? []) {
          const restored = { ...row, updatedAt: Date.now() }
          if (['items', 'parties', 'invoices', 'payments', 'expenses'].includes(name)) {
            const identity = recordIdentity(name, row)
            const wasDeleted = await db.tombstones.get(tombstoneKey(name, identity))
            restored.syncId = wasDeleted ? newSyncId() : identity
          }
          rows.push(restored)
        }
        incoming[name] = name === 'business' && await db.business.count() ? [] : rows
      }
      await mergeSnapshot(db, JSON.stringify(incoming))
      return
    }
    if (mode === 'replace') {
      for (const name of SYNC_TABLES) {
        const restoredIdentities = new Set((data[name] ?? []).map((row: SyncRow) => recordIdentity(name, row)))
        for (const row of await syncTable(name).toArray()) {
          if (!restoredIdentities.has(recordIdentity(name, row))) await markDeleted(name, row)
        }
        await syncTable(name).clear()
      }
    }
    for (const marker of markers) {
      const current = await db.tombstones.get(marker.key)
      if (!current || marker.deletedAt > current.deletedAt) await db.tombstones.put(marker)
    }
    for (const name of SYNC_TABLES) {
      for (const row of data[name] ?? []) {
        const restored = { ...row, updatedAt: Date.now() }
        if (['items', 'parties', 'invoices', 'payments', 'expenses'].includes(name)) {
          const identity = recordIdentity(name, row)
          const wasDeleted = await db.tombstones.get(tombstoneKey(name, identity))
          restored.syncId = wasDeleted ? newSyncId() : identity
        }
        await syncTable(name).put(restored)
        // Explicitly recovered rows have a new identity; retain old tombstones for stale devices.
      }
    }
    await reconcileInventory(db)
  })
}

export async function wipeAllData(): Promise<void> {
  await requireOwnerIfConfigured()
  await db.transaction('rw', [...SYNC_TABLES.map(syncTable), db.tombstones, db.users], async () => {
    await requireOwnerIfConfigured()
    for (const name of SYNC_TABLES) {
      for (const row of await syncTable(name).toArray()) await markDeleted(name, row)
      await syncTable(name).clear()
    }
    await setSetting('onboarded', 'no')
  })
}

export { getBusiness }
