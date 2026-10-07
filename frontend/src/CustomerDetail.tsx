import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, apiError, type ApiError } from './api'
import { useAuth } from './auth'
import { CustomerFields } from './CustomersPage'

type Tool = {
  id: number; type: string; brand: string; model: string; serialNumber: string | null
  purchaseDate: string | null; warrantyExpiresAt: string | null; description: string | null; notes: string | null; warrantyActive: boolean
}
type Customer = {
  id: number; name: string; taxId: string | null; email: string | null; phone: string | null; address: string | null; notes: string | null
  createdAt: string; tools: Tool[]; portalUser: { email: string; status: string } | null
}

function ToolForm({ tool, error, onSubmit, onCancel }: { tool?: Tool; error: ApiError | null; onSubmit: (d: Record<string, FormDataEntryValue>) => void; onCancel: () => void }) {
  const f = error?.fields ?? {}
  const field = (name: keyof Tool, label: string, type = 'text', required = false) => (
    <label>{label}
      <input name={name} type={type} required={required} defaultValue={(tool?.[name] as string | null) ?? ''} aria-invalid={!!f[name]} />
      {f[name] && <small className="error">{f[name]}</small>}
    </label>
  )
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); onSubmit(Object.fromEntries(new FormData(e.currentTarget))) }
  return (
    <form className="panel grid2" onSubmit={submit}>
      {field('type', 'Tipo (taladro, amoladora…)', 'text', true)}
      {field('brand', 'Marca', 'text', true)}
      {field('model', 'Modelo', 'text', true)}
      {field('serialNumber', 'Número de serie')}
      {field('purchaseDate', 'Fecha de compra', 'date')}
      {field('warrantyExpiresAt', 'Vencimiento de garantía', 'date')}
      {field('description', 'Descripción')}
      {field('notes', 'Observaciones')}
      {error && !Object.keys(f).length && <p className="error">{error.message}</p>}
      <div className="row"><button>Guardar</button><button type="button" className="link" onClick={onCancel}>Cancelar</button></div>
    </form>
  )
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
                <td className="actions">{can('tool:update') && <button className="link" onClick={() => { setToolForm(t.id); setError(null) }}>Editar</button>}</td>
              </tr>
            ))}
            {!c.tools.length && <tr><td colSpan={7}>Sin herramientas registradas</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
