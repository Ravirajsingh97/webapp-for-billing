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
  remoteGetCompanies,
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
  return dbx.transaction('rw', [...TABLE_ORDER.map((name) => tableOf(dbx, name)), dbx.tombstones], async () => {
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
      const maxId = Math.max(0, ...[...usedIds].map((id) => Number(id) || 0), ...remoteRows.map((r) => Number(r.id) || 0))
      let nextId = maxId + 1
      const idMap = new Map<number, number | undefined>()
      remaps.set(name, idMap)
      const writes: Row[] = []
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
        const existing = byIdentity.get(identity) ?? (candidate && (legacy(candidate) || legacy(row) || name === 'business' || !numeric) ? candidate : undefined)
        if (existing) {
          if (numeric) idMap.set(Number(raw.id), Number(existing.id))
          // Counters must never move backwards, even if a legacy setting has no timestamp.
          const nextNumber = name === 'docSettings' ? Math.max(Number(row.nextNumber) || 1, Number(existing.nextNumber) || 1) : undefined
          if (stamp(row) > stamp(existing) || (nextNumber !== undefined && nextNumber !== existing.nextNumber)) {
            const merged = stamp(row) > stamp(existing) ? row : { ...existing }
            if (numeric) merged.id = existing.id
            if (existing.syncId) merged.syncId = existing.syncId
            if (nextNumber !== undefined) merged.nextNumber = nextNumber
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
    return stats
  })
}

/** Company registry (kaun-kaun si companies hain) ka merge */
async function syncRegistry(uid: string): Promise<number> {
  const local = listCompanies()
  const remote = (await remoteGetCompanies(uid)) ?? []
  let changed = false

  for (const rc of remote) {
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
        changed = true
      }
    } else if (mine.name !== rc.name && rc.createdAt > mine.createdAt) {
      renameCompany(mine.id, rc.name)
      changed = true
    }
  }

  const merged: RemoteCompany[] = listCompanies().map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt }))
  await remoteSetCompanies(uid, merged)
  return changed ? merged.length : merged.length
}

export interface SyncProgress {
  (info: { companyId: string; companyName: string; index: number; total: number }): void
}

/** Saari companies ka sync (default: sirf active company) */
async function runSync(
  opts: { all?: boolean; onProgress?: SyncProgress } = {},
): Promise<SyncResult> {
  if (!isCloudConfigured()) throw new Error('Cloud setup nahi hua — Settings → Cloud account me config daalein')
  const session = getSession()
  if (!session) throw new Error('Pehle login karein')
  await freshToken() // token taaza karo (expire ho raha ho to refresh)

  await syncRegistry(session.uid)

  const activeId = activeCompanyId()
  const all = listCompanies()
  const targets = opts.all ? all : all.filter((c) => c.id === activeId)

  const total: MergeStats = { added: 0, updated: 0, skipped: 0 }
  let pulled = false

  for (let i = 0; i < targets.length; i++) {
    const company = targets[i]
    opts.onProgress?.({ companyId: company.id, companyName: company.name, index: i + 1, total: targets.length })

    const dbx = dbFor(company.id)
    await dbx.open()

    const remote = await remoteGetCompany(session.uid, company.id)

    if (remote) {
      const stats = await mergeSnapshot(dbx, remote.payload)
      total.added += stats.added
      total.updated += stats.updated
      total.skipped += stats.skipped
      pulled = pulled || stats.added + stats.updated > 0
    }

    // ab local (merged) snapshot cloud par chadhа do
    await remoteSetCompany(session.uid, company.id, await buildSnapshot(dbx))
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
export function syncNow(opts: { all?: boolean; onProgress?: SyncProgress } = {}): Promise<SyncResult> {
  const next = syncQueue.then(() => runSync(opts))
  syncQueue = next.catch(() => undefined)
  return next
}

/** Login ke turant baad: registry + saari companies ka data neeche kheencho */
export async function syncAfterLogin(): Promise<SyncResult> {
  return syncNow({ all: true })
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
