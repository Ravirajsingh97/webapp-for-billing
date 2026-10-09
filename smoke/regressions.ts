import { db, ShowroomDB, seedDatabase, getBusiness } from '../src/lib/db'
import * as repo from '../src/lib/repo'
import { computeTotals, lineFromItem } from '../src/lib/calc'
import { buildSnapshot, mergeSnapshot as mergeCompleteSnapshot } from '../src/lib/sync'
import { csvEscape, parseCsvText } from '../src/lib/csvutil'
import * as auth from '../src/lib/auth'
import * as cloud from '../src/lib/cloud'
import { store } from '../src/lib/store'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { POSScreen } from '../src/screens/POS'
import { suggestPurchaseLines } from '../src/lib/ocr'
import { BillingScreen } from '../src/screens/Billing'

// Fixtures model complete cloud snapshots; individual tests override relevant tables.
const mergeSnapshot = (target: ShowroomDB, json: string) => mergeCompleteSnapshot(target, JSON.stringify({
  business: [], docSettings: [], appSettings: [], parties: [], items: [], invoices: [], payments: [], expenses: [], ...JSON.parse(json),
}))

type Check = (name: string, ok: boolean, info?: string) => void
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const rejects = async (run: () => Promise<unknown>) => { try { await run(); return false } catch { return true } }

