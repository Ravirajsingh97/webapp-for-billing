import { useState } from 'react'

/**
 * Preview / iframe / incognito me browser storage (IndexedDB) block kar deta hai.
 * Aise me app in-memory database par chalta hai — pura kaam karta hai, bas refresh par
 * data mit jata hai. Ye banner user ko saaf-saaf batata hai.
 */
export function DemoBanner({ embedded }: { embedded: boolean }) {
  const [open, setOpen] = useState(true)
  if (!open) return null
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        padding: '8px 12px',
        background: '#fbbf24',
        color: '#111827',
        font: '12px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        boxShadow: '0 -2px 12px rgba(0,0,0,.18)',
      }}
    >
      <span style={{ flex: 1 }}>
        <b>Demo mode</b> — {embedded ? 'is preview window me' : 'is browser me'} data save karne ki jagah
        block hai, isliye abhi ka data refresh karne par mit jayega. Baaki sab kuch chalta hai — bill,
        print, WhatsApp share, khata, reports. Data hamesha ke liye save karne ke liye app apne
        phone/laptop ke browser me kholein.
      </span>
      <button
        onClick={() => setOpen(false)}
        aria-label="Band karein"
        style={{
          border: 0,
          background: '#111827',
          color: '#fff',
          borderRadius: 6,
          padding: '4px 9px',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        ✕
      </button>
    </div>
  )
}
