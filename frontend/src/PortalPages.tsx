import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, apiError } from './api'
import { DecisionControls, QuoteTable, type QuoteItemView } from './QuoteDecision'
import { ReceiptView, type ReceiptData } from './Receipt'
import { Thumb } from './RepairDetail'
import { STATUS_LABEL, fmtDateTime } from './status'

type ListRow = { id: number; number: string; status: string; receivedAt: string; active: boolean; pendingQuote: boolean; tool: { type: string; brand: string; model: string } }

type Detail = {
  id: number; number: string; status: string; receivedAt: string; declaredFault: string; inWarranty: boolean
  tool: { type: string; brand: string; model: string; serialNumber: string | null }
  timeline: { status: string; at: string }[]
  diagnoses: { text: string; createdAt: string }[]
  quote: null | {
    version: number; status: string; notes: string | null; validUntil: string | null; canDecide: boolean
    subtotal: string; taxTotal: string; total: string; items: QuoteItemView[]; decision: null | { decision: string; decidedAt: string }
  }
  spareParts: { description: string; quantity: number; status: string }[]
  attachments: { id: number; filename: string; mime: string; size: number; createdAt: string }[]
  receipt: {
    business: ReceiptData['business']; customer: { name: string; taxId: string | null }
    visualState: string; accessories: string | null; notes: string | null; warrantyExpiresAt: string | null
  }
}

const PART_LABEL: Record<string, string> = {
  NECESARIO: 'Pendiente', SOLICITADO: 'Solicitado', PEDIDO_A_MARCA: 'Pedido a la marca', RECIBIDO: 'Recibido', INSTALADO: 'Instalado',
}
const QUOTE_LABEL: Record<string, string> = { ENVIADO: 'Pendiente de su respuesta', APROBADO: 'Aprobado', RECHAZADO: 'Rechazado', VENCIDO: 'Vencido' }

// ---------- Lista ----------

export function PortalList() {
  const [rows, setRows] = useState<ListRow[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api.get<ListRow[]>('/portal/repairs').then((r) => setRows(r.data)).catch((e) => setError(apiError(e).message)) }, [])

  if (error) return <section><h1>Mis reparaciones</h1><p className="error">{error}</p></section>
  if (!rows) return <p>Cargando…</p>

  const card = (r: ListRow) => (
    <Link key={r.id} to={`/portal/repairs/${r.id}`} className={`rcard ${r.pendingQuote ? 'attention' : ''}`}>
      <div className="row between"><b>{r.number}</b><span className="badge">{STATUS_LABEL[r.status]}</span></div>
      <div>{r.tool.type} {r.tool.brand} {r.tool.model}</div>
      <small>Recibida el {new Date(r.receivedAt).toLocaleDateString()}</small>
      {r.pendingQuote && <div className="callout">Tiene un presupuesto esperando su respuesta</div>}
    </Link>
  )
  const active = rows.filter((r) => r.active)
  const history = rows.filter((r) => !r.active)

  return (
    <section>
      <h1>Mis reparaciones</h1>
      {!rows.length && <p>Todavía no tiene reparaciones registradas.</p>}
      {active.length > 0 && <><h2>En curso</h2><div className="cards">{active.map(card)}</div></>}
      {history.length > 0 && <><h2>Historial</h2><div className="cards">{history.map(card)}</div></>}
    </section>
  )
}

// ---------- Detalle ----------