export async function runRegressions(check: Check) {
  console.log('\n== Review regressions ==')
  await db.delete()
  await db.open()
  await seedDatabase()
  const item = (await db.items.toArray())[0]
  const business = await getBusiness()
  await repo.upsertItem({ ...item, syncId: undefined, notes: 'CSV-style update' })
  check('regression: CSV-style updates preserve sync identity', (await db.items.get(item.id!))?.syncId === item.syncId)
  const ocrLines = suggestPurchaseLines('Basin 2 500 1000\nTap 1 1,200.50 1,200.50\nGrand Total 3 500 1500\nWrong 2 500 900\nLoose text')
  check('OCR: suggests matching item rows, excludes totals and mismatched arithmetic', ocrLines.length === 2 && ocrLines[0].qty === 2 && ocrLines[1].rate === 1200.5 && !ocrLines[0].itemId && ocrLines[0].gstPercent === 0)
  await repo.upsertItem({ ...item, mrp: 1000, discountPercent: 25, gstPercent: 18 })
  const posHost = document.createElement('div')
  document.body.appendChild(posHost)
  const posRoot = createRoot(posHost)
  const posSaved: number[] = []
  const stockBeforePOS = (await db.items.get(item.id!))!.stockQty
  const countBeforePOS = await db.invoices.count()
  posRoot.render(createElement(POSScreen, { draft: { ...await repo.newInvoice('TAX_INVOICE'), placeOfSupply: business.stateCode, billDiscountValue: 50 }, business, onBack: () => {}, onEdit: () => {}, onSaved: id => posSaved.push(id) }))
  await wait(100)
  const posButton = (label: string) => Array.from(posHost.querySelectorAll('button')).find(b => b.textContent?.includes(label))!
  posButton(item.name).click()
  await wait(30)
  posButton(item.name).click()
  await wait(30)
  check('POS: repeated product tap merges cart quantity', posHost.querySelector('[aria-label="Sale cart"]')?.textContent?.includes('2') === true)
  const setPosInput = async (label: string, value: string) => {
    const input = Array.from(posHost.querySelectorAll('input')).find(i => i.getAttribute('aria-label') === label)!
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await wait(30)
  }
  const discountLabel = `Discount percent for ${item.name}`
  check('POS: new item discount starts blank despite catalogue default', !posHost.textContent!.includes('Default discount') && posHost.querySelector<HTMLInputElement>('[aria-label^="Discount percent for"]')?.value === '')
  check('POS: full MRP total with no automatic or hidden bill discount', posHost.querySelector('[aria-label="Sale cart"]')?.textContent?.includes('₹2,360.00') === true)
  check('POS: extra bill discount controls and summary are removed', !posHost.querySelector('[aria-label="Bill discount value"]') && !posHost.querySelector('[aria-label="Bill discount type"]') && !posHost.textContent!.includes('Extra bill discount'))
  await setPosInput(discountLabel, '')
  check('POS: item discount can stay empty while replacing the value', posHost.querySelector<HTMLInputElement>('[aria-label^="Discount percent for"]')?.value === '')
  await setPosInput(discountLabel, '0')
  check('POS: zero keeps the full MRP total', posHost.querySelector('[aria-label="Sale cart"]')?.textContent?.includes('₹2,360.00') === true)
  await setPosInput(discountLabel, '120')
  check('POS: item percentage is capped at 100', posHost.querySelector<HTMLInputElement>('[aria-label^="Discount percent for"]')?.value === '100')
  await setPosInput(discountLabel, '-5')
  check('POS: item percentage cannot be negative', posHost.querySelector<HTMLInputElement>('[aria-label^="Discount percent for"]')?.value === '0')
  await setPosInput(discountLabel, '15')
  check('POS: manual item discount updates total', posHost.querySelector('[aria-label="Sale cart"]')?.textContent?.includes('₹2,006.00') === true)
  await setPosInput(discountLabel, '')
  const discountInput = posHost.querySelector<HTMLInputElement>('[aria-label^="Discount percent for"]')!
  discountInput.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
  await wait(30)
  check('POS: cleared discount stays blank after blur and restores full price', discountInput.value === '' && posHost.querySelector('[aria-label="Sale cart"]')?.textContent?.includes('₹2,360.00') === true)
  await setPosInput(discountLabel, '15')
  posButton(item.name).click()
  await wait(30)
  check('POS: adding the same item retains manually entered discount', discountInput.value === '15')
  posHost.querySelector<HTMLButtonElement>('[aria-label^="Decrease "]')!.click()
  await wait(30)
  const checkout = posButton('Checkout & receipt')
  checkout.click(); checkout.click()
  await wait(120)
  const posInvoice = await db.invoices.get(posSaved[0])
  check('POS: checkout persists one paid invoice even after double click', posSaved.length === 1 && await db.invoices.count() === countBeforePOS + 1 && posInvoice?.items[0].qty === 2 && posInvoice.payments.length === 1 && posInvoice.payments[0].mode === 'CASH')
  check('POS: checkout persists edited discounts and matching payment', posInvoice?.items[0].discountPercent === 15 && posInvoice.billDiscountValue === 0 && posInvoice.payments[0].amount === 2006 && computeTotals(posInvoice).grandTotal === 2006)
  check('POS: sale discount does not overwrite catalogue default', (await db.items.get(item.id!))?.discountPercent === 25)
  check('POS: checkout updates catalogue stock once', (await db.items.get(item.id!))?.stockQty === stockBeforePOS - 2)
  posRoot.unmount(); posHost.remove()
  await repo.deleteInvoice(posSaved[0])
  await repo.upsertItem(item)
  const makeBill = async () => ({ ...await repo.newInvoice('TAX_INVOICE', '2026-09-01'), items: [lineFromItem(item, 2)] })

  // Two actual BillingScreen saves, with asynchronous number previews fully loaded.
  const savedIds: number[] = []
  for (let i = 0; i < 2; i++) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(createElement(BillingScreen, { draft: await makeBill(), business, onBack: () => {}, onSaved: (id) => savedIds.push(id) }))
    await wait(150)
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save')
    button?.click()
    for (let attempt = 0; attempt < 30 && savedIds.length <= i; attempt++) await wait(25)
    root.unmount()
    host.remove()
  }
  const saved = await db.invoices.bulkGet(savedIds)
  check('regression: sequential UI saves allocate distinct bill numbers', saved.length === 2 && new Set(saved.map((b) => b?.number)).size === 2)
  const first = saved[0]!
  check('regression: explicit duplicate invoice number is rejected', await rejects(() => repo.saveInvoice({ ...first, id: undefined })))
  const duplicateFixture = await db.invoices.add({ ...first, id: undefined, syncId: 'legacy-duplicate-fixture' })
  check('regression: existing duplicate-number invoice remains editable', !await rejects(() => repo.saveInvoice({ ...first, notes: 'Legacy invoice edit' })))
  await db.invoices.delete(duplicateFixture)
  await repo.recordPayment(first.id!, { date: '2026-10-08', amount: 100, mode: 'CASH' })
  const october = await repo.paymentRegister('2026-10-08', '2026-10-08')
  const september = await repo.paymentRegister('2026-09-01', '2026-09-30')
  check('regression: collections use payment date', october.length === 1 && september.length === 0)
  const stockBeforeCancel = (await db.items.get(item.id!))!.stockQty
  await repo.cancelInvoice(first.id!)
  await repo.saveInvoice({ ...(await db.invoices.get(first.id!))!, notes: 'Edit cancelled bill' })
  check('regression: editing cancelled bill leaves stock unchanged', (await db.items.get(item.id!))!.stockQty === stockBeforeCancel + 2)
  await repo.deleteInvoice(first.id!)
  check('regression: deleting cancelled bill restores stock only once', (await db.items.get(item.id!))!.stockQty === stockBeforeCancel + 2)

  const oversizedSale = { ...await makeBill(), items: [lineFromItem(item, item.stockQty + 100)] }
  const stockBefore = (await db.items.get(item.id!))!.stockQty
  const overId = await repo.saveInvoice(oversizedSale)
  await repo.cancelInvoice(overId)
  check('regression: oversold bill cancellation is reversible', (await db.items.get(item.id!))!.stockQty === stockBefore)

  const cloudBefore = await buildSnapshot(db)
  await wait(5)
  check('regression: unchanged cloud data has stable payload while backup retains export timestamp', cloudBefore === await buildSnapshot(db) && !!JSON.parse(await repo.exportBackup()).exportedAt)
  const backup = await repo.exportBackup()
  await db.payments.add({ date: '2026-10-08', direction: 'IN', partyName: 'Fixture', amount: 5, mode: 'CASH', createdAt: 1 })
  await repo.importBackup(backup, 'replace')
  check('regression: replacement backup restores all stores', await db.payments.count() === 0 && await db.invoices.count() === JSON.parse(backup).invoices.length)
  const malformed = JSON.parse(backup)
  malformed.business[0].name = 'SHOULD ROLLBACK'
  malformed.docSettings.push({ prefix: 'missing primary key' })
  check('regression: failed replacement is rejected', await rejects(() => repo.importBackup(JSON.stringify(malformed), 'replace')))
  check('regression: failed replacement rolls back business and data', (await getBusiness()).name === business.name && await db.invoices.count() === JSON.parse(backup).invoices.length)

  const replica = new ShowroomDB('review-regression-replica')
  const cleanReplica = async () => { await replica.delete(); await replica.open() }
  await cleanReplica()
  const legacyItem = { ...item, syncId: undefined }
  await replica.items.put({ ...legacyItem, id: 1, code: 'LOCAL' })
  const remote = { items: [{ ...legacyItem, id: 1, code: 'REMOTE_A' }, { ...legacyItem, id: 2, code: 'REMOTE_B' }] }
  await mergeSnapshot(replica, JSON.stringify(remote))
  check('regression: allocated sync IDs cannot overwrite another row', (await replica.items.toArray()).map((x) => x.code).sort().join(',') === 'LOCAL,REMOTE_A,REMOTE_B')
  await mergeSnapshot(replica, JSON.stringify(remote))
  check('regression: replaying legacy snapshot is idempotent', await replica.items.count() === 3)

  for (const deletedEarlier of [false, true]) {
    await cleanReplica()
    await replica.items.put({ ...legacyItem, id: 1, code: 'DELETED', syncId: 'deleted-master' })
    await replica.invoices.put({ ...await makeBill(), id: 1, number: 'HISTORY/1', items: [{ ...lineFromItem(item), itemId: 1 }] })
    if (deletedEarlier) await replica.items.delete(1)
    await mergeSnapshot(replica, JSON.stringify({
      items: [{ ...legacyItem, id: 1, code: 'REPLACEMENT', syncId: 'replacement-master' }],
      tombstones: [{ table: 'items', identity: 'deleted-master', deletedAt: Date.now() }],
    }))
    const replacement = await replica.items.where('code').equals('REPLACEMENT').first()
    check(`regression: IDs deleted ${deletedEarlier ? 'before' : 'during'} merge cannot alias historic invoice links`, replacement?.id !== 1 && !await replica.items.get(1) && (await replica.invoices.get(1))?.items[0].itemId == null)
  }

  await cleanReplica()
  await replica.items.put({ ...legacyItem, id: 10, code: 'SAME', updatedAt: 100 })
  await replica.items.put({ ...legacyItem, id: 1, code: 'OTHER', updatedAt: 100 })
  await replica.parties.put({ id: 10, name: 'Buyer', type: 'CUSTOMER', phone: '', openingBalance: 0, createdAt: 1 })
  await replica.invoices.put({ ...await makeBill(), id: 10, number: 'LINK/SOURCE', syncId: 'source', createdAt: 1 })
  const linked = {
    items: [{ ...legacyItem, id: 1, code: 'SAME', updatedAt: 200 }],
    parties: [{ id: 1, name: 'Buyer', type: 'CUSTOMER', phone: '', openingBalance: 0, createdAt: 1 }],
    invoices: [
      { ...await makeBill(), id: 1, number: 'LINK/SOURCE', syncId: 'source', createdAt: 1, updatedAt: Date.now() + 1000, convertedToId: 2, partyId: 1, items: [{ ...lineFromItem(item), itemId: 1 }] },
      { ...await makeBill(), id: 2, number: 'LINK/TARGET', syncId: 'target', createdAt: 2, fromId: 1, partyId: 1, items: [{ ...lineFromItem(item), itemId: 1 }] },
    ],
  }
  await mergeSnapshot(replica, JSON.stringify(linked))
  const source = (await replica.invoices.where('number').equals('LINK/SOURCE').first())!
  const target = (await replica.invoices.where('number').equals('LINK/TARGET').first())!
  check('regression: matching item and party IDs are remapped', target.items[0].itemId === 10 && target.partyId === 10)
  check('regression: forward and backward invoice links use invoice ID map', target.fromId === source.id && source.convertedToId === target.id)
  await mergeSnapshot(replica, JSON.stringify({ invoices: [{ ...target, syncId: 'independent', id: 70, createdAt: 999, items: [], partyId: undefined, fromId: undefined }] }))
  check('regression: independent invoices with same number survive sync', await replica.invoices.where('number').equals('LINK/TARGET').count() === 2)

  const recoveryBackup = await repo.exportBackup()
  check('regression: missing referenced identity rejects merge without clearing existing links', await rejects(() => mergeSnapshot(replica, JSON.stringify({ invoices: [{ ...target, updatedAt: Date.now() + 10000 }] }))) && (await replica.invoices.get(target.id!))?.fromId === source.id)
  const beforeDeletion = await buildSnapshot(db)
  await repo.deleteItem(item.id!)
  await mergeSnapshot(db, beforeDeletion)
  check('regression: stale cloud snapshot cannot resurrect deleted item', !await db.items.get(item.id!))
  const afterDeletion = JSON.parse(await buildSnapshot(db))
  check('regression: exports retain historical lines without deleted master links', afterDeletion.invoices.some((inv: { items: Array<{ code: string; itemId?: number }> }) => inv.items.some((line) => line.code === item.code && line.itemId == null)))
  await cleanReplica()
  await mergeSnapshot(replica, beforeDeletion)
  await mergeSnapshot(replica, await buildSnapshot(db))
  check('regression: item deletion propagates to another device', !(await replica.items.toArray()).some((r) => r.syncId === item.syncId))
  const staleDeletedSnapshot = await buildSnapshot(db)
  await repo.importBackup(recoveryBackup, 'replace')
  const recovered = await db.items.get(item.id!)
  await mergeSnapshot(db, staleDeletedSnapshot)
  check('regression: explicit backup recovery survives stale deletion markers', !!recovered && recovered.syncId !== item.syncId && !!await db.items.get(item.id!))
  const mergeBackup = JSON.parse(await repo.exportBackup())
  for (const name of ['business', 'parties', 'docSettings', 'appSettings', 'payments', 'expenses', 'tombstones']) mergeBackup[name] = []
  mergeBackup.items = [{ ...item, id: item.id, code: 'BACKUP-NEW', syncId: 'backup-unrelated-item' }]
  mergeBackup.invoices = [{ ...await makeBill(), id: 2, number: 'BACKUP/1', syncId: 'backup-unrelated-invoice', items: [{ ...lineFromItem(item), itemId: item.id }] }]
  await repo.importBackup(JSON.stringify(mergeBackup), 'merge')
  const importedItem = await db.items.where('code').equals('BACKUP-NEW').first()
  const importedInvoice = await db.invoices.where('number').equals('BACKUP/1').first()
  check('regression: merge restore preserves unrelated local ID and remaps invoice', (await db.items.get(item.id!))?.code === item.code && importedItem?.id !== item.id && importedInvoice?.items[0].itemId === importedItem?.id)
  const badMarkers = JSON.parse(await repo.exportBackup())
  badMarkers.tombstones = [{ table: 'not-a-table', identity: 'bad', deletedAt: 1 }]
  check('regression: invalid backup deletion markers rejected', await rejects(() => repo.importBackup(JSON.stringify(badMarkers), 'replace')))
  const normalized = JSON.parse(await repo.exportBackup())
  normalized.tombstones = [{ table: 'items', identity: 'absent-test-row', deletedAt: 1, key: 'incorrect' }]
  await repo.importBackup(JSON.stringify(normalized), 'merge')
  check('regression: backup marker keys are normalized', !!await db.tombstones.get('items|absent-test-row') && !await db.tombstones.get('incorrect'))
  const unchanged = await replica.items.count()
  check('regression: incomplete cloud snapshot rejected before links can be cleared', await rejects(() => mergeCompleteSnapshot(replica, JSON.stringify({ invoices: [] }))) && await replica.items.count() === unchanged)
  check('regression: malformed sync snapshot is rejected atomically', await rejects(() => mergeSnapshot(replica, JSON.stringify({ items: [legacyItem], appSettings: [null] }))) && await replica.items.count() === unchanged)
  await replica.delete()

  // Authentication is checked in the repository API, not just hidden buttons.
  auth.logout()
  const owner = await auth.addUser({ name: 'Owner', pin: '1234', role: 'OWNER' })
  check('regression: logged-out owner PIN reset denied', await rejects(() => auth.setUserPin(owner, '2222')))
  await auth.tryLogin(owner, '1234')
  const staff = await auth.addUser({ name: 'Staff', pin: '5678', role: 'STAFF' })
  await auth.tryLogin(staff, '5678')
  check('regression: staff cannot reset owner PIN or create owner', await rejects(() => auth.setUserPin(owner, '2222')) && await rejects(() => auth.addUser({ name: 'Escalation', role: 'OWNER', pin: '9999' })))
  await auth.tryLogin(owner, '1234')
  await auth.setUserPin(staff, '4444')
  check('regression: authenticated owner can change staff PIN', await auth.tryLogin(staff, '4444'))
  await auth.tryLogin(owner, '1234')
  check('regression: last owner cannot disable login accidentally', await rejects(() => auth.updateUser(owner, { active: false })))
  auth.logout()
  await db.users.clear()

  const special = 'comma,semicolon;tab\tquote"newline\n'
  check('regression: CSV delimiters round trip', parseCsvText(csvEscape(special))[0][0] === special)
  await testChunkedCloud(check)
}

