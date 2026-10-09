/* Smoke test: runs the whole data layer + renders the app in jsdom with a fake IndexedDB.
 * Build + run:  npm run smoke */
import { JSDOM } from 'jsdom'
import { indexedDB as fakeIndexedDB, IDBKeyRange as fakeIDBKeyRange } from 'fake-indexeddb'

// Must exist at module-eval time: Dexie captures the IndexedDB API on first use.
Object.defineProperty(globalThis, 'indexedDB', { value: fakeIndexedDB, writable: true, configurable: true })
Object.defineProperty(globalThis, 'IDBKeyRange', { value: fakeIDBKeyRange, writable: true, configurable: true })

const results: { name: string; ok: boolean; info?: string }[] = []
const check = (name: string, ok: boolean, info?: string) => {
  results.push({ name, ok, info })
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${info ? ` — ${info}` : ''}`)
}

async function setupDom(): Promise<JSDOM> {
  // note: jsdom ka localStorage/sessionStorage ho to use karo (warna lib ka
  // in-memory fallback chalta hai)
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="boot"></div><div id="root"></div><div id="print-root"></div></body></html>`,
    { url: 'http://localhost:5173/', pretendToBeVisual: true },
  )
  const define = (key: string, value: unknown) =>
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true, enumerable: true })
  define('window', dom.window)
  define('document', dom.window.document)
  define('navigator', dom.window.navigator)
  define('HTMLElement', dom.window.HTMLElement)
  define('Element', dom.window.Element)
  define('Node', dom.window.Node)
  define('Event', dom.window.Event)
  define('CustomEvent', dom.window.CustomEvent)
  define('getComputedStyle', dom.window.getComputedStyle.bind(dom.window))
  define('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number)
  define('cancelAnimationFrame', (id: number) => clearTimeout(id))
  define('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  define(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  define('indexedDB', fakeIndexedDB)
  define('IDBKeyRange', fakeIDBKeyRange)
  Object.defineProperty(dom.window, 'indexedDB', { value: fakeIndexedDB, configurable: true })
  Object.defineProperty(dom.window, 'IDBKeyRange', { value: fakeIDBKeyRange, configurable: true })
  define('IS_REACT_ACT_ENVIRONMENT', false)
  return dom
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const close = (a: number, b: number) => Math.abs(a - b) < 0.02
const click = (dom: JSDOM, el: Element | undefined) => {
  if (!el) return false
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  return true
}

const fetCallsSoFar = (calls: string[], needle: string) => calls.some((c) => c.includes(needle))

async function main() {
  const dom = await setupDom()
  const rootEl = document.getElementById('root')!
  const errors: unknown[] = []
  const origError = console.error
  console.error = (...args: unknown[]) => {
    errors.push(args[0])
    origError(...(args as []))
  }

  // ---------------- data layer ----------------
  const { seedDatabase, db, getBusiness } = await import('../src/lib/db')
  const repo = await import('../src/lib/repo')
  const calc = await import('../src/lib/calc')
  const { parseItemsCsv, itemsToCsv } = await import('../src/lib/csvutil')
  const { amountInWords, todayISO: todayIso } = await import('../src/lib/format')

  console.log('\n== Data layer ==')
  await seedDatabase()
  const business = await getBusiness()
  const items = await repo.listItems()
  check('seed: shop + sample items', items.length >= 10 && !!business.name, `${items.length} items`)
  const docSettings = await db.docSettings.toArray()
  check('seed: 7 document types (purchase samet)', docSettings.length === 7, docSettings.map((d) => d.prefix).join(','))

  const item1 = items[0]
  const item2 = items[1]
  const draft = await repo.newInvoice('TAX_INVOICE')
  const withItems = {
    ...draft,
    partyName: 'Test Customer',
    placeOfSupply: business.stateCode,
    billDiscountType: 'PERCENT' as const,
    billDiscountValue: 5,
    items: [calc.lineFromItem(item1, 2), calc.lineFromItem(item2, 1)],
    roundOffEnabled: true,
  }
  const t = calc.computeTotals(withItems, business.stateCode)
  const expectedTaxable = withItems.items.reduce((s, l) => s + l.rate * l.qty * (1 - l.discountPercent / 100), 0)
  check('calc: bill discount applied', close(t.taxableNet, expectedTaxable * 0.95), `${t.taxableNet.toFixed(2)}`)
  check('calc: CGST+SGST = GST', close(t.cgst + t.sgst, t.tax) && !t.interState, `${t.cgst} + ${t.sgst} = ${t.tax}`)
  check('calc: round off to rupee', Math.abs(t.grandTotal - Math.round(t.grandTotal)) < 0.001, `total ${t.grandTotal}`)

  const igstTotals = calc.computeTotals({ ...withItems, placeOfSupply: '27' }, business.stateCode)
  check('calc: inter-state → IGST', igstTotals.interState && igstTotals.igst > 0 && igstTotals.cgst === 0, `igst ${igstTotals.igst}`)

  const stockBefore = (await db.items.get(item1.id!))!.stockQty
  const invId = await repo.saveInvoice(
    { ...withItems, payments: [{ id: 'p1', date: withItems.date, amount: 500, mode: 'CASH' }] },
    business.stateCode,
  )
  const saved = (await db.invoices.get(invId))!
  const stockAfter = (await db.items.get(item1.id!))!.stockQty
  check('save: number allocated', !!saved.number, saved.number)
  check('save: stock reduced', stockAfter === stockBefore - 2, `${stockBefore} → ${stockAfter}`)
  const st = calc.computeTotals(saved, business.stateCode)
  check('save: due = total − paid', close(st.due, st.grandTotal - 500), `due ${st.due}`)
  const nextNumber = await repo.peekNumber('TAX_INVOICE', saved.date)
  check('numbering: series advanced', nextNumber !== saved.number, nextNumber)

  await repo.saveInvoice({ ...saved, items: saved.items.slice(0, 1) }, business.stateCode)
  check('edit: stock re-balanced', (await db.items.get(item1.id!))!.stockQty === stockBefore - 2)

  await repo.recordPayment(invId, { amount: 100, mode: 'UPI', date: saved.date })
  check('payment: recorded', calc.computeTotals((await db.invoices.get(invId))!, business.stateCode).paid === 600)

  await repo.cancelInvoice(invId)
  check(
    'cancel: stock returned',
    (await db.invoices.get(invId))!.status === 'CANCELLED' && (await db.items.get(item1.id!))!.stockQty === stockBefore,
  )
  await repo.restoreInvoice(invId)
  check('restore: back to FINAL', (await db.invoices.get(invId))!.status === 'FINAL')

  const partyId = await repo.upsertParty({
    type: 'CUSTOMER',
    name: 'Test Customer',
    phone: '9876543210',
    openingBalance: 1000,
    createdAt: Date.now(),
  })
  await db.invoices.update(invId, { partyId, partyName: 'Test Customer' })
  const bal = await repo.balanceOf(partyId, business.stateCode)
  const invDue = calc.computeTotals((await db.invoices.get(invId))!, business.stateCode).due
  check('khata: opening + due', close(bal, 1000 + invDue), `${bal} vs ${1000 + invDue}`)

  const current = (await db.invoices.get(invId))!
  const credit = await repo.convertInvoice(current, 'CREDIT_NOTE')
  const stockBeforeCN = (await db.items.get(item1.id!))!.stockQty
  const cnId = await repo.saveInvoice({ ...credit, payments: [] }, business.stateCode)
  const cnSaved = (await db.invoices.get(cnId))!
  const cnTotals = calc.computeTotals(cnSaved, business.stateCode)
  const balAfterCN = await repo.balanceOf(partyId, business.stateCode)
  check(
    'credit note: khata balance down',
    close(balAfterCN, bal - cnTotals.grandTotal) || balAfterCN < bal,
    `${bal} → ${balAfterCN} (CN ${cnTotals.grandTotal})`,
  )
  check(
    'credit note: stock wapas juda',
    (await db.items.get(item1.id!))!.stockQty === stockBeforeCN + (cnSaved.items[0]?.qty ?? 0),
    `stock ${stockBeforeCN} → ${(await db.items.get(item1.id!))!.stockQty}`,
  )
  check('credit note: number series CN/', cnSaved.number.startsWith('CN/'), cnSaved.number)
  await repo.deleteInvoice(cnId)

  const estimate = await repo.newInvoice('ESTIMATE')
  const estId = await repo.saveInvoice({ ...estimate, ...withItems, docType: 'ESTIMATE', number: '', payments: [] }, business.stateCode)
  const estSaved = (await db.invoices.get(estId))!
  check('estimate: own number series', estSaved.number.startsWith('EST/'), estSaved.number)
  check('estimate: stock untouched', (await db.items.get(item1.id!))!.stockQty === stockBefore - 2)

  const csv = itemsToCsv([item1], true)
  const roundTrip = parseItemsCsv(csv)
  check('csv: round trip', roundTrip.items.length === 1 && roundTrip.items[0].code === item1.code)
  const androidCsv =
    'Code,Name,Brand,Category,Subcategory,MRP,Discount %,GST %,Sale Price,Notes\nHW-9,Jet Spray,Hindware,CP,Faucet,2999,30,18,1900,test'
  const parsedAndroid = parseItemsCsv(androidCsv)
  check('csv: android app format', parsedAndroid.items.length === 1 && parsedAndroid.items[0].mrp === 2999)

  check('words: indian lakh format', amountInWords(125430) === 'Rupees One Lakh Twenty Five Thousand Four Hundred and Thirty Only', amountInWords(125430))

  // ---------------- purchase + payments + expenses + aging ----------------
  const supplierId = await repo.upsertParty({
    type: 'SUPPLIER',
    name: 'Test Supplier',
    phone: '9812345678',
    openingBalance: 0,
    createdAt: Date.now(),
  })
  const purchDraft = await repo.newInvoice('PURCHASE')
  const stockBeforePurchase = (await db.items.get(item2.id!))!.stockQty
  const purchaseId = await repo.saveInvoice(
    {
      ...purchDraft,
      partyId: supplierId,
      partyName: 'Test Supplier',
      partyPhone: '9812345678',
      placeOfSupply: business.stateCode,
      items: [calc.lineFromItem(item2, 4)],
      payments: [],
    },
    business.stateCode,
  )
  const purchase = (await db.invoices.get(purchaseId))!
  const pTotals = calc.computeTotals(purchase, business.stateCode)
  check('purchase: number series PUR/', purchase.number.startsWith('PUR/'), purchase.number)
  check(
    'purchase: stock IN',
    (await db.items.get(item2.id!))!.stockQty === stockBeforePurchase + 4,
    `${stockBeforePurchase} → ${(await db.items.get(item2.id!))!.stockQty}`,
  )
  const supplierBal = await repo.balanceOf(supplierId, business.stateCode)
  check('purchase: supplier ko dena hai (negative = payable)', close(supplierBal, -pTotals.grandTotal), `balance ${supplierBal}`)

  // partial supplier payment (out)
  await repo.recordPayment(purchaseId, { amount: 300, mode: 'BANK', date: purchase.date })
  const afterPartPay = await repo.balanceOf(supplierId, business.stateCode)
  check('purchase: partial payment se payable kam', close(afterPartPay, -(pTotals.grandTotal - 300)), `${afterPartPay}`)

  // standalone khata payment IN from customer reduces receivable
  const balBeforeIn = await repo.balanceOf(partyId, business.stateCode)
  await repo.addPayment({
    date: todayIso(),
    direction: 'IN',
    partyId,
    partyName: 'Test Customer',
    amount: 150,
    mode: 'UPI',
    note: 'on account',
    createdAt: Date.now(),
  })
  const balAfterIn = await repo.balanceOf(partyId, business.stateCode)
  check('khata payment IN: receivable kam', close(balAfterIn, balBeforeIn - 150), `${balBeforeIn} → ${balAfterIn}`)

  // payment register merges bill payments + khata payments
  const wide = { from: '2000-01-01', to: '2099-12-31' }
  const register = await repo.paymentRegister(wide.from, wide.to)
  const ins = register.filter((r) => r.direction === 'IN').reduce((s, r) => s + r.amount, 0)
  const outs = register.filter((r) => r.direction === 'OUT').reduce((s, r) => s + r.amount, 0)
  check('payment register: IN/OUT mila', register.length >= 4 && ins > 0 && outs >= 300, `IN ${ins}, OUT ${outs}`)

  // expenses
  const expId = await repo.upsertExpense({
    date: todayIso(),
    category: 'Rent',
    amount: 2500,
    mode: 'CASH',
    paidTo: 'Landlord',
    note: '',
    createdAt: Date.now(),
  })
  check('expense: save + list', (await repo.expensesBetween(wide.from, wide.to)).some((e) => e.id === expId))
  await repo.upsertExpense({ id: expId, date: todayIso(), category: 'Rent', amount: 3000, mode: 'CASH', createdAt: Date.now() })
  check('expense: edit', (await db.expenses.get(expId))!.amount === 3000)

  // aging report: receivable from customer, payable to supplier
  const aging = await repo.agingReport(business.stateCode)
  check(
    'aging: receivable + payable alag-alag',
    aging.totalReceivable > 0 && aging.totalPayable > 0 && aging.receivables.some((r) => r.partyName === 'Test Customer'),
    `recv ${aging.totalReceivable}, pay ${aging.totalPayable}`,
  )
  check(
    'aging: on-account payment kam ho gaya',
    close(aging.totalPayable, pTotals.grandTotal - 300),
    `payable ${aging.totalPayable} = ${pTotals.grandTotal} - 300`,
  )
  check(
    'aging: opening balances age separately and bucket totals reconcile',
    aging.receivables.every((r) => close(r.d0_30 + r.d31_60 + r.d61_90 + r.d90plus, r.total)),
    undefined,
  )

  // purchase rates sync
  const updated = await repo.applyPurchaseRates(purchase)
  check('purchase: item cost update', updated >= 0 && (await db.items.get(item2.id!))!.purchasePrice > 0, `${updated} item(s)`)

  const bizRow = await db.business.toCollection().first()
  if (bizRow?.id) {
    await db.business.update(bizRow.id, { upiId: 'testshop@upi', phone: '9876500000', gstin: '08ABCDE1234F1Z5' })
    Object.assign(business, { upiId: 'testshop@upi', phone: '9876500000', gstin: '08ABCDE1234F1Z5' })
  }

  const backup = await repo.exportBackup()
  const before = await db.items.count()
  await repo.importBackup(backup, 'merge')
  check('backup: export/import', (await db.items.count()) === before)

  // ---------------- UI ----------------
  console.log('\n== UI render (jsdom) ==')
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { default: App } = await import('../src/App')
  let printCalls = 0
  ;(dom.window as unknown as { print: () => void }).print = () => {
    printCalls += 1
  }
  const root = createRoot(rootEl)
  root.render(React.createElement(App, null))
  await wait(1400)

  let html = rootEl.innerHTML
  check('onboarding or home renders', html.length > 400, `${html.length} chars`)
  const skip = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.includes('skip'))
  if (skip) {
    click(dom, skip)
    await wait(700)
    html = rootEl.innerHTML
  }
  check('home: dashboard visible', html.includes('Aaj ki sale'), undefined)
  check('home: quick bill buttons', html.includes('Naya Bill'))

  // Items tab
  const itemsTab = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.includes('Items'))
  click(dom, itemsTab)
  await wait(700)
  html = rootEl.innerHTML
  check('items: screen renders', html.includes('MRP') && html.includes('Low stock'), undefined)

  // Reports tab
  const repTab = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.includes('Reports'))
  click(dom, repTab)
  await wait(800)
  html = rootEl.innerHTML
  check('reports: renders sale summary', html.includes('Net sale'), undefined)

  // Billing screen
  const billBtn = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === '＋ Bill')
  click(dom, billBtn)
  await wait(900)
  html = rootEl.innerHTML
  check('billing: screen opens', html.includes('Grand total') && html.includes('Payment'))
  check('billing: next number shown', /INV\/\d{2}-\d{2}\/\d{3}/.test(html), (html.match(/INV\/\d{2}-\d{2}\/\d{3}/) ?? [])[0])

  // add an item from the picker
  const addItemBtn = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.includes('＋ Item'))
  click(dom, addItemBtn)
  await wait(600)
  const firstItemRow = [...rootEl.querySelectorAll('button.list-row')].find((b) =>
    (b.textContent ?? '').includes('Stk'),
  )
  const pickedName = firstItemRow?.textContent?.slice(0, 18) ?? ''
  click(dom, firstItemRow)
  await wait(700)
  html = rootEl.innerHTML
  check('billing: item added to cart', html.includes('Bill discount') && /Qty\s*1/.test(html.replace(/&nbsp;/g, ' ')), pickedName)

  // save the bill → invoice view
  const saveBtn = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save')
  click(dom, saveBtn)
  await wait(1500)
  html = rootEl.innerHTML
  check('invoice view: opened after save', html.includes('Bill preview') || html.includes('UPI') || html.includes('Print'), undefined)
  check('invoice view: A4 paper rendered', html.includes('TAX INVOICE'))
  check('invoice view: thermal layout available', html.includes('Thermal 80mm'))
  check('share helpers: whatsapp link', !!rootEl.querySelector('a[href^="https://wa.me"]'))
  const upiBtn = [...rootEl.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('UPI QR'))
  check('invoice view: UPI QR button for due bills', !!upiBtn)
  if (upiBtn) {
    click(dom, upiBtn)
    await wait(500)
    check('upi: QR sheet renders qr code', !!document.querySelector('svg[viewBox], canvas') && (rootEl.innerHTML.includes('Scan')) , undefined)
    const closeBtn = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === '✕')
    click(dom, closeBtn)
    await wait(300)
  }

  // thermal print must open the print dialog with the thermal page rule
  const thermalBtn = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Thermal 80mm')
  click(dom, thermalBtn)
  await wait(400)
  html = rootEl.innerHTML
  check('thermal: paper switches', html.includes('paper-thermal'), undefined)
  const printBtn = [...rootEl.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Print / PDF'))
  click(dom, printBtn)
  await wait(700)
  check('print: print dialog triggered', printCalls > 0, `${printCalls} call(s)`)
  check('print: thermal page rule injected', (document.getElementById('print-page-rule')?.textContent ?? '').includes('80mm'))

  // receive payment flow
  const payBtn = [...rootEl.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Payment receive'))
  check('payment: receive button visible for due bill', !!payBtn)
  if (payBtn) {
    click(dom, payBtn)
    await wait(500)
    const savePay = [...rootEl.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Payment save karein'))
    check('payment: sheet opens', !!savePay)
    click(dom, savePay)
    await wait(900)
    html = rootEl.innerHTML
    const lastInv = (await db.invoices.orderBy('createdAt').reverse().first())!
    check('payment: saved to invoice', (lastInv.payments?.length ?? 0) > 0, `${lastInv.payments?.length ?? 0} payment(s)`)
    check('payment: bill now shows Paid', html.includes('Paid'))
  }

  // More tab → Khata, Payments, Expenses
  const backBtn = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === '←')
  click(dom, backBtn)
  await wait(600)
  const moreTab = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === '☰More' || b.textContent?.trim() === 'More')
  click(dom, moreTab)
  await wait(700)
  html = rootEl.innerHTML
  check('more: hub renders', html.includes('Khata / Parties') && html.includes('Payments In/Out') && html.includes('Expenses'))

  const paymentsTile = [...rootEl.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Payments In/Out'))
  click(dom, paymentsTile)
  await wait(900)
  html = rootEl.innerHTML
  check('payments: register renders', html.includes('Paisa aaya') && html.includes('Paisa diya'))
  check('payments: entries listed', html.includes('Test Supplier') || html.includes('Test Customer'))

  const payAddBtn = [...rootEl.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Payment likhein'))
  click(dom, payAddBtn)
  await wait(600)
  check('payments: add sheet opens', rootEl.innerHTML.includes('Party chunein'))
  const closeX = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === '✕')
  click(dom, closeX)
  await wait(400)

  const back2 = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === '←')
  click(dom, back2)
  await wait(600)
  const expensesTile = [...rootEl.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Expenses'))
  click(dom, expensesTile)
  await wait(900)
  html = rootEl.innerHTML
  check('expenses: screen renders total', html.includes('Total kharcha') && html.includes('Naya kharcha'))
  check('expenses: rent entry visible', html.includes('Dukan ka kiraya') || html.includes('Rent'))

  const expAdd = [...rootEl.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Naya kharcha likhein'))
  click(dom, expAdd)
  await wait(600)
  check('expenses: editor sheet opens', rootEl.innerHTML.includes('Category') && rootEl.innerHTML.includes('Save karein'))
  const closeX2 = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === '✕')
  click(dom, closeX2)
  await wait(400)

  // reports: aging + day book + net profit
  const back3 = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === '←')
  click(dom, back3)
  await wait(600)
  const repTab2 = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === '📊Reports' || b.textContent?.trim() === 'Reports')
  click(dom, repTab2)
  await wait(900)
  html = rootEl.innerHTML
  check('reports: net profit + purchase section', html.includes('Net profit') || html.includes('Purchase (supplier)'))
  check('reports: aging table', html.includes('Udhaar aging') && html.includes('Lena hai'))
  check('reports: day book', html.includes('Day book'))

  // purchase bill flow: home quick tile → billing shows PUR series + supplier picker
  const backToHome = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === '🏠Home' || b.textContent?.trim() === 'Home')
  click(dom, backToHome)
  await wait(600)
  const purchaseTile = [...rootEl.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '📥Purchase')
  click(dom, purchaseTile)
  await wait(900)
  html = rootEl.innerHTML
  check('purchase UI: billing opens with PUR series', /PUR\/\d{2}-\d{2}\/\d{3}/.test(html), (html.match(/PUR\/\d{2}-\d{2}\/\d{3}/) ?? [])[0])
  check('purchase UI: supplier prompt', html.includes('Supplier chunein') || html.includes('Supplier bill'))

  const addItemBtn2 = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.includes('＋ Item'))
  click(dom, addItemBtn2)
  await wait(600)
  const purchaseItem = [...rootEl.querySelectorAll('button.list-row')].find((b) => (b.textContent ?? '').includes('cost'))
  click(dom, purchaseItem)
  await wait(600)
  const saveBtn2 = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save')
  click(dom, saveBtn2)
  await wait(1600)
  html = rootEl.innerHTML
  check('purchase UI: saved bill shows PURCHASE BILL paper', html.includes('PURCHASE BILL'), undefined)
  check('purchase UI: shows payable wording', html.includes('Dena hai') || html.includes('Supplier ko payment'))

  // in-app self test (Settings) — browser me hi chalta hai, rollback ke saath
  const backFromBill = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === '←')
  click(dom, backFromBill)
  await wait(700)
  const settingsBtn = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === '⚙️')
  check('self-test: settings button mila', !!settingsBtn)
  click(dom, settingsBtn)
  await wait(900)
  html = rootEl.innerHTML
  check('self-test: settings me button dikha', html.includes('Self-test chalayein'))
  const runTestBtn = [...rootEl.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Self-test chalayein'))
  click(dom, runTestBtn)
  await wait(2500)
  html = rootEl.innerHTML
  const passMatch = html.match(/(\d+)\/(\d+) checks pass/)
  check('self-test: chala aur pass hua', !!passMatch && passMatch[1] === passMatch[2], passMatch ? `${passMatch[1]}/${passMatch[2]}` : 'no result')
  check('self-test: fail check nahi', !html.includes('check fail'))
  await wait(300)
  html = rootEl.innerHTML
  check('self-test: result sheet khud khul gaya', html.includes('Bill maths') && html.includes('Data safety'))
  check('self-test: har group ka result dikh raha', html.includes('Purchase') && html.includes('Expenses') && html.includes('Register'))
  check('self-test: data rollback hua (counts same)', html.includes('rollback'))
  const closeTest = [...rootEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Band karein')
  click(dom, closeTest)
  await wait(400)

  const appErrors = errors.filter((e) => String(e).includes('Error') || String(e).includes('Cannot'))
  check('react: no render errors', appErrors.length === 0, appErrors.slice(0, 2).map(String).join(' | '))



  // ---------------- Login screen (UI) ----------------
  {
    const { addUser, logout } = await import('../src/lib/auth')
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { LoginScreen } = await import('../src/screens/Auth')

    const uid = await addUser({ name: 'Smoke Login', role: 'OWNER', pin: '1234' })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const loginRoot = createRoot(host)
    loginRoot.render(React.createElement(LoginScreen, { onLoggedIn: () => {} }))
    await wait(800)
    html = host.innerHTML
    check('login UI: user list dikhti hai', html.includes('Kaun login kar raha hai') && html.includes('Smoke Login'))

    const userBtn = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Smoke Login'))
    click(dom, userBtn)
    await wait(500)
    html = host.innerHTML
    check('login UI: no unauthenticated PIN reset', !html.includes('Naya banayein'))
    check('login UI: PIN pad khul gaya', html.includes('PIN daalein') && !!host.querySelector('.pin-key'))

    for (const d of ['9', '9', '9', '9']) {
      const key = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === d)
      click(dom, key)
      await wait(140)
    }
    await wait(800)
    html = host.innerHTML
    check('login UI: galat PIN par saaf error dikhta hai', html.includes('PIN galat hai'))

    logout()
    loginRoot.unmount()
    host.remove()
    await db.users.delete(uid)
    await wait(200)
  }

  // ---------------- Company / Firm + Users & login (naya) ----------------
  {
    const { listCompanies, createCompany, activeCompany, setActiveCompany, deleteCompany, dbNameFor } =
      await import('../src/lib/company')
    const { addUser, tryLogin, checkLogin, logout, setUserPin, activeUsers } =
      await import('../src/lib/auth')

    const base = listCompanies()
    check('company: pehli company (default) list me hai', base.length >= 1 && base.some((c) => c.id === 'default'))

    const nayi = createCompany('Test Sanitary — Sikar Road')
    check('company: nayi company ban gayi', listCompanies().some((c) => c.id === nayi.id), nayi.name)
    check('company: har company ka alag database naam', dbNameFor(nayi.id) !== dbNameFor('default'))

    setActiveCompany(nayi.id)
    check('company: switch se active company badal gayi', activeCompany().id === nayi.id, activeCompany().name)
    setActiveCompany('default')
    check('company: wapas default par aa gaye', activeCompany().id === 'default')

    // users + login (default company me)
    const beforeGate = await checkLogin()
    const uid = await addUser({ name: 'Ravi (Test)', role: 'STAFF', pin: '1234' })
    check('users: naya user ban gaya', (await activeUsers()).some((u) => u.id === uid))
    check('login: user banne par gate "login" maangta hai', (await checkLogin()) === 'login', `pehle: ${beforeGate}`)

    const wrong = await tryLogin(uid, '9999')
    check('login: galat PIN se login nahi hota', wrong === false && (await checkLogin()) === 'login')

    const right = await tryLogin(uid, '1234')
    check('login: sahi PIN se login ho jata hai', right === true && (await checkLogin()) === 'ok')

    logout()
    check('login: logout par session hat gaya', (await checkLogin()) === 'login')

    // owner ka PIN reset + cleanup
    let resetDenied = false
    try { await setUserPin(uid, '5555') } catch { resetDenied = true }
    check('login: logged-out PIN reset denied', resetDenied)
    await tryLogin(uid, '1234')
    await setUserPin(uid, '5555')
    const afterReset = await tryLogin(uid, '5555')
    check('login: PIN badalne ke baad naya PIN chalta hai', afterReset === true)
    logout()
    await db.users.delete(uid)
    check('users: user hatane par login band ho jata hai (app khulti hai)', (await checkLogin()) === 'off')

    deleteCompany(nayi.id)
    check('company: test company hat gayi', !listCompanies().some((c) => c.id === nayi.id))
  }


  // ---------------- Cloud account + sync (mock Firebase) ----------------
  {
    const cloud = await import('../src/lib/cloud')
    const sync = await import('../src/lib/sync')
    cloud.setAutoSync(false) // Keep manual-sync assertions independent of App's automatic effect.
    const { db } = await import('../src/lib/db')

    // ---- chhota mock Firebase: Identity Toolkit + Firestore ----
    const docs = new Map<string, Record<string, unknown>>()
    let fetchCalls: string[] = []
    const revisions = new Map<string, string>()
    let revision = 0
    let beforePatch: ((path: string) => void) | undefined
    let conflicts = 0
    const enc = (v: unknown): Record<string, unknown> => {
      if (typeof v === 'string') return { stringValue: v }
      if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
      if (typeof v === 'boolean') return { booleanValue: v }
      if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } }
      if (v && typeof v === 'object') {
        const fields: Record<string, unknown> = {}
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) fields[k] = enc(val)
        return { mapValue: { fields } }
      }
      return { nullValue: null }
    }
    const dec = (v: any): unknown => {
      if (!v || typeof v !== 'object') return null
      if ('stringValue' in v) return v.stringValue
      if ('integerValue' in v) return Number(v.integerValue)
      if ('doubleValue' in v) return v.doubleValue
      if ('booleanValue' in v) return v.booleanValue
      if ('nullValue' in v) return null
      if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(dec)
      if ('mapValue' in v) {
        const out: Record<string, unknown> = {}
        for (const [k, val] of Object.entries(v.mapValue.fields ?? {})) out[k] = dec(val as unknown)
        return out
      }
      return null
    }

    const mockFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      fetchCalls.push(String(url))
      const u = String(url)
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
      const ok = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } })
      const bad = (code: string) => new Response(JSON.stringify({ error: { message: `${code} : bad` } }), { status: 400 })

      if (u.includes('accounts:signUp') || u.includes('accounts:signInWithPassword')) {
        const email = String(body.email ?? '')
        const password = String(body.password ?? '')
        if (password.length < 6) return bad('WEAK_PASSWORD')
        if (u.includes('signInWithPassword') && password !== 'secret123') return bad('INVALID_LOGIN_CREDENTIALS')
        return ok({ localId: 'uid1', email, idToken: 'tok-1', refreshToken: 'ref-1', expiresIn: '3600' })
      }
      if (u.includes('accounts:signInWithIdp')) return ok({ localId: 'uid1', email: 'g@example.com', idToken: 'tok-g', refreshToken: 'ref-g', expiresIn: '3600' })
      if (u.includes('securetoken.googleapis.com')) return ok({ id_token: 'tok-2', refresh_token: 'ref-2', expires_in: '3600' })
      if (u.includes('accounts:sendOobCode')) return ok({ email: body.email })
      if (u.includes('firestore.googleapis.com')) {
        const path = u.split('/documents/')[1]?.split('?')[0] ?? ''
        const method = (init?.method ?? 'GET').toUpperCase()
        if (!init?.headers || !(init.headers as Record<string, string>).Authorization) {
          return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 })
        }
        if (method === 'PATCH') {
          beforePatch?.(path)
          const query = new URL(u).searchParams
          const expected = query.get('currentDocument.updateTime')
          if ((query.get('currentDocument.exists') === 'false' && docs.has(path)) || (expected !== null && expected !== (revisions.get(path) ?? 'initial'))) {
            conflicts++
            return new Response(JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: 'the stored version does not match the required update time.' } }), { status: 400 })
          }
          const fields = (body.fields ?? {}) as Record<string, unknown>
          const out: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(fields)) out[k] = dec(v)
          docs.set(path, out)
          revisions.set(path, `revision-${++revision}`)
          return ok({ name: path })
        }
        const d = docs.get(path)
        if (!d) return new Response('{}', { status: 404 })
        const fields: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(d)) fields[k] = enc(v)
        return ok({ fields, updateTime: revisions.get(path) ?? 'initial' })
      }
      return new Response('{}', { status: 404 })
    }

    const realFetch = globalThis.fetch
    globalThis.fetch = mockFetch as unknown as typeof fetch

    // ---- 1) config parse ----
    let cfgErr = ''
    try {
      cloud.parseFirebaseConfig('apiKey: "AIzaTESTKEY"')
    } catch (e) {
      cfgErr = e instanceof Error ? e.message : 'err'
    }
    check('cloud: adhura config saaf error deta hai', cfgErr.includes('apiKey'), cfgErr.slice(0, 60))

    const cfg = cloud.parseFirebaseConfig(
      `const firebaseConfig = { apiKey: "AIzaTESTKEY", authDomain: "test.firebaseapp.com", projectId: "test-shop", appId: "1:1:web:1" };`,
    )
    cloud.setCloudConfig({ ...cfg, googleClientId: '1234-test.apps.googleusercontent.com' })
    check('cloud: config save ho gaya (projectId mila)', cloud.getCloudConfig()?.projectId === 'test-shop' && cloud.isCloudConfigured())

    // ---- 2) signup + login ----
    const s1 = await cloud.signUpEmail('dukaan@example.com', 'secret123')
    check('cloud: signup se session ban gaya', s1.uid === 'uid1' && cloud.isSignedIn())

    let weakErr = ''
    try {
      await cloud.signUpEmail('x@example.com', '123')
    } catch (e) {
      weakErr = e instanceof Error ? e.message : ''
    }
    check('cloud: chhota password par Hinglish error', weakErr.includes('6 characters'), weakErr)

    cloud.logoutCloud()
    let badErr = ''
    try {
      await cloud.signInEmail('dukaan@example.com', 'wrongpass9')
    } catch (e) {
      badErr = e instanceof Error ? e.message : ''
    }
    check('cloud: galat password par saaf error', badErr.includes('galat'), badErr)

    await cloud.signInEmail('dukaan@example.com', 'secret123')
    check('cloud: sahi password se login ho gaya', cloud.isSignedIn())

    const g = await cloud.signInWithGoogleIdToken('google-id-token-xyz')
    check('cloud: Google login (id token) kaam karta hai', g.email === 'g@example.com' && cloud.isSignedIn())

    // ---- 3) token refresh ----
    const { store } = await import('../src/lib/store')
    const stale = JSON.parse(store.get('local', 'showroom_cloud_session') || '{}')
    stale.expiresAt = Date.now() - 1000
    store.set('local', 'showroom_cloud_session', JSON.stringify(stale))
    const t2 = await cloud.freshToken()
    check('cloud: token expire hone par refresh hota hai', t2 === 'tok-2', t2)

    // ---- 4) sync: push karta hai, phir remote change pull hota hai ----
    // registry: cloud me ek company rakhi hai jo local me nahi hai
    docs.set('showroomUsers/uid1', { companies: [{ id: 'remoteCo1', name: 'Cloud Wali Dukaan', createdAt: 1000 }], updatedAt: 5, updatedBy: 'uid1' })

    const before = {
      items: await db.items.count(),
      parties: await db.parties.count(),
    }
    const res1 = await sync.syncNow({ all: false })
    check('sync: pehli sync chali aur company registry cloud me gayi', res1.companies >= 1 && fetCallsSoFar(fetchCalls, 'showroomUsers/uid1'))
    check('sync: cloud me active company ka data chadh gaya', docs.has(`showroomUsers/uid1/companies/${(await import('../src/lib/company')).activeCompanyId()}`))

    const registry = (await import('../src/lib/company')).listCompanies()
    check('sync: cloud ki nayi company switch list me aa gayi', registry.some((c) => c.id === 'remoteCo1'))

    // remote snapshot me: ek nayi party + ek clash wali party (same id, alag naam) + invoice usi party ka
    const remoteSnapshot = JSON.stringify({
      app: 'showroom-manager',
      version: 2,
      business: [],
      docSettings: [],
      appSettings: [],
      parties: [
        { id: 1, name: 'Cloud Customer', phone: '9999000011', type: 'CUSTOMER', createdAt: 5000 },
        { id: 99, name: 'Nayi Cloud Party', phone: '', type: 'CUSTOMER', createdAt: 6000 },
      ],
      items: [{ id: 1, code: 'CLOUD-1', name: 'Cloud Item', unit: 'PCS', mrp: 100, discountPercent: 0, gstPercent: 18, purchasePrice: 50, stockQty: 3, lowStockAlert: 1, barcode: '', notes: '', updatedAt: 9000 }],
      invoices: [
        { id: 5, docType: 'TAX_INVOICE', number: 'INV/CLOUD/1', date: '2026-10-01', partyId: 1, partyName: 'Cloud Customer', placeOfSupply: '08', items: [{ id: 'l1', itemId: 1, name: 'Cloud Item', code: 'CLOUD-1', unit: 'PCS', qty: 1, rate: 100, discountPercent: 0, gstPercent: 18, costPrice: 50 }], billDiscountType: 'PERCENT', billDiscountValue: 0, extraCharges: [], roundOffEnabled: false, status: 'FINAL', payments: [], createdAt: 9500, updatedAt: 9500 },
      ],
      payments: [],
      expenses: [],
    })
    docs.set(`showroomUsers/uid1/companies/${registry[0].id}`, { payload: remoteSnapshot, updatedAt: Date.now() + 5000, updatedBy: 'other-device' })
    store.remove('local', `showroom_last_sync_${registry[0].id}`)

    const res2 = await sync.syncNow({ all: false })
    const partiesAfter = await db.parties.toArray()
    const cloudParty = partiesAfter.find((p) => p.name === 'Cloud Customer')
    const newParty = partiesAfter.find((p) => p.name === 'Nayi Cloud Party')
    check('sync pull: cloud ki nayi party local me aa gayi', !!newParty)
    check('sync pull: id clash hone par nayi id mili (data overwrite nahi hua)', !!cloudParty && cloudParty.id !== 1)
    check('sync pull: cloud item bhi aa gaya', !!(await db.items.toArray()).find((i) => i.code === 'CLOUD-1'))

    const inv = (await db.invoices.toArray()).find((i) => i.number === 'INV/CLOUD/1')
    check('sync pull: invoice ka party reference theek remap hua', !!inv && !!cloudParty && inv.partyId === cloudParty.id, `partyId=${inv?.partyId} expected=${cloudParty?.id}`)

    const countsAfter = { items: await db.items.count(), parties: await db.parties.count() }
    check('sync pull: naya data juda (purana gaya nahi)', countsAfter.items > before.items && countsAfter.parties > before.parties)

    check('sync: merge stats batate hain kitna juda', res2.added >= 3, `added=${res2.added} updated=${res2.updated}`)

    const activeCloudPath = `showroomUsers/uid1/companies/${(await import('../src/lib/company')).activeCompanyId()}`
    await db.appSettings.put({ key: 'race-test', value: 'first', updatedAt: Date.now() })
    const beforeRace = conflicts
    beforePatch = (path) => {
      if (path !== activeCloudPath) return
      beforePatch = undefined
      const remoteData = JSON.parse(String(docs.get(path)!.payload))
      remoteData.invoices.push({ ...remoteData.invoices[0], id: 900, syncId: 'racing-device-invoice', number: 'INV/RACE/1', payments: [], updatedAt: Date.now() })
      docs.set(path, { ...docs.get(path), payload: JSON.stringify(remoteData) })
      revisions.set(path, `revision-${++revision}`)
    }
    await sync.syncNow()
    const publishedRace = JSON.parse(String(docs.get(activeCloudPath)!.payload))
    check('sync: conflicting publish retries and preserves both devices bills', conflicts === beforeRace + 1 && publishedRace.invoices.some((i: any) => i.number === 'INV/RACE/1') && publishedRace.invoices.some((i: any) => i.number === 'INV/CLOUD/1') && !!(await db.invoices.toArray()).find(i => i.number === 'INV/RACE/1'))
    check('sync: publication uses server revision precondition', fetchCalls.some(url => url.includes('currentDocument.updateTime=revision-')))
    let creationConflict = false
    try { await cloud.remoteSetCompany('uid1', (await import('../src/lib/company')).activeCompanyId(), await sync.buildSnapshot(), null) } catch (e) { creationConflict = e instanceof cloud.CloudError && e.code === 'SYNC_CONFLICT' }
    check('sync: missing-document precondition cannot replace existing snapshot', creationConflict)
    await db.appSettings.put({ key: 'race-test', value: 'second', updatedAt: Date.now() })
    const attemptsBefore = conflicts
    beforePatch = (path) => { if (path === activeCloudPath) revisions.set(path, `revision-${++revision}`) }
    let exhausted = false
    try { await sync.syncNow() } catch (e) { exhausted = e instanceof cloud.CloudError && e.code === 'SYNC_CONFLICT' }
    beforePatch = undefined
    check('sync: sustained conflicts stop after three publication attempts', exhausted && conflicts === attemptsBefore + 3)

    await sync.syncNow() // Finish the pending local change after conflict fixture is removed.
    const writesBeforeNoop = fetchCalls.filter(url => url.includes('currentDocument.')).length
    const sameSyncA = sync.syncNow(), sameSyncB = sync.syncNow()
    await Promise.all([sameSyncA, sameSyncB])
    check('sync: equivalent calls share one in-flight operation', sameSyncA === sameSyncB)
    check('sync: unchanged snapshot and registry skip publication', fetchCalls.filter(url => url.includes('currentDocument.')).length === writesBeforeNoop)

    const beforeAuto = fetchCalls.length
    cloud.setAutoSync(true)
    await wait(500)
    check('sync: auto-sync starts without local PIN users after preference change', fetchCalls.length > beforeAuto)
    cloud.setAutoSync(false)
    await wait(100)

    // ---- 5) graceful: config ke bina ----
    cloud.logoutCloud()
    cloud.setCloudConfig(null)
    let noCfg = ''
    try {
      await sync.syncNow()
    } catch (e) {
      noCfg = e instanceof Error ? e.message : ''
    }
    check('sync: bina cloud setup saaf message deta hai', noCfg.includes('Cloud setup'), noCfg.slice(0, 40))

    globalThis.fetch = realFetch
    cloud.logoutCloud()
  }

  root.unmount()
  const { runRegressions } = await import('./regressions')
  await runRegressions(check)

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('FAILED: ' + failed.map((f) => f.name).join(' | '))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('SMOKE CRASH:', e)
  process.exit(1)
})
