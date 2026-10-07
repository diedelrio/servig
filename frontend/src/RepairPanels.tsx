import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, apiError } from './api'
import { useAuth } from './auth'
import { fmtDateTime } from './status'
import type { RepairFull } from './RepairDetail'

// ---------- Diagnóstico ----------

export function DiagnosisPanel({ repair, onChange }: { repair: RepairFull; onChange: () => void }) {
  const { can } = useAuth()
  const [error, setError] = useState('')
  const closed = repair.status === 'ENTREGADO' || repair.status === 'CANCELADO'

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    setError('')
    try {
      await api.post(`/repairs/${repair.id}/diagnosis`, { text: fd.get('text'), visibleToCustomer: fd.get('visible') === 'on' })
      form.reset()
      onChange()
    } catch (err) { setError(apiError(err).message) }
  }

  return (
    <>
      <h2>Diagnóstico</h2>
      {repair.diagnoses.map((d) => (
        <div key={d.id} className="panel">
          <small>{fmtDateTime(d.createdAt)} · {d.author.firstName} {d.author.lastName} {d.visibleToCustomer ? <span className="badge active">Visible al cliente</span> : <span className="badge">Interno</span>}</small>
          <p className="pre">{d.text}</p>
        </div>
      ))}
      {!repair.diagnoses.length && <p>Sin diagnóstico todavía.</p>}
      {can('diagnosis:create') && !closed && (
        <form className="panel grid1" onSubmit={submit}>
          <label>Nueva entrada de diagnóstico<textarea name="text" rows={3} required maxLength={4000} /></label>
          <label className="check"><input type="checkbox" name="visible" /> Visible para el cliente en su portal</label>
          {error && <p className="error">{error}</p>}
          <div><button>Agregar diagnóstico</button></div>
        </form>
      )}
    </>
  )
}

// ---------- Presupuesto ----------

type Item = { type: 'LABOR' | 'PART' | 'OTHER'; description: string; quantity: string; unitPrice: string; taxRate: string }
type Version = {
  id: number; version: number; status: string; notes: string | null; sentAt: string | null; validUntil: string | null
  subtotal: string; taxTotal: string; total: string
  approval: { decision: string; decidedAt: string; origin: string; ip: string | null; comment: string | null } | null
  items: { id: number; type: Item['type']; description: string; quantity: string; unitPrice: string; taxRate: string; lineNet: string; lineTax: string }[]
}
type QuoteResp = { quote: { currentVersion: number; status: string; versions: Version[] } | null; defaultTaxRate: number; validDays: number }

const TYPE_LABEL = { LABOR: 'Mano de obra', PART: 'Repuesto', OTHER: 'Otro' }
const QSTATUS: Record<string, string> = { BORRADOR: 'Borrador', ENVIADO: 'Enviado', APROBADO: 'Aprobado', RECHAZADO: 'Rechazado', VENCIDO: 'Vencido', CANCELADO: 'Cancelado' }
const eur = (n: number | string) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Vista previa; el servidor recalcula con aritmética decimal exacta y es quien manda. */
function preview(items: Item[]) {
  let sub = 0, tax = 0
  for (const i of items) {
    const net = r2((Number(i.quantity) || 0) * (Number(i.unitPrice) || 0))
    sub += net
    tax += r2(net * (Number(i.taxRate) || 0) / 100)
  }
  return { sub: r2(sub), tax: r2(tax), total: r2(sub + tax) }
}

function VersionTable({ v }: { v: Version }) {
  return (
    <div className="scroll">
      <table>
        <thead><tr><th>Concepto</th><th>Tipo</th><th>Cant.</th><th>Precio</th><th>IVA %</th><th>Neto</th></tr></thead>
        <tbody>
          {v.items.map((i) => (
            <tr key={i.id}><td>{i.description}</td><td>{TYPE_LABEL[i.type]}</td><td>{i.quantity}</td><td>{eur(i.unitPrice)}</td><td>{i.taxRate}</td><td>{eur(i.lineNet)}</td></tr>
          ))}
          <tr><td colSpan={5} className="actions">Subtotal</td><td>{eur(v.subtotal)}</td></tr>
          <tr><td colSpan={5} className="actions">IVA</td><td>{eur(v.taxTotal)}</td></tr>
          <tr><td colSpan={5} className="actions"><b>Total</b></td><td><b>{eur(v.total)}</b></td></tr>
        </tbody>
      </table>
    </div>
  )
}

