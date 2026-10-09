import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { db, ShowroomDB, DEFAULT_BUSINESS } from '../src/lib/db'
import * as repo from '../src/lib/repo'
import { computeTotals, hsnSummary, lineFromItem } from '../src/lib/calc'
import { buildSnapshot, mergeSnapshot } from '../src/lib/sync'
import { InvoicePaper } from '../src/components/InvoicePaper'
import { HomeScreen } from '../src/screens/Home'
import { MoreScreen } from '../src/screens/More'
import { BillingScreen } from '../src/screens/Billing'
import { addDays, todayISO } from '../src/lib/format'
import { invoiceText } from '../src/lib/doc'
import { parseItemsCsv } from '../src/lib/csvutil'
import type { DocType, Invoice, Item } from '../src/lib/types'

type Check = (name: string, ok: boolean, info?: string) => void
const wait = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms))
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false } catch { return true } }

export async function runSafetyRegressions(check: Check) {
  console.log('\n== Money, inventory and responsive workflow regressions ==')
  const reset = async () => { await db.delete(); await db.open() }
  const item: Item = { name: 'Safety Item', code: 'SAFE', brand: 'Test', category: 'Test', unit: 'KG', mrp: 1000, discountPercent: 20, gstPercent: 0, purchasePrice: 500, stockQty: 10, lowStockAlert: 0, updatedAt: 1 }
  const make = async (type: DocType = 'TAX_INVOICE', patch: Partial<Invoice> = {}) => ({ ...await repo.newInvoice(type), roundOffEnabled: false, items: [lineFromItem({ ...item, discountPercent: 0 })], ...patch })
  const business = { ...DEFAULT_BUSINESS, upiId: 'synthetic@upi', isPlaceholder: false }
  const host = document.createElement('div')
  document.body.append(host)
  let root = createRoot(host)
  const render = async (node: ReturnType<typeof createElement>) => { root.render(node); await wait() }
  const remount = () => { root.unmount(); root = createRoot(host) }
  const replica = new ShowroomDB('safety-replica')
  try {
    await reset()
    const id = await repo.saveInvoice(await make())
    await Promise.all([repo.recordPayment(id, { date: todayISO(), amount: 100, mode: 'CASH' }), repo.recordPayment(id, { date: todayISO(), amount: 200, mode: 'UPI' })])
    let current = (await db.invoices.get(id))!
    check('safety: concurrent receipts both survive', current.payments.length === 2 && computeTotals(current).paid === 300)
    const old = structuredClone(current)
    await repo.recordPayment(id, { date: todayISO(), amount: 50, mode: 'CASH' })
    check('safety: stale bill edits cannot erase receipts', await rejects(() => repo.saveInvoice({ ...old, notes: 'Stale edit' })) && computeTotals((await db.invoices.get(id))!).paid === 350)
    current = (await db.invoices.get(id))!
    await Promise.all(current.payments.slice(0, 2).map(p => repo.removePayment(id, p.id)))
    check('safety: concurrent payment removals both persist', computeTotals((await db.invoices.get(id))!).paid === 50)
    const snapshotWithReceipt = await buildSnapshot()
    current = (await db.invoices.get(id))!
    await repo.removePayment(id, current.payments[0].id)
    await mergeSnapshot(db, snapshotWithReceipt)
    check('safety: stale sync cannot resurrect removed payment', (await db.invoices.get(id))!.payments.length === 0)

    await reset()
    const itemId = await repo.upsertItem(item)
    const baseline = await buildSnapshot()
    await replica.delete(); await replica.open()
    await mergeSnapshot(replica, baseline)
    const saleA = await repo.saveInvoice(await make('TAX_INVOICE', { items: [lineFromItem((await db.items.get(itemId))!, 1)] }))
    const saleB = { ...await make(), id: 2, number: 'OTHER/1', syncId: 'other-sale', items: [lineFromItem((await replica.items.get(itemId))!, 1)], updatedAt: Date.now() + 100 }
    await replica.invoices.put(saleB)
    // Snapshot models a device that posted its independent sale and reduced stock.
    await replica.items.update(itemId, { stockQty: 9 })
    await mergeSnapshot(db, await buildSnapshot(replica))
    check('safety: independent offline sales preserve both stock deductions', await db.invoices.count() === 2 && (await db.items.get(itemId))!.stockQty === 8)
    await mergeSnapshot(replica, await buildSnapshot())
    check('safety: inventory sync converges and replay is idempotent', (await replica.items.get(itemId))!.stockQty === 8)
    const unchanged = await buildSnapshot()
    await mergeSnapshot(db, await buildSnapshot(replica))
    check('safety: repeated sync does not deduct stock again', (await db.items.get(itemId))!.stockQty === 8)
    void unchanged
    await repo.cancelInvoice(saleA)
    await mergeSnapshot(replica, await buildSnapshot())
    check('safety: cancellation restores stock on both replicas', (await db.items.get(itemId))!.stockQty === 9 && (await replica.items.get(itemId))!.stockQty === 9)
    await repo.adjustStock(itemId, 2)
    // Independent adjustment on replica; union of immutable identities must retain both.
    const ri = (await replica.items.get(itemId))!
    await replica.items.update(itemId, { stockAdjustments: { ...ri.stockAdjustments, 'replica-adjustment': 3 } })
    await mergeSnapshot(db, await buildSnapshot(replica))
    check('safety: concurrent manual stock adjustments merge', (await db.items.get(itemId))!.stockQty === 14)

    await reset()
    const cid = await repo.upsertItem(item)
    const c = await repo.saveInvoice(await make('DELIVERY_CHALLAN', { items: [lineFromItem((await db.items.get(cid))!, 2)] }))
    const converted = await repo.saveInvoice(await repo.convertInvoice((await db.invoices.get(c))!, 'TAX_INVOICE'))
    check('safety: challan conversion deducts inventory once', (await db.items.get(cid))!.stockQty === 8)
    check('safety: duplicate challan conversion rejected', await rejects(async () => repo.saveInvoice(await repo.convertInvoice((await db.invoices.get(c))!, 'TAX_INVOICE'))))
    await repo.cancelInvoice(converted)
    check('safety: cancelled conversion retains physical challan delivery', (await db.items.get(cid))!.stockQty === 8)
    await repo.cancelInvoice(c)
    check('safety: cancelling both documents restores original stock', (await db.items.get(cid))!.stockQty === 10)
    await repo.restoreInvoice(converted)
    check('safety: restoring converted invoice reapplies delivery once', (await db.items.get(cid))!.stockQty === 8)
    await repo.cancelInvoice(converted)
    await repo.restoreInvoice(c)
    const replacement = await repo.saveInvoice(await repo.convertInvoice((await db.invoices.get(c))!, 'TAX_INVOICE'))
    check('safety: restoring older conversion cannot duplicate active delivery', await rejects(() => repo.restoreInvoice(converted)))
    await repo.cancelInvoice(replacement)
    await repo.restoreInvoice(converted)
    const staleItem = (await db.items.get(cid))!
    await repo.saveInvoice(await make('TAX_INVOICE', { items: [lineFromItem(staleItem)] }))
    check('safety: stale item metadata edit cannot restore sold stock', await rejects(() => repo.upsertItem({ ...staleItem, name: 'Edited name' })) && (await db.items.get(cid))!.stockQty === 7)
    for (const qty of [-1, 0, Infinity, NaN]) check(`safety: invalid quantity ${qty} rejected`, await rejects(async () => repo.saveInvoice(await make('TAX_INVOICE', { items: [{ ...lineFromItem(item), qty }] }))))
    check('safety: negative rate and non-finite payment rejected', await rejects(async () => repo.saveInvoice(await make('TAX_INVOICE', { items: [{ ...lineFromItem(item), rate: -1 }] }))) && await rejects(() => repo.recordPayment(converted, { date: todayISO(), amount: Infinity, mode: 'CASH' })))

    check('safety: impossible bill and payment dates rejected', await rejects(async () => repo.saveInvoice(await make('TAX_INVOICE', { date: '2026-02-30' }))) && await rejects(() => repo.recordPayment(converted, { date: '', amount: 1, mode: 'CASH' })))
    check('safety: excessive bill percentage rejected', await rejects(async () => repo.saveInvoice(await make('TAX_INVOICE', { billDiscountValue: 101 }))))

    await reset()
    const precisionId = await repo.upsertItem({ ...item, stockQty: 1 })
    await repo.saveInvoice(await make('TAX_INVOICE', { items: [lineFromItem((await db.items.get(precisionId))!, 0.125)] }))
    check('safety: inventory preserves fractional units beyond two decimals', (await db.items.get(precisionId))!.stockQty === 0.875)
    const deletedDraft = (await db.items.get(precisionId))!
    await repo.deleteItem(precisionId)
    check('safety: deleted item cannot be recreated by stale editor', await rejects(() => repo.upsertItem(deletedDraft)) && !await db.items.get(precisionId))
    const draftBeforeMerge = (await db.invoices.toArray())[0]
    const withRemotePayment = JSON.parse(await buildSnapshot())
    withRemotePayment.invoices[0].payments.push({ id: 'remote-new-payment', date: todayISO(), amount: 1, mode: 'CASH' })
    withRemotePayment.invoices[0].updatedAt = draftBeforeMerge.updatedAt - 1
    await mergeSnapshot(db, JSON.stringify(withRemotePayment))
    check('safety: merged older remote receipt invalidates open bill drafts', await rejects(() => repo.saveInvoice(draftBeforeMerge)) && (await db.invoices.get(draftBeforeMerge.id!))!.payments.length === 1)

    await reset()
    const remoteBusiness = JSON.parse(await buildSnapshot())
    remoteBusiness.business = [{ ...business, id: 1, name: 'Real shop', stateCode: '27', updatedAt: 1000 }]
    await db.business.add({ ...DEFAULT_BUSINESS, isPlaceholder: true, updatedAt: 2000 })
    await mergeSnapshot(db, JSON.stringify(remoteBusiness))
    check('safety: remote shop replaces fresh placeholders despite older timestamp', (await db.business.toCollection().first())!.name === 'Real shop' && (await db.business.toCollection().first())!.stateCode === '27')
    const partyId = await repo.upsertParty({ type: 'CUSTOMER', name: 'Safety customer', openingBalance: 100, createdAt: 1 })
    const billed = await repo.saveInvoice(await make('TAX_INVOICE', { date: addDays(todayISO(), -1), partyId, partyName: 'Safety customer' }))
    await repo.recordPayment(billed, { date: todayISO(), amount: 200, mode: 'CASH' })
    await repo.addPayment({ date: todayISO(), amount: 300, mode: 'CASH', direction: 'IN', partyId, partyName: 'Safety customer', createdAt: 1 })
    await repo.saveInvoice(await make('CREDIT_NOTE', { partyId, partyName: 'Safety customer', items: [{ ...lineFromItem(item), rate: 400, discountPercent: 0 }] }))
    check('safety: aging and dashboard reconcile with opening and credit-note ledger', await repo.balanceOf(partyId) === 200 && (await repo.balanceSummary()).receivable === 200 && (await repo.agingReport()).totalReceivable === 200)
    await render(createElement(HomeScreen, { business, onNewBill() {}, onOpenInvoice() {}, onGoItems() {}, onGoReports() {}, onGoParties() {}, onGoPayments() {}, onGoExpenses() {} }))
    check('safety UI: Home uses payment date and standalone receipts', host.textContent!.includes('Cash ₹500.00') && [...host.querySelectorAll('button')].some(b => /udhaar/i.test(b.textContent!) && b.textContent!.includes('₹200.00')))
    remount()
    await render(createElement(MoreScreen, { business, onNewBill() {}, onOpen() {}, onOpenInvoice() {} }))
    check('safety UI: More shares the ledger balance', host.textContent!.includes('₹200'))
    const discount = computeTotals(await make('TAX_INVOICE', { items: [1, 2, 3].map(n => ({ ...lineFromItem(item), id: String(n), rate: 100, discountPercent: 0 })), billDiscountType: 'AMOUNT', billDiscountValue: 1 }))
    check('safety: exact paise discount allocation', discount.taxableNet === 299 && discount.lines.reduce((s, l) => s + Math.round((l.taxable - l.taxableAfterBillDiscount) * 100), 0) === 100)
    const mixed = await make('TAX_INVOICE', { items: [5, 18].map(gstPercent => ({ ...lineFromItem(item), hsn: '1234', gstPercent, discountPercent: 0, rate: 100 })) })
    check('safety: HSN summary separates tax rates', hsnSummary(mixed, computeTotals(mixed)).length === 2)
    const fractional = await make('TAX_INVOICE', { items: [lineFromItem(item, 1.5)] })
    check('safety: shared text preserves fractional quantities', invoiceText(fractional, business, computeTotals(fractional)).includes('1.5 KG'))
    remount()
    await render(createElement(InvoicePaper, { invoice: fractional, business, mode: 'a4' }))
    check('safety UI: printed quantity preserves decimal and sale QR appears', [...host.querySelectorAll('td')].some(td => td.textContent === '1.5') && !!host.querySelector('svg'))
    const letterhead = { ...mixed, billDiscountType: 'AMOUNT' as const, billDiscountValue: 1, extraCharges: [{ label: 'Freight', amount: 12 }], roundOffEnabled: false, placeOfSupply: business.stateCode }
    remount()
    await render(createElement(InvoicePaper, { invoice: letterhead, business: { ...business, phone: '', email: 'billing@example.invalid' }, mode: 'a4' }))
    const expectedLetterhead = computeTotals(letterhead, business.stateCode)
    check('letterhead: email prints without phone and shows full tax analysis', host.textContent!.includes('billing@example.invalid') && !!host.querySelector('.letterhead-tax') && host.querySelectorAll('.letterhead-tax tbody tr').length === 3)
    check('letterhead: item amounts and final total use existing calculations', Number(host.querySelector('.letterhead-item-row td:last-child')!.textContent!.replace(/,/g, '')) === expectedLetterhead.lines[0].taxable && host.querySelector('.letterhead-total td:last-child')!.textContent!.includes(expectedLetterhead.grandTotal.toFixed(2)))
    check('letterhead: bill discount and freight appear once in summary', [...host.querySelectorAll('.letterhead-summary-label')].filter(e => e.textContent === 'Bill discount').length === 1 && host.textContent!.includes('Other charges'))
    const oddTax = { ...letterhead, billDiscountValue: 0, items: [1, 2, 3].map(n => ({ ...letterhead.items[0], id: 'odd-' + n, hsn: String(n), qty: 1, rate: 0.1, gstPercent: 5, discountPercent: 0 })) }
    remount()
    await render(createElement(InvoicePaper, { invoice: oddTax, business, mode: 'a4' }))
    const taxRows = [...host.querySelectorAll('.letterhead-tax tbody tr:not(.letterhead-tax-total)')]
    const sumColumn = (column: number) => Math.round(taxRows.reduce((sum, row) => sum + Number(row.children[column].textContent!.replace(/,/g, '')), 0) * 100)
    const oddTotals = computeTotals(oddTax, business.stateCode)
    check('letterhead: odd-paise HSN tax columns reconcile to totals', sumColumn(3) === Math.round(oddTotals.cgst * 100) && sumColumn(5) === Math.round(oddTotals.sgst * 100))
    remount()
    await render(createElement(InvoicePaper, { invoice: { ...letterhead, placeOfSupply: business.stateCode === '27' ? '08' : '27' }, business, mode: 'a4' }))
    check('letterhead: interstate analysis prints IGST only', host.querySelector('.letterhead-tax')!.textContent!.includes('IGST') && !host.querySelector('.letterhead-tax')!.textContent!.includes('CGST'))
    remount()
    await render(createElement(InvoicePaper, { invoice: { ...letterhead, docType: 'BILL_OF_SUPPLY' }, business, mode: 'a4' }))
    check('letterhead: bill of supply omits GST columns and tax analysis', !host.querySelector('.letterhead-tax') && !host.querySelector('.letterhead-items thead')!.textContent!.includes('GST') && host.querySelector('.letterhead-items thead tr')!.children.length === 8)
    remount()
    await render(createElement(InvoicePaper, { invoice: { ...fractional, docType: 'PURCHASE' }, business, mode: 'thermal' }))
    check('safety UI: purchase output has no shop payment QR', !host.querySelector('svg') && host.textContent!.includes('1.5 KG'))
    check('safety: CSV fractional stock round trip', parseItemsCsv('Code,Name,Stock,MRP\nSAFE,Test,1.125,100').items[0].stockQty === 1.125)

    const pid = await repo.upsertItem(item)
    const purchase = await make('PURCHASE', { items: [{ ...lineFromItem(item), itemId: undefined, rate: 321, discountPercent: 0 }] })
    remount()
    await render(createElement(BillingScreen, { draft: purchase, business, onBack() {}, onSaved() {} }))
    host.querySelector<HTMLButtonElement>('.billing-line-layout > button')!.click()
    await wait()
    const link = [...host.querySelectorAll('select')].find(s => s.textContent!.includes('Bina link'))!
    link.value = String(pid); link.dispatchEvent(new window.Event('change', { bubbles: true })); await wait()
    const rateField = [...host.querySelectorAll('label')].find(l => l.textContent === 'Rate / MRP')!.parentElement!.querySelector('input')!
    const discountField = [...host.querySelectorAll('label')].find(l => l.textContent === 'Disc %')!.parentElement!.querySelector('input')!
    check('safety UI: linked purchase uses cost and no selling discount', rateField.value === '500' && discountField.value === '0')
    link.value = ''; link.dispatchEvent(new window.Event('change', { bubbles: true })); await wait()
    check('safety UI: catalogue link can be removed', link.value === '')
  } finally {
    root.unmount(); host.remove(); await replica.delete(); await reset()
  }
}