export function PortalRepair() {
  const id = Number(useParams().id)
  const [d, setD] = useState<Detail | null>(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const load = useCallback(() => { api.get<Detail>(`/portal/repairs/${id}`).then((r) => setD(r.data)).catch(() => setMissing(true)) }, [id])
  useEffect(load, [load])

  const decide = async (decision: 'APPROVE' | 'REJECT', comment?: string) => {
    setBusy(true); setError('')
    try {
      await api.post(`/portal/repairs/${id}/quote/decision`, { decision, comment })
      setDone(decision === 'APPROVE' ? 'Hemos registrado su aprobación. Comenzaremos la reparación y le avisaremos.' : 'Hemos registrado que rechaza el presupuesto. No se realizará la reparación.')
    } catch (e) { setError(apiError(e).message) } finally { setBusy(false); load() }
  }

  if (missing) return <section><h1>Reparación no encontrada</h1><Link to="/portal">Volver</Link></section>
  if (!d) return <p>Cargando…</p>
  const q = d.quote

  return (
    <section>
      <p><Link to="/portal">← Mis reparaciones</Link></p>
      <div className="row between">
        <h1>{d.number}</h1>
        <span className="badge big">{STATUS_LABEL[d.status]}</span>
      </div>
      <p>{d.tool.type} {d.tool.brand} {d.tool.model}{d.tool.serialNumber && ` · N.º serie ${d.tool.serialNumber}`}</p>
      <p className="muted">Avería indicada: {d.declaredFault}</p>
      <p><Link className="btn" to={`/portal/repairs/${d.id}/receipt`}>Ver resguardo</Link></p>

      {q && (
        <>
          <h2>Presupuesto <span className="badge">v{q.version} · {QUOTE_LABEL[q.status]}</span></h2>
          {done && <p className="ok big">{done}</p>}
          {q.canDecide && <p className="callout">Este presupuesto espera su respuesta.</p>}
          <QuoteTable items={q.items} subtotal={q.subtotal} taxTotal={q.taxTotal} total={q.total} />
          {q.notes && <p>Notas: {q.notes}</p>}
          {q.validUntil && <p className="muted">Válido hasta el {new Date(q.validUntil).toLocaleDateString()}.</p>}
          {q.decision && <p className={q.decision.decision === 'APROBADO' ? 'ok' : 'error'}>{q.decision.decision === 'APROBADO' ? 'Aprobado' : 'Rechazado'} el {fmtDateTime(q.decision.decidedAt)}.</p>}
          {q.status === 'VENCIDO' && <p>Este presupuesto venció. Contacte con el taller para solicitar uno nuevo.</p>}
          {error && <p className="error">{error}</p>}
          {q.canDecide && <DecisionControls total={q.total} busy={busy} onDecide={decide} />}
        </>
      )}

      {d.diagnoses.length > 0 && (
        <>
          <h2>Diagnóstico</h2>
          {d.diagnoses.map((x, i) => <div key={i} className="panel"><small>{fmtDateTime(x.createdAt)}</small><p className="pre">{x.text}</p></div>)}
        </>
      )}

      {d.spareParts.length > 0 && (
        <>
          <h2>Repuestos</h2>
          <ul className="plain">{d.spareParts.map((p, i) => <li key={i}>{p.quantity} × {p.description} <span className="badge">{PART_LABEL[p.status]}</span></li>)}</ul>
        </>
      )}

      <h2>Seguimiento</h2>
      <ol className="timeline">
        {d.timeline.map((t, i) => <li key={i}><b>{STATUS_LABEL[t.status]}</b> <small>{fmtDateTime(t.at)}</small></li>)}
      </ol>

      {d.attachments.length > 0 && (
        <>
          <h2>Documentos</h2>
          <div className="thumbs">{d.attachments.map((a) => <Thumb key={a.id} url={`/portal/repairs/${d.id}/attachments/${a.id}`} a={a} />)}</div>
        </>
      )}
      <p className="muted">{d.receipt.business.name}{d.receipt.business.phone && ` · ${d.receipt.business.phone}`}</p>
    </section>
  )
}

// ---------- Resguardo ----------

export function PortalReceipt() {
  const id = Number(useParams().id)
  const [d, setD] = useState<Detail | null>(null)
  useEffect(() => { api.get<Detail>(`/portal/repairs/${id}`).then((r) => setD(r.data)).catch(() => {}) }, [id])
  if (!d) return <p>Cargando…</p>
  return (
    <ReceiptView backTo={`/portal/repairs/${d.id}`} data={{
      number: d.number, receivedAt: d.receivedAt, customer: d.receipt.customer, tool: d.tool, declaredFault: d.declaredFault,
      visualState: d.receipt.visualState, accessories: d.receipt.accessories, notes: d.receipt.notes,
      inWarranty: d.inWarranty, warrantyExpiresAt: d.receipt.warrantyExpiresAt, business: d.receipt.business,
    }} />
  )
}

