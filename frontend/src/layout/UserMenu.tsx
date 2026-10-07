import { useEffect, useRef, useState } from 'react'
import { HiChevronDown } from 'react-icons/hi2'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { initials } from './nav'

/** Cierra con clic fuera (mousedown) y con Escape; se reutiliza en el menú de usuario y en el panel móvil. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open, close])
  return ref
}

/**
 * Avatar con iniciales + desplegable (Mi perfil / Cerrar sesión).
 * Admin: el botón muestra además nombre y email. Cliente: solo avatar y flecha; nombre y email van dentro del desplegable.
 */
export function UserMenu({ portal }: { portal: 'admin' | 'client' }) {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  // «Abierto en la ruta X»: al navegar a otra ruta queda cerrado sin necesidad de un efecto.
  const { pathname } = useLocation()
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setOpenAt((cur) => ((typeof v === 'function' ? v(cur === pathname) : v) ? pathname : null))
  const ref = useDismiss(open, () => setOpenAt(null))
  if (!user) return null
  const name = `${user.firstName} ${user.lastName}`.trim()
  const p = `${portal}-header`

  return (
    <div className={`${p}__user`} ref={ref}>
      <button type="button" className={`${p}__user-button`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`${p}__avatar`} aria-hidden>{initials(user)}</span>
        {portal === 'admin' && (
          <span className="admin-header__user-text"><strong>{name || user.email}</strong><small>{user.email}</small></span>
        )}
        <HiChevronDown className={`${p}__chevron${open ? ' open' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className={`${p}__menu`} role="menu">
          {portal === 'client' && (
            <div className="client-header__menu-head"><strong>{name || user.email}</strong><small>{user.email}</small></div>
          )}
          <button type="button" role="menuitem" onClick={() => nav('/perfil')}>Mi perfil</button>
          <button type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); logout() }}>Cerrar sesión</button>
        </div>
      )}
    </div>
  )
}
