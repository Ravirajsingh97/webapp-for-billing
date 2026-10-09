import { requireUnlocked, requireOwnerIfConfigured } from './auth'
import { initializeInventory, reconcileInventory } from './inventory'
import type { Invoice, Item, PaymentEntry } from './types'
import { SYNC_TABLES as TABLE_ORDER, detachMissingReferences, normalizeTombstone, naturalKey, recordIdentity, tombstoneKey, type SyncTableName, type Tombstone } from './syncIdentity'
export { naturalKey } from './syncIdentity'
export type { SyncTableName } from './syncIdentity'
/**
 * Cloud sync — company ka pura data cloud par (Firestore) aur wapas.
 *
 * Design:
 * - Snapshot = wahi JSON jo "Backup" file banata hai (business, items, parties,
 *   invoices, docSettings, appSettings, payments, expenses).
 * - Merge: har row ka "natural key" (item code, bill number, party naam…) dekha
 *   jata hai — dono taraf same row ho to naya wala jeetta hai; naya row ho to
 *   jud jata hai. Id clash ho to naya id milta hai aur references (partyId,
 *   itemId) apne aap theek kar diye jate hain.
 * - Har company ka data alag document me jata hai: showroomUsers/{uid}/companies/{companyId}
 */

import type { Table } from 'dexie'
import type { ShowroomDB } from './db'
import { db, dbFor } from './db'
import { listCompanies, activeCompanyId, DEFAULT_COMPANY, createCompany, renameCompany, type Company } from './company'
import {
  type RemoteCompany,
  freshToken,
  getSession,
  isCloudConfigured,
  autoSyncEnabled,
  getCloudConfig,
  cloudContext,
  remoteGetRegistry,
  CloudError,
  remoteGetCompany,
  remoteSetCompanies,
  remoteSetCompany,
} from './cloud'
import { store } from './store'

export interface MergeStats {
  added: number
  updated: number
  skipped: number
}

export interface SyncResult {
  companies: number
  added: number
  updated: number
  skipped: number
  pulled: boolean
  at: number
}

type Row = Record<string, unknown>

const lastSyncKey = (companyId: string) => `showroom_last_sync_${companyId}`

export function lastSyncAt(companyId = activeCompanyId()): number {
  return Number(store.get('local', lastSyncKey(companyId)) ?? 0)
}

const stamp = (row: Row): number => Number(row.updatedAt ?? row.createdAt ?? 0)


const tableOf = (dbx: ShowroomDB, name: SyncTableName): Table<Row, number | string> =>
  (dbx as unknown as Record<string, Table<Row, number | string>>)[name]

/** Snapshot banao (Backup file wala hi format) */
export async function buildSnapshot(dbx: ShowroomDB = db): Promise<string> {
  return dbx.transaction('r', [...TABLE_ORDER.map((name) => tableOf(dbx, name)), dbx.tombstones], async () => {
    const out: Record<string, unknown> = { app: 'showroom-manager', version: 3 }
    for (const name of TABLE_ORDER) out[name] = await tableOf(dbx, name).toArray()
    out.tombstones = await dbx.tombstones.toArray()
    initializeInventory(out.items as Item[], out.invoices as Invoice[])
    detachMissingReferences(out)
    return JSON.stringify(out)
  })
}

