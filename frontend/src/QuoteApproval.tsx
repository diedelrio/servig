import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, apiError } from './api'
import { DecisionControls, QuoteTable, type QuoteItemView } from './QuoteDecision'

type View = {
  state: 'OPEN' | 'DECIDED' | 'WITHDRAWN' | 'EXPIRED' | 'REPLACED' | 'LINK_EXPIRED'
  business: { name: string; phone: string }
  repair: { number: string }
  customerName: string
  tool: string
  quote?: { version: number; notes: string | null; validUntil: string | null; subtotal: string; taxTotal: string; total: string; items: QuoteItemView[] }
  diagnoses?: { text: string; createdAt: string }[]
  decision?: { decision: 'APROBADO' | 'RECHAZADO'; decidedAt: string } | null
}


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
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'APROBADO' | 'RECHAZADO' | null>(null)

  useEffect(() => {
    if (!token) return
    api.get<View>(`/public/quote-approval/${encodeURIComponent(token)}`).then((r) => setV(r.data)).catch(() => setError('Este enlace no es válido.'))
  }, [token])

  const decide = async (decision: 'APPROVE' | 'REJECT', comment?: string) => {
    setBusy(true)
    setError('')
    try {
      await api.post(`/public/quote-approval/${encodeURIComponent(token)}/decision`, { decision, comment: decision === 'REJECT' ? comment : undefined })
      setDone(decision === 'APPROVE' ? 'APROBADO' : 'RECHAZADO')
    } catch (e) {
      setError(apiError(e).message)
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
      <QuoteTable items={q.items} subtotal={q.subtotal} taxTotal={q.taxTotal} total={q.total} />
      {q.notes && <p>Notas: {q.notes}</p>}
      {q.validUntil && <p className="muted">Válido hasta el {new Date(q.validUntil).toLocaleDateString()}.</p>}

      {error && <p className="error">{error}</p>}

      {v.state === 'OPEN' && <DecisionControls total={q.total} busy={busy} onDecide={decide} />}
    </main>
  )
}
