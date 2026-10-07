import { useState } from 'react'

export type QuoteItemView = { type: 'LABOR' | 'PART' | 'OTHER'; description: string; quantity: string; unitPrice: string; taxRate: string; lineNet: string }

const TYPE_LABEL = { LABOR: 'Mano de obra', PART: 'Repuesto', OTHER: 'Otro' }
export const eur = (n: string | number) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** Detalle del presupuesto tal como lo ve el cliente (enlace y portal). */
export function QuoteTable({ items, subtotal, taxTotal, total }: { items: QuoteItemView[]; subtotal: string; taxTotal: string; total: string }) {
  return (
    <div className="scroll">
      <table>
        <thead><tr><th>Concepto</th><th>Cant.</th><th>Precio</th><th>IVA</th><th>Neto</th></tr></thead>
        <tbody>
          {items.map((i, idx) => (
            <tr key={idx}><td>{i.description} <small>({TYPE_LABEL[i.type]})</small></td><td>{i.quantity}</td><td>{eur(i.unitPrice)}</td><td>{i.taxRate} %</td><td>{eur(i.lineNet)}</td></tr>
          ))}
          <tr><td colSpan={4} className="actions">Subtotal</td><td>{eur(subtotal)}</td></tr>
          <tr><td colSpan={4} className="actions">IVA</td><td>{eur(taxTotal)}</td></tr>
          <tr><td colSpan={4} className="actions"><b>Total</b></td><td><b>{eur(total)}</b></td></tr>
        </tbody>
      </table>
    </div>
  )
}

/** Aprobar o rechazar con doble confirmación. Quien lo usa decide qué endpoint llamar. */
export function DecisionControls({ total, busy, onDecide }: { total: string; busy: boolean; onDecide: (d: 'APPROVE' | 'REJECT', comment?: string) => void }) {
  const [step, setStep] = useState<'review' | 'confirmApprove' | 'confirmReject'>('review')
  const [reason, setReason] = useState('')

  if (step === 'confirmApprove') {
    return (
      <div className="panel">
        <p>¿Confirma que <b>aprueba</b> este presupuesto por <b>{eur(total)}</b> (IVA incluido) y autoriza la reparación?</p>
        <div className="row">
          <button disabled={busy} onClick={() => onDecide('APPROVE')}>Sí, aprobar</button>
          <button disabled={busy} className="link" onClick={() => setStep('review')}>Volver</button>
        </div>
      </div>
    )
  }
  if (step === 'confirmReject') {
    return (
      <div className="panel grid1">
        <p>¿Confirma que <b>rechaza</b> este presupuesto? No se realizará la reparación.</p>
        <label>Motivo (opcional)<textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="row">
          <button disabled={busy} className="danger" onClick={() => onDecide('REJECT', reason)}>Sí, rechazar</button>
          <button disabled={busy} className="link" onClick={() => setStep('review')}>Volver</button>
        </div>
      </div>
    )
  }
  return (
    <>
      <p><b>No se realizará ninguna reparación sin su aprobación.</b></p>
      <div className="row">
        <button disabled={busy} onClick={() => setStep('confirmApprove')}>Aprobar presupuesto</button>
        <button disabled={busy} className="danger" onClick={() => setStep('confirmReject')}>Rechazar</button>
      </div>
    </>
  )
}
