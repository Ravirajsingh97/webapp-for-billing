import { requireOwnerIfConfigured, requireUnlocked } from './auth'
/**
 * Cloud account (Firebase Auth + Firestore) — REST API se, SDK ke bina.
 *
 * Kyun REST: bundle chhota rehta hai aur offline-first app me sirf sync ke waqt
 * network chahiye hota hai.
 *
 * Setup (ek baar, ~5 min): Firebase project banayein → Authentication me
 * Email/Password + Google enable karein → Firestore banayein → web app ka
 * config Settings → "Cloud account" me paste karein. Poora guide UI me hai.
 */

import { store } from './store'

const CFG_KEY = 'showroom_cloud_config'
const SESSION_KEY = 'showroom_cloud_session'
const AUTO_KEY = 'showroom_cloud_autosync'
export const CLOUD_CHANGE_EVENT = 'showroom-cloud-change'
const notifyCloudChange = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLOUD_CHANGE_EVENT))
}

export interface CloudConfig {
  apiKey: string
  projectId: string
  authDomain?: string
  appId?: string
  /** Google sign-in ke liye OAuth web client id (optional) */
  googleClientId?: string
}

export interface CloudSession {
  uid: string
  email: string
  idToken: string
  refreshToken: string
  /** epoch ms */
  expiresAt: number
  signedInAt: number
}

export class CloudError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** Firebase error code → Hinglish message */
function friendly(code: string, fallback: string): string {
  const map: Record<string, string> = {
    EMAIL_EXISTS: 'Ye email pehle se registered hai — "Login" tab se aayein',
    EMAIL_NOT_FOUND: 'Ye email registered nahi hai — pehle "Naya account" banayein',
    INVALID_PASSWORD: 'Email ya password galat hai',
    INVALID_LOGIN_CREDENTIALS: 'Email ya password galat hai',
    INVALID_EMAIL: 'Email theek se likhein',
    MISSING_PASSWORD: 'Password likhein',
    WEAK_PASSWORD: 'Password kam se kam 6 characters ka rakhein',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Bahut baar galat try hua — thodi der baad try karein',
    USER_DISABLED: 'Ye account band kar diya gaya hai',
    OPERATION_NOT_ALLOWED: 'Firebase me Email/Password sign-in enable nahi hai (console me on karein)',
    CONFIGURATION_NOT_FOUND: 'Firebase project ki settings theek nahi — config dobara paste karein',
    INVALID_IDP_RESPONSE: 'Google login verify nahi ho paya — dobara try karein',
  }
  return map[code] ?? fallback
}

/** Web aur test/node dono me chalta hai */
function currentOrigin(): string {
  try {
    return typeof location !== 'undefined' && location.origin ? location.origin : 'http://localhost'
  } catch {
    return 'http://localhost'
  }
}

async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined
    const code = (err?.message ?? 'UNKNOWN').split(' ')[0]
    throw new CloudError(code, friendly(code, err?.message ?? 'Cloud se baat nahi ho payi'))
  }
  return json
}

// Bound every request; disconnected/slow requests cannot block the sync queue forever.
async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const body = await response.text()
    return new Response(body || null, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
  finally { clearTimeout(timer) }
}
let authGeneration = 0
function context(): string {
  const cfg = getCloudConfig(), session = getSession()
  return JSON.stringify([authGeneration, cfg?.projectId, cfg?.apiKey, session?.uid, session?.signedInAt])
}
export const cloudContext = (): string => context()
function assertContext(expected: string): void {
  if (context() !== expected) throw new CloudError('AUTH_CHANGED', 'Cloud account/setup badal gaya; dobara try karein')
}

// ---------------- Config ----------------

export function getCloudConfig(): CloudConfig | null {
  try {
    const raw = store.get('local', CFG_KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw) as CloudConfig
    if (!cfg?.apiKey || !/^[a-zA-Z0-9_-]+$/.test(cfg.projectId)) return null
    return cfg
  } catch {
    return null
  }
}

export function setCloudConfig(cfg: CloudConfig | null): void {
  const changed = JSON.stringify(getCloudConfig()) !== JSON.stringify(cfg)
  if (changed) { authGeneration++; saveSession(null) }
  if (!cfg) store.remove('local', CFG_KEY)
  else store.set('local', CFG_KEY, JSON.stringify(cfg))
  notifyCloudChange()
}

export const isCloudConfigured = (): boolean => !!getCloudConfig()

