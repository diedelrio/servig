import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from './api'
import { fmtDateTime } from './status'
import type { RepairFull } from './RepairDetail'

/** Resguardo: se imprime o se guarda como PDF desde el navegador (Ctrl+P). El CSS de impresión oculta el menú. */
export default function Receipt() {
  const id = Number(useParams().id)
  const [r, setR] = useState<RepairFull | null>(null)
  useEffect(() => { api.get<RepairFull>(`/repairs/${id}`).then((x) => setR(x.data)).catch(() => {}) }, [id])
  if (!r) return <p>Cargando…</p>
  const b = r.business

  return (
    <section className="receipt">
      <div className="noprint row between">
        <Link to={`/repairs/${r.id}`}>← Volver</Link>
        <button onClick={() => window.print()}>Imprimir / Guardar PDF</button>
      </div>

      <header>
        <h1>{b.name}</h1>
        <p>{[b.address, b.phone].filter(Boolean).join(' · ')}</p>
      </header>

      <h2 className="rnum">Resguardo de recepción · {r.number}</h2>
      <p>Fecha y hora: <b>{fmtDateTime(r.receivedAt)}</b> · Recibido por: {r.receivedBy.firstName} {r.receivedBy.lastName}</p>

      <table className="rtable">
        <tbody>
          <tr><th>Cliente</th><td>{r.customer.name}{r.customer.taxId && ` · ${r.customer.taxId}`}</td></tr>
          <tr><th>Contacto</th><td>{[r.customer.phone, r.customer.email, r.customer.address].filter(Boolean).join(' · ') || '—'}</td></tr>
          <tr><th>Herramienta</th><td>{r.tool.type} {r.tool.brand} {r.tool.model}{r.tool.serialNumber && ` · N.º serie ${r.tool.serialNumber}`}</td></tr>
          <tr><th>Avería declarada</th><td>{r.declaredFault}</td></tr>
          <tr><th>Estado visual</th><td>{r.visualState}</td></tr>
          <tr><th>Accesorios entregados</th><td>{r.accessories ?? 'Ninguno'}</td></tr>
          <tr><th>Garantía</th><td>{r.inWarranty ? 'En garantía' : 'Fuera de garantía'}{r.tool.warrantyExpiresAt && ` (vence ${r.tool.warrantyExpiresAt})`}</td></tr>
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
