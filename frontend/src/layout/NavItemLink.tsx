import { NavLink, useLocation } from 'react-router-dom'
import type { NavItem } from './nav'

/**
 * Enlace de menú con el patrón del portal: ícono + etiqueta (la etiqueta existe siempre en el DOM y se muestra al expandir).
 * `title` da el tooltip nativo cuando la barra está colapsada.
 */
export function NavItemLink({ item, base, onClick }: { item: NavItem; base: string; onClick?: () => void }) {
  const { pathname } = useLocation()
  const forced = item.activeWhen ? item.activeWhen.some((p) => pathname === p || pathname.startsWith(p + '/')) : undefined
  const Icon = item.icon
  return (
    <NavLink to={item.to} end={item.end} title={item.label} onClick={onClick}
      className={({ isActive }) => `${base}${(forced ?? isActive) ? ' active' : ''}`}>
      <span className={`${base.split('__')[0]}__icon`}><Icon aria-hidden /></span>
      <span className={`${base.split('__')[0]}__label`}>{item.label}</span>
    </NavLink>
  )
}
