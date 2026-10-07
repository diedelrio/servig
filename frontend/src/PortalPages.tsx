import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, apiError } from './api'
import { useAuth } from './auth'
import { DecisionControls, QuoteTable, type QuoteItemView } from './QuoteDecision'
import { QuoteDocumentView } from './QuoteDocument'
import { ReceiptView, type ReceiptData } from './Receipt'
import { Thumb } from './RepairDetail'
import { STATUS_LABEL, fmtDateTime } from './status'

export type ListRow = { id: number; number: string; status: string; receivedAt: string; active: boolean; pendingQuote: boolean; tool: { type: string; brand: string; model: string } }

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

// ---------- Lista e inicio ----------

/** Agrupaciones del portal: lo que cuenta cada tarjeta del inicio y lo que filtra la grilla. */
export const GROUPS = {
  abiertas: { label: 'Reparaciones abiertas', short: 'Abiertas', statuses: ['SOLICITADA', 'RECIBIDO', 'EN_REVISION'], hint: 'Solicitadas, recibidas y en revisión' },
  aprobar: { label: 'Presupuestos por aprobar', short: 'Por aprobar', statuses: ['PRESUPUESTO_PENDIENTE_APROBACION'], hint: 'Esperan su respuesta' },
  aprobados: { label: 'Presupuestos aprobados', short: 'Aprobados', statuses: ['PRESUPUESTO_APROBADO'], hint: 'Aprobados, a punto de empezar' },
  reparacion: { label: 'Herramientas en reparación', short: 'En reparación', statuses: ['PEDIDO_REPUESTOS_MARCA', 'EN_REPARACION', 'REPARADO'], hint: 'Esperando repuestos, en reparación o reparadas' },
  retirar: { label: 'Para retirar', short: 'Para retirar', statuses: ['LISTO_PARA_RETIRAR'], hint: 'Ya puede pasar a buscarlas' },
} as const
export type GroupKey = keyof typeof GROUPS
/** Tarjetas del inicio, en el orden del proceso. */
const HOME_GROUPS: GroupKey[] = ['abiertas', 'aprobar', 'aprobados', 'reparacion', 'retirar']

export function useRepairs() {
  const [rows, setRows] = useState<ListRow[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api.get<ListRow[]>('/portal/repairs').then((r) => setRows(r.data)).catch((e) => setError(apiError(e).message)) }, [])
  return { rows, error }
}

export const countOf = (rows: ListRow[], g: GroupKey) => rows.filter((r) => (GROUPS[g].statuses as readonly string[]).includes(r.status)).length

/** Inicio del portal: tres tarjetas con contadores; cada una lleva a la grilla ya filtrada. */
export function PortalHome() {
  const { user } = useAuth()
  const { rows, error } = useRepairs()
  if (error) return <section><h1>Hola, {user?.firstName}</h1><p className="error">{error}</p></section>
  if (!rows) return <p>Cargando…</p>
  const tone: Partial<Record<GroupKey, string>> = { abiertas: '', aprobar: 'warn', retirar: 'good' }
  return (
    <section>
      <h1 className="greeting">Hola, {user?.firstName}</h1>
      <p className="muted">Aquí puede seguir el estado de sus herramientas en el taller y pedir nuevas reparaciones.</p>
      <div className="tiles">
        {HOME_GROUPS.map((g) => {
          const n = countOf(rows, g)
          return (
            <Link key={g} to={`/portal/reparaciones?grupo=${g}`} className={`tile ${n > 0 ? tone[g] : ''}`}>
              <span className="n">{n}</span>
              <span className="l">{GROUPS[g].label}</span>
              <small>{GROUPS[g].hint}</small>
            </Link>
          )
        })}
      </div>
      <p><Link className="btn" to="/portal/nueva">Pedir una reparación</Link></p>
    </section>
  )
}

const TABS: { key: GroupKey | 'todas' | 'historial'; label: string }[] = [
  { key: 'todas', label: 'Todas' }, { key: 'abiertas', label: GROUPS.abiertas.short }, { key: 'aprobar', label: GROUPS.aprobar.short },
  { key: 'aprobados', label: GROUPS.aprobados.short }, { key: 'reparacion', label: GROUPS.reparacion.short }, { key: 'retirar', label: GROUPS.retirar.short }, { key: 'historial', label: 'Historial' },
]

