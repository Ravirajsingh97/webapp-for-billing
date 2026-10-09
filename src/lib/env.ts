/** Browser environment checks + friendly recovery hints */

export const isEmbedded = (): boolean => {
  try {
    return window.self !== window.top
  } catch {
    // cross-origin frame -> definitely embedded
    return true
  }
}

/** IndexedDB par ek chhota probe — kuch browsers preview/iframe me storage block kar dete hain */
export const canUseStorage = async (): Promise<boolean> => {
  try {
    if (typeof indexedDB === 'undefined' || indexedDB === null) return false
    return await new Promise<boolean>((resolve) => {
      let settled = false
      const done = (v: boolean) => {
        if (settled) return
        settled = true
        resolve(v)
      }
      try {
        const req = indexedDB.open('__showroom_probe__', 1)
        req.onsuccess = () => {
          try {
            req.result.close()
            indexedDB.deleteDatabase('__showroom_probe__')
          } catch {
            /* ignore */
          }
          done(true)
        }
        req.onerror = () => done(false)
        req.onblocked = () => done(true)
        setTimeout(() => done(true), 1500)
      } catch {
        done(false)
      }
    })
  } catch {
    return false
  }
}

export const storageFixMessage = (embedded: boolean): string =>
  embedded
    ? 'Aap abhi app ko preview ke andar (iframe me) khol rahe hain. Browser aise andar wale frame me storage (IndexedDB) block kar deta hai, isliye app ko data save karne ki jagah nahi mil rahi.'
    : 'Browser ne is site ko storage (IndexedDB) use karne nahi diya. Ye private/incognito mode, ya browser me storage block hone par hota hai.'
