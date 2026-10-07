import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, apiError } from './api'
import { useAuth } from './auth'

type Row = { id: number; email: string; firstName: string; lastName: string; role: string; status: string; lastLoginAt: string | null }

const ROLES = ['ADMIN', 'RECEPCION', 'TECNICO', 'CLIENTE']
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Activo', DISABLED: 'Deshabilitado', PENDING_EMAIL_VERIFICATION: 'Pendiente' }

export default function UsersPage() {
  const { user: me, can } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [filters, setFilters] = useState({ search: '', role: '', status: '' })
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(() => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
    api.get<Row[]>('/users', { params }).then((r) => setRows(r.data)).catch((e) => setError(apiError(e).message))
  }, [filters])
  useEffect(load, [load])

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError('')
    setInfo('')
    try {
      await fn()
      setInfo(ok)
      load()
    } catch (e) {
      setError(apiError(e).message)
    }
  }

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const data = Object.fromEntries(new FormData(form))
    await act(async () => { await api.post('/users', data); form.reset(); setShowForm(false) }, 'Usuario creado. Se envió la invitación por email.')
  }

  const canUpdate = can('user:update')
  return (
    <section>
      <div className="row between">
        <h1>Usuarios</h1>
        {can('user:create') && <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancelar' : 'Nuevo usuario'}</button>}
      </div>

      {showForm && (
        <form className="panel grid2" onSubmit={create}>
          <label>Nombre<input name="firstName" required /></label>
          <label>Apellido<input name="lastName" required /></label>
          <label>Email<input name="email" type="email" required /></label>
          <label>Rol<select name="role" defaultValue="TECNICO">{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
          <button>Crear e invitar</button>
        </form>
      )}

      <div className="row filters">
        <input placeholder="Buscar nombre o email" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}>
          <option value="">Todos los roles</option>{ROLES.map((r) => <option key={r}>{r}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {error && <p className="error">{error}</p>}
      {info && <p className="ok">{info}</p>}

      <div className="scroll">
        <table>
          <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th /></tr></thead>
          <tbody>
            {rows.map((u) => {
              const self = u.id === me?.id
              return (
                <tr key={u.id}>
                  <td>{u.firstName} {u.lastName}</td>
                  <td>{u.email}</td>
                  <td>
                    <select value={u.role} disabled={!canUpdate || self} aria-label={`Rol de ${u.email}`}
                      onChange={(e) => act(() => api.patch(`/users/${u.id}`, { role: e.target.value }), 'Rol actualizado.')}>
                      {ROLES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </td>
                  <td><span className={`badge ${u.status.toLowerCase()}`}>{STATUS_LABEL[u.status]}</span></td>
                  <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</td>
                  <td className="actions">
                    {canUpdate && !self && u.status === 'ACTIVE' && <button className="link" onClick={() => act(() => api.patch(`/users/${u.id}`, { status: 'DISABLED' }), 'Usuario deshabilitado.')}>Deshabilitar</button>}
                    {canUpdate && !self && u.status === 'DISABLED' && <button className="link" onClick={() => act(() => api.patch(`/users/${u.id}`, { status: 'ACTIVE' }), 'Usuario habilitado.')}>Habilitar</button>}
                    {canUpdate && u.status === 'PENDING_EMAIL_VERIFICATION' && <button className="link" onClick={() => act(() => api.post(`/users/${u.id}/resend-invite`), 'Invitación reenviada.')}>Reenviar invitación</button>}
                  </td>
                </tr>
              )
            })}
            {!rows.length && <tr><td colSpan={6}>Sin resultados</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
