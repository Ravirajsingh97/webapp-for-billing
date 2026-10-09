/** Local staff access control. Browser storage is not a server authorization boundary. */
import Dexie from 'dexie'
import { db, type ShowroomDB } from './db'
import { activeCompanyId } from './company'
import { store } from './store'

export type UserRole = 'OWNER' | 'STAFF'
export interface User {
  id?: number
  name: string
  phone?: string
  role: UserRole
  pinHash: string
  pinLength: number
  active: boolean
  createdAt: number
  loginFailures?: number
  lockedUntil?: number
  recoveryHash?: string
  recoveryFailures?: number
  recoveryLockedUntil?: number
}
export const AUTH_CHANGE_EVENT = 'showroom-auth-change'
const SESSION_MS = 8 * 60 * 60 * 1000
const ITERATIONS = 210_000
const sessionKey = (companyId = activeCompanyId()) => `showroom_session_${companyId}`
const notify = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_CHANGE_EVENT)) }
const hex = (buffer: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(buffer)).map(n => n.toString(16).padStart(2, '0')).join('')
const bytes = (value: string) => Uint8Array.from(value.match(/../g) ?? [], n => parseInt(n, 16))
const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error('Secure PIN ke liye HTTPS ya supported browser chahiye')
  return globalThis.crypto.subtle
}
const derive = async (pin: string, salt: Uint8Array, iterations: number) => {
  const api = subtle()
  const key = await api.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return hex(await api.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations }, key, 256))
}
function legacyHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(16).padStart(8, '0')
}
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2:${ITERATIONS}:${hex(salt)}:${await derive(pin, salt, ITERATIONS)}`
}
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (!/^\d{4,6}$/.test(pin) || !stored) return false
  if (stored.startsWith('pbkdf2:')) {
    const [, count, salt, expected] = stored.split(':')
    const iterations = Number(count)
    if (!Number.isSafeInteger(iterations) || iterations < ITERATIONS || iterations > 1_000_000 || !/^[a-f0-9]{32}$/.test(salt ?? '') || !/^[a-f0-9]{64}$/.test(expected ?? '')) return false
    const actual = await derive(pin, bytes(salt), iterations)
    return actual.split('').reduce((diff, c, i) => diff | (c.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0
  }
  // Existing PINs migrate only after successful verification.
  if (stored.startsWith('sha256:')) return `sha256:${hex(await subtle().digest('SHA-256', new TextEncoder().encode(`showroom|${pin}`)))}` === stored
  return stored === `fnv:${legacyHash(`showroom|${pin}`)}`
}
export const getUsers = async (): Promise<User[]> => (await db.users.toArray()).sort((a, b) => a.createdAt - b.createdAt)
export const activeUsers = async (): Promise<User[]> => (await getUsers()).filter(u => u.active && !!u.pinHash)
export const userCount = () => db.users.count()
export const ownerCount = async () => (await db.users.toArray()).filter(u => u.role === 'OWNER' && u.active && u.pinHash).length

type Session = { userId: number; credential: string; createdAt: number; expiresAt: number }
function session(companyId = activeCompanyId()): Session | null {
  try {
    const value = JSON.parse(store.get('session', sessionKey(companyId)) ?? 'null') as Session | null
    return value && Number.isSafeInteger(value.userId) && value.userId > 0 && typeof value.credential === 'string' && Number.isFinite(value.createdAt) && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() ? value : null
  } catch { return null }
}
export function sessionUserId(): number | null { return session()?.userId ?? null }
function setSession(user: User): void {
  store.set('session', sessionKey(), JSON.stringify({ userId: user.id!, credential: user.pinHash, createdAt: user.createdAt, expiresAt: Date.now() + SESSION_MS }))
}
export function clearSession(): void { store.remove('session', sessionKey()); notify() }
export async function currentUser(dbx: ShowroomDB = db, companyId = activeCompanyId()): Promise<User | null> {
  const value = session(companyId)
  if (!value) return null
  const user = await dbx.users.get(value.userId)
  if (JSON.stringify(session(companyId)) !== JSON.stringify(value)) return null
  return user?.active && user.pinHash && user.pinHash === value.credential && user.createdAt === value.createdAt ? user : null
}
export async function requireOwner(): Promise<void> {
  if ((await currentUser())?.role !== 'OWNER') throw new Error('Is kaam ke liye owner login chahiye')
}
export async function requireOwnerIfConfigured(): Promise<void> { if (await db.users.count()) await requireOwner() }
export type LoginGate = 'off' | 'login' | 'ok'
export async function checkLogin(dbx: ShowroomDB = db, companyId = activeCompanyId()): Promise<LoginGate> {
  if (await dbx.users.count() === 0) return 'off'
  return await currentUser(dbx, companyId) ? 'ok' : 'login'
}
export async function requireUnlocked(dbx: ShowroomDB = db, companyId = activeCompanyId()): Promise<void> {
  if (await checkLogin(dbx, companyId) === 'login') throw new Error('Pehle company ka PIN login karein')
}
const validatePin = (pin: string) => { if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN 4 se 6 ank ka hona chahiye') }
const validateRole = (role: UserRole) => { if (role !== 'OWNER' && role !== 'STAFF') throw new Error('Valid user role chunein') }
async function protectLastOwner(id: number, removing: boolean): Promise<void> {
  const user = await db.users.get(id)
  if (removing && user?.active && user.role === 'OWNER' && await ownerCount() <= 1) throw new Error('Pehle doosra active owner banayein')
}
export async function addUser(input: { name: string; role: UserRole; pin: string; phone?: string }): Promise<number> {
  if (!input.name.trim()) throw new Error('Naam likhein')
  validatePin(input.pin); validateRole(input.role)
  const pinHash = await hashPin(input.pin)
  const id = await db.transaction('rw', db.users, async () => {
    const first = await db.users.count() === 0
    if (!first) await requireOwner()
    return db.users.add({ name: input.name.trim(), phone: input.phone?.trim() ?? '', role: first ? 'OWNER' : input.role, pinHash, pinLength: input.pin.length, active: true, createdAt: Date.now() })
  })
  notify()
  return id
}
export async function updateUser(id: number, patch: Partial<Pick<User, 'name' | 'phone' | 'role' | 'active'>>): Promise<void> {
  if (Object.keys(patch).some(k => !['name', 'phone', 'role', 'active'].includes(k))) throw new Error('User ke protected fields nahi badal sakte')
  if (patch.role !== undefined) validateRole(patch.role)
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('Naam likhein')
  if (patch.active !== undefined && typeof patch.active !== 'boolean') throw new Error('Valid active status chunein')
  await db.transaction('rw', db.users, async () => {
    await requireOwner()
    await protectLastOwner(id, patch.active === false || (patch.role !== undefined && patch.role !== 'OWNER'))
    await db.users.update(id, { ...patch, ...(patch.active === false || patch.role === 'STAFF' ? { recoveryHash: undefined } : {}) })
  })
  notify()
}
export async function setUserPin(id: number, pin: string): Promise<void> {
  validatePin(pin)
  await requireOwner()
  const pinHash = await hashPin(pin)
  await db.transaction('rw', db.users, async () => { await requireOwner(); await db.users.update(id, { pinHash, pinLength: pin.length, loginFailures: 0, lockedUntil: 0, recoveryHash: undefined }) })
  notify()
}

const recoveryDigest = async (user: User, code: string, companyId: string) =>
  hex(await subtle().digest('SHA-256', new TextEncoder().encode(`showroom-recovery|${companyId}|${user.id}|${user.createdAt}|${code}`)))

/** Only the current owner can issue their own recovery code. Plaintext is shown once. */
export async function createOwnerRecoveryCode(): Promise<string> {
  const companyId = activeCompanyId()
  const code = hex(crypto.getRandomValues(new Uint8Array(16)))
  await db.transaction('rw', db.users, async () => {
    const user = await currentUser()
    if (user?.role !== 'OWNER') throw new Error('Recovery code ke liye owner login chahiye')
    const recoveryHash = await Dexie.waitFor(recoveryDigest(user, code, companyId))
    if (activeCompanyId() !== companyId) throw new Error('Company badal gayi; dobara try karein')
    await db.users.update(user.id!, { recoveryHash, recoveryFailures: 0, recoveryLockedUntil: 0 })
  })
  return code.match(/.{4}/g)!.join('-').toUpperCase()
}

/** A code is consumed atomically; recovery changes the PIN without opening a session. */
export async function recoverOwnerPin(userId: number, recoveryCode: string, pin: string): Promise<void> {
  validatePin(pin)
  const companyId = activeCompanyId()
  const code = recoveryCode.replace(/[\s-]/g, '').toLowerCase()
  const recovered = await db.transaction('rw', db.users, async () => {
    const user = await db.users.get(userId)
    if (!user?.active || user.role !== 'OWNER' || !user.recoveryHash) throw new Error('Recovery code set nahi hai. Kisi doosre logged-in owner se PIN badalwayein.')
    if ((user.recoveryLockedUntil ?? 0) > Date.now()) throw new Error('Bahut galat recovery attempts hue. Ek minute baad try karein')
    const actual = /^[a-f0-9]{32}$/.test(code) ? await Dexie.waitFor(recoveryDigest(user, code, companyId)) : ''
    if (!actual || actual !== user.recoveryHash) {
      const failures = (user.recoveryFailures ?? 0) + 1
      await db.users.update(userId, { recoveryFailures: failures >= 5 ? 0 : failures, recoveryLockedUntil: failures >= 5 ? Date.now() + 60_000 : 0 })
      return false
    }
    const pinHash = await Dexie.waitFor(hashPin(pin))
    if (activeCompanyId() !== companyId) throw new Error('Company badal gayi; dobara try karein')
    await db.users.update(userId, { pinHash, pinLength: pin.length, loginFailures: 0, lockedUntil: 0, recoveryHash: undefined, recoveryFailures: 0, recoveryLockedUntil: 0 })
    return true
  })
  if (!recovered) throw new Error('Recovery code galat hai — dobara check karein')
  clearSession()
}
export async function deleteUser(id: number): Promise<void> {
  await db.transaction('rw', db.users, async () => { await requireOwner(); await protectLastOwner(id, true); await db.users.delete(id) })
  notify()
}
export async function tryLogin(userId: number, pin: string): Promise<boolean> {
  const companyId = activeCompanyId()
  const ok = await db.transaction('rw', db.users, async () => {
    const user = await db.users.get(userId)
    if (!user?.active || !user.pinHash) return false
    if ((user.lockedUntil ?? 0) > Date.now()) throw new Error('Bahut galat PIN attempts hue. Ek minute baad try karein')
    const verified = await Dexie.waitFor(verifyPin(pin, user.pinHash))
    if (verified) {
      const pinHash = user.pinHash.startsWith('pbkdf2:') ? user.pinHash : await Dexie.waitFor(hashPin(pin))
      const updated = { ...user, pinHash, loginFailures: 0, lockedUntil: 0 }
      await db.users.put(updated)
      if (activeCompanyId() !== companyId) throw new Error('Company badal gayi; dobara login karein')
      setSession(updated)
      return true
    }
    const failures = (user.loginFailures ?? 0) + 1
    await db.users.update(userId, { loginFailures: failures >= 5 ? 0 : failures, lockedUntil: failures >= 5 ? Date.now() + 60_000 : 0 })
    return false
  })
  if (ok) notify()
  return ok
}
export function logout(): void { clearSession() }
export const userLabel = (user: User | null): string => !user ? '' : user.role === 'OWNER' ? `${user.name} (Owner)` : user.name
