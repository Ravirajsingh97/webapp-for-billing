/** Storage fallback preserves local writes/removals when browser storage is unavailable. */
type Kind = 'local' | 'session'
const memory: Record<Kind, Map<string, string | null>> = { local: new Map(), session: new Map() }
function backend(kind: Kind): Storage | null {
  try { return (kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage) ?? null }
  catch { return null }
}
export const store = {
  get(kind: Kind, key: string): string | null {
    // A failed write/removal must take precedence over an older persistent value.
    if (memory[kind].has(key)) return memory[kind].get(key) ?? null
    try { return backend(kind)?.getItem(key) ?? null }
    catch { return null }
  },
  set(kind: Kind, key: string, value: string): void {
    try {
      const storage = backend(kind)
      if (storage) { storage.setItem(key, value); memory[kind].delete(key); return }
    } catch { /* retain the new value below */ }
    memory[kind].set(key, value)
  },
  remove(kind: Kind, key: string): void {
    // Retain a removal marker if storage still contains an inaccessible old session.
    memory[kind].set(key, null)
    try {
      const storage = backend(kind)
      if (storage) { storage.removeItem(key); memory[kind].delete(key) }
    } catch { /* keep removal marker */ }
  },
}
