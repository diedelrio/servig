import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, apiError } from './api'
import { useAuth } from './auth'
import { STATUS_LABEL, fmtDateTime } from './status'

type Row = {
  id: number; number: string; status: string; receivedAt: string; declaredFault: string
  customer: { id: number; name: string }; tool: { type: string; brand: string; model: string }
}

export default function RepairsPage() {
  const { can } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [search, setSearch] = useState('')
  // Los contadores del dashboard enlazan aquí con ?status= o ?filter=
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState(params.get('status') ?? '')
  const filter = params.get('filter') ?? ''
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      const query: Record<string, string> = {}
      if (search) query.search = search
      if (status) query.status = status
      if (filter) query.filter = filter
      api.get<Row[]>('/repairs', { params: query }).then((r) => setRows(r.data)).catch((e) => setError(apiError(e).message))
    }, 250)
    return () => clearTimeout(t)
  }, [search, status, filter])

  return (
    <section>
      <div className="row between">
        <h1>Reparaciones</h1>
        {can('repair:create') && <Link className="btn" to="/repairs/new">Nueva recepción</Link>}
      </div>
      <div className="row filters">
        <input placeholder="Buscar por número, cliente, marca, modelo o serie" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {filter && (
        <p className="callout">
          Mostrando: {filter === 'overdue' ? 'atrasadas' : 'pendientes de presupuesto'}{' '}
          <button className="link" onClick={() => setParams({})}>Quitar filtro</button>
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="scroll">
        <table>
          <thead><tr><th>Número</th><th>Recibida</th><th>Cliente</th><th>Herramienta</th><th>Avería</th><th>Estado</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/repairs/${r.id}`}>{r.number}</Link></td>
                <td>{fmtDateTime(r.receivedAt)}</td>
                <td><Link to={`/customers/${r.customer.id}`}>{r.customer.name}</Link></td>
                <td>{r.tool.type} {r.tool.brand} {r.tool.model}</td>
                <td>{r.declaredFault.slice(0, 50)}</td>
                <td>{STATUS_LABEL[r.status]}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6}>Sin resultados</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
