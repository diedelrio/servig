import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { api, apiError } from './api'
import { useAuth } from './auth'
import { ORIGIN_LABEL, STATUS_LABEL, fmtDateTime } from './status'
import type { Tool } from './ToolForm'
import { DiagnosisPanel, QuotePanel } from './RepairPanels'
import { SparePartsPanel } from './SparePartsPanel'

type Att = { id: number; filename: string; mime: string; size: number; createdAt: string; visibleToCustomer?: boolean }
export type RepairFull = {
  id: number; number: string; status: string; receivedAt: string; declaredFault: string; visualState: string
  accessories: string | null; notes: string | null; inWarranty: boolean; requiresQuote: boolean
  customer: { id: number; name: string; taxId: string | null; email: string | null; phone: string | null; address: string | null }
  tool: Tool
  receivedBy: { firstName: string; lastName: string }
  history: { id: number; fromStatus: string | null; toStatus: string; createdAt: string; comment: string | null; origin: string; user: { firstName: string; lastName: string } | null }[]
  attachments: Att[]
  diagnoses: { id: number; text: string; visibleToCustomer: boolean; createdAt: string; author: { firstName: string; lastName: string } }[]
  allowedTransitions: { to: string; label: string; needsComment: boolean }[]
  business: { name: string; address: string; phone: string; receiptTerms: string }
}

/** Los adjuntos requieren el token, así que se descargan como blob y no con <img src>. */
export function Thumb({ url: src, a, children }: { url: string; a: Pick<Att, 'id' | 'filename' | 'mime'>; children?: ReactNode }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let revoke: string | undefined
    api.get(src, { responseType: 'blob' }).then((r) => { revoke = URL.createObjectURL(r.data); setUrl(revoke) }).catch(() => {})
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [src])
  const isImg = a.mime.startsWith('image/')
  return (
    <figure className="thumb">
      {url && isImg && <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={a.filename} /></a>}
      {url && !isImg && <a href={url} target="_blank" rel="noreferrer">📄 Abrir PDF</a>}
      <figcaption>{a.filename}</figcaption>
      {children}
    </figure>
  )
}

export default function RepairDetail() {
  const id = Number(useParams().id)
  const { can } = useAuth()
  const uploadErrors = (useLocation().state as { uploadErrors?: string[] } | null)?.uploadErrors ?? []
  const [r, setR] = useState<RepairFull | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState('')
  const [comment, setComment] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.get<RepairFull>(`/repairs/${id}`).then((x) => setR(x.data)).catch(() => setMissing(true))
  }, [id])
  useEffect(load, [load])

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    setError('')
    for (const f of Array.from(e.target.files ?? [])) {
      try {
        await api.post(`/repairs/${id}/attachments`, f, { headers: { 'Content-Type': 'application/octet-stream', 'x-filename': encodeURIComponent(f.name) } })
      } catch (err) { setError(`${f.name}: ${apiError(err).message}`) }
    }
    e.target.value = ''
    load()
  }

  const transition = async (to: string, needsComment: boolean) => {
    setActionError('')
    if (needsComment && !comment.trim()) { setActionError('Esta acción requiere un comentario.'); return }
    setBusy(true)
    try {
      await api.post(`/repairs/${id}/transition`, { to, comment })
      setComment('')
      load()
    } catch (e) { setActionError(apiError(e).message); load() } finally { setBusy(false) }
  }

  if (missing) return <section><h1>Reparación no encontrada</h1><Link to="/repairs">Volver</Link></section>
  if (!r) return <p>Cargando…</p>

  return (
    <section>
      <p><Link to="/repairs">← Reparaciones</Link></p>
      <div className="row between">
        <h1>{r.number} <span className="badge">{STATUS_LABEL[r.status]}</span></h1>
        <Link className="btn" to={`/repairs/${r.id}/receipt`}>Imprimir resguardo</Link>
      </div>
      {uploadErrors.length > 0 && <p className="error">No se pudieron subir: {uploadErrors.join('; ')}</p>}

      <dl className="panel details">
        <dt>Cliente</dt><dd><Link to={`/customers/${r.customer.id}`}>{r.customer.name}</Link> {r.customer.phone && `· ${r.customer.phone}`}</dd>
        <dt>Herramienta</dt><dd>{r.tool.type} {r.tool.brand} {r.tool.model} {r.tool.serialNumber && `· S/N ${r.tool.serialNumber}`}</dd>
        <dt>Recibida</dt><dd>{fmtDateTime(r.receivedAt)} por {r.receivedBy.firstName} {r.receivedBy.lastName}</dd>
        <dt>Avería declarada</dt><dd>{r.declaredFault}</dd>
        <dt>Estado visual</dt><dd>{r.visualState}</dd>
        <dt>Accesorios</dt><dd>{r.accessories ?? '—'}</dd>
        <dt>Garantía</dt><dd>{r.inWarranty ? 'Sí' : 'No'}{r.inWarranty && !r.requiresQuote && ' · sin presupuesto'}</dd>
        <dt>Observaciones</dt><dd>{r.notes ?? '—'}</dd>
      </dl>

      {r.allowedTransitions.length > 0 && (
        <div className="panel">
          <h2>Acciones</h2>
          <label>Comentario (obligatorio al cancelar o devolver sin reparar)
            <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
          </label>
          <div className="row actionsrow">
            {r.allowedTransitions.map((t) => (
              <button key={t.to} disabled={busy} className={t.to === 'CANCELADO' ? 'danger' : undefined} onClick={() => transition(t.to, t.needsComment)}>{t.label}</button>
            ))}
          </div>
          {actionError && <p className="error">{actionError}</p>}
        </div>
      )}

      <DiagnosisPanel repair={r} onChange={load} />
      <QuotePanel repair={r} onChange={load} />
      <SparePartsPanel repair={r} onChange={load} />

      <h2>Historial</h2>
      <ol className="timeline">
        {r.history.map((h) => (
          <li key={h.id}>
            <b>{STATUS_LABEL[h.toStatus]}</b> <small>{fmtDateTime(h.createdAt)}</small>
            <div><small>{h.user ? `${h.user.firstName} ${h.user.lastName}` : ORIGIN_LABEL[h.origin]}{h.comment && ` · ${h.comment}`}</small></div>
          </li>
        ))}
      </ol>

      <div className="row between">
        <h2>Fotos y documentos</h2>
        {can('repair:attach') && <label className="btn">Agregar<input type="file" multiple hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={upload} /></label>}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="thumbs">
        {r.attachments.map((a) => (
          <Thumb key={a.id} url={`/repairs/${r.id}/attachments/${a.id}`} a={a}>
            {can('repair:attach') && (
              <label className="check"><input type="checkbox" checked={!!a.visibleToCustomer}
                onChange={(e) => api.patch(`/repairs/${r.id}/attachments/${a.id}`, { visibleToCustomer: e.target.checked }).then(load).catch((err) => setError(apiError(err).message))} /> <small>Visible al cliente</small></label>
            )}
          </Thumb>
        ))}
        {!r.attachments.length && <p>Sin adjuntos.</p>}
      </div>
    </section>
  )
}
