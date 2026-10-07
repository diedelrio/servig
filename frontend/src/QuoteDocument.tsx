import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from './api'
import { QuoteTable, type QuoteItemView } from './QuoteDecision'
import type { RepairFull } from './RepairDetail'
import { fmtDateTime } from './status'

export type QuoteDocData = {
  number: string
  version: number
  status: string
  customerName: string
  tool: string
  business: { name: string; address: string; phone: string; website?: string }
  subtotal: string; taxTotal: string; total: string; items: QuoteItemView[]
  notes: string | null
  sentAt: string | null
  validUntil: string | null
}

const STATUS: Record<string, string> = { BORRADOR: 'BORRADOR', ENVIADO: 'Pendiente de aprobación', APROBADO: 'Aprobado', RECHAZADO: 'Rechazado', VENCIDO: 'Vencido', CANCELADO: 'Retirado' }

/** Presupuesto imprimible / PDF. Mismo recurso visual que el resguardo (el CSS de impresión oculta el menú). */
export function QuoteDocumentView({ d, backTo }: { d: QuoteDocData; backTo: string }) {
  return (
    <section className="receipt">
      <div className="noprint row between">
        <Link to={backTo}>← Volver</Link>
        <button onClick={() => window.print()}>Imprimir / Guardar PDF</button>
      </div>
      <header>
        <h1>{d.business.name}</h1>
        <p>{[d.business.address, d.business.phone, d.business.website].filter(Boolean).join(' · ')}</p>
      </header>
      <h2 className="rnum">Presupuesto · {d.number} · v{d.version}</h2>
      <p>Estado: <b>{STATUS[d.status] ?? d.status}</b>{d.sentAt && ` · Emitido el ${fmtDateTime(d.sentAt)}`}</p>
      <p>Cliente: <b>{d.customerName}</b> · Herramienta: <b>{d.tool}</b></p>
      <QuoteTable items={d.items} subtotal={d.subtotal} taxTotal={d.taxTotal} total={d.total} />
      {d.notes && <p>Notas: {d.notes}</p>}
      {d.validUntil && <p>Válido hasta el <b>{new Date(d.validUntil).toLocaleDateString()}</b>.</p>}
      <p className="terms">No se realizará ninguna reparación sin la aprobación expresa del cliente. Los importes incluyen IVA según se detalla.</p>
    </section>
  )
}

type QuoteResp = { quote: null | { currentVersion: number; versions: { version: number; status: string; notes: string | null; sentAt: string | null; validUntil: string | null; subtotal: string; taxTotal: string; total: string; items: QuoteItemView[] }[] } }

/** Versión del personal: imprime la versión vigente (o la indicada en ?v=). */
export default function QuoteDocument() {
  const id = Number(useParams().id)
  const [data, setData] = useState<QuoteDocData | null>(null)
  const [empty, setEmpty] = useState(false)
  useEffect(() => {
    Promise.all([api.get<RepairFull>(`/repairs/${id}`), api.get<QuoteResp>(`/repairs/${id}/quote`)]).then(([r, q]) => {
      const quote = q.data.quote
      const v = quote?.versions.find((x) => x.version === quote.currentVersion)
      if (!v) { setEmpty(true); return }
      setData({
        number: r.data.number, version: v.version, status: v.status, customerName: r.data.customer.name,
        tool: `${r.data.tool.brand} ${r.data.tool.model}`, business: r.data.business,
        subtotal: v.subtotal, taxTotal: v.taxTotal, total: v.total, items: v.items, notes: v.notes, sentAt: v.sentAt, validUntil: v.validUntil,
      })
    }).catch(() => setEmpty(true))
  }, [id])
  if (empty) return <section><p>Esta reparación todavía no tiene presupuesto.</p><Link to={`/repairs/${id}`}>Volver</Link></section>
  if (!data) return <p>Cargando…</p>
  return <QuoteDocumentView d={data} backTo={`/repairs/${id}`} />
}
