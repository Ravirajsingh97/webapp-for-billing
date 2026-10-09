import { useEffect, useRef, useState } from 'react'
import { Sheet } from './ui'

type AnyBarcodeDetector = {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>
}

type DetectorCtor = new (opts?: { formats?: string[] }) => AnyBarcodeDetector

/**
 * Camera barcode scanner. Uses the native BarcodeDetector API (Chrome on Android).
 * If the browser does not support it, the shopkeeper can use a USB/Bluetooth
 * scanner or type the code — both paths are offered here.
 */
export function BarcodeScanner({
  open,
  onClose,
  onDetect,
}: {
  open: boolean
  onClose: () => void
  onDetect: (code: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const [status, setStatus] = useState<'starting' | 'scanning' | 'unsupported' | 'denied'>('starting')
  const [manual, setManual] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector

    const stop = () => {
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        if (!Ctor) {
          setStatus('unsupported')
          return
        }
        setStatus('scanning')
        const detector = new Ctor({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code'],
        })
        let last = 0
        const tick = async (ts: number) => {
          if (cancelled) return
          if (ts - last > 280 && videoRef.current && videoRef.current.readyState >= 2) {
            last = ts
            try {
              const codes = await detector.detect(videoRef.current)
              if (codes.length && codes[0].rawValue) {
                const value = codes[0].rawValue
                navigator.vibrate?.(60)
                onDetect(value)
                stop()
                onClose()
                return
              }
            } catch {
              /* frame skip */
            }
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch {
        setStatus('denied')
      }
    }

    setStatus('starting')
    void start()
    return () => {
      cancelled = true
      stop()
    }
  }, [open, onClose, onDetect])

  const submitManual = () => {
    const v = manual.trim()
    if (!v) return
    onDetect(v)
    setManual('')
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Barcode scan" subtitle="Item ka barcode camera ke saamne rakhein">
      <div className="relative overflow-hidden rounded-2xl bg-slate-900" style={{ aspectRatio: '4/3' }}>
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="h-24 w-4/5 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
        </div>
      </div>

      {status === 'unsupported' ? (
        <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-xs font-semibold text-warn">
          Is browser me camera-scan support nahi hai. Chrome (Android) me chalega. Aap USB/Bluetooth scanner se code
          daal sakte hain — neeche box me type karke Enter dabayein.
        </p>
      ) : null}
      {status === 'denied' ? (
        <p className="mt-3 rounded-xl bg-due-soft px-3 py-2 text-xs font-semibold text-due">
          Camera ki permission nahi mili. Browser settings me allow karein, ya neeche code type karein.
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <input
          className="input"
          placeholder="Ya code manually likhein…"
          value={manual}
          inputMode="numeric"
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitManual()}
          autoFocus={status !== 'scanning'}
        />
        <button className="btn btn-primary" onClick={submitManual}>
          Add
        </button>
      </div>
    </Sheet>
  )
}
