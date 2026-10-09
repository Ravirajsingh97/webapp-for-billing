import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { deleteExpense, upsertExpense } from '../lib/repo'
import { csvEscape } from '../lib/csvutil'
import { download, financialYear, fmtDate, lastNDays, money, monthEnd, monthStart, num, round2, todayISO } from '../lib/format'
import type { Business, Expense, PaymentMode } from '../lib/types'
import { EXPENSE_CATEGORIES, PAYMENT_MODES } from '../lib/types'
import { ChipRow, ConfirmDialog, EmptyState, Sheet, StatBox, toast } from '../components/ui'

type RangeKey = 'today' | 'week' | 'month' | 'fy' | 'all' | 'custom'

export function ExpensesScreen({ business }: { business: Business }) {
  const [range, setRange] = useState<RangeKey>('month')
  const [custom, setCustom] = useState({ from: monthStart(), to: todayISO() })
  const [editing, setEditing] = useState<Expense | null>(null)
  const [toDelete, setToDelete] = useState<Expense | null>(null)

  const expenses = useLiveQuery(() => db.expenses.orderBy('date').reverse().toArray(), [], [] as Expense[])

  const { from, to } = useMemo(() => {
    if (range === 'today') return { from: todayISO(), to: todayISO() }
    if (range === 'week') return lastNDays(7)
    if (range === 'month') return { from: monthStart(), to: monthEnd() }
    if (range === 'fy') {
      const startYear = Number('20' + financialYear(todayISO()).slice(0, 2))
      return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` }
    }
    if (range === 'all') return { from: '2000-01-01', to: '2099-12-31' }
    return custom
  }, [range, custom])

  const filtered = useMemo(
    () => (expenses ?? []).filter((e) => e.date >= from && e.date <= to),
    [expenses, from, to],
  )

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    filtered.forEach((e) => map.set(e.category, round2((map.get(e.category) ?? 0) + e.amount)))
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [filtered])

  const byMode = useMemo(() => {
    const map = new Map<PaymentMode, number>()
    filtered.forEach((e) => map.set(e.mode, round2((map.get(e.mode) ?? 0) + e.amount)))
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [filtered])

  const total = round2(filtered.reduce((s, e) => s + e.amount, 0))
  const maxCat = Math.max(1, ...byCategory.map(([, v]) => v))

  const newExpense = (): Expense => ({
    date: todayISO(),
    category: 'Rent',
    amount: 0,
    mode: 'CASH',
    paidTo: '',
    note: '',
    createdAt: Date.now(),
  })

  return (
    <div className="screen-content flex-1 px-3 pb-24 pt-3">
      <ChipRow>
        {(
          [
            ['today', 'Aaj'],
            ['week', '7 din'],
            ['month', 'Is mahine'],
            ['fy', 'Is saal (FY)'],
            ['all', 'Sab'],
            ['custom', 'Custom'],
          ] as [RangeKey, string][]
        ).map(([k, label]) => (
          <button key={k} className="chip" data-active={range === k} onClick={() => setRange(k)}>
            {label}
          </button>
        ))}
      </ChipRow>
      {range === 'custom' ? (
        <div className="responsive-form-grid mt-1 grid grid-cols-2 gap-2">
          <input type="date" className="input" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <input type="date" className="input" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </div>
      ) : null}

      <div className="stats-grid mt-2 grid grid-cols-3 gap-2">
        <StatBox label="Total kharcha" value={money(total)} tone="due" />
        <StatBox label="Entries" value={num(filtered.length, 0)} />
        <StatBox
          label="Average"
          value={money(filtered.length ? round2(total / filtered.length) : 0, 0)}
          sub={`${fmtDate(from)} – ${fmtDate(to)}`}
        />
      </div>

      <button className="btn btn-primary btn-block mt-2" onClick={() => setEditing(newExpense())}>
        ＋ Naya kharcha likhein
      </button>

      {byCategory.length ? (
        <>
          <div className="section-title mt-4">
            <span>Category-wise kharcha</span>
          </div>
          <div className="card">
            {byCategory.map(([cat, amount]) => {
              const meta = EXPENSE_CATEGORIES.find((c) => c.key === cat)
              return (
                <div key={cat} className="py-1.5">
                  <div className="flex items-center justify-between text-[12px] font-semibold text-slate-700">
                    <span>
                      {meta?.icon ?? '🧾'} {meta?.label ?? cat}
                    </span>
                    <span className="num">{money(amount, 0)}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${(amount / maxCat) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : null}

      {byMode.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {byMode.map(([mode, amount]) => (
            <span key={mode} className="badge badge-neutral">
              {PAYMENT_MODES.find((m) => m.key === mode)?.label ?? mode}: {money(amount, 0)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="section-title mt-4">
        <span>Kharcha list</span>
        <button
          className="text-[11px] font-bold text-brand-700"
          onClick={() => {
            if (!filtered.length) {
              toast('Export ke liye kuch nahi', 'error')
              return
            }
            const rows = [
              ['Date', 'Category', 'Paid To', 'Mode', 'Amount', 'Note'],
              ...filtered.map((e) => [
                fmtDate(e.date, 'num'),
                e.category,
                e.paidTo ?? '',
                e.mode,
                e.amount.toFixed(2),
                e.note ?? '',
              ]),
            ]
            download(`expenses-${from}-to-${to}.csv`, rows.map((r) => r.map(csvEscape).join(',')).join('\n'))
            toast('Expenses CSV download ho gayi', 'success')
          }}
        >
          ⬇ CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="🧾" title="Is period me koi kharcha nahi likha" hint="Kiraya, salary, bijli, transport — sab yahan likhein." />
      ) : (
        <div className="card-flat overflow-hidden">
          {filtered.map((e) => {
            const meta = EXPENSE_CATEGORIES.find((c) => c.key === e.category)
            return (
              <button key={e.id} className="list-row w-full text-left" onClick={() => setEditing(e)}>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-sm">
                  {meta?.icon ?? '🧾'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-slate-900">{meta?.label ?? e.category}</div>
                  <div className="truncate text-[11px] text-slate-500">
                    {fmtDate(e.date)} • {e.mode}
                    {e.paidTo ? ` • ${e.paidTo}` : ''}
                    {e.note ? ` • ${e.note}` : ''}
                  </div>
                </div>
                <div className="num text-[13px] font-extrabold text-due">{money(e.amount)}</div>
              </button>
            )
          })}
        </div>
      )}

      {editing ? (
      <ExpenseEditor
        expense={editing}
        onClose={() => setEditing(null)}
        onDelete={(e) => {
          setEditing(null)
          setToDelete(e)
        }}
      />
      ) : null}

      <ConfirmDialog
        open={!!toDelete}
        title="Kharcha delete karein?"
        message={toDelete ? `${toDelete.category} • ${money(toDelete.amount)}` : ''}
        confirmLabel="Delete"
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete?.id) await deleteExpense(toDelete.id)
          setToDelete(null)
          toast('Kharcha delete ho gaya')
        }}
      />
      <span className="hidden">{business.stateCode}</span>
    </div>
  )
}

function ExpenseEditor({
  expense,
  onClose,
  onDelete,
}: {
  expense: Expense | null
  onClose: () => void
  onDelete: (e: Expense) => void
}) {
  const [draft, setDraft] = useState<Expense | null>(expense)
  const [key, setKey] = useState<number | null>(null)

  if (expense && key !== (expense.id ?? -1)) {
    setKey(expense.id ?? -1)
    setDraft(expense)
  }
  if (!draft) return null

  const save = async () => {
    if (!draft.amount || draft.amount <= 0) {
      toast('Amount likhein', 'error')
      return
    }
    await upsertExpense(draft)
    toast('Kharcha save ho gaya', 'success')
    onClose()
  }

  return (
    <Sheet
      open={!!expense}
      onClose={onClose}
      title={draft.id ? 'Kharcha edit karein' : 'Naya kharcha'}
      subtitle={draft.id ? `${money(draft.amount)}` : 'Dukan ka kharcha — hisab saaf rahega'}
      footer={
        <div className="flex gap-2">
          {draft.id ? (
            <button className="btn btn-danger-soft" onClick={() => onDelete(draft)}>
              🗑
            </button>
          ) : null}
          <button className="btn btn-primary flex-1" onClick={save}>
            💾 Save karein
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="field">
          <label className="label">Category</label>
          <div className="grid grid-cols-3 gap-1.5">
            {EXPENSE_CATEGORIES.map((c) => (
              <button
                key={c.key}
                className="chip justify-center text-[11px]"
                data-active={draft.category === c.key}
                onClick={() => setDraft({ ...draft, category: c.key })}
              >
                {c.icon} {c.label.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        <div className="responsive-form-grid grid grid-cols-2 gap-3">
          <div className="field">
            <label className="label">Amount (₹) *</label>
            <input
              className="input input-lg text-right font-bold"
              inputMode="decimal"
              value={draft.amount || ''}
              onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) || 0 })}
              autoFocus
            />
          </div>
          <div className="field">
            <label className="label">Date</label>
            <input type="date" className="input" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <label className="label">Kisko diya (paid to)</label>
          <input
            className="input"
            value={draft.paidTo ?? ''}
            onChange={(e) => setDraft({ ...draft, paidTo: e.target.value })}
            placeholder="e.g. landlord, staff name, transport"
          />
        </div>

        <div className="field">
          <label className="label">Mode</label>
          <div className="grid grid-cols-3 gap-1.5">
            {PAYMENT_MODES.map((m) => (
              <button key={m.key} className="chip justify-center" data-active={draft.mode === m.key} onClick={() => setDraft({ ...draft, mode: m.key })}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">Note</label>
          <textarea className="textarea" value={draft.note ?? ''} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        </div>
      </div>
    </Sheet>
  )
}
