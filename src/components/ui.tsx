import { useEffect, useRef, useState, type ReactNode } from 'react'

// ---------------- Toast ----------------

type ToastItem = { id: number; msg: string; tone: 'default' | 'error' | 'success' }
let toastListeners: ((t: ToastItem) => void)[] = []
let toastId = 0

export function toast(msg: string, tone: 'default' | 'error' | 'success' = 'default') {
  const item = { id: ++toastId, msg, tone }
  toastListeners.forEach((l) => l(item))
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => {
    const l = (t: ToastItem) => {
      setItems((prev) => [...prev.slice(-2), t])
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 2600)
    }
    toastListeners.push(l)
    return () => {
      toastListeners = toastListeners.filter((x) => x !== l)
    }
  }, [])
  return (
    <div className="toast-wrap no-print">
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.tone === 'error' ? 'bg-red-700/95' : t.tone === 'success' ? 'bg-green-700/95' : ''}`}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ---------------- Sheet / modal ----------------

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  full,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  full?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="overlay no-print" onClick={onClose}>
      <div
        className={`sheet ${full ? 'h-[92dvh]' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sheet-head">
          <div className="min-w-0">
            <div className="sheet-title truncate">{title}</div>
            {subtitle ? <div className="truncate text-xs text-slate-500">{subtitle}</div> : null}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Band karein">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

// ---------------- Confirm ----------------

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Haan, karein',
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="overlay no-print" onClick={onCancel}>
      <div className="mx-4 w-full max-w-[420px] rounded-2xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-bold text-slate-900">{title}</div>
        {message ? <div className="mt-1.5 text-sm text-slate-600">{message}</div> : null}
        <div className="mt-4 flex gap-2">
          <button className="btn btn-outline flex-1" onClick={onCancel}>
            Nahi
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'} flex-1`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------- Small UI bits ----------------

export const EmptyState = ({
  icon = '📭',
  title,
  hint,
  action,
}: {
  icon?: string
  title: string
  hint?: string
  action?: ReactNode
}) => (
  <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
    <div className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-2xl">{icon}</div>
    <div className="text-sm font-bold text-slate-700">{title}</div>
    {hint ? <div className="max-w-[280px] text-xs text-slate-500">{hint}</div> : null}
    {action}
  </div>
)

export const Spinner = ({ label }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
    {label ?? 'Load ho raha hai…'}
  </div>
)

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="segmented flex min-w-0 rounded-xl bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`min-w-0 flex-1 break-words text-center font-semibold transition ${
            size === 'sm' ? 'px-2 py-1.5 text-[11px]' : 'px-2.5 py-2 text-xs'
          } ${value === o.value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  onScan,
  autoFocus,
  inputRef,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onScan?: () => void
  autoFocus?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
      <span className="text-slate-400">🔍</span>
      <input
        ref={ref}
        className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-slate-400"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Khojein…'}
      />
      {value ? (
        <button className="px-1 text-slate-400" onClick={() => onChange('')} aria-label="Clear">
          ✕
        </button>
      ) : null}
      {onScan ? (
        <button
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white"
          onClick={onScan}
          aria-label="Scan barcode"
          title="Barcode scan karein"
        >
          ▮▯
        </button>
      ) : null}
    </div>
  )
}

export function StatBox({
  label,
  value,
  sub,
  tone = 'default',
  onClick,
  icon,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'money' | 'due' | 'brand'
  onClick?: () => void
  icon?: string
}) {
  const toneCls =
    tone === 'money' ? 'text-money' : tone === 'due' ? 'text-due' : tone === 'brand' ? 'text-brand-700' : 'text-slate-900'
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="stat-box text-left transition active:scale-[0.98] disabled:active:scale-100"
    >
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {icon ? <span>{icon}</span> : null}
        {label}
      </div>
      <div className={`num mt-0.5 text-[15px] font-extrabold ${toneCls}`}>{value}</div>
      {sub ? <div className="text-[10px] font-medium text-slate-500">{sub}</div> : null}
    </button>
  )
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 py-1">{children}</div>
}

export function Fab({ onClick, label, icon = '＋' }: { onClick: () => void; label: string; icon?: string }) {
  return (
    <button
      onClick={onClick}
      className="no-print fixed bottom-20 right-4 z-30 flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-3 text-sm font-bold text-white shadow-xl shadow-brand-600/30 active:scale-95"
      style={{ right: 'max(1rem, calc(50vw - 260px + 1rem))' }}
    >
      <span className="text-base leading-none">{icon}</span>
      {label}
    </button>
  )
}

export function KeyValue({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5 text-[13px]">
      <span className="text-slate-500">{k}</span>
      <span className={`num text-right ${strong ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>{v}</span>
    </div>
  )
}

export const Row = ({
  children,
  onClick,
  right,
}: {
  children: ReactNode
  onClick?: () => void
  right?: ReactNode
}) => (
  <button className="list-row w-full text-left" onClick={onClick} disabled={!onClick}>
    <div className="min-w-0 flex-1">{children}</div>
    {right}
  </button>
)
