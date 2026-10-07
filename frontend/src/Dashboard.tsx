import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, apiError } from './api'
import { STATUS_LABEL } from './status'

type Data = {
  counts: Record<'received' | 'inReview' | 'pendingQuote' | 'awaitingApproval' | 'approved' | 'awaitingParts' | 'inRepair' | 'readyForPickup' | 'overdue' | 'rejected' | 'repaired', number>
  overdue: { id: number; number: string; status: string; customerName: string; tool: string; daysInStatus: number; thresholdDays: number }[]
  thresholds: Record<string, number>
}

// Cada contador lleva a la lista ya filtrada: es lo que hace útil al dashboard.
const TILES: { key: keyof Data['counts']; label: string; to: string; tone?: 'warn' | 'bad' | 'good' }[] = [
  { key: 'received', label: 'Recibidas', to: '/repairs?status=RECIBIDO' },
  { key: 'inReview', label: 'En revisión', to: '/repairs?status=EN_REVISION' },
  { key: 'pendingQuote', label: 'Pendientes de presupuesto', to: '/repairs?filter=pendingQuote', tone: 'warn' },
  { key: 'awaitingApproval', label: 'Esperando aprobación', to: '/repairs?status=PRESUPUESTO_PENDIENTE_APROBACION', tone: 'warn' },
  { key: 'approved', label: 'Aprobadas', to: '/repairs?status=PRESUPUESTO_APROBADO' },
  { key: 'awaitingParts', label: 'Esperando repuestos', to: '/repairs?status=PEDIDO_REPUESTOS_MARCA' },
  { key: 'inRepair', label: 'En reparación', to: '/repairs?status=EN_REPARACION' },
  { key: 'readyForPickup', label: 'Listas para retirar', to: '/repairs?status=LISTO_PARA_RETIRAR', tone: 'good' },
  { key: 'overdue', label: 'Atrasadas', to: '/repairs?filter=overdue', tone: 'bad' },
]
const EXTRA: typeof TILES = [
  { key: 'rejected', label: 'Rechazadas (decidir qué hacer)', to: '/repairs?status=PRESUPUESTO_RECHAZADO' },
  { key: 'repaired', label: 'Reparadas (falta avisar)', to: '/repairs?status=REPARADO' },
]

export default function Dashboard() {
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const load = () => api.get<Data>('/dashboard').then((r) => setD(r.data)).catch((e) => setError(apiError(e).message))
    load()
    const t = setInterval(load, 60_000) // se refresca solo mientras está abierto
    return () => clearInterval(t)
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!d) return <p>Cargando…</p>

  const tile = (t: (typeof TILES)[number]) => {
    const n = d.counts[t.key]
    const tone = n > 0 && t.tone ? t.tone : ''
    return (
      <Link key={t.key} to={t.to} className={`tile ${tone}`}>
        <span className="n">{n}</span>
        <span className="l">{t.label}</span>
      </Link>
    )
  }

  return (
    <section>
      <h1>Taller</h1>
      <div className="tiles">{TILES.map(tile)}</div>
      <p className="muted"><small>«Pendientes de presupuesto» son las que están en revisión y requieren presupuesto (ya incluidas en «En revisión»).</small></p>
      <div className="tiles small">{EXTRA.map(tile)}</div>

      <div className="row between">
        <h2>Atrasadas {d.counts.overdue > 0 && <span className="badge disabled">{d.counts.overdue}</span>}</h2>
        <Link to="/repairs?filter=overdue">Ver en la lista</Link>
      </div>
      {!d.overdue.length ? (
        <p className="ok">Nada atrasado.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead><tr><th>Reparación</th><th>Cliente</th><th>Herramienta</th><th>Estado</th><th>Días en el estado</th></tr></thead>
            <tbody>
              {d.overdue.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/repairs/${r.id}`}>{r.number}</Link></td>
                  <td>{r.customerName}</td><td>{r.tool}</td><td>{STATUS_LABEL[r.status]}</td>
                  <td><b className="error">{r.daysInStatus}</b> <small>(límite {r.thresholdDays})</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="panel">
        <summary>¿Cuándo se considera atrasada?</summary>
        <p>Cuando lleva en su estado actual más días que el límite de ese estado (se cuenta desde el último cambio de estado):</p>
        <ul className="plain">
          {Object.entries(d.thresholds).map(([s, days]) => <li key={s}>{STATUS_LABEL[s]}: <b>{days}</b> días</li>)}
        </ul>
        <small className="muted">Se ajustan con la variable de entorno <code>OVERDUE_DAYS</code>.</small>
      </details>
    </section>
  )
}
