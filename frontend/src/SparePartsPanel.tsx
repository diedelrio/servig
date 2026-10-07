import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, apiError } from './api'
import { useAuth } from './auth'
import type { RepairFull } from './RepairDetail'

type Part = {
  id: number; code: string | null; description: string; supplier: string | null; quantity: number
  cost: string; price: string; status: string; orderedAt: string | null; receivedAt: string | null; notes: string | null; nextStatuses: string[]
}
type Data = { parts: Part[]; summary: { pending: number; notInstalled: number; totalCost: string; totalPrice: string } }

const LABEL: Record<string, string> = {
  NECESARIO: 'Necesario', SOLICITADO: 'Solicitado', PEDIDO_A_MARCA: 'Pedido a la marca', RECIBIDO: 'Recibido', INSTALADO: 'Instalado', CANCELADO: 'Cancelado',
}
const ACTION: Record<string, string> = {
  SOLICITADO: 'Solicitar', PEDIDO_A_MARCA: 'Pedido a la marca', RECIBIDO: 'Recibido', INSTALADO: 'Instalado', CANCELADO: 'Cancelar',
}
const BADGE: Record<string, string> = { INSTALADO: 'active', RECIBIDO: 'active', CANCELADO: 'disabled' }
const eur = (n: string) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

function PartForm({ part, onSubmit, onCancel, error }: { part?: Part; onSubmit: (d: Record<string, unknown>) => void; onCancel: () => void; error: string }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    onSubmit({
      code: f.get('code'), description: f.get('description'), supplier: f.get('supplier'),
      quantity: Number(f.get('quantity')), cost: Number(f.get('cost')), price: Number(f.get('price')),
    })
  }
  return (
    <form className="panel grid2" onSubmit={submit}>
      <label>Código<input name="code" defaultValue={part?.code ?? ''} maxLength={60} /></label>
      <label>Descripción<input name="description" required defaultValue={part?.description ?? ''} maxLength={300} /></label>
      <label>Proveedor / marca<input name="supplier" defaultValue={part?.supplier ?? ''} maxLength={120} /></label>
      <label>Cantidad<input name="quantity" type="number" min="1" step="1" required defaultValue={part?.quantity ?? 1} /></label>
      <label>Coste unitario (€)<input name="cost" type="number" min="0" step="0.01" required defaultValue={part?.cost ?? '0'} /></label>
      <label>Precio unitario (€)<input name="price" type="number" min="0" step="0.01" required defaultValue={part?.price ?? '0'} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row"><button>Guardar</button><button type="button" className="link" onClick={onCancel}>Cancelar</button></div>
    </form>
  )
}

export function SparePartsPanel({ repair, onChange }: { repair: RepairFull; onChange: () => void }) {
  const { can } = useAuth()
  const [data, setData] = useState<Data | null>(null)
  const [form, setForm] = useState<'new' | number | null>(null)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const closed = repair.status === 'ENTREGADO' || repair.status === 'CANCELADO'
  const write = can('part:write') && !closed

  const load = useCallback(() => {
    api.get<Data>(`/repairs/${repair.id}/spare-parts`).then((r) => setData(r.data)).catch(() => {})
  }, [repair.id])
  useEffect(load, [load, repair.status])

  if (!can('part:read') || !data) return null

  const run = async (fn: () => Promise<unknown>, onErr: (m: string) => void, done?: () => void) => {
    onErr('')
    try { await fn(); done?.(); load(); onChange() } catch (e) { onErr(apiError(e).message) }
  }
  const warn = ['EN_REPARACION', 'REPARADO', 'LISTO_PARA_RETIRAR'].includes(repair.status) && data.summary.notInstalled > 0

  return (
    <>
      <div className="row between">
        <h2>Repuestos</h2>
        {write && form === null && <button onClick={() => { setForm('new'); setFormError('') }}>Agregar repuesto</button>}
      </div>
      {warn && <p className="error">Hay {data.summary.notInstalled} repuesto(s) sin instalar ni cancelar. Revísalos antes de entregar.</p>}

      {form === 'new' && (
        <PartForm error={formError} onCancel={() => setForm(null)}
          onSubmit={(d) => run(() => api.post(`/repairs/${repair.id}/spare-parts`, d), setFormError, () => setForm(null))} />
      )}

      <div className="scroll">
        <table>
          <thead><tr><th>Código</th><th>Descripción</th><th>Proveedor</th><th>Cant.</th><th>Coste u.</th><th>Precio u.</th><th>Pedido</th><th>Recibido</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {data.parts.map((p) => form === p.id ? (
              <tr key={p.id}><td colSpan={10}>
                <PartForm part={p} error={formError} onCancel={() => setForm(null)}
                  onSubmit={(d) => run(() => api.patch(`/spare-parts/${p.id}`, d), setFormError, () => setForm(null))} />
              </td></tr>
            ) : (
              <tr key={p.id} className={p.status === 'CANCELADO' ? 'struck' : undefined}>
                <td>{p.code ?? '—'}</td><td>{p.description}</td><td>{p.supplier ?? '—'}</td><td>{p.quantity}</td>
                <td>{eur(p.cost)}</td><td>{eur(p.price)}</td><td>{p.orderedAt ?? '—'}</td><td>{p.receivedAt ?? '—'}</td>
                <td><span className={`badge ${BADGE[p.status] ?? ''}`}>{LABEL[p.status]}</span></td>
                <td className="actions">
                  {write && p.nextStatuses.map((to) => (
                    <button key={to} className="link" onClick={() => run(() => api.post(`/spare-parts/${p.id}/status`, { to }), setError)}>{ACTION[to]}</button>
                  ))}
                  {write && p.nextStatuses.length > 0 && <button className="link" onClick={() => { setForm(p.id); setFormError('') }}>Editar</button>}
                </td>
              </tr>
            ))}
            {!data.parts.length && <tr><td colSpan={10}>Sin repuestos registrados.</td></tr>}
          </tbody>
        </table>
      </div>
      {error && <p className="error">{error}</p>}
      {data.parts.length > 0 && (
        <p className="totals"><small>Pendientes de recibir: {data.summary.pending} · Total coste {eur(data.summary.totalCost)} · Total precio {eur(data.summary.totalPrice)} (sin cancelados)</small></p>
      )}
    </>
  )
}
