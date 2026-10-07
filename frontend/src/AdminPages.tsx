import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, apiError } from './api'
import { fmtDateTime } from './status'

// ---------- Registro de correos ----------

type EmailRow = {
  id: number; to: string; type: string; subject: string; entity: string | null; entityId: string | null
  status: 'PENDING' | 'SENT' | 'FAILED'; error: string | null; attempts: number
  createdAt: string; lastAttemptAt: string | null; sentAt: string | null; canRetry: boolean
}
type EmailPage = { items: EmailRow[]; nextCursor: number | null; failed: number }

const STATUS_LABEL = { PENDING: 'Pendiente', SENT: 'Enviado', FAILED: 'Fallido' }
const STATUS_BADGE = { PENDING: '', SENT: 'active', FAILED: 'disabled' }

export function AdminEmails() {
  const [rows, setRows] = useState<EmailRow[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [failed, setFailed] = useState(0)
  const [filters, setFilters] = useState({ status: '', type: '', to: '' })
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const load = useCallback((before?: number) => {
    const params: Record<string, string | number> = { limit: 50 }
    for (const [k, v] of Object.entries(filters)) if (v) params[k] = v
    if (before) params.before = before
    api.get<EmailPage>('/email-logs', { params }).then((r) => {
      setRows((prev) => (before ? [...prev, ...r.data.items] : r.data.items))
      setCursor(r.data.nextCursor)
      setFailed(r.data.failed)
    }).catch((e) => setError(apiError(e).message))
  }, [filters])
  useEffect(() => { const t = setTimeout(() => load(), 250); return () => clearTimeout(t) }, [load])

  const retry = async (id: number) => {
    setError(''); setInfo('')
    try {
      const r = await api.post<{ result: string }>(`/email-logs/${id}/retry`)
      setInfo(r.data.result === 'SENT' ? 'Correo reenviado.' : 'El reintento volvió a fallar; revisa el error.')
      load()
    } catch (e) { setError(apiError(e).message) }
  }

  return (
    <section>
      <h1>Registro de correos</h1>
      {failed > 0 && <p className="callout">{failed} correo(s) fallido(s) en total.</p>}
      <div className="row filters">
        <input placeholder="Destinatario" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        <input placeholder="Tipo (p. ej. REPAIR_READY)" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value.trim() })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {info && <p className="ok">{info}</p>}
      <div className="scroll">
        <table>
          <thead><tr><th>Fecha</th><th>Destinatario</th><th>Tipo</th><th>Asunto</th><th>Estado</th><th>Int.</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.createdAt)}</td>
                <td>{r.to}</td>
                <td><small>{r.type}</small>{r.entity === 'Repair' && r.entityId && <> · <Link to={`/repairs/${r.entityId}`}>#{r.entityId}</Link></>}</td>
                <td>{r.subject}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  {r.error && <div><small className="error" title={r.error}>{r.error.slice(0, 80)}</small></div>}
                </td>
                <td>{r.attempts}</td>
                <td className="actions">
                  {r.canRetry && <button className="link" onClick={() => retry(r.id)}>Reintentar</button>}
                  {r.status === 'FAILED' && !r.canRetry && <small title="Llevaba un enlace de un solo uso: la persona debe volver a solicitarlo">sin reintento</small>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7}>Sin resultados</td></tr>}
          </tbody>
        </table>
      </div>
      {cursor && <p><button onClick={() => load(cursor)}>Cargar más</button></p>}
    </section>
  )
}

// ---------- Auditoría ----------

type AuditRow = {
  id: number; createdAt: string; action: string; entity: string; entityId: string | null; ip: string | null; data: unknown
  user: { id: number; email: string; firstName: string; lastName: string } | null
}
type AuditPage = { items: AuditRow[]; nextCursor: number | null }

function AuditTable({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="scroll">
      <table>
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>IP</th><th>Datos</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{fmtDateTime(r.createdAt)}</td>
              <td>{r.user ? `${r.user.firstName} ${r.user.lastName}` : <small>sistema / cliente</small>}</td>
              <td><b>{r.action}</b></td>
              <td>{r.entity}{r.entityId && ` #${r.entityId}`}</td>
              <td><small>{r.ip ?? '—'}</small></td>
              <td>{r.data ? <details><summary>ver</summary><pre className="json">{JSON.stringify(r.data, null, 2)}</pre></details> : '—'}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6}>Sin resultados</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export function AdminAudit() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [actions, setActions] = useState<string[]>([])
  const [f, setF] = useState({ entity: '', entityId: '', action: '', from: '', to: '' })
  const [error, setError] = useState('')

  useEffect(() => { api.get<string[]>('/audit/actions').then((r) => setActions(r.data)).catch(() => {}) }, [])

  const load = useCallback((before?: number) => {
    const params: Record<string, string | number> = { limit: 50 }
    for (const [k, v] of Object.entries(f)) if (v) params[k] = v
    if (before) params.before = before
    api.get<AuditPage>('/audit', { params }).then((r) => {
      setRows((prev) => (before ? [...prev, ...r.data.items] : r.data.items))
      setCursor(r.data.nextCursor)
    }).catch((e) => setError(apiError(e).message))
  }, [f])
  useEffect(() => { const t = setTimeout(() => load(), 250); return () => clearTimeout(t) }, [load])

  return (
    <section>
      <h1>Auditoría</h1>
      <div className="row filters">
        <select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
          <option value="">Todas las acciones</option>{actions.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}>
          <option value="">Todas las entidades</option>
          {['User', 'Customer', 'Tool', 'Repair', 'EmailLog'].map((x) => <option key={x}>{x}</option>)}
        </select>
        <input placeholder="ID de entidad" value={f.entityId} onChange={(e) => setF({ ...f, entityId: e.target.value.replace(/\D/g, '') })} style={{ maxWidth: 140 }} />
        <label className="inline">Desde <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="inline">Hasta <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <AuditTable rows={rows} />
      {cursor && <p><button onClick={() => load(cursor)}>Cargar más</button></p>}
    </section>
  )
}

/** Historial de auditoría de una reparación, en su detalle (solo ADMIN). Carga al abrirse. */
export function RepairAudit({ repairId }: { repairId: number }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open || rows) return
    api.get<AuditPage>('/audit', { params: { entity: 'Repair', entityId: String(repairId), limit: 200 } }).then((r) => setRows(r.data.items)).catch(() => setRows([]))
  }, [open, rows, repairId])
  return (
    <details className="panel" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Auditoría de esta reparación</summary>
      {open && (rows ? <AuditTable rows={rows} /> : <p>Cargando…</p>)}
    </details>
  )
}
