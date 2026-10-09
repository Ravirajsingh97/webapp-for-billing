/** Stable sync identity is independent of device-local IndexedDB primary keys. */
export type SyncRow = Record<string, unknown>
export const SYNC_TABLES = ['business', 'docSettings', 'appSettings', 'parties', 'items', 'invoices', 'payments', 'expenses'] as const
export type SyncTableName = (typeof SYNC_TABLES)[number]
export interface Tombstone {
  key: string
  table: SyncTableName
  identity: string
  deletedAt: number
}
const lower = (v: unknown) => String(v ?? '').trim().toLowerCase()
export function naturalKey(table: string, row: SyncRow): string {
  switch (table) {
    case 'items': return `i:${lower(row.code) || lower(row.name)}`
    case 'parties': return `p:${lower(row.name)}|${lower(row.phone)}`
    // Legacy invoices need creation time as well as their display number.
    case 'invoices': return `v:${lower(row.docType)}|${lower(row.number)}|${Number(row.createdAt ?? 0)}`
    case 'payments': return `y:${lower(row.date)}|${lower(row.direction)}|${Number(row.amount ?? 0)}|${lower(row.partyName)}|${Number(row.createdAt ?? 0)}`
    case 'expenses': return `e:${lower(row.date)}|${lower(row.category)}|${Number(row.amount ?? 0)}|${lower(row.paidTo)}|${Number(row.createdAt ?? 0)}`
    case 'docSettings': return `d:${lower(row.docType)}`
    case 'appSettings': return `s:${lower(row.key)}`
    case 'business': return 'b:business'
    default: throw new Error(`Unknown sync table: ${table}`)
  }
}
export const recordIdentity = (table: string, row: SyncRow): string =>
  typeof row.syncId === 'string' && row.syncId ? row.syncId : `legacy:${naturalKey(table, row)}`
export const newSyncId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
export const tombstoneKey = (table: string, identity: string): string => `${table}|${identity}`

export function normalizeTombstone(value: unknown): Tombstone {
  if (!value || typeof value !== 'object') throw new Error('Invalid deletion marker')
  const marker = value as Tombstone
  if (!SYNC_TABLES.includes(marker.table) || typeof marker.identity !== 'string' || !marker.identity || !Number.isFinite(marker.deletedAt) || marker.deletedAt < 0) {
    throw new Error('Invalid deletion marker')
  }
  return { table: marker.table, identity: marker.identity, deletedAt: marker.deletedAt, key: tombstoneKey(marker.table, marker.identity) }
}

/** Historical documents keep their printed details when a master record was deleted locally. */
export function detachMissingReferences(snapshot: Record<string, unknown>): void {
  const rows = (name: string) => (snapshot[name] ?? []) as SyncRow[]
  const ids = new Map(['items', 'parties', 'invoices'].map((name) => [name, new Set(rows(name).map((row) => Number(row.id)))]))
  const detach = (row: SyncRow, field: string, table: string) => {
    if (row[field] != null && !ids.get(table)?.has(Number(row[field]))) delete row[field]
  }
  for (const invoice of rows('invoices')) {
    detach(invoice, 'partyId', 'parties')
    detach(invoice, 'fromId', 'invoices')
    detach(invoice, 'convertedToId', 'invoices')
    for (const line of (invoice.items ?? []) as SyncRow[]) detach(line, 'itemId', 'items')
  }
  for (const payment of rows('payments')) detach(payment, 'partyId', 'parties')
}
