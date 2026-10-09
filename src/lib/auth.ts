/**
 * Users + login (offline, PIN-based) — MyBillBook jaisa "staff login".
 *
 * - Har company ke apne users hote hain (us company ke database me).
 * - PIN ka hash store hota hai (SHA-256, na ho to simple fallback hash).
 * - Jab tak koi user na bane, app bina login khulti hai (purana behaviour).
 * - Session sessionStorage me — tab band karne par logout.
 */

import { db } from './db'
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
}

const sessionKey = () => `showroom_session_${activeCompanyId()}`

// ---------- PIN hashing ----------

function fallbackHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(16).padStart(8, '0')
}

export async function hashPin(pin: string): Promise<string> {
  const data = `showroom|${pin}`
  try {
    const subtle = globalThis.crypto?.subtle
    if (subtle) {
      const buf = await subtle.digest('SHA-256', new TextEncoder().encode(data))
      const hex = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      return `sha256:${hex}`
    }
  } catch {
    /* fallback neeche */
  }
  return `fnv:${fallbackHash(data)}`
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (!pin || !stored) return false
  const sha = await hashPin(pin)
  if (sha === stored) return true
  // environment badal gaya ho (subtle available/na ho) to fallback se bhi check karo
  return `fnv:${fallbackHash(`showroom|${pin}`)}` === stored
}

// ---------- Users ----------

export async function getUsers(): Promise<User[]> {
  return (await db.users.toArray()).sort((a, b) => a.createdAt - b.createdAt)
}

export async function activeUsers(): Promise<User[]> {
  return (await getUsers()).filter((u) => u.active && !!u.pinHash)
}

export async function addUser(input: {
  name: string
  role: UserRole
  pin: string
  phone?: string
}): Promise<number> {
  const first = (await db.users.count()) === 0
  if (!first) await requireOwner()
  const name = input.name.trim()
  if (!name) throw new Error('Naam likhein')
  if (!/^\d{4,6}$/.test(input.pin)) throw new Error('PIN 4 se 6 ank ka hona chahiye')
  const pinHash = await hashPin(input.pin)
  return db.users.add({
    name,
    phone: input.phone?.trim() ?? '',
    role: first ? 'OWNER' : input.role,
    pinHash,
    pinLength: input.pin.length,
    active: true,
    createdAt: Date.now(),
  })
}

export async function updateUser(id: number, patch: Partial<User>): Promise<void> {
  await requireOwner()
  await protectLastOwner(id, patch.active === false || (patch.role !== undefined && patch.role !== 'OWNER'))
  await db.users.update(id, patch)
}

export async function setUserPin(id: number, pin: string): Promise<void> {
  await requireOwner()
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN 4 se 6 ank ka hona chahiye')
  await db.users.update(id, { pinHash: await hashPin(pin), pinLength: pin.length })
}

export async function deleteUser(id: number): Promise<void> {
  await requireOwner()
  await protectLastOwner(id, true)
  await db.users.delete(id)
}

export async function userCount(): Promise<number> {
  return db.users.count()
}

export async function ownerCount(): Promise<number> {
  return (await db.users.toArray()).filter((u) => u.role === 'OWNER' && u.active).length
}

// ---------- Session ----------

export function sessionUserId(): number | null {
  const raw = store.get('session', sessionKey())
  const id = raw ? Number(raw) : NaN
  return Number.isFinite(id) ? id : null
}

export function setSession(userId: number): void {
  store.set('session', sessionKey(), String(userId))
}

export function clearSession(): void {
  store.remove('session', sessionKey())
}

export async function currentUser(): Promise<User | null> {
  const id = sessionUserId()
  if (id == null) return null
  const u = await db.users.get(id)
  return u && u.active ? u : null
}

async function requireOwner(): Promise<void> {
  if ((await currentUser())?.role !== 'OWNER') throw new Error('Is kaam ke liye owner login chahiye')
}

async function protectLastOwner(id: number, removing: boolean): Promise<void> {
  const user = await db.users.get(id)
  if (removing && user?.active && user.role === 'OWNER' && await ownerCount() <= 1) {
    throw new Error('Pehle doosra active owner banayein')
  }
}

export type LoginGate = 'off' | 'login' | 'ok'

/** 'off' = koi user nahi (app khul jayegi), 'login' = login chahiye, 'ok' = session hai */
export async function checkLogin(): Promise<LoginGate> {
  const users = await activeUsers()
  if (users.length === 0) return 'off'
  const id = sessionUserId()
  if (id != null && users.some((u) => u.id === id)) return 'ok'
  return 'login'
}

export async function tryLogin(userId: number, pin: string): Promise<boolean> {
  const user = await db.users.get(userId)
  if (!user || !user.active) return false
  const ok = await verifyPin(pin, user.pinHash)
  if (ok) setSession(userId)
  return ok
}

export function logout(): void {
  clearSession()
}

/** App ke header/naam ke liye chhota label */
export function userLabel(user: User | null): string {
  if (!user) return ''
  return user.role === 'OWNER' ? `${user.name} (Owner)` : user.name
}
