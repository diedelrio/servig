import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, apiError, type ApiError } from './api'
import { useAuth } from './auth'

type Row = { id: number; name: string; taxId: string | null; email: string | null; phone: string | null; toolCount: number }

type CustomerValues = { name?: string; taxId?: string | null; email?: string | null; phone?: string | null; address?: string | null; notes?: string | null }

export function CustomerFields({ c, error }: { c?: CustomerValues; error?: ApiError | null }) {
  const f = error?.fields ?? {}
  const field = (name: keyof CustomerValues, label: string, type = 'text', required = false) => (
    <label>{label}
      <input name={name} type={type} required={required} defaultValue={c?.[name] ?? ''} aria-invalid={!!f[name]} />
      {f[name] && <small className="error">{f[name]}</small>}
    </label>
  )
  return (
    <>
      {field('name', 'Nombre / razón social', 'text', true)}
      {field('taxId', 'DNI / NIF / CIF')}
      {field('email', 'Email', 'email')}
      {field('phone', 'Teléfono', 'tel')}
      {field('address', 'Dirección')}
      <label>Observaciones<textarea name="notes" rows={2} defaultValue={c?.notes ?? ''} /></label>
    </>
  )
}

export default function CustomersPage() {
  const { can } = useAuth()
  const nav = useNavigate()
  const [rows, setRows] = useState<Row[]>([])
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      api.get<Row[]>('/customers', { params: search ? { search } : {} })
        .then((r) => setRows(r.data))
        .catch((e) => setError(apiError(e)))
    }, 250)
    return () => clearTimeout(t)
  }, [search])

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    try {
      const r = await api.post('/customers', Object.fromEntries(new FormData(e.currentTarget)))
      nav(`/customers/${r.data.id}`)
    } catch (err) {
      setError(apiError(err))
    }
  }

  return (
    <section>
      <div className="row between">
        <h1>Clientes</h1>
        {can('customer:create') && <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancelar' : 'Nuevo cliente'}</button>}
      </div>

      {showForm && (
        <form className="panel grid2" onSubmit={create}>
          <CustomerFields error={error} />
          {error && !Object.keys(error.fields).length && <p className="error">{error.message}</p>}
          {error?.code?.startsWith('DUPLICATE') && <p className="error">{error.message}</p>}
          <button>Crear cliente</button>
        </form>
      )}

      <div className="row filters">
        <input placeholder="Buscar por nombre, DNI/NIF, email o teléfono" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {!showForm && error && <p className="error">{error.message}</p>}

      <div className="scroll">
        <table>
          <thead><tr><th>Nombre</th><th>DNI/NIF/CIF</th><th>Email</th><th>Teléfono</th><th>Herramientas</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/customers/${c.id}`}>{c.name}</Link></td>
                <td>{c.taxId ?? '—'}</td><td>{c.email ?? '—'}</td><td>{c.phone ?? '—'}</td><td>{c.toolCount}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5}>Sin resultados</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