/** Firebase console se copy kiya hua config text se apiKey/projectId nikalta hai */
export function parseFirebaseConfig(text: string): CloudConfig {
  const grab = (key: string): string => {
    const m = text.match(new RegExp(`${key}\\s*[:=]\\s*["'\`]([^"'\`]+)["'\`]`))
    return m?.[1]?.trim() ?? ''
  }
  const apiKey = grab('apiKey')
  const projectId = grab('projectId') || grab('projectID')
  if (!apiKey || !projectId) {
    throw new Error('Config me apiKey ya projectId nahi mila — Firebase console se poora config paste karein')
  }
  return {
    apiKey,
    projectId,
    authDomain: grab('authDomain') || `${projectId}.firebaseapp.com`,
    appId: grab('appId') || undefined,
    googleClientId: grab('googleClientId') || undefined,
  }
}

// ---------------- Session ----------------

export function getSession(): CloudSession | null {
  try {
    const raw = store.get('local', SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as CloudSession
    return s && typeof s.uid === 'string' && s.uid && typeof s.refreshToken === 'string' && s.refreshToken && typeof s.idToken === 'string' && Number.isFinite(s.expiresAt) ? s : null
  } catch {
    return null
  }
}

function saveSession(s: CloudSession | null): void {
  const previousUid = getSession()?.uid
  if (!s) store.remove('local', SESSION_KEY)
  else store.set('local', SESSION_KEY, JSON.stringify(s))
  if (previousUid !== s?.uid) notifyCloudChange()
}

export const isSignedIn = (): boolean => !!getSession()
export const signedInEmail = (): string => getSession()?.email ?? ''
export const signedInUid = (): string => getSession()?.uid ?? ''

export function autoSyncEnabled(): boolean {
  return store.get('local', AUTO_KEY) !== 'no'
}
export function setAutoSync(on: boolean): void {
  store.set('local', AUTO_KEY, on ? 'yes' : 'no')
  notifyCloudChange()
}

async function applyAuthResult(json: Record<string, unknown>, email: string, generation: number): Promise<CloudSession> {
  const cfg = getCloudConfig()
  const idToken = String(json.idToken ?? '')
  const refreshToken = String(json.refreshToken ?? '')
  const expiresIn = Number(json.expiresIn ?? 3600)
  let uid = String(json.localId ?? '')
  if (generation !== authGeneration) throw new CloudError('AUTH_CHANGED', 'Login cancel ho gaya')
  if (!uid && cfg) uid = await lookupUid(idToken, cfg.apiKey)
  if (generation !== authGeneration) throw new CloudError('AUTH_CHANGED', 'Login cancel ho gaya; dobara try karein')
  if (!uid || !idToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new CloudError('INVALID_AUTH_RESPONSE', 'Cloud login response invalid hai')
  const session: CloudSession = {
    uid,
    email: String(json.email ?? email),
    idToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    signedInAt: Date.now(),
  }
  saveSession(session)
  return session
}

async function lookupUid(idToken: string, apiKey: string): Promise<string> {
  const json = await post(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, { idToken })
  const users = json.users as Array<{ localId?: string }> | undefined
  return users?.[0]?.localId ?? ''
}

function requireConfig(): CloudConfig {
  const cfg = getCloudConfig()
  if (!cfg) throw new CloudError('NOT_CONFIGURED', 'Pehle cloud setup karein (Firebase config paste karein)')
  return cfg
}

// ---------------- Auth ----------------

export async function signUpEmail(email: string, password: string): Promise<CloudSession> {
  await requireOwnerIfConfigured()
  const cfg = requireConfig()
  const generation = ++authGeneration
  const json = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`, {
    email,
    password,
    returnSecureToken: true,
  })
  return applyAuthResult(json, email, generation)
}

export async function signInEmail(email: string, password: string): Promise<CloudSession> {
  await requireOwnerIfConfigured()
  const cfg = requireConfig()
  const generation = ++authGeneration
  const json = await post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.apiKey}`,
    { email, password, returnSecureToken: true },
  )
  return applyAuthResult(json, email, generation)
}

export async function sendPasswordReset(email: string): Promise<void> {
  await requireOwnerIfConfigured()
  const cfg = requireConfig()
  await post(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${cfg.apiKey}`, {
    requestType: 'PASSWORD_RESET',
    email,
  })
}

/** Google (Google Identity Services) ke ID token se Firebase login */
export async function signInWithGoogleIdToken(idToken: string): Promise<CloudSession> {
  await requireOwnerIfConfigured()
  const cfg = requireConfig()
  const generation = ++authGeneration
  const json = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${cfg.apiKey}`, {
    postBody: new URLSearchParams({ id_token: idToken, providerId: 'google.com' }).toString(),
    requestUri: currentOrigin(),
    returnSecureToken: true,
  })
  return applyAuthResult(json, String(json.email ?? 'google-user'), generation)
}

export function logoutCloud(): void {
  authGeneration++
  saveSession(null)
}

/** Token ki validity check; expire ho raha ho to refresh */
let tokenFlight: { key: string; promise: Promise<string> } | undefined
export async function freshToken(): Promise<string> {
  const cfg = requireConfig(), session = getSession()
  if (!session) throw new CloudError('NOT_SIGNED_IN', 'Pehle login karein')
  if (session.idToken && Date.now() < session.expiresAt - 60_000) return session.idToken
  const expected = context()
  const key = JSON.stringify([expected, session.refreshToken])
  if (tokenFlight?.key === key) return tokenFlight.promise
  const promise = (async () => {
    try {
      const json = await post(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg.apiKey)}`, { grant_type: 'refresh_token', refresh_token: session.refreshToken })
      assertContext(expected)
      const seconds = Number(json.expires_in)
      if (!json.id_token || !json.refresh_token || !Number.isFinite(seconds) || seconds <= 0 || (json.user_id && json.user_id !== session.uid)) throw new CloudError('INVALID_AUTH_RESPONSE', 'Token refresh response invalid hai')
      const updated = { ...session, idToken: String(json.id_token), refreshToken: String(json.refresh_token), expiresAt: Date.now() + seconds * 1000 }
      saveSession(updated)
      return updated.idToken
    } catch (e) {
      if (context() === expected && e instanceof CloudError && ['INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND'].includes(e.code)) saveSession(null)
      throw e
    }
  })()
  tokenFlight = { key, promise }
  try { return await promise }
  finally { if (tokenFlight?.promise === promise) tokenFlight = undefined }
}

// ---------------- Firestore (REST) ----------------

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { mapValue: { fields: Record<string, FsValue> } }
  | { arrayValue: { values: FsValue[] } }

function toFs(value: unknown): FsValue {
  if (value == null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFs) } }
  const fields: Record<string, FsValue> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) fields[k] = toFs(v)
  return { mapValue: { fields } }
}

function fromFs(v: FsValue): unknown {
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  if ('nullValue' in v) return null
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromFs)
  if ('mapValue' in v) {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v.mapValue.fields ?? {})) out[k] = fromFs(val)
    return out
  }
  return null
}

const base = (cfg: CloudConfig) =>
  `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`

function encodeFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const fields: Record<string, FsValue> = {}
  for (const [k, v] of Object.entries(obj)) fields[k] = toFs(v)
  return fields
}

/** Ek document read — na mile to null */
export async function fsGet(path: string): Promise<Record<string, unknown> | null> {
  await requireUnlocked()
  const expected = context()
  const account = getSession()
  if (!account || !path.startsWith(`showroomUsers/${encodeURIComponent(account.uid)}/`) && path !== `showroomUsers/${encodeURIComponent(account.uid)}`) throw new CloudError('ACCOUNT_MISMATCH', 'Cloud path account se match nahi karta')
  const cfg = requireConfig()
  const token = await freshToken()
  await requireUnlocked()
  assertContext(expected)
  const res = await request(`${base(cfg)}/${path}`, { headers: { Authorization: `Bearer ${token}` } })
  await requireUnlocked()
  assertContext(expected)
  if (res.status === 404) return null
  const json = (await res.json().catch(() => ({}))) as { updateTime?: string; fields?: Record<string, FsValue>; error?: { message?: string } }
  if (!res.ok) {
    const code = (json.error?.message ?? 'FIRESTORE_ERROR').split(' ')[0]
    throw new CloudError(code, 'Cloud me data save nahi ho paya — Firestore rules check karein')
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(json.fields ?? {})) out[k] = fromFs(v)
  if (json.updateTime) out.__updateTime = json.updateTime
  return out
}

/** Document likho (na ho to ban jata hai) */
export async function fsSet(path: string, data: Record<string, unknown>, expectedUpdateTime?: string | null): Promise<void> {
  await requireUnlocked()
  const expected = context()
  const account = getSession()
  if (!account || !path.startsWith(`showroomUsers/${encodeURIComponent(account.uid)}/`) && path !== `showroomUsers/${encodeURIComponent(account.uid)}`) throw new CloudError('ACCOUNT_MISMATCH', 'Cloud path account se match nahi karta')
  const cfg = requireConfig()
  const token = await freshToken()
  await requireUnlocked()
  assertContext(expected)
  const params = new URLSearchParams()
  if (expectedUpdateTime === null) params.set('currentDocument.exists', 'false')
  else if (expectedUpdateTime !== undefined) params.set('currentDocument.updateTime', expectedUpdateTime)
  const query = params.size ? `?${params}` : ''
  const res = await request(`${base(cfg)}/${path}${query}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields: encodeFields(data) }),
  })
  await requireUnlocked()
  assertContext(expected)
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    const code = (json.error?.message ?? 'FIRESTORE_ERROR').split(' ')[0]
    if (res.status === 409 || res.status === 412 || code === 'FAILED_PRECONDITION' || code === 'ALREADY_EXISTS') throw new CloudError('SYNC_CONFLICT', 'Cloud data doosre device par badal gaya; dobara sync karein')
    throw new CloudError(code, 'Cloud me data save nahi ho paya — Firestore rules check karein')
  }
}

