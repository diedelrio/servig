import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from './api'
import { fmtDateTime } from './status'
import type { RepairFull } from './RepairDetail'

export type ReceiptData = {
  number: string
  receivedAt: string
  receivedBy?: string // el portal no muestra quién recibió
  customer: { name: string; taxId: string | null; contact?: string }
  tool: { type: string; brand: string; model: string; serialNumber: string | null }
  declaredFault: string
  visualState: string
  accessories: string | null
  notes: string | null
  inWarranty: boolean
  warrantyExpiresAt: string | null
  business: { name: string; address: string; phone: string; website?: string; receiptTerms: string }
}

/** Resguardo: se imprime o se guarda como PDF desde el navegador (Ctrl+P). El CSS de impresión oculta el menú. */
export function ReceiptView({ data: r, backTo }: { data: ReceiptData; backTo: string }) {
  const b = r.business
  return (
    <section className="receipt">
      <div className="noprint row between">
        <Link to={backTo}>← Volver</Link>
        <button onClick={() => window.print()}>Imprimir / Guardar PDF</button>
      </div>

      <header>
        <h1>{b.name}</h1>
        <p>{[b.address, b.phone, b.website].filter(Boolean).join(' · ')}</p>
      </header>

      <h2 className="rnum">Resguardo de recepción · {r.number}</h2>
      <p>Fecha y hora: <b>{fmtDateTime(r.receivedAt)}</b>{r.receivedBy && ` · Recibido por: ${r.receivedBy}`}</p>

      <table className="rtable">
        <tbody>
          <tr><th>Cliente</th><td>{r.customer.name}{r.customer.taxId && ` · ${r.customer.taxId}`}</td></tr>
          {r.customer.contact && <tr><th>Contacto</th><td>{r.customer.contact}</td></tr>}
          <tr><th>Herramienta</th><td>{r.tool.type} {r.tool.brand} {r.tool.model}{r.tool.serialNumber && ` · N.º serie ${r.tool.serialNumber}`}</td></tr>
          <tr><th>Avería declarada</th><td>{r.declaredFault}</td></tr>
          <tr><th>Estado visual</th><td>{r.visualState}</td></tr>
          <tr><th>Accesorios entregados</th><td>{r.accessories ?? 'Ninguno'}</td></tr>
          <tr><th>Garantía</th><td>{r.inWarranty ? 'En garantía' : 'Fuera de garantía'}{r.warrantyExpiresAt && ` (vence ${r.warrantyExpiresAt})`}</td></tr>
          {r.notes && <tr><th>Observaciones</th><td>{r.notes}</td></tr>}
        </tbody>
      </table>

      <p className="terms">{b.receiptTerms}</p>

      <div className="signatures">
        <div><span /> Firma del cliente</div>
        <div><span /> Firma del taller</div>
      </div>
    </section>
  )
}

/** Versión del personal. */
export default function Receipt() {
  const id = Number(useParams().id)
  const [r, setR] = useState<RepairFull | null>(null)
  useEffect(() => { api.get<RepairFull>(`/repairs/${id}`).then((x) => setR(x.data)).catch(() => {}) }, [id])
  if (!r) return <p>Cargando…</p>
  return (
    <ReceiptView backTo={`/repairs/${r.id}`} data={{
      number: r.number, receivedAt: r.receivedAt, receivedBy: `${r.receivedBy.firstName} ${r.receivedBy.lastName}`,
      customer: { name: r.customer.name, taxId: r.customer.taxId, contact: [r.customer.phone, r.customer.email, r.customer.address].filter(Boolean).join(' · ') || '—' },
      tool: r.tool, declaredFault: r.declaredFault, visualState: r.visualState, accessories: r.accessories, notes: r.notes,
      inWarranty: r.inWarranty, warrantyExpiresAt: r.tool.warrantyExpiresAt, business: r.business,
    }} />
  )
}
