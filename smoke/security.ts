import { db, seedDatabase, getBusiness } from '../src/lib/db'
import * as auth from '../src/lib/auth'
import * as cloud from '../src/lib/cloud'
import * as repo from '../src/lib/repo'
import { syncNow } from '../src/lib/sync'
import { activeCompanyId } from '../src/lib/company'
import { store } from '../src/lib/store'
import { startAutoSync, DATA_CHANGE_EVENT } from '../src/lib/autoSync'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/App'
import { SettingsScreen } from '../src/screens/Settings'

type Check = (name: string, ok: boolean, info?: string) => void
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false } catch { return true } }
const wait = (ms = 100) => new Promise(r => setTimeout(r, ms))
const sessionKey = () => `showroom_session_${activeCompanyId()}`
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

export async function runSecurityRegressions(check: Check) {
  console.log('\n== Login, cloud security and automation regressions ==')
  await db.delete(); await db.open(); auth.logout()
  const [a, b] = await Promise.all([auth.hashPin('1234'), auth.hashPin('1234')])
  check('security: new PIN hashes have independent salts and verify', a !== b && a.startsWith('pbkdf2:210000:') && await auth.verifyPin('1234', a) && !await auth.verifyPin('4321', a))
  const raced = await Promise.allSettled([auth.addUser({ name: 'Owner A', role: 'OWNER', pin: '1234' }), auth.addUser({ name: 'Owner B', role: 'OWNER', pin: '1234' })])
  check('security: concurrent first-user creation admits only one owner', raced.filter(r => r.status === 'fulfilled').length === 1 && await db.users.count() === 1)
  const owner = (await db.users.toArray())[0]
  store.set('session', sessionKey(), String(owner.id))
  check('security: legacy numeric session cannot unlock', await auth.checkLogin() === 'login')
  await auth.tryLogin(owner.id!, '1234')
  const ownerSession = store.get('session', sessionKey())!
  store.set('session', sessionKey(), JSON.stringify({ ...JSON.parse(ownerSession), expiresAt: Date.now() - 1 }))
  check('security: expired local session locks gate', await auth.checkLogin() === 'login')
  store.set('session', sessionKey(), ownerSession)
  check('security: protected user fields cannot disable PIN gate', await rejects(() => auth.updateUser(owner.id!, { pinHash: '' } as never)))
  await auth.setUserPin(owner.id!, '2222')
  check('security: PIN change revokes existing credential session', await auth.currentUser() === null && await auth.checkLogin() === 'login')
  await auth.tryLogin(owner.id!, '2222')
  const secondOwner = await auth.addUser({ name: 'Second', role: 'OWNER', pin: '3333' })
  const removes = await Promise.allSettled([auth.updateUser(owner.id!, { active: false }), auth.updateUser(secondOwner, { active: false })])
  check('security: concurrent owner removals cannot remove last owner', removes.some(r => r.status === 'rejected') && await auth.ownerCount() >= 1)
  const remaining = (await auth.activeUsers())[0]
  await auth.tryLogin(remaining.id!, remaining.id === owner.id ? '2222' : '3333')
  const staff = await auth.addUser({ name: 'Staff', role: 'STAFF', pin: '4444' })
  await auth.tryLogin(staff, '4444')
  check('security: staff cannot export, restore or wipe company data', await rejects(() => repo.exportBackup()) && await rejects(() => repo.importBackup('{}')) && await rejects(() => repo.wipeAllData()))
  await seedDatabase()
  const host = document.createElement('div'); document.body.append(host)
  let root = createRoot(host)
  root.render(createElement(SettingsScreen, { business: await getBusiness(), onBusinessChange() {}, onOpenParties() {} })); await wait(250)
  check('security UI: staff settings hide cloud and destructive controls', host.textContent!.includes('owner login chahiye') && !host.textContent!.includes('Cloud account (Google') && !host.textContent!.includes('Backup download'))
  root.unmount(); root = createRoot(host)
  auth.logout()
  check('security: locked company rejects financial and stock mutations', await rejects(() => repo.upsertParty({ name: 'Denied', type: 'CUSTOMER', createdAt: Date.now() })) && await rejects(() => repo.adjustStock(1, 1)) && await rejects(() => repo.recordPayment(1, { amount: 1, date: '2026-10-09', mode: 'CASH' })))
  for (let i = 0; i < 5; i++) await auth.tryLogin(staff, '9999')
  check('security: wrong PIN attempts persist lockout across calls', await rejects(() => auth.tryLogin(staff, '4444')) && (await db.users.get(staff))!.lockedUntil! > Date.now())
  await db.users.update(staff, { lockedUntil: Date.now() - 1 })
  check('security: lockout expiry allows correct PIN', await auth.tryLogin(staff, '4444'))
  auth.logout()
  const legacy = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('showroom|5555')))).map(n => n.toString(16).padStart(2, '0')).join('')}`
  await db.users.update(staff, { pinHash: legacy, pinLength: 4 })
  check('security: successful legacy login upgrades stored hash', await auth.tryLogin(staff, '5555') && (await db.users.get(staff))!.pinHash.startsWith('pbkdf2:'))
  auth.logout()
  await db.users.update(staff, { active: false })
  await db.users.toCollection().modify({ active: false })
  check('security: disabled users do not turn login gate off', await auth.checkLogin() === 'login')
  // Onboarding must remain behind the gate even after a reset/non-onboarded setting.
  await db.appSettings.put({ key: 'onboarded', value: 'no' })
  root.render(createElement(App)); await wait(250)
  check('security UI: locked company cannot bypass gate through onboarding', host.textContent!.includes('Kaun login kar raha hai') && !host.textContent!.includes('Aapka data sirf'))
  const originalCount = db.users.count.bind(db.users)
  db.users.count = (() => Promise.reject(new Error('Synthetic auth storage failure'))) as typeof db.users.count
  window.dispatchEvent(new Event(auth.AUTH_CHANGE_EVENT)); await wait(200)
  check('security UI: auth storage failure stays locked', host.textContent!.includes('Login verify nahi ho paya') && !host.textContent!.includes('Naya Bill'))
  db.users.count = originalCount
  root.unmount(); host.remove(); await db.users.clear(); auth.logout()

  // Scheduler uses deterministic synthetic timers; no clock sleeps required.
  const timers = new Map<number, { cb: () => void; delay: number }>(); let nextId = 0, runs = 0, time = 0
  let enabled = true, fail = true, release: (() => void) | undefined
  const schedule = ((cb: () => void, delay: number) => { timers.set(++nextId, { cb, delay }); return nextId }) as unknown as typeof setTimeout
  const cancel = ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout
  const stop = startAutoSync({ enabled: () => enabled, target: window, schedule, cancel, now: () => time, run: async () => { runs++; if (release) await new Promise<void>(r => { release = r }); if (fail) throw Error('Transient') } })
  const fire = async () => { const [id, timer] = [...timers][0]; timers.delete(id); timer.cb(); await wait(0) }
  await fire()
  check('automation: failed sync backs off without overlapping timers', runs === 1 && timers.size === 1 && [...timers.values()][0].delay === 5_000)
  await fire()
  check('automation: repeated failures increase backoff', [...timers.values()][0].delay === 10_000)
  fail = false; await fire()
  check('automation: successful sync resets periodic delay', [...timers.values()][0].delay === 180_000)
  window.dispatchEvent(new Event(DATA_CHANGE_EVENT)); window.dispatchEvent(new Event(DATA_CHANGE_EVENT))
  check('automation: write bursts debounce to one sync timer', timers.size === 1 && [...timers.values()][0].delay === 2_000)
  time = 11_000; window.dispatchEvent(new Event(DATA_CHANGE_EVENT))
  check('automation: continuous writes cannot postpone sync indefinitely', [...timers.values()][0].delay === 0)
  release = () => {}; const beforeSlow = runs; await fire()
  window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event(DATA_CHANGE_EVENT))
  check('automation: slow sync cannot build queued timers', runs === beforeSlow + 1 && timers.size === 0)
  release!(); release = undefined; await wait(0)
  enabled = false; const beforeDisabled = runs; await fire()
  check('automation: disabled preference blocks pending timer', runs === beforeDisabled)
  enabled = true
  const onlineDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine')
  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
  window.dispatchEvent(new Event('online'))
  check('automation: offline tab waits for reconnection', timers.size === 0)
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
  window.dispatchEvent(new Event('online'))
  check('automation: reconnection schedules immediate sync', timers.size === 1 && [...timers.values()][0].delay === 0)
  if (onlineDescriptor) Object.defineProperty(window.navigator, 'onLine', onlineDescriptor)
  else delete (window.navigator as unknown as { onLine?: boolean }).onLine
  stop(); check('automation: cleanup removes timer', timers.size === 0)

  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>(); let mutations = 0, blocked = false
  const syntheticStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { mutations++; if (blocked) throw Error('Storage blocked'); values.set(key, value) }, removeItem: (key: string) => { mutations++; if (blocked) throw Error('Storage blocked'); values.delete(key) } }
  Object.defineProperty(globalThis, 'localStorage', { value: syntheticStorage, configurable: true })
  try {
    store.set('local', 'security-storage-fixture', 'old'); const beforeReads = mutations
    store.get('local', 'security-storage-fixture'); store.get('local', 'security-storage-fixture')
    check('automation: storage reads do not generate storage writes', mutations === beforeReads)
    blocked = true; store.set('local', 'security-storage-fixture', 'new')
    check('security: failed storage writes mask stale persistent values', store.get('local', 'security-storage-fixture') === 'new')
    store.remove('local', 'security-storage-fixture'); blocked = false
    check('security: failed removal cannot resurrect old stored session', store.get('local', 'security-storage-fixture') === null)
    store.remove('local', 'security-storage-fixture')
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
    else delete (globalThis as { localStorage?: Storage }).localStorage
  }

  const originalFetch = globalThis.fetch
  const cfg = { apiKey: 'synthetic', projectId: 'security-fixture' }
  cloud.logoutCloud(); cloud.setCloudConfig(cfg); cloud.setAutoSync(false)
  const saved = { uid: 'secure-user', email: 'synthetic@example.test', idToken: 'old', refreshToken: 'refresh', expiresAt: 0, signedInAt: 1 }
  store.set('local', 'showroom_cloud_session', JSON.stringify(saved))
  let resolveFetch: ((response: Response) => void) | undefined, calls = 0
  globalThis.fetch = (async () => { calls++; return new Promise<Response>(resolve => { resolveFetch = resolve }) }) as typeof fetch
  try {
    const p1 = cloud.freshToken(), p2 = cloud.freshToken(); await wait(0)
    resolveFetch!(json({ id_token: 'fresh', refresh_token: 'rotated', expires_in: '3600', user_id: saved.uid }))
    check('security: concurrent refresh uses one request', await p1 === 'fresh' && await p2 === 'fresh' && calls === 1)
    store.set('local', 'showroom_cloud_session', JSON.stringify(saved))
    const staleRefresh = cloud.freshToken(); const staleResult = rejects(() => staleRefresh); await wait(0); cloud.logoutCloud()
    resolveFetch!(json({ id_token: 'late', refresh_token: 'late-refresh', expires_in: '3600' }))
    check('security: late refresh cannot undo cloud logout', await staleResult && !cloud.getSession())
    const login = cloud.signInEmail('synthetic@example.test', 'secret123'); const loginResult = rejects(() => login); await wait(0); cloud.logoutCloud()
    resolveFetch!(json({ localId: saved.uid, idToken: 'late', refreshToken: 'late', expiresIn: '3600' }))
    check('security: late login cannot undo logout', await loginResult && !cloud.getSession())
    store.set('local', 'showroom_cloud_session', JSON.stringify({ ...saved, expiresAt: Date.now() + 3600000 }))
    check('security: token cannot access another account path', await rejects(() => cloud.fsGet('showroomUsers/other-user')))
    const staleRead = cloud.fsGet(`showroomUsers/${saved.uid}`); const readResult = rejects(() => staleRead); await wait(0); cloud.logoutCloud()
    resolveFetch!(json({ fields: {} }))
    check('security: logout discards in-flight cloud response', await readResult)
    store.set('local', 'showroom_cloud_session', JSON.stringify({ ...saved, expiresAt: Date.now() + 3600000 }))
    const beforeOff = calls
    check('automation: auto-sync off blocks automatic API calls', await rejects(() => syncNow({ automatic: true })) && calls === beforeOff)
    store.set('local', `showroom_cloud_owner_${activeCompanyId()}`, JSON.stringify(['other-project', saved.uid]))
    check('security: company binding blocks cross-project/account merge', await rejects(() => syncNow()) && calls === beforeOff)
    // An old queued sync must not run under a newly signed-in account.
    store.remove('local', `showroom_cloud_owner_${activeCompanyId()}`)
    const queued = syncNow(); const queuedResult = rejects(() => queued)
    cloud.logoutCloud()
    store.set('local', 'showroom_cloud_session', JSON.stringify({ ...saved, uid: 'replacement', signedInAt: 2, expiresAt: Date.now() + 3600000 }))
    check('security: queued sync rejects account replacement before network', await queuedResult && calls === beforeOff)
    const originalTimer = globalThis.setTimeout
    globalThis.setTimeout = ((cb: (...args: unknown[]) => void, delay: number, ...args: unknown[]) => originalTimer(cb, delay === 30_000 ? 1 : delay, ...args)) as typeof setTimeout
    globalThis.fetch = (async (_url, init) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }) })) as typeof fetch
    try { check('automation: stalled provider request aborts within timeout', await rejects(() => cloud.fsGet('showroomUsers/replacement'))) }
    finally { globalThis.setTimeout = originalTimer }

    cloud.setCloudConfig({ ...cfg, projectId: 'another-project' })
    check('security: changing Firebase project revokes cloud session', cloud.getSession() === null)
    store.set('local', 'showroom_cloud_session', JSON.stringify(saved))
    globalThis.fetch = (async () => json({ error: { message: 'USER_DISABLED' } }, 400)) as typeof fetch
    check('security: revoked refresh token clears cloud session', await rejects(() => cloud.freshToken()) && !cloud.getSession())
  } finally {
    globalThis.fetch = originalFetch; cloud.logoutCloud(); cloud.setCloudConfig(null); cloud.setAutoSync(false)
    store.remove('local', `showroom_cloud_owner_${activeCompanyId()}`)
    auth.logout(); await db.delete(); await db.open()
  }
}