/** Merge atomically, allocating every local ID before resolving invoice links. */
export async function mergeSnapshot(dbx: ShowroomDB, remoteJson: string): Promise<MergeStats> {
  const stats: MergeStats = { added: 0, updated: 0, skipped: 0 }
  const data = JSON.parse(remoteJson) as Record<string, unknown>
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid cloud snapshot')
  for (const name of TABLE_ORDER) {
    if (!Array.isArray(data[name])) throw new Error(`Cloud snapshot missing table: ${name}`)
  }
  for (const name of [...TABLE_ORDER, 'tombstones']) {
    const rows = data[name]
    if (rows !== undefined && (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r)))) {
      throw new Error(`Invalid cloud table: ${name}`)
    }
  }
  initializeInventory(data.items as Item[], data.invoices as Invoice[])
  return dbx.transaction('rw', [...TABLE_ORDER.map((name) => tableOf(dbx, name)), dbx.tombstones], async () => {
    await reconcileInventory(dbx)
    for (const raw of (data.tombstones ?? []) as Tombstone[]) {
      const marker = normalizeTombstone(raw)
      const current = await dbx.tombstones.get(marker.key)
      if (!current || marker.deletedAt > current.deletedAt) await dbx.tombstones.put(marker)
    }
    const deleted = new Set((await dbx.tombstones.toArray()).map((t) => t.key))
    const isDeleted = (name: SyncTableName, row: Row) => deleted.has(tombstoneKey(name, recordIdentity(name, row)))
    // Historic documents can still reference a deleted master. Never reuse those local IDs.
    const referencedIds = new Map<string, Set<number>>([['items', new Set()], ['parties', new Set()], ['invoices', new Set()]])
    const reserve = (table: string, value: unknown) => {
      const id = Number(value)
      if (Number.isSafeInteger(id) && id > 0) referencedIds.get(table)?.add(id)
    }
    for (const invoice of await dbx.invoices.toArray()) {
      reserve('parties', invoice.partyId)
      reserve('invoices', invoice.fromId)
      reserve('invoices', invoice.convertedToId)
      for (const line of invoice.items) reserve('items', line.itemId)
    }
    for (const payment of await dbx.payments.toArray()) reserve('parties', payment.partyId)
    const remaps = new Map<string, Map<number, number | undefined>>()
    for (const name of TABLE_ORDER) {
      const table = tableOf(dbx, name)
      const numeric = name !== 'docSettings' && name !== 'appSettings'
      const primary = (row: Row): number | string => numeric ? Number(row.id) : String(row[name === 'docSettings' ? 'docType' : 'key'])
      const localRows: Row[] = []
      const deletedIds: (number | string)[] = []
      for (const row of await table.toArray()) {
        if (isDeleted(name, row)) {
          deletedIds.push(primary(row))
          await table.delete(primary(row))
          stats.updated++
        } else localRows.push(row)
      }
      const remoteRows = (data[name] ?? []) as Row[]
      const byIdentity = new Map(localRows.map((r) => [recordIdentity(name, r), r]))
      const byNatural = new Map(localRows.map((r) => [naturalKey(name, r), r]))
      const usedIds = new Set([...localRows.map(primary), ...deletedIds, ...(referencedIds.get(name) ?? [])])
      const maxId = [...usedIds, ...remoteRows.map(r => r.id)].reduce<number>((max, id) => Math.max(max, Number(id) || 0), 0)
      let nextId = maxId + 1
      const idMap = new Map<number, number | undefined>()
      remaps.set(name, idMap)
      const writes: Row[] = []
      const localReferences = new Set<Row>()
      for (const raw of remoteRows) {
        if (isDeleted(name, raw)) {
          if (numeric) idMap.set(Number(raw.id), undefined) // Explicit deletion, not an unknown link.
          stats.skipped++
          continue
        }
        const row: Row = structuredClone(raw)
        const identity = recordIdentity(name, row)
        const candidate = byNatural.get(naturalKey(name, row))
        // Legacy snapshots have no stable identity; retain natural-key matching for migration.
        const legacy = (r: Row) => !r.syncId || String(r.syncId).startsWith('legacy:')
        const existing = byIdentity.get(identity) ?? (candidate && (legacy(candidate) || legacy(row) || candidate.isPlaceholder === true || row.isPlaceholder === true || name === 'business' || !numeric) ? candidate : undefined)
        if (existing) {
          if (numeric) idMap.set(Number(raw.id), Number(existing.id))
          // Counters must never move backwards, even if a legacy setting has no timestamp.
          const nextNumber = name === 'docSettings' ? Math.max(Number(row.nextNumber) || 1, Number(existing.nextNumber) || 1) : undefined
          const preferRemote = name === 'business' || name === 'items'
            ? (existing.isPlaceholder === true && row.isPlaceholder !== true) || (row.isPlaceholder !== true && stamp(row) > stamp(existing))
            : stamp(row) > stamp(existing)
          const merged: Row = structuredClone(preferRemote ? row : existing)
          if (numeric) merged.id = existing.id
          if (existing.syncId && !(existing.isPlaceholder === true && row.isPlaceholder !== true)) merged.syncId = existing.syncId
          if (nextNumber !== undefined) merged.nextNumber = nextNumber
          if (name === 'items') {
            merged.stockOpening = existing.isPlaceholder === true && row.isPlaceholder !== true ? row.stockOpening : existing.stockOpening
            merged.stockAdjustments = { ...(existing.stockAdjustments as object ?? {}), ...(row.stockAdjustments as object ?? {}) }
          }
          if (name === 'invoices') {
            const removed = new Set([...(existing.removedPaymentIds as string[] ?? []), ...(row.removedPaymentIds as string[] ?? [])])
            const payments = new Map<string, PaymentEntry>()
            for (const payment of [...(existing.payments as PaymentEntry[] ?? []), ...(row.payments as PaymentEntry[] ?? [])]) {
              if (!removed.has(payment.id)) payments.set(payment.id, payment)
            }
            merged.payments = [...payments.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
            if (removed.size) merged.removedPaymentIds = [...removed].sort()
            if (JSON.stringify(merged.payments) !== JSON.stringify(existing.payments) || JSON.stringify(merged.removedPaymentIds) !== JSON.stringify(existing.removedPaymentIds)) {
              merged.updatedAt = Math.max(Date.now(), stamp(existing) + 1, stamp(row))
            }
          }
          if (JSON.stringify(merged) !== JSON.stringify(existing)) {
            if (!preferRemote) localReferences.add(merged)
            writes.push(merged)
            byIdentity.set(identity, merged)
            byNatural.set(naturalKey(name, merged), merged)
            stats.updated++
          } else stats.skipped++
          continue
        }
        if (numeric) {
          const remoteId = Number(raw.id)
          const id = Number.isSafeInteger(remoteId) && remoteId > 0 && !usedIds.has(remoteId) ? remoteId : nextId++
          row.id = id
          usedIds.add(id)
          idMap.set(remoteId, id)
          if (name !== 'business') row.syncId = identity
        }
        writes.push(row)
        byIdentity.set(identity, row)
        byNatural.set(naturalKey(name, row), row)
        stats.added++
      }
      const mapReference = (row: Row, field: string, target: string) => {
        if (row[field] == null) return
        const map = remaps.get(target)
        const remoteId = Number(row[field])
        if (!map?.has(remoteId)) throw new Error(`Incomplete snapshot: missing ${target} reference ${remoteId}`)
        // Only a mapped identity or an explicit deletion can change this reference.
        row[field] = map.get(remoteId)
      }
      for (const row of writes) {
        if (localReferences.has(row)) { await table.put(row); continue }
        if (name === 'invoices' || name === 'payments') mapReference(row, 'partyId', 'parties')
        if (name === 'invoices') {
          mapReference(row, 'fromId', 'invoices')
          mapReference(row, 'convertedToId', 'invoices')
          for (const line of (row.items ?? []) as Row[]) mapReference(line, 'itemId', 'items')
        }
        await table.put(row)
      }
    }
    // Persist detached historic links too, so later merges cannot bind them to a reused ID.
    const surviving: Record<string, unknown> = {
      items: await dbx.items.toArray(), parties: await dbx.parties.toArray(),
      invoices: await dbx.invoices.toArray(), payments: await dbx.payments.toArray(),
    }
    const before = new Map(['invoices', 'payments'].map((name) => [name, new Map((surviving[name] as Row[]).map((row) => [row.id, JSON.stringify(row)]))]))
    detachMissingReferences(surviving)
    for (const name of ['invoices', 'payments'] as const) {
      for (const row of surviving[name] as Row[]) {
        if (before.get(name)?.get(row.id) !== JSON.stringify(row)) {
          await tableOf(dbx, name).put({ ...row, updatedAt: Date.now() })
          stats.updated++
        }
      }
    }
    await reconcileInventory(dbx)
    return stats
  })
}

