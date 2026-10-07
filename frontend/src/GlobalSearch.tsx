import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from './api'
import { STATUS_LABEL } from './status'

type Result = {
  customers: { id: number; name: string; taxId: string | null; email: string | null; phone: string | null }[]
  repairs: { id: number; number: string; status: string; customerName: string; tool: string }[]
  tools: { id: number; label: string; serialNumber: string | null; customerId: number; customerName: string }[]
}

/** Buscador de la barra superior: clientes, reparaciones y herramientas desde cualquier pantalla. */
export default function GlobalSearch() {
  const [q, setQ] = useState('')
  const [r, setR] = useState<Result | null>(null)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (q.trim().length < 2) return
    let cancelled = false
    const t = setTimeout(() => {
      api.get<Result>('/search', { params: { q } }).then((x) => { if (!cancelled) { setR(x.data); setOpen(true) } }).catch(() => {})
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q])

  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  // Con menos de 2 caracteres no hay resultados que mostrar, aunque quede el anterior en memoria.
  const shown = q.trim().length >= 2 ? r : null
  const empty = shown && !shown.customers.length && !shown.repairs.length && !shown.tools.length

  return (
    <div className="gsearch" ref={box} role="search">
      <input type="search" placeholder="Buscar cliente, reparación, serie…" aria-label="Buscar" value={q}
        onChange={(e) => setQ(e.target.value)} onFocus={() => shown && setOpen(true)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      {open && shown && (
        <div className="gresults">
          {empty && <p className="muted">Sin resultados</p>}
          {shown.repairs.length > 0 && <><h3>Reparaciones</h3>{shown.repairs.map((x) => (
            <Link key={x.id} to={`/repairs/${x.id}`}><b>{x.number}</b> · {x.customerName}<br /><small>{x.tool} · {STATUS_LABEL[x.status]}</small></Link>
          ))}</>}
          {shown.customers.length > 0 && <><h3>Clientes</h3>{shown.customers.map((x) => (
            <Link key={x.id} to={`/customers/${x.id}`}><b>{x.name}</b><br /><small>{[x.taxId, x.email, x.phone].filter(Boolean).join(' · ')}</small></Link>
          ))}</>}
          {shown.tools.length > 0 && <><h3>Herramientas</h3>{shown.tools.map((x) => (
            <Link key={x.id} to={`/customers/${x.customerId}`}>{x.label}{x.serialNumber && ` · S/N ${x.serialNumber}`}<br /><small>{x.customerName}</small></Link>
          ))}</>}
        </div>
      )}
    </div>
  )
}
