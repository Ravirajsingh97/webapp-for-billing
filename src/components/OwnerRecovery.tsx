import { useRef, useState } from 'react'
import { createOwnerRecoveryCode, recoverOwnerPin, type User } from '../lib/auth'
import { Sheet, toast } from './ui'

export function OwnerRecoverySetup({ onClose }: { onClose: () => void }) {
  const pending = useRef(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generate = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError('')
    try { setCode(await createOwnerRecoveryCode()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Recovery code nahi bana') }
    finally { pending.current = false; setBusy(false) }
  }
  return <Sheet open onClose={() => { if (!busy) onClose() }} title="Owner PIN recovery" subtitle="PIN bhoolne par isi company mein kaam aayega" footer={
    <button className="btn btn-primary btn-block" disabled={busy} onClick={() => code ? onClose() : void generate()}>
      {busy ? 'Code bana rahe hain…' : code ? 'Code save kar liya' : 'Recovery code banayein'}
    </button>
  }>
    {code ? <>
      <label htmlFor="owner-recovery-code" className="text-[12px] font-semibold text-slate-600">Apna recovery code</label>
      <textarea id="owner-recovery-code" className="input mt-2 font-mono" readOnly rows={2} value={code} />
      <p className="mt-3 text-[12px] text-slate-600">Is code ko phone se alag safe jagah likh kar rakhein. Band karne ke baad code dobara nahi dikhega. Ye ek baar chalega; purana recovery code ab nahi chalega.</p>
    </> : <p className="text-[13px] text-slate-600">Apne owner account ka recovery code banayein. Login screen par is code se naya PIN bana sakte hain. Naya code banane par purana code band ho jayega.</p>}
    {error ? <p role="alert" className="mt-3 text-[12px] text-red-600">{error}</p> : null}
  </Sheet>
}

export function OwnerPinRecovery({ user, onClose, onRecovered }: { user: User; onClose: () => void; onRecovered: () => void }) {
  const pending = useRef(false)
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const recover = async () => {
    if (pending.current) return
    if (pin !== confirm) return setError('Dono PIN ek jaise likhein')
    pending.current = true
    setBusy(true); setError('')
    try {
      await recoverOwnerPin(user.id!, code, pin)
      toast('PIN badal gaya. Naye PIN se login karke naya recovery code banayein.', 'success')
      onRecovered()
    } catch (e) { setError(e instanceof Error ? e.message : 'PIN recover nahi hua') }
    finally { pending.current = false; setBusy(false) }
  }
  return <Sheet open onClose={() => { if (!busy) onClose() }} title={`${user.name} · PIN recovery`} subtitle="Owner ka saved recovery code chahiye" footer={user.recoveryHash ?
    <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void recover()}>{busy ? 'PIN badal rahe hain…' : 'Naya PIN save karein'}</button> : undefined
  }>
    {user.recoveryHash ? <fieldset disabled={busy}>
      <label htmlFor="recovery-input" className="text-[12px] font-semibold text-slate-600">Recovery code</label>
      <input id="recovery-input" className="input mb-3" type="password" autoComplete="off" placeholder="Saved recovery code" value={code} onChange={e => setCode(e.target.value)} />
      <label htmlFor="recovery-pin" className="text-[12px] font-semibold text-slate-600">Naya PIN (4–6 ank)</label>
      <input id="recovery-pin" className="input mb-3" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
      <label htmlFor="recovery-confirm" className="text-[12px] font-semibold text-slate-600">PIN dobara</label>
      <input id="recovery-confirm" className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g, ''))} />
    </fieldset> : <p className="text-[13px] text-slate-600">Is owner ke liye recovery code set nahi hai. Kisi doosre logged-in owner se Settings mein PIN badalwayein. PIN aur recovery code dono na hon to is device par owner access recover nahi ho sakta.</p>}
    {error ? <p role="alert" className="mt-3 text-[12px] text-red-600">{error}</p> : null}
  </Sheet>
}