const bindingKey = (companyId: string) => `showroom_cloud_owner_${companyId}`
const accountIdentity = (uid: string) => JSON.stringify([getCloudConfig()?.projectId, uid])
function allowedAccount(companyId: string, uid: string): boolean {
  const binding = store.get('local', bindingKey(companyId))
  return !binding || binding === accountIdentity(uid)
}
function assertAccount(companyId: string, uid: string): void {
  if (!allowedAccount(companyId, uid)) throw new CloudError('COMPANY_ACCOUNT_MISMATCH', 'Ye company doosre cloud account/project se linked hai. Original account use karein ya alag company/browser profile banayein.')
}

/** Company registry (kaun-kaun si companies hain) ka merge */
async function syncRegistry(uid: string, attempt = 0, expected = cloudContext()): Promise<number> {
  const local = listCompanies().filter(c => allowedAccount(c.id, uid))
  const registry = await remoteGetRegistry(uid)
  if (cloudContext() !== expected) throw new CloudError('AUTH_CHANGED', 'Cloud account badal gaya')
  const remote = registry?.companies ?? []

  for (const rc of remote) {
    assertAccount(rc.id, uid)
    const mine = local.find((c) => c.id === rc.id)
    if (!mine) {
      // remote company local me nahi hai -> add karo (payload baad me pull hoga)
      createCompany(rc.name)
      // createCompany naya id deta hai; usko remote id se jodne ke liye list ko theek karte hain
      const list = listCompanies()
      const created = list[list.length - 1]
      if (created) {
        const fixed: Company[] = list.map((c) => (c.id === created.id ? { ...c, id: rc.id, name: rc.name, createdAt: rc.createdAt } : c))
        store.set('local', 'showroom_companies', JSON.stringify(fixed))
      }
    } else if (mine.name !== rc.name && rc.createdAt > mine.createdAt) {
      renameCompany(mine.id, rc.name)
    }
  }

  const merged: RemoteCompany[] = listCompanies().filter(c => allowedAccount(c.id, uid)).map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt }))
  try {
    if (!registry || JSON.stringify(merged) !== JSON.stringify(remote)) await remoteSetCompanies(uid, merged, registry ? registry.updateTime : null)
  } catch (e) {
    if (e instanceof CloudError && e.code === 'SYNC_CONFLICT' && attempt < 2) return syncRegistry(uid, attempt + 1, expected)
    throw e
  }
  return merged.length
}

