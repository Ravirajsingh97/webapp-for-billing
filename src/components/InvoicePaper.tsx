import { useEffect, useRef, useState, type ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { Business, Invoice } from '../lib/types'
import { docMeta, stateName } from '../lib/types'
import { computeTotals, hsnSummary } from '../lib/calc'
import { amountInWords, fmtDate, money, num, round2 } from '../lib/format'
import { upiUri } from '../lib/doc'

export const A4_WIDTH = 794
export const THERMAL_WIDTH = 300

/** Scales a fixed-width paper down to fit its container (phone preview). */
export function PaperScaler({ children, paperWidth = A4_WIDTH }: { children: ReactNode; paperWidth?: number }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const compute = () => {
      const w = outer.current?.clientWidth ?? paperWidth
      const s = Math.min(1, w / paperWidth)
      setScale(s)
      setHeight((inner.current?.scrollHeight ?? 0) * s)
    }
    compute()
    const ro = new ResizeObserver(compute)
    if (outer.current) ro.observe(outer.current)
    if (inner.current) ro.observe(inner.current)
    return () => ro.disconnect()
  }, [paperWidth, children])

  return (
    <div ref={outer} style={{ height: height || undefined }} className="w-full overflow-hidden">
      <div
        ref={inner}
        style={{ width: paperWidth, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        {children}
      </div>
    </div>
  )
}

export function InvoicePaper({
  invoice,
  business,
  mode,
}: {
  invoice: Invoice
  business: Business
  mode: 'a4' | 'thermal'
}) {
  const meta = docMeta(invoice.docType)
  const t = computeTotals(invoice, business.stateCode)
  const hsn = hsnSummary(invoice, t)
  const due = t.due > 0.5

  const title =
    invoice.docType === 'TAX_INVOICE'
      ? 'TAX INVOICE'
      : invoice.docType === 'ESTIMATE'
        ? 'ESTIMATE / QUOTATION'
        : invoice.docType === 'PROFORMA'
          ? 'PROFORMA INVOICE'
          : invoice.docType === 'DELIVERY_CHALLAN'
            ? 'DELIVERY CHALLAN'
            : invoice.docType === 'BILL_OF_SUPPLY'
              ? 'BILL OF SUPPLY'
              : invoice.docType === 'CREDIT_NOTE'
                ? 'CREDIT NOTE'
                : 'PURCHASE BILL'

  const qr =
    due && business.upiId
      ? upiUri({
          upiId: business.upiId,
          payeeName: business.name,
          amount: t.due,
          note: `Bill ${invoice.number}`,
        })
      : ''

  const bankLine = [business.bankName, business.bankAccount, business.bankIfsc].filter(Boolean).join(' • ')

  if (mode === 'thermal') {
    return (
      <div className="paper paper-thermal mx-auto" style={{ width: THERMAL_WIDTH }}>
        <div className="text-center">
          <div className="text-[15px] font-extrabold uppercase leading-tight">{business.name}</div>
          {business.tagline ? <div className="text-[10px]">{business.tagline}</div> : null}
          {business.address ? <div className="text-[10px] leading-snug">{business.address}</div> : null}
          {business.phone ? <div className="text-[10px]">Ph: {business.phone}</div> : null}
          {business.gstin ? <div className="text-[10px]">GSTIN: {business.gstin}</div> : null}
        </div>
        <div className="dash" />
        <div className="text-center text-[12px] font-bold">{title}</div>
        <div className="dash" />
        <div className="text-[10px]">
          <div className="flex justify-between">
            <span>No: {invoice.number}</span>
            <span>{fmtDate(invoice.date, 'num')}</span>
          </div>
          {invoice.partyName ? <div>Party: {invoice.partyName}</div> : <div>Party: Cash Sale</div>}
          {invoice.partyPhone ? <div>Mob: {invoice.partyPhone}</div> : null}
          {invoice.partyGstin ? <div>GSTIN: {invoice.partyGstin}</div> : null}
          {invoice.vehicleNo ? <div>Vehicle: {invoice.vehicleNo}</div> : null}
        </div>
        <div className="dash" />
        <table>
          <tbody>
            {invoice.items.map((l, i) => (
              <tr key={l.id}>
                <td colSpan={2} style={{ paddingTop: 3 }}>
                  <div className="font-semibold leading-tight">{l.name}</div>
                  <div className="flex justify-between text-[10px]">
                    <span>
                      {num(l.qty, 0)} {l.unit} × {num(l.rate)} {l.discountPercent ? `- ${num(l.discountPercent, 0)}%` : ''}
                    </span>
                    <span className="font-semibold">{num(t.lines[i]?.total ?? 0)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="dash" />
        <div className="text-[11px]">
          <Line l="Qty" r={num(t.totalQty, 0)} />
          <Line l="Taxable" r={num(t.taxableNet)} />
          {!meta.noTax && t.tax > 0 ? (
            t.interState ? (
              <Line l="IGST" r={num(t.igst)} />
            ) : (
              <>
                <Line l="CGST" r={num(t.cgst)} />
                <Line l="SGST" r={num(t.sgst)} />
              </>
            )
          ) : null}
          {t.billDiscount > 0 ? <Line l="Bill Discount" r={'-' + num(t.billDiscount)} /> : null}
          {t.charges ? <Line l="Other Charges" r={num(t.charges)} /> : null}
          {Math.abs(t.roundOff) >= 0.01 ? <Line l="Round Off" r={num(t.roundOff)} /> : null}
          <div className="dash" />
          <div className="flex justify-between text-[14px] font-extrabold">
            <span>TOTAL</span>
            <span>{money(t.grandTotal)}</span>
          </div>
          {t.paid > 0 ? <Line l="Paid" r={num(t.paid)} /> : null}
          {due ? <Line l="BAKI / DUE" r={num(t.due)} /> : <div className="text-center font-bold">*** PAID ***</div>}
        </div>
        <div className="dash" />
        {qr ? (
          <div className="flex flex-col items-center">
            <QRCodeSVG value={qr} size={96} level="M" />
            <div className="text-[9px]">Scan & Pay {money(t.due)} — {business.upiId}</div>
          </div>
        ) : null}
        <div className="text-center text-[9px] leading-snug">
          {invoice.terms || business.terms}
        </div>
        <div className="dash" />
        <div className="text-center text-[10px] font-semibold">Dhanyavaad! 🙏</div>
      </div>
    )
  }

  // ---------------- A4 ----------------
  return (
    <div className="paper mx-auto" style={{ width: A4_WIDTH, padding: 26, fontSize: 11 }}>
      <div style={{ border: '1.5px solid #0f172a' }}>
        {/* Header */}
        <div className="flex" style={{ borderBottom: '1.5px solid #0f172a' }}>
          <div className="flex flex-1 items-start gap-3 p-3">
            {business.logoDataUrl ? (
              <img src={business.logoDataUrl} alt="logo" style={{ width: 54, height: 54, objectFit: 'contain' }} />
            ) : (
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 8,
                  background: '#312e81',
                  color: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 22,
                  fontWeight: 800,
                }}
              >
                {business.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 0.3 }}>{business.name}</div>
              {business.tagline ? <div style={{ fontSize: 10.5, color: '#334155' }}>{business.tagline}</div> : null}
              <div style={{ fontSize: 10.5, lineHeight: 1.45, color: '#0f172a' }}>
                {business.address}
                {business.phone ? <div>Mobile: {business.phone}{business.email ? ` • ${business.email}` : ''}</div> : null}
                {business.gstin ? <div><b>GSTIN: {business.gstin}</b></div> : null}
              </div>
            </div>
          </div>
          <div style={{ width: 240, borderLeft: '1.5px solid #0f172a' }}>
            <div
              style={{
                textAlign: 'center',
                fontWeight: 800,
                fontSize: 13,
                padding: '4px 0',
                borderBottom: '1px solid #0f172a',
                background: '#eef2ff',
              }}
            >
              {title}
            </div>
            <div style={{ padding: '5px 8px', fontSize: 10.5, lineHeight: 1.6 }}>
              <div className="flex justify-between"><span>Invoice No.</span><b>{invoice.number}</b></div>
              <div className="flex justify-between"><span>Date</span><b>{fmtDate(invoice.date)}</b></div>
              {invoice.dueDate ? (
                <div className="flex justify-between"><span>Due Date</span><b>{fmtDate(invoice.dueDate)}</b></div>
              ) : null}
              <div className="flex justify-between">
                <span>Place of Supply</span>
                <b>{invoice.placeOfSupply ? `${invoice.placeOfSupply}-${stateName(invoice.placeOfSupply)}` : '—'}</b>
              </div>
              {invoice.poNumber ? (
                <div className="flex justify-between"><span>PO / Ref</span><b>{invoice.poNumber}</b></div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Party */}
        <div className="flex" style={{ borderBottom: '1.5px solid #0f172a' }}>
          <div className="flex-1 p-2.5" style={{ borderRight: '1px solid #94a3b8' }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
              {meta.isSale || meta.negative ? 'Bill To' : meta.isPurchase ? 'Supplier (bill from)' : 'Party Details'}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{invoice.partyName || 'Cash Sale / Walk-in Customer'}</div>
            <div style={{ fontSize: 10.5, lineHeight: 1.5 }}>
              {invoice.partyAddress}
              {invoice.partyPhone ? <div>Mobile: {invoice.partyPhone}</div> : null}
              {invoice.partyGstin ? <div>GSTIN: {invoice.partyGstin}</div> : null}
            </div>
          </div>
          <div className="p-2.5" style={{ width: 300 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
              Transport / Dispatch
            </div>
            <div style={{ fontSize: 10.5, lineHeight: 1.5 }}>
              {invoice.transportName ? <div>Transport: {invoice.transportName}</div> : null}
              {invoice.vehicleNo ? <div>Vehicle No: {invoice.vehicleNo}</div> : null}
              {invoice.eWayBill ? <div>E-Way Bill: {invoice.eWayBill}</div> : null}
              <div>
                Payment:{' '}
                {t.paid > 0
                  ? meta.isPurchase
                    ? `${money(t.paid)} paid`
                    : `${money(t.paid)} received`
                  : meta.isPurchase
                    ? 'Payable / udhaar'
                    : 'Credit / Due'}
              </div>
            </div>
          </div>
        </div>

        {/* Items */}
        <table>
          <thead>
            <tr>
              <th style={{ width: 26 }}>#</th>
              <th>Item Description</th>
              <th style={{ width: 58 }}>HSN</th>
              <th style={{ width: 46 }}>Qty</th>
              <th style={{ width: 34 }}>Unit</th>
              <th style={{ width: 68 }}>Rate</th>
              <th style={{ width: 46 }}>Disc%</th>
              <th style={{ width: 74 }}>Taxable</th>
              {meta.noTax ? null : <th style={{ width: 40 }}>GST%</th>}
              {meta.noTax ? null : <th style={{ width: 62 }}>GST Amt</th>}
              <th style={{ width: 78 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((l, i) => (
              <tr key={l.id}>
                <td style={{ textAlign: 'center' }}>{i + 1}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{l.name}</div>
                  <div style={{ fontSize: 9.5, color: '#475569' }}>
                    {[l.code && `Code: ${l.code}`, l.brand].filter(Boolean).join(' • ')}
                  </div>
                </td>
                <td style={{ textAlign: 'center' }}>{l.hsn || '—'}</td>
                <td style={{ textAlign: 'right' }}>{num(l.qty, 0)}</td>
                <td style={{ textAlign: 'center' }}>{l.unit}</td>
                <td style={{ textAlign: 'right' }}>{num(l.rate)}</td>
                <td style={{ textAlign: 'right' }}>{l.discountPercent ? num(l.discountPercent, 0) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{num(t.lines[i]?.taxableAfterBillDiscount ?? 0)}</td>
                {meta.noTax ? null : <td style={{ textAlign: 'center' }}>{num(l.gstPercent, 0)}%</td>}
                {meta.noTax ? null : <td style={{ textAlign: 'right' }}>{num(t.lines[i]?.tax ?? 0)}</td>}
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(t.lines[i]?.total ?? 0)}</td>
              </tr>
            ))}
            {invoice.items.length === 0 ? (
              <tr>
                <td colSpan={meta.noTax ? 9 : 11} style={{ textAlign: 'center', color: '#64748b' }}>
                  No items
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex" style={{ borderTop: '1.5px solid #0f172a' }}>
          <div className="flex-1 p-2.5" style={{ borderRight: '1px solid #94a3b8' }}>
            <div style={{ fontSize: 10.5 }}>
              <b>Amount in words:</b> {amountInWords(t.grandTotal)}
            </div>
            {!meta.noTax && hsn.length > 0 ? (
              <table style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th>HSN</th>
                    <th>Taxable</th>
                    <th>GST%</th>
                    <th>CGST</th>
                    <th>SGST</th>
                    {t.interState ? <th>IGST</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {hsn.map((h) => (
                    <tr key={h.hsn}>
                      <td>{h.hsn}</td>
                      <td style={{ textAlign: 'right' }}>{num(h.taxable)}</td>
                      <td style={{ textAlign: 'center' }}>{num(h.rate, 0)}%</td>
                      <td style={{ textAlign: 'right' }}>{t.interState ? '—' : num(round2(h.tax / 2))}</td>
                      <td style={{ textAlign: 'right' }}>{t.interState ? '—' : num(round2(h.tax - h.tax / 2))}</td>
                      {t.interState ? <td style={{ textAlign: 'right' }}>{num(h.tax)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {bankLine ? (
              <div style={{ fontSize: 10, marginTop: 6 }}>
                <b>Bank:</b> {bankLine}
              </div>
            ) : null}
            {qr ? (
              <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
                <QRCodeSVG value={qr} size={78} level="M" />
                <div style={{ fontSize: 10 }}>
                  <b>Scan &amp; Pay {money(t.due)}</b>
                  <div>UPI: {business.upiId}</div>
                  <div style={{ color: '#475569' }}>Phone se QR scan karke payment karein</div>
                </div>
              </div>
            ) : null}
            <div style={{ fontSize: 9.5, marginTop: 6, whiteSpace: 'pre-line', color: '#334155' }}>
              <b>Terms &amp; Conditions:</b>
              {'\n'}
              {invoice.terms || business.terms}
            </div>
          </div>
          <div style={{ width: 262, padding: '6px 10px' }}>
            <TotalRow l="Total MRP / Gross" v={num(t.gross)} />
            {t.lineDiscount > 0 ? <TotalRow l="Item Discount" v={'-' + num(t.lineDiscount)} /> : null}
            {t.billDiscount > 0 ? <TotalRow l="Bill Discount" v={'-' + num(t.billDiscount)} /> : null}
            <TotalRow l="Taxable Amount" v={num(t.taxableNet)} />
            {t.interState ? (
              <TotalRow l="IGST" v={num(t.igst)} />
            ) : (
              <>
                <TotalRow l="CGST" v={num(t.cgst)} />
                <TotalRow l="SGST" v={num(t.sgst)} />
              </>
            )}
            {t.charges ? <TotalRow l="Other Charges" v={num(t.charges)} /> : null}
            {Math.abs(t.roundOff) >= 0.01 ? <TotalRow l="Round Off" v={num(t.roundOff)} /> : null}
            <div
              className="flex items-center justify-between"
              style={{ borderTop: '1.5px solid #0f172a', marginTop: 4, paddingTop: 4 }}
            >
              <span style={{ fontWeight: 800, fontSize: 12 }}>GRAND TOTAL</span>
              <span style={{ fontWeight: 800, fontSize: 15 }}>{money(t.grandTotal)}</span>
            </div>
            {t.paid > 0 ? <TotalRow l="Paid" v={num(t.paid)} /> : null}
            <TotalRow l={due ? 'Balance Due' : 'Status'} v={due ? money(t.due) : 'PAID'} strong />
            <div style={{ height: 44 }} />
            <div style={{ textAlign: 'center', fontSize: 10 }}>
              {business.signatureDataUrl ? (
                <img src={business.signatureDataUrl} alt="sign" style={{ height: 34, margin: '0 auto' }} />
              ) : null}
              <div style={{ borderTop: '1px solid #334155', paddingTop: 2 }}>For {business.name}</div>
              <div style={{ color: '#64748b' }}>Authorised Signatory</div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 9, color: '#475569', marginTop: 4 }}>
        This is a computer generated {title.toLowerCase()}. Subject to {business.stateName || 'local'} jurisdiction.
        {invoice.docType === 'ESTIMATE' ? ' Ye quotation/estimate hai, pakka bill nahi.' : ''}
      </div>
    </div>
  )
}

const TotalRow = ({ l, v, strong }: { l: string; v: string; strong?: boolean }) => (
  <div className="flex justify-between" style={{ fontSize: strong ? 12 : 11, padding: '1.5px 0' }}>
    <span style={{ color: strong ? '#0f172a' : '#475569', fontWeight: strong ? 700 : 500 }}>{l}</span>
    <span className={strong ? 'num' : 'num'} style={{ fontWeight: strong ? 800 : 600 }}>{v}</span>
  </div>
)

const Line = ({ l, r }: { l: string; r: string }) => (
  <div className="flex justify-between">
    <span>{l}</span>
    <span className="font-semibold">{r}</span>
  </div>
)
