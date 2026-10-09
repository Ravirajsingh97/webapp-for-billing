import { currentUser, requireOwnerIfConfigured } from '../lib/auth'
import { todayISO } from '../lib/format'
import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_TERMS, seedDatabase } from '../lib/db'
import { exportBackup, importBackup, wipeAllData, formatDocNumber } from '../lib/repo'
import { download, readFileAsDataUrl, readFileAsText } from '../lib/format'
import { runSelfTest, type SelfTestResult } from '../lib/selftest'
import { ConfirmDialog, Segmented, Sheet, toast } from '../components/ui'
import { AccountCard } from '../components/AccountCard'
import { CloudCard } from '../components/CloudCard'
import type { Business, DocSetting } from '../lib/types'
import { DOC_TYPES, STATES } from '../lib/types'

export function SettingsScreen({
  business,
  onBusinessChange,
  onOpenParties,
  installPrompt,
  onInstall,
}: {
  business: Business
  onBusinessChange: () => void
  onOpenParties: () => void
  installPrompt?: { prompt: () => Promise<void> } | null
  onInstall?: () => void
}) {
  const permission = useLiveQuery(async () => await db.users.count() === 0 || (await currentUser())?.role === 'OWNER', [], false)
  const [form, setForm] = useState<Business>(business)
  const [savedTick, setSavedTick] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [docEdit, setDocEdit] = useState<DocSetting | null>(null)
  const logoRef = useRef<HTMLInputElement>(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'running' | 'done'>('idle')
  const [testResults, setTestResults] = useState<SelfTestResult[]>([])

  const runTest = async () => {
    setTestState('running')
    setTestResults([])
    try {
      const results = await runSelfTest()
      setTestResults(results)
      setTestState('done')
      const failed = results.filter((r) => !r.ok).length
      toast(
        failed === 0 ? `Self-test pass — ${results.length}/${results.length} ✅` : `Self-test me ${failed} check fail ❌`,
        failed === 0 ? 'success' : 'error',
      )
    } catch (e) {
      setTestState('idle')
      toast('Self-test chal nahi paya', 'error')
      console.error(e)
    }
  }

  const docSettings = useLiveQuery(() => db.docSettings.toArray(), [], [] as DocSetting[])
  const items = useLiveQuery(() => db.items.count(), [], 0)
  const invoices = useLiveQuery(() => db.invoices.count(), [], 0)
  const parties = useLiveQuery(() => db.parties.count(), [], 0)
  const payments = useLiveQuery(() => db.payments.count(), [], 0)
  const expenses = useLiveQuery(() => db.expenses.count(), [], 0)

  useEffect(() => setForm(business), [business])

  const save = async () => {
    try {
      await requireOwnerIfConfigured()
      if (!form.name.trim()) {
        toast('Dukaan ka naam likhein', 'error')
        return
      }
      const existing = (await db.business.toCollection().first())?.id
      const stateName = STATES.find((s) => s.code === form.stateCode)?.name ?? ''
      const rec = { ...form, isPlaceholder: false, updatedAt: Date.now(), stateName }
      if (existing) await db.business.update(existing, rec)
      else await db.business.add(rec)
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 1500)
      onBusinessChange()
      toast('Shop details save ho gayi', 'success')
    } catch (e) { toast(e instanceof Error ? e.message : 'Shop details save nahi hui', 'error') }
  }

  const uploadImage = async (file: File, key: 'logoDataUrl' | 'signatureDataUrl') => {
    if (file.size > 400_000) {
      toast('Chhoti image chunein (400KB se kam)', 'error')
      return
    }
    const dataUrl = await readFileAsDataUrl(file)
    setForm((f) => ({ ...f, [key]: dataUrl }))
  }

  if (!permission) return <div className="screen-content p-3"><p className="card">Settings, cloud account aur backups ke liye owner login chahiye.</p><AccountCard /></div>

  return (
    <div className="screen-content form-page flex-1 px-3 pb-24 pt-3">
      {/* Shop profile */}
      <div className="card">
        <div className="text-[13px] font-bold text-slate-700">🏪 Dukaan / showroom ki details</div>
        <div className="mt-2 flex flex-col gap-3">
          <div className="field">
            <label className="label">Shop ka naam *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label className="label">Tagline (optional)</label>
            <input className="input" value={form.tagline ?? ''} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="Sanitaryware • CP Fittings • Tiles" />
          </div>
          <div className="field">
            <label className="label">Pura address</label>
            <textarea className="textarea" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="responsive-form-grid grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label">Mobile number</label>
              <input className="input" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">GSTIN</label>
              <input className="input uppercase" value={form.gstin ?? ''} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="08ABCDE1234F1Z5" />
            </div>
            <div className="field">
              <label className="label">State (GST code)</label>
              <select className="select" value={form.stateCode} onChange={(e) => setForm({ ...form, stateCode: e.target.value })}>
                {STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label className="label">UPI ID (bill par QR aayega)</label>
            <input className="input" value={form.upiId ?? ''} onChange={(e) => setForm({ ...form, upiId: e.target.value })} placeholder="showroom@upi / 9876543210@ybl" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="field">
              <label className="label">Bank</label>
              <input className="input" value={form.bankName ?? ''} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">A/c no.</label>
              <input className="input" value={form.bankAccount ?? ''} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">IFSC</label>
              <input className="input uppercase" value={form.bankIfsc ?? ''} onChange={(e) => setForm({ ...form, bankIfsc: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label className="label">Default terms & conditions</label>
            <textarea className="textarea" value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
            <button className="btn btn-ghost btn-sm mt-1 self-start" onClick={() => setForm({ ...form, terms: DEFAULT_TERMS })}>
              Default terms wapas laayein
            </button>
          </div>

          <div className="responsive-form-grid grid grid-cols-2 gap-3">
            <div>
              <label className="label">Logo (bill par)</label>
              <input
                ref={logoRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadImage(f, 'logoDataUrl')
                  e.target.value = ''
                }}
              />
              <div className="flex items-center gap-2">
                {form.logoDataUrl ? <img src={form.logoDataUrl} alt="logo" className="h-10 w-10 rounded-lg border object-contain" /> : null}
                <button className="btn btn-outline btn-sm" onClick={() => logoRef.current?.click()}>
                  {form.logoDataUrl ? 'Badlein' : 'Upload'}
                </button>
                {form.logoDataUrl ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, logoDataUrl: undefined })}>
                    ✕
                  </button>
                ) : null}
              </div>
            </div>
            <div>
              <label className="label">Signature (bill par)</label>
              <div className="flex items-center gap-2">
                {form.signatureDataUrl ? <img src={form.signatureDataUrl} alt="sign" className="h-10 rounded-lg border object-contain" /> : null}
                <label className="btn btn-outline btn-sm">
                  {form.signatureDataUrl ? 'Badlein' : 'Upload'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void uploadImage(f, 'signatureDataUrl')
                      e.target.value = ''
                    }}
                  />
                </label>
                {form.signatureDataUrl ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, signatureDataUrl: undefined })}>
                    ✕
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <button className={`btn ${savedTick ? 'btn-money' : 'btn-primary'} btn-block`} onClick={save}>
            {savedTick ? '✅ Save ho gaya' : '💾 Shop details save karein'}
          </button>
        </div>
      </div>

      {/* Cloud account (Google/Email) — login karne par data sync */}
      <CloudCard />

      {/* Company / Firm + Users & login */}
      <AccountCard />

      {/* Bill numbering */}
      <div className="card mt-3">
        <div className="text-[13px] font-bold text-slate-700">🔢 Bill number series</div>
        <div className="mt-1 text-[11px] text-slate-500">
          Har document type ka apna prefix aur next number. Example: INV/25-26/001
        </div>
        <div className="mt-2">
          {DOC_TYPES.map((d) => {
            const s = docSettings.find((x) => x.docType === d.key)
            return (
              <button key={d.key} className="list-row w-full text-left" onClick={() => s && setDocEdit(s)}>
                <span className="text-base">{d.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-slate-800">{d.label}</div>
                  <div className="truncate text-[11px] text-slate-500">
                    {s ? formatDocNumber(s, todayISO(), s.nextNumber) : '—'}
                  </div>
                </div>
                <span className="text-slate-400">›</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Data */}
      <div className="card mt-3">
        <div className="text-[13px] font-bold text-slate-700">💾 Data & backup</div>
        <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-5 text-center">
          <div className="rounded-xl bg-slate-50 py-2">
            <div className="num text-[13px] font-extrabold">{items}</div>
            <div className="text-[9px] font-bold uppercase text-slate-500">items</div>
          </div>
          <div className="rounded-xl bg-slate-50 py-2">
            <div className="num text-[13px] font-extrabold">{invoices}</div>
            <div className="text-[9px] font-bold uppercase text-slate-500">bills</div>
          </div>
          <div className="rounded-xl bg-slate-50 py-2">
            <div className="num text-[13px] font-extrabold">{parties}</div>
            <div className="text-[9px] font-bold uppercase text-slate-500">parties</div>
          </div>
          <div className="rounded-xl bg-slate-50 py-2">
            <div className="num text-[13px] font-extrabold">{payments}</div>
            <div className="text-[9px] font-bold uppercase text-slate-500">payments</div>
          </div>
          <div className="rounded-xl bg-slate-50 py-2">
            <div className="num text-[13px] font-extrabold">{expenses}</div>
            <div className="text-[9px] font-bold uppercase text-slate-500">kharcha</div>
          </div>
        </div>
        <div className="mt-2 flex flex-col gap-2">
          <button className="btn btn-outline btn-block" onClick={() => setBackupOpen(true)}>
            ⬆ Backup file banayein / restore karein
          </button>
          <button className="btn btn-danger-soft btn-block" onClick={() => setConfirmReset(true)}>
            🗑 Sara data mitaakar naya shuru karein
          </button>
        </div>
        <div className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Sara data aapke phone me hi (browser storage me) save hota hai — internet ke bina bhi chalta hai. Isliye mahine
          me ek baar backup file bana lein.
        </div>
      </div>

      {/* More */}
      <div className="card mt-3">
        <div className="text-[13px] font-bold text-slate-700">👥 Khata / Parties</div>
        <button className="btn btn-outline btn-block mt-2" onClick={onOpenParties}>
          Customer & supplier khata kholein
        </button>
      </div>

      <div className="card mt-3">
        <div className="text-[13px] font-bold text-slate-700">📊 Reports me kya-kya hai</div>
        <ul className="mt-1 list-inside list-disc text-[11px] leading-relaxed text-slate-500">
          <li>Sale, purchase, kharcha, gross + net profit</li>
          <li>GST / HSN summary (GSTR-1 jaisa), din-wise aur mahine-wise</li>
          <li>Udhaar aging — 0-30, 31-60, 61-90, 90+ din (lena / dena)</li>
          <li>Day book — ek din ka pura hisab (bill + payment + kharcha)</li>
          <li>Top items, top parties, stock value — sab CSV export</li>
        </ul>
      </div>

      <div className="card mt-3">
        <div className="text-[13px] font-bold text-slate-700">🧪 App self-test</div>
        <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
          Billing engine ka apna test — bill banana, GST, stock, payment, purchase, credit note, CSV, backup. Sab kuch
          browser me hi chalta hai aur test ke baad aapka asli data waapas jaisa tha waisa hi rehta hai (rollback).
        </div>
        <button className="btn btn-primary btn-block mt-2" disabled={testState === 'running'} onClick={() => void runTest()}>
          {testState === 'running' ? '⏳ Test chal raha hai…' : '🧪 Self-test chalayein'}
        </button>
        {testState === 'done' ? (
          <div
            className={`mt-2 rounded-xl px-3 py-2 text-center text-[12px] font-bold ${
              testResults.some((r) => !r.ok) ? 'bg-due-soft text-due' : 'bg-money-soft text-money'
            }`}
          >
            {testResults.filter((r) => r.ok).length}/{testResults.length} checks pass
            {testResults.some((r) => !r.ok) ? ' — details dekhein' : ' ✅'}
          </div>
        ) : null}
      </div>

      <div className="card mt-3">
        <div className="text-[13px] font-bold text-slate-700">📱 App install karein</div>
        <div className="mt-1 text-[11px] text-slate-500">
          {installPrompt
            ? 'Ek tap me phone me app ki tarah install karein — home screen par icon aa jayega.'
            : 'Chrome browser me kholkar menu (⋮) → “Add to Home screen” / “Install app” dabayein.'}
        </div>
        {installPrompt && onInstall ? (
          <button className="btn btn-primary btn-block mt-2" onClick={onInstall}>
            ⬇ Home screen par install karein
          </button>
        ) : null}
      </div>

      <div className="mt-4 text-center text-[10px] leading-relaxed text-slate-400">
        Showroom Manager — Billing Edition v2.0
        <br />
        Offline GST billing, estimate, challan, credit note, barcode billing & reports.
        <br />
        Aapka data aapke paas. 🤝
      </div>

      <Sheet
        open={testState === 'done'}
        onClose={() => setTestState('idle')}
        title="Self-test result"
        subtitle={`${testResults.filter((r) => r.ok).length}/${testResults.length} checks pass`}
        full
        footer={
          <button className="btn btn-primary btn-block" onClick={() => setTestState('idle')}>
            Band karein
          </button>
        }
      >
        {(() => {
          const groups = [...new Set(testResults.map((r) => r.group))]
          const failed = testResults.filter((r) => !r.ok)
          return (
            <div className="flex flex-col gap-3">
              <div
                className={`rounded-2xl px-3 py-2.5 text-[13px] font-bold ${
                  failed.length ? 'bg-due-soft text-due' : 'bg-money-soft text-money'
                }`}
              >
                {failed.length
                  ? `❌ ${failed.length} check fail — neeche dekhein`
                  : `✅ Sab theek hai — ${testResults.length}/${testResults.length} checks pass`}
              </div>
              {groups.map((g) => (
                <div key={g}>
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{g}</div>
                  <div className="card-flat overflow-hidden">
                    {testResults
                      .filter((r) => r.group === g)
                      .map((r, i) => (
                        <div key={i} className="flex items-start gap-2 border-b border-slate-100 px-3 py-2 last:border-0">
                          <span className="text-sm">{r.ok ? '✅' : '❌'}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] font-semibold text-slate-800">{r.name}</div>
                            {r.info ? <div className="truncate text-[10px] text-slate-500">{r.info}</div> : null}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
              <div className="text-[10px] leading-relaxed text-slate-400">
                Ye test aapke data par chal raha tha par last me sab rollback ho gaya — koi item, bill ya payment add
                nahi hua. Neeche wale counts Settings me waise hi rahenge.
              </div>
            </div>
          )
        })()}
      </Sheet>

      {docEdit ? <DocSettingSheet setting={docEdit} onClose={() => setDocEdit(null)} /> : null}

      <Sheet open={backupOpen} onClose={() => setBackupOpen(false)} title="Backup & restore" subtitle="JSON file me pura data">
        <div className="flex flex-col gap-2">
          <button
            className="btn btn-primary btn-block"
            onClick={async () => {
              try {
                const json = await exportBackup()
                download(`showroom-backup-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json')
                toast('Backup download ho gaya', 'success')
              } catch (e) { toast(e instanceof Error ? e.message : 'Backup nahi bana', 'error') }
            }}
          >
            ⬇ Backup download karein
          </button>
          <label className="btn btn-outline btn-block">
            ⬆ Backup file se restore karein
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                try {
                  const text = await readFileAsText(f)
                  await importBackup(text, 'merge')
                  onBusinessChange()
                  toast('Backup restore ho gaya', 'success')
                  setBackupOpen(false)
                } catch {
                  toast('File padhne me dikkat aayi', 'error')
                }
              }}
            />
          </label>
          <p className="text-[11px] text-slate-500">
            Restore mein same record update hoga aur naye records judenge; alag records overwrite nahi honge. Pehle backup
            le lein.
          </p>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmReset}
        title="Sara data delete karein?"
        message="Items, bills, parties — sab kuch mit jayega. Ye wapas nahi aayega. Pehle backup le lein!"
        confirmLabel="Sab delete karein"
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          try {
            await wipeAllData()
            await seedDatabase()
            await onBusinessChange()
            setConfirmReset(false)
            toast('Data reset ho gaya', 'success')
          } catch (e) { toast(e instanceof Error ? e.message : 'Reset nahi hua', 'error') }
        }}
      />
    </div>
  )
}

function DocSettingSheet({ setting, onClose }: { setting: DocSetting | null; onClose: () => void }) {
  const [draft, setDraft] = useState<DocSetting | null>(setting)
  const [key, setKey] = useState<string | null>(null)

  if (setting && key !== setting.docType) {
    setKey(setting.docType)
    setDraft(setting)
  }
  if (!draft) return null

  return (
    <Sheet
      open={!!setting}
      onClose={onClose}
      title="Number series"
      subtitle={DOC_TYPES.find((d) => d.key === draft.docType)?.label}
      footer={
        <button
          className="btn btn-primary btn-block"
          onClick={async () => {
            try {
              await requireOwnerIfConfigured()
              await db.docSettings.put({ ...draft, updatedAt: Date.now() })
              toast('Number series save ho gayi', 'success')
              onClose()
            } catch (e) { toast(e instanceof Error ? e.message : 'Number series save nahi hui', 'error') }
          }}
        >
          💾 Save
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="responsive-form-grid grid grid-cols-2 gap-3">
          <div className="field">
            <label className="label">Prefix</label>
            <input className="input" value={draft.prefix} onChange={(e) => setDraft({ ...draft, prefix: e.target.value.toUpperCase() })} />
          </div>
          <div className="field">
            <label className="label">Agla number</label>
            <input
              className="input text-right font-bold"
              inputMode="numeric"
              value={draft.nextNumber}
              onChange={(e) => setDraft({ ...draft, nextNumber: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
            />
          </div>
          <div className="field">
            <label className="label">Digits</label>
            <select className="select" value={draft.digits} onChange={(e) => setDraft({ ...draft, digits: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} digit
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Financial year number me</label>
            <Segmented
              value={draft.includeFy ? 'yes' : 'no'}
              onChange={(v) => setDraft({ ...draft, includeFy: v === 'yes' })}
              options={[
                { value: 'yes', label: 'Haan' },
                { value: 'no', label: 'Nahi' },
              ]}
            />
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-[12px]">
          Agla bill number:{' '}
          <b>
            {formatDocNumber(draft, todayISO(), draft.nextNumber)}
          </b>
        </div>
        <div className="field">
          <label className="label">Is document ke liye default terms</label>
          <textarea className="textarea" value={draft.terms} onChange={(e) => setDraft({ ...draft, terms: e.target.value })} />
        </div>
        <div className="text-[11px] text-slate-500">
          Tip: Estimate aur Tax Invoice ke number alag rakhein — jaise EST/25-26/007 aur INV/25-26/123.
        </div>
      </div>
    </Sheet>
  )
}
