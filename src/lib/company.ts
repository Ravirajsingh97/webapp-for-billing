/**
 * Company / Firm registry — MyBillBook jaisa "firm switch".
 *
 * Har company ka apna pura data hota hai (alag IndexedDB database), isliye
 * ek company ka bill/khata doosri company me nahi dikhta.
 * Company ki list localStorage me rehti hai (chhota index), baaki sab data
 * us company ke apne database me.
 */

import { store } from './store'

export interface Company {
  id: string
  name: string
  createdAt: number
}

const LIST_KEY = 'showroom_companies'
const ACTIVE_KEY = 'showroom_active_company'

export const DEFAULT_COMPANY: Company = {
  id: 'default',
  name: 'My Showroom',
  createdAt: 0,
}

/** Purani (default) company ka database wahi rehta hai — existing data safe. */
export function dbNameFor(companyId: string): string {
  return companyId === 'default' ? 'showroom_manager_v2' : `showroom_manager_v2__${companyId}`
}

function readList(): Company[] {
  try {
    const raw = store.get('local', LIST_KEY)
    const arr = raw ? (JSON.parse(raw) as Company[]) : []
    if (!Array.isArray(arr)) return []
    return arr.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
  } catch {
    return []
  }
}

function writeList(list: Company[]): void {
  store.set('local', LIST_KEY, JSON.stringify(list))
}

/** Companies ki list (pehli baar me default company register ho jati hai). */
export function listCompanies(): Company[] {
  let list = readList()
  if (list.length === 0) {
    list = [{ ...DEFAULT_COMPANY }]
    writeList(list)
  }
  return list
}

export function getCompany(id: string): Company | undefined {
  return listCompanies().find((c) => c.id === id)
}

export function activeCompanyId(): string {
  const id = store.get('local', ACTIVE_KEY)
  if (id && getCompany(id)) return id
  return 'default'
}

export function activeCompany(): Company {
  const id = activeCompanyId()
  return getCompany(id) ?? { ...DEFAULT_COMPANY }
}

/** Sirf id set karta hai (reload ke bina) — tests/UI ke liye. */
export function setActiveCompany(id: string): void {
  store.set('local', ACTIVE_KEY, id)
}

/** Company switch karke app reload karta hai (us company ka database khul jata hai). */
export function switchCompany(id: string): void {
  setActiveCompany(id)
  try {
    window.location.reload()
  } catch {
    /* ignore */
  }
}

export function createCompany(name: string): Company {
  const clean = name.trim() || 'Nayi Company'
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const company: Company = { id, name: clean, createdAt: Date.now() }
  writeList([...listCompanies(), company])
  return company
}

export function renameCompany(id: string, name: string): void {
  const clean = name.trim()
  if (!clean) return
  writeList(listCompanies().map((c) => (c.id === id ? { ...c, name: clean } : c)))
}

/** Company hata dete hain. Default company delete nahi hoti. */
export function deleteCompany(id: string): void {
  if (id === 'default') return
  writeList(listCompanies().filter((c) => c.id !== id))
  try {
    indexedDB.deleteDatabase(dbNameFor(id))
  } catch {
    /* ignore */
  }
  if (activeCompanyId() === id) setActiveCompany('default')
}
