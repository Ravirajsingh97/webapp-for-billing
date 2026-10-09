import { useEffect, useRef, useState } from 'react'
import type { Worker } from 'tesseract.js'
import { newInvoice } from '../lib/repo'
import { suggestPurchaseLines } from '../lib/ocr'
import type { Business, Invoice } from '../lib/types'
import { toast } from '../components/ui'

export function OCRScreen({ business, onDraft }: { business: Business; onDraft: (draft: Invoice) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [text, setText] = useState('')
  const [language, setLanguage] = useState('eng')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const worker = useRef<Worker | null>(null)
  const generation = useRef(0)
  const active = useRef(false)
  const suggestions = suggestPurchaseLines(text)
  useEffect(() => {
    if (!file) { setPreview(''); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  useEffect(() => () => { generation.current++; active.current = false; void worker.current?.terminate(); worker.current = null }, [])
  const cancel = () => { generation.current++; active.current = false; void worker.current?.terminate(); worker.current = null; setBusy(false); setProgress('Cancelled — you can try again.') }
  const recognize = async () => {
    if (!file || active.current) return
    active.current = true
    const token = ++generation.current
    setBusy(true); setReviewed(false); setProgress('OCR engine load ho raha hai…')
    let current: Worker | null = null
    try {
      const { createWorker } = await import('tesseract.js')
      if (token !== generation.current) return
      current = await createWorker(language, 1, { logger: m => {
        if (token === generation.current) setProgress(`${m.status} ${Math.round((m.progress ?? 0) * 100)}%`)
      } })
      if (token !== generation.current) return
      worker.current = current
      const result = await current.recognize(file)
      if (token !== generation.current) return
      setText(result.data.text); setProgress(`Done • confidence ${Math.round(result.data.confidence)}%. Text ko zaroor check karein.`)
      if (!result.data.text.trim()) toast('Text nahi mila. Clear, seedhi photo try karein.', 'error')
    } catch (e) {
      if (token === generation.current) { setProgress('OCR failed. Internet / image check karke retry karein, ya text paste karein.'); toast(e instanceof Error ? e.message : 'OCR failed', 'error') }
    } finally {
      if (current) void current.terminate()
      if (token === generation.current) { worker.current = null; active.current = false; setBusy(false) }
    }
  }
  const createDraft = async () => {
    try {
      const draft = await newInvoice('PURCHASE')
      onDraft({ ...draft, placeOfSupply: business.stateCode, items: suggestions, notes: `OCR source — verify against original:\n${text}` })
    } catch (e) { toast(e instanceof Error ? e.message : 'Draft nahi bana', 'error') }
  }
  return <main className="screen-content grid gap-5 lg:grid-cols-2">
    <section className="card self-start">
      <h1 className="text-xl font-bold">Bill photo → text / purchase draft</h1>
      <p className="my-3 text-sm text-slate-600">Clear printed bill ki JPG, PNG ya WebP photo upload karein (max 10 MB). OCR browser mein hota hai; photo upload nahi hoti. Engine aur language download ke liye internet chahiye.</p>
      <label className="field"><span className="label">Bill image</span><input className="input" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => {
        const next = e.target.files?.[0]
        if (!next) return
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type) || next.size > 10 * 1024 * 1024) { toast('JPG, PNG, WebP image, maximum 10 MB', 'error'); e.target.value = ''; return }
        setFile(next); setText(''); setReviewed(false); setProgress('')
      }} /></label>
      <label className="field mt-3"><span className="label">Printed language</span><select className="select" value={language} disabled={busy} onChange={e => setLanguage(e.target.value)}><option value="eng">English</option><option value="eng+hin">Hindi + English</option></select></label>
      {preview && <img src={preview} alt="Selected bill for OCR" className="mt-4 max-h-96 w-full rounded-xl object-contain" />}
      <div className="mt-4 flex flex-wrap gap-2"><button className="btn btn-primary" disabled={!file || busy} onClick={() => void recognize()}>Extract text</button>{busy && <button className="btn btn-outline" onClick={cancel}>Cancel</button>}</div>
      <p className="mt-3 text-sm text-slate-500" role="status" aria-live="polite">{progress}</p>
    </section>
    <section className="card self-start">
      <label className="field"><span className="label">Extracted text — edit or paste here</span><textarea className="textarea min-h-64" value={text} disabled={busy} onChange={e => { setText(e.target.value); setReviewed(false) }} placeholder="OCR result appears here. You can also paste bill text." /></label>
      <p className="my-3 text-sm text-slate-600">{suggestions.length} item suggestions (Name Qty Rate Amount). GST, supplier, date, totals aur items next screen par verify karein. Unsupported rows text mein rahenge.</p>
      <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">OCR items stock se linked nahi hain. Stock update ke liye draft mein suggestion remove karke catalogue ka matching item add karein. Draft save hone tak khata / stock mein kuch post nahi hota.</div>
      <label className="my-4 flex items-start gap-2 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={busy} /> Main original bill se draft details aur tax check karunga.</label>
      <button className="btn btn-primary w-full" disabled={busy || !text.trim() || !reviewed} onClick={() => void createDraft()}>Review purchase draft</button>
    </section>
  </main>
}
