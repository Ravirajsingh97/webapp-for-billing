/**
 * Safe key-value storage.
 *
 * Kuch jagah (private mode, file://, WebView, iframe, test runners) browser
 * ka localStorage/sessionStorage block ya missing hota hai. Aise me hum
 * in-memory fallback use karte hain — app chalti rehti hai, bas wo setting
 * us session tak hi rehti hai.
 */

type Kind = 'local' | 'session'

const memory: Record<Kind, Map<string, string>> = {
  local: new Map<string, string>(),
  session: new Map<string, string>(),
}

function backend(kind: Kind): Storage | null {
  try {
    const s = kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage
    if (!s) return null
    const probe = '__showroom_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

export const store = {
  get(kind: Kind, key: string): string | null {
    try {
      const b = backend(kind)
      if (b) return b.getItem(key)
    } catch {
      /* fallback */
    }
    return memory[kind].get(key) ?? null
  },
  set(kind: Kind, key: string, value: string): void {
    try {
      const b = backend(kind)
      if (b) {
        b.setItem(key, value)
        return
      }
    } catch {
      /* fallback */
    }
    memory[kind].set(key, value)
  },
  remove(kind: Kind, key: string): void {
    try {
      const b = backend(kind)
      if (b) {
        b.removeItem(key)
        return
      }
    } catch {
      /* fallback */
    }
    memory[kind].delete(key)
  },
}
