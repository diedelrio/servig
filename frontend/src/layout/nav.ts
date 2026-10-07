import type { IconType } from 'react-icons'
import { FaClipboardCheck, FaPlusCircle, FaCog, FaHome, FaBoxes, FaServer, FaSlidersH, FaTools, FaUserAlt, FaUsers, FaWrench } from 'react-icons/fa'
import { MdOutlineMarkEmailRead } from 'react-icons/md'

export type NavItem = {
  to: string
  label: string
  /** Etiqueta corta para la barra inferior móvil del cliente. */
  short?: string
  icon: IconType
  /** Solo activo en la ruta exacta (p. ej. Inicio, para que no quede activo en todo). */
  end?: boolean
  /** Prefijos extra que también marcan el ítem como activo (p. ej. el detalle de una reparación). */
  activeWhen?: string[]
  /** Permiso necesario para verlo (solo personal). */
  can?: string
}
export type NavGroup = { label: string; icon: IconType; prefix: string; children: NavItem[] }
export const isGroup = (n: NavItem | NavGroup): n is NavGroup => 'children' in n

/** Portal del taller (ADMIN, RECEPCION, TECNICO). Cada ítem aparece solo si el usuario tiene el permiso. */
export const STAFF_NAV: (NavItem | NavGroup)[] = [
  { to: '/', label: 'Inicio', icon: FaHome, end: true, can: 'dashboard:read' },
  { to: '/repairs', label: 'Reparaciones', icon: FaWrench, can: 'repair:read' },
  { to: '/customers', label: 'Clientes', icon: FaUsers, can: 'customer:read' },
  {
    label: 'Administración', icon: FaCog, prefix: '/admin',
    children: [
      { to: '/admin/users', label: 'Usuarios', icon: FaUserAlt, can: 'user:read' },
      { to: '/admin/emails', label: 'Correos', icon: MdOutlineMarkEmailRead, can: 'emaillog:read' },
      { to: '/admin/audit', label: 'Auditoría', icon: FaClipboardCheck, can: 'audit:read' },
    ],
  },
  {
    label: 'Configuración', icon: FaSlidersH, prefix: '/config',
    children: [
      { to: '/config/catalogs', label: 'Catálogos', icon: FaBoxes, can: 'settings:read' },
      { to: '/config/params', label: 'Parámetros', icon: FaSlidersH, can: 'settings:read' },
      { to: '/config/system', label: 'Sistema', icon: FaServer, can: 'settings:read' },
    ],
  },
]

/** Portal del cliente. */
export const CLIENT_NAV: NavItem[] = [
  { to: '/portal', label: 'Inicio', short: 'Inicio', icon: FaHome, end: true },
  { to: '/portal/reparaciones', label: 'Mis reparaciones', short: 'Reparaciones', icon: FaTools, activeWhen: ['/portal/reparaciones', '/portal/repairs'] },
  { to: '/portal/nueva', label: 'Nueva solicitud', short: 'Nueva', icon: FaPlusCircle },
  { to: '/perfil', label: 'Mi perfil', short: 'Perfil', icon: FaUserAlt },
]

/** Filtra el menú del personal por permisos y descarta los grupos que quedan vacíos. */
export function visibleStaffNav(can: (p: string) => boolean): (NavItem | NavGroup)[] {
  const out: (NavItem | NavGroup)[] = []
  for (const n of STAFF_NAV) {
    if (isGroup(n)) {
      const children = n.children.filter((c) => !c.can || can(c.can))
      if (children.length) out.push({ ...n, children })
    } else if (!n.can || can(n.can)) {
      out.push(n)
    }
  }
  return out
}

/** Iniciales para el avatar: nombre + apellido; si no hay, la inicial del email; si no, «U». */
export function initials(u: { firstName?: string; lastName?: string; email?: string } | null | undefined) {
  const a = u?.firstName?.trim()[0]
  const b = u?.lastName?.trim()[0]
  if (a || b) return `${a ?? ''}${b ?? ''}`.toUpperCase()
  return (u?.email?.trim()[0] ?? 'U').toUpperCase()
}
