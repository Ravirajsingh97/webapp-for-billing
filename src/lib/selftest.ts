/**
 * In-app self test (browser me hi chalta hai — koi terminal/npm ki zarurat nahi).
 *
 * Ye sach me billing engine ko chalata hai: item banata hai, bill banata hai, payment leta hai,
 * purchase karta hai, credit note banata hai — aur end me sab kuch ROLLBACK kar deta hai
 * (Dexie transaction abort). Aapka asli data safe rehta hai.
 */
import { db } from './db'
import { computeTotals, itemMargin, itemSalePrice, lineFromItem } from './calc'
import * as repo from './repo'
import { amountInWords, todayISO } from './format'
import { itemsToCsv, parseItemsCsv } from './csvutil'
import type { Item, Invoice } from './types'
import { docMeta } from './types'

export interface SelfTestResult {
  group: string
  name: string
  ok: boolean
  info?: string
}

const ROLLBACK = new Error('__showroom_selftest_rollback__')
const close = (a: number, b: number, eps = 0.03) => Math.abs(a - b) < eps

export async function runSelfTest(): Promise<SelfTestResult[]> {
  const out: SelfTestResult[] = []
  const check = (group: string, name: string, ok: boolean, info?: string) =>
    out.push({ group, name, ok, info })

  const before = {
    items: await db.items.count(),
    invoices: await db.invoices.count(),
    parties: await db.parties.count(),
    payments: await db.payments.count(),
    expenses: await db.expenses.count(),
  }

  const stamp = Date.now().toString(36)
  const baseItem: Item = {
    name: `SelfTest Item ${stamp}`,
    code: `ST-${stamp}`,
    barcode: '',
    brand: 'SelfTest',
    category: 'CP',
    subcategory: '',
    hsn: '8481',
    unit: 'PCS',
    mrp: 1000,
    discountPercent: 10,
    gstPercent: 18,
    purchasePrice: 500,
    stockQty: 5,
    lowStockAlert: 2,
    notes: '',
    updatedAt: Date.now(),
  }

  const business = await repo.getBusiness()
  const shopState = business.stateCode || '08'

  try {
    await db.transaction(
      'rw',
      db.items,
      db.invoices,
      db.docSettings,
      db.parties,
      db.payments,
      async () => {
        // ---------- Items ----------
        const idA = await repo.upsertItem(baseItem)
        const itemA = (await db.items.get(idA))!
        check('Items', 'naya item save hua', itemA.code === baseItem.code)
        check(
          'Items',
          'sale price + margin sahi',
          close(itemSalePrice(1000, 10, 18), 1062) && close(itemMargin(1000, 10, 500).amount, 400, 0.5),
          `${itemSalePrice(1000, 10, 18)} / margin ${itemMargin(1000, 10, 500).amount}`,
        )

        // ---------- Bill maths ----------
        const idB = await repo.upsertItem({ ...baseItem, name: 'SelfTest Item B', code: `${baseItem.code}-B`, mrp: 200, discountPercent: 0, stockQty: 3 })
        const itemB = (await db.items.get(idB))!
        const draft = await repo.newInvoice('TAX_INVOICE')
        const draftInv: Invoice = {
          ...draft,
          partyName: 'SelfTest Customer',
          placeOfSupply: shopState,
          billDiscountType: 'PERCENT',
          billDiscountValue: 5,
          roundOffEnabled: true,
          items: [lineFromItem(itemA, 2), lineFromItem(itemB, 1)],
        }
        const t = computeTotals(draftInv, shopState)
        const afterLineDisc = 1000 * 2 * 0.9 + 200 // itemA 10% disc
        check('Bill maths', 'item + bill discount lag raha hai', close(t.taxableNet, afterLineDisc * 0.95), `${t.taxableNet}`)
        check('Bill maths', 'CGST + SGST = GST', close(t.cgst + t.sgst, t.tax) && !t.interState, `${t.cgst} + ${t.sgst}`)
        const interState = computeTotals({ ...draftInv, placeOfSupply: shopState === '08' ? '27' : '08' }, shopState)
        check('Bill maths', 'dusre state par IGST lagta hai', interState.interState && interState.igst > 0 && interState.cgst === 0, `IGST ${interState.igst}`)
        check('Bill maths', 'round off pura rupaya', Math.abs(t.grandTotal - Math.round(t.grandTotal)) < 0.001, `total ${t.grandTotal}`)
        check('Bill maths', 'amount in words (Hindi/Indian)', amountInWords(125430).includes('One Lakh Twenty Five Thousand'), amountInWords(125430))

        // ---------- Save bill + stock ----------
        const stockBefore = (await db.items.get(idA))!.stockQty
        const invId = await repo.saveInvoice({ ...draftInv, billDiscountValue: 0, billDiscountType: 'AMOUNT', payments: [] }, shopState)
        const saved = (await db.invoices.get(invId))!
        check('Billing', 'bill number bana', saved.number.startsWith('INV/'), saved.number)
        check('Billing', 'stock bill se kam hua', (await db.items.get(idA))!.stockQty === stockBefore - 2, `${stockBefore} → ${(await db.items.get(idA))!.stockQty}`)
        const nextNo = await repo.peekNumber('TAX_INVOICE', saved.date)
        check('Billing', 'agla number aage badha', nextNo !== saved.number, nextNo)

        // edit the same bill -> stock double na kate
        await repo.saveInvoice({ ...saved, items: saved.items.slice(0, 1) }, shopState)
        check('Billing', 'bill edit par stock sahi rebalanced', (await db.items.get(idA))!.stockQty === stockBefore - 2)

        // ---------- Payment ----------
        const dueBefore = computeTotals((await db.invoices.get(invId))!, shopState).due
        await repo.recordPayment(invId, { amount: 100, mode: 'CASH', date: saved.date })
        const tAfter = computeTotals((await db.invoices.get(invId))!, shopState)
        check('Payment', 'payment se baki kam hua', close(tAfter.paid, 100) && close(tAfter.due, dueBefore - 100), `due ${tAfter.due}`)

        // ---------- Cancel / restore ----------
        await repo.cancelInvoice(invId)
        check('Cancel', 'bill cancel par stock wapas', (await db.items.get(idA))!.stockQty === stockBefore)
        await repo.restoreInvoice(invId)
        check('Cancel', 'restore par stock phir se kata', (await db.items.get(idA))!.stockQty === stockBefore - 2)

        // ---------- Khata ----------
        const partyId = await repo.upsertParty({
          type: 'CUSTOMER',
          name: `SelfTest Party ${stamp}`,
          phone: '9000000000',
          openingBalance: 500,
          createdAt: Date.now(),
        })
        await db.invoices.update(invId, { partyId, partyName: `SelfTest Party ${stamp}` })
        const bal = await repo.balanceOf(partyId, shopState)
        const invDue = computeTotals((await db.invoices.get(invId))!, shopState).due
        check('Khata', 'balance = purana + baki', close(bal, 500 + invDue), `${bal}`)

        await repo.addPayment({
          date: todayISO(),
          direction: 'IN',
          partyId,
          partyName: 'SelfTest Party',
          amount: 200,
          mode: 'UPI',
          createdAt: Date.now(),
        })
        check('Khata', 'on-account payment se udhaar kam', close(await repo.balanceOf(partyId, shopState), bal - 200))

        // ---------- Purchase ----------
        const supplierId = await repo.upsertParty({
          type: 'SUPPLIER',
          name: `SelfTest Supplier ${stamp}`,
          phone: '9111111111',
          openingBalance: 0,
          createdAt: Date.now(),
        })
        const stockBeforePurchase = (await db.items.get(idB))!.stockQty
        const purDraft = await repo.newInvoice('PURCHASE')
        const purId = await repo.saveInvoice(
          {
            ...purDraft,
            partyId: supplierId,
            partyName: `SelfTest Supplier ${stamp}`,
            placeOfSupply: shopState,
            items: [lineFromItem(itemB, 4)],
            payments: [],
          },
          shopState,
        )
        const purSaved = (await db.invoices.get(purId))!
        const purTotals = computeTotals(purSaved, shopState)
        check('Purchase', 'purchase number PUR/ se shuru', purSaved.number.startsWith('PUR/'), purSaved.number)
        check('Purchase', 'purchase se stock badha', (await db.items.get(idB))!.stockQty === stockBeforePurchase + 4, `${stockBeforePurchase} → ${(await db.items.get(idB))!.stockQty}`)
        check('Purchase', 'supplier ko dena (payable) bana', close(await repo.balanceOf(supplierId, shopState), -purTotals.grandTotal), `${await repo.balanceOf(supplierId, shopState)}`)
        await repo.recordPayment(purId, { amount: 50, mode: 'BANK', date: purSaved.date })
        check(
          'Purchase',
          'supplier payment (OUT) se payable kam',
          close(await repo.balanceOf(supplierId, shopState), -(purTotals.grandTotal - 50)),
          `${await repo.balanceOf(supplierId, shopState)}`,
        )

        // ---------- Credit note ----------
        const cn = await repo.convertInvoice((await db.invoices.get(invId))!, 'CREDIT_NOTE')
        const stockBeforeCn = (await db.items.get(idA))!.stockQty
        const cnId = await repo.saveInvoice({ ...cn, payments: [] }, shopState)
        const cnSaved = (await db.invoices.get(cnId))!
        check('Credit note', 'stock wapas juda', (await db.items.get(idA))!.stockQty === stockBeforeCn + (cnSaved.items[0]?.qty ?? 0))
        check('Credit note', 'party ka hisab kam hua', (await repo.balanceOf(partyId, shopState)) < bal - 200)

        // ---------- Registers ----------
        const wide = { from: '2000-01-01', to: '2099-12-31' }
        const register = await repo.paymentRegister(wide.from, wide.to)
        check(
          'Register',
          'payment register IN/OUT dono dikha raha',
          register.some((r) => r.direction === 'IN') && register.some((r) => r.direction === 'OUT'),
          `${register.length} entries (in ${register.filter((r) => r.direction === 'IN').length}, out ${register.filter((r) => r.direction === 'OUT').length})`,
        )
        const aging = await repo.agingReport(shopState)
        check('Aging', 'aging report me lena/dena alag-alag', aging.receivables.length > 0 && aging.payables.length > 0, `recv ${aging.totalReceivable}, pay ${aging.totalPayable}`)

        // ---------- CSV ----------
        const csv = itemsToCsv([(await db.items.get(idA))!], true)
        const parsed = parseItemsCsv(csv)
        check('CSV', 'export → import round trip', parsed.items.length === 1 && parsed.items[0].code === baseItem.code)

        // ---------- Doc settings ----------
        const settings = await db.docSettings.toArray()
        check('Series', 'saare document type ke number series set hain', settings.length >= 7 && settings.every((s) => s.prefix && s.nextNumber > 0), settings.map((s) => s.prefix).join(','))
        check('Series', 'purchase type enabled hai', docMeta('PURCHASE').isPurchase && !!settings.find((s) => s.docType === 'PURCHASE'))

        throw ROLLBACK
      },
    )
  } catch (e) {
    if (e !== ROLLBACK) {
      console.error('[self-test]', e)
      check('Run', 'self-test chala', false, e instanceof Error ? e.message.split('\n')[0] : String(e))
    }
  }

  // ---------- Expenses (alag transaction) ----------
  try {
    await db.transaction('rw', db.expenses, async () => {
      const expId = await repo.upsertExpense({
        date: todayISO(),
        category: 'Rent',
        amount: 100,
        mode: 'CASH',
        createdAt: Date.now(),
      })
      check('Expenses', 'kharcha save hua', (await db.expenses.get(expId))!.amount === 100)
      await repo.upsertExpense({ id: expId, date: todayISO(), category: 'Rent', amount: 250, mode: 'CASH', createdAt: Date.now() })
      check('Expenses', 'kharcha edit hua', (await db.expenses.get(expId))!.amount === 250)
      const inRange = await repo.expensesBetween('2000-01-01', '2099-12-31')
      check('Expenses', 'period filter kaam kar raha', inRange.some((e) => e.id === expId))
      throw ROLLBACK
    })
  } catch (e) {
    if (e !== ROLLBACK) {
      console.error('[self-test expenses]', e)
      check('Expenses', 'expenses test chala', false, e instanceof Error ? e.message.split('\n')[0] : String(e))
    }
  }

  // ---------- Backup (read-only) ----------
  try {
    const backup = JSON.parse(await repo.exportBackup())
    check(
      'Backup',
      'backup me sab tables hain',
      ['items', 'invoices', 'parties', 'payments', 'expenses', 'docSettings'].every((k) => Array.isArray(backup[k])),
    )
  } catch (e) {
    console.error('[self-test backup]', e)
    check('Backup', 'backup export chala', false, e instanceof Error ? e.message.split('\n')[0] : String(e))
  }

  // ---------- Data safety ----------
  const after = {
    items: await db.items.count(),
    invoices: await db.invoices.count(),
    parties: await db.parties.count(),
    payments: await db.payments.count(),
    expenses: await db.expenses.count(),
  }
  const unchanged = (Object.keys(before) as (keyof typeof before)[]).every((k) => before[k] === after[k])
  check('Data safety', 'test ne aapka data nahi badla (rollback)', unchanged, `items ${after.items}, bills ${after.invoices}`)

  return out
}