async function testChunkedCloud(check: Check) {
  const realFetch = globalThis.fetch
  const docs = new Map<string, unknown>()
  let largestWrite = 0
  let wellFormedChunks = true
  let failChunk = false
  cloud.setAutoSync(false)
  cloud.setCloudConfig({ apiKey: 'synthetic-test', projectId: 'synthetic-test' })
  store.set('local', 'showroom_cloud_session', JSON.stringify({ uid: 'fixture', idToken: 'fixture', refreshToken: 'fixture', expiresAt: Date.now() + 3600000 }))
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).split('/documents/')[1]
    if (init?.method === 'PATCH') {
      if (failChunk && path.endsWith('/chunks/1')) return new Response('{}', { status: 500 })
      largestWrite = Math.max(largestWrite, new TextEncoder().encode(String(init.body)).length)
      const document = JSON.parse(String(init.body))
      const text = document.fields?.payload?.stringValue
      if (typeof text === 'string' && !text.isWellFormed()) wellFormedChunks = false
      docs.set(path, document)
      return Response.json(document)
    }
    return docs.has(path) ? Response.json(docs.get(path)) : new Response('{}', { status: 404 })
  }) as typeof fetch
  try {
    const large = JSON.stringify({ image: 'x'.repeat(99989) + '😀' + '\u0000😀क'.repeat(250000), invoices: [{ number: 'A/1' }] })
    await cloud.remoteSetCompany('fixture', 'large', large)
    const restored = await cloud.remoteGetCompany('fixture', 'large')
    check('regression: multi-megabyte cloud backup round trips below Firestore limit', restored?.payload === large && largestWrite < 1024 * 1024 && wellFormedChunks, `largest request ${largestWrite} bytes`)
    failChunk = true
    check('regression: partial cloud upload fails safely', await rejects(() => cloud.remoteSetCompany('fixture', 'large', large + ' ')))
    check('regression: partial upload preserves prior readable snapshot', (await cloud.remoteGetCompany('fixture', 'large'))?.payload === large)
    await cloud.remoteSetCompany('fixture', 'small', '{"legacy":true}')
    check('regression: legacy inline cloud snapshots remain readable', (await cloud.remoteGetCompany('fixture', 'small'))?.payload === '{"legacy":true}')
  } finally {
    globalThis.fetch = realFetch
    cloud.logoutCloud()
    cloud.setCloudConfig(null)
  }
}