// ---------------- High level cloud store ----------------

export interface RemoteCompany {
  id: string
  name: string
  createdAt: number
}

export interface RemoteCompanyDoc {
  payload: string
  updatedAt: number
  updatedBy: string
  updateTime?: string
}

const userPath = (uid: string) => `showroomUsers/${encodeURIComponent(uid)}`
const companyPath = (uid: string, companyId: string) => `${userPath(uid)}/companies/${encodeURIComponent(companyId)}`

export async function remoteGetRegistry(uid: string): Promise<{ companies: RemoteCompany[]; updateTime?: string } | null> {
  const doc = await fsGet(userPath(uid))
  if (!doc) return null
  const companies = Array.isArray(doc.companies) ? (doc.companies as RemoteCompany[]).filter(c => c && typeof c.id === 'string') : []
  return { companies, updateTime: typeof doc.__updateTime === 'string' ? doc.__updateTime : undefined }
}

export async function remoteGetCompanies(uid: string): Promise<RemoteCompany[] | null> {
  const doc = await fsGet(userPath(uid))
  if (!doc) return null
  const list = doc.companies
  if (!Array.isArray(list)) return []
  return (list as RemoteCompany[]).filter((c) => c && typeof c.id === 'string')
}

export async function remoteSetCompanies(uid: string, companies: RemoteCompany[], expectedUpdateTime?: string | null): Promise<void> {
  await fsSet(userPath(uid), { companies, updatedAt: Date.now(), updatedBy: uid }, expectedUpdateTime)
}

