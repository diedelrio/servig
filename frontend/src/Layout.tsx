import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './auth'
import { AdminShell } from './layout/AdminShell'
import { ClientShell } from './layout/ClientShell'

/**
 * Protege la ruta (sesión y, opcionalmente, un permiso o un rol) y aplica el marco del portal que corresponde:
 * el del cliente (CLIENTE) o el del taller (ADMIN, RECEPCION y TECNICO, con el menú filtrado por permisos).
 */
export function AppLayout({ permission, role, children }: { permission?: string; role?: string; children: ReactNode }) {
  const { user, loading, can } = useAuth()
  if (loading) return <p className="center">Cargando…</p>
  if (!user) return <Navigate to="/login" replace />
  if (permission && !can(permission)) return <Navigate to="/" replace />
  if (role && user.role !== role) return <Navigate to="/" replace />
  return user.role === 'CLIENTE' ? <ClientShell>{children}</ClientShell> : <AdminShell>{children}</AdminShell>
}
