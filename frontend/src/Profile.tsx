import { useState } from 'react'
import { Link } from 'react-router-dom'
import { GROUPS, useRepairs, type ListRow } from './PortalPages'
import { STATUS_LABEL } from './status'
import { api, apiError } from './api'
import { useAuth } from './auth'

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrador', RECEPCION: 'Recepción', TECNICO: 'Técnico', CLIENTE: 'Cliente',
}

/** Tarjeta del cliente con las herramientas que están en reparación ahora (presupuesto aprobado hasta reparada). */
function ToolsInRepair() {
  const { rows } = useRepairs()
  if (!rows) return null
  const inRepair: ListRow[] = rows.filter((r) => (GROUPS.reparacion.statuses as readonly string[]).includes(r.status))
  return (
    <>
      <h2>Herramientas en reparación</h2>
      <div className="panel">
        <div className="row between">
          <div className="tile" style={{ minWidth: 150 }}><span className="n">{inRepair.length}</span><span className="l">en reparación</span></div>
          <Link to="/portal/reparaciones?grupo=reparacion">Ver en la grilla</Link>
        </div>
        {inRepair.length ? (
          <ul className="plain" style={{ marginTop: "0.9rem" }}>
            {inRepair.map((r) => (
              <li key={r.id}>
                <Link to={`/portal/repairs/${r.id}`}><b>{r.tool.type} {r.tool.brand} {r.tool.model}</b></Link>{' '}
                <span className="badge">{STATUS_LABEL[r.status]}</span> <small>{r.number}</small>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No tiene herramientas en reparación en este momento.</p>}
      </div>
    </>
  )
}

/** Mi perfil: datos de la cuenta y cambio de contraseña (por correo, con el mismo flujo seguro de recuperación). */
export default function Profile() {
  const { user, logout } = useAuth()
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const changePassword = async () => {
    setBusy(true); setMsg(''); setError('')
    try {
      const r = await api.post<{ message: string }>('/auth/forgot-password', { email: user.email })
      setMsg(r.data.message)
    } catch (e) { setError(apiError(e).message) } finally { setBusy(false) }
  }

  return (
    <section>
      <h1>Mi perfil</h1>
      <dl className="panel details">
        <dt>Nombre</dt><dd>{user.firstName} {user.lastName}</dd>
        <dt>Email</dt><dd>{user.email}</dd>
        <dt>Rol</dt><dd>{ROLE_LABEL[user.role] ?? user.role}</dd>
      </dl>

      {user.role === 'CLIENTE' && <ToolsInRepair />}

      <h2>Contraseña</h2>
      <div className="panel">
        <p>Para cambiarla te enviamos un correo con un enlace seguro, válido durante una hora.</p>
        <div className="row">
          <button disabled={busy} onClick={changePassword}>Enviar enlace para cambiar la contraseña</button>
        </div>
        {msg && <p className="ok">{msg}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <div className="row"><button className="danger" onClick={logout}>Cerrar sesión</button></div>
    </section>
  )
}