export interface SyncProgress {
  (info: { companyId: string; companyName: string; index: number; total: number }): void
}

/** Saari companies ka sync (default: sirf active company) */
async function runSync(
  opts: { all?: boolean; automatic?: boolean; onProgress?: SyncProgress } = {},
): Promise<SyncResult> {
  await requireUnlocked()
  if (opts.all) await requireOwnerIfConfigured()
  if (opts.automatic && !autoSyncEnabled()) throw new CloudError('AUTO_SYNC_DISABLED', 'Auto-sync band hai')
  if (!isCloudConfigured()) throw new Error('Cloud setup nahi hua — Settings → Cloud account me config daalein')
  const session = getSession()
  const expected = cloudContext()
  if (!session) throw new Error('Pehle login karein')
  assertAccount(activeCompanyId(), session.uid)
  await freshToken() // token taaza karo (expire ho raha ho to refresh)

  await syncRegistry(session.uid)

  const activeId = activeCompanyId()
  const all = listCompanies()
  const targets = opts.all ? all.filter(c => allowedAccount(c.id, session.uid)) : all.filter((c) => c.id === activeId)

  const total: MergeStats = { added: 0, updated: 0, skipped: 0 }
  let pulled = false

  for (let i = 0; i < targets.length; i++) {
    const company = targets[i]
    assertAccount(company.id, session.uid)
    opts.onProgress?.({ companyId: company.id, companyName: company.name, index: i + 1, total: targets.length })

    const dbx = dbFor(company.id)
    await dbx.open()
    await requireUnlocked(dbx, company.id)
    if (cloudContext() !== expected) throw new CloudError('AUTH_CHANGED', 'Cloud account badal gaya')
    store.set('local', bindingKey(company.id), accountIdentity(session.uid))

    // Compare-and-set publication prevents two devices replacing each other's snapshots.
    for (let attempt = 0; attempt < 3; attempt++) {
      await requireUnlocked(dbx, company.id)
      if (opts.automatic && !autoSyncEnabled()) throw new CloudError('AUTO_SYNC_DISABLED', 'Auto-sync band hai')
      if (cloudContext() !== expected) throw new Error('Cloud account badal gaya; dobara sync karein')
      const remote = await remoteGetCompany(session.uid, company.id)
      await requireUnlocked(dbx, company.id)
      if (opts.automatic && !autoSyncEnabled()) throw new CloudError('AUTO_SYNC_DISABLED', 'Auto-sync band hai')
      if (cloudContext() !== expected) throw new Error('Cloud account badal gaya; dobara sync karein')
      if (remote) {
        const stats = await mergeSnapshot(dbx, remote.payload)
        total.added += stats.added
        total.updated += stats.updated
        total.skipped += stats.skipped
        pulled = pulled || stats.added + stats.updated > 0
      }
      try {
        const payload = await buildSnapshot(dbx)
        if (cloudContext() !== expected) throw new CloudError('AUTH_CHANGED', 'Cloud account badal gaya')
        if (opts.automatic && !autoSyncEnabled()) throw new CloudError('AUTO_SYNC_DISABLED', 'Auto-sync band hai')
        if (!remote || remote.payload !== payload) await remoteSetCompany(session.uid, company.id, payload, remote ? remote.updateTime : null)
        break
      } catch (e) {
        if (!(e instanceof CloudError) || e.code !== 'SYNC_CONFLICT' || attempt === 2) throw e
      }
    }
    store.set('local', lastSyncKey(company.id), String(Date.now()))
  }

  return {
    companies: targets.length,
    added: total.added,
    updated: total.updated,
    skipped: total.skipped,
    pulled,
    at: Date.now(),
  }
}

