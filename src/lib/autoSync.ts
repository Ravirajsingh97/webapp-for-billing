/** One timer per tab; no interval can build an unbounded queue behind a slow sync. */
export const DATA_CHANGE_EVENT = 'showroom-data-change'
export function startAutoSync(options: {
  enabled: () => boolean
  run: () => Promise<void>
  target?: Window
  schedule?: typeof setTimeout
  cancel?: typeof clearTimeout
  now?: () => number
}): () => void {
  const target = options.target ?? window
  const schedule = options.schedule ?? setTimeout
  const cancel = options.cancel ?? clearTimeout
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false, running = false, failures = 0
  let dirtySince: number | undefined
  const now = options.now ?? Date.now
  const ready = () => !stopped && options.enabled() && target.navigator.onLine !== false && target.document.visibilityState !== 'hidden'
  const queue = (delay: number) => {
    if (stopped) return
    if (timer !== undefined) cancel(timer)
    timer = schedule(() => { timer = undefined; void run() }, delay)
  }
  const run = async () => {
    if (running || !ready()) return
    running = true
    dirtySince = undefined
    try { await options.run(); failures = 0 }
    catch { failures++ }
    finally {
      running = false
      if (ready()) queue(failures ? Math.min(300_000, 5_000 * 2 ** Math.min(failures - 1, 6)) : 180_000)
    }
  }
  const wake = () => { if (!running && ready()) queue(0) }
  const dirty = () => {
    if (running || !ready()) return
    if (failures && timer !== undefined) return // Local edits must not reset an existing retry delay.
    dirtySince ??= now()
    queue(failures ? Math.min(300_000, 5_000 * 2 ** Math.min(failures - 1, 6)) : Math.max(0, Math.min(2_000, 10_000 - (now() - dirtySince))))
  }
  target.addEventListener('online', wake)
  target.document.addEventListener('visibilitychange', wake)
  target.addEventListener(DATA_CHANGE_EVENT, dirty)
  queue(0)
  return () => {
    stopped = true
    if (timer !== undefined) cancel(timer)
    target.removeEventListener('online', wake)
    target.document.removeEventListener('visibilitychange', wake)
    target.removeEventListener(DATA_CHANGE_EVENT, dirty)
  }
}
