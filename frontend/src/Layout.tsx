import type { ReactNode } from 'react'
import { Navigate, NavLink } from 'react-router-dom'
import { useAuth } from './auth'

/** Protege la ruta (sesión y, opcionalmente, un permiso) y aplica el marco de la aplicación. */
export function AppLayout({ permission, children }: { permission?: string; children: ReactNode }) {
  const { user, loading, logout, can } = useAuth()
  if (loading) return <p className="center">Cargando…</p>
  if (!user) return <Navigate to="/login" replace />
  if (permission && !can(permission)) return <Navigate to="/" replace />
  return (
    <>
      <header className="topbar">
        <strong>Servig</strong>
        <nav>
          <NavLink to="/" end>Inicio</NavLink>
          {can('user:read') && <NavLink to="/admin/users">Usuarios</NavLink>}
        </nav>
        <span className="who">{user.firstName} · {user.role}</span>
        <button className="link" onClick={logout}>Salir</button>
      </header>
      <div className="page">{children}</div>
    </>
  )
}
