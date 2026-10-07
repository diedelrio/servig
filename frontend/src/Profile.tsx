import { useState } from 'react'
import { api, apiError } from './api'
import { useAuth } from './auth'

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrador', RECEPCION: 'Recepción', TECNICO: 'Técnico', CLIENTE: 'Cliente',
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
