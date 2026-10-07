import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, apiError } from './api'

type Item = { type: 'LABOR' | 'PART' | 'OTHER'; description: string; quantity: string; unitPrice: string; taxRate: string; lineNet: string }
type View = {
  state: 'OPEN' | 'DECIDED' | 'WITHDRAWN' | 'EXPIRED' | 'REPLACED' | 'LINK_EXPIRED'
  business: { name: string; phone: string }
  repair: { number: string }
  customerName: string
  tool: string
  quote?: { version: number; notes: string | null; validUntil: string | null; subtotal: string; taxTotal: string; total: string; items: Item[] }
  diagnoses?: { text: string; createdAt: string }[]
  decision?: { decision: 'APROBADO' | 'RECHAZADO'; decidedAt: string } | null
}

const TYPE_LABEL = { LABOR: 'Mano de obra', PART: 'Repuesto', OTHER: 'Otro' }
const eur = (n: string) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

const MESSAGE: Record<Exclude<View['state'], 'OPEN' | 'DECIDED'>, string> = {
  WITHDRAWN: 'El taller retiró este presupuesto para corregirlo. Recibirá uno nuevo por correo.',
  EXPIRED: 'Este presupuesto ya no está vigente. Contacte con el taller para solicitar uno nuevo.',
  REPLACED: 'Este enlace fue reemplazado por uno más reciente. Revise su correo y use el último mensaje recibido.',
  LINK_EXPIRED: 'El enlace venció. Contacte con el taller para que le envíen uno nuevo.',
}

/** Página pública (sin sesión): el cliente revisa el presupuesto y lo aprueba o rechaza con el enlace del correo. */
export default function QuoteApproval() {
  const token = useSearchParams()[0].get('token') ?? ''
  const [v, setV] = useState<View | null>(null)
  const [error, setError] = useState(token ? '' : 'Enlace incompleto.')
  const [step, setStep] = useState<'review' | 'confirmApprove' | 'confirmReject'>('review')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'APROBADO' | 'RECHAZADO' | null>(null)

  useEffect(() => {
    if (!token) return
    api.get<View>(`/public/quote-approval/${encodeURIComponent(token)}`).then((r) => setV(r.data)).catch(() => setError('Este enlace no es válido.'))
  }, [token])

  const decide = async (decision: 'APPROVE' | 'REJECT') => {
    setBusy(true)
    setError('')
    try {
      await api.post(`/public/quote-approval/${encodeURIComponent(token)}/decision`, { decision, comment: decision === 'REJECT' ? reason : undefined })
      setDone(decision === 'APPROVE' ? 'APROBADO' : 'RECHAZADO')
    } catch (e) {
      setError(apiError(e).message)
      setStep('review')
      api.get<View>(`/public/quote-approval/${encodeURIComponent(token)}`).then((r) => setV(r.data)).catch(() => {})
    } finally { setBusy(false) }
  }

  if (error && !v) return <main className="card"><h1>Presupuesto</h1><p className="error">{error}</p></main>
  if (!v) return <main className="card"><p>Cargando…</p></main>

  const head = (
    <>
      <p className="muted">{v.business.name}{v.business.phone && ` · ${v.business.phone}`}</p>
      <h1>Presupuesto {v.repair.number}</h1>
      <p>Hola <b>{v.customerName}</b>, este es el presupuesto para su <b>{v.tool}</b>.</p>
    </>
  )

  if (done) {
    return (
      <main className="card wide">
        {head}
        <p className="ok big">{done === 'APROBADO' ? '✔ Hemos registrado su aprobación.' : 'Hemos registrado que rechaza el presupuesto.'}</p>
        <p>{done === 'APROBADO' ? 'Comenzaremos la reparación y le avisaremos cuando esté lista. Recibirá una confirmación por correo.' : 'No se realizará ninguna reparación. El taller se pondrá en contacto con usted.'}</p>
      </main>
    )
  }

  if (v.state !== 'OPEN' && v.state !== 'DECIDED') {
    return <main className="card wide">{head}<p>{MESSAGE[v.state]}</p></main>
  }

  const q = v.quote!
  return (
    <main className="card wide">
      {head}

      {v.state === 'DECIDED' && v.decision && (
        <p className={v.decision.decision === 'APROBADO' ? 'ok big' : 'error big'}>
          {v.decision.decision === 'APROBADO' ? '✔ Presupuesto aprobado' : 'Presupuesto rechazado'} el {new Date(v.decision.decidedAt).toLocaleString()}.
        </p>
      )}

      {!!v.diagnoses?.length && (
        <>
          <h2>Diagnóstico</h2>
          {v.diagnoses.map((d, i) => <p key={i} className="pre">{d.text}</p>)}
        </>
      )}

      <h2>Detalle</h2>
      <div className="scroll">
        <table>
          <thead><tr><th>Concepto</th><th>Cant.</th><th>Precio</th><th>IVA</th><th>Neto</th></tr></thead>
          <tbody>
            {q.items.map((i, idx) => (
              <tr key={idx}><td>{i.description} <small>({TYPE_LABEL[i.type]})</small></td><td>{i.quantity}</td><td>{eur(i.unitPrice)}</td><td>{i.taxRate} %</td><td>{eur(i.lineNet)}</td></tr>
            ))}
            <tr><td colSpan={4} className="actions">Subtotal</td><td>{eur(q.subtotal)}</td></tr>
            <tr><td colSpan={4} className="actions">IVA</td><td>{eur(q.taxTotal)}</td></tr>
            <tr><td colSpan={4} className="actions"><b>Total</b></td><td><b>{eur(q.total)}</b></td></tr>
          </tbody>
        </table>
      </div>
      {q.notes && <p>Notas: {q.notes}</p>}
      {q.validUntil && <p className="muted">Válido hasta el {new Date(q.validUntil).toLocaleDateString()}.</p>}

      {error && <p className="error">{error}</p>}

      {v.state === 'OPEN' && step === 'review' && (
        <>
          <p><b>No se realizará ninguna reparación sin su aprobación.</b></p>
          <div className="row">
            <button disabled={busy} onClick={() => setStep('confirmApprove')}>Aprobar presupuesto</button>
            <button disabled={busy} className="danger" onClick={() => setStep('confirmReject')}>Rechazar</button>
          </div>
        </>
      )}
      {v.state === 'OPEN' && step === 'confirmApprove' && (
        <div className="panel">
          <p>¿Confirma que <b>aprueba</b> este presupuesto por <b>{eur(q.total)}</b> (IVA incluido) y autoriza la reparación?</p>
          <div className="row">
            <button disabled={busy} onClick={() => decide('APPROVE')}>Sí, aprobar</button>
            <button disabled={busy} className="link" onClick={() => setStep('review')}>Volver</button>
          </div>
        </div>
      )}
      {v.state === 'OPEN' && step === 'confirmReject' && (
        <div className="panel grid1">
          <p>¿Confirma que <b>rechaza</b> este presupuesto? No se realizará la reparación.</p>
          <label>Motivo (opcional)<textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="row">
            <button disabled={busy} className="danger" onClick={() => decide('REJECT')}>Sí, rechazar</button>
            <button disabled={busy} className="link" onClick={() => setStep('review')}>Volver</button>
          </div>
        </div>
      )}
    </main>
  )
}