/** Grilla de reparaciones con el filtro de la tarjeta elegida (?grupo=abiertas|aprobar|retirar|historial). */
export function PortalList() {
  const { rows, error } = useRepairs()
  const [params, setParams] = useSearchParams()
  const grupo = params.get('grupo') ?? 'todas'
  if (error) return <section><h1>Mis reparaciones</h1><p className="error">{error}</p></section>
  if (!rows) return <p>Cargando…</p>
  const shown = rows.filter((r) =>
    grupo === 'historial' ? !r.active : grupo in GROUPS ? (GROUPS[grupo as GroupKey].statuses as readonly string[]).includes(r.status) : true)
  return (
    <section>
      <div className="row between"><h1>Mis reparaciones</h1><Link className="btn" to="/portal/nueva">Pedir una reparación</Link></div>
      <div className="row" style={{ marginBottom: '1rem' }}>
        {TABS.map((t) => (
          <button key={t.key} className={grupo === t.key ? '' : 'link'} aria-pressed={grupo === t.key}
            onClick={() => setParams(t.key === 'todas' ? {} : { grupo: t.key })}>
            {t.label}{t.key in GROUPS && <> ({countOf(rows, t.key as GroupKey)})</>}
          </button>
        ))}
      </div>
      <div className="scroll"><table>
        <thead><tr><th>N.º</th><th>Herramienta</th><th>Estado</th><th>Fecha</th><th /></tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/portal/repairs/${r.id}`}><b>{r.number}</b></Link></td>
              <td>{r.tool.type} {r.tool.brand} {r.tool.model}</td>
              <td>
                <span className="badge">{STATUS_LABEL[r.status]}</span>
                {r.pendingQuote && <div><small className="error">Presupuesto esperando su respuesta</small></div>}
              </td>
              <td>{new Date(r.receivedAt).toLocaleDateString()}</td>
              <td className="actions"><Link to={`/portal/repairs/${r.id}`}>Ver detalle</Link></td>
            </tr>
          ))}
          {!shown.length && <tr><td colSpan={5}>{rows.length ? 'No hay reparaciones en este grupo.' : 'Todavía no tiene reparaciones registradas.'}</td></tr>}
        </tbody>
      </table></div>
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

  const cancelRequest = async () => {
    if (!confirm('¿Cancelar esta solicitud?')) return
    setBusy(true); setError('')
    try { await api.post(`/portal/repairs/${id}/cancel`); load() } catch (e) { setError(apiError(e).message) } finally { setBusy(false) }
  }

  if (missing) return <section><h1>Reparación no encontrada</h1><Link to="/portal/reparaciones">Volver</Link></section>
  if (!d) return <p>Cargando…</p>
  const q = d.quote

  return (
    <section>
      <p><Link to="/portal/reparaciones">← Mis reparaciones</Link></p>
      <div className="row between">
        <h1>{d.number}</h1>
        <span className="badge big">{STATUS_LABEL[d.status]}</span>
      </div>
      <p>{d.tool.type} {d.tool.brand} {d.tool.model}{d.tool.serialNumber && ` · N.º serie ${d.tool.serialNumber}`}</p>
      <p className="muted">Avería indicada: {d.declaredFault}</p>
      {d.status === 'SOLICITADA' && (
        <div className="callout">
          <p>Su solicitud está registrada. <b>Traiga la herramienta al taller</b> para que la recibamos y la revisemos; hasta entonces no se hace nada.</p>
          {error && <p className="error">{error}</p>}
          <button className="danger" disabled={busy} onClick={cancelRequest}>Cancelar solicitud</button>
        </div>
      )}
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
          <p><Link className="btn" to={`/portal/repairs/${d.id}/quote/print`}>Imprimir presupuesto</Link></p>
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


export function PortalQuotePrint() {
  const id = Number(useParams().id)
  const [d, setD] = useState<Detail | null>(null)
  useEffect(() => { api.get<Detail>(`/portal/repairs/${id}`).then((r) => setD(r.data)).catch(() => {}) }, [id])
  if (!d) return <p>Cargando…</p>
  if (!d.quote) return <section><p>Esta reparación todavía no tiene un presupuesto disponible.</p><Link to={`/portal/repairs/${id}`}>Volver</Link></section>
  return (
    <QuoteDocumentView backTo={`/portal/repairs/${d.id}`} d={{
      number: d.number, version: d.quote.version, status: d.quote.status, customerName: d.receipt.customer.name,
      tool: `${d.tool.brand} ${d.tool.model}`, business: d.receipt.business, subtotal: d.quote.subtotal, taxTotal: d.quote.taxTotal,
      total: d.quote.total, items: d.quote.items, notes: d.quote.notes, sentAt: null, validUntil: d.quote.validUntil,
    }} />
  )
}
