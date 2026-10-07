import { useState, type ReactNode } from 'react'
import { FaBars, FaTimes } from 'react-icons/fa'
import { HiChevronDown } from 'react-icons/hi2'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import GlobalSearch from '../GlobalSearch'
import { NavItemLink } from './NavItemLink'
import { isGroup, visibleStaffNav, type NavGroup } from './nav'
import { UserMenu, useDismiss } from './UserMenu'

/** Menú móvil (≤ 900 px): botón hamburguesa en la cabecera que abre un panel flotante con los mismos ítems. */
function AdminMobileNav() {
  const { can } = useAuth()
  const { pathname } = useLocation()
  // «Abierto en la ruta X»: al navegar a otra ruta el panel queda cerrado sin necesidad de un efecto.
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setOpenAt((cur) => ((typeof v === 'function' ? v(cur === pathname) : v) ? pathname : null))
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({})
  const ref = useDismiss(open, () => setOpenAt(null))
  const items = visibleStaffNav(can)

  const isOpen = (g: NavGroup) => !!groupOpen[g.label] // los submenús siempre arrancan colapsados: se abren con un clic
  return (
    <div className="admin-mobile-nav" ref={ref}>
      <button type="button" className="admin-mobile-nav__button" aria-label={open ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <FaTimes /> : <FaBars />}
      </button>
      {open && (
        <nav className="admin-mobile-nav__panel" aria-label="Menú principal">
          {can('repair:read') && can('customer:read') && <div className="admin-mobile-nav__search"><GlobalSearch /></div>}
          {items.map((n) =>
            isGroup(n) ? (
              <div key={n.label}>
                <button type="button" className="admin-mobile-nav__item" aria-expanded={isOpen(n)}
                  onClick={() => setGroupOpen({ ...groupOpen, [n.label]: !isOpen(n) })}>
                  <span className="admin-mobile-nav__icon"><n.icon aria-hidden /></span>
                  {n.label}
                  <HiChevronDown className={`admin-mobile-nav__chevron${isOpen(n) ? ' open' : ''}`} aria-hidden />
                </button>
                {isOpen(n) && (
                  <div className="admin-mobile-nav__submenu">
                    {n.children.map((c) => <NavItemLink key={c.to} item={c} base="admin-mobile-nav__submenu-item" onClick={() => setOpen(false)} />)}
                  </div>
                )}
              </div>
            ) : (
              <NavItemLink key={n.to} item={n} base="admin-mobile-nav__item" onClick={() => setOpen(false)} />
            ),
          )}
        </nav>
      )}
    </div>
  )
}

function AdminHeader() {
  const { user, can } = useAuth()
  const nav = useNavigate()
  const { pathname, search } = useLocation()
  return (
    <header className="admin-header">
      <div className="admin-header__brand" role="link" tabIndex={0} onClick={() => nav('/')} onKeyDown={(e) => e.key === 'Enter' && nav('/')}>
        <img className="admin-header__logo" src="/logo.png" alt="" />
        <div className="admin-header__brand-text">
          <strong>Servig</strong>
          <span>{user?.role === 'ADMIN' ? 'Panel administrador' : 'Panel del taller'}</span>
        </div>
      </div>
      {can('repair:read') && can('customer:read') && (
        <div className="admin-header__search"><GlobalSearch key={pathname + search} /></div>
      )}
      <div className="admin-header__actions">
        <AdminMobileNav />
        <UserMenu portal="admin" />
      </div>
    </header>
  )
}

/** Barra lateral: siempre colapsada (solo íconos); al pasar el ratón se expande y EMPUJA el contenido. Sin botón de colapso. */
function AdminSidebar() {
  const { can } = useAuth()
  const { pathname } = useLocation()
  const items = visibleStaffNav(can)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({}) // colapsados hasta que se hace clic
  return (
    <aside className="admin-sidebar" aria-label="Navegación">
      <nav className="admin-sidebar__nav">
        {items.map((n) =>
          isGroup(n) ? (
            <div key={n.label} className="admin-sidebar__group">
              {/* La cabecera del grupo despliega o pliega su submenú con un clic (visible con la barra expandida). */}
              <button type="button" title={n.label} aria-expanded={!!openGroups[n.label]}
                onClick={() => setOpenGroups({ ...openGroups, [n.label]: !openGroups[n.label] })}
                className={`admin-sidebar__item admin-sidebar__group-button${pathname.startsWith(n.prefix) ? ' active' : ''}`}>
                <span className="admin-sidebar__icon"><n.icon aria-hidden /></span>
                <span className="admin-sidebar__label">{n.label}</span>
                <HiChevronDown className={`admin-sidebar__chevron${openGroups[n.label] ? ' open' : ''}`} aria-hidden />
              </button>
              <div className={`admin-sidebar__submenu${openGroups[n.label] ? ' open' : ''}`}>
                {n.children.map((c) => <NavItemLink key={c.to} item={c} base="admin-sidebar__submenu-item" />)}
              </div>
            </div>
          ) : (
            <NavItemLink key={n.to} item={n} base="admin-sidebar__item" />
          ),
        )}
      </nav>
    </aside>
  )
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="admin-portal-shell">
      <AdminHeader />
      <div className="admin-portal-body">
        <AdminSidebar />
        <main className="admin-portal-main">{children}</main>
      </div>
    </div>
  )
}
