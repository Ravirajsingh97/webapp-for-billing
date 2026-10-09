import { useState } from 'react'
import { db, setSetting } from '../lib/db'
import { toast } from '../components/ui'
import { STATES } from '../lib/types'
import type { Business } from '../lib/types'

export function Onboarding({ business, onDone }: { business: Business; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<Business>({ ...business })

  const save = async () => {
    if (!form.name.trim()) {
      toast('Dukaan ka naam likhein', 'error')
      return
    }
    const stateName = STATES.find((s) => s.code === form.stateCode)?.name ?? ''
    const existing = (await db.business.toCollection().first())?.id
    const rec = { ...form, isPlaceholder: false, updatedAt: Date.now(), name: form.name.trim(), stateName }
    if (existing) await db.business.update(existing, rec)
    else await db.business.add(rec)
    await setSetting('onboarded', 'yes')
    toast('Setup ho gaya! Ab bill banayein 🎉', 'success')
    onDone()
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-800 to-brand-900 px-4 pb-8 pt-10 text-white">
      <div className="mx-auto w-full max-w-[460px]">
        <div className="text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-white/10 text-3xl shadow-lg">🏪</div>
          <h1 className="mt-3 text-2xl font-extrabold">Showroom Manager</h1>
          <p className="mt-1 text-[12px] text-brand-100">
            GST billing • Estimate • Barcode billing • Stock • Reports — sab offline
          </p>
        </div>

        {step === 0 ? (
          <div className="mt-6 rounded-3xl bg-white p-4 text-slate-900 shadow-2xl">
            <div className="text-[15px] font-bold">Pehle apni dukaan ki details bhar lein</div>
            <p className="mt-1 text-[11px] text-slate-500">
              Ye details bill ke upar chhapti hain. Baad me Settings se kabhi bhi badal sakte hain.
            </p>
            <div className="mt-3 flex flex-col gap-3">
              <div className="field">
                <label className="label">Shop ka naam *</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sharma Sanitary Store" autoFocus />
              </div>
              <div className="field">
                <label className="label">Address</label>
                <textarea className="textarea" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="responsive-form-grid grid grid-cols-2 gap-3">
                <div className="field">
                  <label className="label">Mobile</label>
                  <input className="input" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="field">
                  <label className="label">GSTIN</label>
                  <input className="input uppercase" value={form.gstin ?? ''} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="08ABCDE1234F1Z5" />
                </div>
              </div>
              <div className="responsive-form-grid grid grid-cols-2 gap-3">
                <div className="field">
                  <label className="label">State</label>
                  <select className="select" value={form.stateCode} onChange={(e) => setForm({ ...form, stateCode: e.target.value })}>
                    {STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="label">UPI ID (optional)</label>
                  <input className="input" value={form.upiId ?? ''} onChange={(e) => setForm({ ...form, upiId: e.target.value })} placeholder="dukaan@upi" />
                </div>
              </div>
              <button className="btn btn-primary btn-lg btn-block" onClick={() => setStep(1)}>
                Aage badhein →
              </button>
              <button
                className="btn btn-ghost btn-block text-slate-500"
                onClick={async () => {
                  await setSetting('onboarded', 'yes')
                  onDone()
                }}
              >
                Abhi skip karein (baad me bharunga)
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-3xl bg-white p-4 text-slate-900 shadow-2xl">
            <div className="text-[15px] font-bold">Aap ye sab kar sakte hain 👇</div>
            <div className="mt-3 flex flex-col gap-2 text-[12px]">
              {[
                ['🧾', 'Tax Invoice / पक्का बिल — GST ke saath, print aur WhatsApp'],
                ['📝', 'Estimate / Quotation — grahak ko rate bhejein'],
                ['🚚', 'Delivery Challan, Proforma, Bill of Supply, Credit Note'],
                ['▮▯', 'Barcode scan karke 2 second me billing'],
                ['📱', 'UPI QR bill par — party scan karke paisa bheje'],
                ['📦', 'Stock aur low-stock alert ke saath item master'],
                ['👥', 'Customer khata — kiska kitna udhaar baaki hai'],
                ['📊', 'Sale, profit, GST/HSN report — CSV export'],
              ].map(([icon, text]) => (
                <div key={text} className="flex items-start gap-2 rounded-xl bg-slate-50 p-2.5">
                  <span className="text-base">{icon}</span>
                  <span className="font-semibold text-slate-700">{text}</span>
                </div>
              ))}
            </div>
            <button className="btn btn-primary btn-lg btn-block mt-4" onClick={save}>
              ✅ Setup complete — shuru karein
            </button>
            <button className="btn btn-ghost btn-block mt-1 text-slate-500" onClick={() => setStep(0)}>
              ← Details badlein
            </button>
          </div>
        )}

        <p className="mt-4 text-center text-[10px] text-brand-200">
          Aapka data sirf aapke phone me save hota hai. Koi login zaroori nahi.
        </p>
      </div>
    </div>
  )
}