let syncQueue: Promise<unknown> = Promise.resolve()
const pendingSyncs = new Map<string, Promise<SyncResult>>()
export function syncNow(opts: { all?: boolean; automatic?: boolean; onProgress?: SyncProgress } = {}): Promise<SyncResult> {
  const expected = cloudContext(), companyId = activeCompanyId()
  const key = JSON.stringify([expected, companyId, !!opts.all, !!opts.automatic])
  const existing = pendingSyncs.get(key)
  if (existing) return existing
  const next = syncQueue.then(() => {
    if (cloudContext() !== expected || activeCompanyId() !== companyId) throw new CloudError('AUTH_CHANGED', 'Queued sync ka account/company badal gaya; dobara try karein')
    return runSync(opts)
  })
  pendingSyncs.set(key, next)
  syncQueue = next.catch(() => undefined)
  void next.finally(() => { if (pendingSyncs.get(key) === next) pendingSyncs.delete(key) }).catch(() => undefined)
  return next
}

/** Login ke turant baad: registry + saari companies ka data neeche kheencho */
export async function syncAfterLogin(): Promise<SyncResult> {
  return syncNow({ all: true, automatic: true })
}

/**
 * Company list cloud se le kar local me jodo — naye phone par login karte hi
 * user ki saari companies switch list me aa jati hain.
 */
export async function pullCompanyList(): Promise<{ added: number; total: number }> {
  const session = getSession()
  if (!session) throw new Error('Pehle login karein')
  const before = listCompanies().length
  await syncRegistry(session.uid)
  const after = listCompanies().length
  return { added: after - before, total: after }
}

/** Khaali (nayi) company ko cloud se bhardo — login ke baad pehli baar */
export async function hasLocalData(companyId = activeCompanyId()): Promise<boolean> {
  const dbx = dbFor(companyId)
  await dbx.open()
  const [items, invoices, parties] = await Promise.all([dbx.items.count(), dbx.invoices.count(), dbx.parties.count()])
  return items + invoices + parties > 0
}

export const DEFAULT_COMPANY_ID = DEFAULT_COMPANY.id
