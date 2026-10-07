import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, apiError, type ApiError } from './api'
import { useAuth } from './auth'
import { CustomerFields } from './CustomersPage'
import { ToolForm, type Tool } from './ToolForm'
import { STATUS_LABEL, fmtDateTime } from './status'

type Customer = {
  id: number; name: string; taxId: string | null; email: string | null; phone: string | null; address: string | null; notes: string | null
  createdAt: string; quotes: { repairId: number; repairNumber: string; version: number; status: string; total: string; sentAt: string | null; current: boolean }[]; documents: { id: number; repairId: number; repairNumber: string; filename: string; mime: string; size: number; createdAt: string; visibleToCustomer: boolean }[]; tools: Tool[]; repairs: { id: number; number: string; status: string; receivedAt: string; toolId: number; declaredFault: string }[]; portalUser: { email: string; status: string } | null
}

const QSTATUS: Record<string, string> = { BORRADOR: 'Borrador', ENVIADO: 'Enviado', APROBADO: 'Aprobado', RECHAZADO: 'Rechazado', VENCIDO: 'Vencido', CANCELADO: 'Retirado' }
const eur = (n: string) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** Los documentos requieren sesión, así que se descargan con el token y se abren como blob. */
function OpenDoc({ repairId, doc }: { repairId: number; doc: { id: number; filename: string } }) {
  const open = async () => {
    const r = await api.get(`/repairs/${repairId}/attachments/${doc.id}`, { responseType: 'blob' })
    const url = URL.createObjectURL(r.data)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return <button className="link" onClick={open}>{doc.filename}</button>
}

export default function CustomerDetail() {
  const id = Number(useParams().id)
  const { can } = useAuth()
  const [c, setC] = useState<Customer | null>(null)
  const [missing, setMissing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [toolForm, setToolForm] = useState<'new' | number | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [info, setInfo] = useState('')

  const load = useCallback(() => {
    api.get<Customer>(`/customers/${id}`).then((r) => setC(r.data)).catch(() => setMissing(true))
  }, [id])
  useEffect(load, [load])

  const run = async (fn: () => Promise<unknown>, ok: string, done: () => void) => {
    setError(null)
    setInfo('')
    try { await fn(); setInfo(ok); done(); load() } catch (e) { setError(apiError(e)) }
  }

  if (missing) return <section><h1>Cliente no encontrado</h1><Link to="/customers">Volver</Link></section>
  if (!c) return <p>Cargando…</p>

  const toolName = (toolId: number) => {
    const t = c.tools.find((x) => x.id === toolId)
    return t ? `${t.brand} ${t.model}` : '—'
  }

  const saveCustomer = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = Object.fromEntries(new FormData(e.currentTarget))
    run(() => api.patch(`/customers/${id}`, data), 'Cliente actualizado.', () => setEditing(false))
  }

  return (
    <section>
      <p><Link to="/customers">← Clientes</Link></p>
      <div className="row between">
        <h1>{c.name}</h1>
        {can('customer:update') && !editing && <button onClick={() => { setEditing(true); setError(null) }}>Editar</button>}
      </div>
      {info && <p className="ok">{info}</p>}

      {editing ? (
        <form className="panel grid2" onSubmit={saveCustomer}>
          <CustomerFields c={c} error={error} />
          {error && !Object.keys(error.fields).length && <p className="error">{error.message}</p>}
          <div className="row"><button>Guardar</button><button type="button" className="link" onClick={() => setEditing(false)}>Cancelar</button></div>
        </form>
      ) : (
        <dl className="panel details">
          <dt>DNI/NIF/CIF</dt><dd>{c.taxId ?? '—'}</dd>
          <dt>Email</dt><dd>{c.email ?? '—'}</dd>
          <dt>Teléfono</dt><dd>{c.phone ?? '—'}</dd>
          <dt>Dirección</dt><dd>{c.address ?? '—'}</dd>
          <dt>Observaciones</dt><dd>{c.notes ?? '—'}</dd>
          <dt>Alta</dt><dd>{new Date(c.createdAt).toLocaleDateString()}</dd>
          <dt>Acceso al portal</dt><dd>{c.portalUser ? `Vinculado (${c.portalUser.email})` : 'Sin cuenta vinculada'}</dd>
        </dl>
      )}

      <div className="row between">
        <h2>Herramientas</h2>
        {can('tool:create') && toolForm === null && <button onClick={() => { setToolForm('new'); setError(null) }}>Agregar herramienta</button>}
      </div>

      {toolForm === 'new' && (
        <ToolForm error={error} onCancel={() => setToolForm(null)}
          onSubmit={(d) => run(() => api.post('/tools', { ...d, customerId: id }), 'Herramienta agregada.', () => setToolForm(null))} />
      )}

      <div className="scroll">
        <table>
          <thead><tr><th>Tipo</th><th>Marca</th><th>Modelo</th><th>N.º serie</th><th>Compra</th><th>Garantía</th><th /></tr></thead>
          <tbody>
            {c.tools.map((t) => toolForm === t.id ? (
              <tr key={t.id}><td colSpan={7}>
                <ToolForm tool={t} error={error} onCancel={() => setToolForm(null)}
                  onSubmit={(d) => run(() => api.patch(`/tools/${t.id}`, d), 'Herramienta actualizada.', () => setToolForm(null))} />
              </td></tr>
            ) : (
              <tr key={t.id}>
                <td>{t.type}</td><td>{t.brand}</td><td>{t.model}</td><td>{t.serialNumber ?? '—'}</td><td>{t.purchaseDate ?? '—'}</td>
                <td>{t.warrantyExpiresAt ? <span className={`badge ${t.warrantyActive ? 'active' : 'disabled'}`}>{t.warrantyActive ? 'Vigente' : 'Vencida'} · {t.warrantyExpiresAt}</span> : '—'}</td>
                <td className="actions">{can('repair:create') && <Link to={`/repairs/new?customerId=${c.id}&toolId=${t.id}`}>Recibir</Link>}{' '}{can('tool:update') && <button className="link" onClick={() => { setToolForm(t.id); setError(null) }}>Editar</button>}</td>
              </tr>
            ))}
            {!c.tools.length && <tr><td colSpan={7}>Sin herramientas registradas</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Reparaciones</h2>
      <div className="scroll">
        <table>
          <thead><tr><th>Número</th><th>Fecha</th><th>Herramienta</th><th>Avería</th><th>Estado</th></tr></thead>
          <tbody>
            {c.repairs.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/repairs/${r.id}`}>{r.number}</Link></td>
                <td>{fmtDateTime(r.receivedAt)}</td>
                <td>{toolName(r.toolId)}</td>
                <td>{r.declaredFault.slice(0, 60)}</td>
                <td>{STATUS_LABEL[r.status]}</td>
              </tr>
            ))}
            {!c.repairs.length && <tr><td colSpan={5}>Sin reparaciones</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Presupuestos</h2>
      <div className="scroll">
        <table>
          <thead><tr><th>Reparación</th><th>Versión</th><th>Estado</th><th>Total</th><th>Enviado</th></tr></thead>
          <tbody>
            {c.quotes.map((q) => (
              <tr key={`${q.repairId}-${q.version}`}>
                <td><Link to={`/repairs/${q.repairId}`}>{q.repairNumber}</Link></td>
                <td>v{q.version}{q.current && ' (vigente)'}</td><td>{QSTATUS[q.status]}</td><td>{eur(q.total)}</td>
                <td>{q.sentAt ? fmtDateTime(q.sentAt) : '—'}</td>
              </tr>
            ))}
            {!c.quotes.length && <tr><td colSpan={5}>Sin presupuestos</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Documentos</h2>
      <div className="scroll">
        <table>
          <thead><tr><th>Archivo</th><th>Reparación</th><th>Fecha</th><th>Cliente lo ve</th></tr></thead>
          <tbody>
            {c.documents.map((d) => (
              <tr key={d.id}>
                <td><OpenDoc repairId={d.repairId} doc={d} /></td>
                <td><Link to={`/repairs/${d.repairId}`}>{d.repairNumber}</Link></td>
                <td>{fmtDateTime(d.createdAt)}</td><td>{d.visibleToCustomer ? 'Sí' : 'No'}</td>
              </tr>
            ))}
            {!c.documents.length && <tr><td colSpan={4}>Sin documentos</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
