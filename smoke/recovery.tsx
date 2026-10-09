import { createRoot } from 'react-dom/client'
import { db, seedDatabase } from '../src/lib/db'
import * as auth from '../src/lib/auth'
import * as cloud from '../src/lib/cloud'
import { store } from '../src/lib/store'
import { activeCompanyId } from '../src/lib/company'
import App from '../src/App'
import { LoginScreen } from '../src/screens/Auth'
import { CloudCard } from '../src/components/CloudCard'

type Check = (name: string, ok: boolean) => void
const rejected = async (fn: () => Promise<unknown>) => { try { await fn(); return false } catch { return true } }
const wait = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms))

export async function runRecoveryRegressions(check: Check) {
  await db.delete(); await db.open(); auth.logout()
  check('recovery: logged-out code generation denied', await rejected(auth.createOwnerRecoveryCode))
  const owner = await auth.addUser({ name: 'Recovery Owner', role: 'OWNER', pin: '1234' })
  await auth.tryLogin(owner, '1234')
  const staff = await auth.addUser({ name: 'Recovery Staff', role: 'STAFF', pin: '4321' })
  const first = await auth.createOwnerRecoveryCode()
  const stored = (await db.users.get(owner))!.recoveryHash!
  check('recovery: high-entropy code stored only as digest', /^[A-F0-9]{4}(?:-[A-F0-9]{4}){7}$/.test(first) && /^[a-f0-9]{64}$/.test(stored) && !JSON.stringify(await db.users.toArray()).includes(first.replace(/-/g, '').toLowerCase()))
  const code = await auth.createOwnerRecoveryCode()
  const credential = (await db.users.get(owner))!.pinHash
  check('recovery: rotation revokes previous code', first !== code && await rejected(() => auth.recoverOwnerPin(owner, first, '5678')) && (await db.users.get(owner))!.pinHash === credential)
  const oldSession = store.get('session', `showroom_session_${activeCompanyId()}`)!
  await auth.tryLogin(staff, '4321')
  check('recovery: staff cannot issue a code or recover their own PIN', await rejected(auth.createOwnerRecoveryCode) && await rejected(() => auth.recoverOwnerPin(staff, code, '5678')))
  auth.logout()
  check('recovery: invalid new PIN preserves recovery credential', await rejected(() => auth.recoverOwnerPin(owner, code, '12')) && (await db.users.get(owner))!.recoveryHash !== undefined)
  for (let i = 0; i < 4; i++) await rejected(() => auth.recoverOwnerPin(owner, 'wrong', '5678'))
  check('recovery: fifth failed attempt persists lockout', (await db.users.get(owner))!.recoveryLockedUntil! > Date.now() && await rejected(() => auth.recoverOwnerPin(owner, code, '5678')))
  await db.users.update(owner, { recoveryLockedUntil: Date.now() - 1, lockedUntil: Date.now() + 60_000 })
  await auth.recoverOwnerPin(owner, code.toLowerCase().replace(/-/g, ' '), '56789')
  const recovered = (await db.users.get(owner))!
  check('recovery: valid code resets PIN lockout and stays logged out', await auth.verifyPin('56789', recovered.pinHash) && recovered.pinLength === 5 && !recovered.recoveryHash && recovered.lockedUntil === 0 && await auth.checkLogin() === 'login')
  check('recovery: consumed code cannot be reused', await rejected(() => auth.recoverOwnerPin(owner, code, '9999')))
  store.set('session', `showroom_session_${activeCompanyId()}`, oldSession)
  check('recovery: old tab session revoked after recovery', await auth.currentUser() === null)
  await auth.tryLogin(owner, '56789')
  const racedCode = await auth.createOwnerRecoveryCode()
  const race = await Promise.allSettled([auth.recoverOwnerPin(owner, racedCode, '1111'), auth.recoverOwnerPin(owner, racedCode, '2222')])
  check('recovery: concurrent redemption succeeds exactly once', race.filter(result => result.status === 'fulfilled').length === 1)
  const racedUser = (await db.users.get(owner))!
  await auth.tryLogin(owner, await auth.verifyPin('1111', racedUser.pinHash) ? '1111' : '2222')
  const other = await auth.addUser({ name: 'Other Owner', role: 'OWNER', pin: '8888' })
  const boundCode = await auth.createOwnerRecoveryCode()
  await auth.tryLogin(other, '8888')
  await auth.createOwnerRecoveryCode()
  check('recovery: code is bound to its owner', await rejected(() => auth.recoverOwnerPin(other, boundCode, '9999')))
  await auth.updateUser(owner, { role: 'STAFF' })
  await auth.updateUser(owner, { role: 'OWNER' })
  check('recovery: demotion revokes code after role restored', !(await db.users.get(owner))!.recoveryHash && await rejected(() => auth.recoverOwnerPin(owner, boundCode, '9999')))
  await auth.setUserPin(other, '7777')
  check('recovery: normal PIN change revokes recovery code', !(await db.users.get(other))!.recoveryHash)

  const host = document.createElement('div'); document.body.append(host)
  let root = createRoot(host)
  await auth.tryLogin(other, '7777')
  await seedDatabase(); await db.appSettings.put({ key: 'onboarded', value: 'yes' })
  root.render(<App />); await wait(250)
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '⚙️')!.click(); await wait(150)
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Owner PIN recovery code')!.click(); await wait()
  host.querySelector<HTMLButtonElement>('.sheet button.btn-primary')!.click(); await wait(250)
  check('recovery UI: app keeps setup open with selectable code after generation', /^[A-F0-9]{4}(?:-[A-F0-9]{4}){7}$/.test(host.querySelector<HTMLTextAreaElement>('#owner-recovery-code')?.value ?? ''))
  root.unmount(); root = createRoot(host); auth.logout()
  root.render(<LoginScreen onLoggedIn={() => {}} />); await wait(150)
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('Recovery Owner'))!.click(); await wait()
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('Recovery karein'))!.click(); await wait()
  check('recovery UI: unconfigured owner gets explicit recovery guidance', document.body.textContent!.includes('recovery code set nahi hai') && !document.querySelector('#recovery-input'))
  root.unmount(); root = createRoot(host); await db.users.clear()

  const originalFetch = globalThis.fetch
  cloud.logoutCloud(); cloud.setCloudConfig({ apiKey: 'synthetic', projectId: 'recovery-tests' }); cloud.setAutoSync(false)
  let calls = 0, body: Record<string, unknown> = {}, release: ((response: Response) => void) | undefined
  globalThis.fetch = (async (_url, options) => { calls++; body = JSON.parse(String(options?.body)); return new Promise<Response>(resolve => { release = resolve }) }) as typeof fetch
  try {
    root.render(<CloudCard />); await wait()
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('Login / Sign up'))!.click(); await wait()
    const input = document.querySelector<HTMLInputElement>('input[type=email]')!
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'synthetic@example.test')
    input.dispatchEvent(new window.Event('input', { bubbles: true })); await wait()
    const forgot = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('Password bhool gaye'))!
    forgot.click(); forgot.click(); await wait()
    check('cloud recovery UI: duplicate reset click sends one request and locks controls', calls === 1 && forgot.disabled && body.requestType === 'PASSWORD_RESET' && body.email === 'synthetic@example.test')
    release!(new Response(JSON.stringify({ error: { message: 'INVALID_EMAIL' } }), { status: 400 })); await wait()
    check('cloud recovery UI: provider failure is visible and retry available', document.body.textContent!.includes('Email theek se likhein') && !forgot.disabled)
    forgot.click(); await wait()
    release!(new Response(JSON.stringify({ email: body.email }), { status: 200 })); await wait()
    check('cloud recovery: email reset leaves account logged out', calls === 2 && !cloud.isSignedIn() && !forgot.disabled)
  } finally {
    root.unmount(); host.remove(); globalThis.fetch = originalFetch
    cloud.logoutCloud(); cloud.setCloudConfig(null); auth.logout(); await db.delete(); await db.open()
  }
}
