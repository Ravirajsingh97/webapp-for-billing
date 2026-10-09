import { useState } from 'react'

/**
 * Jab app load na ho paye (storage band, koi error) to blank/dheemi screen ki jagah
 * saaf message + "naye tab me kholein" button dikhate hain.
 */
export function BootProblem({
  title,
  message,
  detail,
  url,
}: {
  title: string
  message: string
  detail?: string
  url: string
}) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 px-6 py-10 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-3xl bg-warn-soft text-3xl">⚠️</div>
      <h1 className="text-lg font-extrabold text-slate-900">{title}</h1>
      <p className="max-w-[400px] text-sm leading-relaxed text-slate-600">{message}</p>

      <a className="btn btn-primary btn-lg mt-1" href={url} target="_blank" rel="noreferrer">
        ↗ Naye tab me kholein (isasahi kaam karega)
      </a>

      <button
        className="btn btn-outline btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          } catch {
            /* ignore */
          }
        }}
      >
        {copied ? '✅ Link copy ho gaya' : '🔗 App ka link copy karein'}
      </button>

      <div className="max-w-[400px] rounded-2xl border border-brand-200 bg-brand-50 p-3 text-left text-[11px] leading-relaxed text-brand-900">
        <b>Sabse aasan tarika:</b> ye page jo link par khula hai, use phone ke <b>Chrome</b> me naye tab me kholein.
        Wahin app ka pura data (items, bills, khata) save hoga aur wahan se app home screen par bhi install ho jayegi.
      </div>

      {detail ? (
        <pre className="max-h-40 w-full max-w-[420px] overflow-auto rounded-xl bg-slate-900 p-3 text-left text-[10px] leading-relaxed text-slate-200">
          {detail}
        </pre>
      ) : null}
    </div>
  )
}
