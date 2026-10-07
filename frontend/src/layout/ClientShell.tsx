import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { NavItemLink } from './NavItemLink'
import { CLIENT_NAV } from './nav'
import { UserMenu } from './UserMenu'

function ClientHeader() {
  const nav = useNavigate()
  return (
    <header className="client-header">
      <div className="client-header__brand" role="link" tabIndex={0} onClick={() => nav('/portal')} onKeyDown={(e) => e.key === 'Enter' && nav('/portal')}>
        <img className="client-header__logo" src="/logo.png" alt="" />
        <span className="client-header__title">Servig</span>
      </div>
      <div className="client-header__actions"><UserMenu portal="client" /></div>
    </header>
  )
}

/** Barra lateral de escritorio (≥ 769 px): fija, colapsada, se SUPERPONE al contenido al pasar el ratón. */
function ClientSidebar() {
  return (
    <aside className="client-sidebar" aria-label="Navegación">
      <nav className="client-sidebar__nav">
        {CLIENT_NAV.map((n) => <NavItemLink key={n.to} item={n} base="client-sidebar__item" />)}
      </nav>
    </aside>
  )
}

/** Barra inferior móvil (≤ 768 px). */
function ClientBottomNav() {
  return (
    <nav className="client-bottom-nav" aria-label="Navegación" style={{ ['--n' as string]: CLIENT_NAV.length }}>
      {CLIENT_NAV.map((n) => (
        <NavItemLink key={n.to} item={{ ...n, label: n.short ?? n.label }} base="client-bottom-nav__item" />
      ))}
    </nav>
  )
}

export function ClientShell({ children }: { children: ReactNode }) {
  return (
    <div className="client-portal-shell">
      <ClientHeader />
      <div className="client-portal-body">
        <ClientSidebar />
        <main className="client-portal-main"><div className="client-page">{children}</div></main>
      </div>
      <ClientBottomNav />
    </div>
  )
}
