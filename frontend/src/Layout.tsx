import type { ReactNode } from 'react'
import { Navigate, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import GlobalSearch from './GlobalSearch'

/** Protege la ruta (sesión y, opcionalmente, un permiso) y aplica el marco de la aplicación. */
export function AppLayout({ permission, role, children }: { permission?: string; role?: string; children: ReactNode }) {
  const { user, loading, logout, can } = useAuth()
  const loc = useLocation() // el buscador se reinicia al navegar
  if (loading) return <p className="center">Cargando…</p>
  if (!user) return <Navigate to="/login" replace />
  if (permission && !can(permission)) return <Navigate to="/" replace />
  if (role && user.role !== role) return <Navigate to="/" replace />
  return (
    <>
      <header className="topbar">
        <strong>Servig</strong>
        <nav>
          {user.role === 'CLIENTE' ? <NavLink to="/portal">Mis reparaciones</NavLink> : <NavLink to="/" end>Inicio</NavLink>}
          {can('repair:read') && <NavLink to="/repairs">Reparaciones</NavLink>}
          {can('customer:read') &&<NavLink to="/customers">Clientes</NavLink>}
          {can('user:read') && <NavLink to="/admin/users">Usuarios</NavLink>}
          {can('emaillog:read') && <NavLink to="/admin/emails">Correos</NavLink>}
          {can('audit:read') && <NavLink to="/admin/audit">Auditoría</NavLink>}
        </nav>
        {can('repair:read') && can('customer:read') && <GlobalSearch key={loc.pathname + loc.search} />}
        <span className="who">{user.firstName} · {user.role}</span>
        <button className="link" onClick={logout}>Salir</button>
      </header>
      <div className="page">{children}</div>
    </>
  )
}