/** Four requests per batch; await every request before returning even on failure. */
async function batches<T>(count: number, task: (index: number) => Promise<T>): Promise<T[]> {
  const values: T[] = []
  for (let start = 0; start < count; start += 4) {
    const results = await Promise.allSettled(Array.from({ length: Math.min(4, count - start) }, (_, offset) => task(start + offset)))
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      values.push(result.value)
    }
  }
  return values
}

export async function remoteGetCompany(uid: string, companyId: string): Promise<RemoteCompanyDoc | null> {
  const path = companyPath(uid, companyId)
  const doc = await fsGet(path)
  if (!doc) return null
  let payload: string
  if (typeof doc.payload === 'string') payload = doc.payload // Existing single-document snapshots.
  else {
    const generation = doc.generation
    const count = Number(doc.chunks)
    if (typeof generation !== 'string' || !/^[a-zA-Z0-9-]+$/.test(generation) || !Number.isSafeInteger(count) || count < 1 || count > 10000) {
      throw new CloudError('INVALID_SNAPSHOT', 'Cloud backup adhura hai; local data nahi badla gaya')
    }
    const parts = await batches(count, async i => {
      const chunk = await fsGet(`${path}/snapshots/${generation}/chunks/${i}`)
      if (typeof chunk?.payload !== 'string') throw new CloudError('MISSING_CHUNK', 'Cloud backup ka hissa nahi mila; dobara sync karein')
      return chunk.payload
    })
    payload = parts.join('')
  }
  return { payload, updatedAt: Number(doc.updatedAt ?? 0), updatedBy: String(doc.updatedBy ?? ''), updateTime: typeof doc.__updateTime === 'string' ? doc.__updateTime : undefined }
}

export async function remoteSetCompany(uid: string, companyId: string, payload: string, expectedUpdateTime?: string | null): Promise<void> {
  const path = companyPath(uid, companyId)
  // 100k UTF-16 units remain below 1 MiB even with worst-case JSON escaping.
  const chunkSize = 100_000
  if (payload.length <= chunkSize) {
    await fsSet(path, { payload, updatedAt: Date.now(), updatedBy: uid }, expectedUpdateTime)
    return
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  const generation = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('')
  const parts: string[] = []
  for (let start = 0; start < payload.length;) {
    let end = Math.min(start + chunkSize, payload.length)
    const last = payload.charCodeAt(end - 1)
    const next = payload.charCodeAt(end)
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--
    parts.push(payload.slice(start, end))
    start = end
  }
  const chunks = parts.length
  await batches(chunks, i => fsSet(`${path}/snapshots/${generation}/chunks/${i}`, { payload: parts[i] }))
  // Publish only after every immutable chunk is written. A failed upload leaves the old manifest valid.
  await fsSet(path, { generation, chunks, updatedAt: Date.now(), updatedBy: uid }, expectedUpdateTime)
}
