import { useEffect, useRef, useState, type ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { Business, Invoice } from '../lib/types'
import { docMeta, stateName } from '../lib/types'
import { computeTotals, hsnSummary } from '../lib/calc'
import { amountInWords, fmtDate, money, num, quantity, round2 } from '../lib/format'
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
    due && meta.isSale && business.upiId
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
                      {quantity(l.qty)} {l.unit} × {num(l.rate)} {l.discountPercent ? `- ${num(l.discountPercent, 0)}%` : ''}
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
          <Line l="Qty" r={quantity(t.totalQty)} />
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

  // ---------------- A4 letterhead ----------------
  const columns = meta.noTax ? 8 : 9
  const summaries = [
    { label: 'Subtotal', value: t.taxable },
    ...(t.billDiscount ? [{ label: 'Bill discount', value: -t.billDiscount }] : []),
    ...(!meta.noTax && t.tax ? t.interState
      ? [{ label: 'IGST', value: t.igst }]
      : [{ label: 'CGST', value: t.cgst }, { label: 'SGST', value: t.sgst }] : []),
    ...(t.charges ? [{ label: 'Other charges', value: t.charges }] : []),
    ...(Math.abs(t.roundOff) >= 0.01 ? [{ label: 'Rounding off', value: t.roundOff }] : []),
  ]
  // Allocate odd tax paise across HSN groups so both tax columns match the invoice.
  let cgstPaiseLeft = Math.round(t.cgst * 100) - hsn.reduce((sum, h) => sum + Math.floor(Math.round(h.tax * 100) / 2), 0)
  const taxRows = hsn.map(h => {
    const paise = Math.round(h.tax * 100)
    const extra = !t.interState && paise % 2 !== 0 && cgstPaiseLeft > 0 ? 1 : 0
    cgstPaiseLeft -= extra
    const cgst = (Math.floor(paise / 2) + extra) / 100
    return { ...h, cgst, sgst: round2(h.tax - cgst) }
  })

  return (
    <div className="paper paper-letterhead mx-auto" style={{ width: A4_WIDTH }}>
      <header className="letterhead-header">
        <div className="letterhead-title">{title}</div>
        <div className="letterhead-brand">
          {business.logoDataUrl ? <img className="letterhead-logo" src={business.logoDataUrl} alt="Business logo" /> : null}
          <h1>{business.name}</h1>
          {business.tagline ? <div className="letterhead-tagline">{business.tagline}</div> : null}
        </div>
        <div className="letterhead-contact">
          {business.address ? <div>{business.address}</div> : null}
          {[business.phone && `Mob: ${business.phone}`, business.email && `Email: ${business.email}`].filter(Boolean).join(' • ')}
        </div>
        {business.gstin ? <div className="letterhead-band">GSTIN/UIN: <strong>{business.gstin}</strong></div> : null}
      </header>

      <section className="letterhead-parties">
        <div>
          <div>{meta.isPurchase ? 'Supplier (Bill from)' : 'Buyer (Bill to)'}</div>
          <strong>{invoice.partyName || 'Cash Sale / Walk-in Customer'}</strong>
          {invoice.partyAddress ? <div className="letterhead-multiline">{invoice.partyAddress}</div> : null}
          {invoice.partyPhone ? <div>Mobile: {invoice.partyPhone}</div> : null}
          {invoice.partyGstin ? <div>GSTIN/UIN: {invoice.partyGstin}</div> : null}
          <div>Place of Supply: {stateName(invoice.placeOfSupply) || '—'}{invoice.placeOfSupply ? ` • Code: ${invoice.placeOfSupply}` : ''}</div>
          {invoice.transportName ? <div>Transport: {invoice.transportName}</div> : null}
          {invoice.vehicleNo ? <div>Motor Vehicle No.: {invoice.vehicleNo}</div> : null}
          {invoice.eWayBill ? <div>E-Way Bill No.: {invoice.eWayBill}</div> : null}
        </div>
        <div className="letterhead-invoice-details">
          <div>Invoice No.: <strong>{invoice.number || 'Draft'}</strong></div>
          <div>Dated: <strong>{fmtDate(invoice.date)}</strong></div>
          {invoice.dueDate ? <div>Due date: {fmtDate(invoice.dueDate)}</div> : null}
          {invoice.poNumber ? <div>PO / Reference: {invoice.poNumber}</div> : null}
          <div>Payment: {t.paid > 0 ? `${money(t.paid)} ${meta.isPurchase ? 'paid' : 'received'}` : meta.isPurchase ? 'Payable / credit' : 'Credit / due'}</div>
          <div>{due ? `Balance due: ${money(t.due)}` : 'Status: PAID'}</div>
        </div>
      </section>

      <table className="letterhead-items">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: meta.noTax ? '39%' : '32%' }} />
          {!meta.noTax ? <col style={{ width: '7%' }} /> : null}
          <col style={{ width: '8%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '15%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>Sl.<br />No.</th>
            <th>Description of<br />Goods and Services</th>
            {!meta.noTax ? <th>GST<br />Rate</th> : null}
            <th>Quantity</th><th>Rate</th><th>per</th><th>Disc. %</th><th>Disc. Amt</th><th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((line, i) => (
            <tr className="letterhead-item-row" key={line.id}>
              <td className="letterhead-center">{i + 1}</td>
              <td>
                <strong>{line.name}</strong>
                {line.hsn || line.code || line.brand ? <div className="letterhead-item-detail">{[line.hsn && `HSN/SAC: ${line.hsn}`, line.code, line.brand].filter(Boolean).join(' • ')}</div> : null}
              </td>
              {!meta.noTax ? <td className="letterhead-center">{quantity(line.gstPercent)}%</td> : null}
              <td className="letterhead-number">{quantity(line.qty)}</td>
              <td className="letterhead-number">{num(line.rate)}</td>
              <td className="letterhead-center">{line.unit}</td>
              <td className="letterhead-number">{line.discountPercent ? quantity(line.discountPercent) : '—'}</td>
              <td className="letterhead-number">{t.lines[i]?.discount ? num(t.lines[i].discount) : '—'}</td>
              <td className="letterhead-number">{num(t.lines[i]?.taxable ?? 0)}</td>
            </tr>
          ))}
          {!invoice.items.length ? <tr><td colSpan={columns} className="letterhead-center">No items</td></tr> : null}
          {summaries.map(row => (
            <tr className="letterhead-summary-row" key={row.label}>
              <td /><td className="letterhead-summary-label"><strong>{row.label}</strong></td>
              {Array.from({ length: columns - 3 }, (_, i) => <td key={i} />)}
              <td className="letterhead-number">{num(row.value)}</td>
            </tr>
          ))}
          <tr className="letterhead-spacer" aria-hidden="true" style={{ height: Math.max(16, 230 - invoice.items.length * 25) }}>
            {Array.from({ length: columns }, (_, i) => <td key={i} />)}
          </tr>
          <tr className="letterhead-total">
            <td colSpan={meta.noTax ? 2 : 3}>Total</td>
            <td className="letterhead-number">{quantity(t.totalQty)}</td>
            <td colSpan={4} />
            <td className="letterhead-number">{money(t.grandTotal)}</td>
          </tr>
        </tbody>
      </table>

      <div className="letterhead-amount-words">
        <span>Amount Chargeable (in words): <strong>{amountInWords(t.grandTotal)}</strong></span>
        <span>E. &amp; O.E.</span>
      </div>

      {!meta.noTax && taxRows.length > 0 ? (
        <section className="letterhead-tax">
          <div className="letterhead-band"><strong>Tax Analysis</strong></div>
          <table>
            <thead>
              <tr>
                <th rowSpan={2}>HSN/SAC</th><th rowSpan={2}>Taxable<br />Value</th>
                {t.interState ? <th colSpan={2}>IGST</th> : <><th colSpan={2}>CGST</th><th colSpan={2}>SGST/UTGST</th></>}
                <th rowSpan={2}>Total Tax<br />Amount</th>
              </tr>
              <tr>
                <th>Rate</th><th>Amount</th>
                {!t.interState ? <><th>Rate</th><th>Amount</th></> : null}
              </tr>
            </thead>
            <tbody>
              {taxRows.map(h => (
                <tr key={`${h.hsn}|${h.rate}`}>
                  <td>{h.hsn}</td><td className="letterhead-number">{num(h.taxable)}</td>
                  {t.interState ? <><td className="letterhead-number">{quantity(h.rate)}%</td><td className="letterhead-number">{num(h.tax)}</td></> : (
                    <><td className="letterhead-number">{quantity(h.rate / 2)}%</td><td className="letterhead-number">{num(h.cgst)}</td><td className="letterhead-number">{quantity(h.rate / 2)}%</td><td className="letterhead-number">{num(h.sgst)}</td></>
                  )}
                  <td className="letterhead-number">{num(h.tax)}</td>
                </tr>
              ))}
              <tr className="letterhead-tax-total">
                <td>Total</td><td className="letterhead-number">{num(t.taxableNet)}</td>
                {t.interState ? <><td /><td className="letterhead-number">{num(t.igst)}</td></> : <><td /><td className="letterhead-number">{num(t.cgst)}</td><td /><td className="letterhead-number">{num(t.sgst)}</td></>}
                <td className="letterhead-number">{num(t.tax)}</td>
              </tr>
            </tbody>
          </table>
          <div className="letterhead-tax-words">Tax Amount (in words): <strong>{amountInWords(t.tax)}</strong></div>
        </section>
      ) : null}

      <div className="letterhead-footer">
        <div className="letterhead-declaration">
          <strong>Declaration</strong>
          <div>We declare that this {title.toLowerCase()} shows the actual price of the goods described and that all particulars are true and correct.</div>
          {invoice.notes ? <div className="letterhead-multiline"><strong>Notes: </strong>{invoice.notes}</div> : null}
          {invoice.terms || business.terms ? <div className="letterhead-multiline"><strong>Terms &amp; Conditions: </strong>{invoice.terms || business.terms}</div> : null}
          {bankLine ? <div><strong>Bank: </strong>{bankLine}</div> : null}
        </div>
        <div className="letterhead-signatures">
          <div>
            {qr ? <div className="letterhead-payment-qr"><QRCodeSVG value={qr} size={68} level="M" /><span>Scan &amp; Pay {money(t.due)}<br />{business.upiId}</span></div> : null}
            <strong>Customer's Seal and Signature</strong>
          </div>
          <div className="letterhead-authorised">
            <strong>For {business.name}</strong>
            <div className="letterhead-signature-space">{business.signatureDataUrl ? <img src={business.signatureDataUrl} alt="Authorised signature" /> : null}</div>
            <strong>Authorised Signatory</strong>
          </div>
        </div>
        <div className="letterhead-band letterhead-generated">
          This is a computer generated {title.toLowerCase()}.
          {invoice.docType === 'ESTIMATE' ? ' This is a quotation, not a tax invoice.' : ''}
        </div>
      </div>
    </div>
  )
}

const Line = ({ l, r }: { l: string; r: string }) => (
  <div className="flex justify-between">
    <span>{l}</span>
    <span className="font-semibold">{r}</span>
  </div>
)