export function QuotePanel({ repair, onChange }: { repair: RepairFull; onChange: () => void }) {
  const { can } = useAuth()
  const [data, setData] = useState<QuoteResp | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [notes, setNotes] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.get<QuoteResp>(`/repairs/${repair.id}/quote`).then((r) => {
      setData(r.data)
      const cur = r.data.quote?.versions.find((v) => v.version === r.data.quote!.currentVersion)
      setItems(cur ? cur.items.map((i) => ({ type: i.type, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate })) : [])
      setNotes(cur?.notes ?? '')
    }).catch(() => {})
  }, [repair.id])
  // Se recarga cuando cambia el estado de la reparación (p. ej. tras el rechazo del cliente).
  useEffect(load, [load, repair.status])

  if (!can('quote:read') || !data) return null
  const q = data.quote
  const cur = q?.versions.find((v) => v.version === q.currentVersion)
  const writable = can('quote:write')
  const editable = writable && repair.status === 'EN_REVISION' && (!q || cur?.status === 'BORRADOR')
  const canNewVersion = writable && repair.status === 'EN_REVISION' && !!cur && ['RECHAZADO', 'CANCELADO', 'VENCIDO'].includes(cur.status)
  const canWithdraw = writable && repair.status === 'PRESUPUESTO_PENDIENTE_APROBACION' && !!cur && ['ENVIADO', 'VENCIDO'].includes(cur.status)
  const totals = preview(items)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError(''); setInfo(''); setBusy(true)
    try { await fn(); setInfo(ok); load(); onChange() } catch (e) { setError(apiError(e).message) } finally { setBusy(false) }
  }
  const payload = () => ({
    items: items.map((i) => ({ ...i, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), taxRate: Number(i.taxRate) })),
    notes,
  })
  const save = () => run(() => api.put(`/repairs/${repair.id}/quote`, payload()), 'Borrador guardado.')
  const sendQuote = () => {
    if (!window.confirm(`¿Enviar el presupuesto de ${eur(totals.total)} al cliente? Después no se podrá editar esta versión.`)) return
    run(async () => { await api.put(`/repairs/${repair.id}/quote`, payload()); await api.post(`/repairs/${repair.id}/quote/send`) }, 'Presupuesto enviado.')
  }
  const patch = (idx: number, p: Partial<Item>) => setItems(items.map((it, i) => (i === idx ? { ...it, ...p } : it)))
  const addRow = (type: Item['type'] = 'LABOR') => setItems([...items, { type, description: '', quantity: '1', unitPrice: '0', taxRate: String(data.defaultTaxRate) }])

  return (
    <>
      <div className="row between">
        <h2>Presupuesto {cur && <span className="badge">v{cur.version} · {QSTATUS[cur.status]}</span>}</h2>
        {canNewVersion && <button disabled={busy} onClick={() => run(() => api.post(`/repairs/${repair.id}/quote/new-version`), 'Nueva versión creada.')}>Crear nueva versión</button>}
      </div>
      {!repair.customer.email && editable && (
        <p className="error">El cliente no tiene email, y sin él no puede recibir ni aprobar el presupuesto. Cárgalo en su ficha antes de enviarlo.</p>
      )}
      {!q && !editable && <p>Todavía no hay presupuesto{repair.status === 'RECIBIDO' ? ' (inicia la revisión para prepararlo).' : '.'}</p>}

      {editable ? (
        <div className="panel">
          <div className="scroll">
            <table>
              <thead><tr><th>Tipo</th><th>Concepto</th><th>Cant.</th><th>Precio (sin IVA)</th><th>IVA %</th><th /></tr></thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td><select value={it.type} onChange={(e) => patch(idx, { type: e.target.value as Item['type'] })}>{Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                    <td><input value={it.description} maxLength={300} onChange={(e) => patch(idx, { description: e.target.value })} aria-label="Concepto" /></td>
                    <td><input className="num" type="number" min="0" step="0.01" value={it.quantity} onChange={(e) => patch(idx, { quantity: e.target.value })} aria-label="Cantidad" /></td>
                    <td><input className="num" type="number" min="0" step="0.01" value={it.unitPrice} onChange={(e) => patch(idx, { unitPrice: e.target.value })} aria-label="Precio" /></td>
                    <td><input className="num" type="number" min="0" max="100" step="0.01" value={it.taxRate} onChange={(e) => patch(idx, { taxRate: e.target.value })} aria-label="IVA" /></td>
                    <td><button type="button" className="link" onClick={() => setItems(items.filter((_, i) => i !== idx))}>Quitar</button></td>
                  </tr>
                ))}
                {!items.length && <tr><td colSpan={6}>Agrega mano de obra, repuestos u otros conceptos.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button type="button" className="link" onClick={() => addRow('LABOR')}>+ Mano de obra</button>
            <button type="button" className="link" onClick={() => addRow('PART')}>+ Repuesto</button>
            <button type="button" className="link" onClick={() => addRow('OTHER')}>+ Otro</button>
          </div>
          <label>Notas para el cliente<input value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></label>
          <p className="totals">Subtotal {eur(totals.sub)} · IVA {eur(totals.tax)} · <b>Total {eur(totals.total)}</b> <small>(el servidor confirma el importe final al guardar)</small></p>
          <div className="row">
            <button disabled={busy} onClick={save}>Guardar borrador</button>
            <button disabled={busy || !items.length || !repair.customer.email} onClick={sendQuote}>Enviar al cliente</button>
          </div>
        </div>
      ) : cur && (
        <div className="panel">
          <VersionTable v={cur} />
          {cur.notes && <p>Notas: {cur.notes}</p>}
          {cur.approval && (
            <p className={cur.approval.decision === 'APROBADO' ? 'ok' : 'error'}>
              <b>{cur.approval.decision === 'APROBADO' ? 'Aprobado' : 'Rechazado'} por el cliente</b> el {fmtDateTime(cur.approval.decidedAt)} · {cur.approval.origin === 'CUSTOMER_LINK' ? 'enlace del correo' : 'portal'}{cur.approval.ip && ` · IP ${cur.approval.ip}`}{cur.approval.comment && ` · «${cur.approval.comment}»`}
            </p>
          )}
          {cur.sentAt && <p><small>Enviado el {fmtDateTime(cur.sentAt)}{cur.validUntil && ` · válido hasta ${new Date(cur.validUntil).toLocaleDateString()}`}</small></p>}
          {canWithdraw && cur.status === 'ENVIADO' && !withdrawing && (
            <button className="link" disabled={busy} onClick={() => run(() => api.post(`/repairs/${repair.id}/quote/resend-link`), 'Enlace reenviado al cliente.')}>Reenviar enlace al cliente</button>
          )}
          {canWithdraw && (
            withdrawing ? (
              <div className="row">
                <input placeholder="Motivo de la corrección" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
                <button disabled={busy || !reason.trim()} onClick={() => run(async () => { await api.post(`/repairs/${repair.id}/quote/withdraw`, { comment: reason }); setWithdrawing(false); setReason('') }, 'Presupuesto retirado.')}>Confirmar retiro</button>
                <button className="link" onClick={() => setWithdrawing(false)}>Cancelar</button>
              </div>
            ) : <button className="link" onClick={() => setWithdrawing(true)}>Retirar para corregirlo</button>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {info && <p className="ok">{info}</p>}

      {q && q.versions.length > 1 && (
        <details className="panel">
          <summary>Versiones anteriores ({q.versions.length - 1})</summary>
          {q.versions.filter((v) => v.version !== q.currentVersion).reverse().map((v) => (
            <div key={v.id}>
              <h3>v{v.version} · {QSTATUS[v.status]} · {eur(v.total)}</h3>
              <VersionTable v={v} />
            </div>
          ))}
        </details>
      )}
    </>
  )
}
